import {calendarWindowLabel} from './geography-core.mjs';
import {t,locale} from './i18n.mjs';
import {statisticsControls} from './statistics-client.mjs';
import {quizEvent} from './statistics-history.mjs';
import {audioBirds,validateAudioCatalog} from './audio.mjs';
import {offersSiteClue,chooseSiteClue} from './site-clue.mjs';
import {ANNOTATION_REVIEW_KEY,ORIGINAL_REVIEW_PHOTOS,parseReviewedPhotos,unreviewedPhotos} from './annotation-review.mjs';
import {eligibleBirds,gradeAnswer,shuffle,familyName,familyLabel,questionPool,buildQuestions,buildQuestionRounds} from './quiz.mjs';
import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,progressKey,emptyProgress,parseProgress,recordAttempt,recordQuizResult,recentMistakeIds,sessionMistakeIds,reviewBirds,withFreshPhotos} from './progress.mjs';
import {accuracyStatistics,sortAccuracy,speciesAccuracy,listQuizSettings} from './statistics.mjs';
import {ID_TIPS,tipsFor,annotatedBirds,annotationSvg,applySharedTips} from './id-tips.mjs';
import {MAX_BACKUP_BYTES,createBackup,parseBackup,backupSummary,importBackup,recoverImport} from './browser-backup.mjs';
const $=id=>document.getElementById(id);
let routeEditor;
let data,queue=[],index=0,answers=[],answered=false,currentPhoto=null,photoTry=0,imageReady=false,sessionToken=0,photoOrder=[];
let activeSettings=null,audioCatalog={version:1,recordings:{}};
let siteClueEnabled=false,currentSiteClue=null;
const siteOnlyStats=()=>$('site-only-stats').checked;
function renderSiteClue(){
  const available=activeSettings&&!activeSettings.route&&offersSiteClue(activeSettings);
  $('site-clue-control').hidden=!available;
  $('site-clue-toggle').checked=siteClueEnabled;
  $('site-clue').hidden=!available||!siteClueEnabled;
  $('site-clue').textContent=currentSiteClue?t("app:checklist_site_e5568b40", {v0:(currentSiteClue.name)}):t("app:no_named_checklist_site_is_available_for_this_species_cdc6eef5");
}
const histories={photo:emptyProgress(),audio:emptyProgress()},storageUsable={photo:true,audio:true};
let accountStatistics=null;
try{recoverImport(localStorage);}catch{
  storageUsable.photo=false;storageUsable.audio=false;
  $('storage-status').textContent=t("app:saved_data_recovery_could_not_finish_reload_aviquiz_bef_1d102d68");
  $('backup-status').textContent=t("app:browser_storage_could_not_be_recovered_reload_before_im_87248b77");
}
const selectedMedium=()=>$('medium').value;
const statsMedium=()=>$('stats-medium').value;
const mediumName=m=>m==='audio'?t("common:audioMedium"):t("common:visualMedium");
let audioTimer=null,mediaLoadToken=0;
let familiesExpanded=false,sitesExpanded=false;
let speciesScope=null;
let activeTips=null;
let starting=false,hasSharedTips=false,navigationToken=0;
let reviewedPhotos=new Set();
function readReviewedPhotos(){try{reviewedPhotos=parseReviewedPhotos(localStorage.getItem(ANNOTATION_REVIEW_KEY));}catch{}}
function markPhotosReviewed(ids){
  readReviewedPhotos();for(const id of ids)reviewedPhotos.add(String(id));
  try{localStorage.setItem(ANNOTATION_REVIEW_KEY,JSON.stringify([...reviewedPhotos]));$('annotation-review-status').textContent=t("app:personal_review_marks_saved_in_this_browser_937b9db2");}
  catch{$('annotation-review-status').textContent=t("app:browser_storage_is_unavailable_review_marks_last_only_f_ae79e55a");}
}
async function loadSharedTips(){
  try{
    const response=await fetch('/api/annotations',{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!response.ok)throw Error();
    const result=await response.json();applySharedTips(result.annotations);hasSharedTips=true;
    $('shared-tip-status').textContent=t("app:shared_reviews_species_approved_photos_general_text_is_10f25788", {v0:(result.coverage.covered),v1:(result.coverage.approved)});
  }catch{$('shared-tip-status').textContent=hasSharedTips?t("app:shared_reviews_could_not_refresh_using_the_last_loaded_33ab74f3"):t("app:shared_reviews_are_unavailable_the_built_in_six_photo_p_a07adf2f");}
}
const formatRate=rate=>rate===null?'—':new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(rate);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function latestQuizHTML(result,kind){
  const label=t("app:latest_quiz_45cbcae8");
  if(!result)return t("app:no_result_yet_78a46328", {v0:(label)});
  const otherScope=kind==='site'
    ?(result.family==='all'?'':result.family)
    :(result.site==='all'?'':data.sites.find(site=>site.code===result.site)?.name);
  const restriction=result.mode==='review'?t("app:mistake_review_fef619ea"):{world:t("app:worldwide_lifers_7c0e4e9a"),colombia:t("app:colombia_lifers_2f04931f")}[result.filter];
  const scope=[otherScope,restriction].filter(Boolean).map(escapeHTML).join(' · ');
  const rate=result.scored?result.correct/result.scored:null;
  const score=result.scored?t("app:correct_528bba3f", {v0:(result.correct),v1:(result.scored)}):t("app:no_scored_questions_340930ca");
  return t("app:species_shown_d085e1b7", {v0:(label),v1:(formatRate(rate)),v2:(score),v3:(result.questions),v4:(t("common:questionNoun",{count:result.questions})),v5:(result.species),v6:(result.eligibleSpecies),v7:(scope?`<small>${scope}</small>`:'')});
}
function renderStatistics(){
  if(!data)return;
  $('accuracy-title').textContent=t("app:your_id_accuracy_d1afd854", {v0:(mediumName(statsMedium()))});
  $('stats-medium-help').textContent=statsMedium()==='audio'?t("app:audio_history_only_audio_site_rates_do_not_measure_mast_58d48e0b"):t("app:visual_history_only_existing_photo_quiz_history_is_reta_088ac1de");
  $('site-stats-help').textContent=siteOnlyStats()?t("app:site_only_quizzes_answers_from_this_exact_site_with_all_56ec90fb"):t("app:all_quiz_scopes_use_each_target_species_correct_and_att_bb0f16ba");
  const progress=histories[statsMedium()];
  const last=progress.latestOverall;
  $('statistics-latest-summary').textContent=last?t("app:latest_quiz_correct_questions_species_shown_e250b119", {v0:(last.correct),v1:(last.scored),v2:(formatRate(last.scored?last.correct/last.scored:null)),v3:(last.questions),v4:(last.species),v5:(last.eligibleSpecies)}):t("app:latest_quiz_no_comparison_result_yet_61ddad18");
  const stats=accuracyStatistics(data.birds,data.sites,progress,{siteOnly:siteOnlyStats()});
  const rowsHTML=(rows,kind)=>{
    const latest=progress.latestQuizzes?.[kind==='family'?'families':siteOnlyStats()?'siteOnly':'sites'];
    return rows.map(row=>t("app:history_fe18c809", {v0:(statsMedium()),v1:(kind),v2:(encodeURIComponent(row.id)),v3:(kind==='site'&&siteOnlyStats()?'/site-only':''),v4:(escapeHTML(row.name)),v5:(formatRate(row.rate)),v6:(row.total?t("app:correct_528bba3f", {v0:(row.correct),v1:(row.total)}):t("app:no_answers_yet_ded2e1cb")),v7:(latestQuizHTML(latest?.[row.id],kind))})).join('');
  };
  const sites=sortAccuracy(stats.sites,$('site-stat-sort').value,$('site-stat-direction').value);
  $('site-accuracy-list').innerHTML=rowsHTML(sitesExpanded?sites:sites.slice(0,5),'site');
  $('site-expand').hidden=sites.length<=5;
  $('site-expand').setAttribute('aria-expanded',String(sitesExpanded));
  $('site-expand').textContent=sitesExpanded?t("app:show_first_5_sites_93f97be7"):t("app:show_all_sites_0c834c69", {v0:(sites.length)});
  const families=sortAccuracy(stats.families,$('family-stat-sort').value,$('family-stat-direction').value);
  $('family-accuracy-list').innerHTML=rowsHTML(familiesExpanded?families:families.slice(0,10),'family');
  $('family-expand').hidden=families.length<=10;
  $('family-expand').setAttribute('aria-expanded',String(familiesExpanded));
  $('family-expand').textContent=familiesExpanded?t("app:show_first_10_families_8eaca5fe"):t("app:show_all_families_5599b8ce", {v0:(families.length)});
}
function renderSpeciesList(){
  if(!data||!speciesScope)return;
  const {kind,id}=speciesScope;
  const siteOnly=kind==='site'&&speciesScope.siteOnly;
  const rows=speciesAccuracy(data.birds,histories[speciesScope.medium],kind,id,{siteOnly});
  const title=kind==='site'?data.sites.find(s=>s.code===id)?.name:id;
  $('species-title').textContent=title;
  $('species-kind').textContent=kind==='site'?t("app:site_species_5af1988b"):t("app:family_species_99cd382b");
  $('species-subtitle').textContent=t("app:species_statistics_47303cbb", {v0:(rows.length),v1:(mediumName(speciesScope.medium)),v2:(kind==='site'?t("app:all_families_x_marked_targets_96ae6d57"):t("app:all_sites_abeab43d"))});
  if(kind==='site')$('species-subtitle').textContent+=siteOnly?t("app:site_only_quizzes_a13eff59"):t("app:all_quiz_scopes_36e2f06e");
  const sorted=sortAccuracy(rows,$('species-sort').value,$('species-direction').value);
  $('species-rows').innerHTML=sorted.map(row=>`<tr><td><strong>${escapeHTML(row.name)}</strong><span class="species-scientific">${escapeHTML(row.scientificName)}</span></td><td class="species-rate"><strong>${formatRate(row.rate)}</strong><small>${row.total?t("app:correct_528bba3f", {v0:(row.correct),v1:(row.total)}):t("app:no_answers_yet_ded2e1cb")}</small></td></tr>`).join('');
  const settings=listQuizSettings(kind,id);
  const scoped=eligibleBirds(data.birds,settings.site,'none',settings.family);
  const ready=speciesScope.medium==='audio'?audioBirds(scoped,audioCatalog,settings.site):scoped;
  $('species-start').disabled=!ready.some(b=>b.photos.length);
  $('species-explanation').textContent=t("app:correct_ids_scored_attempts_using_the_available_aggrega_37bc3218", {v0:(speciesScope.medium==='audio'?t("app:audio_bc1b8890"):t("app:visual_ba303321")),v1:(speciesScope.medium==='audio'?t("app:of_these_species_currently_have_audio_in_this_quiz_s_ca_21e1eea7", {v0:(ready.filter(b=>b.photos.length).length)}):'')});
  if(siteOnly)$('species-explanation').textContent+=t("app:only_answers_from_this_exact_site_with_all_families_sel_4bd4ab69");
  $('species-start').textContent=kind==='site'?t("app:start_site_quiz_094b1396"):t("app:start_family_quiz_5f5cc6af");
}
function navigateSpeciesHash(){
  if(!data)return;
  sessionToken++;stopAudio();
  let parts;try{parts=location.hash.slice(1).split('/').map(decodeURIComponent);}catch{parts=[];}
  const [route,...rest]=parts;
  const [medium,kind,id,scope]=rest.length>=3?rest:[statsMedium(),...rest];
  const valid=route==='species'&&rest.length>=2&&rest.length<=4&&(!scope||(scope==='site-only'&&kind==='site'))&&['photo','audio'].includes(medium)&&((kind==='site'&&data.sites.some(s=>s.code===id))||(kind==='family'&&data.birds.some(b=>familyName(b.family)===id)));
  if(valid){
    speciesScope={medium,kind,id,siteOnly:scope==='site-only'};if(kind==='site')$('site-only-stats').checked=speciesScope.siteOnly;$('stats-medium').value=medium;$('species-sort').value='taxonomy';$('species-direction').value='asc';$('species-count').value='20';
    readProgress(medium);renderSpeciesList();showView('species-page',{updateUrl:false});$('species-title').focus({preventScroll:true});
  }else{speciesScope=null;showView(location.pathname.startsWith('/statistics')?'statistics':location.pathname.startsWith('/quiz')?'setup':'landing',{updateUrl:false});}
}
function selectedFilter(){return document.querySelector('input[name="filter"]:checked').value;}
function formSettings(){const mode=document.querySelector('input[name="mode"]:checked').value;return {medium:selectedMedium(),mode,site:$('site').value,family:$('family').value,count:Number($('count').value),allSpecies:$('all-species').checked,filter:selectedFilter(),experimentalTips:selectedMedium()==='photo'&&(mode==='annotations'||$('experimental-tips').checked)};}
function pool(settings=formSettings()){
  if(settings.route)return settings.mistakeIds?settings.route.pool.filter(b=>settings.mistakeIds.includes(b.id)):settings.route.pool;
  const medium=settings.medium||'photo';
  if(settings.mode==='annotations')return unreviewedPhotos(annotatedBirds(eligibleBirds(data.birds,settings.site,'none',settings.family)),reviewedPhotos);
  const birds=settings.mode==='review'?reviewBirds(data.birds,histories[medium],settings.site,settings.family,settings.mistakeIds):eligibleBirds(data.birds,settings.site,settings.filter,settings.family);
  if(medium==='audio')return audioBirds(birds,audioCatalog,settings.site);
  return settings.pilotTips?annotatedBirds(birds):birds;
}
function readProgress(medium=selectedMedium()){
  if(accountStatistics)histories[medium]=accountStatistics.histories[medium];
}
function saveProgress(medium,progress){
  histories[medium]=progress;
  $('storage-status').textContent=t("app:statistics_storage_is_managed_on_the_statistics_page_co_1bdfce6d");
  renderStatistics();
}
function rememberAnswer(bird,correct){
  if(activeSettings.experimentalTips||activeSettings.route)return;
  const medium=activeSettings.medium;
  saveProgress(medium,recordAttempt(histories[medium],bird.id,correct,activeSettings));
}
function updatePool(){
  if(!data)return;
  const medium=selectedMedium(),audio=medium==='audio';
  const annotationOption=document.querySelector('input[name="mode"][value="annotations"]');annotationOption.disabled=audio;
  if(audio&&annotationOption.checked)document.querySelector('input[name="mode"][value="regular"]').checked=true;
  readReviewedPhotos();
  $('photo-tip-options').hidden=audio;$('try-id-pilot').hidden=audio||!$('experimental-tips').checked;$('try-id-pilot').disabled=!Object.keys(ID_TIPS).length;
  const settings=formSettings(),annotationReview=settings.mode==='annotations',review=settings.mode==='review',familyMode=annotationReview||(!settings.allSpecies&&!review&&settings.family!=='all'),birds=pool(settings),ready=questionPool(birds,familyMode);
  $('all-species-label').textContent=annotationReview?t("app:use_all_unreviewed_annotated_photos_f657f7be"):t("app:use_all_eligible_species_d922d6c2");
  $('all-species-help').textContent=annotationReview?t("app:sets_questions_to_all_unreviewed_annotated_photos_in_th_49009bee"):t("app:sets_questions_to_the_current_scope_s_playable_species_e08ce184");
  $('count').readOnly=settings.allSpecies;
  if(settings.allSpecies)$('count').value=String(ready.length);
  const requested=Number($('count').value);
  $('lifer-filters').hidden=review;$('lifer-filters').disabled=review;$('review-help').hidden=!review;
  $('review-help').textContent=t("app:review_species_missed_more_than_25_of_the_time_over_the_7d71b906", {v0:(mediumName(medium))});
  $('family-help').textContent=settings.allSpecies&&!annotationReview?t("app:all_eligible_species_each_playable_species_appears_once_5941de63"):review?t("app:site_and_family_filters_apply_to_mistakes_in_the_select_479b67cf"):t("app:choose_a_family_to_practice_different_of_the_same_speci_d512f4bc", {v0:(audio?t("common:recordings"):t("common:photos"))});
  let base=review?reviewBirds(data.birds,histories[medium],settings.site):eligibleBirds(data.birds,settings.site,settings.filter);
  if(audio)base=audioBirds(base,audioCatalog,settings.site).filter(b=>b.photos.length);
  if(annotationReview)base=pool({...settings,family:'all'});
  const represented=new Set(base.map(b=>familyName(b.family))),families=[...new Set(data.birds.map(b=>familyName(b.family)))].filter(f=>$('show-all-families').checked||represented.has(f));
  const options=[document.createElement('option'),...families.map(f=>{const option=document.createElement('option');option.value=f;option.textContent=familyLabel(f);return option;})];options[0].value='all';options[0].textContent=t("app:all_families_01eee2b5");
  $('family').replaceChildren(...options);$('family').value=families.includes(settings.family)?settings.family:'all';
  if($('family').value!==settings.family){updatePool();return;}
  for(const option of $('family').options){if(option.value==='all')continue;const n=base.filter(b=>familyName(b.family)===option.value).length;option.textContent=t("app:species_6c457207", {v0:(familyLabel(option.value)),v1:(n)});}
  const covered=birds.filter(b=>b.photos.length).length;
  $('pool').textContent=!ready.length?(review?(recentMistakeIds(histories[medium]).length?t("app:no_playable_review_birds_match_these_filters_try_anothe_76f625bd", {v0:(mediumName(medium))}):t("app:no_birds_currently_exceed_a_25_miss_rate_start_a_regula_774d4dd9", {v0:(mediumName(medium))})):t("app:no_match_these_filters_try_another_family_site_or_lifer_40bb1d79", {v0:(audio?t("app:verified_recordings_38a24513"):t("common:photos"))})):`${covered} ${review?t("app:species_to_review_270c4bea"):t("app:eligible_species_with_f39918b3")+(audio?t("common:audioMedium"):t("common:photos"))}${audio?t("app:scoped_species_e8c3359d", {v0:(birds.length)}):''} · ${ready.length} ${familyMode?(audio?t("common:recordings"):t("app:different_photographs_2b594cbd"))+t("app:species_may_repeat_ef69644c"):t("app:species_questions_9c9f81fe")}${!annotationReview&&!review&&requested>new Set(birds.map(b=>b.id)).size?t("app:additional_questions_use_newly_shuffled_species_rounds_fc69f6cb"):(annotationReview||review)&&requested>ready.length?t("app:quiz_will_use_questions_afe6a1ab", {v0:(ready.length)}):''}`;
  $('audio-scope-help').hidden=!audio;
  if(audio){const tiers=[0,0,0,0,0,0];for(const bird of birds)if(bird.photos.length)tiers[bird.photos[0].match.rank]++;$('audio-scope-help').textContent=t("app:best_matches_for_this_scope_site_area_same_department_c_2dba7b39", {v0:(tiers[0]+tiers[1]),v1:(tiers[2]),v2:(tiers[3]),v3:(tiers[4]+tiers[5])});}
  $('count').removeAttribute('max');$('start').disabled=!ready.length;
  if(annotationReview){$('lifer-filters').hidden=true;$('lifer-filters').disabled=true;$('pool').textContent=ready.length?t("app:annotated_photos_not_yet_marked_reviewed_species_site_a_b8c050dd", {v0:(ready.length),v1:(covered),v2:(Math.min(requested,ready.length))}):t("app:no_unreviewed_annotated_photos_match_this_site_and_fami_4c631717");$('family-help').textContent=t("app:review_only_published_annotated_photos_you_have_not_mar_2da12b12");}
}
function showView(id,{updateUrl=true}={}){
  if(id!=='session'&&$('photo-zoom').open)$('photo-zoom').close();
  stopAudio();
  for(const v of ['landing','setup','routes','statistics','session','results','species-page'])$(v).hidden=v!==id;
  const section=id==='landing'?'home':id==='routes'?'routes':['statistics','species-page'].includes(id)?'statistics':'practice';
  const path=section==='home'?'/':section==='routes'?'/trips':section==='statistics'?'/statistics':'/quiz';
  if(updateUrl&&location.pathname+location.search+location.hash!==path)history.pushState(null,'',path);
  for(const name of ['home','practice','routes','statistics']){const link=$('nav-'+name);if(name===section)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  document.title=id==='landing'?t("app:aviquiz_bird_identification_practice_e8608fa7"):t("app:aviquiz_44cb4fac", {v0:(section==='statistics'?t("app:statistics_a656107e"):section==='routes'?t("app:trips_86bbcd7d"):t("app:practice_d3857b12"))});
  if(id==='statistics'){readProgress('photo');readProgress('audio');renderStatistics();}
  window.scrollTo({top:0,behavior:'instant'});
}
function openRoutePage(){
  showView('routes',{updateUrl:false});
  if(!data)return;
  const token=navigationToken;
  routeEditor??=import('./route-ui.mjs').then(m=>m.createRouteEditor({birds:data.birds,startQuiz:route=>{
    begin({route,count:route.count,medium:'photo',mode:'regular',site:'all',family:'all',filter:'none'});
  }})).catch(error=>{routeEditor=null;throw error;});
  routeEditor.then(editor=>{if(token===navigationToken)editor.open(location.hash);}).catch(()=>{
    if(token===navigationToken)$('route-loading').textContent=t("app:trip_data_could_not_load_please_reload_to_try_again_50f6a2c2");
  });
}
function returnToRoute(route){
  if(route.geography){location.assign(route.returnUrl);return;}
  history.pushState(null,'','/trips'+route.hash);navigateLocation();$('routes-heading').focus({preventScroll:true});
}
async function openGeographyQuiz(token){
  showView('setup',{updateUrl:false});
  try{
    const {geographySelection,geographyPool}=await import('./geography-core.mjs');
    const query=new URLSearchParams(location.search),selection=geographySelection(query);
    const ncResponse=await fetch('/api/geography/quiz?'+new URLSearchParams({place:selection.id,from:selection.start,to:selection.end,single:String(selection.single),family:selection.family}));
    if(token!==navigationToken)return;
    if(ncResponse.status!==404){
      const nc=await ncResponse.json();if(!ncResponse.ok)throw Error(nc.error);
      if(!nc.pool.length)throw Error(t("app:no_species_with_verified_photos_match_this_location_sea_91302e95"));
      const scope={name:nc.placeName||selection.id};
      const route={geography:true,title:(scope?.name||selection.id)+' · '+calendarWindowLabel(selection.start,selection.end),pool:nc.pool,count:selection.count,returnUrl:'/explore?'+new URLSearchParams({geo:selection.id,from:selection.start,to:selection.end,trail:query.get('trail')||'',allSpecies:String(selection.allSpecies),questions:String(selection.count),family:selection.family,single:String(selection.single)})};
      begin({route,count:selection.count,allSpecies:selection.allSpecies,medium:'photo',mode:'regular',site:'all',family:selection.family,filter:'none'});return;
    }
    const responses=await Promise.all(['/geography-seed.json','/route-pilot.json'].map(p=>fetch(p)));if(responses.some(r=>!r.ok))throw Error(t("app:geography_pilot_data_is_unavailable_464284b9"));
    const [seed,catalog]=await Promise.all(responses.map(r=>r.json()));if(token!==navigationToken)return;
    const scope=seed.nodes.find(n=>n.id===selection.id);if(!scope||['world','continent'].includes(scope.kind))throw Error(t("app:select_a_supported_country_region_or_site_in_the_geogra_2b3ac6e3"));
    const candidates=geographyPool({scope,nodes:seed.nodes,catalog,birds:data.birds,...selection});
    const pool=candidates.pool.filter(b=>selection.family==='all'||familyName(b.family)===selection.family);
    if(!pool.length)throw Error(t("app:no_pilot_species_with_photos_match_this_location_date_r_d61e0bbc"));
    const route={geography:true,title:scope.name+' · '+calendarWindowLabel(selection.start,selection.end),pool,count:selection.count,returnUrl:'/explore?'+new URLSearchParams({geo:scope.id,from:selection.start,to:selection.end,allSpecies:String(selection.allSpecies),questions:String(selection.count),family:selection.family,single:String(selection.single)})};
    begin({route,count:selection.count,allSpecies:selection.allSpecies,medium:'photo',mode:'regular',site:'all',family:selection.family,filter:'none'});
  }catch(error){if(token===navigationToken)$('settings-error').textContent=error.message;}
}
function navigateLocation(){
  navigationToken++;sessionToken++;
  if(['/trips','/trips/','/routes','/routes/'].includes(location.pathname)){openRoutePage();return;}
  if(data&&location.pathname.startsWith('/quiz')&&new URLSearchParams(location.search).has('geo')){openGeographyQuiz(navigationToken);return;}
  if(location.hash.startsWith('#species/')){if(data)navigateSpeciesHash();return;}
  const page=location.pathname.startsWith('/quiz')?'setup':location.pathname.startsWith('/statistics')?'statistics':'landing';
  showView(page,{updateUrl:false});
  if(data&&page==='setup'){
    const medium=new URLSearchParams(location.search).get('medium');
    if(medium==='photo'||(medium==='audio'&&!$('medium').querySelector('option[value=audio]').disabled))$('medium').value=medium;
    readProgress();updatePool();
  }
}
$('skip-main').addEventListener('click',event=>{
  if(!$('routes').hidden&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();$('main-content').focus();}
});
for(const [id,url] of Object.entries({'nav-home':'/','nav-practice':'/quiz','nav-routes':'/trips','nav-statistics':'/statistics','landing-statistics':'/statistics','practice-statistics':'/statistics','statistics-practice':'/quiz','species-back':'/statistics','results-statistics':'/statistics'})){
  $(id).addEventListener('click',event=>{
    if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(location.pathname+location.search+location.hash!==url)history.pushState(null,'',url);
    navigateLocation();
    const heading=!$('landing').hidden?'landing-heading':!$('setup').hidden?'setup-heading':!$('routes').hidden?'routes-heading':'statistics-heading';$(heading).focus({preventScroll:true});
  });
}
async function begin(settings=formSettings()){
  if(starting)return;
  let count=settings.count;
  if(!settings.allSpecies&&(!Number.isInteger(count)||count<1||count>10000)){$('settings-error').textContent=t("app:choose_a_whole_number_of_questions_from_1_to_10_000_aa3f0423");return;}
  settings={...settings,medium:settings.medium||'photo'};
  if(settings.mode==='annotations'){settings.medium='photo';settings.experimentalTips=true;settings.filter='none';readReviewedPhotos();}
  readProgress(settings.medium);const navigation=navigationToken;starting=true;if(settings.medium==='photo'&&!settings.route)await loadSharedTips();starting=false;if(navigation!==navigationToken)return;
  if(!settings.route)$('medium').value=settings.medium;
  $('settings-error').textContent='';
  const review=settings.mode==='review',familyMode=settings.mode==='annotations'||(!settings.allSpecies&&!review&&(settings.pilotTips||settings.family!=='all'));
  const birds=review?withFreshPhotos(pool(settings),settings.avoidPhotoIds):pool(settings);
  if(settings.allSpecies)count=questionPool(birds,familyMode).length;
  settings.count=count;
  queue=settings.mode==='annotations'||review?buildQuestions(birds,count,familyMode):buildQuestionRounds(birds,count,familyMode);
  if(!queue.length){showView('setup');updatePool();$('settings-error').textContent=review?t("app:no_species_currently_need_review_with_these_settings_ch_a6ebba66"):t("app:no_species_match_these_settings_0a55e1c3");return;}
  activeSettings={...settings,statisticsId:crypto.randomUUID(),statisticsOwner:accountStatistics?.owner||'guest',eligibleSpecies:new Set(questionPool(birds,familyMode).map(bird=>bird.id)).size};
  index=0;answers=[];showView('session');
  const siteLabel=settings.route?settings.route.title:settings.site==='all'?t("app:entire_trip_checklist_fa5cf696"):data.sites.find(s=>s.code===settings.site)?.name||settings.site;
  $('session-label').textContent=mediumName(settings.medium).toUpperCase()+' · '+(review?(settings.mistakeIds?t("app:review_this_quiz_s_mistakes_84759239"):t("app:review_recent_mistakes_50760660")):t("app:regular_quiz_a1ac21b8"))+' · '+siteLabel+(settings.family!=='all'?' · '+settings.family:'')+(review?'':' · '+({none:t("app:all_species_15553c64"),world:t("app:worldwide_lifers_7c0e4e9a"),colombia:t("app:colombia_lifers_2f04931f")}[settings.filter]));
  if(settings.route)$('session-label').textContent+=settings.route.geography?t("app:geography_pilot_history_not_recorded_64d08be8"):t("app:trip_prototype_history_not_recorded_2f352500");
  if(settings.pilotTips)$('session-label').textContent+=t("app:reviewed_photo_sampler_1168846b");
  if(settings.experimentalTips)$('session-label').textContent+=t("app:experimental_history_not_recorded_152f536a");
  if(settings.mode==='annotations')$('session-label').textContent=t("app:annotation_review_history_not_recorded_91776d22", {v0:(siteLabel),v1:(settings.family==='all'?t("app:all_families_01eee2b5"):settings.family)});
  nextQuestion();
}
function credit(photo,{revealed=false,showSpecies=revealed}={}){
  const owner=photo.recordist||photo.photographer||photo.alt?.split(' - ').slice(1).join(' - ')||t("app:macaulay_library_contributor_93cfc04b");
  return t("app:cornell_lab_of_ornithology_macaulay_library_f3594420", {v0:(showSpecies?escapeHTML(queue[index].name)+' · ':''),v1:(escapeHTML(owner)),v2:(revealed?t("app:ml_ffa2a25d", {v0:(escapeHTML(photo.source)),v1:(escapeHTML(photo.id))}):'')});
}
function loadPhoto(){
  const bird=queue[index],token=sessionToken;
  if($('photo-zoom').open)$('photo-zoom').close();
  const zoom=$('zoom-photo');zoom.disabled=true;
  currentPhoto=photoOrder[photoTry%photoOrder.length];imageReady=false;
  $('question-image').hidden=true;$('image-loading').hidden=false;$('image-error').hidden=true;$('unavailable').hidden=true;
  $('check').disabled=true;$('reveal').disabled=true;
  const image=$('question-image');
  image.onload=()=>{if(token!==sessionToken)return;imageReady=true;image.hidden=false;zoom.disabled=false;$('image-loading').hidden=true;$('check').disabled=false;$('reveal').disabled=false;if(activeSettings.mode==='annotations'){finishAnswer(true);$('answer-form').hidden=true;$('feedback').innerHTML=t("app:inspect_the_annotations_then_mark_this_photo_reviewed_o_86e1b164", {v0:(escapeHTML(bird.name))});toggleIdFeatures();}};
  image.onerror=()=>{if(token!==sessionToken)return;if(photoTry+1<bird.photos.length){photoTry++;loadPhoto();return;}$('image-loading').hidden=true;$('image-error').hidden=false;$('unavailable').hidden=false;};
  image.alt=t("app:bird_to_identify_07ba48c2");image.src=currentPhoto.url;
  $('photo-credit').innerHTML=credit(currentPhoto);
}
function stopAudio(){
  clearTimeout(audioTimer);mediaLoadToken++;
  const player=$('question-audio');player.oncanplay=null;player.onplaying=null;player.onerror=null;player.pause();player.removeAttribute('src');player.load();
  document.querySelectorAll('#review audio').forEach(a=>a.pause());
}
function recordingDetails(recording){
  return t("app:location_date_sound_recorded_subspecies_site_subspecies_3c8f223e", {v0:(escapeHTML(recording.match.label)),v1:(escapeHTML(recording.match.detail)),v2:(escapeHTML(recording.location)),v3:(escapeHTML(recording.department||t("app:department_not_catalogued_07adfd19"))),v4:(escapeHTML(recording.country)),v5:(escapeHTML(recording.date||t("app:not_catalogued_c2bf53e0"))),v6:(escapeHTML(recording.soundType||t("app:vocalization_type_not_catalogued_2510e832"))),v7:(escapeHTML(recording.subspecies||t("app:not_identified_in_catalog_04ee51be")))});
}
function loadAudio(){
  stopAudio();const token=sessionToken,load=mediaLoadToken;
  $('retry-audio').disabled=false;
  currentPhoto=photoOrder[photoTry%photoOrder.length];imageReady=false;
  $('check').disabled=true;$('reveal').disabled=true;$('unavailable').hidden=false;$('audio-error').hidden=true;$('audio-loading').hidden=false;$('audio-loading').textContent=t("app:loading_recording_0f0309db");$('audio-credit').textContent=t("app:recording_credit_and_locality_are_shown_after_answering_f93e95b8");
  const player=$('question-audio'),valid=()=>token===sessionToken&&load===mediaLoadToken;
  player.setAttribute('aria-label',t("app:bird_vocalization_to_identify_638f9aa1"));
  player.oncanplay=()=>{if(!valid())return;clearTimeout(audioTimer);$('audio-loading').hidden=false;$('audio-loading').textContent=t("app:press_play_then_enter_your_identification_you_can_repla_4226c01f");$('audio-error').hidden=true;};
  player.onplaying=()=>{if(!valid())return;clearTimeout(audioTimer);imageReady=true;$('audio-loading').textContent=t("app:listen_again_whenever_you_like_enter_the_common_or_scie_1f20ebf9");$('check').disabled=answered;$('reveal').disabled=answered;};
  player.onerror=()=>{if(!valid())return;clearTimeout(audioTimer);if(answered){$('audio-error').hidden=false;return;}if(photoTry+1<photoOrder.length){photoTry++;loadAudio();return;}$('audio-loading').hidden=true;$('audio-error').hidden=false;$('unavailable').hidden=false;};
  player.src=currentPhoto.url;player.load();
  audioTimer=setTimeout(()=>{if(!valid()||imageReady||answered)return;$('audio-error').hidden=false;$('unavailable').hidden=false;$('audio-loading').textContent=t("app:the_recording_is_taking_longer_than_expected_you_can_re_7946df1c");},15000);
}
function nextQuestion(){
  stopAudio();const audio=activeSettings.medium==='audio';
  currentSiteClue=!activeSettings.route&&offersSiteClue(activeSettings)?chooseSiteClue(queue[index],data.sites):null;renderSiteClue();
  activeTips=null;$('show-id-features').hidden=true;$('show-id-features').setAttribute('aria-expanded','false');$('id-features').hidden=true;$('id-tip-diagram').innerHTML='';$('id-tip-general').innerHTML='';$('id-tip-credit').textContent='';$('id-tip-source').innerHTML='';
  $('mark-photo-reviewed').hidden=true;
  sessionToken++;answered=false;photoTry=0;photoOrder=audio?queue[index].photos:shuffle(queue[index].photos);
  $('photo-question').hidden=audio;$('audio-question').hidden=!audio;
  $('retry-photo').textContent=photoOrder.length>1?t("app:try_another_photo_3d4b8873"):t("app:retry_photo_22a7a49f");
  $('retry-audio').textContent=photoOrder.length>1?t("app:try_another_recording_4d8188fe"):t("app:retry_recording_1629b5d2");
  $('unavailable').textContent=audio?t("app:skip_unclear_unavailable_recording_unscored_2dc7ecf8"):t("app:continue_without_scoring_this_question_7cda000a");
  $('question-number').textContent=t("app:question_921a2537", {v0:(index+1),v1:(queue.length)});$('progress').style.width=`${index/queue.length*100}%`;$('score').textContent=t("common:correctCount",{count:answers.filter(a=>a.correct).length});
  $('answer').value='';$('answer').disabled=false;$('answer-form').hidden=false;$('reveal').hidden=false;$('next').hidden=true;$('feedback').innerHTML='';$('question-status').textContent=audio?t("app:vocalization_identification_255ce887"):t("app:photo_identification_1660a9d4");
  if(audio)loadAudio();else loadPhoto();$('answer').focus();
}
function finishAnswer(revealed=false){
  if(answered||!imageReady)return;
  const guess=$('answer').value.trim();if(!revealed&&!guess)return;
  answered=true;
  $('unavailable').hidden=true;
  $('retry-audio').disabled=true;
  const bird=queue[index],grade=revealed?{correct:false,fuzzy:false}:gradeAnswer(guess,bird,activeSettings.route?[...data.birds,...activeSettings.route.pool]:data.birds);
  answers.push({bird,guess,correct:grade.correct,revealed,photo:currentPhoto});
  rememberAnswer(bird,grade.correct);
  $('answer').disabled=true;$('check').disabled=true;$('reveal').hidden=true;$('next').hidden=false;$('question-status').textContent=grade.correct?t("common:identified"):t("app:keep_learning_c2778ce6");
  if(activeSettings.medium==='audio'){$('audio-credit').innerHTML=credit(currentPhoto,{revealed:true})+recordingDetails(currentPhoto);$('question-audio').setAttribute('aria-label',t("common:recordingFor",{species:bird.name}));}else{$('photo-credit').innerHTML=credit(currentPhoto,{revealed:true});$('question-image').alt=bird.name;}
  activeTips=tipsFor(bird,currentPhoto,{enabled:activeSettings.medium!=='audio'&&Boolean(activeSettings.experimentalTips),answered:true,correct:grade.correct});
  $('show-id-features').hidden=!activeTips;
  $('show-id-features').textContent=activeTips?.kind==='general'?t("app:show_general_id_tips_experimental_86c0470c"):t("app:show_id_features_experimental_78f99741");
  const badges=[bird.worldLifer?t("app:potential_worldwide_lifer_ee7f3839"):'',bird.colombiaLifer?t("app:potential_colombia_lifer_78c57b0b"):''].filter(Boolean).join(' · ');
  $('feedback').innerHTML=t("app:study_this_species_7f630938", {v0:(grade.correct?'correct':'incorrect'),v1:(grade.correct?(grade.fuzzy?t("app:correct_small_typo_accepted_4a9f169e"):t("app:correct_e2581a9d")):(revealed?t("app:answer_revealed_8dc2a469"):t("app:not_quite_ea3f893f"))),v2:(escapeHTML(bird.name)),v3:(escapeHTML(bird.scientificName)),v4:(badges?`<p>${badges}</p>`:''),v5:(encodeURIComponent(bird.id))});
  $('score').textContent=t("common:correctCount",{count:answers.filter(a=>a.correct).length});$('next').textContent=index===queue.length-1?t("app:see_results_fa3ba25a"):t("app:next_bird_ffd9ad15");$('next').focus();
  if(activeSettings.mode==='annotations'){$('next').textContent=t("app:leave_unreviewed_next_1f1680c7");$('question-status').textContent=t("app:annotation_review_629c4a50");$('score').textContent=t("common:reviewedCount",{count:answers.filter(a=>a.personallyReviewed).length});}
}
function advance(){if(index+1<queue.length){index++;nextQuestion();}else finish();}
function finish(){
  showView('results');sessionToken++;
  const medium=activeSettings.medium;
  const progress=histories[medium];
  const updated=recordQuizResult(progress,activeSettings,answers,activeSettings.eligibleSpecies);
  if(updated!==progress)saveProgress(medium,updated);
  const event=quizEvent(activeSettings,answers,activeSettings.statisticsId);
  if(event)accountStatistics?.record(event,activeSettings.statisticsOwner);
  const audio=activeSettings.medium==='audio';
  const scored=answers.filter(a=>!a.unavailable),correct=scored.filter(a=>a.correct).length;
  $('result-title').textContent=t("app:identified_3d1c596d", {v0:(correct),v1:(scored.length)});
  $('result-summary').textContent=t("app:practice_review_your_birds_below_then_choose_your_next_a5f3d38c", {v0:(mediumName(activeSettings.medium)),v1:(scored.length?Math.round(correct/scored.length*100)+t("app:correct_1425d3e5"):t("app:no_questions_could_be_scored_8e44a28d")),v2:(answers.length>scored.length?t("app:skipped_or_unavailable_were_not_scored_357e7e78", {v0:(answers.length-scored.length),v1:(audio?t("common:recordings"):t("common:photos"))}):'')});
  const mistakes=sessionMistakeIds(answers);
  if(activeSettings.route)$('result-summary').textContent+=activeSettings.route.geography?t("app:geography_pilot_saved_statistics_were_not_changed_2c1c46dc"):t("app:trip_prototype_saved_statistics_were_not_changed_3fd0a976");
  if(activeSettings.experimentalTips)$('result-summary').textContent+=t("app:experimental_session_these_answers_were_not_added_to_st_794eeca7");
  if(activeSettings.mode==='annotations'){$('result-title').textContent=t("app:photos_marked_reviewed_02b81dbf", {v0:(answers.filter(a=>a.personallyReviewed).length),v1:(answers.length)});$('result-summary').textContent=t("app:marked_photos_are_excluded_from_future_annotation_revie_7954e567");$('review-quiz').hidden=true;}
  else $('review-quiz').hidden=false;
  $('review-quiz').disabled=!mistakes.length;$('review-quiz').textContent=t("app:review_this_quiz_s_mistakes_8d9d6874", {v0:(mistakes.length)});
  $('result-review-help').textContent=mistakes.length?t("app:review_covers_the_species_you_missed_in_this_quiz_regar_53ffbb19"):t("app:no_mistaken_ids_in_this_quiz_to_review_3f4fc31c");
  $('review').innerHTML=answers.map(a=>t("app:macaulay_library_ml_ac372031", {v0:(audio?'audio-review':''),v1:(audio?`<audio controls preload="none" aria-label="${escapeHTML(t("common:recordingFor",{species:a.bird.name}))}" src="${escapeHTML(a.photo.url)}"></audio>`:`<img src="${escapeHTML(a.photo.url)}" alt="${escapeHTML(a.bird.name)}" loading="lazy">`),v2:(escapeHTML(a.bird.name)),v3:(escapeHTML(a.bird.scientificName)),v4:(a.unavailable?t("app:skipped_or_unavailable_9fd3ddf3"):a.revealed?t("app:answer_revealed_8dc2a469"):t("app:your_answer_59bf7df3", {v0:(escapeHTML(a.guess))})),v5:(escapeHTML(a.photo.source)),v6:(escapeHTML(a.photo.recordist||a.photo.photographer)),v7:(escapeHTML(a.photo.id)),v8:(audio?recordingDetails(a.photo):''),v9:(a.unavailable?t("app:not_scored_8d57c61c"):a.correct?t("app:correct_2bd9457f"):t("app:review_c9bd099c"))})).join('');
}
$('settings').addEventListener('submit',e=>{e.preventDefault();begin();});
$('settings').addEventListener('change',e=>{if(e.target.name==='mode'&&data){if(e.target.value==='annotations'&&selectedMedium()==='photo')$('photo-tip-options').open=true;$('settings-error').textContent='';readProgress();updatePool();}});
$('experimental-tips').addEventListener('change',updatePool);
$('mark-original-reviewed').addEventListener('click',()=>{markPhotosReviewed(ORIGINAL_REVIEW_PHOTOS);updatePool();});
$('try-id-pilot').addEventListener('click',()=>{
  if(selectedMedium()!=='photo'||!$('experimental-tips').checked)return;
  document.querySelector('input[name="mode"][value="annotations"]').checked=true;
  document.querySelector('input[name="filter"][value="none"]').checked=true;
  updatePool();begin(formSettings());
});
function toggleIdFeatures(){
  if(!activeTips||!answered||!activeSettings.experimentalTips)return;
  const reveal=$('id-features').hidden;
  $('id-features').hidden=!reveal;$('show-id-features').setAttribute('aria-expanded',String(reveal));
  const general=activeTips.kind==='general',label=general?t("app:general_id_tips_a9d29129"):t("app:id_features_01e56261");
  $('show-id-features').textContent=t("app:experimental_b5f8317f", {v0:(reveal?t("app:hide_ac20a57b"):t("app:show_0df6f1ca")),v1:(label)});
  if(reveal){
    $('id-features-title').textContent=general?t("app:general_species_id_tips_88de1c27"):t("app:photo_id_features_1d21a4ff");
    $('id-tip-general').hidden=!general;$('id-tip-figure').hidden=general;$('id-tip-mobile-help').hidden=general;
    $('id-tip-general').innerHTML=general?t("app:these_species_level_features_have_not_been_checked_agai_e74413eb", {v0:(activeTips.tips.map(tip=>`<li>${escapeHTML(tip)}</li>`).join(''))}):'';
    $('id-tip-diagram').innerHTML=general?'':annotationSvg(activeTips.annotation,currentPhoto,queue[index].name);
    $('id-tip-credit').innerHTML=general?'':credit(currentPhoto,{revealed:true});
    $('id-tip-source').innerHTML=t("app:source_ebird_merlin_cornell_lab_of_ornithology_id_guida_faf5ade4", {v0:(escapeHTML(activeTips.source)),v1:(escapeHTML(queue[index].name))});
    $('id-features').scrollIntoView({behavior:'smooth',block:'start'});$('id-features').focus({preventScroll:true});
    $('mark-photo-reviewed').hidden=activeSettings.mode!=='annotations'||general;
  }
}
$('show-id-features').addEventListener('click',toggleIdFeatures);
$('mark-photo-reviewed').addEventListener('click',()=>{
  if(activeSettings?.mode!=='annotations'||!answered||$('id-features').hidden||activeTips?.kind!=='annotated')return;
  markPhotosReviewed([currentPhoto.id]);answers[answers.length-1].personallyReviewed=true;advance();
});
$('all-species').addEventListener('change',updatePool);
$('site').addEventListener('change',updatePool);$('family').addEventListener('change',updatePool);document.querySelectorAll('input[name="filter"]').forEach(el=>el.addEventListener('change',updatePool));$('count').addEventListener('input',()=>{if(data)updatePool();});
$('answer-form').addEventListener('submit',e=>{e.preventDefault();finishAnswer();});$('reveal').addEventListener('click',()=>finishAnswer(true));
$('next').addEventListener('click',advance);
$('retry-audio').addEventListener('click',()=>{photoTry=(photoTry+1)%photoOrder.length;loadAudio();});
$('retry-photo').addEventListener('click',()=>{photoTry=(photoTry+1)%queue[index].photos.length;loadPhoto();});
$('zoom-photo').addEventListener('click',()=>{
  const dialog=$('photo-zoom');
  if(!imageReady||activeSettings?.medium!=='photo'||$('session').hidden||dialog.open)return;
  const photo=$('question-image'),enlarged=$('photo-zoom-image');
  enlarged.src=photo.src;
  enlarged.alt=photo.alt;
  $('photo-zoom-title').textContent=answered?queue[index].name:t("app:zoomed_photo_0d9e858c");
  $('photo-zoom-credit').innerHTML=credit(currentPhoto,{revealed:answered,showSpecies:false});
  dialog.showModal();
  enlarged.parentElement.scrollTo(0,0);
});
$('unavailable').addEventListener('click',()=>{if(answered)return;answers.push({bird:queue[index],guess:'',correct:false,unavailable:true,photo:currentPhoto});advance();});
function startOver(){if(activeSettings?.route){returnToRoute(activeSettings.route);return;}sessionToken++;$('settings').reset();$('settings-error').textContent='';updatePool();showView('setup');}
$('exit').addEventListener('click',()=>{if(activeSettings?.route){returnToRoute(activeSettings.route);return;}sessionToken++;updatePool();showView('setup');});
$('new-quiz').addEventListener('click',startOver);
$('again').addEventListener('click',()=>begin(activeSettings));
$('review-quiz').addEventListener('click',()=>{
  const mistakeIds=sessionMistakeIds(answers);if(!mistakeIds.length)return;
  const settings={...activeSettings,mode:'review',filter:'none',mistakeIds,avoidPhotoIds:answers.map(a=>a.photo.id)};
  if(!settings.route){document.querySelector('input[name="mode"][value="review"]').checked=true;updatePool();}
  begin(settings);
});
$('medium').addEventListener('change',()=>{readProgress();$('stats-medium').value=selectedMedium();updatePool();renderStatistics();});
$('stats-medium').addEventListener('change',()=>{readProgress(statsMedium());renderStatistics();});
let pendingBackup=null,importRead=0;
const backupState=()=>JSON.stringify([localStorage.getItem(PROGRESS_KEY),localStorage.getItem(AUDIO_PROGRESS_KEY),localStorage.getItem(ANNOTATION_REVIEW_KEY)]);
let previewState='';
$('export-progress').addEventListener('click',()=>{
  let url;
  try{
    const snapshotStorage={getItem:key=>key===PROGRESS_KEY?JSON.stringify(histories.photo):key===AUDIO_PROGRESS_KEY?JSON.stringify(histories.audio):localStorage.getItem(key)};
    const backup=createBackup(snapshotStorage,location.origin);
    const text=JSON.stringify(backup,null,2);
    if(new TextEncoder().encode(text).length>MAX_BACKUP_BYTES)throw Error(t("app:this_backup_exceeds_the_5_mb_import_limit_f9ef927e"));
    url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;link.download='aviquiz-backup-'+backup.exportedAt.slice(0,10)+'.json';
    link.click();
    $('backup-status').textContent=t("app:export_prepared_keep_the_downloaded_json_file_for_impor_2c551f7c");
  }catch{$('backup-status').textContent=t("app:export_failed_browser_storage_may_be_unavailable_or_con_bc73ef84");}
  finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
$('import-progress-file').addEventListener('change',async()=>{
  const token=++importRead;
  pendingBackup=null;$('import-progress').disabled=true;$('import-preview').hidden=true;
  const file=$('import-progress-file').files?.[0];
  if(!file)return;
  try{
    if(file.size>MAX_BACKUP_BYTES)throw Error(t("app:choose_an_aviquiz_backup_smaller_than_5_mb_40148042"));
    const backup=parseBackup(await file.text());
    if(token!==importRead)return;
    previewState=backupState();pendingBackup=backup;
    $('import-preview').textContent=backupSummary(backup);
    $('import-preview').hidden=false;$('import-progress').disabled=false;
    $('backup-status').textContent=t("app:file_checked_export_any_history_you_want_to_keep_before_0bca76b2");
  }catch(error){
    if(token===importRead)$('backup-status').textContent=error.message;
  }
});
$('import-progress').addEventListener('click',()=>{
  if(!pendingBackup)return;
  try{
    if(previewState!==backupState())throw Error(t("app:your_saved_history_changed_after_the_preview_select_the_a448f236"));
    importBackup(localStorage,pendingBackup);
    storageUsable.photo=true;storageUsable.audio=true;
    readProgress('photo');readProgress('audio');readReviewedPhotos();
    updatePool();renderStatistics();renderSpeciesList();
    pendingBackup=null;$('import-progress').disabled=true;
    $('import-progress-file').value='';$('import-preview').hidden=true;
    $('backup-status').textContent=t("app:backup_restored_older_statistics_are_preserved_for_acco_980be068");
  }catch(error){
    try{recoverImport(localStorage);}catch{storageUsable.photo=false;storageUsable.audio=false;}
    $('backup-status').textContent=error.message;
  }
});
$('site-only-stats').addEventListener('change',renderStatistics);
$('site-clue-toggle').addEventListener('change',()=>{siteClueEnabled=$('site-clue-toggle').checked;renderSiteClue();});
document.addEventListener('play',e=>{if(e.target.tagName===t("common:audio"))document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause();});},true);
for(const id of ['site-stat-sort','site-stat-direction','family-stat-sort','family-stat-direction'])$(id).addEventListener('change',renderStatistics);
$('family-expand').addEventListener('click',()=>{familiesExpanded=!familiesExpanded;renderStatistics();});
$('show-all-families').addEventListener('change',updatePool);
$('site-expand').addEventListener('click',()=>{sitesExpanded=!sitesExpanded;renderStatistics();});
for(const id of ['species-sort','species-direction'])$(id).addEventListener('change',renderSpeciesList);
$('species-quiz').addEventListener('submit',e=>{
  e.preventDefault();if(!speciesScope)return;
  const settings=listQuizSettings(speciesScope.kind,speciesScope.id,Number($('species-count').value));
  settings.medium=speciesScope.medium;$('medium').value=settings.medium;settings.experimentalTips=settings.medium==='photo'&&$('experimental-tips').checked;
  $('all-species').checked=false;$('site').value=settings.site;$('family').value=settings.family;$('count').value=String(settings.count);
  document.querySelector('input[name="mode"][value="regular"]').checked=true;
  document.querySelector('input[name="filter"][value="none"]').checked=true;
  updatePool();begin(settings);
});
window.addEventListener('hashchange',navigateLocation);
window.addEventListener('popstate',navigateLocation);
navigateLocation();
window.addEventListener('storage',e=>{if(e.key===ANNOTATION_REVIEW_KEY){readReviewedPhotos();if(data)updatePool();}if(e.key===PROGRESS_KEY||e.key===AUDIO_PROGRESS_KEY||e.key===null){readProgress('photo');readProgress('audio');if(data){updatePool();renderStatistics();renderSpeciesList();}}});
try{
  const response=await fetch('/data.json',{cache:'no-store'});if(!response.ok)throw new Error(t("app:checklist_unavailable_496b525b"));data=await response.json();
  $('site').options[0].textContent=t("app:entire_trip_checklist_501ae41b", {v0:(data.birds.length)});
  for(const site of data.sites){const count=eligibleBirds(data.birds,site.code).length;const option=document.createElement('option');option.value=site.code;option.textContent=`${site.code} · ${site.name} (${count})`;$('site').append(option);}
  // Bird records follow the checklist's taxonomic order; preserve each family's first occurrence.
  for(const family of new Set(data.birds.map(b=>familyName(b.family)))){const option=document.createElement('option');option.value=family;option.textContent=familyLabel(family);$('family').append(option);}
  $('world-total').textContent=data.summary.worldLifers;$('co-total').textContent=data.summary.colombiaLifers;
  const covered=data.birds.filter(b=>b.photos.length).length;$('coverage').textContent=t("app:macaulay_photo_records_of_species_image_availability_de_423e2f4d", {v0:(covered),v1:(data.birds.length),v2:(covered<data.birds.length?t("app:species_without_a_photo_record_are_excluded_from_questi_8964c0a3"):'')});
  const hero=data.birds.find(b=>b.name==='Multicolored Tanager'&&b.photos.length)||data.birds.find(b=>b.photos.length);
  if(hero){$('hero-photo').onerror=()=>{$('hero-photo').hidden=true;$('hero-label').textContent=t("app:macaulay_photograph_unavailable_946efa16");$('hero-credit').textContent=t("app:the_image_server_could_not_deliver_this_photo_please_tr_8849b24a");};$('hero-photo').src=hero.photos[0].url;$('hero-photo').alt=hero.name;$('hero-label').textContent=hero.name;$('hero-credit').textContent=t("app:macaulay_library_ml_c5606ff1", {v0:(hero.photos[0].photographer),v1:(hero.photos[0].id)});}
  try{const response=await fetch('/audio.json',{cache:'no-store'});if(!response.ok)throw Error();const received=await response.json();validateAudioCatalog(received,data.birds);audioCatalog=received;$('audio-coverage').textContent=t("app:audio_catalog_of_species_verified_recording_records_cov_645954f5", {v0:(Object.keys(audioCatalog.recordings).length),v1:(data.birds.length),v2:(Object.values(audioCatalog.recordings).reduce((n,a)=>n+a.length,0))});}catch{audioCatalog={version:1,recordings:{}};$('medium').querySelector('option[value=audio]').disabled=true;$('audio-coverage').textContent=t("app:audio_catalog_could_not_load_visual_quizzes_remain_avai_ae1127f0");}
  await loadSharedTips();
  readProgress('photo');readProgress('audio');updatePool();renderStatistics();
  navigateLocation();
}catch(error){$('pool').textContent=t("app:could_not_load_the_checklist_please_reload_the_page_7f367d1a");$('settings-error').textContent=error.message;}

accountStatistics=statisticsControls({changed:store=>{
  if($('session').hidden){histories.photo=store.histories.photo;histories.audio=store.histories.audio;}
  if(data){renderStatistics();if(speciesScope)renderSpeciesList();}
}});

// The home collection describes installed geographic data, not the legacy itinerary.
try{
 const response=await fetch('/api/geography/catalog');if(!response.ok)throw Error();
 const {coverage}=await response.json();
 if(!coverage||['species','geographies','sites'].some(key=>!Number.isSafeInteger(coverage[key])||coverage[key]<0))throw Error();
 for(const key of ['species','geographies','sites'])$('collection-'+key).textContent=new Intl.NumberFormat(locale).format(coverage[key]);
}catch{$('collection-coverage-note').textContent=t('geography-ui:collectionUnavailable');}
