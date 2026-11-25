import i18next from './i18next.mjs';
import resources from './messages-en.mjs';
// English only for now: no detection, cookies, remote loading, or selector.
export const locale='en';
const instance=i18next.createInstance();
instance.init({lng:locale,fallbackLng:locale,supportedLngs:[locale],resources:{en:resources},ns:Object.keys(resources),defaultNS:'common',keySeparator:false,initAsync:false,interpolation:{escapeValue:false},returnNull:false});
export function t(key,values={}){
 if(!instance.exists(key,values))throw Error('Missing message key: '+key);
 const parameters=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,k==='count'?v:String(v)]));
 return instance.t(key,parameters);
}
// Keep error classification independent of rendered wording.
export function messageError(key,values={}){const error=new Error(t(key,values));error.messageKey=key;return error;}
export function messageExists(key){return instance.exists(key);}
export const messages=resources;
