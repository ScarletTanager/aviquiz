import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileEbdBucket} from './server/ebd-files.mjs';
import {ncApi} from './worker/nc-api.mjs';
import index from './worker/nc-index.json' with {type:'json'};
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-ebd-files-'));
try{
 const key='a'.repeat(64);await fs.writeFile(path.join(folder,key),'abcdefghij');
 const bucket=await fileEbdBucket(folder);
 assert.equal((await bucket.head(key)).size,10);
 assert.equal(Buffer.from(await (await bucket.get(key,{range:{offset:3,length:4}})).arrayBuffer()).toString(),'defg');
 assert.equal(await bucket.get('b'.repeat(64)),null);
 await assert.rejects(()=>bucket.get('../escape'),/key/);
 for(const range of [{offset:-1,length:1},{offset:9,length:2},{offset:0,length:0},{offset:0.5,length:1},{offset:0,length:33*1024*1024}])await assert.rejects(()=>bucket.get(key,{range}),/range/);
 await fs.symlink(path.join(folder,key),path.join(folder,'c'.repeat(64)));
 await assert.rejects(()=>bucket.get('c'.repeat(64)));
 await assert.rejects(()=>bucket.put(key,new Uint8Array()),/read-only/);
 assert.equal(await fileEbdBucket(path.join(folder,'missing'),{optional:true}),undefined);
 await assert.rejects(()=>fileEbdBucket(path.join(folder,'missing')),/unavailable/);
 const serving=process.env.NC_EXPORT_DIR||path.resolve('../../outputs/ebd_serving/nc-20261121');
 for(const chunk of index.chunks){
  const bytes=await fs.readFile(path.join(serving,chunk.key));
  assert.equal(bytes.length,chunk.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),chunk.sha256);
  await fs.writeFile(path.join(folder,chunk.sha256),bytes);
 }
 const query='https://aviquiz.org/api/nc/quiz?place=US-NC-037&from=2026-09-20&to=2026-10-10';
 const result=await ncApi(new Request(query),{EBD_BUCKET:bucket});assert.equal(result.status,200);
 const body=await result.json();assert.equal(body.species.length,175);assert.equal(body.pool.length,175);
 assert.ok(body.pool.every(b=>b.photos.length));
 const site=await ncApi(new Request(query.replace('US-NC-037','L651593')),{EBD_BUCKET:bucket});assert.equal(site.status,200);assert.ok((await site.json()).pool.length>0);
 console.log('Passed read-only file bucket: safe keys/ranges, missing files, symlink/write refusal, immutable chunk hashes, and NC county/hotspot queries.');
}finally{await fs.rm(folder,{recursive:true,force:true});}
