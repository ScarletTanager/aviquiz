import {t} from './i18n.mjs';
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
  if(value?.version===2){const parsed=parseAggregateProgress(value);if(!same(value,parsed))throw Error(t("browser-backup:the_file_contains_unsupported_aggregate_statistics_72985024"));return parsed;}
  if(!object(value)||value.version!==1||!object(value.species))throw Error(t("browser-backup:the_file_contains_invalid_quiz_history_315dbc19"));
  const parsed=parseProgress(JSON.stringify(value));
  if(!same(value,parsed))throw Error(t("browser-backup:the_file_contains_unsupported_or_invalid_quiz_history_55144ad3"));
  return parsed;
}
function validatePhotos(value){
  if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!/^\d+$/.test(id)))throw Error(t("browser-backup:the_file_contains_invalid_photo_review_marks_ccb2084c"));
  return [...new Set(value)];
}
export function parseBackup(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw Error(t("browser-backup:choose_an_aviquiz_backup_smaller_than_5_mb_40148042"));
  let backup;
  try{backup=JSON.parse(text);}catch{throw Error(t("browser-backup:this_file_is_not_valid_json_choose_an_aviquiz_export_6c5b8102"));}
  if(backup?.app!=='AviQuiz'||backup.version!==1)throw Error(t("browser-backup:this_is_not_a_supported_aviquiz_backup_6241ff2d"));
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
    return species.length+t("browser-backup:species_with_c11eeb0b")+species.reduce((sum,row)=>sum+row.attempts.length,0)+t("browser-backup:saved_answers_b1b0b7ed");
  };
  return t("browser-backup:visual_65ee1508")+describe(backup.photo)+t("browser-backup:audio_8adb1903")+describe(backup.audio)+'. '+backup.reviewedPhotos.length+t("browser-backup:photos_marked_reviewed_08e348ee");
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
  if(!object(previous)||keys.some(key=>previous[key]!==null&&typeof previous[key]!=='string'))throw Error(t("browser-backup:saved_data_recovery_is_incomplete_0b4b49fe"));
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
    try{restore(storage,previous);}catch{throw Error(t("browser-backup:import_stopped_reload_aviquiz_to_recover_your_previous_47e53acf"));}
    throw Error(t("browser-backup:import_could_not_be_saved_your_previous_data_was_restor_0900a897"));
  }
}
