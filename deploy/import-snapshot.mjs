// Root-only migration CLI. Credentials are loaded via Node --env-file on the Droplet.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {resolveDatabaseConfig} from './server/database/config.mjs';
import {postgresPoolOptions} from './server/database/postgres.mjs';
import {importSnapshot,validateSnapshot} from './server/database/snapshot.mjs';
let client;
try{
  if(process.getuid()!==0)throw Error('Root is required.');
  const [file,expected]=process.argv.slice(2);
  if(!file||!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Snapshot and checksum required.');
  const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error('Snapshot too large.');
  const bytes=await fs.readFile(file),digest=createHash('sha256').update(bytes).digest('hex');
  if(digest!==expected)throw Error('Snapshot checksum mismatch.');
  const snapshot=validateSnapshot(JSON.parse(bytes));
  const config=await resolveDatabaseConfig(process.env);
  client=new pg.Client(postgresPoolOptions(config));await client.connect();
  const folder='/root/aviquiz-backups';await fs.mkdir(folder,{recursive:true,mode:0o700});
  const result=await importSnapshot(client,snapshot,{saveBackup:async backup=>{
    await fs.writeFile(path.join(folder,`pre-import-${digest.slice(0,16)}.json`),JSON.stringify(backup,null,2)+'\n',{mode:0o600,flag:'wx'});
  }});
  const receipt={sourceSha256:digest,importedAt:new Date().toISOString(),...result};
  await fs.writeFile(path.join(folder,`receipt-${digest.slice(0,16)}.json`),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(receipt));
}catch(error){console.error(JSON.stringify({status:'import_failed',code:/^[A-Z0-9_]{2,30}$/.test(error.code||'')?error.code:'VALIDATION_OR_TRANSACTION',credentialDetailsWithheld:true}));process.exitCode=1;}
finally{await client?.end();}
