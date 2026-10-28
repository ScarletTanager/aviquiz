export function normalize(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function distance(a, b) {
  let prev = Array.from({length:b.length+1},(_,i)=>i), before;
  for(let i=1;i<=a.length;i++) {
    const row=[i];
    for(let j=1;j<=b.length;j++) {
      row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      if(before && i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) row[j]=Math.min(row[j],before[j-2]+1);
    }
    before=prev; prev=row;
  }
  return prev[b.length];
}
export const aliases = b => [...new Set([b.name,b.acceptedName,b.scientificName].map(normalize))];
export function gradeAnswer(value, bird, allBirds) {
  const input=normalize(value), expected=aliases(bird);
  if(!input) return {correct:false,fuzzy:false};
  if(expected.includes(input)) return {correct:true,fuzzy:false};
  // An exact name of another checklist species must never be accepted as a typo.
  if(allBirds.some(b=>b.id!==bird.id && aliases(b).includes(input))) return {correct:false,fuzzy:false};
  const best=Math.min(...expected.map(n=>distance(input,n)));
  const limit=input.length<8?0:input.length<15?1:2;
  const nearestOther=Math.min(...allBirds.filter(b=>b.id!==bird.id).flatMap(b=>aliases(b).map(n=>distance(input,n))));
  return {correct:best<=limit && best<nearestOther,fuzzy:best<=limit && best<nearestOther};
}
export const familyName = value => value.replace(/\s*\(\d+\)\s*$/, '').trim();
export function eligibleBirds(birds, site='all', filter='none', family='all') {
  return birds.filter(b=>(site==='all'||b.sites.includes(site))&&(filter==='none'||(filter==='world'?b.worldLifer:b.colombiaLifer))&&(family==='all'||familyName(b.family)===family));
}
export function questionPool(birds, repeatSpecies=false) {
  const ready=birds.filter(b=>b.photos.length);
  if(!repeatSpecies)return ready;
  const used=new Set();
  return ready.flatMap(b=>b.photos.filter(p=>{if(used.has(p.id))return false;used.add(p.id);return true;}).map(p=>({...b,photos:[p]})));
}
export function buildQuestions(birds, count, repeatSpecies=false, random=Math.random) {
  return shuffle(questionPool(birds,repeatSpecies),random).slice(0,count);
}
export function shuffle(items, random=Math.random) {
  const a=[...items];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
