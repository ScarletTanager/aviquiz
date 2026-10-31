import {eligibleBirds} from './quiz.mjs';

export const PROGRESS_KEY='colombia-field-quiz:progress:v1';
export const AUDIO_PROGRESS_KEY='colombia-field-quiz:audio-progress:v1';
export const progressKey=medium=>medium==='audio'?AUDIO_PROGRESS_KEY:PROGRESS_KEY;
export const RECENT_ATTEMPTS=20;
export const emptyProgress=()=>({version:1,species:{}});
export function parseProgress(serialized){
  if(!serialized)return emptyProgress();
  const source=JSON.parse(serialized),result=emptyProgress();
  if(source?.version!==1||!source.species||typeof source.species!=='object')return result;
  for(const [id,value] of Object.entries(source.species)){
    if(!/^[a-z0-9]+$/i.test(id)||!Array.isArray(value?.attempts))continue;
    const attempts=value.attempts.filter(x=>typeof x==='boolean').slice(-RECENT_ATTEMPTS);
    if(attempts.length)result.species[id]={attempts};
  }
  return result;
}
export function recordAttempt(progress,speciesId,correct){
  const attempts=[...(progress.species[speciesId]?.attempts||[]),Boolean(correct)].slice(-RECENT_ATTEMPTS);
  return {version:1,species:{...progress.species,[speciesId]:{attempts}}};
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
