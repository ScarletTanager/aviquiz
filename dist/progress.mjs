import {eligibleBirds} from './quiz.mjs';

export const PROGRESS_KEY='colombia-field-quiz:progress:v1';
export const AUDIO_PROGRESS_KEY='colombia-field-quiz:audio-progress:v1';
export const progressKey=medium=>medium==='audio'?AUDIO_PROGRESS_KEY:PROGRESS_KEY;
export const RECENT_ATTEMPTS=20;
export const emptyProgress=()=>({version:1,species:{}});
const validId=id=>typeof id==='string'&&/^[a-z0-9]+$/i.test(id);
const scopedSite=site=>validId(site)&&site!=='all';
const scopedFamily=family=>typeof family==='string'&&family.length>0&&family!=='all';
const latestQuizScopes=['sites','siteOnly','families'];
function validQuizResult(result){
  if(!result||!validId(result.site)||typeof result.family!=='string'||!result.family||
     !['regular','review'].includes(result.mode)||!['none','world','colombia'].includes(result.filter))return false;
  const {questions,scored,correct,species,eligibleSpecies}=result;
  return [questions,scored,correct,species,eligibleSpecies].every(Number.isSafeInteger)&&
    questions>0&&correct>=0&&correct<=scored&&scored<=questions&&species>0&&species<=questions&&species<=eligibleSpecies;
}
function parseRecords(source){
  const records={};
  if(!source||typeof source!=='object'||Array.isArray(source))return records;
  for(const [id,value] of Object.entries(source)){
    if(!validId(id)||!Array.isArray(value?.attempts))continue;
    const attempts=value.attempts.filter(x=>typeof x==='boolean').slice(-RECENT_ATTEMPTS);
    if(attempts.length)records[id]={attempts};
  }
  return records;
}
export function parseProgress(serialized){
  if(!serialized)return emptyProgress();
  const source=JSON.parse(serialized),result=emptyProgress();
  if(source?.version!==1||!source.species||typeof source.species!=='object')return result;
  result.species=parseRecords(source.species);
  if(source.siteSpecies&&typeof source.siteSpecies==='object'&&!Array.isArray(source.siteSpecies)){
    result.siteSpecies={};
    for(const [site,records] of Object.entries(source.siteSpecies)){
      if(validId(site)&&site!=='all')result.siteSpecies[site]=parseRecords(records);
    }
  }
  if(source.latestQuizzes&&typeof source.latestQuizzes==='object'){
    result.latestQuizzes={};
    for(const scope of latestQuizScopes){
      const records=source.latestQuizzes[scope];
      if(!records||typeof records!=='object'||Array.isArray(records))continue;
      result.latestQuizzes[scope]=Object.fromEntries(Object.entries(records).filter(([id,quiz])=>{
        if(!validQuizResult(quiz))return false;
        return scope==='families'?scopedFamily(id)&&quiz.family===id:
          scopedSite(id)&&quiz.site===id&&(scope!=='siteOnly'||quiz.family==='all');
      }));
    }
  }
  return result;
}
export function recordAttempt(progress,speciesId,correct,context={}){
  if(context.experimentalTips||context.mode==='annotations')return progress;
  const attempts=[...(progress.species[speciesId]?.attempts||[]),Boolean(correct)].slice(-RECENT_ATTEMPTS);
  const result={...progress,version:1,species:{...progress.species,[speciesId]:{attempts}}};
  if(scopedSite(context.site)&&context.family==='all'&&['regular','review'].includes(context.mode||'regular')&&!context.pilotTips){
    const records=progress.siteSpecies?.[context.site]||{};
    result.siteSpecies={...progress.siteSpecies,[context.site]:{...records,[speciesId]:{
      attempts:[...(records[speciesId]?.attempts||[]),Boolean(correct)].slice(-RECENT_ATTEMPTS)
    }}};
  }
  return result;
}
export function recordQuizResult(progress,context,answers,eligibleSpecies){
  const {site,family,mode,filter='none'}=context;
  if(context.route||context.experimentalTips||context.pilotTips||!['regular','review'].includes(mode)||
     (!scopedSite(site)&&!scopedFamily(family)))return progress;
  const scored=answers.filter(answer=>!answer.unavailable);
  const result={site,family,mode,filter,questions:answers.length,scored:scored.length,
    correct:scored.filter(answer=>answer.correct).length,
    species:new Set(answers.map(answer=>answer.bird.id)).size,eligibleSpecies};
  if(!validQuizResult(result))return progress;
  const latestQuizzes={...progress.latestQuizzes};
  if(scopedSite(site)){
    latestQuizzes.sites={...latestQuizzes.sites,[site]:result};
    if(family==='all')latestQuizzes.siteOnly={...latestQuizzes.siteOnly,[site]:result};
  }
  if(scopedFamily(family))latestQuizzes.families={...latestQuizzes.families,[family]:result};
  return {...progress,latestQuizzes};
}
export function mistakeRate(record){
  const attempts=record?.attempts||[];
  return attempts.length?attempts.filter(correct=>!correct).length/attempts.length:0;
}
export function recentMistakeIds(progress){
  return Object.keys(progress.species).filter(id=>mistakeRate(progress.species[id])>0.25);
}
export function sessionMistakeIds(answers){
  return [...new Set(answers.filter(a=>!a.unavailable&&!a.correct).map(a=>a.bird.id))];
}
export function reviewBirds(birds,progress,site='all',family='all',specificIds=null){
  const ids=new Set(specificIds??recentMistakeIds(progress));
  return eligibleBirds(birds,site,'none',family).filter(b=>ids.has(b.id));
}
export function withFreshPhotos(birds,avoidIds=[]){
  const avoid=new Set(avoidIds);
  return birds.map(b=>{const fresh=b.photos.filter(p=>!avoid.has(p.id));return {...b,photos:fresh.length?fresh:b.photos};});
}
