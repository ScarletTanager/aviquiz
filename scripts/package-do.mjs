import {spawnSync} from 'node:child_process';
import {verifyReleaseSource} from './release-source.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const source=verifyReleaseSource(root);
const build=spawnSync(process.execPath,['scripts/build-worker.mjs'],{cwd:root,encoding:'utf8'});
if(build.status!==0)throw Error('Worker build failed; production artifact was not packaged.');
const digest=createHash('sha256');
digest.update(source.commit);
const files=['package.json','package-lock.json','server/http.mjs','server/invitation-provider.mjs','server/ebird-locations.mjs','server/location-cache.mjs','dist/server/index.js','dist/auth-config.mjs'];
for(const name of (await fs.readdir(path.join(root,'server/database'))).sort())files.push('server/database/'+name);
for(const file of files){digest.update(file);digest.update(await fs.readFile(path.join(root,file)));}
const release='aviquiz-'+digest.digest('hex').slice(0,16);
const folder='/private/tmp/'+release;
await fs.mkdir(folder,{recursive:true});
for(const file of files){await fs.mkdir(path.dirname(path.join(folder,file)),{recursive:true});await fs.copyFile(path.join(root,file),path.join(folder,file));}
await fs.writeFile(path.join(folder,'release.json'),JSON.stringify({release,gitCommit:source.commit,gitBranch:source.branch,builtAt:new Date().toISOString(),files},null,2)+'\n');
console.log(JSON.stringify({release,folder}));
