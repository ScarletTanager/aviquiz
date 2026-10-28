import {eligibleBirds,gradeAnswer,shuffle,familyName,questionPool,buildQuestions} from './quiz.mjs';
const $=id=>document.getElementById(id);
let data,queue=[],index=0,answers=[],answered=false,currentPhoto=null,photoTry=0,imageReady=false,sessionToken=0,photoOrder=[];
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function selectedFilter(){return document.querySelector('input[name="filter"]:checked').value;}
function pool(){return eligibleBirds(data.birds,$('site').value,selectedFilter(),$('family').value);}
function updatePool(){
  const familyMode=$('family').value!=='all',birds=pool(),ready=questionPool(birds,familyMode),requested=Number($('count').value);
  const base=eligibleBirds(data.birds,$('site').value,selectedFilter());
  for(const option of $('family').options){if(option.value==='all')continue;const n=base.filter(b=>familyName(b.family)===option.value).length;option.textContent=`${option.value} · ${n} species`;}
  $('pool').textContent=!ready.length?'No species match these filters. Try another family, site, or lifer filter.':`${birds.length} eligible species · ${ready.length} ${familyMode?'different photographs. Species may repeat.':'with photo records'}${requested>ready.length?` Quiz will use ${ready.length} questions.`:''}`;
  // Keep the requested number editable; selection is capped to the available pool.
  $('count').removeAttribute('max');
  $('start').disabled=!ready.length;
}
function showView(id){for(const v of ['setup','session','results'])$(v).hidden=v!==id;window.scrollTo({top:0,behavior:'instant'});}
function begin(){
  const count=Number($('count').value);
  if(!Number.isInteger(count)||count<1){$('settings-error').textContent='Choose a whole number of questions, at least 1.';return;}
  $('settings-error').textContent='';
  const familyMode=$('family').value!=='all';
  queue=buildQuestions(pool(),count,familyMode);if(!queue.length)return;
  index=0;answers=[];showView('session');
  $('session-label').textContent=$('site').selectedOptions[0].textContent+(familyMode?' · '+$('family').value:'')+' · '+({none:'All species',world:'Worldwide lifers',colombia:'Colombia lifers'}[selectedFilter()]);
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
  $('answer').disabled=true;$('check').disabled=true;$('reveal').hidden=true;$('next').hidden=false;$('question-status').textContent=grade.correct?'IDENTIFIED':'KEEP LEARNING';
  $('photo-credit').innerHTML=credit(currentPhoto,true);$('question-image').alt=bird.name;
  const badges=[bird.worldLifer?'Potential worldwide lifer':'',bird.colombiaLifer?'Potential Colombia lifer':''].filter(Boolean).join(' · ');
  $('feedback').innerHTML=`<strong class="${grade.correct?'correct':'incorrect'}">${grade.correct?(grade.fuzzy?'Correct — small typo accepted.':'Correct!'):(revealed?'Answer revealed':'Not quite.')}</strong><h3>${escapeHTML(bird.name)}</h3><em>${escapeHTML(bird.scientificName)}</em>${badges?`<p>${badges}</p>`:''}<p><a href="https://ebird.org/species/${encodeURIComponent(bird.id)}" target="_blank" rel="noopener noreferrer">Study this species ↗</a></p>`;
  $('score').textContent=`${answers.filter(a=>a.correct).length} correct`;$('next').textContent=index===queue.length-1?'See results →':'Next bird →';$('next').focus();
}
function advance(){if(index+1<queue.length){index++;nextQuestion();}else finish();}
function finish(){
  showView('results');sessionToken++;
  const scored=answers.filter(a=>!a.unavailable),correct=scored.filter(a=>a.correct).length;
  $('result-title').textContent=`${correct} / ${scored.length} identified.`;
  $('result-summary').textContent=`${scored.length?Math.round(correct/scored.length*100):0}% correct.${answers.length>scored.length?` ${answers.length-scored.length} unavailable photos were not scored.`:''} Review your birds below, then try a fresh set.`;
  $('review').innerHTML=answers.map(a=>`<article class="review-row"><img src="${escapeHTML(a.photo.url)}" alt="${escapeHTML(a.bird.name)}" loading="lazy"><div><h3>${escapeHTML(a.bird.name)}</h3><p>${escapeHTML(a.bird.scientificName)}</p><p>${a.unavailable?'Photo unavailable':a.revealed?'Answer revealed':`Your answer: ${escapeHTML(a.guess)}`}</p><a href="${escapeHTML(a.photo.source)}" target="_blank" rel="noopener noreferrer">© ${escapeHTML(a.photo.photographer)} · Macaulay Library ML${escapeHTML(a.photo.id)} ↗</a></div><span class="review-status">${a.unavailable?'Not scored':a.correct?'✓ Correct':'↻ Review'}</span></article>`).join('');
}
$('settings').addEventListener('submit',e=>{e.preventDefault();begin();});
$('site').addEventListener('change',updatePool);$('family').addEventListener('change',updatePool);document.querySelectorAll('input[name="filter"]').forEach(el=>el.addEventListener('change',updatePool));$('count').addEventListener('input',()=>{if(data)updatePool();});
$('answer-form').addEventListener('submit',e=>{e.preventDefault();finishAnswer();});$('reveal').addEventListener('click',()=>finishAnswer(true));
$('next').addEventListener('click',advance);
$('retry-photo').addEventListener('click',()=>{photoTry=(photoTry+1)%queue[index].photos.length;loadPhoto();});
$('unavailable').addEventListener('click',()=>{answers.push({bird:queue[index],guess:'',correct:false,unavailable:true,photo:currentPhoto});advance();});
$('exit').addEventListener('click',()=>{sessionToken++;showView('setup');});$('new-quiz').addEventListener('click',()=>showView('setup'));$('again').addEventListener('click',begin);
try{
  const response=await fetch('data.json');if(!response.ok)throw new Error('Checklist unavailable');data=await response.json();
  for(const site of data.sites){const option=document.createElement('option');option.value=site.code;option.textContent=`${site.code} · ${site.name}`;$('site').append(option);}
  for(const family of [...new Set(data.birds.map(b=>familyName(b.family)))].sort()){const option=document.createElement('option');option.value=family;option.textContent=family;$('family').append(option);}
  $('total').textContent=data.summary.species;$('world-total').textContent=data.summary.worldLifers;$('co-total').textContent=data.summary.colombiaLifers;
  const covered=data.birds.filter(b=>b.photos.length).length;$('coverage').textContent=`Macaulay photo records: ${covered} of ${data.birds.length} species. Image availability depends on Macaulay Library’s image server.${covered<data.birds.length?' Species without a photo record are excluded from question selection and remain in the checklist totals.':''}`;
  const hero=data.birds.find(b=>b.name==='Multicolored Tanager'&&b.photos.length)||data.birds.find(b=>b.photos.length);
  if(hero){$('hero-photo').onerror=()=>{$('hero-photo').hidden=true;$('hero-label').textContent='Macaulay photograph unavailable';$('hero-credit').textContent='The image server could not deliver this photo. Please try again later.';};$('hero-photo').src=hero.photos[0].url;$('hero-photo').alt=hero.name;$('hero-label').textContent=hero.name;$('hero-credit').textContent=`© ${hero.photos[0].photographer} · Macaulay Library ML${hero.photos[0].id}`;}
  updatePool();
}catch(error){$('pool').textContent='Could not load the checklist. Please reload the page.';$('settings-error').textContent=error.message;}
