import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {statisticsControls} from './dist/statistics-client.mjs';
import {STATISTICS_CONSENT_KEY,RECENT_QUIZZES_KEY} from './dist/statistics-history.mjs';
import {PROGRESS_KEY,emptyProgress,recordAttempt} from './dist/progress.mjs';
import {statisticsApi} from './worker/statistics-api.mjs';
import {migrateDatabase} from './server/database/migrate.mjs';
import {createDatabase} from './server/database/index.mjs';
import {accountService} from './worker/accounts.mjs';
const html=await fs.readFile('dist/index.html','utf8');
class Element{
 constructor(){this.listeners={};this.open=false;this.hidden=false;this.checked=false;this.disabled=false;this.textContent='';}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
 async fire(type){for(const fn of this.listeners[type]||[])await fn({preventDefault(){}});}
 showModal(){this.open=true;}close(){this.open=false;}
}
const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()])),events={};
const $=id=>elements.get(id);
globalThis.document={getElementById:$};globalThis.window={addEventListener:(type,fn)=>(events[type]??=[]).push(fn),dispatchEvent:e=>{for(const fn of events[e.type]||[])fn(e);}};
const values=new Map([[PROGRESS_KEY,JSON.stringify(recordAttempt(emptyProgress(),'norcar',true))]]);
globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
const root=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-stats-ui-'));let db;
try{
 const config={DB_DRIVER:'sqlite',SQLITE_PATH:path.join(root,'app.sqlite')};await migrateDatabase(config);db=await createDatabase(config);
 const claim={issuer:'https://ui.example',subject:'owner',email:'owner@example.org',emailVerified:true};await accountService(db).registerVerifiedUser(claim);let signedIn=true;
 const request=(url,options={})=>statisticsApi(new Request('https://quiz.example'+url,{...options,headers:{...options.headers,origin:'https://quiz.example'}}),{DB:db,DB_DRIVER:'sqlite'},{verifyIdentity:async()=>signedIn?claim:null});
 const store=statisticsControls({changed(){},request});
 assert.equal($('statistics-consent').open,true);assert.equal(values.has(RECENT_QUIZZES_KEY),false);
 await $('statistics-storage-details').fire('click');assert.equal($('statistics-details').open,true);$('statistics-details').close();
 await $('statistics-decline').fire('click');assert.equal($('statistics-consent').open,false);assert.equal(values.get(STATISTICS_CONSENT_KEY),'decline');assert.ok(values.has(PROGRESS_KEY));
 await store.refresh();assert.equal($('account-statistics-controls').hidden,false);assert.equal($('save-account-statistics').checked,true);
 await $('statistics-history-help').fire('click');assert.equal($('statistics-history-details').open,true);$('statistics-history-details').close();
 $('save-account-statistics').checked=false;await $('save-account-statistics').fire('change');assert.equal(store.enabled,false);
 await $('import-browser-history').fire('click');assert.equal($('statistics-import-confirmation').open,true);
 await $('confirm-statistics-import').fire('click');assert.match($('statistics-import-error').textContent,/Turn on/);assert.ok(values.has(PROGRESS_KEY));
 $('save-account-statistics').checked=true;await $('save-account-statistics').fire('change');await $('confirm-statistics-import').fire('click');
 assert.equal($('statistics-import-confirmation').open,false);assert.equal(values.has(PROGRESS_KEY),false);assert.equal(store.histories.photo.species.norcar.total,1);
 signedIn=false;await store.refresh();assert.equal($('account-statistics-controls').hidden,true);assert.match($('statistics-history-scope').textContent,/only to signed-in/);
 await $('statistics-browser-settings').fire('click');assert.equal($('statistics-consent').open,true);await $('statistics-allow').fire('click');assert.equal(values.get(STATISTICS_CONSENT_KEY),'allow');
 for(const file of ['index.html','explore.html','invite.html','review.html']){const content=await fs.readFile('dist/'+file,'utf8');assert.ok(content.includes('id="statistics-consent"'));assert.ok(content.includes('/browser-storage-consent.mjs'));}
 console.log('Passed first-visit consent/details, settings helper, default-on account switch, login-only import, failed-import preservation, successful import, and guest visibility.');
}finally{await db?.close();await fs.rm(root,{recursive:true,force:true});delete globalThis.document;delete globalThis.window;delete globalThis.localStorage;}
