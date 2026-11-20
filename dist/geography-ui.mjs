import {accountFetch} from './auth-session.mjs';
import {familyName} from './quiz.mjs';
import {geographyPool,monthRange,seasonRange} from './geography-core.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),today=new Date();
const fallback=monthRange(today.getFullYear(),today.getMonth()+1);
$('geo-start').value=params.get('from')||fallback.start;$('geo-end').value=params.get('to')||fallback.end;$('geo-year').value=today.getFullYear();
for(let m=1;m<=12;m++){const option=document.createElement('option');option.value=m;option.textContent=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,m-1,1)));$('geo-month').append(option);}
$('geo-month').value=String(today.getMonth()+1);
let nodes=[],catalog,birds=[],selected=null,columns=[],request=0,preview={pool:[],places:[]};
const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
function updatePreview(){
 $('geo-error').textContent='';$('geo-start-quiz').disabled=true;
 if(!selected||['world','continent'].includes(selected.kind)){$('geo-configuration').hidden=true;return;}
 $('geo-configuration').hidden=false;$('geo-selected-heading').textContent='Quiz scope: '+selected.name;
 try{
  seasonRange($('geo-start').value,$('geo-end').value);
  preview=geographyPool({scope:selected,nodes,catalog,birds,start:$('geo-start').value,end:$('geo-end').value,single:$('geo-single').checked});
  const family=$('geo-family').value,available=preview.pool.filter(b=>family==='all'||familyName(b.family)===family);
  $('geo-coverage').textContent=preview.places.length?`Limited pilot coverage: ${preview.places.length} supported place(s) for these dates; ${available.length} species with photos after filters. This is not a complete seasonal list for ${selected.name}.`:`No supported seasonal species list yet for ${selected.name} across these dates. Browsing locations is available; quiz generation awaits coverage. Try a pilot site within its documented season.`;
  $('geo-start-quiz').disabled=!available.length||!$('geo-sample').checked;
 }catch(error){$('geo-error').textContent=error.message;}
}
const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function renderColumns(){
 const activeId=document.activeElement?.id;
 const fragment=document.createDocumentFragment();
 columns.forEach((column,index)=>{
  const section=make('div','');section.className='location-column'+(index===0?' continent-column':'');
  const title=index===0?'Continents':column.parent.kind==='continent'?'Countries / areas':'Within '+column.parent.name;
  const label=make('label',title);label.htmlFor='geo-list-'+index;section.append(label);
  let search;
  if(index>0){search=make('input','');search.type='search';search.placeholder='Find a location';search.setAttribute('aria-label','Find a location within '+column.parent.name);search.value=column.query||'';section.append(search);}
  const select=make('select','');select.id='geo-list-'+index;select.size=index===0?column.children.length:20;select.setAttribute('aria-label',title);
  function fill(){
   const filtered=column.children.filter(n=>normalize(n.name).includes(normalize(column.query||'')));
   const groups=index<2?[{label:null,rows:filtered}]:[{label:'Subregions',rows:filtered.filter(n=>!['hotspot','site'].includes(n.kind))},{label:'Hotspots / pilot sites',rows:filtered.filter(n=>['hotspot','site'].includes(n.kind))}];
   const options=document.createDocumentFragment();
   for(const group of groups){if(!group.rows.length)continue;const target=group.label?make('optgroup',''):options;if(group.label)target.label=group.label;for(const node of group.rows){const option=make('option',node.name);option.value=node.id;option.title=node.name;target.append(option);}if(group.label)options.append(target);}
   select.replaceChildren(options);select.value=column.selectedId||'';select.scrollTop=column.scrollTop||0;
   count.textContent=filtered.length?`${filtered.length} location${filtered.length===1?'':'s'}`:'No matching locations.';
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
  if(!response.ok)throw Error(refresh?'Refresh failed. The previous location lists are still available.':'Locations could not load. Select this place again to retry.');
  return response.json();
 }
 const regions=await read('regions');
 // Only descend to hotspots when this region has no finer administrative level.
 // Do not even request a potentially huge country-wide hotspot directory.
 if(regions.children.length||!['country','subnational1','subnational2'].includes(node.kind)||!isCurrent())return [regions];
 return [regions,await read('hotspots')];
}
async function load(node,depth,{refresh=false,navigate=true}={}){
 const token=++request;selected=node;$('geo-loading').textContent='Loading locations…';$('geo-sample').checked=false;updatePreview();
 const prior=columns;
 if(!refresh){columns=columns.slice(0,depth+1);if(depth>=0)columns[depth].selectedId=node.id;renderColumns();breadcrumbs();}
 try{
  const values=await directory(node,refresh,()=>token===request);if(token!==request)return;
  const map=new Map(nodes.map(n=>[n.id,n])),items=new Map();
  for(const value of values){for(const n of [...value.ancestors,...value.children])map.set(n.id,{...map.get(n.id),...n});for(const n of value.children)items.set(n.id,n);}
  nodes=[...map.values()];
  const children=[...items.values()].sort((a,b)=>a.name.localeCompare(b.name));
  // A leaf has no extra column. All earlier lists remain available.
  columns=columns.slice(0,depth+1);if(children.length)columns.push({parent:node,children,selectedId:null,query:''});
  renderColumns();const trail=breadcrumbs();
  $('geo-source').textContent=values.map(v=>v.notice).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
  const dates=values.map(v=>v.fetchedAt).filter(Boolean).sort();
  $('geo-updated').textContent=dates.length?'Metadata last updated: '+new Date(dates[0]).toLocaleString()+'. Cached until an administrator refreshes it.':'Bundled navigation or pilot metadata.';
  if(navigate){const state=new URLSearchParams({geo:node.id,from:$('geo-start').value,to:$('geo-end').value,trail:trail.map(n=>n.id).join(',')});history.pushState(null,'','/explore?'+state);}
  $('geo-loading').textContent=children.length||node.kind==='world'?'':'No further subregions or sites are listed for this place.';updatePreview();
 }catch(error){if(token===request){if(refresh){columns=prior;renderColumns();} $('geo-loading').textContent=error.message;}}
}
function choose(node,depth,options={}){return load(node,depth,options);}
function openWorld(options={}){return load(nodes.find(n=>n.id==='world'),-1,options);}
for(const id of ['geo-start','geo-end','geo-family','geo-single','geo-sample'])$(id).addEventListener('change',updatePreview);
$('geo-apply-month').addEventListener('click',()=>{try{const range=monthRange(Number($('geo-year').value),Number($('geo-month').value));$('geo-start').value=range.start;$('geo-end').value=range.end;updatePreview();}catch(error){$('geo-error').textContent=error.message;}});
$('geo-refresh').addEventListener('click',()=>load(selected||nodes.find(n=>n.id==='world'),Math.max(-1,columns.findIndex(c=>c.selectedId===selected?.id)),{refresh:true}));
$('geo-start-quiz').addEventListener('click',()=>{
 updatePreview();if($('geo-start-quiz').disabled)return;
 const count=Number($('geo-count').value);if(!Number.isInteger(count)||count<1||count>10000){$('geo-error').textContent='Choose 1–10,000 questions.';return;}
 const query=new URLSearchParams({geo:selected.id,from:$('geo-start').value,to:$('geo-end').value,questions:String(count),family:$('geo-family').value,single:String($('geo-single').checked)});
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
 const responses=await Promise.all(['/geography-seed.json','/route-pilot.json','/data.json'].map(p=>fetch(p)));if(responses.some(r=>!r.ok))throw Error();
 const [seed,pilot,data]=await Promise.all(responses.map(r=>r.json()));nodes=seed.nodes;catalog=pilot;birds=data.birds;
 for(const family of new Set(birds.map(b=>familyName(b.family)))){const option=make('option',family);option.value=family;$('geo-family').append(option);}
 await restoreLocation();
}catch{$('geo-loading').textContent='The pilot catalogs could not load. Please reload, or use the original Colombia quiz.';}
try{const response=await accountFetch('/api/account');if(response.ok){const account=await response.json();$('account-trip-options').hidden=account.kind!=='user';$('geo-refresh').hidden=account.administrator!==true;}}catch{}
