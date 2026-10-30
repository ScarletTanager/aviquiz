import {eligibleBirds,gradeAnswer,shuffle,familyName,questionPool,buildQuestions} from './quiz.mjs';
import {PROGRESS_KEY,emptyProgress,parseProgress,recordAttempt,recentMistakeIds,sessionMistakeIds,reviewBirds,withFreshPhotos} from './progress.mjs';
import {accuracyStatistics,sortAccuracy,speciesAccuracy,listQuizSettings} from './statistics.mjs';
import {ID_TIPS,annotationFor,annotatedBirds,annotationSvg} from './id-tips.mjs';
const $=id=>document.getElementById(id);
let data,queue=[],index=0,answers=[],answered=false,currentPhoto=null,photoTry=0,imageReady=false,sessionToken=0,photoOrder=[];
let progress=emptyProgress(),activeSettings=null,storageUsable=true;
let familiesExpanded=false,sitesExpanded=false;
let speciesScope=null;
let activeAnnotation=null;
const formatRate=rate=>rate===null?'—':new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:1}).format(rate);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderStatistics(){
  if(!data)return;
  const stats=accuracyStatistics(data.birds,data.sites,progress);
  const rowsHTML=(rows,kind)=>rows.map(row=>`<li class="accuracy-row"><a class="accuracy-name accuracy-link" href="#species/${kind}/${encodeURIComponent(row.id)}">${escapeHTML(row.name)}</a><span class="accuracy-value"><strong>${formatRate(row.rate)}</strong><small>${row.total?`${row.correct} / ${row.total} correct`:'No answers yet'}</small></span></li>`).join('');
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
  const rows=speciesAccuracy(data.birds,progress,kind,id);
  const title=kind==='site'?data.sites.find(s=>s.code===id)?.name:id;
  $('species-title').textContent=title;
  $('species-kind').textContent=kind==='site'?'SITE SPECIES':'FAMILY SPECIES';
  $('species-subtitle').textContent=`${rows.length} species · ${kind==='site'?'All families · X-marked targets':'All sites'}`;
  const sorted=sortAccuracy(rows,$('species-sort').value,$('species-direction').value);
  $('species-rows').innerHTML=sorted.map(row=>`<tr><td><strong>${escapeHTML(row.name)}</strong><span class="species-scientific">${escapeHTML(row.scientificName)}</span></td><td class="species-rate"><strong>${formatRate(row.rate)}</strong><small>${row.total?`${row.correct} / ${row.total} correct`:'No answers yet'}</small></td></tr>`).join('');
  const settings=listQuizSettings(kind,id);
  $('species-start').disabled=!eligibleBirds(data.birds,settings.site,'none',settings.family).some(b=>b.photos.length);
  $('species-start').textContent=kind==='site'?'Start site quiz →':'Start family quiz →';
}
function navigateSpeciesHash(){
  if(!data)return;
  sessionToken++;
  let parts;
  try{parts=location.hash.slice(1).split('/').map(decodeURIComponent);}catch{parts=[];}
  const [route,kind,id]=parts;
  const valid=route==='species'&&parts.length===3&&((kind==='site'&&data.sites.some(s=>s.code===id))||(kind==='family'&&data.birds.some(b=>familyName(b.family)===id)));
  if(valid){
    speciesScope={kind,id};$('species-sort').value='taxonomy';$('species-direction').value='asc';$('species-count').value='20';
    readProgress();renderSpeciesList();showView('species-page');$('species-title').focus({preventScroll:true});
  }else{speciesScope=null;showView('setup');}
}
function selectedFilter(){return document.querySelector('input[name="filter"]:checked').value;}
function formSettings(){return {mode:document.querySelector('input[name="mode"]:checked').value,site:$('site').value,family:$('family').value,count:Number($('count').value),filter:selectedFilter(),experimentalTips:$('experimental-tips').checked};}
function pool(settings=formSettings()){
  const birds=settings.mode==='review'?reviewBirds(data.birds,progress,settings.site,settings.family,settings.mistakeIds):eligibleBirds(data.birds,settings.site,settings.filter,settings.family);
  return settings.pilotTips?annotatedBirds(birds):birds;
}
function readProgress(){
  if(!storageUsable)return;
  try{progress=parseProgress(localStorage.getItem(PROGRESS_KEY));}
  catch{storageUsable=false;$('storage-status').textContent='Saved progress could not be read. This visit will still track your answers.';}
}
function rememberAnswer(bird,correct){
  readProgress();progress=recordAttempt(progress,bird.id,correct);
  renderStatistics();
  if(!storageUsable)return;
  try{localStorage.setItem(PROGRESS_KEY,JSON.stringify(progress));$('storage-status').textContent='Progress saved in this browser. Other browsers and devices have separate histories.';}
  catch{storageUsable=false;$('storage-status').textContent='Browser storage is unavailable. Progress is tracked for this visit but cannot be saved for next time.';}
}
function updatePool(){
  $('try-id-pilot').hidden=!$('experimental-tips').checked;
  const settings=formSettings(),review=settings.mode==='review',familyMode=!review&&settings.family!=='all',birds=pool(settings),ready=questionPool(birds,familyMode),requested=settings.count;
  $('lifer-filters').hidden=review;$('lifer-filters').disabled=review;
  $('review-help').hidden=!review;
  $('family-help').textContent=review?'Site and family filters apply to the species you need to review. Each species appears once.':'Choose a family to practice different photos of the same species. Site and lifer filters still apply.';
  const base=review?reviewBirds(data.birds,progress,settings.site):eligibleBirds(data.birds,settings.site,settings.filter);
  for(const option of $('family').options){if(option.value==='all')continue;const n=base.filter(b=>familyName(b.family)===option.value).length;option.textContent=`${option.value} · ${n} species`;}
  $('pool').textContent=!ready.length?(review?(recentMistakeIds(progress).length?'No review birds match this site and family. Try all sites or all families.':'No birds currently exceed a 25% miss rate. Start a regular quiz to keep practicing.'):'No species match these filters. Try another family, site, or lifer filter.'):`${birds.length} ${review?'species to review':'eligible species'} · ${ready.length} ${familyMode?'different photographs. Species may repeat.':'with photo records'}${requested>ready.length?` Quiz will use ${ready.length} questions.`:''}`;
  // Keep the requested number editable; selection is capped to the available pool.
  $('count').removeAttribute('max');
  $('start').disabled=!ready.length;
}
function showView(id){for(const v of ['setup','session','results','species-page'])$(v).hidden=v!==id;if(id==='setup')renderStatistics();window.scrollTo({top:0,behavior:'instant'});}
function begin(settings=formSettings()){
  const count=settings.count;
  if(!Number.isInteger(count)||count<1){$('settings-error').textContent='Choose a whole number of questions, at least 1.';return;}
  $('settings-error').textContent='';
  const review=settings.mode==='review',familyMode=!review&&settings.family!=='all';
  const birds=review?withFreshPhotos(pool(settings),settings.avoidPhotoIds):pool(settings);
  queue=buildQuestions(birds,count,familyMode);
  if(!queue.length){showView('setup');updatePool();$('settings-error').textContent=review?'No species currently need review with these settings. Choose a regular quiz or change your filters.':'No species match these settings.';return;}
  activeSettings={...settings};
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  index=0;answers=[];showView('session');
  const siteLabel=settings.site==='all'?'Entire trip checklist':data.sites.find(s=>s.code===settings.site)?.name||settings.site;
  $('session-label').textContent=(review?(settings.mistakeIds?'Review this quiz’s mistakes':'Review recent mistakes'):'Regular quiz')+' · '+siteLabel+(settings.family!=='all'?' · '+settings.family:'')+(review?'':' · '+({none:'All species',world:'Worldwide lifers',colombia:'Colombia lifers'}[settings.filter]));
  if(settings.pilotTips)$('session-label').textContent+=' · Experimental 6-photo pilot';
  nextQuestion();
}
function credit(photo,revealName=false){
  const owner=photo.photographer||photo.alt?.split(' - ').slice(1).join(' - ')||'Macaulay Library contributor';
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
function nextQuestion(){
  activeAnnotation=null;$('show-id-features').hidden=true;$('show-id-features').setAttribute('aria-expanded','false');$('show-id-features').textContent='Show ID features · experimental';$('id-features').hidden=true;$('id-tip-diagram').innerHTML='';$('id-tip-credit').textContent='';$('id-tip-source').innerHTML='';
  sessionToken++;answered=false;photoTry=0;photoOrder=shuffle(queue[index].photos);
  $('retry-photo').textContent=photoOrder.length>1?'Try another photo':'Retry photo';
  $('question-number').textContent=`QUESTION ${index+1} / ${queue.length}`;
  $('progress').style.width=`${index/queue.length*100}%`;
  $('score').textContent=`${answers.filter(a=>a.correct).length} correct`;
  $('answer').value='';$('answer').disabled=false;$('answer-form').hidden=false;$('reveal').hidden=false;$('next').hidden=true;$('feedback').innerHTML='';$('question-status').textContent='PHOTO IDENTIFICATION';
  loadPhoto();$('answer').focus();
}
function finishAnswer(revealed=false){
  if(answered||!imageReady)return;
  const guess=$('answer').value.trim();if(!revealed&&!guess)return;
  answered=true;
  const bird=queue[index],grade=revealed?{correct:false,fuzzy:false}:gradeAnswer(guess,bird,data.birds);
  answers.push({bird,guess,correct:grade.correct,revealed,photo:currentPhoto});
  rememberAnswer(bird,grade.correct);
  $('answer').disabled=true;$('check').disabled=true;$('reveal').hidden=true;$('next').hidden=false;$('question-status').textContent=grade.correct?'IDENTIFIED':'KEEP LEARNING';
  $('photo-credit').innerHTML=credit(currentPhoto,true);$('question-image').alt=bird.name;
  activeAnnotation=annotationFor(bird,currentPhoto,{enabled:Boolean(activeSettings.experimentalTips),answered:true,correct:grade.correct});
  $('show-id-features').hidden=!activeAnnotation;
  const badges=[bird.worldLifer?'Potential worldwide lifer':'',bird.colombiaLifer?'Potential Colombia lifer':''].filter(Boolean).join(' · ');
  $('feedback').innerHTML=`<strong class="${grade.correct?'correct':'incorrect'}">${grade.correct?(grade.fuzzy?'Correct — small typo accepted.':'Correct!'):(revealed?'Answer revealed':'Not quite.')}</strong><h3>${escapeHTML(bird.name)}</h3><em>${escapeHTML(bird.scientificName)}</em>${badges?`<p>${badges}</p>`:''}<p><a href="https://ebird.org/species/${encodeURIComponent(bird.id)}" target="_blank" rel="noopener noreferrer">Study this species ↗</a></p>`;
  $('score').textContent=`${answers.filter(a=>a.correct).length} correct`;$('next').textContent=index===queue.length-1?'See results →':'Next bird →';$('next').focus();
}
function advance(){if(index+1<queue.length){index++;nextQuestion();}else finish();}
function finish(){
  showView('results');sessionToken++;
  const scored=answers.filter(a=>!a.unavailable),correct=scored.filter(a=>a.correct).length;
  $('result-title').textContent=`${correct} / ${scored.length} identified.`;
  $('result-summary').textContent=`${scored.length?Math.round(correct/scored.length*100)+'% correct.':'No photographs could be scored.'}${answers.length>scored.length?` ${answers.length-scored.length} unavailable photos were not scored.`:''} Review your birds below, then choose your next session.`;
  const mistakes=sessionMistakeIds(answers);
  $('review-quiz').disabled=!mistakes.length;$('review-quiz').textContent=`Review this quiz’s mistakes (${mistakes.length}) →`;
  $('result-review-help').textContent=mistakes.length?'Review covers the species you missed in this quiz, regardless of their overall miss rate. Fresh photos are used when available.':'No mistaken IDs in this quiz to review.';
  $('review').innerHTML=answers.map(a=>`<article class="review-row"><img src="${escapeHTML(a.photo.url)}" alt="${escapeHTML(a.bird.name)}" loading="lazy"><div><h3>${escapeHTML(a.bird.name)}</h3><p>${escapeHTML(a.bird.scientificName)}</p><p>${a.unavailable?'Photo unavailable':a.revealed?'Answer revealed':`Your answer: ${escapeHTML(a.guess)}`}</p><a href="${escapeHTML(a.photo.source)}" target="_blank" rel="noopener noreferrer">© ${escapeHTML(a.photo.photographer)} · Macaulay Library ML${escapeHTML(a.photo.id)} ↗</a></div><span class="review-status">${a.unavailable?'Not scored':a.correct?'✓ Correct':'↻ Review'}</span></article>`).join('');
}
$('settings').addEventListener('submit',e=>{e.preventDefault();begin();});
$('settings').addEventListener('change',e=>{if(e.target.name==='mode'&&data){$('settings-error').textContent='';readProgress();updatePool();}});
$('experimental-tips').addEventListener('change',updatePool);
$('try-id-pilot').addEventListener('click',()=>{
  if(!$('experimental-tips').checked)return;
  $('site').value='all';$('family').value='Furnariidae';$('count').value=String(Object.keys(ID_TIPS).length);
  document.querySelector('input[name="mode"][value="regular"]').checked=true;
  document.querySelector('input[name="filter"][value="none"]').checked=true;
  updatePool();begin({...formSettings(),pilotTips:true});
});
$('show-id-features').addEventListener('click',()=>{
  if(!activeAnnotation||!answered||!activeSettings.experimentalTips)return;
  const reveal=$('id-features').hidden;
  $('id-features').hidden=!reveal;$('show-id-features').setAttribute('aria-expanded',String(reveal));
  $('show-id-features').textContent=reveal?'Hide ID features · experimental':'Show ID features · experimental';
  if(reveal){
    $('id-tip-diagram').innerHTML=annotationSvg(activeAnnotation,currentPhoto,queue[index].name);
    $('id-tip-credit').innerHTML=credit(currentPhoto,true);
    $('id-tip-source').innerHTML=`ID guidance paraphrased from <a href="${escapeHTML(activeAnnotation.source)}" target="_blank" rel="noopener noreferrer">eBird / Merlin: ${escapeHTML(queue[index].name)} ↗</a>. Photo-specific arrow placements are experimental.`;
    $('id-features').scrollIntoView({behavior:'smooth',block:'start'});$('id-features').focus({preventScroll:true});
  }
});
$('site').addEventListener('change',updatePool);$('family').addEventListener('change',updatePool);document.querySelectorAll('input[name="filter"]').forEach(el=>el.addEventListener('change',updatePool));$('count').addEventListener('input',()=>{if(data)updatePool();});
$('answer-form').addEventListener('submit',e=>{e.preventDefault();finishAnswer();});$('reveal').addEventListener('click',()=>finishAnswer(true));
$('next').addEventListener('click',advance);
$('retry-photo').addEventListener('click',()=>{photoTry=(photoTry+1)%queue[index].photos.length;loadPhoto();});
$('unavailable').addEventListener('click',()=>{answers.push({bird:queue[index],guess:'',correct:false,unavailable:true,photo:currentPhoto});advance();});
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
for(const id of ['site-stat-sort','site-stat-direction','family-stat-sort','family-stat-direction'])$(id).addEventListener('change',renderStatistics);
$('family-expand').addEventListener('click',()=>{familiesExpanded=!familiesExpanded;renderStatistics();});
$('site-expand').addEventListener('click',()=>{sitesExpanded=!sitesExpanded;renderStatistics();});
for(const id of ['species-sort','species-direction'])$(id).addEventListener('change',renderSpeciesList);
$('species-quiz').addEventListener('submit',e=>{
  e.preventDefault();if(!speciesScope)return;
  const settings=listQuizSettings(speciesScope.kind,speciesScope.id,Number($('species-count').value));
  settings.experimentalTips=$('experimental-tips').checked;
  $('site').value=settings.site;$('family').value=settings.family;$('count').value=String(settings.count);
  document.querySelector('input[name="mode"][value="regular"]').checked=true;
  document.querySelector('input[name="filter"][value="none"]').checked=true;
  updatePool();begin(settings);
});
window.addEventListener('hashchange',navigateSpeciesHash);
window.addEventListener('storage',e=>{if(e.key===PROGRESS_KEY||e.key===null){readProgress();if(data){updatePool();renderStatistics();renderSpeciesList();}}});
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
  readProgress();updatePool();renderStatistics();
  if(location.hash)navigateSpeciesHash();
}catch(error){$('pool').textContent='Could not load the checklist. Please reload the page.';$('settings-error').textContent=error.message;}
