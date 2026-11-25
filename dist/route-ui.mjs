import {t,locale} from './i18n.mjs';
import {CURATED_TARGETS,DEFAULT_ROUTE,MAX_ROUTE_STOPS,decodeRoute,encodeRoute,nextVisitDate,routeCandidates,validateRoute} from './routes.mjs';

export async function createRouteEditor({birds,startQuiz}){
  const $=id=>document.getElementById(id);
  const response=await fetch('/route-pilot.json');
  if(!response.ok)throw Error(t("route-ui:pilot_data_is_unavailable_try_reloading_this_page_795feb8f"));
  const catalog=await response.json();
  const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const placeById=new Map(catalog.places.map(p=>[p.id,p]));
  let draft=structuredClone(DEFAULT_ROUTE), viewing=null, linkHash='', rows=[], problem='';
  const current=()=>viewing||draft;
  const markChanged=()=>{$('route-link').hidden=true;$('route-copy-status').textContent='';};
  function coverageNote(place){
    const c=place.coverage;
    if(!c)return '';
    if(place.source==='trip-checklists')return t("route-ui:trip_report_only_no_seasonal_reporting_rate_842e62b3", {v0:(c.checklists),v1:(t("common:checklistNoun",{count:c.checklists}))});
    const outings=t("common:eligibleOutings",{count:c.outings});
    const month=new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date(`2000-${place.start}T00:00:00Z`));
    const seasons=t("common:sampledMonths",{count:c.seasons,month});
    return t("route-ui:across_b60b7a03", {v0:(outings),v1:(seasons),v2:(c.seasons===1?t("route-ui:include_species_reported_in_only_one_season_to_use_this_683042a0"):'')});
  }
  function button(label,action){const b=make('button',label);b.type='button';b.className='text-button';b.addEventListener('click',action);return b;}
  function refresh(){
    $('route-error').textContent=problem;
    rows=[];
    const {title,stops}=current();
    const missing=!title.trim()||!stops.length?t("route-ui:enter_a_trip_name_and_add_at_least_one_stop_2a5b6e53"):
      stops.some(s=>!s.place||!s.date)?t("route-ui:choose_a_place_and_visit_date_for_each_stop_3b5ca77c"):'';
    let ready=false;
    if(!problem&&!missing)try{rows=routeCandidates(current(),catalog,birds);ready=true;}catch(e){$('route-error').textContent=e.message;}
    const playable=rows.filter(r=>r.bird).length;
    $('route-preview-status').textContent=missing||t("route-ui:species_in_this_list_with_macaulay_photos_in_aviquiz_d774dee7", {v0:(rows.length),v1:(playable)});
    $('route-start').disabled=!ready||!playable;
    // A valid itinerary remains shareable even if its current quiz filters yield no birds.
    $('route-share').disabled=!ready;
    $('route-questions').max=String(playable||1);
    if(playable&&Number($('route-questions').value)>playable)$('route-questions').value=String(playable);
    const fragment=document.createDocumentFragment();
    for(const row of rows){
      const tr=make('tr');const label=make('td');label.append(make('strong',row.name),make('span',row.key));label.lastChild.className='species-scientific';
      const evidence=row.evidence.map(e=>`${placeById.get(e.place).name}: ${e.totalChecklists===undefined?t("route-ui:seasons_4b5768ed", {v0:(e.seasons),v1:(e.sampled)}):t("route-ui:trip_checklists_c15e180c", {v0:(e.checklists),v1:(e.totalChecklists)})}`);
      if(row.curated)evidence.push(t("route-ui:curated_practice_target_436ce30b"));
      tr.append(label,make('td',evidence.join(' · ')),make('td',row.bird?t("route-ui:photo_ready_c0c59a7e"):t("route-ui:no_photo_yet_30eb89b3")));fragment.append(tr);
    }
    $('route-preview-rows').replaceChildren(fragment);
  }
  function render(focusIndex=-1,focusField){
    $('route-editor').hidden=Boolean(viewing);
    $('route-shared').hidden=!viewing;
    $('route-shared-title').textContent=viewing?.title||'';
    const hasTripStop=viewing?.stops.some(s=>placeById.get(s.place).source==='trip-checklists');
    $('route-shared-tier').textContent=(viewing?.single?t("route-ui:includes_species_reported_in_only_one_season_which_may_7e7bb79b"):t("route-ui:recurring_species_plus_any_curated_targets_8f0c7dce"))+(hasTripStop?t("route-ui:also_includes_birds_from_the_trip_checklists_at_stops_w_86987b94"):'');
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
      const fieldset=make('fieldset');fieldset.className='route-stop';fieldset.append(make('legend',t("route-ui:stop_1ac066d7", {v0:(index+1)})));
      const placeLabel=make('label',t("route-ui:place_e9463dcc")),select=make('select');
      const placeholder=make('option',t("route-ui:choose_a_place_69f5ed2f"));placeholder.value='';placeholder.disabled=true;select.append(placeholder);
      for(const place of catalog.places){const option=make('option',place.name);option.value=place.id;select.append(option);}
      select.value=stop.place;placeLabel.append(select);fieldset.append(placeLabel);
      const dateLabel=make('label',t("route-ui:visit_date_a00dd80c")),input=make('input');input.type='date';input.value=stop.date;dateLabel.append(input);fieldset.append(dateLabel);
      const place=placeById.get(stop.place);
      if(place){
        const windowNote=make('p',t("route-ui:study_window_to_each_year_062f4294", {v0:(place.start),v1:(place.end)}));windowNote.className='field-help';fieldset.append(windowNote);
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
      if(index>0)actions.append(button(t("route-ui:move_up_c66feb5e"),()=>{[draft.stops[index-1],draft.stops[index]]=[stop,draft.stops[index-1]];markChanged();render();}));
      actions.append(button(t("route-ui:remove_stop_1aebc4a1"),()=>{draft.stops.splice(index,1);markChanged();render();}));
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
    try{await navigator.clipboard.writeText($('route-link-value').value);$('route-copy-status').textContent=t("route-ui:link_copied_71af38a2");}
    catch{$('route-link-value').select();$('route-copy-status').textContent=t("route-ui:select_and_copy_the_link_from_the_field_aa296f59");}
  });
  $('route-quiz-form').addEventListener('submit',event=>{
    event.preventDefault();const pool=rows.filter(r=>r.bird).map(r=>r.bird),count=Number($('route-questions').value);
    if(!problem&&pool.length&&Number.isInteger(count)&&count>0&&count<=pool.length)startQuiz({title:validateRoute(current(),catalog).title,pool,count,hash:linkHash});
  });
  function open(hash){
    viewing=null;linkHash='';problem='';markChanged();
    if(hash)try{viewing=decodeRoute(hash,catalog);linkHash=hash;}catch{problem=t("route-ui:this_trip_link_is_invalid_or_uses_an_unsupported_place_95827417");}
    if(problem){const warning=problem;problem='';render();$('route-error').textContent=warning;return;}
    render();
  }
  $('route-loading').hidden=true;$('route-content').hidden=false;
  return {open};
}
