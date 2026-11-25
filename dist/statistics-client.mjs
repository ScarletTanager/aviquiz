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
  }catch{this.message='Recent browser statistics could not be read. Older browser history has been preserved.';}
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
  catch{this.message='Browser storage is unavailable. New results remain in memory for this visit.';}
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
  }catch{if(generation===this.generation)this.notify('Account statistics could not load. Recent results and unimported browser history have been kept.');}
 }
 record(event,owner=this.owner){
  if(!event||owner!==this.owner){if(event)this.notify('The account changed during this quiz, so its result was not uploaded.');return;}
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
  if(pending.length>RECENT_QUIZ_LIMIT)this.notify('More than five quizzes are waiting to upload. Keep this tab open and reconnect; only five can survive a reload.');
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
    if(!response.ok)throw Error();const result=await response.json();if(!result.stored){row.pending=false;this.persist();this.notify('Historical storage is off. This quiz remains in recent browser history only.');continue;}
    row.pending=false;row.stored=true;this.persist();
   }
   if(this.owner!==owner||this.generation!==generation)return;
   const response=await this.query();if(!response.ok)throw Error();const result=await response.json();if(result.userId!==owner)throw Error();
   if(this.owner!==owner||this.generation!==generation)return;
   this.server=parseLegacy(result.histories);this.enabled=result.enabled;this.acknowledge(result);
   const unarchived=this.records.filter(r=>r.owner===owner&&!r.stored).map(r=>r.event);
   this.histories=replayHistory(unarchived,this.server);this.notify('Account statistics synchronized. The browser keeps at most five recent quizzes when allowed.');
  })().catch(()=>{failed=true;this.notify('Statistics have not synchronized. Keep this tab open and retry when connected; pending results are retained within the browser limit.');}).finally(()=>{this.syncing=null;if(!failed&&this.account&&this.enabled&&this.records.some(r=>r.owner===this.owner&&r.pending))queueMicrotask(()=>this.sync());});
  return this.syncing;
 }
 async setEnabled(enabled){
  if(!this.account)throw Error('Sign in first.');
  const response=await this.send('/api/statistics/preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled})});
  if(!response.ok)throw Error('The preference could not be saved. Please retry.');
  this.enabled=enabled;
  if(!enabled)for(const row of this.records)if(row.owner===this.owner)row.pending=false;
  this.persist();this.notify(enabled?'New completed quizzes will be saved to your account.':'New quizzes will not be saved to your account. Existing account history is retained.');
 }
 legacy(){const raw={photo:JSON.parse(this.storage.getItem(PROGRESS_KEY)||'null')||emptyProgress(),audio:JSON.parse(this.storage.getItem(AUDIO_PROGRESS_KEY)||'null')||emptyProgress()};parseLegacy(raw);return raw;}
 async importLegacy(){
  if(!this.account)throw Error('Sign in first.');
  if(!this.enabled)throw Error('Turn on historical statistics storage before importing.');
  const original=[this.storage.getItem(PROGRESS_KEY),this.storage.getItem(AUDIO_PROGRESS_KEY)],snapshot=this.legacy();
  if(!Object.keys(snapshot.photo.species).length&&!Object.keys(snapshot.audio.species).length)throw Error('No older browser statistics were found to import.');
  const response=await this.send('/api/statistics/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)}),result=await response.json();
  if(!response.ok||!result.imported)throw Error(result.error||'Import failed. Browser history was kept.');
  // Only remove the acknowledged bytes; another tab may still have an older app.
  for(const [i,key] of [PROGRESS_KEY,AUDIO_PROGRESS_KEY].entries())if(this.storage.getItem(key)===original[i])this.storage.removeItem(key);
  await this.refresh();this.notify('Older browser statistics were imported into your account. They contain rolling answers and latest results, not dated quiz sessions.');
 }
}

export function statisticsControls({changed,request,storage:providedStorage}){
 initializeStorageConsent();
 const $=id=>document.getElementById(id);let storage=providedStorage;try{storage??=localStorage;}catch{}
 const store=new StatisticsStore({storage,request,changed:s=>{
  $('account-statistics-controls').hidden=!s.account;$('save-account-statistics').checked=s.enabled;$('statistics-sync-status').textContent=s.message;
  $('statistics-history-scope').textContent=s.account?'Showing cumulative account statistics, plus any unsaved recent practice from this device. Latest results provide a comparison point.':'Full historical statistics are available only to signed-in users. Guest statistics aggregate the most recent five quizzes; without browser storage they last only for this visit.';
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
 window.addEventListener('storage',event=>{if(event.key===STATISTICS_CONSENT_KEY){store.consent=event.newValue==='allow'?'allow':'decline';}if([RECENT_QUIZZES_KEY,STATISTICS_CONSENT_KEY].includes(event.key))store.notify('Browser history changed in another tab. Refresh this page when your quiz is finished.');});
 store.notify();void store.refresh();return store;
}
