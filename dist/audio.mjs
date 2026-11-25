import {t} from './i18n.mjs';
import domainData from './audio-areas.mjs';
export const SITE_AUDIO_AREAS = domainData.SITE_AUDIO_AREAS;
import {shuffle} from './quiz.mjs';
// Department-level preferences are broad geographic proxies, not subspecies IDs.

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function recordingMatch(recording,site='all'){
  const area=SITE_AUDIO_AREAS[site],location=norm(recording.location),country=norm(recording.country),department=norm(recording.department);
  const warning=t("audio:subspecies_is_unconfirmed_for_this_quiz_site_geographic_9966c8c0");
  if(site!=='all'&&country==='colombia'&&recording.confirmedSiteCodes?.includes(site))return {rank:0,label:t("audio:recording_from_this_site_2ece18c2"),detail:t("audio:the_catalog_identifies_this_site_00d54e20", {v0:(warning)})};
  if(site!=='all'&&country==='colombia'&&area?.aliases.some(alias=>location.includes(norm(alias))))return {rank:1,label:area.broad?t("audio:same_general_site_area_595aa2f2"):t("audio:same_named_site_area_c01656fc"),detail:t("audio:location_name_matches_the_site_area_the_exact_trail_ele_3b45f038", {v0:(warning)})};
  if(site!=='all'&&country==='colombia'&&area?.departments.some(d=>norm(d)===department))return {rank:2,label:t("audio:same_department_regional_approximation_926a3f37"),detail:t("audio:department_level_match_only_habitat_elevation_slope_and_d2e1d75d", {v0:(warning)})};
  if(country==='colombia')return {rank:3,label:site==='all'?t("audio:colombia_recording_broad_trip_scope_c44b1ea9"):t("audio:colombia_fallback_outside_matched_site_area_f6ad2d3e"),detail:site==='all'?t("audio:the_all_sites_scope_spans_several_regions_this_recordin_88b83704", {v0:(warning)}):t("audio:no_closer_recording_is_present_in_this_quiz_s_catalog_a_1f92a66d", {v0:(area?.uncertain?t("audio:this_site_s_location_is_not_yet_resolved_ae63ef68"):'')})};
  if(['ecuador','peru','venezuela','panama'].includes(country))return {rank:4,label:t("audio:neighboring_country_fallback_c80ca721"),detail:t("audio:no_closer_recording_is_catalogued_country_proximity_doe_b9bb74ec", {v0:(warning)})};
  return {rank:5,label:t("audio:distant_fallback_geographic_match_unverified_196e656e"),detail:t("audio:no_closer_recording_is_catalogued_use_this_as_species_l_3cd98266", {v0:(warning)})};
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
  if(catalog?.version!==1||!catalog.recordings)throw Error(t("audio:invalid_audio_catalog_b2f8c728"));
  const ids=new Set();
  for(const [species,recordings] of Object.entries(catalog.recordings)){
    if(!birds.some(b=>b.id===species)||!Array.isArray(recordings))throw Error(t("audio:unknown_audio_species_585518c7"));
    for(const r of recordings){
      if(!/^\d+$/.test(r.id)||ids.has(r.id)||!r.recordist||!r.location||!r.country||!r.provenance||r.source!==`https://macaulaylibrary.org/asset/${r.id}`||r.url!==`https://cdn.download.ams.birds.cornell.edu/api/v2/asset/${r.id}/mp3`)throw Error(t("audio:invalid_recording_provenance_8c9dff39"));
      if(r.soundType==='Mechanical sound')throw Error(t("audio:non_vocal_recordings_do_not_belong_in_a_vocalization_qu_77e49c84"));
      ids.add(r.id);
    }
  }
  return true;
}
