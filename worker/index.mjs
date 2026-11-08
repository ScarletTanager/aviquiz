// Built with embedded, unchanged quiz assets by scripts/build-worker.mjs.
// Identity is supplied by Sites; viewers cannot write shared reviews.
const OWNER_ID='0a42fa64-ecdd-4efa-98c5-e2c95f94320f';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const rowValue=r=>({photoId:r.photo_id,speciesId:r.species_id,status:r.status,revision:r.revision,document:JSON.parse(r.document_json),approved:r.approved_json?JSON.parse(r.approved_json):null,updatedAt:r.updated_at});
async function rows(db){return (await db.prepare('SELECT * FROM photo_reviews ORDER BY species_id, photo_id').all()).results.map(rowValue);}
async function canEdit(request,env){
  const userId=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  // Sites request IDs can be Site-scoped rather than access-policy account IDs.
  // Match the platform-authenticated owner's configured email in that case.
  if(userId&&(userId===OWNER_ID||(env.REVIEW_OWNER_EMAIL&&email===env.REVIEW_OWNER_EMAIL.trim().toLowerCase())))return true;
  const supplied=request.headers.get('x-review-agent-key');
  if(!supplied||!env.REVIEW_AGENT_KEY)return false;
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await hash(supplied),b=await hash(env.REVIEW_AGENT_KEY);let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];return different===0;
}
export async function api(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!env.DB)return json({error:'Shared review storage is unavailable. Please try again later.'},503);
  try{
    const editor=await canEdit(request,env);
    if(path==='/api/annotations'&&request.method==='GET'){
      const all=await rows(env.DB),approved=all.filter(r=>r.approved).map(r=>{
        const {notes,photoChecked,sourceChecked,...published}=r.approved;return published;
      }).sort((a,b)=>(a.approvedAt||'').localeCompare(b.approvedAt||''));
      return json({schema:1,annotations:approved,coverage:reviewCoverage(CATALOG.birds,all)});
    }
    if(!editor)return json({error:'Only the quiz owner can edit photo reviews.'},403);
    if(path==='/api/reviews'&&request.method==='GET'){
      const all=await rows(env.DB);return json({schema:1,rows:all,coverage:reviewCoverage(CATALOG.birds,all),canEdit:true});
    }
    if(request.method!=='POST')return json({error:'Unknown review route.'},404);
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return json({error:'Use the review workspace on this site.'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Send JSON.'},415);
    const raw=await request.text();if(raw.length>200000)return json({error:'Review payload too large.'},413);
    const body=JSON.parse(raw);
    if(path==='/api/reviews/seed'){
      const statements=Object.entries(LEGACY_TIPS).map(([photoId,entry])=>{
        const document={...entry,photoId,schema:1,tips:LEGACY_SPECIES[entry.speciesId].tips,photoChecked:true,sourceChecked:true,notes:'Previously reviewed six-photo pilot.'};
        return env.DB.prepare("INSERT INTO photo_reviews (photo_id,species_id,status,revision,document_json,approved_json,updated_at) VALUES (?,?,'approved',1,?,?,?) ON CONFLICT(photo_id) DO NOTHING").bind(photoId,entry.speciesId,JSON.stringify(document),JSON.stringify(document),new Date().toISOString());
      });
      await env.DB.batch(statements);return json({seeded:true});
    }
    if(path!=='/api/reviews/save')return json({error:'Unknown review route.'},404);
    const action=body.action;if(!['draft','approve','skip','unpublish'].includes(action))return json({error:'Unknown review action.'},400);
    const document=validateReview(body.document,CATALOG.birds,{approve:action==='approve'});
    const expected=body.revision;if(!Number.isInteger(expected)||expected<0)return json({error:'A revision is required.'},400);
    const all=await rows(env.DB),existing=all.find(r=>r.photoId===document.photoId);
    if((existing?.revision||0)!==expected)return json({error:'This review changed elsewhere. Reload it before saving.'},409);
    if(action==='approve'&&!existing?.approved){
      const c=reviewCoverage(CATALOG.birds,all);
      if(c.round!==null&&c.counts[document.speciesId]+1>c.round)return json({error:`Breadth-first review: finish round ${c.round} before approving another photo for this species.`},409);
    }
    const status=action==='approve'?'approved':action==='skip'?'skipped':'draft';
    const now=new Date().toISOString();if(action==='approve')document.approvedAt=now;
    const approved=action==='approve'?JSON.stringify(document):action==='unpublish'?null:existing?.approved?JSON.stringify(existing.approved):null;
    // The guard also prevents simultaneous approvals of two photos for one species
    // from crossing the current round, even when both callers read the same queue.
    const guard=action==='approve'&&!existing?.approved;
    const round=guard?reviewCoverage(CATALOG.birds,all).round:0;
    const condition=guard?' AND (SELECT COUNT(*) FROM photo_reviews WHERE species_id=? AND approved_json IS NOT NULL) < ?':'';
    const guardArgs=guard?[document.speciesId,round]:[];
    const statement=expected===0?
      env.DB.prepare(`INSERT INTO photo_reviews (photo_id,species_id,status,revision,document_json,approved_json,updated_at) SELECT ?,?,?,1,?,?,? WHERE 1=1${condition} ON CONFLICT(photo_id) DO NOTHING RETURNING *`).bind(document.photoId,document.speciesId,status,JSON.stringify(document),approved,now,...guardArgs):
      env.DB.prepare(`UPDATE photo_reviews SET status=?, revision=revision+1, document_json=?, approved_json=?, updated_at=? WHERE photo_id=? AND revision=?${condition} RETURNING *`).bind(status,JSON.stringify(document),approved,now,document.photoId,expected,...guardArgs);
    const saved=await statement.first();
    if(!saved)return json({error:'This review changed elsewhere. Reload before saving.'},409);
    return json({row:rowValue(saved)});
  }catch(error){
    if(error instanceof SyntaxError)return json({error:'Invalid JSON.'},400);
    if(error.message?.includes('SQLITE')||error.message?.includes('D1'))return json({error:'Shared storage could not complete this request. Please retry.'},503);
    return json({error:error.message||'Review could not be saved.'},400);
  }
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/'))return api(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const name=['/','/index.html','/quiz','/quiz/','/routes','/routes/','/statistics','/statistics/'].includes(path)?'/index.html':path==='/review'||path==='/review/'?'/review.html':path;
    const asset=ASSETS[name];if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
  }
};
