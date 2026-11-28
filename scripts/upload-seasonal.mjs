// Preload and verify exact immutable objects. Never activates code or data pointers.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import legacy from '../worker/nc-index.json' with {type:'json'};
import {spacesEbdBucket} from '../server/ebd-spaces.mjs';
import {servingObjects,validateServingManifest} from './serving-release.mjs';
const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--registry','--objects','--receipt','--legacy-dir'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: node scripts/upload-seasonal.mjs --registry FILE --objects DIR --receipt FILE');options[args[i]]=args[i+1];}
let bucket,phase="local-verification";
try{
 const registry=validateServingManifest(JSON.parse(await fs.readFile(options['--registry'],'utf8')));
 const refs=servingObjects(registry),legacyDirectory=options['--legacy-dir'],sourceOf=new Map(refs.map(ref=>[ref.sha256,path.join(options['--objects'],ref.sha256)]));
 if(legacyDirectory)for(const ref of legacy.chunks)if(!sourceOf.has(ref.sha256)){refs.push(ref);sourceOf.set(ref.sha256,path.join(legacyDirectory,ref.key));}
 const hash=b=>createHash('sha256').update(b).digest('hex');
 // Fail before any upload if the local release is incomplete.
 for(const ref of refs){const b=await fs.readFile(sourceOf.get(ref.sha256));if(b.length!==ref.bytes||hash(b)!==ref.sha256)throw Error('Local serving object failed verification');}
 phase="spaces-upload";bucket=await spacesEbdBucket(process.env,{writable:true});let uploaded=0;const verified=[];
 for(const ref of refs){const previous=await bucket.head(ref.sha256);if(!previous){await bucket.put(ref.sha256,await fs.readFile(sourceOf.get(ref.sha256)));uploaded++;}else if(previous.size!==ref.bytes)throw Error('Existing immutable object size mismatch');
  const object=await bucket.get(ref.sha256);if(!object)throw Error('Uploaded object missing');const b=Buffer.from(await object.arrayBuffer());if(b.length!==ref.bytes||hash(b)!==ref.sha256)throw Error('Remote serving object failed verification');verified.push(ref.sha256);
  if(verified.length%50===0)console.log(JSON.stringify({verified:verified.length,total:refs.length,uploaded}));
 }
 const receipt={schema:'aviquiz-upload-receipt-v1',revision:registry.revision,bucket:process.env.SPACES_BUCKET||'aviquiz-data',verified,uploaded,verifiedAt:new Date().toISOString()};
 await fs.writeFile(options['--receipt'],JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({verified:verified.length,uploaded,revision:registry.revision,activated:false}));
}catch(error){console.error(JSON.stringify({event:'serving_upload_failed',phase,providerStatus:error.providerStatus||null,providerCode:error.providerCode||null,activated:false}));console.error('Serving upload failed; credentials and raw provider errors withheld. No activation performed.');process.exitCode=1;}finally{bucket?.close();}
