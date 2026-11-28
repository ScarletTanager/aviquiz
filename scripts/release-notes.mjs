import assert from 'node:assert/strict';
const version=tag=>{const m=/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(tag);assert.ok(m,'Invalid release tag');if(m[4])for(const part of m[4].split('.'))assert.ok(/^[0-9A-Za-z-]+$/.test(part)&&(!/^\d+$/.test(part)||part==='0'||!part.startsWith('0')),'Invalid prerelease identifier');return {core:m.slice(1,4).map(Number),pre:m[4]?.split('.')};};
function compare(a,b){
 const x=version(a.tag),y=version(b.tag);
 for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]-y.core[i];
 if(!x.pre||!y.pre)return x.pre? -1:y.pre?1:0;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const p=x.pre[i],q=y.pre[i];if(p===undefined||q===undefined)return p===undefined?-1:1;if(p===q)continue;
  const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);return pn&&qn?Number(p)-Number(q):pn!==qn?(pn?-1:1):p<q?-1:1;
 }return 0;
}
export function validateReleases(manifest){
 assert.ok(Array.isArray(manifest.releases)&&manifest.releases.length,'Missing releases');
 const seen=new Set();
 for(const release of manifest.releases){
  version(release.tag);assert.ok(!seen.has(release.tag),'Duplicate release');seen.add(release.tag);
  const date=release.releaseDate;
  assert.ok(date===null||typeof date==='string'&&/^\d{4}-\d\d-\d\d$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date,'Invalid release date');
  assert.ok(typeof release.intro==='string'&&Array.isArray(release.items)&&release.items.length,'Missing release notes');
 }
 assert.ok(seen.has(manifest.currentTag),'Current release has no notes');
 for(const release of manifest.releases)if(release.includedIn!==undefined){
  const target=manifest.releases.find(r=>r.tag===release.includedIn);
  assert.ok(target&&compare(target,release)>0,'Included release must name a newer existing version');
 }
 return [...manifest.releases].sort((a,b)=>-compare(a,b));
}
export const releaseAnchor=tag=>'release-'+tag;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function releaseMarkup(manifest,language,resources){
 const releases=validateReleases(manifest),lookup=(ns,key)=>{const value=resources[ns]?.[key];assert.equal(typeof value,'string','Missing release message '+ns+':'+key);return escape(value);};
 const current=releases.find(r=>r.tag===manifest.currentTag);
 const footer='<nav class="release-links" aria-label="'+lookup('common','releaseNotes')+'"><a href="/releases">'+lookup('common','releaseNotes')+'</a><a href="/releases#'+releaseAnchor(current.tag)+'">'+escape(current.tag)+'</a>'+(current.releaseDate===null?'<span class="release-preview">'+lookup('releases','preview')+'</span>':'')+'</nav>';
 const sections=releases.map(r=>{
  const date=r.releaseDate===null?'<p class="release-date">'+lookup('releases','unreleased')+'</p>':'<p class="release-date">'+lookup('releases','releaseDate')+' <time datetime="'+r.releaseDate+'">'+escape(new Intl.DateTimeFormat(language,{dateStyle:'long',timeZone:'UTC'}).format(new Date(r.releaseDate+'T00:00:00Z')))+'</time></p>';
  const included=r.includedIn?'<p class="release-included">'+lookup('releases','includedIn').replace('{{version}}','<a href="#'+releaseAnchor(r.includedIn)+'">'+escape(r.includedIn)+'</a>')+'</p>':'';
  return '<section id="'+releaseAnchor(r.tag)+'"><h2>'+escape(r.tag)+'</h2>'+date+included+'<p>'+lookup('releases',r.intro)+'</p><ul>'+r.items.map(key=>'<li>'+lookup('releases',key)+'</li>').join('')+'</ul></section>';
 }).join('\n');
 return {footer,sections};
}
