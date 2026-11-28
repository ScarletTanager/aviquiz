// Platform-independent, hash-verified metadata reads. No credentials or storage URLs.
import registry from './seasonal-packages.json' with {type:'json'};
export const SERVING_SCHEMA='aviquiz-serving-release-v1';
const caches=new WeakMap(),LIMIT=12*1024*1024;
export const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function decode(bytes,rawBytes){
 if(!Number.isSafeInteger(rawBytes)||rawBytes<1||rawBytes>32*1024*1024)throw Error('Invalid serving record size');
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();const parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>rawBytes){await reader.cancel();throw Error('Oversized serving record');}parts.push(value);}
 if(size!==rawBytes)throw Error('Incomplete serving record');const raw=new Uint8Array(size);let offset=0;for(const p of parts){raw.set(p,offset);offset+=p.length;}return JSON.parse(new TextDecoder().decode(raw));
}
export async function readMetadata(bucket,ref,schema){
 if(!bucket||!ref||!/^[a-f0-9]{64}$/.test(ref.sha256)||ref.encoding!=='gzip-json'||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>4*1024*1024||!Number.isSafeInteger(ref.rawBytes)||ref.rawBytes<1||ref.rawBytes>4*1024*1024)throw Error('Invalid or unavailable serving metadata');
 let cache=caches.get(bucket);if(!cache){cache={entries:new Map(),pending:new Map(),size:0,active:0,waiting:[]};caches.set(bucket,cache);}
 const key=ref.sha256,signature=JSON.stringify([schema,ref.bytes,ref.rawBytes]);let value=cache.entries.get(key);
 if(value){if(value.signature!==signature)throw Error('Serving schema or descriptor mismatch');cache.entries.delete(key);cache.entries.set(key,value);return value.value;}
 if(cache.pending.has(key)){const current=cache.pending.get(key);if(current.signature!==signature)throw Error('Serving schema or descriptor mismatch');return current.promise;}
 async function load(){
  if(cache.active>=4)await new Promise(resolve=>cache.waiting.push(resolve));else cache.active++;
  try{
   const object=await bucket.get(key);if(!object)throw Error('Missing serving metadata');const bytes=await object.arrayBuffer();
   if(bytes.byteLength!==ref.bytes||await digest(bytes)!==key)throw Error('Corrupt serving metadata');
   const parsed=await decode(bytes,ref.rawBytes);if(parsed.schema!==schema)throw Error('Unsupported serving schema');
   const weight=ref.rawBytes*3;
   if(weight<=LIMIT){while(cache.size+weight>LIMIT&&cache.entries.size){const oldest=cache.entries.keys().next().value;cache.size-=cache.entries.get(oldest).weight;cache.entries.delete(oldest);}cache.entries.set(key,{value:parsed,signature,weight});cache.size+=weight;}
   return parsed;
  }finally{const next=cache.waiting.shift();if(next)next();else cache.active--;}
 }
 const promise=load().finally(()=>cache.pending.delete(key));cache.pending.set(key,{promise,signature});return promise;
}
export function servingRegistry(env){const r=env.SEASONAL_RELEASE||registry;if(r.schema!==SERVING_SCHEMA)throw Error('Unsupported serving release');return r;}
export async function navigationRecord(env,id){const r=servingRegistry(env),key=(await digest(new TextEncoder().encode(id))).slice(0,2),ref=r.navigation[key];if(!ref)return null;return (await readMetadata(env.EBD_BUCKET,ref,'aviquiz-navigation-shard-v1')).records[id]||null;}
export async function placePackage(env,id){const record=await navigationRecord(env,id),route=record?.routes[0];if(!route)return null;const pkg=servingRegistry(env).packages.find(p=>p.package.geography===route.geography);if(!pkg)throw Error('Unknown geography route');return {pkg,entry:route.entry,node:record.node};}
export async function factRecord(bucket,pkg,entry){
 const chunk=pkg.index.chunks[entry.chunk];if(!bucket||!chunk)throw Error('Serving facts unavailable');
 if(!Number.isSafeInteger(entry.offset)||entry.offset<0||!Number.isSafeInteger(entry.length)||entry.length<1||entry.offset+entry.length>chunk.bytes)throw Error('Invalid fact range');
 const object=await bucket.get(chunk.sha256,{range:{offset:entry.offset,length:entry.length}});if(!object)throw Error('Missing serving facts');const bytes=await object.arrayBuffer();if(bytes.byteLength!==entry.length||await digest(bytes)!==entry.sha256)throw Error('Corrupt serving facts');return decode(bytes,entry.rawBytes);
}
export async function speciesRecords(env,pkg,indices){
 const r=servingRegistry(env),birds=(await readMetadata(env.EBD_BUCKET,pkg.birds,'aviquiz-bird-index-v1')).birds,groups=new Map(),result=new Map();
 for(const index of indices){const id=birds[index];if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid bird reference');const key=id.slice(0,2);if(!groups.has(key))groups.set(key,[]);groups.get(key).push([index,id]);}
 const pending=[...groups];let next=0;
 await Promise.all(Array.from({length:Math.min(8,pending.length)},async()=>{while(next<pending.length){const [key,rows]=pending[next++],shard=await readMetadata(env.EBD_BUCKET,r.species[key],'aviquiz-species-shard-v1');for(const [index,id] of rows){const b=shard.records[id];if(!b||await digest(new TextEncoder().encode(JSON.stringify(b)))!==id)throw Error('Invalid species record');result.set(index,b);}}}));return result;
}
export const servingRelease=registry;
