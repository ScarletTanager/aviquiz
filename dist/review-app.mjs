import {t} from './i18n.mjs';
import {accountFetch} from './auth-session.mjs';
import {reviewCoverage,reviewQueue,validateReview} from './review-core.mjs';
import {annotationSvg} from './id-tips.mjs';
const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog,rows=[],bird,photo,documentValue,revision=0,placing=-1,dirty=false,busy=false,imageLoaded=false;
let permissions={edit:true,publish:true};
function permissionControls(){
  for(const id of ['save-draft','approve-review','skip-review','unpublish-review'])$(id).disabled=!permissions.edit;
  if(!permissions.publish)for(const id of ['approve-review','unpublish-review'])$(id).disabled=true;
}
async function request(path,body){const r=await accountFetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000),...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||t("review-app:shared_reviews_unavailable_dc634e72"));return result;}
const rowFor=id=>rows.find(r=>r.photoId===String(id));
function renderQueue(){
  const c=reviewCoverage(catalog.birds,rows);
  $('review-counts').innerHTML=t("review-app:species_covered_approved_photos_drafts_global_round_460efe48", {v0:(c.covered),v1:(c.total),v2:(c.approved),v3:(c.drafts),v4:(c.round??t("common:complete")),v5:(c.blocked.length?t("review-app:species_need_replacement_candidates_1e384be2", {v0:(c.blocked.length)}):'')});
  const queue=reviewQueue(catalog.birds,rows,{family:$('review-family').value,site:$('review-site').value,limit:Number($('review-batch').value)});
  $('review-queue').innerHTML=queue.map(q=>{const b=catalog.birds.find(b=>b.id===q.speciesId),r=rowFor(q.photoId);return t("review-app:approved_f0e36a00", {v0:(escape(b.id)),v1:(q.photoId),v2:(photo&&String(photo.id)===q.photoId?'aria-current="true"':''),v3:(escape(b.name)),v4:(q.count),v5:(r?.status==='draft'?t("review-app:saved_draft_e0385bf3"):t("common:round",{count:q.round})),v6:(q.ready?'':t("review-app:waiting_for_earlier_round_b18fa1ef"))});}).join('')||t("review-app:no_remaining_candidates_match_these_filters_daf9b04a");
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
  $('review-preview').innerHTML=doc.width&&features.length?annotationSvg({...doc,features},photo,bird.name):t("review-app:add_a_feature_and_place_its_arrow_to_preview_f454b744");
  $('placement-markers').innerHTML=features.map((f,i)=>`<circle cx="${f.point[0]}" cy="${f.point[1]}" r=".012" fill="${i?'#223b2f':'#bf542e'}" stroke="white" stroke-width=".004"/>`).join('');
  [0,1].forEach(i=>{const p=documentValue.features[i]?.point;$(`feature-point-${i}`).textContent=p?`${Math.round(p[0]*100)}%, ${Math.round(p[1]*100)}%`:t("review-app:not_placed_d3682aa2");});
}
function allowNavigation(){return !dirty||confirm(t("review-app:you_have_unsaved_review_edits_discard_them_542b75bd"));}
function openPhoto(speciesId,photoId){
  if(busy||!allowNavigation())return;
  bird=catalog.birds.find(b=>b.id===speciesId);photo=bird.photos.find(p=>String(p.id)===String(photoId))||bird.photos[0];
  const row=rowFor(photo.id);revision=row?.revision||0;
  documentValue=structuredClone(row?.document||{speciesId:bird.id,photoId:String(photo.id),source:`https://ebird.org/species/${bird.id}`,tips:[],features:[],notes:'',width:0,height:0,sourceChecked:false,photoChecked:false});
  dirty=false;placing=-1;imageLoaded=false;
  $('review-editor').hidden=false;$('review-species').value=bird.id;$('review-bird').textContent=bird.name;$('review-scientific').textContent=bird.scientificName;
  const c=reviewCoverage(catalog.birds,rows);$('review-round').textContent=t("review-app:approved_for_this_species_revision_40fb0364", {v0:(t("common:reviewStatus_"+(row?.status||"unreviewed")).toUpperCase()),v1:(c.counts[bird.id]),v2:(revision)});
  $('review-photo').innerHTML=bird.photos.map((p,i)=>t("review-app:candidate_ml_5f12bddb", {v0:(p.id),v1:(i+1),v2:(p.id),v3:(t("common:reviewStatus_"+(rowFor(p.id)?.status||"unreviewed")))})).join('');$('review-photo').value=String(photo.id);
  $('review-credit').textContent=t("review-app:cornell_lab_of_ornithology_macaulay_library_ml_088c2bbf", {v0:(photo.photographer||t("review-app:macaulay_library_contributor_93cfc04b")),v1:(photo.id)});
  $('review-source').href=documentValue.source;$('review-ml').href=photo.source;
  $('general-tips').value=documentValue.tips.join('\n');$('review-notes').value=documentValue.notes;$('source-checked').checked=documentValue.sourceChecked;$('photo-checked').checked=documentValue.photoChecked;
  $('feature-editors').innerHTML=[0,1].map(i=>{const f=documentValue.features[i];return t("review-app:photo_feature_short_label_place_arrow_clear_feature_7929daf7", {v0:(i+1),v1:(i?t("review-app:optional_0d1ef2fc"):''),v2:(i),v3:(escape(f?.title||'')),v4:([0,1].map(n=>t("review-app:explanation_line_178c888f", {v0:(n+1),v1:(i),v2:(n),v3:(escape(f?.lines[n]||''))})).join('')),v5:(i),v6:(i+1),v7:(i),v8:(i)});}).join('');
  $('unpublish-review').hidden=!row?.approved;$('save-message').textContent='';$('review-image-error').hidden=true;
  $('review-image').onload=()=>{imageLoaded=true;documentValue.width=$('review-image').naturalWidth;documentValue.height=$('review-image').naturalHeight;refreshPreview();};
  $('review-image').onerror=()=>{imageLoaded=false;$('review-image-error').hidden=false;};$('review-image').src=photo.url;
  $('placement-help').textContent=t("review-app:select_place_arrow_below_then_click_the_photograph_aa8fde9e");renderQueue();refreshPreview();permissionControls();
}
async function save(action){
  if(busy)return;
  try{
    const doc=collect();validateReview(doc,catalog.birds,{approve:action==='approve'});
    if(action==='approve'&&!imageLoaded)throw Error(t("review-app:load_and_inspect_the_photograph_before_approving_c8a7489c"));
    if(action==='unpublish'&&!confirm(t("review-app:remove_this_approved_photo_s_tips_from_the_quiz_c4ea9221")))return;
    busy=true;$('review-form').inert=true;document.querySelectorAll('.review-actions button').forEach(b=>b.disabled=true);$('save-message').textContent=t("review-app:saving_to_shared_storage_d0d79d27");
    const result=await request('/api/reviews/save',{action,revision,document:doc});
    rows=rows.filter(r=>r.photoId!==result.row.photoId);rows.push(result.row);revision=result.row.revision;documentValue=result.row.document;dirty=false;
    busy=false;openPhoto(bird.id,photo.id);
    $('save-message').textContent=action==='approve'?t("review-app:approved_and_available_in_the_quiz_49b6929b"):action==='unpublish'?t("review-app:removed_from_the_quiz_draft_retained_be687603"):action==='skip'?t("review-app:candidate_skipped_choose_the_next_species_from_the_queu_8843a8bc"):t("review-app:draft_saved_to_shared_storage_e726e4f4");
  }catch(error){$('save-message').textContent=error.message;}finally{busy=false;$('review-form').inert=false;document.querySelectorAll('.review-actions button').forEach(b=>b.disabled=false);permissionControls();}
}
$('review-form').addEventListener('submit',e=>{e.preventDefault();save('draft');});
$('approve-review').addEventListener('click',()=>save('approve'));$('skip-review').addEventListener('click',()=>save('skip'));$('unpublish-review').addEventListener('click',()=>save('unpublish'));
$('review-form').addEventListener('input',e=>{dirty=true;if(e.target.id==='general-tips'||e.target.id.startsWith('feature-'))$('source-checked').checked=false;if(e.target.id.startsWith('feature-'))$('photo-checked').checked=false;refreshPreview();});
$('feature-editors').addEventListener('click',e=>{
  if(e.target.dataset.place!==undefined){placing=Number(e.target.dataset.place);$('placement-help').textContent=t("review-app:click_the_visible_feature_on_the_photograph_to_place_ar_7d15206b", {v0:(placing+1)});}
  if(e.target.dataset.clear!==undefined){const i=Number(e.target.dataset.clear);documentValue.features[i]=undefined;$(`feature-title-${i}`).value='';[0,1].forEach(n=>$(`feature-line-${i}-${n}`).value='');dirty=true;refreshPreview();}
});
$('review-image').addEventListener('click',e=>{
  if(busy||placing<0||!imageLoaded)return;const rect=e.currentTarget.getBoundingClientRect();
  documentValue.features[placing]={...documentValue.features[placing],point:[Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))]};
  dirty=true;$('photo-checked').checked=false;placing=-1;$('placement-help').textContent=t("review-app:arrow_placed_check_the_annotation_preview_below_3ccb90a7");refreshPreview();
});
$('review-queue').addEventListener('click',e=>{const button=e.target.closest('[data-photo]');if(button)openPhoto(button.dataset.species,button.dataset.photo);});
$('review-photo').addEventListener('change',e=>{const id=e.target.value;openPhoto(bird.id,id);e.target.value=String(photo.id);});
$('open-species').addEventListener('click',()=>openPhoto($('review-species').value));
for(const id of ['review-family','review-site','review-batch'])$(id).addEventListener('change',renderQueue);
$('refresh-reviews').addEventListener('click',async()=>{if(busy||!allowNavigation())return;try{const result=await request('/api/reviews');rows=result.rows;dirty=false;renderQueue();if(bird)openPhoto(bird.id,photo.id);$('review-message').textContent=t("review-app:shared_reviews_refreshed_34a41eed");}catch(e){$('review-message').textContent=e.message;}});
$('export-reviews').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({schema:1,exportedAt:new Date().toISOString(),rows},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='aviquiz-photo-reviews.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
try{
  const response=await fetch('/data.json');if(!response.ok)throw Error(t("review-app:checklist_unavailable_d0fc0c96"));catalog=await response.json();
  const result=await request('/api/reviews');rows=result.rows;permissions={edit:result.canEdit!==false,publish:result.canPublish!==false};permissionControls();
  if(result.canEdit===false)for(const id of ['save-draft','approve-review','skip-review','unpublish-review'])$(id).disabled=true;
  if(result.canPublish===false)for(const id of ['approve-review','unpublish-review'])$(id).hidden=true;
  for(const family of new Set(catalog.birds.map(b=>b.family.replace(/\s*\(\d+\)\s*$/,''))))$('review-family').add(new Option(family,family));
  for(const site of catalog.sites)$('review-site').add(new Option(site.name,site.code));
  for(const b of catalog.birds)$('review-species').add(new Option(b.name,b.id));
  $('review-workspace').hidden=false;$('review-message').textContent=t("review-app:connected_changes_are_shared_across_devices_drafts_are_8a7066e9");renderQueue();
}catch(e){$('review-message').textContent=e.message;}
