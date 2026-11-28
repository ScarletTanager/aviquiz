// Compare migrated objects against an operator's frozen pre-migration API receipt.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {seasonalApi} from '../worker/seasonal-api.mjs';
import {fileEbdBucket} from '../server/ebd-files.mjs';
const baseline=process.argv[2];if(!baseline)throw Error('Usage: node scripts/test-serving-parity.mjs BASELINE_JSON');
const cases=JSON.parse(await fs.readFile(baseline,'utf8'));
let bucket;
if(process.env.EBD_STORAGE==='spaces'){const {spacesEbdBucket}=await import('../server/ebd-spaces.mjs');bucket=await spacesEbdBucket(process.env);}
else if(!process.env.EBD_STORAGE||process.env.EBD_STORAGE==='files')bucket=await fileEbdBucket(process.env.EBD_COMMON_OBJECTS_DIR||'../../outputs/ebd_common/objects');
else throw Error('Unknown verification storage driver');
try{
for(const expected of cases){
 const response=await seasonalApi(new Request('https://test'+expected.path),{EBD_BUCKET:bucket});assert.equal(response.status,200,expected.path);const d=await response.json();
 assert.equal(d.species.length,expected.species);assert.equal(d.pool.length,expected.pool);assert.equal(d.sampledSeasons,expected.sampledSeasons);
 const signature=d.species.map(b=>[b.id,b.photos.map(p=>[String(p.id),p.observationDate||null,p.url,p.source,p.photographer||null])]);assert.equal(createHash('sha256').update(JSON.stringify(signature)).digest('hex'),expected.signature,expected.path);
}
console.log(`Passed ${cases.length} frozen seasonal API comparisons, including exact ordered species, photo URLs, photographers, and observation dates.`);

}finally{bucket?.close?.();}
