// Coverage comes from installed serving packages, never from the much broader
// cached eBird location directory or from photo availability.
export function packageCoverage(packages,navigation=[]){
 const nodes=new Map(navigation.map(n=>[n.id,n])),species=new Set(),places=new Set();
 for(const pkg of packages){
  for(const bird of pkg.catalog.birds)species.add(bird.id);
  for(const node of pkg.nodes){const prior=nodes.get(node.id);nodes.set(node.id,{...node,parent:node.parent??prior?.parent});}
  for(const id of Object.keys(pkg.index.places))places.add(id);
 }
 const navigable=new Set(places),geographies=new Set(),sites=new Set();
 for(const id of places){
  let node=nodes.get(id);if(node?.kind==='subnational1')geographies.add(id);
  if(['hotspot','site'].includes(node?.kind))sites.add(id);
  const seen=new Set();
  while(node&&!seen.has(node.id)){seen.add(node.id);navigable.add(node.id);if(node.kind==='subnational1')geographies.add(node.id);node=nodes.get(node.parent);}
 }
 return {places,navigable,stats:{species:species.size,geographies:geographies.size,sites:sites.size}};
}
