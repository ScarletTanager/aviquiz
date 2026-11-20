import {accountFetch} from './auth-session.mjs';
import {familyName} from './quiz.mjs';
import {geographyPool,monthRange,seasonRange} from './geography-core.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),today=new Date();
const fallback=monthRange(today.getFullYear(),today.getMonth()+1);
$('geo-start').value=params.get('from')||fallback.start;$('geo-end').value=params.get('to')||fallback.end;$('geo-year').value=today.getFullYear();
for(let m=1;m<=12;m++){const option=document.createElement('option');option.value=m;option.textContent=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,m-1,1)));$('geo-month').append(option);}
$('geo-month').value=String(today.getMonth()+1);
let nodes=[],catalog,birds=[],selected=null,children=[],shown=80,mode='regions',request=0,preview={pool:[],places:[]};
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
function list(){
 const query=$('geo-search').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const filtered=children.filter(n=>n.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query));
 const fragment=document.createDocumentFragment();
 for(const node of filtered.slice(0,shown)){const li=make('li',''),button=make('button',node.name+' →');button.type='button';button.addEventListener('click',()=>open(node.id,'regions'));li.append(button);fragment.append(li);}
 if(!filtered.length)fragment.append(make('li',query?'No matching locations.':'No more locations at this level. Try Public hotspots / pilot sites if available.'));
 $('geo-children').replaceChildren(fragment);$('geo-more').hidden=filtered.length<=shown;
}
async function open(id='world',type='regions',refresh=false,navigate=true){
 const token=++request;mode=type;$('geo-loading').textContent='Loading locations…';$('geo-search').value='';shown=80;
 try{
  const query=new URLSearchParams({parent:id,type});
  const response=refresh?await accountFetch('/api/geography/refresh?'+query,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}):await fetch('/api/geography?'+query);if(!response.ok)throw Error('Location not available. Use World to start again.');
  const value=await response.json();if(token!==request)return;
  selected=value.parent;children=value.children;
  const map=new Map(nodes.map(n=>[n.id,n]));for(const n of [...value.ancestors,...children])map.set(n.id,{...map.get(n.id),...n});nodes=[...map.values()];
  const crumbs=document.createDocumentFragment();for(const n of value.ancestors){const b=make('button',n.name);b.type='button';b.className='text-button';b.addEventListener('click',()=>open(n.id));crumbs.append(b,document.createTextNode(' / '));}
  $('geo-breadcrumbs').replaceChildren(crumbs);$('geo-source').textContent=value.notice;
  $('geo-updated').textContent=value.fetchedAt?'Metadata last updated: '+new Date(value.fetchedAt).toLocaleString()+'. Cached until an administrator refreshes it.':'Bundled navigation or pilot metadata.';
  $('geo-hotspots').hidden=!['country','subnational1','subnational2'].includes(selected.kind);
  $('geo-regions').setAttribute('aria-pressed',String(type==='regions'));$('geo-hotspots').setAttribute('aria-pressed',String(type==='hotspots'));
  const state=new URLSearchParams({geo:id,from:$('geo-start').value,to:$('geo-end').value,trail:value.ancestors.map(n=>n.id).join(',')});
  if(navigate)history.pushState(null,'','/explore?'+state);
  $('geo-loading').textContent='';$('geo-sample').checked=false;list();updatePreview();
 }catch(error){if(token===request){$('geo-loading').textContent=error.message;const b=make('button','World');b.type='button';b.addEventListener('click',()=>open('world'));$('geo-breadcrumbs').replaceChildren(b);}}
}
for(const id of ['geo-start','geo-end','geo-family','geo-single','geo-sample'])$(id).addEventListener('change',updatePreview);
$('geo-apply-month').addEventListener('click',()=>{try{const range=monthRange(Number($('geo-year').value),Number($('geo-month').value));$('geo-start').value=range.start;$('geo-end').value=range.end;updatePreview();}catch(error){$('geo-error').textContent=error.message;}});
$('geo-refresh').addEventListener('click',()=>open(selected?.id||'world',mode,true));
$('geo-regions').addEventListener('click',()=>open(selected?.id||'world','regions'));
$('geo-hotspots').addEventListener('click',()=>open(selected.id,'hotspots'));
$('geo-search').addEventListener('input',()=>{shown=80;list();});$('geo-more').addEventListener('click',()=>{shown+=80;list();});
$('geo-start-quiz').addEventListener('click',()=>{
 updatePreview();if($('geo-start-quiz').disabled)return;
 const count=Number($('geo-count').value);if(!Number.isInteger(count)||count<1||count>10000){$('geo-error').textContent='Choose 1–10,000 questions.';return;}
 const query=new URLSearchParams({geo:selected.id,from:$('geo-start').value,to:$('geo-end').value,questions:String(count),family:$('geo-family').value,single:String($('geo-single').checked)});
 location.assign('/quiz?'+query);
});
async function restoreLocation(){
 const query=new URLSearchParams(location.search),trail=(query.get('trail')||'').split(',').filter(Boolean);
 if(trail.length>8||trail.some(id=>id.length>100))return open('world','regions',false,false);
 for(const ancestor of trail.slice(0,-1))await open(ancestor,'regions',false,false);
 const id=query.get('geo')||'world';if(/^L\d+$/.test(id)&&trail.length>1)await open(trail.at(-2),'hotspots',false,false);
 await open(id,'regions',false,false);
}
window.addEventListener('popstate',()=>{const query=new URLSearchParams(location.search);$('geo-start').value=query.get('from')||fallback.start;$('geo-end').value=query.get('to')||fallback.end;restoreLocation();});
try{
 const responses=await Promise.all(['/geography-seed.json','/route-pilot.json','/data.json'].map(p=>fetch(p)));if(responses.some(r=>!r.ok))throw Error();
 const [seed,pilot,data]=await Promise.all(responses.map(r=>r.json()));nodes=seed.nodes;catalog=pilot;birds=data.birds;
 for(const family of new Set(birds.map(b=>familyName(b.family)))){const option=make('option',family);option.value=family;$('geo-family').append(option);}
 await restoreLocation();
}catch{$('geo-loading').textContent='The pilot catalogs could not load. Please reload, or use the original Colombia quiz.';}
try{const response=await accountFetch('/api/account');if(response.ok){const account=await response.json();$('account-trip-options').hidden=account.kind!=='user';$('geo-refresh').hidden=account.administrator!==true;}}catch{}
