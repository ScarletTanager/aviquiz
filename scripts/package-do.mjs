import {spawnSync} from 'node:child_process';
import {verifyReleaseSource} from './release-source.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import index from '../worker/nc-index.json' with {type:'json'};
import seasonal from '../worker/seasonal-packages.json' with {type:'json'};
const root=path.resolve(import.meta.dirname,'..');
const source=verifyReleaseSource(root);
const tag=spawnSync('git',['describe','--tags','--exact-match',source.commit],{cwd:root,encoding:'utf8'});
const version=tag.status===0&&/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag.stdout.trim())?tag.stdout.trim():undefined;
const build=spawnSync(process.execPath,['scripts/build-worker.mjs'],{cwd:root,encoding:'utf8'});
if(build.status!==0)throw Error('Worker build failed; production artifact was not packaged.');
const digest=createHash('sha256');
digest.update(source.commit);
const files=['package.json','package-lock.json','server/http.mjs','server/invitation-provider.mjs','server/ebird-locations.mjs','server/location-cache.mjs','server/ebd-files.mjs','dist/server/index.js','dist/auth-config.mjs'];
for(const name of (await fs.readdir(path.join(root,'server/database'))).sort())files.push('server/database/'+name);
for(const file of files){digest.update(file);digest.update(await fs.readFile(path.join(root,file)));}
const artifacts=[];
const serving=process.env.EBD_SERVING_DIR||path.resolve(root,'../../outputs/ebd_serving/nc-20261121');
for(const chunk of index.chunks){
 const bytes=await fs.readFile(path.join(serving,chunk.key));
 if(bytes.length!==chunk.bytes||createHash('sha256').update(bytes).digest('hex')!==chunk.sha256)throw Error('NC serving artifact verification failed.');
 const name='ebd/'+chunk.sha256;artifacts.push({name,bytes});digest.update(name);digest.update(bytes);
}
const objects=process.env.EBD_COMMON_OBJECTS_DIR||path.resolve(root,'../../outputs/ebd_common/objects');
for(const chunk of seasonal.packages.flatMap(p=>p.index.chunks)){
 if(artifacts.some(a=>a.name==='ebd/'+chunk.sha256))continue;
 const bytes=await fs.readFile(path.join(objects,chunk.sha256));
 if(bytes.length!==chunk.bytes||createHash('sha256').update(bytes).digest('hex')!==chunk.sha256)throw Error('Common serving artifact verification failed.');
 const name='ebd/'+chunk.sha256;artifacts.push({name,bytes});digest.update(name);digest.update(bytes);
}
const release='aviquiz-'+digest.digest('hex').slice(0,16);
const folder='/private/tmp/'+release;
await fs.mkdir(folder,{recursive:true});
for(const file of files){await fs.mkdir(path.dirname(path.join(folder,file)),{recursive:true});await fs.copyFile(path.join(root,file),path.join(folder,file));}
await fs.mkdir(path.join(folder,'ebd'),{recursive:true});
for(const artifact of artifacts){await fs.writeFile(path.join(folder,artifact.name),artifact.bytes);files.push(artifact.name);}
await fs.writeFile(path.join(folder,'release.json'),JSON.stringify({release,version,gitCommit:source.commit,gitBranch:source.branch,builtAt:new Date().toISOString(),files},null,2)+'\n');
console.log(JSON.stringify({release,folder}));
