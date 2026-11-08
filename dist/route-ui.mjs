import {CURATED_TARGETS,DEFAULT_ROUTE,decodeRoute,encodeRoute,nextVisitDate,routeCandidates,validateRoute} from './routes.mjs';

export async function createRouteEditor({birds,startQuiz}){
  const $=id=>document.getElementById(id);
  const response=await fetch('/route-pilot.json');
  if(!response.ok)throw Error('Pilot data is unavailable. Try reloading this page.');
  const catalog=await response.json();
  const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const placeById=new Map(catalog.places.map(p=>[p.id,p]));
  let draft=structuredClone(DEFAULT_ROUTE), viewing=null, linkHash='', rows=[], problem='';
  const current=()=>viewing||draft;
  const markChanged=()=>{$('route-link').hidden=true;$('route-copy-status').textContent='';};
  function button(label,action){const b=make('button',label);b.type='button';b.className='text-button';b.addEventListener('click',action);return b;}
  function refresh(){
    $('route-error').textContent=problem;
    rows=[];
    if(!problem)try{rows=routeCandidates(current(),catalog,birds);}catch(e){$('route-error').textContent=e.message;}
    const playable=rows.filter(r=>r.bird).length;
    $('route-preview-status').textContent=`${rows.length} species in this list · ${playable} with Macaulay photos in AviQuiz.`;
    $('route-start').disabled=!playable;
    $('route-share').disabled=!rows.length;
    $('route-questions').max=String(playable||1);
    if(Number($('route-questions').value)>playable)$('route-questions').value=String(Math.max(1,playable));
    const fragment=document.createDocumentFragment();
    for(const row of rows){
      const tr=make('tr');const label=make('td');label.append(make('strong',row.name),make('span',row.key));label.lastChild.className='species-scientific';
      const evidence=row.evidence.map(e=>`${placeById.get(e.place).name}: ${e.seasons}/${e.sampled} seasons`);
      if(row.curated)evidence.push('Curated practice target');
      tr.append(label,make('td',evidence.join(' · ')),make('td',row.bird?'Photo ready':'No photo yet'));fragment.append(tr);
    }
    $('route-preview-rows').replaceChildren(fragment);
  }
  function render(){
    $('route-editor').hidden=Boolean(viewing);
    $('route-shared').hidden=!viewing;
    $('route-shared-title').textContent=viewing?.title||'';
    $('route-shared-tier').textContent=viewing?.single?'Includes species reported in just one season.':'Recurring species plus any curated targets.';
    const stops=$('route-shared-stops');stops.replaceChildren();
    if(viewing)for(const stop of viewing.stops)stops.append(make('li',`${placeById.get(stop.place).name} · ${stop.date}`));
    $('route-title').value=draft.title;$('route-single').checked=draft.single;
    const stopList=$('route-stops');stopList.replaceChildren();
    draft.stops.forEach((stop,index)=>{
      const fieldset=make('fieldset');fieldset.className='route-stop';fieldset.append(make('legend',`Stop ${index+1}`));
      const placeLabel=make('label','Place'),select=make('select');
      for(const place of catalog.places){const option=make('option',place.name);option.value=place.id;select.append(option);}
      select.value=stop.place;placeLabel.append(select);fieldset.append(placeLabel);
      const dateLabel=make('label','Visit date'),input=make('input');input.type='date';input.value=stop.date;dateLabel.append(input);fieldset.append(dateLabel);
      const windowNote=make('p',`Study window: ${placeById.get(stop.place).start} to ${placeById.get(stop.place).end} each year.`);windowNote.className='field-help';fieldset.append(windowNote);
      select.addEventListener('change',()=>{
        stop.place=select.value;
        const {start,end}=placeById.get(stop.place);
        if(!stop.date||stop.date.slice(5)<start||stop.date.slice(5)>end)stop.date=`${stop.date.slice(0,4)||'2027'}-${start}`;
        markChanged();render();
      });
      input.addEventListener('change',()=>{stop.date=input.value;markChanged();refresh();});
      const actions=make('div');actions.className='route-actions';
      if(index>0)actions.append(button('Move up',()=>{[draft.stops[index-1],draft.stops[index]]=[stop,draft.stops[index-1]];markChanged();render();}));
      if(draft.stops.length>1)actions.append(button('Remove stop',()=>{draft.stops.splice(index,1);markChanged();render();}));
      fieldset.append(actions);stopList.append(fieldset);
    });
    $('route-add-stop').disabled=draft.stops.length>=8;
    const extras=$('route-extras');extras.replaceChildren();
    for(const [key,name] of CURATED_TARGETS){
      const label=make('label');const input=make('input');input.type='checkbox';input.checked=draft.extras.includes(key);
      input.addEventListener('change',()=>{draft.extras=input.checked?[...draft.extras,key]:draft.extras.filter(x=>x!==key);markChanged();refresh();});
      label.append(input,make('span',name));extras.append(label);
    }
    refresh();
  }
  $('route-title').addEventListener('input',e=>{draft.title=e.target.value;markChanged();refresh();});
  $('route-single').addEventListener('change',e=>{draft.single=e.target.checked;markChanged();refresh();});
  $('route-add-stop').addEventListener('click',()=>{
    if(draft.stops.length>=8)return;
    const previous=draft.stops.at(-1),date=nextVisitDate(previous.date),md=date.slice(5);
    const fits=p=>md>=p.start&&md<=p.end;
    const unused=p=>!draft.stops.some(s=>s.place===p.id);
    const place=catalog.places.find(p=>fits(p)&&unused(p))||catalog.places.find(fits)||placeById.get(previous.place);
    draft.stops.push({place:place.id,date:date||`${DEFAULT_ROUTE.stops[0].date.slice(0,4)}-${place.start}`});markChanged();render();
  });
  $('route-copy-edit').addEventListener('click',()=>{
    draft=structuredClone(viewing);history.pushState(null,'','/routes');open('');$('route-title').focus();
  });
  $('route-share').addEventListener('click',()=>{
    try{
      $('route-link-value').value=new URL('/routes'+encodeRoute(draft,catalog),location.origin).href;
      $('route-link').hidden=false;$('route-link-value').focus();$('route-link-value').select();
    }catch(e){$('route-error').textContent=e.message;}
  });
  $('route-copy-link').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('route-link-value').value);$('route-copy-status').textContent='Link copied.';}
    catch{$('route-link-value').select();$('route-copy-status').textContent='Select and copy the link from the field.';}
  });
  $('route-quiz-form').addEventListener('submit',event=>{
    event.preventDefault();const pool=rows.filter(r=>r.bird).map(r=>r.bird),count=Number($('route-questions').value);
    if(!problem&&pool.length&&Number.isInteger(count)&&count>0&&count<=pool.length)startQuiz({title:validateRoute(current(),catalog).title,pool,count,hash:linkHash});
  });
  function open(hash){
    viewing=null;linkHash='';problem='';markChanged();
    if(hash)try{viewing=decodeRoute(hash,catalog);linkHash=hash;}catch{problem='This route link is invalid or uses an unsupported place. You can start a new route here.';}
    if(problem){const warning=problem;problem='';render();$('route-error').textContent=warning;return;}
    render();
  }
  $('route-loading').hidden=true;$('route-content').hidden=false;
  return {open};
}
