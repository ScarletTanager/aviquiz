// Validate the immutable packaging/tagging identity for either deployment target.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateReleases} from './release-notes.mjs';
export function verifyReleaseTag(root,manifest,{git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,'Release Git verification failed');return r.stdout.trim();}}={}){
 validateReleases(manifest);
 const release=manifest.releases.find(r=>r.tag===manifest.currentTag),ref='refs/tags/'+release.tag;
 assert.ok(release.releaseDate,'Finalize the packaging/tagging release date before packaging');
 assert.equal(git(['cat-file','-t',ref]),'tag','Release requires an annotated tag');
 assert.equal(git(['rev-parse',ref+'^{commit}']),git(['rev-parse','HEAD']),'Release tag must point to the packaged source');
 const timestamp=git(['for-each-ref','--format=%(taggerdate:iso-strict)',ref]);
 assert.ok(Number.isFinite(Date.parse(timestamp)),'Invalid release tag timestamp');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp));
 assert.equal(release.releaseDate,date,'Release date must match the initial tag date in America/New_York');
 return {tag:release.tag,releaseDate:date};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const root=new URL('../',import.meta.url);console.log(JSON.stringify(verifyReleaseTag(root,JSON.parse(fs.readFileSync(new URL('data/releases.json',root),'utf8')))));}
