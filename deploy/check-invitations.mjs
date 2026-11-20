// Internal service-readiness probe only. Never submits an invitation or contacts AWS.
import fs from 'node:fs/promises';
import {createDatabaseEnvironment} from '/srv/aviquiz/current/server/database/index.mjs';
import {api} from '/srv/aviquiz/current/dist/server/index.js';
let env;
try{
  env=await createDatabaseEnvironment(process.env);
  await fs.access('/etc/aviquiz/roles-anywhere/server.key.pem',fs.constants.R_OK);
  const identity=await env.DB.prepare("SELECT i.issuer,i.subject FROM app_identities i JOIN app_users u ON u.id=i.user_id JOIN app_grants g ON g.user_id=u.id WHERE u.status='active' AND g.permission='system.admin' AND i.issuer=?").bind(env.AUTH_ISSUER).first();
  if(!identity)throw Error('Admin identity missing.');
  const response=await api(new Request('https://aviquiz.org/api/invitations'),env,{verifyIdentity:async()=>identity});
  const value=await response.json();
  if(response.status!==200||!value.available)throw Error('Invitations unavailable.');
  console.log(JSON.stringify({ready:true,administratorAccess:true,certificateReadable:true,perPersonDailyLimit:value.perPersonDailyLimit,totalDailyLimit:value.totalDailyLimit,awsCallsMade:false}));
}catch{console.error('Invitation readiness check failed; private details withheld.');process.exitCode=1;}
finally{await env?.DB.close();}
