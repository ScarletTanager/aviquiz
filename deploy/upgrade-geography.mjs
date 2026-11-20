// Root-only production migration. Reads credentials from the protected process environment.
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {migrateDatabase} from './server/database/migrate.mjs';
import {resolveDatabaseConfig} from './server/database/config.mjs';
import {postgresPoolOptions} from './server/database/postgres.mjs';
let client;
try {
  if(process.getuid()!==0)throw Error('Root required.');
  const config=await resolveDatabaseConfig(process.env);
  const url=new URL(config.DATABASE_URL);
  const folder='/root/aviquiz-backups';await fs.mkdir(folder,{mode:0o700,recursive:true});
  const backup=folder+'/pre-geography-'+new Date().toISOString().replaceAll(':','-')+'.dump';
  await fs.writeFile(backup,'',{mode:0o600,flag:'wx'});
  const result=spawnSync('/usr/lib/postgresql/18/bin/pg_dump',['--format=custom','--no-owner','--no-acl','--file',backup],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',PGHOST:url.hostname,PGPORT:url.port,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.DATABASE_CA_FILE}});
  if(result.status!==0)throw Error('Backup failed.');
  const listing=spawnSync('/usr/lib/postgresql/18/bin/pg_restore',['--list',backup],{encoding:'utf8'});
  if(listing.status!==0||!listing.stdout.includes('app_users')||!listing.stdout.includes('photo_reviews'))throw Error('Backup listing incomplete.');
  console.log(JSON.stringify({backup,bytes:(await fs.stat(backup)).size,archiveReadable:true}));
  const applied=await migrateDatabase(process.env);
  console.log(JSON.stringify(applied));
  client=new pg.Client(postgresPoolOptions(config));await client.connect();
  await client.query(await fs.readFile('./geography-runtime-grants.sql','utf8'));
  const counts=(await client.query('SELECT (SELECT COUNT(*) FROM app_users) AS users,(SELECT COUNT(*) FROM photo_reviews) AS reviews,(SELECT COUNT(*) FROM app_invitations) AS invitations')).rows[0];
  console.log(JSON.stringify({status:'ready',counts}));
}catch{console.error('Geography upgrade failed. No connection or credential details were logged.');process.exitCode=1;}
finally{await client?.end();}
