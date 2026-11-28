// Test-only hydration and self-contained fixtures; never imported by application code.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {compileServingRelease} from './serving-release.mjs';
import {readMetadata,speciesRecords,servingRelease} from '../worker/serving-reader.mjs';
import {fileEbdBucket} from '../server/ebd-files.mjs';
import seed from '../dist/geography-seed.json' with {type:'json'};
export async function syntheticServing(){
 const objects=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-serving-fixture-'));
 const bird={id:'fixturebird',name:'Fixture Bird',acceptedName:'Fixture Bird',scientificName:'Testus avis',family:'Furnariidae',taxonOrder:1,photos:[{id:'123',url:'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/123/1200',source:'https://macaulaylibrary.org/asset/123',photographer:'Test photographer',credit:'Test photographer / Macaulay Library',observationDate:'2020-09-20'}]};
 const bytes=gzipSync(JSON.stringify({e:[['09-20','3'],['02-01','3']],b:{0:[['09-20','3'],['02-01','3']]}})),sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(path.join(objects,sha256),bytes);
 const entry={chunk:0,offset:0,length:bytes.length,rawBytes:Buffer.byteLength(JSON.stringify({e:[['09-20','3'],['02-01','3']],b:{0:[['09-20','3'],['02-01','3']]}})),sha256};
 const originals=[{id:'CO',nodes:[{id:'CO',name:'Colombia',kind:'country',parent:'continent:South America'},{id:'CO-CAL',name:'Caldas',kind:'subnational1',parent:'CO'},{id:'L6248331',name:'Caldas hotspot',kind:'hotspot',parent:'CO-CAL'}]},{id:'US-NC',nodes:[{id:'US-NC',name:'North Carolina',kind:'subnational1',parent:'US'},{id:'US-NC-037',name:'Chatham',kind:'subnational2',parent:'US-NC'},{id:'L651593',name:'Jordan Lake',kind:'hotspot',parent:'US-NC-037'}]}].map(p=>({package:{geography:p.id,revision:'test-'+p.id},catalog:{birds:[bird]},nodes:p.nodes,index:{years:[2020,2021],chunks:[{sha256,bytes:bytes.length}],places:Object.fromEntries(p.nodes.map(n=>[n.id,entry]))}}));
 const registry=await compileServingRelease(originals,{objects,navigation:seed.nodes});return {registry,bucket:await fileEbdBucket(objects),objects,originals};
}
export async function hydratePackages(registry,bucket){
 const env={SEASONAL_RELEASE:registry,EBD_BUCKET:bucket},navigation=[];
 for(const ref of Object.values(registry.navigation))navigation.push(...Object.values((await readMetadata(bucket,ref,'aviquiz-navigation-shard-v1')).records));
 const packages=[];
 for(const pkg of registry.packages){const ids=(await readMetadata(bucket,pkg.birds,'aviquiz-bird-index-v1')).birds;const birds=await speciesRecords(env,pkg,ids.map((_,i)=>i)),nodes=[],places={};for(const n of navigation)for(const route of n.routes)if(route.geography===pkg.package.geography){nodes.push(n.node);places[n.node.id]=route.entry;}
 packages.push({...pkg,catalog:{birds:ids.map((_,i)=>birds.get(i))},nodes,index:{...pkg.index,places}});
 }return packages;
}
export async function testServingEnvironment(){
 let bucket;
 try{bucket=await fileEbdBucket(process.env.EBD_COMMON_OBJECTS_DIR||'../../outputs/ebd_common/objects');if(!await bucket.head(servingRelease.packages[0].birds.sha256))bucket=null;}catch{}
 const fixture=bucket?{registry:servingRelease,bucket}:await syntheticServing();
 fixture.env={EBD_BUCKET:fixture.bucket,SEASONAL_RELEASE:fixture.registry};fixture.packages=await hydratePackages(fixture.registry,fixture.bucket);fixture.real=!!bucket;return fixture;
}
