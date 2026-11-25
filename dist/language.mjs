import {locale,t} from './i18n.mjs';
import {LANGUAGE_COOKIE,normalizeLocale} from './locale-preference.mjs';
export function initializeLanguageSelector(){
 const select=document.getElementById('interface-language');
 if(!select||select.dataset?.initialized)return;
 if(select.dataset)select.dataset.initialized='true';
 select.value=locale;
 let edited=false;
 document.addEventListener('input',event=>{if(event.target!==select)edited=true;});
 document.addEventListener('change',event=>{if(event.target!==select)edited=true;});
 select.addEventListener('change',()=>{
  const language=normalizeLocale(select.value);
  if(language===locale)return;
  const session=document.getElementById('session');
  if((edited||(session&&!session.hidden))&&!window.confirm(t('common:changeLanguageWarning'))){select.value=locale;return;}
  // Functional preference only: does not read, clear, or migrate statistics.
  document.cookie=LANGUAGE_COOKIE+'='+language+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
  location.reload();
 });
}
initializeLanguageSelector();
