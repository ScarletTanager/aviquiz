import {resolvePrincipal} from './identity.mjs';
import {hasPermission} from './permissions.mjs';
import {verifierForEnvironment} from './cognito.mjs';
import {databaseForEnvironment} from './database.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export const validEmail=email=>typeof email==='string'&&email.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function invitationApi(request,env,{verifyIdentity}={}){
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405);
  const url=new URL(request.url);
  if(request.method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='application/json'))return json({error:'Use the invitation form on this site.'},403);
  let db,principal;
  try{db=databaseForEnvironment(env);}catch{return json({error:'Account storage is unavailable.'},503);}
  try{principal=await resolvePrincipal(request,{db,verifyIdentity:verifyIdentity||verifierForEnvironment(env)});}catch{return json({error:'Sign in again to verify your account.'},401);}
  if(!hasPermission(principal,'users.invite'))return json({error:'Invitation permission is required.'},403);
  const provider=env.INVITATION_PROVIDER;
  if(request.method==='GET')return json({available:Boolean(provider),perPersonDailyLimit:5,totalDailyLimit:20,administrator:hasPermission(principal,'system.admin')});
  if(!provider)return json({error:'Invitations are not enabled here yet.'},503);
  let body;
  try{const raw=await request.text();if(raw.length>2048)return json({error:'Send one email address.'},413);body=JSON.parse(raw);}catch{return json({error:'Invalid invitation.'},400);}
  if(!body||Object.keys(body).some(k=>!['email','requestId'].includes(k))||!validEmail(typeof body.email==='string'?body.email.trim():null)||typeof body.requestId!=='string'||!uuid.test(body.requestId))return json({error:'Enter one valid email address.'},400);
  const email=body.email.trim().toLowerCase(),id=body.requestId,actor=principal.userId;
  const q=(sql,...args)=>db.prepare(sql).bind(...args);
  const existingResponse=row=>{
    if(row.state==='sent')return row.actor_user_id===actor&&row.id===id&&row.email===email?json({sent:true,requestId:id}):json({error:'An invitation has already been sent to this address. No additional email was sent.'},409);
    return json({error:'This address already has an unfinished invitation. Check its status before sending another email.',requestId:row.id,requiresReview:true},409);
  };
  let reserved=false,stage='reserve';
  try{
    let existing=await q('SELECT * FROM app_invitations WHERE id=? OR email=?',id,email).first();
    if(existing)return existingResponse(existing);
    // Deliberately do not attach a different identity to a user selected by email.
    if(await q('SELECT id FROM app_users WHERE LOWER(email)=?',email).first())return json({error:'An account already exists for this email address.'},409);
    const now=new Date().toISOString(),cutoff=new Date(Date.now()-86400000).toISOString();
    // Updating the singleton serializes quota reservation across processes on
    // PostgreSQL and SQLite; D1 batches are transactional as well.
    await db.batch([
      q('UPDATE app_invitation_lock SET touched_at=? WHERE id=1',now),
      q("INSERT INTO app_invitations (id,actor_user_id,email,state,created_at,updated_at) SELECT ?,?,?,'preparing',?,? WHERE (SELECT COUNT(*) FROM app_invitations WHERE created_at>=?)<20 AND (SELECT COUNT(*) FROM app_invitations WHERE actor_user_id=? AND created_at>=?)<5 ON CONFLICT DO NOTHING",id,actor,email,now,now,cutoff,actor,cutoff)
    ]);
    existing=await q('SELECT * FROM app_invitations WHERE id=? OR email=?',id,email).first();
    if(!existing)return json({error:'The daily invitation limit has been reached. Try again later.'},429);
    if(existing.id!==id||existing.actor_user_id!==actor||existing.email!==email)return existingResponse(existing);
    // Only the INSERT winner may contact the provider. A conditional claim also
    // prevents concurrent requests with the same id from sending twice.
    const claim=crypto.randomUUID();
    const changed=await q("UPDATE app_invitations SET provider_username=? WHERE id=? AND state='preparing' AND provider_username IS NULL",claim,id).run();
    if(changed.meta?.changes!==1)return existingResponse(existing);
    reserved=true;
    stage='create-account';
    const identity=await provider.prepare(email);
    if(identity.issuer!==env.AUTH_ISSUER||!identity.subject||!identity.username)throw Error('Invalid invitation identity.');
    stage='save-account';
    const userId=crypto.randomUUID(),stamp=new Date().toISOString();
    await db.batch([
      q('INSERT INTO app_users (id,email,created_at) VALUES (?,?,?)',userId,email,stamp),
      q('INSERT INTO app_identities (issuer,subject,user_id) VALUES (?,?,?)',identity.issuer,identity.subject,userId),
      q("UPDATE app_invitations SET user_id=?,provider_username=?,state='ready',updated_at=? WHERE id=?",userId,identity.username,stamp,id),
      q("INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) VALUES (?,?,'user.invite.prepare','user',?,?,?)",crypto.randomUUID(),actor,userId,JSON.stringify({invitationId:id}),stamp)
    ]);
    stage='send-email';
    // Email-only pools reject the internal UUID returned by AdminCreateUser.
    // Stable identity linking above still uses issuer/subject, never email.
    await provider.deliver(email);
    stage='record-send';
    await db.batch([
      q("UPDATE app_invitations SET state='sent',updated_at=? WHERE id=?",new Date().toISOString(),id),
      q("INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) VALUES (?,?,'user.invite.send','user',?,?,?)",crypto.randomUUID(),actor,userId,JSON.stringify({invitationId:id}),new Date().toISOString())
    ]);
    return json({sent:true,requestId:id},201);
  }catch(error){
    const allowedCodes=['InvalidParameterException','AccessDeniedException','NotAuthorizedException','UsernameExistsException','CodeDeliveryFailureException','TooManyRequestsException','CredentialsProviderError'];
    const errorCode=allowedCodes.includes(error?.name)?error.name:'Unclassified';
    // A provider timeout can mean success. Never automatically create, resend,
    // delete, or change someone's password in response to an ambiguous result.
    if(reserved)try{await db.batch([
      q("UPDATE app_invitations SET state='needs_attention',updated_at=? WHERE id=?",new Date().toISOString(),id),
      q("INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) VALUES (?,?,'user.invite.attention','user',?,?,?)",crypto.randomUUID(),actor,principal.userId,JSON.stringify({invitationId:id,stage,errorCode}),new Date().toISOString())
    ]);}catch{}
    const errorMessage=stage==='record-send'?'The invitation email was accepted for sending, but AviQuiz could not save its status. Check with the recipient before sending another invitation.':stage==='send-email'&&errorCode==='InvalidParameterException'?'The account was created, but its invitation email could not be sent. Please have this invitation checked before trying again.':stage==='send-email'?'The account was created, but we could not confirm that its invitation email was sent. Check with the recipient before sending another invitation.':'Account setup could not be completed. No invitation email was requested. Please have this invitation checked before trying again.';
    return json({error:errorMessage,requestId:id,requiresReview:reserved},503);
  }
}
