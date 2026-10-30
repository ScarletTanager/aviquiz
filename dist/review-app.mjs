import {reviewCoverage,reviewQueue,validateReview} from './review-core.mjs';
import {annotationSvg} from './id-tips.mjs';
const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog,rows=[],bird,photo,documentValue,revision=0,placing=-1,dirty=false,busy=false,imageLoaded=false;
async function request(path,body){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000),...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||'Shared reviews unavailable.');return result;}
const rowFor=id=>rows.find(r=>r.photoId===String(id));
function renderQueue(){
  const c=reviewCoverage(catalog.birds,rows);
  $('review-counts').innerHTML=`<span><strong>${c.covered} / ${c.total}</strong> species covered</span><span><strong>${c.approved}</strong> approved photos</span><span><strong>${c.drafts}</strong> drafts</span><span>Global round <strong>${c.round??'complete'}</strong></span>${c.blocked.length?`<span class="review-blocked">${c.blocked.length} species need replacement candidates</span>`:''}`;
  const queue=reviewQueue(catalog.birds,rows,{family:$('review-family').value,site:$('review-site').value,limit:Number($('review-batch').value)});
  $('review-queue').innerHTML=queue.map(q=>{const b=catalog.birds.find(b=>b.id===q.speciesId),r=rowFor(q.photoId);return `<li><button class="queue-bird" data-species="${escape(b.id)}" data-photo="${q.photoId}" ${photo&&String(photo.id)===q.photoId?'aria-current="true"':''}><strong>${escape(b.name)}</strong><small>${q.count} approved · ${r?.status==='draft'?'saved draft':`round ${q.round}`}${q.ready?'':' · waiting for earlier round'}</small></button></li>`;}).join('')||'<li>No remaining candidates match these filters.</li>';
}
function collect(){
  return {...documentValue,tips:$('general-tips').value.split('\n').map(t=>t.trim()).filter(Boolean),notes:$('review-notes').value,sourceChecked:$('source-checked').checked,photoChecked:$('photo-checked').checked,features:[0,1].flatMap(i=>{
    const title=$(`feature-title-${i}`).value.trim(),lines=[$(`feature-line-${i}-0`).value.trim(),$(`feature-line-${i}-1`).value.trim()].filter(Boolean),point=documentValue.features[i]?.point;
    return title||lines.length||point?[{title,lines,point:point||[-1,-1]}]:[];
  })};
}
function refreshPreview(){
  if(!documentValue)return;
  const doc=collect(),features=doc.features.filter(f=>f.point.every(n=>n>=0&&n<=1));
  $('review-preview').innerHTML=doc.width&&features.length?annotationSvg({...doc,features},photo,bird.name):'<p>Add a feature and place its arrow to preview.</p>';
  $('placement-markers').innerHTML=features.map((f,i)=>`<circle cx="${f.point[0]}" cy="${f.point[1]}" r=".012" fill="${i?'#223b2f':'#bf542e'}" stroke="white" stroke-width=".004"/>`).join('');
  [0,1].forEach(i=>{const p=documentValue.features[i]?.point;$(`feature-point-${i}`).textContent=p?`${Math.round(p[0]*100)}%, ${Math.round(p[1]*100)}%`:'Not placed';});
}
function allowNavigation(){return !dirty||confirm('You have unsaved review edits. Discard them?');}
function openPhoto(speciesId,photoId){
  if(busy||!allowNavigation())return;
  bird=catalog.birds.find(b=>b.id===speciesId);photo=bird.photos.find(p=>String(p.id)===String(photoId))||bird.photos[0];
  const row=rowFor(photo.id);revision=row?.revision||0;
  documentValue=structuredClone(row?.document||{speciesId:bird.id,photoId:String(photo.id),source:`https://ebird.org/species/${bird.id}`,tips:[],features:[],notes:'',width:0,height:0,sourceChecked:false,photoChecked:false});
  dirty=false;placing=-1;imageLoaded=false;
  $('review-editor').hidden=false;$('review-species').value=bird.id;$('review-bird').textContent=bird.name;$('review-scientific').textContent=bird.scientificName;
  const c=reviewCoverage(catalog.birds,rows);$('review-round').textContent=`${row?.status||'UNREVIEWED'} · ${c.counts[bird.id]} APPROVED FOR THIS SPECIES · REVISION ${revision}`;
  $('review-photo').innerHTML=bird.photos.map((p,i)=>`<option value="${p.id}">Candidate ${i+1} · ML${p.id} · ${rowFor(p.id)?.status||'unreviewed'}</option>`).join('');$('review-photo').value=String(photo.id);
  $('review-credit').textContent=`© ${photo.photographer||'Macaulay Library contributor'} · Cornell Lab of Ornithology | Macaulay Library ML${photo.id}`;
  $('review-source').href=documentValue.source;$('review-ml').href=photo.source;
  $('general-tips').value=documentValue.tips.join('\n');$('review-notes').value=documentValue.notes;$('source-checked').checked=documentValue.sourceChecked;$('photo-checked').checked=documentValue.photoChecked;
  $('feature-editors').innerHTML=[0,1].map(i=>{const f=documentValue.features[i];return `<fieldset class="feature-editor"><h3>Photo feature ${i+1}${i?' · optional':''}</h3><label>Short label<input id="feature-title-${i}" maxlength="26" value="${escape(f?.title||'')}"></label>${[0,1].map(n=>`<label>Explanation line ${n+1}<input id="feature-line-${i}-${n}" maxlength="29" value="${escape(f?.lines[n]||'')}"></label>`).join('')}<button type="button" data-place="${i}" class="secondary-button">Place arrow ${i+1}</button><button type="button" data-clear="${i}" class="text-button">Clear feature</button><span id="feature-point-${i}" class="point-label"></span></fieldset>`;}).join('');
  $('unpublish-review').hidden=!row?.approved;$('save-message').textContent='';$('review-image-error').hidden=true;
  $('review-image').onload=()=>{imageLoaded=true;documentValue.width=$('review-image').naturalWidth;documentValue.height=$('review-image').naturalHeight;refreshPreview();};
  $('review-image').onerror=()=>{imageLoaded=false;$('review-image-error').hidden=false;};$('review-image').src=photo.url;
  $('placement-help').textContent='Select “Place arrow” below, then click the photograph.';renderQueue();refreshPreview();
}
async function save(action){
  if(busy)return;
  try{
    const doc=collect();validateReview(doc,catalog.birds,{approve:action==='approve'});
    if(action==='approve'&&!imageLoaded)throw Error('Load and inspect the photograph before approving.');
    if(action==='unpublish'&&!confirm('Remove this approved photo’s tips from the quiz?'))return;
    busy=true;$('review-form').inert=true;document.querySelectorAll('.review-actions button').forEach(b=>b.disabled=true);$('save-message').textContent='Saving to shared storage…';
    const result=await request('/api/reviews/save',{action,revision,document:doc});
    rows=rows.filter(r=>r.photoId!==result.row.photoId);rows.push(result.row);revision=result.row.revision;documentValue=result.row.document;dirty=false;
    busy=false;openPhoto(bird.id,photo.id);
    $('save-message').textContent=action==='approve'?'Approved and available in the quiz.':action==='unpublish'?'Removed from the quiz; draft retained.':action==='skip'?'Candidate skipped. Choose the next species from the queue.':'Draft saved to shared storage.';
  }catch(error){$('save-message').textContent=error.message;}finally{busy=false;$('review-form').inert=false;document.querySelectorAll('.review-actions button').forEach(b=>b.disabled=false);}
}
$('review-form').addEventListener('submit',e=>{e.preventDefault();save('draft');});
$('approve-review').addEventListener('click',()=>save('approve'));$('skip-review').addEventListener('click',()=>save('skip'));$('unpublish-review').addEventListener('click',()=>save('unpublish'));
$('review-form').addEventListener('input',e=>{dirty=true;if(e.target.id==='general-tips'||e.target.id.startsWith('feature-'))$('source-checked').checked=false;if(e.target.id.startsWith('feature-'))$('photo-checked').checked=false;refreshPreview();});
$('feature-editors').addEventListener('click',e=>{
  if(e.target.dataset.place!==undefined){placing=Number(e.target.dataset.place);$('placement-help').textContent=`Click the visible feature on the photograph to place arrow ${placing+1}.`;}
  if(e.target.dataset.clear!==undefined){const i=Number(e.target.dataset.clear);documentValue.features[i]=undefined;$(`feature-title-${i}`).value='';[0,1].forEach(n=>$(`feature-line-${i}-${n}`).value='');dirty=true;refreshPreview();}
});
$('review-image').addEventListener('click',e=>{
  if(busy||placing<0||!imageLoaded)return;const rect=e.currentTarget.getBoundingClientRect();
  documentValue.features[placing]={...documentValue.features[placing],point:[Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))]};
  dirty=true;$('photo-checked').checked=false;placing=-1;$('placement-help').textContent='Arrow placed. Check the annotation preview below.';refreshPreview();
});
$('review-queue').addEventListener('click',e=>{const button=e.target.closest('[data-photo]');if(button)openPhoto(button.dataset.species,button.dataset.photo);});
$('review-photo').addEventListener('change',e=>{const id=e.target.value;openPhoto(bird.id,id);e.target.value=String(photo.id);});
$('open-species').addEventListener('click',()=>openPhoto($('review-species').value));
for(const id of ['review-family','review-site','review-batch'])$(id).addEventListener('change',renderQueue);
$('refresh-reviews').addEventListener('click',async()=>{if(busy||!allowNavigation())return;try{const result=await request('/api/reviews');rows=result.rows;dirty=false;renderQueue();if(bird)openPhoto(bird.id,photo.id);$('review-message').textContent='Shared reviews refreshed.';}catch(e){$('review-message').textContent=e.message;}});
$('export-reviews').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({schema:1,exportedAt:new Date().toISOString(),rows},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='aviquiz-photo-reviews.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
try{
  const response=await fetch('/data.json');if(!response.ok)throw Error('Checklist unavailable.');catalog=await response.json();
  const result=await request('/api/reviews');rows=result.rows;
  for(const family of new Set(catalog.birds.map(b=>b.family.replace(/\s*\(\d+\)\s*$/,''))))$('review-family').add(new Option(family,family));
  for(const site of catalog.sites)$('review-site').add(new Option(site.name,site.code));
  for(const b of catalog.birds)$('review-species').add(new Option(b.name,b.id));
  $('review-workspace').hidden=false;$('review-message').textContent='Connected. Changes are shared across devices; drafts are not public quiz tips.';renderQueue();
}catch(e){$('review-message').textContent=e.message;}
