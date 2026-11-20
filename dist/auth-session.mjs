import {authConfig} from './auth-config.mjs';
import {managerSettings} from './auth-core.mjs';
let managerPromise;
export async function getUserManager(){
  if(!authConfig.enabled)return null;
  managerPromise??=(async()=>{
    const settings=managerSettings(authConfig,location.origin);
    const {UserManager,WebStorageStateStore}=await import('./oidc-client-ts.mjs');
    return new UserManager({...settings,userStore:new WebStorageStateStore({store:sessionStorage}),stateStore:new WebStorageStateStore({store:sessionStorage})});
  })();
  return managerPromise;
}
export function accountRequestHeaders(url,origin,options,user){
  if(new URL(url,origin).origin!==origin)throw Error('Account requests must stay on this site.');
  const headers=new Headers(options?.headers);
  if(user&&!user.expired&&user.id_token)headers.set('authorization',`Bearer ${user.id_token}`);
  return headers;
}
export async function accountFetch(url,options={}){
  const manager=await getUserManager(),user=await manager?.getUser();
  const headers=accountRequestHeaders(url,location.origin,options,user);
  return fetch(url,{...options,headers});
}
