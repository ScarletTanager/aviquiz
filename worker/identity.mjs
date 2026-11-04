// Server-only seam. verifyIdentity is a trusted adapter, never request-supplied claims.
export const GUEST=Object.freeze({kind:'guest',userId:null,grants:[]});
export function verifiedIdentity(value){
  if(!value||typeof value.issuer!=='string'||typeof value.subject!=='string'||
    !value.subject||value.subject.length>255)throw Error('Invalid verified identity.');
  const issuer=new URL(value.issuer);
  if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.search||issuer.hash)
    throw Error('Invalid identity issuer.');
  // Do not normalize issuer/subject or merge accounts by email.
  return {issuer:value.issuer,subject:value.subject,email:value.email||null,emailVerified:value.emailVerified===true};
}
export async function principalForUser(db,userId){
  const user=await db.prepare('SELECT id,status FROM app_users WHERE id=?').bind(userId).first();
  if(!user||user.status!=='active')return GUEST;
  const rows=await db.prepare('SELECT permission FROM app_grants WHERE user_id=?').bind(userId).all();
  return {kind:'user',userId:user.id,grants:rows.results.map(r=>r.permission)};
}
export async function resolvePrincipal(request,{db,verifyIdentity}){
  if(typeof verifyIdentity!=='function')throw Error('A trusted identity verifier is required.');
  // Verification failures propagate; never downgrade invalid credentials to a user.
  const claims=await verifyIdentity(request);
  if(claims===null)return GUEST;
  const identity=verifiedIdentity(claims);
  const mapping=await db.prepare('SELECT user_id FROM app_identities WHERE issuer=? AND subject=?')
    .bind(identity.issuer,identity.subject).first();
  // Verified sign-in does not automatically register, link accounts, or grant privileges.
  if(!mapping)return {kind:'unregistered',userId:null,grants:[]};
  return principalForUser(db,mapping.user_id);
}
