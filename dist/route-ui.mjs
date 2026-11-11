import {CURATED_TARGETS,DEFAULT_ROUTE,MAX_ROUTE_STOPS,decodeRoute,encodeRoute,nextVisitDate,routeCandidates,validateRoute} from './routes.mjs';

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
  function coverageNote(place){
    const c=place.coverage;
    if(!c)return '';
    if(place.source==='trip-checklists')return `Trip report only · ${c.checklists} ${c.checklists===1?'checklist':'checklists'}. No seasonal reporting rate.`;
    const outings=`${c.outings} eligible ${c.outings===1?'outing':'outings'}`;
    const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(`2000-${place.start}T00:00:00Z`));
    const seasons=`${c.seasons} sampled ${month}${c.seasons===1?'':'s'}`;
    return `${outings} across ${seasons}.${c.seasons===1?' Include species reported in only one season to use this stop’s records.':''}`;
  }
  function button(label,action){const b=make('button',label);b.type='button';b.className='text-button';b.addEventListener('click',action);return b;}
  function refresh(){
    $('route-error').textContent=problem;
    rows=[];
    const {title,stops}=current();
    const missing=!title.trim()||!stops.length?'Enter a trip name and add at least one stop.':
      stops.some(s=>!s.place||!s.date)?'Choose a place and visit date for each stop.':'';
    let ready=false;
    if(!problem&&!missing)try{rows=routeCandidates(current(),catalog,birds);ready=true;}catch(e){$('route-error').textContent=e.message;}
    const playable=rows.filter(r=>r.bird).length;
    $('route-preview-status').textContent=missing||`${rows.length} species in this list · ${playable} with Macaulay photos in AviQuiz.`;
    $('route-start').disabled=!ready||!playable;
    // A valid itinerary remains shareable even if its current quiz filters yield no birds.
    $('route-share').disabled=!ready;
    $('route-questions').max=String(playable||1);
    if(playable&&Number($('route-questions').value)>playable)$('route-questions').value=String(playable);
    const fragment=document.createDocumentFragment();
    for(const row of rows){
      const tr=make('tr');const label=make('td');label.append(make('strong',row.name),make('span',row.key));label.lastChild.className='species-scientific';
      const evidence=row.evidence.map(e=>`${placeById.get(e.place).name}: ${e.totalChecklists===undefined?`${e.seasons}/${e.sampled} seasons`:`${e.checklists}/${e.totalChecklists} trip checklists`}`);
      if(row.curated)evidence.push('Curated practice target');
      tr.append(label,make('td',evidence.join(' · ')),make('td',row.bird?'Photo ready':'No photo yet'));fragment.append(tr);
    }
    $('route-preview-rows').replaceChildren(fragment);
  }
  function render(focusIndex=-1,focusField){
    $('route-editor').hidden=Boolean(viewing);
    $('route-shared').hidden=!viewing;
    $('route-shared-title').textContent=viewing?.title||'';
    const hasTripStop=viewing?.stops.some(s=>placeById.get(s.place).source==='trip-checklists');
    $('route-shared-tier').textContent=(viewing?.single?'Includes species reported in only one season, which may include rarities and one-time sightings.':'Recurring species plus any curated targets.')+(hasTripStop?' Also includes birds from the trip checklists at stops without public hotspot data.':'');
    const stops=$('route-shared-stops');stops.replaceChildren();
    if(viewing)for(const stop of viewing.stops){
      const place=placeById.get(stop.place);
      const item=make('li',`${place.name} · ${stop.date}`);
      const note=coverageNote(place);
      if(note){const p=make('p',note);p.className='field-help';item.append(p);}
      stops.append(item);
    }
    $('route-title').value=draft.title;$('route-single').checked=draft.single;
    const stopList=$('route-stops');stopList.replaceChildren();
    draft.stops.forEach((stop,index)=>{
      const fieldset=make('fieldset');fieldset.className='route-stop';fieldset.append(make('legend',`Stop ${index+1}`));
      const placeLabel=make('label','Place'),select=make('select');
      const placeholder=make('option','Choose a place');placeholder.value='';placeholder.disabled=true;select.append(placeholder);
      for(const place of catalog.places){const option=make('option',place.name);option.value=place.id;select.append(option);}
      select.value=stop.place;placeLabel.append(select);fieldset.append(placeLabel);
      const dateLabel=make('label','Visit date'),input=make('input');input.type='date';input.value=stop.date;dateLabel.append(input);fieldset.append(dateLabel);
      const place=placeById.get(stop.place);
      if(place){
        const windowNote=make('p',`Study window: ${place.start} to ${place.end} each year.`);windowNote.className='field-help';fieldset.append(windowNote);
        const note=coverageNote(place);
        if(note){const p=make('p',note);p.className='field-help';fieldset.append(p);}
      }
      select.addEventListener('change',()=>{
        stop.place=select.value;
        const {start,end}=placeById.get(stop.place);
        if(stop.date&&(stop.date.slice(5)<start||stop.date.slice(5)>end))stop.date=`${stop.date.slice(0,4)}-${start}`;
        markChanged();render(index,'date');
      });
      input.addEventListener('change',()=>{stop.date=input.value;markChanged();refresh();});
      const actions=make('div');actions.className='route-actions';
      if(index>0)actions.append(button('Move up',()=>{[draft.stops[index-1],draft.stops[index]]=[stop,draft.stops[index-1]];markChanged();render();}));
      actions.append(button('Remove stop',()=>{draft.stops.splice(index,1);markChanged();render();}));
      fieldset.append(actions);stopList.append(fieldset);
      if(index===focusIndex)(focusField==='date'?input:select).focus();
    });
    $('route-add-stop').disabled=draft.stops.length>=MAX_ROUTE_STOPS;
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
    if(draft.stops.length>=MAX_ROUTE_STOPS)return;
    const previous=draft.stops.at(-1),date=nextVisitDate(previous?.date),md=date.slice(5);
    const fits=p=>md>=p.start&&md<=p.end;
    const unused=p=>!draft.stops.some(s=>s.place===p.id);
    const previousPlace=placeById.get(previous?.place);
    const sameGroup=p=>previousPlace?.group&&p.group===previousPlace.group;
    const place=previousPlace&&(catalog.places.find(p=>fits(p)&&unused(p)&&sameGroup(p))||catalog.places.find(p=>fits(p)&&unused(p))||catalog.places.find(fits)||previousPlace);
    draft.stops.push({place:place?.id||'',date});markChanged();render(draft.stops.length-1,'place');
  });
  $('route-copy-edit').addEventListener('click',()=>{
    draft=structuredClone(viewing);history.pushState(null,'','/trips');open('');$('route-title').focus();
  });
  $('route-share').addEventListener('click',()=>{
    try{
      $('route-link-value').value=new URL('/trips'+encodeRoute(draft,catalog),location.origin).href;
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
    if(hash)try{viewing=decodeRoute(hash,catalog);linkHash=hash;}catch{problem='This trip link is invalid or uses an unsupported place. You can start a new trip here.';}
    if(problem){const warning=problem;problem='';render();$('route-error').textContent=warning;return;}
    render();
  }
  $('route-loading').hidden=true;$('route-content').hidden=false;
  return {open};
}
