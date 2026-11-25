import {t} from './i18n.mjs';
// A deliberately small, photo-specific experiment. Source wording is paraphrased.
// Coordinates are normalized to the full, uncropped Macaulay image.
// Species summaries paraphrase the same eBird/Merlin accounts used by the pilot.
export const SPECIES_TIPS={
  strxen1:{source:'https://ebird.org/species/strxen1',tips:[
    t("id-tips:small_mostly_brown_bird_with_warm_rufous_tones_721c92d8"),
    t("id-tips:look_for_a_pale_eyebrow_and_a_whitish_stripe_below_and_5ce1d455"),
    t("id-tips:strong_streaking_on_the_crown_and_underparts_helps_dist_7173078a")
  ]},
  monwoo1:{source:'https://ebird.org/species/monwoo1',tips:[
    t("id-tips:warm_brown_woodcreeper_with_reddish_wings_and_tail_353408b7"),
    t("id-tips:the_slender_noticeably_curved_bill_is_a_useful_identifi_7483c1dc"),
    t("id-tips:look_for_pale_streaking_underneath_a_whitish_throat_and_2f4d2526")
  ]},
  spobar1:{source:'https://ebird.org/species/spobar1',tips:[
    t("id-tips:dark_brown_bird_with_a_warm_buff_throat_095ea61b"),
    t("id-tips:pale_spots_contrast_with_the_darker_chest_346102bf"),
    t("id-tips:use_the_combination_of_throat_color_and_chest_spotting_c70f983f")
  ]}
};

const BUILTIN_SPECIES_TIPS=structuredClone(SPECIES_TIPS);
export const ID_TIPS={
  '103726981':{speciesId:'strxen1',width:1200,height:797,source:'https://ebird.org/species/strxen1',features:[
    {title:t("id-tips:pale_face_stripe_cb207229"),lines:[t("id-tips:find_the_light_stripe_28af6eae"),t("id-tips:below_and_behind_the_eye_c8bffbb6")],point:[0.484,0.368]},
    {title:t("id-tips:streaked_breast_4d69eb34"),lines:[t("id-tips:the_marked_underparts_help_3b2c67ff"),t("id-tips:separate_it_from_plain_xenops_3c04dca6")],point:[0.513,0.458]}
  ]},
  '367290401':{speciesId:'strxen1',width:1200,height:938,source:'https://ebird.org/species/strxen1',features:[
    {title:t("id-tips:pale_face_stripe_cb207229"),lines:[t("id-tips:find_the_light_stripe_28af6eae"),t("id-tips:below_and_behind_the_eye_c8bffbb6")],point:[0.497,0.473]},
    {title:t("id-tips:streaked_breast_4d69eb34"),lines:[t("id-tips:the_marked_underparts_help_3b2c67ff"),t("id-tips:separate_it_from_plain_xenops_3c04dca6")],point:[0.493,0.526]}
  ]},
  '519472501':{speciesId:'monwoo1',width:800,height:1200,source:'https://ebird.org/species/monwoo1',features:[
    {title:t("id-tips:narrow_curving_bill_941e292e"),lines:[t("id-tips:follow_the_pronounced_curve_78b18b5b"),t("id-tips:along_the_slender_bill_f0c30d75")],point:[0.606,0.252]},
    {title:t("id-tips:rufous_wing_and_tail_82e95713"),lines:[t("id-tips:look_for_the_warm_reddish_0445e03a"),t("id-tips:tones_in_the_flight_feathers_ad769c6f")],point:[0.565,0.575]}
  ]},
  '650856091':{speciesId:'monwoo1',width:1200,height:800,source:'https://ebird.org/species/monwoo1',features:[
    {title:t("id-tips:narrow_curving_bill_941e292e"),lines:[t("id-tips:follow_the_pronounced_curve_78b18b5b"),t("id-tips:along_the_slender_bill_f0c30d75")],point:[0.599,0.245]},
    {title:t("id-tips:pale_breast_streaks_d7e7ba5a"),lines:[t("id-tips:long_pale_marks_run_c8807015"),t("id-tips:down_the_brown_underparts_be1433cc")],point:[0.663,0.425]}
  ]},
  '635046567':{speciesId:'spobar1',width:1200,height:800,source:'https://ebird.org/species/spobar1',features:[
    {title:t("id-tips:warm_throat_color_b236e343"),lines:[t("id-tips:look_for_the_buff_toned_6bcb2e1b"),t("id-tips:patch_beneath_the_bill_3b0d9df0")],point:[0.575,0.290]},
    {title:t("id-tips:spots_on_the_chest_c593c43f"),lines:[t("id-tips:pale_spots_contrast_with_eb785015"),t("id-tips:the_darker_breast_d7cc573d")],point:[0.570,0.390]}
  ]},
  '417848991':{speciesId:'spobar1',width:1200,height:799,source:'https://ebird.org/species/spobar1',features:[
    {title:t("id-tips:warm_throat_color_b236e343"),lines:[t("id-tips:look_for_the_buff_toned_6bcb2e1b"),t("id-tips:patch_beneath_the_bill_3b0d9df0")],point:[0.704,0.285]},
    {title:t("id-tips:spots_on_the_chest_c593c43f"),lines:[t("id-tips:pale_spots_contrast_with_eb785015"),t("id-tips:the_darker_breast_d7cc573d")],point:[0.625,0.363]}
  ]}
};

