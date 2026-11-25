import {t} from './i18n.mjs';
import {accountFetch} from './auth-session.mjs';
import {initializeStorageConsent} from './browser-storage-consent.mjs';
import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,emptyProgress} from './progress.mjs';
import {RECENT_QUIZZES_KEY,STATISTICS_CONSENT_KEY,RECENT_QUIZ_LIMIT,emptyHistories,parseLegacy,validateQuiz,replayHistory} from './statistics-history.mjs';
export class StatisticsStore{
 constructor({storage,request=accountFetch,changed=()=>{}}={}){
  this.storage=storage;this.request=request;this.changed=changed;this.owner='guest';this.enabled=true;this.account=false;this.histories=emptyHistories();this.server=emptyHistories();this.records=[];this.message='';this.consent=null;this.generation=0;this.syncing=null;
  this.stream=crypto.randomUUID();this.sequence=0;
  try{const value=storage?.getItem(STATISTICS_CONSENT_KEY);if(['allow','decline'].includes(value))this.consent=value;}catch{}
  if(this.consent==='allow')this.loadCache();
  this.rebuild();
 }
 notify(message){if(message)this.message=message;this.changed(this);}
 loadCache(){
  try{const cache=JSON.parse(this.storage.getItem(RECENT_QUIZZES_KEY)||'[]');if(!Array.isArray(cache))throw Error();
   this.records=cache.slice(-RECENT_QUIZ_LIMIT).map(r=>{if(typeof r.owner!=='string')throw Error();return {owner:r.owner,event:validateQuiz(r.event,{requireCursor:true}),pending:r.pending===true,stored:r.stored===true};});
  }catch{this.message=t("statistics-client:recent_browser_statistics_could_not_be_read_older_brows_85957b89");}
 }
 persist(){
  if(this.consent!=='allow')return;
  try{
   const prior=JSON.parse(this.storage.getItem(RECENT_QUIZZES_KEY)||'[]'),merged=new Map();
   if(Array.isArray(prior))for(const row of prior.slice(-RECENT_QUIZ_LIMIT))try{validateQuiz(row.event);if(typeof row.owner==='string')merged.set(row.event.id,row);}catch{}
   for(const row of this.records){const old=merged.get(row.event.id);merged.set(row.event.id,old?.stored?{...row,stored:true,pending:false}:row);}
   const latest=[...merged.values()].sort((a,b)=>a.event.finishedAt.localeCompare(b.event.finishedAt)||a.event.id.localeCompare(b.event.id)).slice(-RECENT_QUIZ_LIMIT);
   this.storage.setItem(RECENT_QUIZZES_KEY,JSON.stringify(latest));
  }
  catch{this.message=t("statistics-client:browser_storage_is_unavailable_new_results_remain_in_me_b33edd06");}
 }
 send(url,options={},owner=this.owner){return this.request(url,{...options,headers:{...options.headers,...(owner!=='guest'?{'x-statistics-account':owner}:{})}});}
 query(){return this.request('/api/statistics');}
 acknowledge(result){for(const row of this.records)if(row.pending&&row.owner===result.userId&&(result.cursors?.[row.event.stream]||0)>=row.event.sequence){row.stored=true;row.pending=false;}this.persist();}
 chooseConsent(value){
  this.consent=value;
  try{this.storage?.setItem(STATISTICS_CONSENT_KEY,value);if(value==='decline')this.storage?.removeItem(RECENT_QUIZZES_KEY);}catch{}
  if(value==='allow'){this.persist();}this.notify();
 }
 rebuild(){
  this.histories=this.account?replayHistory(this.records.filter(r=>r.owner===this.owner&&!r.stored).map(r=>r.event),this.server):replayHistory(this.records.filter(r=>r.owner==='guest').slice(-RECENT_QUIZ_LIMIT).map(r=>r.event));
  this.notify();
 }
 async refresh(){
  const generation=++this.generation;
  try{
   const response=await this.query();
   if(generation!==this.generation)return;
   if(response.status===401){this.account=false;this.owner='guest';this.server=emptyHistories();this.rebuild();return;}
   if(!response.ok)throw Error();
   const result=await response.json();if(generation!==this.generation)return;
   this.account=true;this.owner=result.userId;this.enabled=result.enabled;this.server=parseLegacy(result.histories);this.imported=result.imported;this.acknowledge(result);this.rebuild();
   const prior=this.syncing;if(prior)await prior;
   if(generation===this.generation)await this.sync();
  }catch{if(generation===this.generation)this.notify(t("statistics-client:account_statistics_could_not_load_recent_results_and_un_fec3ed3b"));}
 }
 record(event,owner=this.owner){
  if(!event||owner!==this.owner){if(event)this.notify(t("statistics-client:the_account_changed_during_this_quiz_so_its_result_was_a1261d16"));return;}
  if(this.records.some(r=>r.event.id===event.id))return;
  event=validateQuiz({...event,stream:this.stream,sequence:++this.sequence},{requireCursor:true});
  this.records.push({owner,event,pending:this.account&&this.enabled,stored:false});
  // Never silently evict unsent results from memory. Only five are persisted;
  // extra offline results need this tab to remain open until synchronization.
  const pending=this.records.filter(r=>r.pending&&r.owner===owner);
  this.records=this.records.filter(r=>pending.includes(r)||this.records.slice(-RECENT_QUIZ_LIMIT).includes(r));
  this.persist();
  if(this.account){this.histories=replayHistory([event],this.histories);this.notify();void this.sync();}
  else this.rebuild();
  if(pending.length>RECENT_QUIZ_LIMIT)this.notify(t("statistics-client:more_than_five_quizzes_are_waiting_to_upload_keep_this_12f386ba"));
 }
 async sync(){
  if(this.syncing)return this.syncing;
  const owner=this.owner,generation=this.generation;
  let failed=false;
  this.syncing=(async()=>{
   if(!this.account)return;
   for(const row of this.records.filter(r=>r.owner===owner&&r.pending).sort((a,b)=>a.event.stream.localeCompare(b.event.stream)||a.event.sequence-b.event.sequence)){
    if(this.owner!==owner||this.generation!==generation)return;
    const response=await this.send('/api/statistics/quiz',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(row.event)},owner);
    if(!response.ok)throw Error();const result=await response.json();if(!result.stored){row.pending=false;this.persist();this.notify(t("statistics-client:historical_storage_is_off_this_quiz_remains_in_recent_b_ece514b5"));continue;}
    row.pending=false;row.stored=true;this.persist();
   }
   if(this.owner!==owner||this.generation!==generation)return;
   const response=await this.query();if(!response.ok)throw Error();const result=await response.json();if(result.userId!==owner)throw Error();
   if(this.owner!==owner||this.generation!==generation)return;
   this.server=parseLegacy(result.histories);this.enabled=result.enabled;this.acknowledge(result);
   const unarchived=this.records.filter(r=>r.owner===owner&&!r.stored).map(r=>r.event);
   this.histories=replayHistory(unarchived,this.server);this.notify(t("statistics-client:account_statistics_synchronized_the_browser_keeps_at_mo_95ecbeba"));
  })().catch(()=>{failed=true;this.notify(t("statistics-client:statistics_have_not_synchronized_keep_this_tab_open_and_e254f926"));}).finally(()=>{this.syncing=null;if(!failed&&this.account&&this.enabled&&this.records.some(r=>r.owner===this.owner&&r.pending))queueMicrotask(()=>this.sync());});
  return this.syncing;
 }
 async setEnabled(enabled){
  if(!this.account)throw Error(t("statistics-client:sign_in_first_1ba0ae88"));
  const response=await this.send('/api/statistics/preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled})});
  if(!response.ok)throw Error(t("statistics-client:the_preference_could_not_be_saved_please_retry_ee1e8e4e"));
  this.enabled=enabled;
  if(!enabled)for(const row of this.records)if(row.owner===this.owner)row.pending=false;
  this.persist();this.notify(enabled?t("statistics-client:new_completed_quizzes_will_be_saved_to_your_account_ecc6d5c8"):t("statistics-client:new_quizzes_will_not_be_saved_to_your_account_existing_a6663d9a"));
 }
 legacy(){const raw={photo:JSON.parse(this.storage.getItem(PROGRESS_KEY)||'null')||emptyProgress(),audio:JSON.parse(this.storage.getItem(AUDIO_PROGRESS_KEY)||'null')||emptyProgress()};parseLegacy(raw);return raw;}
 async importLegacy(){
  if(!this.account)throw Error(t("statistics-client:sign_in_first_1ba0ae88"));
  if(!this.enabled)throw Error(t("statistics-client:turn_on_historical_statistics_storage_before_importing_cda778fb"));
  const original=[this.storage.getItem(PROGRESS_KEY),this.storage.getItem(AUDIO_PROGRESS_KEY)],snapshot=this.legacy();
  if(!Object.keys(snapshot.photo.species).length&&!Object.keys(snapshot.audio.species).length)throw Error(t("statistics-client:no_older_browser_statistics_were_found_to_import_c2100cd6"));
  const response=await this.send('/api/statistics/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)}),result=await response.json();
  if(!response.ok||!result.imported)throw Error(result.error||t("statistics-client:import_failed_browser_history_was_kept_7be8828b"));
  // Only remove the acknowledged bytes; another tab may still have an older app.
  for(const [i,key] of [PROGRESS_KEY,AUDIO_PROGRESS_KEY].entries())if(this.storage.getItem(key)===original[i])this.storage.removeItem(key);
  await this.refresh();this.notify(t("statistics-client:older_browser_statistics_were_imported_into_your_accoun_0f368611"));
 }
}

export function statisticsControls({changed,request,storage:providedStorage}){
 initializeStorageConsent();
 const $=id=>document.getElementById(id);let storage=providedStorage;try{storage??=localStorage;}catch{}
 const store=new StatisticsStore({storage,request,changed:s=>{
  $('account-statistics-controls').hidden=!s.account;$('save-account-statistics').checked=s.enabled;$('statistics-sync-status').textContent=s.message;
  $('statistics-history-scope').textContent=s.account?t("statistics-client:showing_cumulative_account_statistics_plus_any_unsaved_f1e011a9"):t("statistics-client:full_historical_statistics_are_available_only_to_signed_7f4762ce");
  changed(s);
 }});
 const open=id=>{if(!$(id).open)$(id).showModal();};
 $('statistics-browser-settings').addEventListener('click',()=>open('statistics-consent'));
 $('statistics-history-help').addEventListener('click',()=>open('statistics-history-details'));
 window.addEventListener('aviquiz-statistics-consent',event=>store.chooseConsent(event.detail));
 $('save-account-statistics').addEventListener('change',async()=>{
  const control=$('save-account-statistics');control.disabled=true;
  try{await store.setEnabled(control.checked);}catch(error){control.checked=store.enabled;store.notify(error.message);}finally{control.disabled=false;}
 });
 $('import-browser-history').addEventListener('click',()=>open('statistics-import-confirmation'));
 $('confirm-statistics-import').addEventListener('click',async()=>{
  const control=$('confirm-statistics-import');control.disabled=true;
  try{await store.importLegacy();$('statistics-import-confirmation').close();}catch(error){store.notify(error.message);$('statistics-import-error').textContent=error.message;}finally{control.disabled=false;}
 });
 $('statistics-retry-sync').addEventListener('click',()=>store.refresh());
 window.addEventListener('online',()=>store.refresh());
 window.addEventListener('aviquiz-account-changed',()=>store.refresh());
 window.addEventListener('storage',event=>{if(event.key===STATISTICS_CONSENT_KEY){store.consent=event.newValue==='allow'?'allow':'decline';}if([RECENT_QUIZZES_KEY,STATISTICS_CONSENT_KEY].includes(event.key))store.notify(t("statistics-client:browser_history_changed_in_another_tab_refresh_this_pag_5591df42"));});
 store.notify();void store.refresh();return store;
}
