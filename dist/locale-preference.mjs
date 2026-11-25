export const LANGUAGE_COOKIE='aviquiz-language';
export const supportedLocales=['en','es-CO'];
export const normalizeLocale=value=>supportedLocales.includes(value)?value:'en';
export function cookieLocale(cookie=''){
 const value=cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(LANGUAGE_COOKIE+'='))?.slice(LANGUAGE_COOKIE.length+1);
 return normalizeLocale(value);
}
export function requestLocale(request){
 return cookieLocale(request.headers.get('cookie')||'');
}
