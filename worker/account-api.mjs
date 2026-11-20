import {databaseForEnvironment,usesSitesIdentity} from './database.mjs';
import {verifierForEnvironment} from './cognito.mjs';
import {accountService} from './accounts.mjs';
import {principalForUser} from './identity.mjs';
import {hasPermission} from './permissions.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const OWNER_ID='0a42fa64-ecdd-4efa-98c5-e2c95f94320f';
export function trustedSiteOwner(request,env){
  if(!usesSitesIdentity(env))return false;
  const id=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return Boolean(id&&(id===OWNER_ID||(env.REVIEW_OWNER_EMAIL&&email===env.REVIEW_OWNER_EMAIL.trim().toLowerCase())));
}
// These platform headers are trusted ONLY behind Sites. Remove this bootstrap
// path before migrating to a host where clients can supply these headers.
function bootstrapOwner(request,env,identity){
  return trustedSiteOwner(request,env)&&identity.emailVerified&&typeof env.REVIEW_OWNER_EMAIL==='string'&&
    identity.email?.toLowerCase()===env.REVIEW_OWNER_EMAIL.trim().toLowerCase();
}
export async function accountApi(request,env,{verifyIdentity}={}){
  const url=new URL(request.url),path=url.pathname;
  if(!['/api/account','/api/account/enroll','/api/account/bootstrap'].includes(path))return json({error:'Not found.'},404);
  const write=path!=='/api/account';
  if(request.method!==(write?'POST':'GET'))return json({error:'Method not allowed.'},405);
  if(write&&(request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='application/json'))return json({error:'Use account controls on this site.'},403);
  let db;
  try{db=databaseForEnvironment(env);}catch{return json({error:'Account storage unavailable.'},503);}
  let identity;
  try{identity=await (verifyIdentity||verifierForEnvironment(env))(request);}catch{return json({error:'Sign in again to verify your account.'},401);}
  if(!identity)return path==='/api/account'?json({kind:'guest',permissions:[]}):json({error:'Sign in required.'},401);
  if(path==='/api/account/enroll'&&!identity.emailVerified)return json({error:'A verified email is required.'},403);
  try{
    let mapping=await db.prepare('SELECT user_id FROM app_identities WHERE issuer=? AND subject=?').bind(identity.issuer,identity.subject).first();
    if(!mapping&&path==='/api/account/enroll'){
      try{await accountService(db).registerVerifiedUser(identity);}catch(error){
        // Concurrent tabs may enroll the same identity. Only accept an actual mapping.
        mapping=await db.prepare('SELECT user_id FROM app_identities WHERE issuer=? AND subject=?').bind(identity.issuer,identity.subject).first();
        if(!mapping)throw error;
      }
      mapping=await db.prepare('SELECT user_id FROM app_identities WHERE issuer=? AND subject=?').bind(identity.issuer,identity.subject).first();
    }
    if(!mapping)return json({kind:'unregistered',permissions:[]});
    let principal=await principalForUser(db,mapping.user_id);
    if(principal.kind!=='user')return json({error:'This AviQuiz account is disabled.'},403);
    const initialized=await db.prepare('SELECT user_id FROM app_bootstrap WHERE id=1').first();
    const canBootstrap=!initialized&&bootstrapOwner(request,env,identity);
    if(path==='/api/account/bootstrap'){
      if(!canBootstrap)return json({error:'Administrator setup is unavailable.'},403);
      const attempt=crypto.randomUUID(),now=new Date().toISOString();
      await db.batch([
        db.prepare("INSERT INTO app_bootstrap (id,user_id,attempt,created_at) SELECT 1,?,?,? WHERE NOT EXISTS (SELECT 1 FROM app_bootstrap) AND NOT EXISTS (SELECT 1 FROM app_grants WHERE permission='system.admin') ON CONFLICT DO NOTHING").bind(principal.userId,attempt,now),
        db.prepare("INSERT INTO app_grants (user_id,permission) SELECT user_id,'system.admin' FROM app_bootstrap WHERE attempt=? ON CONFLICT DO NOTHING").bind(attempt),
        db.prepare("INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) SELECT ?,user_id,'admin.bootstrap','grant',user_id,'{}',? FROM app_bootstrap WHERE attempt=?").bind(crypto.randomUUID(),now,attempt)
      ]);
      principal=await principalForUser(db,principal.userId);
      if(!hasPermission(principal,'system.admin'))return json({error:'Administrator setup is already complete.'},409);
    }
    return json({kind:'user',userId:principal.userId,permissions:principal.grants,
      administrator:hasPermission(principal,'system.admin'),canBootstrap:path!=='/api/account/bootstrap'&&canBootstrap});
  }catch{return json({error:'Account storage could not complete this request.'},503);}
}
