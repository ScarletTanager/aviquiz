// A deliberately small, photo-specific experiment. Source wording is paraphrased.
// Coordinates are normalized to the full, uncropped Macaulay image.
// Species summaries paraphrase the same eBird/Merlin accounts used by the pilot.
export const SPECIES_TIPS={
  strxen1:{source:'https://ebird.org/species/strxen1',tips:[
    'Small, mostly brown bird with warm rufous tones.',
    'Look for a pale eyebrow and a whitish stripe below and behind the eye.',
    'Strong streaking on the crown and underparts helps distinguish it from Plain Xenops.'
  ]},
  monwoo1:{source:'https://ebird.org/species/monwoo1',tips:[
    'Warm brown woodcreeper with reddish wings and tail.',
    'The slender, noticeably curved bill is a useful identification feature.',
    'Look for pale streaking underneath, a whitish throat, and a pale eyebrow.'
  ]},
  spobar1:{source:'https://ebird.org/species/spobar1',tips:[
    'Dark brown bird with a warm buff throat.',
    'Pale spots contrast with the darker chest.',
    'Use the combination of throat color and chest spotting when comparing similar birds.'
  ]}
};

const BUILTIN_SPECIES_TIPS=structuredClone(SPECIES_TIPS);
export const ID_TIPS={
  '103726981':{speciesId:'strxen1',width:1200,height:797,source:'https://ebird.org/species/strxen1',features:[
    {title:'Pale face stripe',lines:['Find the light stripe','below and behind the eye.'],point:[0.484,0.368]},
    {title:'Streaked breast',lines:['The marked underparts help','separate it from Plain Xenops.'],point:[0.513,0.458]}
  ]},
  '367290401':{speciesId:'strxen1',width:1200,height:938,source:'https://ebird.org/species/strxen1',features:[
    {title:'Pale face stripe',lines:['Find the light stripe','below and behind the eye.'],point:[0.497,0.473]},
    {title:'Streaked breast',lines:['The marked underparts help','separate it from Plain Xenops.'],point:[0.493,0.526]}
  ]},
  '519472501':{speciesId:'monwoo1',width:800,height:1200,source:'https://ebird.org/species/monwoo1',features:[
    {title:'Narrow, curving bill',lines:['Follow the pronounced curve','along the slender bill.'],point:[0.606,0.252]},
    {title:'Rufous wing and tail',lines:['Look for the warm reddish','tones in the flight feathers.'],point:[0.565,0.575]}
  ]},
  '650856091':{speciesId:'monwoo1',width:1200,height:800,source:'https://ebird.org/species/monwoo1',features:[
    {title:'Narrow, curving bill',lines:['Follow the pronounced curve','along the slender bill.'],point:[0.599,0.245]},
    {title:'Pale breast streaks',lines:['Long pale marks run','down the brown underparts.'],point:[0.663,0.425]}
  ]},
  '635046567':{speciesId:'spobar1',width:1200,height:800,source:'https://ebird.org/species/spobar1',features:[
    {title:'Warm throat color',lines:['Look for the buff-toned','patch beneath the bill.'],point:[0.575,0.290]},
    {title:'Spots on the chest',lines:['Pale spots contrast with','the darker breast.'],point:[0.570,0.390]}
  ]},
  '417848991':{speciesId:'spobar1',width:1200,height:799,source:'https://ebird.org/species/spobar1',features:[
    {title:'Warm throat color',lines:['Look for the buff-toned','patch beneath the bill.'],point:[0.704,0.285]},
    {title:'Spots on the chest',lines:['Pale spots contrast with','the darker breast.'],point:[0.625,0.363]}
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 800" role="img" aria-labelledby="id-tip-svg-title id-tip-svg-desc"><title id="id-tip-svg-title">Experimental photo ID features: ${xml(speciesName)}</title><desc id="id-tip-svg-desc">${xml(entry.features.map((f,i)=>`${i+1}. ${f.title}: ${f.lines.join(' ')}`).join(' '))}</desc><defs><marker id="id-tip-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#bf542e"/></marker></defs><image href="${xml(photo.url)}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="xMidYMid meet"/>${callouts}</svg>`;
}
