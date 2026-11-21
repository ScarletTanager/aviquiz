import {verifierForEnvironment} from './cognito.mjs';
import {resolvePrincipal} from './identity.mjs';
import {hasPermission} from './permissions.mjs';
import {databaseForEnvironment,firstReviewWrite} from './database.mjs';
import {trustedSiteOwner} from './account-api.mjs';
import {accountApi} from './account-api.mjs';
import {ncApi} from './nc-api.mjs';
import {geographyApi} from './geography-api.mjs';
import {invitationApi} from './invitations.mjs';
// Built with embedded, unchanged quiz assets by scripts/build-worker.mjs.
// Sites identity is trusted only in Sites/D1 mode; standalone hosts reject those headers.
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const rowValue=r=>({photoId:r.photo_id,speciesId:r.species_id,status:r.status,revision:r.revision,document:JSON.parse(r.document_json),approved:r.approved_json?JSON.parse(r.approved_json):null,updatedAt:r.updated_at});
async function rows(db){return (await db.prepare('SELECT * FROM photo_reviews ORDER BY species_id, photo_id').all()).results.map(rowValue);}
async function reviewAccess(request,env,db,verifyIdentity){
  if(trustedSiteOwner(request,env))return {read:true,edit:true,publish:true,admin:true};
  const supplied=request.headers.get('x-review-agent-key');
  if(supplied&&env.REVIEW_AGENT_KEY){
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await hash(supplied),b=await hash(env.REVIEW_AGENT_KEY);let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];if(different===0)return {read:true,edit:true,publish:true,admin:true};
  }
  const principal=await resolvePrincipal(request,{db,verifyIdentity});
  return {read:hasPermission(principal,'annotations.read'),edit:hasPermission(principal,'annotations.edit'),publish:hasPermission(principal,'annotations.publish'),admin:hasPermission(principal,'system.admin')};
}
export async function api(request,env,{verifyIdentity}={}){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/nc/quiz'||path==='/api/nc/import')return ncApi(request,env);
  if(path==='/api/geography'||path==='/api/geography/refresh')return geographyApi(request,env,{verifyIdentity});
  if(path==='/api/invitations')return invitationApi(request,env,{verifyIdentity});
  // Keep the named API entry point consistent with default.fetch.
  if(path==='/api/account'||path.startsWith('/api/account/'))return accountApi(request,env,{verifyIdentity});
  let db;
  try{db=databaseForEnvironment(env);}catch{return json({error:'Shared review storage is unavailable. Please try again later.'},503);}
  try{
    if(path==='/api/annotations'&&request.method==='GET'){
      const all=await rows(db),approved=all.filter(r=>r.approved).map(r=>{
        const {notes,photoChecked,sourceChecked,...published}=r.approved;return published;
      }).sort((a,b)=>(a.approvedAt||'').localeCompare(b.approvedAt||''));
      return json({schema:1,annotations:approved,coverage:reviewCoverage(CATALOG.birds,all)});
    }
    let access;
    try{access=await reviewAccess(request,env,db,verifyIdentity||verifierForEnvironment(env));}
    catch{return json({error:'Sign in again to verify your account.'},401);}
    if(!access.read)return json({error:'Sign in with an authorized AviQuiz account to access photo reviews.'},403);
    if(path==='/api/reviews'&&request.method==='GET'){
      const all=await rows(db);return json({schema:1,rows:all,coverage:reviewCoverage(CATALOG.birds,all),canEdit:access.edit,canPublish:access.publish});
    }
    if(request.method!=='POST')return json({error:'Unknown review route.'},404);
    if(!access.edit)return json({error:'Photo editing permission is required.'},403);
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return json({error:'Use the review workspace on this site.'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Send JSON.'},415);
    const raw=await request.text();if(raw.length>200000)return json({error:'Review payload too large.'},413);
    const body=JSON.parse(raw);
    if(path==='/api/reviews/seed'){
      if(!access.admin)return json({error:'Administrator permission is required.'},403);
      const statements=Object.entries(LEGACY_TIPS).map(([photoId,entry])=>{
        const document={...entry,photoId,schema:1,tips:LEGACY_SPECIES[entry.speciesId].tips,photoChecked:true,sourceChecked:true,notes:'Previously reviewed six-photo pilot.'};
        return db.prepare("INSERT INTO photo_reviews (photo_id,species_id,status,revision,document_json,approved_json,updated_at) VALUES (?,?,'approved',1,?,?,?) ON CONFLICT(photo_id) DO NOTHING").bind(photoId,entry.speciesId,JSON.stringify(document),JSON.stringify(document),new Date().toISOString());
      });
      await db.batch(statements);return json({seeded:true});
    }
    if(path!=='/api/reviews/save')return json({error:'Unknown review route.'},404);
    const action=body.action;if(!['draft','approve','skip','unpublish'].includes(action))return json({error:'Unknown review action.'},400);
    if(['approve','unpublish'].includes(action)&&!access.publish)return json({error:'Photo publishing permission is required.'},403);
    const document=validateReview(body.document,CATALOG.birds,{approve:action==='approve'});
    const expected=body.revision;if(!Number.isInteger(expected)||expected<0)return json({error:'A revision is required.'},400);
    const all=await rows(db),existing=all.find(r=>r.photoId===document.photoId);
    if((existing?.revision||0)!==expected)return json({error:'This review changed elsewhere. Reload it before saving.'},409);
    if(action==='approve'&&!existing?.approved){
      const c=reviewCoverage(CATALOG.birds,all);
      if(c.round!==null&&c.counts[document.speciesId]+1>c.round)return json({error:`Breadth-first review: finish round ${c.round} before approving another photo for this species.`},409);
    }
    const status=action==='approve'?'approved':action==='skip'?'skipped':'draft';
    const now=new Date().toISOString();if(action==='approve')document.approvedAt=now;
    const approved=action==='approve'?JSON.stringify(document):action==='unpublish'?null:existing?.approved?JSON.stringify(existing.approved):null;
    // The guard also prevents simultaneous approvals of two photos for one species
    // from crossing the current round, even when both callers read the same queue.
    const guard=action==='approve'&&!existing?.approved;
    const round=guard?reviewCoverage(CATALOG.birds,all).round:0;
    const condition=guard?' AND (SELECT COUNT(*) FROM photo_reviews WHERE species_id=? AND approved_json IS NOT NULL) < ?':'';
    const guardArgs=guard?[document.speciesId,round]:[];
    const statement=expected===0?
      db.prepare(`INSERT INTO photo_reviews (photo_id,species_id,status,revision,document_json,approved_json,updated_at) SELECT ?,?,?,1,?,?,? WHERE 1=1${condition} ON CONFLICT(photo_id) DO NOTHING RETURNING *`).bind(document.photoId,document.speciesId,status,JSON.stringify(document),approved,now,...guardArgs):
      db.prepare(`UPDATE photo_reviews SET status=?, revision=revision+1, document_json=?, approved_json=?, updated_at=? WHERE photo_id=? AND revision=?${condition} RETURNING *`).bind(status,JSON.stringify(document),approved,now,document.photoId,expected,...guardArgs);
    const saved=await firstReviewWrite(db,statement);
    if(!saved)return json({error:'This review changed elsewhere. Reload before saving.'},409);
    return json({row:rowValue(saved)});
  }catch(error){
    if(error instanceof SyntaxError)return json({error:'Invalid JSON.'},400);
    if(error.databaseError||error.message?.includes('SQLITE')||error.message?.includes('D1'))return json({error:'Shared storage could not complete this request. Please retry.'},503);
    return json({error:error.message||'Review could not be saved.'},400);
  }
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/'))return api(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const name=path==='/explore'||path==='/explore/'?'/explore.html':path==='/invite'||path==='/invite/'?'/invite.html':['/auth/callback','/','/index.html','/quiz','/quiz/','/trips','/trips/','/routes','/routes/','/statistics','/statistics/'].includes(path)?'/index.html':path==='/review'||path==='/review/'?'/review.html':path;
    const asset=ASSETS[name];if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
  }
};