export function annotationFor(bird,photo,{enabled=false,answered=false,correct=true}={}){
  if(!enabled||!answered||correct||bird.family.replace(/\s*\(\d+\)\s*$/,'')!=='Furnariidae')return null;
  const entry=ID_TIPS[photo.id];
  return entry?.speciesId===bird.id?entry:null;
}

export function tipsFor(bird,photo,{enabled=false,answered=false,correct=true}={}){
  if(!enabled||!answered||correct)return null;
  const general=SPECIES_TIPS[bird.id];
  if(!general)return null;
  const candidate=ID_TIPS[photo.id],annotation=candidate?.speciesId===bird.id?candidate:null;
  return {kind:annotation?'annotated':'general',source:general.source,annotation,tips:general.tips};
}

export function annotatedBirds(birds){
  return birds.map(b=>({...b,photos:b.photos.filter(p=>ID_TIPS[p.id]?.speciesId===b.id)})).filter(b=>b.photos.length);
}

export function applySharedTips(documents){
  for(const key of Object.keys(ID_TIPS))delete ID_TIPS[key];
  // Keep the original general summaries available if shared photo tips are withdrawn.
  for(const key of Object.keys(SPECIES_TIPS))delete SPECIES_TIPS[key];
  Object.assign(SPECIES_TIPS,structuredClone(BUILTIN_SPECIES_TIPS));
  for(const doc of documents){
    ID_TIPS[doc.photoId]={speciesId:doc.speciesId,width:doc.width,height:doc.height,source:doc.source,features:doc.features};
    SPECIES_TIPS[doc.speciesId]={source:doc.source,tips:doc.tips};
  }
}

export function annotationGeometry(entry){
  const scale=Math.min(760/entry.width,640/entry.height);
  const width=entry.width*scale,height=entry.height*scale;
  return {x:700-width/2,y:400-height/2,width,height};
}

const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function annotationSvg(entry,photo,speciesName){
  const rect=annotationGeometry(entry);
  const callouts=entry.features.map((feature,i)=>{
    const left=i%2===0,x=left?20:1100,y=left?150:440;
    const startX=left?300:1100,startY=y+70;
    const targetX=rect.x+feature.point[0]*rect.width,targetY=rect.y+feature.point[1]*rect.height;
    const route=`M ${startX} ${startY} L ${left?rect.x-15:rect.x+rect.width+15} ${startY} L ${targetX} ${targetY}`;
    return `<g><path d="${route}" fill="none" stroke="#fffef9" stroke-width="7"/><path d="${route}" fill="none" stroke="#bf542e" stroke-width="3" marker-end="url(#id-tip-arrow)"/><circle cx="${targetX}" cy="${targetY}" r="7" fill="none" stroke="#fffef9" stroke-width="2"/><rect x="${x}" y="${y}" width="280" height="140" rx="8" fill="#fffef9" stroke="#b6c1ad"/><text x="${x+18}" y="${y+32}" font-size="21" font-weight="600" fill="#223b2f">${i+1}. ${xml(feature.title)}</text><text x="${x+18}" y="${y+66}" font-size="18" fill="#4b5d4d">${feature.lines.map((line,n)=>`<tspan x="${x+18}" dy="${n?26:0}">${xml(line)}</tspan>`).join('')}</text></g>`;
  }).join('');
  return t("id-tips:experimental_photo_id_features_dc9fd256", {v0:(xml(speciesName)),v1:(xml(entry.features.map((f,i)=>`${i+1}. ${f.title}: ${f.lines.join(' ')}`).join(' '))),v2:(xml(photo.url)),v3:(rect.x),v4:(rect.y),v5:(rect.width),v6:(rect.height),v7:(callouts)});
}
