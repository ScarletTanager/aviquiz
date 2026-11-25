import {t,locale} from './i18n.mjs';
import {accountFetch} from './auth-session.mjs';
import {familyName,familyLabel} from './quiz.mjs';
import {geographyPool,monthRange,seasonRange} from './geography-core.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),today=new Date();
const fallback=monthRange(today.getFullYear(),today.getMonth()+1);
$('geo-start').value=params.get('from')||fallback.start;$('geo-end').value=params.get('to')||fallback.end;$('geo-year').value=today.getFullYear();
$('geo-all-species').checked=params.get('allSpecies')==='true';
if(params.has('questions'))$('geo-count').value=params.get('questions');
for(let m=1;m<=12;m++){const option=document.createElement('option');option.value=m;option.textContent=new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,m-1,1)));$('geo-month').append(option);}
$('geo-month').value=String(today.getMonth()+1);
let nodes=[],catalog,birds=[],selected=null,columns=[],request=0,previewRequest=0,preview={pool:[],places:[]};
let eligibleCount=0;
let allFamilies=[];
function updateFamilies(species){
 const previous=$('geo-family').value,represented=new Set(species.map(b=>familyName(b.family)));
 const choices=[...new Set([...allFamilies,...represented])].filter(f=>$('geo-show-all-families').checked||represented.has(f));
 const options=[make('option',t("geography-ui:all_families_01eee2b5")),...choices.map(f=>{const option=make('option',familyLabel(f));option.value=f;return option;})];options[0].value='all';
 $('geo-family').replaceChildren(...options);$('geo-family').value=choices.includes(previous)?previous:'all';
}
function updateQuestionCount(){
 const all=$('geo-all-species').checked;
 $('geo-count').readOnly=all;
 if(all)$('geo-count').value=String(eligibleCount);
 $('geo-all-species-help').textContent=t("geography-ui:eligible_species_with_photos_sets_questions_to_one_per_925b51e8", {v0:(eligibleCount)});
}
const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
async function updatePreview(){
 const previewToken=++previewRequest;
 $('geo-error').textContent='';$('geo-start-quiz').disabled=true;eligibleCount=0;updateQuestionCount();
 if(!selected||['world','continent'].includes(selected.kind)){$('geo-configuration').hidden=true;return;}
 $('geo-configuration').hidden=false;$('geo-selected-heading').textContent=t("geography-ui:quiz_scope_7b66aa20")+selected.name;
 try{
  seasonRange($('geo-start').value,$('geo-end').value);
  const ncResponse=await fetch('/api/geography/quiz?'+new URLSearchParams({place:selected.id,from:$('geo-start').value,to:$('geo-end').value,single:String($('geo-single').checked),family:'all'}));
  if(previewToken!==previewRequest)return;
  if(ncResponse.status!==404){
   const nc=await ncResponse.json();if(!ncResponse.ok)throw Error(nc.error);
   updateFamilies(nc.species);const family=$('geo-family').value;
   nc.species=nc.species.filter(b=>family==='all'||familyName(b.family)===family);nc.pool=nc.pool.filter(b=>family==='all'||familyName(b.family)===family);
   preview={pool:nc.pool,places:[selected]};$('geo-sample').closest('label').hidden=true;
   $('geo-coverage').textContent=t("geography-ui:seasonal_species_after_filters_with_verified_photos_sam_a6b0af5c", {v0:(nc.species.length),v1:(nc.pool.length),v2:(nc.sampledSeasons),v3:(nc.notice)});
   const list=$('geo-species-list');list.replaceChildren();for(const b of nc.species){list.append(make('li',t("geography-ui:reported_in_season_s_a851a927", {v0:(b.name),v1:(b.family),v2:(b.reportingSeasons),v3:(b.photos.length?'':t("geography-ui:photo_pending_328c5e73"))})));}
   eligibleCount=nc.pool.length;updateQuestionCount();$('geo-species-details').hidden=false;$('geo-coverage-help-row').hidden=false;$('geo-start-quiz').disabled=!nc.pool.length;return;
  }
  $('geo-sample').closest('label').hidden=false;$('geo-species-details').hidden=true;$('geo-coverage-help-row').hidden=true;
  preview=geographyPool({scope:selected,nodes,catalog,birds,start:$('geo-start').value,end:$('geo-end').value,single:$('geo-single').checked});
  updateFamilies(preview.pool);
  const family=$('geo-family').value,available=preview.pool.filter(b=>family==='all'||familyName(b.family)===family);
  $('geo-coverage').textContent=preview.places.length?t("geography-ui:limited_pilot_coverage_supported_place_s_for_these_date_cc0890df", {v0:(preview.places.length),v1:(available.length),v2:(selected.name)}):t("geography-ui:no_supported_seasonal_species_list_yet_for_across_these_417465f5", {v0:(selected.name)});
  eligibleCount=available.length;updateQuestionCount();$('geo-start-quiz').disabled=!available.length||!$('geo-sample').checked;
 }catch(error){if(previewToken===previewRequest)$('geo-error').textContent=error.message;}
}
const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function renderColumns(){
 const activeId=document.activeElement?.id;
 const fragment=document.createDocumentFragment();
 columns.forEach((column,index)=>{
  const section=make('div','');section.className='location-column'+(index===0?' continent-column':'');
  const title=index===0?t("geography-ui:continents_6c048f26"):column.parent.kind==='continent'?t("geography-ui:countries_areas_28e3781b"):t("geography-ui:within_9acb970d")+column.parent.name;
  const label=make('label',title);label.htmlFor='geo-list-'+index;section.append(label);
  let search;
  if(index>0){search=make('input','');search.type='search';search.placeholder=t("geography-ui:find_a_location_4f658705");search.setAttribute('aria-label',t("geography-ui:find_a_location_within_7aaf403d")+column.parent.name);search.value=column.query||'';section.append(search);}
  const select=make('select','');select.id='geo-list-'+index;select.size=index===0?column.children.length:20;select.setAttribute('aria-label',title);
  function fill(){
   const filtered=column.children.filter(n=>normalize(n.name).includes(normalize(column.query||'')));
   const groups=index<2?[{label:null,rows:filtered}]:[{label:t("geography-ui:subregions_f296ff4f"),rows:filtered.filter(n=>!['hotspot','site'].includes(n.kind))},{label:t("geography-ui:hotspots_pilot_sites_95ddc88d"),rows:filtered.filter(n=>['hotspot','site'].includes(n.kind))}];
   const options=document.createDocumentFragment();
   for(const group of groups){if(!group.rows.length)continue;const target=group.label?make('optgroup',''):options;if(group.label)target.label=group.label;for(const node of group.rows){const option=make('option',node.name);option.value=node.id;option.title=node.name;target.append(option);}if(group.label)options.append(target);}
   select.replaceChildren(options);select.value=column.selectedId||'';select.scrollTop=column.scrollTop||0;
   count.textContent=filtered.length?t("common:locationCount",{count:filtered.length}):t("geography-ui:no_matching_locations_c01ce55e");
  }
  const count=make('p','');count.className='field-help location-count';count.setAttribute('aria-live','polite');
  if(search)search.addEventListener('input',()=>{column.query=search.value;column.scrollTop=0;fill();});
  select.addEventListener('scroll',()=>{column.scrollTop=select.scrollTop;});
  select.addEventListener('change',()=>{const node=column.children.find(n=>n.id===select.value);if(node)return choose(node,index);});
  fill();section.append(select,count);fragment.append(section);
 });
 $('geo-children').replaceChildren(fragment);
 if(activeId?.startsWith('geo-list-'))document.getElementById(activeId)?.focus({preventScroll:true});
}
function breadcrumbs(){
 const fragment=document.createDocumentFragment(),world=nodes.find(n=>n.id==='world');
 const trail=[world,...columns.map(c=>c.children.find(n=>n.id===c.selectedId)).filter(Boolean)];
 for(const [index,node] of trail.entries()){if(index)fragment.append(document.createTextNode(' / '));const button=make('button',node.name);button.type='button';button.className='text-button';button.addEventListener('click',()=>index===0?openWorld():choose(node,index-1));fragment.append(button);}
 $('geo-breadcrumbs').replaceChildren(fragment);return trail;
}
async function directory(node,refresh=false,isCurrent=()=>true){
 if(['hotspot','site'].includes(node.kind))return [];
 async function read(type){
  const query=new URLSearchParams({parent:node.id,type});
  const response=refresh?await accountFetch('/api/geography/refresh?'+query,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}):await fetch('/api/geography?'+query);
  if(!response.ok)throw Error(refresh?t("geography-ui:refresh_failed_the_previous_location_lists_are_still_av_9c7920da"):t("geography-ui:locations_could_not_load_select_this_place_again_to_ret_54e85ab7"));
  return response.json();
 }
 const regions=await read('regions');
 // Only descend to hotspots when this region has no finer administrative level.
 // Do not even request a potentially huge country-wide hotspot directory.
 if(regions.children.length||!['country','subnational1','subnational2'].includes(node.kind)||!isCurrent())return [regions];
 return [regions,await read('hotspots')];
}
async function load(node,depth,{refresh=false,navigate=true}={}){
 const token=++request;selected=node;$('geo-loading').textContent=t("geography-ui:loading_locations_bdf89d95");$('geo-sample').checked=false;updatePreview();
 const prior=columns;
 if(!refresh){columns=columns.slice(0,depth+1);if(depth>=0)columns[depth].selectedId=node.id;renderColumns();breadcrumbs();}
 try{
  const values=await directory(node,refresh,()=>token===request);if(token!==request)return;
  const map=new Map(nodes.map(n=>[n.id,n])),items=new Map();
  for(const value of values){for(const n of [...value.ancestors,...value.children])map.set(n.id,{...map.get(n.id),...n});for(const n of value.children)items.set(n.id,n);}
  nodes=[...map.values()];
  const children=[...items.values()].sort((a,b)=>a.name.localeCompare(b.name,locale));
  // A leaf has no extra column. All earlier lists remain available.
  columns=columns.slice(0,depth+1);if(children.length)columns.push({parent:node,children,selectedId:null,query:''});
  renderColumns();const trail=breadcrumbs();
  $('geo-source').textContent=values.map(v=>v.notice).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
  const dates=values.map(v=>v.fetchedAt).filter(Boolean).sort();
  $('geo-updated').textContent=dates.length?t("geography-ui:metadata_last_updated_49423935")+new Date(dates[0]).toLocaleString(locale)+t("geography-ui:cached_until_an_administrator_refreshes_it_fa35befb"):t("geography-ui:bundled_navigation_or_pilot_metadata_a82e8086");
  if(navigate){const state=new URLSearchParams({geo:node.id,from:$('geo-start').value,to:$('geo-end').value,trail:trail.map(n=>n.id).join(',')});history.pushState(null,'','/explore?'+state);}
  $('geo-loading').textContent=children.length||node.kind==='world'?'':t("geography-ui:no_further_subregions_or_sites_are_listed_for_this_plac_6b756f3b");updatePreview();
 }catch(error){if(token===request){if(refresh){columns=prior;renderColumns();} $('geo-loading').textContent=error.message;}}
}
function choose(node,depth,options={}){return load(node,depth,options);}
function openWorld(options={}){return load(nodes.find(n=>n.id==='world'),-1,options);}
for(const id of ['geo-start','geo-end','geo-family','geo-single','geo-sample','geo-show-all-families'])$(id).addEventListener('change',updatePreview);
$('geo-all-species').addEventListener('change',updateQuestionCount);
$('geo-apply-month').addEventListener('click',()=>{try{const range=monthRange(Number($('geo-year').value),Number($('geo-month').value));$('geo-start').value=range.start;$('geo-end').value=range.end;updatePreview();}catch(error){$('geo-error').textContent=error.message;}});
$('geo-refresh').addEventListener('click',()=>load(selected||nodes.find(n=>n.id==='world'),Math.max(-1,columns.findIndex(c=>c.selectedId===selected?.id)),{refresh:true}));
$('geo-start-quiz').addEventListener('click',()=>{
 if($('geo-start-quiz').disabled)return;
 const count=Number($('geo-count').value);if(!Number.isInteger(count)||count<1||count>10000){$('geo-error').textContent=t("geography-ui:choose_1_10_000_questions_3d12c404");return;}
 const query=new URLSearchParams({geo:selected.id,from:$('geo-start').value,to:$('geo-end').value,questions:String(count),allSpecies:String($('geo-all-species').checked),family:$('geo-family').value,single:String($('geo-single').checked),trail:new URLSearchParams(location.search).get('trail')||''});
 location.assign('/quiz?'+query);
});
async function restoreLocation(){
 const query=new URLSearchParams(location.search),trail=(query.get('trail')||'').split(',').filter(Boolean),id=query.get('geo')||'world';
 await openWorld({navigate:false});
 if(trail.length>8||trail.some(value=>value.length>100))return;
 const path=trail.filter(value=>value!=='world');if(id!=='world'&&path.at(-1)!==id)path.push(id);
 for(const value of path){const depth=columns.findIndex(c=>c.children.some(n=>n.id===value));if(depth<0)break;await choose(columns[depth].children.find(n=>n.id===value),depth,{navigate:false});}
}
window.addEventListener('popstate',()=>{const query=new URLSearchParams(location.search);$('geo-start').value=query.get('from')||fallback.start;$('geo-end').value=query.get('to')||fallback.end;return restoreLocation();});
try{
 const responses=await Promise.all(['/geography-seed.json','/route-pilot.json','/data.json','/api/geography/catalog'].map(p=>fetch(p)));if(responses.some(r=>!r.ok))throw Error();
 const [seed,pilot,data,nc]=await Promise.all(responses.map(r=>r.json()));nodes=seed.nodes;catalog=pilot;birds=data.birds;
 const orders=new Map(nc.families.map(f=>[f.name,f.order]));
 allFamilies=[...new Set([...birds.map(b=>familyName(b.family)),...orders.keys()])].sort((a,b)=>(orders.get(a)??1e9)-(orders.get(b)??1e9));
 for(const family of allFamilies){const option=make('option',familyLabel(family));option.value=family;$('geo-family').append(option);}
 if(params.has('family'))$('geo-family').value=params.get('family');
 $('geo-single').checked=params.get('single')==='true';
 await restoreLocation();
}catch{$('geo-loading').textContent=t("geography-ui:the_pilot_catalogs_could_not_load_please_reload_or_use_8efe4e1c");}
try{const response=await accountFetch('/api/account');if(response.ok){const account=await response.json();$('account-trip-options').hidden=account.kind!=='user';$('geo-refresh').hidden=account.administrator!==true;}}catch{}
