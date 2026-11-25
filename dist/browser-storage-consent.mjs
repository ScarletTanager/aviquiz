import {STATISTICS_CONSENT_KEY,RECENT_QUIZZES_KEY} from './statistics-history.mjs';
const $=id=>document.getElementById(id);
const initialized=new WeakSet();
export function initializeStorageConsent(){
 const dialog=typeof document==='undefined'?null:$('statistics-consent');
 if(!dialog||initialized.has(dialog))return;
 initialized.add(dialog);
 const choose=value=>{
  try{localStorage.setItem(STATISTICS_CONSENT_KEY,value);if(value==='decline')localStorage.removeItem(RECENT_QUIZZES_KEY);}catch{}
  dialog.close();window.dispatchEvent(new CustomEvent('aviquiz-statistics-consent',{detail:value}));
 };
 $('statistics-allow').addEventListener('click',()=>choose('allow'));
 $('statistics-decline').addEventListener('click',()=>choose('decline'));
 dialog.addEventListener('cancel',event=>{event.preventDefault();choose('decline');});
 $('statistics-storage-details').addEventListener('click',()=>{if(!$('statistics-details').open)$('statistics-details').showModal();});
 let choice;try{choice=localStorage.getItem(STATISTICS_CONSENT_KEY);}catch{}
 if(!['allow','decline'].includes(choice)&&!dialog.open)dialog.showModal();
}
initializeStorageConsent();
