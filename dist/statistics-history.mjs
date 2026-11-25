import {t} from './i18n.mjs';
// Aggregate-only personal practice history. No question log or quiz archive.
import {emptyProgress,parseProgress} from './progress.mjs';
export const RECENT_QUIZZES_KEY='aviquiz:recent-statistics:v1';
export const STATISTICS_CONSENT_KEY='aviquiz:statistics-consent:v1';
export const RECENT_QUIZ_LIMIT=5;
export const emptyAggregate=()=>({version:2,species:{},quizzes:0});
export const emptyHistories=()=>({photo:emptyAggregate(),audio:emptyAggregate()});
const id=v=>typeof v==='string'&&/^[a-z0-9]{1,100}$/i.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
const summaryFields=['site','family','mode','filter','questions','scored','correct','species','eligibleSpecies'];
function cleanSummary(value){validateSummary(value);return {...Object.fromEntries(summaryFields.map(k=>[k,value[k]])),...(value.completedAt?{completedAt:value.completedAt}:{})};}
function comparisons(value){return Object.fromEntries(Object.entries(value||{}).map(([scope,rows])=>[scope,Object.fromEntries(Object.entries(rows).map(([id,row])=>[id,cleanSummary(row)]))]));}
function records(source,legacy=false){
 if(!source||typeof source!=='object'||Array.isArray(source))throw Error(t("statistics-history:invalid_species_totals_f43292b5"));
 const result={};
 for(const [key,row] of Object.entries(source)){
  if(!id(key)||!row||!Array.isArray(row.attempts)||row.attempts.length>20||row.attempts.some(a=>typeof a!=='boolean'))throw Error(t("statistics-history:invalid_recent_review_state_f1e0d0a1"));
  const total=legacy?row.attempts.length:row.total,correct=legacy?row.attempts.filter(Boolean).length:row.correct;
  if(!count(total)||!count(correct)||correct>total||row.attempts.length>total)throw Error(t("statistics-history:invalid_statistics_totals_1220917d"));
  result[key]={total,correct,attempts:[...row.attempts]};
 }
 return result;
}
export function parseAggregateProgress(value){
 if(!value||value.version!==2||!count(value.quizzes))throw Error(t("statistics-history:invalid_aggregate_history_a0ed2d77"));
 const result={version:2,species:records(value.species),quizzes:value.quizzes};
 if(value.siteSpecies){result.siteSpecies={};for(const [site,rows] of Object.entries(value.siteSpecies)){if(!id(site)||site==='all')throw Error(t("statistics-history:invalid_site_893b8f7b"));result.siteSpecies[site]=records(rows);}}
 if(value.latestQuizzes)result.latestQuizzes=comparisons(parseProgress(JSON.stringify({version:1,species:{},latestQuizzes:value.latestQuizzes})).latestQuizzes);
 if(value.latestOverall)result.latestOverall=cleanSummary(value.latestOverall);
 return result;
}
export function parseLegacy(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['photo','audio'].includes(k)))throw Error(t("statistics-history:invalid_historical_snapshot_b13ea318"));
 return Object.fromEntries(['photo','audio'].map(m=>{
  const source=value[m]||emptyProgress();if(source.version===2)return [m,parseAggregateProgress(source)];
  if(source.version!==1||!source.species||Array.isArray(source.species))throw Error(t("statistics-history:invalid_historical_format_b2b0e39d"));
  const parsed=parseProgress(JSON.stringify(source)),result={version:2,species:records(parsed.species,true),quizzes:0};
  if(parsed.siteSpecies)result.siteSpecies=Object.fromEntries(Object.entries(parsed.siteSpecies).map(([s,r])=>[s,records(r,true)]));
  if(parsed.latestQuizzes)result.latestQuizzes=comparisons(parsed.latestQuizzes);
  return [m,result];
 }));
}
function validateSummary(s){
 if(!s||!id(s.site)||typeof s.family!=='string'||!s.family||s.family.length>100||!['regular','review'].includes(s.mode)||!['none','world','colombia'].includes(s.filter))throw Error(t("statistics-history:invalid_quiz_scope_02d57ef6"));
 if(![s.questions,s.scored,s.correct,s.species,s.eligibleSpecies].every(count)||s.questions<1||s.questions>10000||s.correct>s.scored||s.scored>s.questions||s.species<1||s.species>s.questions||s.species>s.eligibleSpecies||s.eligibleSpecies>20000)throw Error(t("statistics-history:invalid_comparison_result_0ce8e2b4"));
 if(s.completedAt&&new Date(s.completedAt).toISOString()!==s.completedAt)throw Error(t("statistics-history:invalid_completion_time_d32b46ff"));
}
export function validateQuiz(value,{requireCursor=false}={}){
 if(!value||!/^[-a-z0-9]{16,80}$/i.test(value.id)||!['photo','audio'].includes(value.medium)||typeof value.finishedAt!=='string'||new Date(value.finishedAt).toISOString()!==value.finishedAt)throw Error(t("statistics-history:invalid_statistics_identity_64b9fe3c"));
 validateSummary(value.summary);const species=records(value.species);
 if(Object.keys(species).length!==value.summary.species||Object.values(species).reduce((s,r)=>s+r.total,0)!==value.summary.scored||Object.values(species).reduce((s,r)=>s+r.correct,0)!==value.summary.correct)throw Error(t("statistics-history:inconsistent_contribution_76977f9e"));
 const result={id:value.id,medium:value.medium,finishedAt:value.finishedAt,summary:cleanSummary(value.summary),species};
 result.summary.completedAt=value.finishedAt;
 if(requireCursor||value.stream!==undefined){
  if(!/^[-a-z0-9]{16,80}$/i.test(value.stream)||!Number.isSafeInteger(value.sequence)||value.sequence<1)throw Error(t("statistics-history:invalid_synchronization_cursor_223e8efd"));
  result.stream=value.stream;result.sequence=value.sequence;
 }
 return result;
}
export function quizEvent(settings,answers,id,finishedAt=new Date().toISOString()){
 if(settings.route||settings.experimentalTips||settings.pilotTips||!['regular','review'].includes(settings.mode))return null;
 const species={};let scored=0,correct=0;
 for(const a of answers){const r=Object.hasOwn(species,a.bird.id)?species[a.bird.id]:(species[a.bird.id]={total:0,correct:0,attempts:[]});if(a.unavailable)continue;r.total++;r.correct+=a.correct?1:0;r.attempts.push(Boolean(a.correct));r.attempts=r.attempts.slice(-20);scored++;correct+=a.correct?1:0;}
 return validateQuiz({id,medium:settings.medium,finishedAt,species,summary:{site:settings.site,family:settings.family,mode:settings.mode,filter:settings.filter||'none',questions:answers.length,scored,correct,species:Object.keys(species).length,eligibleSpecies:settings.eligibleSpecies}});
}
function addRecords(a,b){
 const result={...a};for(const [key,row] of Object.entries(b)){const old=Object.hasOwn(a||{},key)?a[key]:{total:0,correct:0,attempts:[]};const total=old.total+row.total,correct=old.correct+row.correct;if(!count(total)||!count(correct))throw Error(t("statistics-history:statistics_capacity_exceeded_86cfcd46"));result[key]={total,correct,attempts:[...old.attempts,...row.attempts].slice(-20)};}return result;
}
export function mergeHistories(a,b){
 const left=parseLegacy(a),right=parseLegacy(b),result={};
 for(const m of ['photo','audio']){
  const x=left[m],y=right[m],r={...x,species:addRecords(x.species,y.species),quizzes:x.quizzes+y.quizzes};
  r.siteSpecies={...x.siteSpecies};for(const [s,rows] of Object.entries(y.siteSpecies||{}))r.siteSpecies[s]=addRecords(r.siteSpecies[s]||{},rows);
  r.latestQuizzes={};for(const scope of ['sites','siteOnly','families'])r.latestQuizzes[scope]={...x.latestQuizzes?.[scope],...y.latestQuizzes?.[scope]};
  if(y.latestOverall)r.latestOverall=y.latestOverall;result[m]=r;
 }
 return result;
}
export function replayQuiz(histories,value){
 const q=validateQuiz(value),result=parseLegacy(histories),p=result[q.medium],s=q.summary;
 p.species=addRecords(p.species,q.species);p.quizzes++;
 if(s.site!=='all'&&s.family==='all')p.siteSpecies={...p.siteSpecies,[s.site]:addRecords(p.siteSpecies?.[s.site]||{},q.species)};
 const latest={...p.latestQuizzes},newer=old=>!old?.completedAt||s.completedAt>=old.completedAt;
 if(s.site!=='all'){if(newer(latest.sites?.[s.site]))latest.sites={...latest.sites,[s.site]:s};if(s.family==='all'&&newer(latest.siteOnly?.[s.site]))latest.siteOnly={...latest.siteOnly,[s.site]:s};}
 if(s.family!=='all'&&newer(latest.families?.[s.family]))latest.families={...latest.families,[s.family]:s};
 p.latestQuizzes=latest;if(newer(p.latestOverall))p.latestOverall=s;return result;
}
export function replayHistory(events,baseline=emptyHistories()){
 let result=parseLegacy(baseline);const seen=new Set();for(const e of [...events].sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt)||a.id.localeCompare(b.id))){if(seen.has(e.id))continue;seen.add(e.id);result=replayQuiz(result,e);}return result;
}
