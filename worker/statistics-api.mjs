import {databaseForEnvironment} from './database.mjs';
import {resolvePrincipal} from './identity.mjs';
import {verifierForEnvironment} from './cognito.mjs';
import {emptyHistories,parseLegacy,validateQuiz,replayQuiz,mergeHistories} from '../dist/statistics-history.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const fingerprint=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(b=>b.toString(16).padStart(2,'0')).join('');
const emptySummary=()=>({histories:emptyHistories(),streams:{},legacyFingerprint:null});
async function body(request){
 const reader=request.body?.getReader();if(!reader)throw Error('Send JSON.');let size=0;const decoder=new TextDecoder();let raw='';
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw Error('Statistics request exceeds 1 MB.');}raw+=decoder.decode(value,{stream:true});}
 return JSON.parse(raw+decoder.decode());
}
export async function statisticsApi(request,env,{verifyIdentity}={}){
 const url=new URL(request.url),path=url.pathname,write=request.method==='POST';
 if(!['/api/statistics','/api/statistics/preferences','/api/statistics/quiz','/api/statistics/import'].includes(path))return json({error:'Not found.'},404);
 if(request.method!==(path==='/api/statistics'?'GET':'POST'))return json({error:'Method not allowed.'},405);
 if(url.search)return json({error:'Invalid statistics query.'},400);
 if(write&&(request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='application/json'))return json({error:'Use the statistics controls on this site.'},403);
 let db,actor;
 try{db=databaseForEnvironment(env);}catch{return json({error:'Statistics storage is unavailable. Please retry later.'},503);}
 try{actor=await resolvePrincipal(request,{db,verifyIdentity:verifyIdentity||verifierForEnvironment(env)});}catch{return json({error:'Sign in again to access account statistics.'},401);}
 if(actor.kind!=='user')return json({error:'Sign in to access historical statistics.'},401);
 if(request.headers.has('x-statistics-account')&&request.headers.get('x-statistics-account')!==actor.userId)return json({error:'The signed-in account changed. Reload statistics before saving.'},409);
 const user=actor.userId,now=new Date().toISOString();
 try{
  let input;if(write){try{input=await body(request);}catch{return json({error:'Invalid or oversized statistics data.'},400);}}
  const enabled=async()=>{const row=await db.prepare('SELECT enabled FROM user_statistics_settings WHERE user_id=?').bind(user).first();return row?row.enabled===1:true;};
  const read=()=>db.prepare('SELECT revision,payload_json FROM user_statistics_summary WHERE user_id=?').bind(user).first();
  if(path==='/api/statistics/preferences'){
   if(typeof input.enabled!=='boolean')return json({error:'Choose whether to save history.'},400);
   await db.prepare('INSERT INTO user_statistics_settings(user_id,enabled,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at').bind(user,input.enabled?1:0,now).run();
   return json({enabled:input.enabled});
  }
  if(!write){
   const row=await read(),state=row?JSON.parse(row.payload_json):emptySummary();
   return json({userId:user,enabled:await enabled(),histories:state.histories,imported:!!state.legacyFingerprint,cursors:Object.fromEntries(Object.entries(state.streams).map(([stream,c])=>[stream,c.sequence]))});
  }
  let event,snapshot,hash;
  try{if(path.endsWith('/quiz')){event=validateQuiz(input,{requireCursor:true});hash=await fingerprint(event);}else{snapshot=parseLegacy(input);hash=await fingerprint(snapshot);}}catch{return json({error:'Invalid statistics contribution.'},400);}
  // A small cursor per browser session makes retries safe without retaining a
  // quiz archive. CAS plus the preference-row lock serializes concurrent devices.
  for(let attempt=0;attempt<12;attempt++){
   const row=await read(),state=row?JSON.parse(row.payload_json):emptySummary(),revision=row?.revision||0;
   if(event){const prior=state.streams[event.stream];if(prior&&prior.sequence>=event.sequence){if(prior.sequence===event.sequence&&prior.hash!==hash)return json({error:'This contribution conflicts with an already synchronized result.'},409);return json({stored:true});}}
   else if(state.legacyFingerprint){return state.legacyFingerprint===hash?json({imported:true,fingerprint:hash}):json({error:'A different history snapshot was already imported. Browser data was kept to avoid counting overlapping statistics twice.'},409);}
   if(!await enabled())return event?json({stored:false,enabled:false}):json({error:'Turn on historical statistics storage before importing.'},409);
   const next={...state,streams:{...state.streams}};
   if(event){next.histories=replayQuiz(state.histories,event);next.streams[event.stream]={sequence:event.sequence,hash};}
   else{
    if((input.photo?.version===2||input.audio?.version===2)&&Object.values(state.histories).some(h=>h.quizzes))return json({error:'This aggregate backup may overlap existing account statistics. Its browser copy was kept.'},409);
    // Frozen legacy counts predate this feature. Add them before newer review
    // buffers and latest comparisons; the original snapshot itself is not kept.
    next.histories=mergeHistories(snapshot,state.histories);next.legacyFingerprint=hash;
   }
   const results=await db.batch([
    db.prepare('INSERT INTO user_statistics_settings(user_id,enabled,updated_at) VALUES (?,1,?) ON CONFLICT(user_id) DO UPDATE SET updated_at=user_statistics_settings.updated_at').bind(user,now),
    db.prepare('INSERT INTO user_statistics_summary(user_id,revision,payload_json,updated_at) VALUES (?,0,?,?) ON CONFLICT(user_id) DO NOTHING').bind(user,JSON.stringify(emptySummary()),now),
    db.prepare('UPDATE user_statistics_summary SET revision=revision+1,payload_json=?,updated_at=? WHERE user_id=? AND revision=? AND EXISTS (SELECT 1 FROM user_statistics_settings WHERE user_id=? AND enabled=1)').bind(JSON.stringify(next),now,user,revision,user)
   ]);
   if(Number(results[2].meta?.changes)===1)return event?json({stored:true}):json({imported:true,fingerprint:hash});
  }
  return json({error:'Statistics changed concurrently. Your browser summary was kept; retry synchronization.'},409);
 }catch{return json({error:'Statistics storage is unavailable. Browser summaries have been kept; retry later.'},503);}
}
