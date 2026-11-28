// Verify a complete locally prepared release without network access or activation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {servingObjects,validateServingManifest} from './serving-release.mjs';
const [registryPath,objects]=process.argv.slice(2);
if(!registryPath||!objects)throw Error('Usage: node scripts/verify-seasonal.mjs REGISTRY OBJECTS');
const registry=validateServingManifest(JSON.parse(await fs.readFile(registryPath,'utf8'))),refs=servingObjects(registry);let total=0;
for(const ref of refs){const bytes=await fs.readFile(path.join(objects,ref.sha256));if(bytes.length!==ref.bytes||createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('Serving object verification failed: '+ref.sha256);total+=bytes.length;}
console.log(JSON.stringify({valid:true,schema:registry.schema,revision:registry.revision,objects:refs.length,bytes:total,coverage:registry.coverage}));
