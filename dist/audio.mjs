import {shuffle} from './quiz.mjs';
// Department-level preferences are broad geographic proxies, not subspecies IDs.
export const SITE_AUDIO_AREAS={
  BG:{departments:['Cundinamarca','Distrito Capital de Bogotá'],aliases:['bosque guajira','bosque la guajira']},
  Ch:{departments:['Cundinamarca'],aliases:['chicaque']},
  LF:{departments:['Distrito Capital de Bogotá','Cundinamarca'],aliases:['parque la florida']},
  Su:{departments:['Distrito Capital de Bogotá','Cundinamarca'],aliases:['sumapaz','chisaca']},
  Gu:{departments:['Caldas'],aliases:['guarinocito','guarinocita']},
  RC:{departments:['Antioquia'],aliases:['canon del rio claro','rn rio claro','reserva rio claro']},
  B:{departments:[],aliases:[],uncertain:true},
  OQ:{departments:['Risaralda'],aliases:['otun quimbaya']},
  Mb:{departments:['Risaralda','Chocó'],aliases:['montezuma']},
  Ma:{departments:['Risaralda','Chocó'],aliases:['montezuma','tatama'],broad:true},
  Mm:{departments:['Risaralda','Chocó'],aliases:['montezuma','tatama'],broad:true},
  LS:{departments:['Valle del Cauca'],aliases:['laguna de sonso']},
  SC:{departments:['Valle del Cauca'],aliases:['san cipriano','escalerete','escalerate']}
};
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function recordingMatch(recording,site='all'){
  const area=SITE_AUDIO_AREAS[site],location=norm(recording.location),country=norm(recording.country),department=norm(recording.department);
  const warning='Subspecies is unconfirmed for this quiz site. Geographic proximity does not establish a subspecies match.';
  if(site!=='all'&&country==='colombia'&&recording.confirmedSiteCodes?.includes(site))return {rank:0,label:'Recording from this site',detail:`The catalog identifies this site. ${warning}`};
  if(site!=='all'&&country==='colombia'&&area?.aliases.some(alias=>location.includes(norm(alias))))return {rank:1,label:area.broad?'Same general site area':'Same named site area',detail:`Location name matches the site area; the exact trail, elevation, and subspecies may differ. ${warning}`};
  if(site!=='all'&&country==='colombia'&&area?.departments.some(d=>norm(d)===department))return {rank:2,label:'Same department · regional approximation',detail:`Department-level match only; habitat, elevation, slope, and subspecies have not been matched. ${warning}`};
  if(country==='colombia')return {rank:3,label:site==='all'?'Colombia recording · broad trip scope':'Colombia fallback · outside matched site area',detail:site==='all'?`The all-sites scope spans several regions; this recording represents one locality. ${warning}`:`No closer recording is present in this quiz’s catalog${area?.uncertain?'; this site’s location is not yet resolved':''}. A Colombian locality is a broad fallback, not a verified regional or subspecies match.`};
  if(['ecuador','peru','venezuela','panama'].includes(country))return {rank:4,label:'Neighboring-country fallback',detail:`No closer recording is catalogued. Country proximity does not verify the same population, habitat, or subspecies. ${warning}`};
  return {rank:5,label:'Distant fallback · geographic match unverified',detail:`No closer recording is catalogued. Use this as species-level practice; it may differ from the trip’s vocalizations. ${warning}`};
}
export function audioBirds(birds,catalog,site='all',random=Math.random){
  return birds.map(bird=>{
    const ranked=(catalog.recordings[bird.id]||[]).map(r=>({...r,match:recordingMatch(r,site)}));
    const best=ranked.length?Math.min(...ranked.map(r=>r.match.rank)):Infinity;
    // Randomize only within the best geographic tier. Distant clips must not
    // displace a local recording just because a quiz shuffles its questions.
    return {...bird,photos:shuffle(ranked.filter(r=>r.match.rank===best),random)};
  });
}
export function validateAudioCatalog(catalog,birds){
  if(catalog?.version!==1||!catalog.recordings)throw Error('Invalid audio catalog.');
  const ids=new Set();
  for(const [species,recordings] of Object.entries(catalog.recordings)){
    if(!birds.some(b=>b.id===species)||!Array.isArray(recordings))throw Error('Unknown audio species.');
    for(const r of recordings){
      if(!/^\d+$/.test(r.id)||ids.has(r.id)||!r.recordist||!r.location||!r.country||!r.provenance||r.source!==`https://macaulaylibrary.org/asset/${r.id}`||r.url!==`https://cdn.download.ams.birds.cornell.edu/api/v2/asset/${r.id}/mp3`)throw Error('Invalid recording provenance.');
      if(r.soundType==='Mechanical sound')throw Error('Non-vocal recordings do not belong in a vocalization quiz.');
      ids.add(r.id);
    }
  }
  return true;
}
