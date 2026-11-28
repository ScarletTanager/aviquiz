// Deterministic compilation of validated processing packages into immutable serving objects.
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {familyName} from '../dist/quiz.mjs';
import {packageCoverage} from '../dist/coverage-core.mjs';
export const SERVING_SCHEMA='aviquiz-serving-release-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const shardFor=id=>hash(id).slice(0,2);
export async function compileServingRelease(packages,{objects,navigation=[]}){
 await fs.mkdir(objects,{recursive:true});
 async function write(bytes){
  const sha256=hash(bytes),file=path.join(objects,sha256);
  try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(hash(await fs.readFile(file))!==sha256)throw Error('Corrupt existing serving object');}
  return {sha256,bytes:bytes.length};
 }
 async function json(value){const raw=Buffer.from(JSON.stringify(value));if(raw.length>4*1024*1024)throw Error('Serving metadata shard exceeds v1 limit');return {...await write(gzipSync(raw,{level:9})),rawBytes:raw.length,encoding:'gzip-json'};}
 const ordered=[...packages].sort((a,b)=>a.package.geography.localeCompare(b.package.geography));
 if(new Set(ordered.map(p=>p.package.geography)).size!==ordered.length)throw Error('Duplicate geography package');
 const coverage=packageCoverage(ordered,navigation),nodes=new Map(navigation.map(n=>[n.id,n])),routes=new Map(),species=new Map(),families=new Map(),result=[];
 for(const p of ordered){
  for(const n of p.nodes)nodes.set(n.id,{...n,...nodes.get(n.id)});
  const birds=[];
  for(const b of p.catalog.birds){const digest=hash(JSON.stringify(b));species.set(digest,b);birds.push(digest);const name=familyName(b.family);families.set(name,Math.min(families.get(name)??Infinity,b.taxonOrder));}
  for(const [id,entry] of Object.entries(p.index.places)){if(!routes.has(id))routes.set(id,[]);routes.get(id).push({geography:p.package.geography,entry});}
  result.push({package:{geography:p.package.geography,revision:p.package.revision},index:{years:p.index.years,chunks:p.index.chunks},birds:await json({schema:'aviquiz-bird-index-v1',birds})});
 }
 const describe=n=>({...n,supported:coverage.navigable.has(n.id),quizSupported:coverage.places.has(n.id)}),children=new Map();
 for(const n of nodes.values()){if(!children.has(n.parent))children.set(n.parent,[]);children.get(n.parent).push(describe(n));}
 const navShards={},speciesShards={};
 for(const [id,n] of [...nodes].sort(([a],[b])=>a.localeCompare(b))){const key=shardFor(id);(navShards[key]??={})[id]={node:describe(n),children:(children.get(id)||[]).sort((a,b)=>a.id.localeCompare(b.id)),routes:(routes.get(id)||[]).sort((a,b)=>b.geography.length-a.geography.length||a.geography.localeCompare(b.geography))};}
 for(const [id,b] of [...species].sort(([a],[b])=>a.localeCompare(b)))(speciesShards[id.slice(0,2)]??={})[id]=b;
 const navigationRefs={},speciesRefs={};
 for(const [key,records] of Object.entries(navShards))navigationRefs[key]=await json({schema:'aviquiz-navigation-shard-v1',records});
 for(const [key,records] of Object.entries(speciesShards))speciesRefs[key]=await json({schema:'aviquiz-species-shard-v1',records});
 const body={schema:SERVING_SCHEMA,packages:result,navigation:navigationRefs,species:speciesRefs,coverage:coverage.stats,families:[...families].map(([name,order])=>({name,order})).sort((a,b)=>a.order-b.order)};
 return {...body,revision:hash(JSON.stringify(body))};
}
export function servingObjects(registry){
 if(registry.schema!==SERVING_SCHEMA)throw Error('Unsupported serving release schema');
 const refs=[...Object.values(registry.navigation),...Object.values(registry.species),...registry.packages.map(p=>p.birds),...registry.packages.flatMap(p=>p.index.chunks)];
 const unique=new Map();for(const r of refs){const prior=unique.get(r.sha256);if(prior&&prior.bytes!==r.bytes)throw Error('Conflicting object sizes');unique.set(r.sha256,r);}return [...unique.values()];
}
export function validateServingManifest(registry){
 if(registry.schema!==SERVING_SCHEMA)throw Error('Unsupported serving release schema');
 const {revision,...body}=registry;if(!/^[a-f0-9]{64}$/.test(revision)||hash(JSON.stringify(body))!==revision)throw Error('Serving release revision mismatch');
 if(!Array.isArray(registry.packages)||new Set(registry.packages.map(p=>p.package.geography)).size!==registry.packages.length)throw Error('Invalid geography set');
 for(const map of [registry.navigation,registry.species])for(const key of Object.keys(map))if(!/^[a-f0-9]{2}$/.test(key))throw Error('Invalid metadata shard');
 for(const ref of servingObjects(registry)){
  if(!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>32*1024*1024)throw Error('Invalid serving object descriptor');
  if(ref.encoding!==undefined&&(ref.encoding!=='gzip-json'||!Number.isSafeInteger(ref.rawBytes)||ref.rawBytes<1||ref.rawBytes>4*1024*1024))throw Error('Invalid metadata descriptor');
 }
 return registry;
}
