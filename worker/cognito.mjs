import {createRemoteJWKSet,jwtVerify} from 'jose';
import {authConfig} from '../dist/auth-config.mjs';
// Trusted, deployment-owned issuer and audience. Never derive a key URL from a token.
export function identityVerifier({issuer,clientId,keySet}) {
  return async request => {
    const header=request.headers.get('authorization');
    if(!header)return null;
    if(!/^Bearer [^\s]+$/.test(header)||header.length>20000)throw Error('Invalid authentication.');
    const {payload}=await jwtVerify(header.slice(7),keySet,{
      issuer,audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat'],clockTolerance:5
    });
    if(payload.token_use!=='id'||typeof payload.sub!=='string'||!payload.sub)throw Error('Invalid authentication.');
    return {issuer:payload.iss,subject:payload.sub,email:payload.email,emailVerified:payload.email_verified===true};
  };
}
const verifiers=new Map();
export function verifierForEnvironment(env={}){
  const issuer=env.AUTH_ISSUER||authConfig.authority,clientId=env.AUTH_CLIENT_ID||authConfig.client_id;
  const key=issuer+'|'+clientId;
  if(!verifiers.has(key)){
    const url=new URL(issuer);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid configured identity issuer.');
    if(verifiers.size>=8)verifiers.clear();
    verifiers.set(key,identityVerifier({issuer,clientId,
      keySet:createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:600000})}));
  }
  return verifiers.get(key);
}
export const verifyCognito=verifierForEnvironment();
