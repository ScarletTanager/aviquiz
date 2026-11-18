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
const issuer=authConfig.authority;
export const verifyCognito=identityVerifier({issuer,clientId:authConfig.client_id,
  keySet:createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:600000})});
