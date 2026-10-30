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
  if(!input||typeof input!=='object')throw Error('A review document is required.');
  const bird=birds.find(b=>b.id===input.speciesId),photo=bird?.photos.find(p=>String(p.id)===String(input.photoId));
  if(!photo)throw Error('Choose a photograph from this checklist’s Macaulay records.');
  const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Review text is missing or too long.');return v.trim();};
  const source=`https://ebird.org/species/${bird.id}`;
  if(input.source!==source)throw Error('The source must be this species’ eBird account.');
  const tips=input.tips||[],features=input.features||[];
  if(!Array.isArray(tips)||tips.length>6||!Array.isArray(features)||features.length>2)throw Error('Use up to six general tips and two photo callouts.');
  const cleanTips=tips.map(t=>text(t,350)).filter(Boolean);
  const cleanFeatures=features.map(f=>{
    if(!Array.isArray(f.point)||f.point.length!==2||!f.point.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Arrow points must be within the photograph.');
    if(!Array.isArray(f.lines)||f.lines.length>2)throw Error('Use at most two short lines per callout.');
    const title=text(f.title,26),lines=f.lines.map(t=>text(t,29));
    if(approve&&(!title||!lines.length||lines.some(t=>!t)))throw Error('Each callout needs a title and explanation.');
    return {title,lines,point:f.point};
  });
  const width=Number(input.width)||0,height=Number(input.height)||0;
  if(width<0||height<0||width>20000||height>20000)throw Error('Invalid photograph dimensions.');
  if(approve&&(!width||!height||!cleanFeatures.length||!cleanTips.length||!input.photoChecked||!input.sourceChecked))throw Error('Approval requires visible photo features, general tips, image dimensions, and both review checks.');
  return {schema:REVIEW_SCHEMA,speciesId:bird.id,photoId:String(photo.id),source,width,height,tips:cleanTips,features:cleanFeatures,notes:text(input.notes||'',2000),photoChecked:input.photoChecked===true,sourceChecked:input.sourceChecked===true};
}
