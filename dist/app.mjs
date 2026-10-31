import {audioBirds,validateAudioCatalog} from './audio.mjs';
import {eligibleBirds,gradeAnswer,shuffle,familyName,questionPool,buildQuestions} from './quiz.mjs';
import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,progressKey,emptyProgress,parseProgress,recordAttempt,recentMistakeIds,sessionMistakeIds,reviewBirds,withFreshPhotos} from './progress.mjs';
import {accuracyStatistics,sortAccuracy,speciesAccuracy,listQuizSettings} from './statistics.mjs';
import {ID_TIPS,tipsFor,annotatedBirds,annotationSvg,applySharedTips} from './id-tips.mjs';
const $=id=>document.getElementById(id);
let data,queue=[],index=0,answers=[],answered=false,currentPhoto=null,photoTry=0,imageReady=false,sessionToken=0,photoOrder=[];
let activeSettings=null,audioCatalog={version:1,recordings:{}};
const histories={photo:emptyProgress(),audio:emptyProgress()},storageUsable={photo:true,audio:true};
const selectedMedium=()=>$('medium').value;
const statsMedium=()=>$('stats-medium').value;
const mediumName=m=>m==='audio'?'audio':'visual';
let audioTimer=null,mediaLoadToken=0;
let familiesExpanded=false,sitesExpanded=false;
let speciesScope=null;
let activeTips=null;
let starting=false,hasSharedTips=false;
async function loadSharedTips(){
  try{
    const response=await fetch('/api/annotations',{cache:'no-store',signal:AbortSignal.timeout(6000)});if(!response.ok)throw Error();
    const result=await response.json();applySharedTips(result.annotations);hasSharedTips=true;
    $('shared-tip-status').textContent=`Shared reviews: ${result.coverage.covered} species · ${result.coverage.approved} approved photos. General text is available for species with published tips; other species are not yet covered.`;
  }catch{$('shared-tip-status').textContent=hasSharedTips?'Shared reviews could not refresh. Using the last loaded tips for this visit.':'Shared reviews are unavailable. The built-in six-photo pilot and three species summaries remain available.';}
}
const formatRate=rate=>rate===null?'—':new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:1}).format(rate);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderStatistics(){
  if(!data)return;
  $('accuracy-title').textContent=`Your ${mediumName(statsMedium())} ID accuracy`;
  $('stats-medium-help').textContent=statsMedium()==='audio'?'Audio history only. Site rates combine answers for that site’s target species from all audio scopes and recording locations; they do not measure mastery of a local dialect.':'Visual history only. Existing photo-quiz history is retained. Audio answers do not affect these rates.';
  const stats=accuracyStatistics(data.birds,data.sites,histories[statsMedium()]);
  const rowsHTML=(rows,kind)=>rows.map(row=>`<li class="accuracy-row"><a class="accuracy-name accuracy-link" href="#species/${statsMedium()}/${kind}/${encodeURIComponent(row.id)}">${escapeHTML(row.name)}</a><span class="accuracy-value"><strong>${formatRate(row.rate)}</strong><small>${row.total?`${row.correct} / ${row.total} correct`:'No answers yet'}</small></span></li>`).join('');
  const sites=sortAccuracy(stats.sites,$('site-stat-sort').value,$('site-stat-direction').value);
  $('site-accuracy-list').innerHTML=rowsHTML(sitesExpanded?sites:sites.slice(0,5),'site');
  $('site-expand').hidden=sites.length<=5;
  $('site-expand').setAttribute('aria-expanded',String(sitesExpanded));
  $('site-expand').textContent=sitesExpanded?'▾ Show first 5 sites':`▸ Show all ${sites.length} sites`;
  const families=sortAccuracy(stats.families,$('family-stat-sort').value,$('family-stat-direction').value);
  $('family-accuracy-list').innerHTML=rowsHTML(familiesExpanded?families:families.slice(0,10),'family');
  $('family-expand').hidden=families.length<=10;
  $('family-expand').setAttribute('aria-expanded',String(familiesExpanded));
  $('family-expand').textContent=familiesExpanded?'▾ Show first 10 families':`▸ Show all ${families.length} families`;
}
function renderSpeciesList(){
  if(!data||!speciesScope)return;
  const {kind,id}=speciesScope;
  const rows=speciesAccuracy(data.birds,histories[speciesScope.medium],kind,id);
  const title=kind==='site'?data.sites.find(s=>s.code===id)?.name:id;
  $('species-title').textContent=title;
  $('species-kind').textContent=kind==='site'?'SITE SPECIES':'FAMILY SPECIES';
  $('species-subtitle').textContent=`${rows.length} species · ${mediumName(speciesScope.medium)} statistics · ${kind==='site'?'All families · X-marked targets':'All sites'}`;
  const sorted=sortAccuracy(rows,$('species-sort').value,$('species-direction').value);
  $('species-rows').innerHTML=sorted.map(row=>`<tr><td><strong>${escapeHTML(row.name)}</strong><span class="species-scientific">${escapeHTML(row.scientificName)}</span></td><td class="species-rate"><strong>${formatRate(row.rate)}</strong><small>${row.total?`${row.correct} / ${row.total} correct`:'No answers yet'}</small></td></tr>`).join('');
  const settings=listQuizSettings(kind,id);
  const scoped=eligibleBirds(data.birds,settings.site,'none',settings.family);
  const ready=speciesScope.medium==='audio'?audioBirds(scoped,audioCatalog,settings.site):scoped;
  $('species-start').disabled=!ready.some(b=>b.photos.length);
  $('species-explanation').textContent=`${mediumName(speciesScope.medium)==='audio'?'Audio':'Visual'} correct IDs ÷ scored attempts, using each species’ last 20 attempts in this medium. Regular quizzes and reviews both count. Revealed answers count as misses; unavailable media do not count. — means no answers yet.${speciesScope.medium==='audio'?` ${ready.filter(b=>b.photos.length).length} of these species currently have audio in this quiz’s catalog.`:''}`;
  $('species-start').textContent=kind==='site'?'Start site quiz →':'Start family quiz →';
}
function navigateSpeciesHash(){
  if(!data)return;
  sessionToken++;stopAudio();
  let parts;try{parts=location.hash.slice(1).split('/').map(decodeURIComponent);}catch{parts=[];}
  const [route,...rest]=parts;
  const [medium,kind,id]=rest.length===3?rest:[statsMedium(),...rest];
  const valid=route==='species'&&['photo','audio'].includes(medium)&&((kind==='site'&&data.sites.some(s=>s.code===id))||(kind==='family'&&data.birds.some(b=>familyName(b.family)===id)));
  if(valid){
    speciesScope={medium,kind,id};$('stats-medium').value=medium;$('species-sort').value='taxonomy';$('species-direction').value='asc';$('species-count').value='20';
    readProgress(medium);renderSpeciesList();showView('species-page');$('species-title').focus({preventScroll:true});
  }else{speciesScope=null;showView('setup');}
}
function selectedFilter(){return document.querySelector('input[name="filter"]:checked').value;}
function formSettings(){return {medium:selectedMedium(),mode:document.querySelector('input[name="mode"]:checked').value,site:$('site').value,family:$('family').value,count:Number($('count').value),filter:selectedFilter(),experimentalTips:selectedMedium()==='photo'&&$('experimental-tips').checked};}
function pool(settings=formSettings()){
  const medium=settings.medium||'photo';
  const birds=settings.mode==='review'?reviewBirds(data.birds,histories[medium],settings.site,settings.family,settings.mistakeIds):eligibleBirds(data.birds,settings.site,settings.filter,settings.family);
  if(medium==='audio')return audioBirds(birds,audioCatalog,settings.site);
  return settings.pilotTips?annotatedBirds(birds):birds;
}
function readProgress(medium=selectedMedium()){
  if(!storageUsable[medium])return;
  try{histories[medium]=parseProgress(localStorage.getItem(progressKey(medium)));}
  catch{storageUsable[medium]=false;$('storage-status').textContent=`Saved ${mediumName(medium)} progress could not be read. This visit will still track your answers.`;}
}
function rememberAnswer(bird,correct){
  if(activeSettings.experimentalTips)return;
  const medium=activeSettings.medium||'photo';
  readProgress(medium);histories[medium]=recordAttempt(histories[medium],bird.id,correct);
  if(storageUsable[medium])try{localStorage.setItem(progressKey(medium),JSON.stringify(histories[medium]));$('storage-status').textContent='Visual and audio progress are saved separately in this browser. Other browsers and devices have separate histories.';}
  catch{storageUsable[medium]=false;$('storage-status').textContent=`Browser storage is unavailable for ${mediumName(medium)} practice. Progress is tracked for this visit.`;}
  renderStatistics();
}
function updatePool(){
  if(!data)return;
  const medium=selectedMedium(),audio=medium==='audio';
  $('photo-tip-options').hidden=audio;$('try-id-pilot').hidden=audio||!$('experimental-tips').checked;$('try-id-pilot').disabled=!Object.keys(ID_TIPS).length;
  const settings=formSettings(),review=settings.mode==='review',familyMode=!review&&settings.family!=='all',birds=pool(settings),ready=questionPool(birds,familyMode),requested=settings.count;
  $('lifer-filters').hidden=review;$('lifer-filters').disabled=review;$('review-help').hidden=!review;
  $('review-help').textContent=`Review species missed more than 25% of the time over their last 20 ${mediumName(medium)} attempts (or all if fewer). Visual and audio mistakes are separate. Revealed answers count as misses; unavailable media do not count.`;
  $('family-help').textContent=review?'Site and family filters apply to mistakes in the selected medium. Each species appears once.':`Choose a family to practice different ${audio?'recordings':'photos'} of the same species. Site and lifer filters still apply.`;
  let base=review?reviewBirds(data.birds,histories[medium],settings.site):eligibleBirds(data.birds,settings.site,settings.filter);
  if(audio)base=audioBirds(base,audioCatalog,settings.site).filter(b=>b.photos.length);
  for(const option of $('family').options){if(option.value==='all')continue;const n=base.filter(b=>familyName(b.family)===option.value).length;option.textContent=`${option.value} · ${n} species`;}
  const covered=birds.filter(b=>b.photos.length).length;
  $('pool').textContent=!ready.length?(review?(recentMistakeIds(histories[medium]).length?`No playable ${mediumName(medium)} review birds match these filters. Try another site or family.`:`No ${mediumName(medium)} birds currently exceed a 25% miss rate. Start a regular quiz to practice.`):`No ${audio?'verified recordings':'photos'} match these filters. Try another family, site, or lifer filter.`):`${covered} ${review?'species to review':'eligible species with '+(audio?'audio':'photos')}${audio?` / ${birds.length} scoped species`:''} · ${ready.length} ${familyMode?(audio?'recordings':'different photographs')+'. Species may repeat.':'species questions.'}${requested>ready.length?` Quiz will use ${ready.length} questions.`:''}`;
  $('audio-scope-help').hidden=!audio;
  if(audio){const tiers=[0,0,0,0,0,0];for(const bird of birds)if(bird.photos.length)tiers[bird.photos[0].match.rank]++;$('audio-scope-help').textContent=`Best matches for this scope: ${tiers[0]+tiers[1]} site-area · ${tiers[2]} same-department · ${tiers[3]} Colombia-wide · ${tiers[4]+tiers[5]} outside-Colombia fallbacks. These counts describe our current catalog, not the entire archive. Department matches do not establish the same elevation or population. Subspecies matching is not yet verified. Site dropdown counts include all target species; audio coverage is shown above.`;}
  $('count').removeAttribute('max');$('start').disabled=!ready.length;
}
function showView(id){stopAudio();for(const v of ['setup','session','results','species-page'])$(v).hidden=v!==id;if(id==='setup')renderStatistics();window.scrollTo({top:0,behavior:'instant'});}
async function begin(settings=formSettings()){
  if(starting)return;
  const count=settings.count;
  if(!Number.isInteger(count)||count<1){$('settings-error').textContent='Choose a whole number of questions, at least 1.';return;}
  settings={...settings,medium:settings.medium||'photo'};
  readProgress(settings.medium);starting=true;if(settings.medium==='photo')await loadSharedTips();starting=false;
  $('medium').value=settings.medium;
  $('settings-error').textContent='';
  const review=settings.mode==='review',familyMode=!review&&(settings.pilotTips||settings.family!=='all');
  const birds=review?withFreshPhotos(pool(settings),settings.avoidPhotoIds):pool(settings);
  queue=buildQuestions(birds,count,familyMode);
  if(!queue.length){showView('setup');updatePool();$('settings-error').textContent=review?'No species currently need review with these settings. Choose a regular quiz or change your filters.':'No species match these settings.';return;}
  activeSettings={...settings};
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  index=0;answers=[];showView('session');
  const siteLabel=settings.site==='all'?'Entire trip checklist':data.sites.find(s=>s.code===settings.site)?.name||settings.site;
  $('session-label').textContent=mediumName(settings.medium).toUpperCase()+' · '+(review?(settings.mistakeIds?'Review this quiz’s mistakes':'Review recent mistakes'):'Regular quiz')+' · '+siteLabel+(settings.family!=='all'?' · '+settings.family:'')+(review?'':' · '+({none:'All species',world:'Worldwide lifers',colombia:'Colombia lifers'}[settings.filter]));
  if(settings.pilotTips)$('session-label').textContent+=' · Reviewed photo sampler';
  if(settings.experimentalTips)$('session-label').textContent+=' · Experimental · history not recorded';
  nextQuestion();
}
function credit(photo,revealName=false){
  const owner=photo.recordist||photo.photographer||photo.alt?.split(' - ').slice(1).join(' - ')||'Macaulay Library contributor';
  return `${revealName?escapeHTML(queue[index].name)+' · ':''}© ${escapeHTML(owner)} · Cornell Lab of Ornithology | Macaulay Library${revealName?` · <a href="${escapeHTML(photo.source)}" target="_blank" rel="noopener noreferrer">ML${escapeHTML(photo.id)} ↗</a>`:''}`;
}
function loadPhoto(){
  const bird=queue[index],token=sessionToken;
  currentPhoto=photoOrder[photoTry%photoOrder.length];imageReady=false;
  $('question-image').hidden=true;$('image-loading').hidden=false;$('image-error').hidden=true;$('unavailable').hidden=true;
  $('check').disabled=true;$('reveal').disabled=true;
  const image=$('question-image');
  image.onload=()=>{if(token!==sessionToken)return;imageReady=true;image.hidden=false;$('image-loading').hidden=true;$('check').disabled=false;$('reveal').disabled=false;};
  image.onerror=()=>{if(token!==sessionToken)return;if(photoTry+1<bird.photos.length){photoTry++;loadPhoto();return;}$('image-loading').hidden=true;$('image-error').hidden=false;$('unavailable').hidden=false;};
  image.alt='Bird to identify';image.src=currentPhoto.url;
  $('photo-credit').innerHTML=credit(currentPhoto);
}
function stopAudio(){
  clearTimeout(audioTimer);mediaLoadToken++;
  const player=$('question-audio');player.oncanplay=null;player.onplaying=null;player.onerror=null;player.pause();player.removeAttribute('src');player.load();
  document.querySelectorAll('#review audio').forEach(a=>a.pause());
}
function recordingDetails(recording){
  return `<p><strong>${escapeHTML(recording.match.label)}</strong><br>${escapeHTML(recording.match.detail)}</p><p>Location: ${escapeHTML(recording.location)} · ${escapeHTML(recording.department||'Department not catalogued')}, ${escapeHTML(recording.country)}<br>Date: ${escapeHTML(recording.date||'Not catalogued')} · Sound: ${escapeHTML(recording.soundType||'Vocalization type not catalogued')}<br>Recorded subspecies: ${escapeHTML(recording.subspecies||'Not identified in catalog')}. Site subspecies: unconfirmed.</p>`;
}
function loadAudio(){
  stopAudio();const token=sessionToken,load=mediaLoadToken;
  $('retry-audio').disabled=false;
  currentPhoto=photoOrder[photoTry%photoOrder.length];imageReady=false;
  $('check').disabled=true;$('reveal').disabled=true;$('unavailable').hidden=false;$('audio-error').hidden=true;$('audio-loading').hidden=false;$('audio-loading').textContent='Loading recording…';$('audio-credit').textContent='Recording credit and locality are shown after answering.';
  const player=$('question-audio'),valid=()=>token===sessionToken&&load===mediaLoadToken;
  player.setAttribute('aria-label','Bird vocalization to identify');
  player.oncanplay=()=>{if(!valid())return;clearTimeout(audioTimer);$('audio-loading').hidden=false;$('audio-loading').textContent='Press Play, then enter your identification. You can replay as often as you like.';$('audio-error').hidden=true;};
  player.onplaying=()=>{if(!valid())return;clearTimeout(audioTimer);imageReady=true;$('audio-loading').textContent='Listen again whenever you like. Enter the common or scientific species name.';$('check').disabled=answered;$('reveal').disabled=answered;};
  player.onerror=()=>{if(!valid())return;clearTimeout(audioTimer);if(answered){$('audio-error').hidden=false;return;}if(photoTry+1<photoOrder.length){photoTry++;loadAudio();return;}$('audio-loading').hidden=true;$('audio-error').hidden=false;$('unavailable').hidden=false;};
  player.src=currentPhoto.url;player.load();
  audioTimer=setTimeout(()=>{if(!valid()||imageReady||answered)return;$('audio-error').hidden=false;$('unavailable').hidden=false;$('audio-loading').textContent='The recording is taking longer than expected. You can retry or continue without scoring.';},15000);
}
function nextQuestion(){
  stopAudio();const audio=activeSettings.medium==='audio';
  activeTips=null;$('show-id-features').hidden=true;$('show-id-features').setAttribute('aria-expanded','false');$('id-features').hidden=true;$('id-tip-diagram').innerHTML='';$('id-tip-general').innerHTML='';$('id-tip-credit').textContent='';$('id-tip-source').innerHTML='';
  sessionToken++;answered=false;photoTry=0;photoOrder=audio?queue[index].photos:shuffle(queue[index].photos);
  $('photo-question').hidden=audio;$('audio-question').hidden=!audio;
  $('retry-photo').textContent=photoOrder.length>1?'Try another photo':'Retry photo';
  $('retry-audio').textContent=photoOrder.length>1?'Try another recording':'Retry recording';
  $('unavailable').textContent=audio?'Skip unclear/unavailable recording · unscored':'Continue without scoring this question';
  $('question-number').textContent=`QUESTION ${index+1} / ${queue.length}`;$('progress').style.width=`${index/queue.length*100}%`;$('score').textContent=`${answers.filter(a=>a.correct).length} correct`;
  $('answer').value='';$('answer').disabled=false;$('answer-form').hidden=false;$('reveal').hidden=false;$('next').hidden=true;$('feedback').innerHTML='';$('question-status').textContent=audio?'VOCALIZATION IDENTIFICATION':'PHOTO IDENTIFICATION';
  if(audio)loadAudio();else loadPhoto();$('answer').focus();
}
function finishAnswer(revealed=false){
  if(answered||!imageReady)return;
  const guess=$('answer').value.trim();if(!revealed&&!guess)return;
  answered=true;
  $('unavailable').hidden=true;
  $('retry-audio').disabled=true;
  const bird=queue[index],grade=revealed?{correct:false,fuzzy:false}:gradeAnswer(guess,bird,data.birds);
  answers.push({bird,guess,correct:grade.correct,revealed,photo:currentPhoto});
  rememberAnswer(bird,grade.correct);
  $('answer').disabled=true;$('check').disabled=true;$('reveal').hidden=true;$('next').hidden=false;$('question-status').textContent=grade.correct?'IDENTIFIED':'KEEP LEARNING';
  if(activeSettings.medium==='audio'){$('audio-credit').innerHTML=credit(currentPhoto,true)+recordingDetails(currentPhoto);$('question-audio').setAttribute('aria-label',bird.name+' recording');}else{$('photo-credit').innerHTML=credit(currentPhoto,true);$('question-image').alt=bird.name;}
  activeTips=tipsFor(bird,currentPhoto,{enabled:activeSettings.medium!=='audio'&&Boolean(activeSettings.experimentalTips),answered:true,correct:grade.correct});
  $('show-id-features').hidden=!activeTips;
  $('show-id-features').textContent=activeTips?.kind==='general'?'Show general ID tips · experimental':'Show ID features · experimental';
  const badges=[bird.worldLifer?'Potential worldwide lifer':'',bird.colombiaLifer?'Potential Colombia lifer':''].filter(Boolean).join(' · ');
  $('feedback').innerHTML=`<strong class="${grade.correct?'correct':'incorrect'}">${grade.correct?(grade.fuzzy?'Correct — small typo accepted.':'Correct!'):(revealed?'Answer revealed':'Not quite.')}</strong><h3>${escapeHTML(bird.name)}</h3><em>${escapeHTML(bird.scientificName)}</em>${badges?`<p>${badges}</p>`:''}<p><a href="https://ebird.org/species/${encodeURIComponent(bird.id)}" target="_blank" rel="noopener noreferrer">Study this species ↗</a></p>`;
  $('score').textContent=`${answers.filter(a=>a.correct).length} correct`;$('next').textContent=index===queue.length-1?'See results →':'Next bird →';$('next').focus();
}
function advance(){if(index+1<queue.length){index++;nextQuestion();}else finish();}
function finish(){
  showView('results');sessionToken++;
  const audio=activeSettings.medium==='audio';
  const scored=answers.filter(a=>!a.unavailable),correct=scored.filter(a=>a.correct).length;
  $('result-title').textContent=`${correct} / ${scored.length} identified.`;
  $('result-summary').textContent=`${mediumName(activeSettings.medium)} practice · ${scored.length?Math.round(correct/scored.length*100)+'% correct.':'No questions could be scored.'}${answers.length>scored.length?` ${answers.length-scored.length} skipped or unavailable ${audio?'recordings':'photos'} were not scored.`:''} Review your birds below, then choose your next session.`;
  const mistakes=sessionMistakeIds(answers);
  if(activeSettings.experimentalTips)$('result-summary').textContent+=' Experimental session: these answers were not added to statistics or recent mistake history.';
  $('review-quiz').disabled=!mistakes.length;$('review-quiz').textContent=`Review this quiz’s mistakes (${mistakes.length}) →`;
  $('result-review-help').textContent=mistakes.length?'Review covers the species you missed in this quiz, regardless of their overall miss rate. Different media are used when available, within the same practice medium and geographic preference tier.':'No mistaken IDs in this quiz to review.';
  $('review').innerHTML=answers.map(a=>`<article class="review-row ${audio?'audio-review':''}">${audio?`<audio controls preload="none" aria-label="${escapeHTML(a.bird.name)} recording" src="${escapeHTML(a.photo.url)}"></audio>`:`<img src="${escapeHTML(a.photo.url)}" alt="${escapeHTML(a.bird.name)}" loading="lazy">`}<div><h3>${escapeHTML(a.bird.name)}</h3><p>${escapeHTML(a.bird.scientificName)}</p><p>${a.unavailable?'Skipped or unavailable':a.revealed?'Answer revealed':`Your answer: ${escapeHTML(a.guess)}`}</p><a href="${escapeHTML(a.photo.source)}" target="_blank" rel="noopener noreferrer">© ${escapeHTML(a.photo.recordist||a.photo.photographer)} · Macaulay Library ML${escapeHTML(a.photo.id)} ↗</a>${audio?recordingDetails(a.photo):''}</div><span class="review-status">${a.unavailable?'Not scored':a.correct?'✓ Correct':'↻ Review'}</span></article>`).join('');
}
$('settings').addEventListener('submit',e=>{e.preventDefault();begin();});
$('settings').addEventListener('change',e=>{if(e.target.name==='mode'&&data){$('settings-error').textContent='';readProgress();updatePool();}});
$('experimental-tips').addEventListener('change',updatePool);
$('try-id-pilot').addEventListener('click',()=>{
  if(selectedMedium()!=='photo'||!$('experimental-tips').checked)return;
  $('site').value='all';$('family').value='all';$('count').value=String(Math.min(20,Object.keys(ID_TIPS).length));
  document.querySelector('input[name="mode"][value="regular"]').checked=true;
  document.querySelector('input[name="filter"][value="none"]').checked=true;
  updatePool();begin({...formSettings(),pilotTips:true});
});
$('show-id-features').addEventListener('click',()=>{
  if(!activeTips||!answered||!activeSettings.experimentalTips)return;
  const reveal=$('id-features').hidden;
  $('id-features').hidden=!reveal;$('show-id-features').setAttribute('aria-expanded',String(reveal));
  const general=activeTips.kind==='general',label=general?'general ID tips':'ID features';
  $('show-id-features').textContent=`${reveal?'Hide':'Show'} ${label} · experimental`;
  if(reveal){
    $('id-features-title').textContent=general?'General species ID tips':'Photo ID features';
    $('id-tip-general').hidden=!general;$('id-tip-figure').hidden=general;$('id-tip-mobile-help').hidden=general;
    $('id-tip-general').innerHTML=general?`<p>These species-level features have not been checked against this photograph and may be hidden or difficult to see. No arrows are provided for this photo.</p><ul>${activeTips.tips.map(tip=>`<li>${escapeHTML(tip)}</li>`).join('')}</ul>`:'';
    $('id-tip-diagram').innerHTML=general?'':annotationSvg(activeTips.annotation,currentPhoto,queue[index].name);
    $('id-tip-credit').innerHTML=general?'':credit(currentPhoto,true);
    $('id-tip-source').innerHTML=`Source: <a href="${escapeHTML(activeTips.source)}" target="_blank" rel="noopener noreferrer">eBird / Merlin: ${escapeHTML(queue[index].name)} ↗</a> — Cornell Lab of Ornithology. ID guidance is paraphrased from this account, not original research by this quiz. Consult the source for full context. Summaries and arrow placements are this quiz’s experimental adaptations; they have not been reviewed or endorsed by Cornell.`;
    $('id-features').scrollIntoView({behavior:'smooth',block:'start'});$('id-features').focus({preventScroll:true});
  }
});
$('site').addEventListener('change',updatePool);$('family').addEventListener('change',updatePool);document.querySelectorAll('input[name="filter"]').forEach(el=>el.addEventListener('change',updatePool));$('count').addEventListener('input',()=>{if(data)updatePool();});
$('answer-form').addEventListener('submit',e=>{e.preventDefault();finishAnswer();});$('reveal').addEventListener('click',()=>finishAnswer(true));
$('next').addEventListener('click',advance);
$('retry-audio').addEventListener('click',()=>{photoTry=(photoTry+1)%photoOrder.length;loadAudio();});
$('retry-photo').addEventListener('click',()=>{photoTry=(photoTry+1)%queue[index].photos.length;loadPhoto();});
$('unavailable').addEventListener('click',()=>{if(answered)return;answers.push({bird:queue[index],guess:'',correct:false,unavailable:true,photo:currentPhoto});advance();});
function startOver(){sessionToken++;$('settings').reset();$('settings-error').textContent='';updatePool();showView('setup');}
$('exit').addEventListener('click',()=>{sessionToken++;updatePool();showView('setup');});
$('new-quiz').addEventListener('click',startOver);
$('again').addEventListener('click',()=>begin(activeSettings));
$('review-quiz').addEventListener('click',()=>{
  const mistakeIds=sessionMistakeIds(answers);if(!mistakeIds.length)return;
  const settings={...activeSettings,mode:'review',filter:'none',mistakeIds,avoidPhotoIds:answers.map(a=>a.photo.id)};
  document.querySelector('input[name="mode"][value="review"]').checked=true;
  updatePool();begin(settings);
});
$('medium').addEventListener('change',()=>{readProgress();$('stats-medium').value=selectedMedium();updatePool();renderStatistics();});
$('stats-medium').addEventListener('change',()=>{readProgress(statsMedium());renderStatistics();});
document.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause();});},true);
for(const id of ['site-stat-sort','site-stat-direction','family-stat-sort','family-stat-direction'])$(id).addEventListener('change',renderStatistics);
$('family-expand').addEventListener('click',()=>{familiesExpanded=!familiesExpanded;renderStatistics();});
$('site-expand').addEventListener('click',()=>{sitesExpanded=!sitesExpanded;renderStatistics();});
for(const id of ['species-sort','species-direction'])$(id).addEventListener('change',renderSpeciesList);
$('species-quiz').addEventListener('submit',e=>{
  e.preventDefault();if(!speciesScope)return;
  const settings=listQuizSettings(speciesScope.kind,speciesScope.id,Number($('species-count').value));
  settings.medium=speciesScope.medium;$('medium').value=settings.medium;settings.experimentalTips=settings.medium==='photo'&&$('experimental-tips').checked;
  $('site').value=settings.site;$('family').value=settings.family;$('count').value=String(settings.count);
  document.querySelector('input[name="mode"][value="regular"]').checked=true;
  document.querySelector('input[name="filter"][value="none"]').checked=true;
  updatePool();begin(settings);
});
window.addEventListener('hashchange',navigateSpeciesHash);
window.addEventListener('storage',e=>{if(e.key===PROGRESS_KEY||e.key===AUDIO_PROGRESS_KEY||e.key===null){readProgress('photo');readProgress('audio');if(data){updatePool();renderStatistics();renderSpeciesList();}}});
try{
  const response=await fetch('data.json',{cache:'no-store'});if(!response.ok)throw new Error('Checklist unavailable');data=await response.json();
  $('site').options[0].textContent=`Entire trip checklist (${data.birds.length})`;
  for(const site of data.sites){const count=eligibleBirds(data.birds,site.code).length;const option=document.createElement('option');option.value=site.code;option.textContent=`${site.code} · ${site.name} (${count})`;$('site').append(option);}
  // Bird records follow the checklist's taxonomic order; preserve each family's first occurrence.
  for(const family of new Set(data.birds.map(b=>familyName(b.family)))){const option=document.createElement('option');option.value=family;option.textContent=family;$('family').append(option);}
  $('total').textContent=data.summary.species;$('world-total').textContent=data.summary.worldLifers;$('co-total').textContent=data.summary.colombiaLifers;
  const covered=data.birds.filter(b=>b.photos.length).length;$('coverage').textContent=`Macaulay photo records: ${covered} of ${data.birds.length} species. Image availability depends on Macaulay Library’s image server.${covered<data.birds.length?' Species without a photo record are excluded from question selection and remain in the checklist totals.':''}`;
  const hero=data.birds.find(b=>b.name==='Multicolored Tanager'&&b.photos.length)||data.birds.find(b=>b.photos.length);
  if(hero){$('hero-photo').onerror=()=>{$('hero-photo').hidden=true;$('hero-label').textContent='Macaulay photograph unavailable';$('hero-credit').textContent='The image server could not deliver this photo. Please try again later.';};$('hero-photo').src=hero.photos[0].url;$('hero-photo').alt=hero.name;$('hero-label').textContent=hero.name;$('hero-credit').textContent=`© ${hero.photos[0].photographer} · Macaulay Library ML${hero.photos[0].id}`;}
  try{const response=await fetch('audio.json',{cache:'no-store'});if(!response.ok)throw Error();const received=await response.json();validateAudioCatalog(received,data.birds);audioCatalog=received;$('audio-coverage').textContent=`Audio catalog: ${Object.keys(audioCatalog.recordings).length} of ${data.birds.length} species · ${Object.values(audioCatalog.recordings).reduce((n,a)=>n+a.length,0)} verified recording records. Coverage is incomplete; counts and location preferences apply only to this catalog, not the entire Macaulay archive.`;}catch{audioCatalog={version:1,recordings:{}};$('medium').querySelector('option[value=audio]').disabled=true;$('audio-coverage').textContent='Audio catalog could not load. Visual quizzes remain available.';}
  await loadSharedTips();
  readProgress('photo');readProgress('audio');updatePool();renderStatistics();
  if(location.hash)navigateSpeciesHash();
}catch(error){$('pool').textContent='Could not load the checklist. Please reload the page.';$('settings-error').textContent=error.message;}
