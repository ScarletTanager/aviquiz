import i18next from './i18next.mjs';
import resources from './messages-en.mjs';
import spanish from './messages-es-CO.mjs';
import {normalizeLocale} from './locale-preference.mjs';
// The server renders the explicit cookie preference. No browser-language detection.
// Server imports have no document and always use English; response localization is request-scoped.
export const locale=normalizeLocale(typeof document==='undefined'?'en':document.documentElement?.lang);
export const resourcesFor=language=>language==='es-CO'?spanish:resources;
const instance=i18next.createInstance();
instance.init({lng:locale,fallbackLng:"en",supportedLngs:['en','es-CO'],resources:{en:resources,'es-CO':spanish},ns:Object.keys(resources),defaultNS:'common',keySeparator:false,initAsync:false,interpolation:{escapeValue:false},returnNull:false});
export function t(key,values={}){
 if(!instance.exists(key,values))throw Error('Missing message key: '+key);
 const parameters=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,k==='count'?v:String(v)]));
 return instance.t(key,parameters);
}
// Keep error classification independent of rendered wording.
export function messageError(key,values={}){const error=new Error(t(key,values));error.messageKey=key;return error;}
export function messageExists(key){return instance.exists(key);}
export const messages=resources;
