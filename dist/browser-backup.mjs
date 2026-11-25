import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,emptyProgress,parseProgress} from './progress.mjs';
import {ANNOTATION_REVIEW_KEY} from './annotation-review.mjs';
import {parseAggregateProgress} from './statistics-history.mjs';

export const MAX_BACKUP_BYTES=5*1024*1024;
const RECOVERY_KEY='aviquiz:import-recovery:v1';
const keys=[PROGRESS_KEY,AUDIO_PROGRESS_KEY,ANNOTATION_REVIEW_KEY];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(!object(value))return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
function same(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function validateProgress(value){
  if(value?.version===2){const parsed=parseAggregateProgress(value);if(!same(value,parsed))throw Error('The file contains unsupported aggregate statistics.');return parsed;}
  if(!object(value)||value.version!==1||!object(value.species))throw Error('The file contains invalid quiz history.');
  const parsed=parseProgress(JSON.stringify(value));
  if(!same(value,parsed))throw Error('The file contains unsupported or invalid quiz history.');
  return parsed;
}
function validatePhotos(value){
  if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!/^\d+$/.test(id)))throw Error('The file contains invalid photo review marks.');
  return [...new Set(value)];
}
export function parseBackup(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw Error('Choose an AviQuiz backup smaller than 5 MB.');
  let backup;
  try{backup=JSON.parse(text);}catch{throw Error('This file is not valid JSON. Choose an AviQuiz export.');}
  if(backup?.app!=='AviQuiz'||backup.version!==1)throw Error('This is not a supported AviQuiz backup.');
  return {...backup,photo:validateProgress(backup.photo),audio:validateProgress(backup.audio),
    reviewedPhotos:validatePhotos(backup.reviewedPhotos)};
}
export function createBackup(storage,sourceOrigin){
  recoverImport(storage);
  return {app:'AviQuiz',version:1,exportedAt:new Date().toISOString(),sourceOrigin,
    photo:validateProgress(JSON.parse(storage.getItem(PROGRESS_KEY)||JSON.stringify(emptyProgress()))),
    audio:validateProgress(JSON.parse(storage.getItem(AUDIO_PROGRESS_KEY)||JSON.stringify(emptyProgress()))),
    reviewedPhotos:validatePhotos(JSON.parse(storage.getItem(ANNOTATION_REVIEW_KEY)||'[]'))};
}
export function backupSummary(backup){
  const describe=history=>{
    const species=Object.values(history.species);
    return species.length+' species with '+species.reduce((sum,row)=>sum+row.attempts.length,0)+' saved answers';
  };
  return 'Visual — '+describe(backup.photo)+'. Audio — '+describe(backup.audio)+'. '+backup.reviewedPhotos.length+' photos marked reviewed.';
}
function restore(storage,previous){
  for(const key of keys){
    if(previous[key]===null)storage.removeItem(key);
    else storage.setItem(key,previous[key]);
  }
  storage.removeItem(RECOVERY_KEY);
}
export function recoverImport(storage){
  const raw=storage.getItem(RECOVERY_KEY);
  if(!raw)return;
  const previous=JSON.parse(raw);
  if(!object(previous)||keys.some(key=>previous[key]!==null&&typeof previous[key]!=='string'))throw Error('Saved data recovery is incomplete.');
  restore(storage,previous);
}
export function importBackup(storage,backup){
  const valid=parseBackup(JSON.stringify(backup));
  recoverImport(storage);
  const previous=Object.fromEntries(keys.map(key=>[key,storage.getItem(key)]));
  // Save the old values first so an interrupted write can be rolled back on reload.
  storage.setItem(RECOVERY_KEY,JSON.stringify(previous));
  try{
    storage.setItem(PROGRESS_KEY,JSON.stringify(valid.photo));
    storage.setItem(AUDIO_PROGRESS_KEY,JSON.stringify(valid.audio));
    storage.setItem(ANNOTATION_REVIEW_KEY,JSON.stringify(valid.reviewedPhotos));
    storage.removeItem(RECOVERY_KEY);
  }catch{
    try{restore(storage,previous);}catch{throw Error('Import stopped. Reload AviQuiz to recover your previous data before taking another quiz.');}
    throw Error('Import could not be saved. Your previous data was restored. Check browser storage and try again.');
  }
}
