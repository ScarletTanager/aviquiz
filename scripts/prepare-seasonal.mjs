// Compile validated public package metadata and copy immutable data objects locally.
// This does not upload objects, rebuild the application, or deploy anything.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),packages=[];let objects,registry=path.resolve(import.meta.dirname,'../worker/seasonal-packages.json');
for(let i=0;i<args.length;i++){
 const flag=args[i],value=args[++i];if(!value)throw Error('Option value required');
 if(flag==='--package')packages.push(path.resolve(value));else if(flag==='--objects')objects=path.resolve(value);else if(flag==='--registry')registry=path.resolve(value);else throw Error('Unknown option: '+flag);
}
if(!packages.length||!objects)throw Error('Usage: node scripts/prepare-seasonal.mjs --package DIR [--package DIR] --objects DIR [--registry FILE]');
const python=process.env.AVIQUIZ_PYTHON||'python3';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const result={schema:1,packages:[]};
await fs.mkdir(objects,{recursive:true});
for(const folder of packages){
 const check=spawnSync(python,[path.join(import.meta.dirname,'process-ebd.py'),'validate',folder],{encoding:'utf8'});
 if(check.status!==0)throw Error('Package validation failed: '+check.stderr);
 const pkg=await read(path.join(folder,'package.json')),index=await read(path.join(folder,'manifest.json')),catalog=await read(path.join(folder,'species.json')),nodes=(await read(path.join(folder,'places.json'))).nodes;
 if(result.packages.some(p=>p.package.geography===pkg.geography))throw Error('Duplicate geography package');
 for(const chunk of index.chunks){
  const bytes=await fs.readFile(path.join(folder,chunk.key));if(bytes.length!==chunk.bytes||createHash('sha256').update(bytes).digest('hex')!==chunk.sha256)throw Error('Chunk changed after validation');
  const destination=path.join(objects,chunk.sha256);
  try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;const old=await fs.readFile(destination);if(createHash('sha256').update(old).digest('hex')!==chunk.sha256)throw Error('Corrupt existing object');}
 }
 result.packages.push({package:pkg,index,catalog,nodes});
}
result.packages.sort((a,b)=>a.package.geography.localeCompare(b.package.geography));
await fs.mkdir(path.dirname(registry),{recursive:true});const temporary=registry+'.'+process.pid+'.tmp';await fs.writeFile(temporary,JSON.stringify(result)+'\n');await fs.rename(temporary,registry);
console.log(JSON.stringify({registry,objects,geographies:result.packages.map(p=>p.package.geography)}));
