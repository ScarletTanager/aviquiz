export function offersSiteClue(settings){
  return settings.mode!=='annotations'&&(settings.site==='all'||settings.family!=='all');
}
export function chooseSiteClue(bird,sites,random=Math.random){
  const codes=new Set(bird.sites);
  const choices=sites.filter(site=>codes.has(site.code));
  return choices.length?choices[Math.floor(random()*choices.length)]:null;
}
