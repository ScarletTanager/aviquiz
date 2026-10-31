export const ANNOTATION_REVIEW_KEY='colombia-field-quiz:annotation-review:v1';
export function parseReviewedPhotos(raw){
  try{const ids=JSON.parse(raw);return new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string'&&/^\d+$/.test(id)):[]);}catch{return new Set();}
}
export function unreviewedPhotos(birds,reviewed){
  return birds.map(b=>({...b,photos:b.photos.filter(p=>!reviewed.has(String(p.id)))})).filter(b=>b.photos.length);
}

export const ORIGINAL_REVIEW_PHOTOS=["622203210", "547620051", "325396921", "433956961", "279526541", "358454881", "628211475", "629916271", "68177631", "615081743", "623824293", "260222031", "519472501", "650856091", "349754031", "85128921", "289115621", "646757130", "417848991", "635046567", "103726981", "367290401", "608842317", "613060370", "205367721", "441243681"];
