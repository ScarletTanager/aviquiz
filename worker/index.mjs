import {t} from '../dist/i18n.mjs';
import {requestLocale} from '../dist/locale-preference.mjs';
import {localizeApiResponse,localizedServerText} from './localized-response.mjs';
import {verifierForEnvironment} from './cognito.mjs';
import {resolvePrincipal} from './identity.mjs';
import {hasPermission} from './permissions.mjs';
import {databaseForEnvironment,firstReviewWrite} from './database.mjs';
import {trustedSiteOwner} from './account-api.mjs';
import {accountApi} from './account-api.mjs';
import {ncApi} from './nc-api.mjs';
import {seasonalApi} from './seasonal-api.mjs';
import {statisticsApi} from './statistics-api.mjs';
import {geographyApi} from './geography-api.mjs';
import {invitationApi} from './invitations.mjs';
// Built with embedded, unchanged quiz assets by scripts/build-worker.mjs.
// Sites identity is trusted only in Sites/D1 mode; standalone hosts reject those headers.
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const rowValue=r=>({photoId:r.photo_id,speciesId:r.species_id,status:r.status,revision:r.revision,document:JSON.parse(r.document_json),approved:r.approved_json?JSON.parse(r.approved_json):null,updatedAt:r.updated_at});
async function rows(db){return (await db.prepare('SELECT * FROM photo_reviews ORDER BY species_id, photo_id').all()).results.map(rowValue);}
async function reviewAccess(request,env,db,verifyIdentity){
  if(trustedSiteOwner(request,env))return {read:true,edit:true,publish:true,admin:true};
  const supplied=request.headers.get('x-review-agent-key');
  if(supplied&&env.REVIEW_AGENT_KEY){
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await hash(supplied),b=await hash(env.REVIEW_AGENT_KEY);let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];if(different===0)return {read:true,edit:true,publish:true,admin:true};
  }
  const principal=await resolvePrincipal(request,{db,verifyIdentity});
  return {read:hasPermission(principal,'annotations.read'),edit:hasPermission(principal,'annotations.edit'),publish:hasPermission(principal,'annotations.publish'),admin:hasPermission(principal,'system.admin')};
}
export async function api(request,env,{verifyIdentity}={}){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/statistics'||path.startsWith('/api/statistics/'))return statisticsApi(request,env,{verifyIdentity});
  if(['/api/geography/quiz','/api/geography/catalog','/api/geography/import'].includes(path))return seasonalApi(request,env);
  if(path==='/api/nc/quiz'||path==='/api/nc/import')return ncApi(request,env);
  if(path==='/api/geography'||path==='/api/geography/refresh')return geographyApi(request,env,{verifyIdentity});
  if(path==='/api/invitations')return invitationApi(request,env,{verifyIdentity});
  // Keep the named API entry point consistent with default.fetch.
  if(path==='/api/account'||path.startsWith('/api/account/'))return accountApi(request,env,{verifyIdentity});
  let db;
  try{db=databaseForEnvironment(env);}catch{return json({error:t("worker-index:shared_review_storage_is_unavailable_please_try_again_l_bcb232b1")},503);}
  try{
    if(path==='/api/annotations'&&request.method==='GET'){
      const all=await rows(db),approved=all.filter(r=>r.approved).map(r=>{
        const {notes,photoChecked,sourceChecked,...published}=r.approved;return published;
      }).sort((a,b)=>(a.approvedAt||'').localeCompare(b.approvedAt||''));
      return json({schema:1,annotations:approved,coverage:reviewCoverage(CATALOG.birds,all)});
    }
    let access;
    try{access=await reviewAccess(request,env,db,verifyIdentity||verifierForEnvironment(env));}
    catch{return json({error:t("worker-index:sign_in_again_to_verify_your_account_18e5667f")},401);}
    if(!access.read)return json({error:t("worker-index:sign_in_with_an_authorized_aviquiz_account_to_access_ph_d005ebcd")},403);
    if(path==='/api/reviews'&&request.method==='GET'){
      const all=await rows(db);return json({schema:1,rows:all,coverage:reviewCoverage(CATALOG.birds,all),canEdit:access.edit,canPublish:access.publish});
    }
    if(request.method!=='POST')return json({error:t("worker-index:unknown_review_route_14793128")},404);
    if(!access.edit)return json({error:t("worker-index:photo_editing_permission_is_required_ece0a496")},403);
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return json({error:t("worker-index:use_the_review_workspace_on_this_site_65a7d43b")},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:t("worker-index:send_json_01dc6e8d")},415);
    const raw=await request.text();if(raw.length>200000)return json({error:t("worker-index:review_payload_too_large_32dd6e72")},413);
    const body=JSON.parse(raw);
    if(path==='/api/reviews/seed'){
      if(!access.admin)return json({error:t("worker-index:administrator_permission_is_required_8e2ee2de")},403);
      const statements=Object.entries(LEGACY_TIPS).map(([photoId,entry])=>{
        const document={...entry,photoId,schema:1,tips:LEGACY_SPECIES[entry.speciesId].tips,photoChecked:true,sourceChecked:true,notes:t("worker-index:previously_reviewed_six_photo_pilot_b498aa63")};
        return db.prepare("INSERT INTO photo_reviews (photo_id,species_id,status,revision,document_json,approved_json,updated_at) VALUES (?,?,'approved',1,?,?,?) ON CONFLICT(photo_id) DO NOTHING").bind(photoId,entry.speciesId,JSON.stringify(document),JSON.stringify(document),new Date().toISOString());
      });
      await db.batch(statements);return json({seeded:true});
    }
    if(path!=='/api/reviews/save')return json({error:t("worker-index:unknown_review_route_14793128")},404);
    const action=body.action;if(!['draft','approve','skip','unpublish'].includes(action))return json({error:t("worker-index:unknown_review_action_914e3dcb")},400);
    if(['approve','unpublish'].includes(action)&&!access.publish)return json({error:t("worker-index:photo_publishing_permission_is_required_3324d9e2")},403);
    const document=validateReview(body.document,CATALOG.birds,{approve:action==='approve'});
    const expected=body.revision;if(!Number.isInteger(expected)||expected<0)return json({error:t("worker-index:a_revision_is_required_2f5320a5")},400);
    const all=await rows(db),existing=all.find(r=>r.photoId===document.photoId);
    if((existing?.revision||0)!==expected)return json({error:t("worker-index:this_review_changed_elsewhere_reload_it_before_saving_640ca3f7")},409);
    if(action==='approve'&&!existing?.approved){
      const c=reviewCoverage(CATALOG.birds,all);
      if(c.round!==null&&c.counts[document.speciesId]+1>c.round)return json({error:t("worker-index:breadth_first_review_finish_round_before_approving_anot_ff03ae90", {v0:(c.round)})},409);
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
      db.prepare(`INSERT INTO photo_reviews (photo_id,species_id,status,revision,document_json,approved_json,updated_at) SELECT ?,?,?,1,?,?,? WHERE 1=1${condition} ON CONFLICT(photo_id) DO NOTHING RETURNING *`).bind(document.photoId,document.speciesId,status,JSON.stringify(document),approved,now,...guardArgs):
      db.prepare(`UPDATE photo_reviews SET status=?, revision=revision+1, document_json=?, approved_json=?, updated_at=? WHERE photo_id=? AND revision=?${condition} RETURNING *`).bind(status,JSON.stringify(document),approved,now,document.photoId,expected,...guardArgs);
    const saved=await firstReviewWrite(db,statement);
    if(!saved)return json({error:t("worker-index:this_review_changed_elsewhere_reload_before_saving_02a52d8d")},409);
    return json({row:rowValue(saved)});
  }catch(error){
    if(error instanceof SyntaxError)return json({error:t("worker-index:invalid_json_70fddef4")},400);
    if(error.databaseError||error.message?.includes('SQLITE')||error.message?.includes('D1'))return json({error:t("worker-index:shared_storage_could_not_complete_this_request_please_r_cd502c46")},503);
    return json({error:error.message||t("worker-index:review_could_not_be_saved_17550dbc")},400);
  }
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname,language=requestLocale(request);
    if(path.startsWith('/api/'))return localizeApiResponse(await api(request,env),language);
    if(!['GET','HEAD'].includes(request.method))return new Response(localizedServerText(t("worker-index:method_not_allowed_371b2688"),language),{status:405});
    const name=path==='/explore'||path==='/explore/'?'/explore.html':path==='/invite'||path==='/invite/'?'/invite.html':['/auth/callback','/','/index.html','/quiz','/quiz/','/trips','/trips/','/routes','/routes/','/statistics','/statistics/'].includes(path)?'/index.html':path==='/review'||path==='/review/'?'/review.html':path;
    const asset=ASSETS[language==='es-CO'&&['/index.html','/explore.html','/invite.html','/review.html'].includes(name)?name.replace('.html','.es-CO.html'):name];if(!asset)return new Response(localizedServerText(t("worker-index:not_found_e3ebaa16"),language),{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','content-language':language,'vary':'Cookie','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
  }
};
