import {t} from './i18n.mjs';
export const REVIEW_SCHEMA=1;
const approvedRows=rows=>rows.filter(r=>r.approved).map(r=>r.approved);
export function reviewCoverage(birds,rows){
  const approved=approvedRows(rows),counts=new Map(birds.map(b=>[b.id,0]));
  for(const doc of approved)counts.set(doc.speciesId,(counts.get(doc.speciesId)||0)+1);
  const skipped=new Set(rows.filter(r=>r.status==='skipped'&&!r.approved).map(r=>r.photoId));
  const available=birds.filter(b=>b.photos.some(p=>!skipped.has(String(p.id))&&!approved.some(d=>d.photoId===String(p.id))));
  const uncovered=[...counts.values()].some(n=>n===0);
  const round=birds.length&&(uncovered||available.length)?Math.min(...counts.values())+1:null;
  return {total:birds.length,covered:[...counts.values()].filter(n=>n>0).length,approved:approved.length,drafts:rows.filter(r=>r.status==='draft').length,blocked:birds.filter(b=>round!==null&&counts.get(b.id)<round&&!available.includes(b)).map(b=>b.id),round,counts:Object.fromEntries(counts)};
}
export function reviewQueue(birds,rows,{family='all',site='all',limit=20}={}){
  const coverage=reviewCoverage(birds,rows),byPhoto=new Map(rows.map(r=>[r.photoId,r]));
  return birds.map((bird,order)=>({bird,order,count:coverage.counts[bird.id]}))
    .filter(({bird})=>(family==='all'||bird.family.replace(/\s*\(\d+\)\s*$/,'')===family)&&(site==='all'||bird.sites.includes(site)))
    .sort((a,b)=>a.count-b.count||a.order-b.order).flatMap(({bird,count})=>{
      const candidates=bird.photos.filter(p=>{const row=byPhoto.get(String(p.id));return !row?.approved&&row?.status!=='skipped';});
      candidates.sort((a,b)=>(byPhoto.get(String(a.id))?.status==='draft'?0:1)-(byPhoto.get(String(b.id))?.status==='draft'?0:1));
      return candidates.length?[{speciesId:bird.id,photoId:String(candidates[0].id),count,round:count+1,ready:count+1===coverage.round}]:[];
    }).slice(0,limit);
}
export function validateReview(input,birds,{approve=false}={}){
  if(!input||typeof input!=='object')throw Error(t("review-core:a_review_document_is_required_322d4e2b"));
  const bird=birds.find(b=>b.id===input.speciesId),photo=bird?.photos.find(p=>String(p.id)===String(input.photoId));
  if(!photo)throw Error(t("review-core:choose_a_photograph_from_this_checklist_s_macaulay_reco_19312966"));
  const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error(t("review-core:review_text_is_missing_or_too_long_ee2ffcad"));return v.trim();};
  const source=`https://ebird.org/species/${bird.id}`;
  if(input.source!==source)throw Error(t("review-core:the_source_must_be_this_species_ebird_account_f1666827"));
  const tips=input.tips||[],features=input.features||[];
  if(!Array.isArray(tips)||tips.length>6||!Array.isArray(features)||features.length>2)throw Error(t("review-core:use_up_to_six_general_tips_and_two_photo_callouts_2c1cf78b"));
  const cleanTips=tips.map(t=>text(t,350)).filter(Boolean);
  const cleanFeatures=features.map(f=>{
    if(!Array.isArray(f.point)||f.point.length!==2||!f.point.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error(t("review-core:arrow_points_must_be_within_the_photograph_5b2e37b3"));
    if(!Array.isArray(f.lines)||f.lines.length>2)throw Error(t("review-core:use_at_most_two_short_lines_per_callout_08a4f668"));
    const title=text(f.title,26),lines=f.lines.map(t=>text(t,29));
    if(approve&&(!title||!lines.length||lines.some(t=>!t)))throw Error(t("review-core:each_callout_needs_a_title_and_explanation_14de089d"));
    return {title,lines,point:f.point};
  });
  const width=Number(input.width)||0,height=Number(input.height)||0;
  if(width<0||height<0||width>20000||height>20000)throw Error(t("review-core:invalid_photograph_dimensions_4faeaea8"));
  if(approve&&(!width||!height||!cleanFeatures.length||!cleanTips.length||!input.photoChecked||!input.sourceChecked))throw Error(t("review-core:approval_requires_visible_photo_features_general_tips_i_1655f053"));
  return {schema:REVIEW_SCHEMA,speciesId:bird.id,photoId:String(photo.id),source,width,height,tips:cleanTips,features:cleanFeatures,notes:text(input.notes||'',2000),photoChecked:input.photoChecked===true,sourceChecked:input.sourceChecked===true};
}
