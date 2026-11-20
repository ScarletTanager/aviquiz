// Run ONLY as root on the prepared Droplet. Never log passwords, URLs, or driver errors.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import pg from 'pg';
const host='private-aviquiz-db-pgsql-nyc1-08185-do-user-49273569-0.h.db.ondigitalocean.com';
const directory='/root/aviquiz-db-setup',adminFile='/root/aviquiz-db-admin.env',stateFile=path.join(directory,'state.json');
const certificate='/etc/aviquiz/db-ca.crt';
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
const literal=value=>"'"+value.replaceAll("'","''")+"'";
// PostgreSQL SCRAM-SHA-256 verifier, RFC 5802 derivation with ASCII generated passwords.
// Only the verifier, not the generated plaintext password, enters role-creation SQL.
function verifier(password){
  const salt=randomBytes(16),iterations=4096;
  const salted=pbkdf2Sync(password,salt,iterations,32,'sha256');
  const client=createHmac('sha256',salted).update('Client Key').digest();
  const stored=createHash('sha256').update(client).digest('base64');
  const server=createHmac('sha256',salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${stored}:${server}`;
}
async function protectedFile(file){
  const info=await fs.lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o777)!==0o600)throw Error('Unsafe protected-file permissions');
  return fs.readFile(file,'utf8');
}
function parseAdmin(text){
  const result={};
  for(const line of text.split(/\r?\n/)){
    if(!line||line.trimStart().startsWith('#'))continue;
    const split=line.indexOf('=');if(split<0)throw Error('Invalid administrator file format');
    const key=line.slice(0,split).trim();let value=line.slice(split+1);
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(!['PGUSER','PGPASSWORD'].includes(key)||key in result)throw Error('Invalid administrator file keys');
    result[key]=value; // Literal parsing, never shell source/eval or interpolation.
  }
  if(result.PGUSER!=='doadmin'||!result.PGPASSWORD)throw Error('Missing administrator credentials');
  return result;
}
async function writeProtected(file,text){
  const temporary=file+'.new';
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
  await fs.rename(temporary,file);
}
function connection(user,password,database,ca){
  return new pg.Client({host,port:25060,user,password,database,
    connectionTimeoutMillis:10000,statement_timeout:15000,ssl:{ca,rejectUnauthorized:true}});
}
const handles=[];
let phase='configuration';
try{
  if(process.getuid()!==0)throw Error('Root required');
  const admin=parseAdmin(await protectedFile(adminFile)),ca=await fs.readFile(certificate,'utf8');
  const primary=connection(admin.PGUSER,admin.PGPASSWORD,'defaultdb',ca);handles.push(primary);await primary.connect();
  const info=(await primary.query("SELECT current_user, current_setting('server_version') AS version, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
  console.log(JSON.stringify({phase:'administrator_authenticated',user:info.current_user,version:info.version,createDatabase:info.rolcreatedb,createRole:info.rolcreaterole}));
  if(!info.rolcreatedb||!info.rolcreaterole)throw Error('Administrator lacks provisioning rights');
  if(process.argv.includes('--inspect-only'))process.exitCode=0;
  else{
    phase='state';
    let state;
    try{state=JSON.parse(await protectedFile(stateFile));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const roles=(await primary.query("SELECT rolname FROM pg_roles WHERE rolname IN ('aviquiz_migrator','aviquiz_runtime')")).rows;
      const database=(await primary.query("SELECT datname FROM pg_database WHERE datname='aviquiz'")).rows;
      if(roles.length||database.length)throw Error('Existing objects require review before provisioning');
      state={id:randomUUID(),migrator:randomBytes(48).toString('base64url'),runtime:randomBytes(48).toString('base64url')};
      await writeProtected(stateFile,JSON.stringify(state));
    }
    const marker='aviquiz-setup:'+state.id;
    phase='roles';
    await primary.query("SET createrole_self_grant = 'set'");
    await primary.query('BEGIN');
    try{
      for(const [role,password,limit] of [['aviquiz_migrator',state.migrator,2],['aviquiz_runtime',state.runtime,10]]){
        const existing=(await primary.query("SELECT shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",[role])).rows[0];
        if(existing){if(existing.marker!==marker)throw Error('Unexpected existing role');}
        else{
          await primary.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${limit} PASSWORD ${literal(verifier(password))}`);
          await primary.query(`COMMENT ON ROLE ${identifier(role)} IS ${literal(marker)}`);
        }
      }
      await primary.query('COMMIT');
    }catch(error){await primary.query('ROLLBACK');throw error;}
    phase='database';
    const database=(await primary.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname='aviquiz'")).rows[0];
    if(database&&database.owner!=='aviquiz_migrator')throw Error('Unexpected database owner');
    if(!database)await primary.query('CREATE DATABASE aviquiz OWNER aviquiz_migrator');
    const schema=connection('aviquiz_migrator',state.migrator,'aviquiz',ca);handles.push(schema);await schema.connect();
    await schema.query('REVOKE ALL ON DATABASE aviquiz FROM PUBLIC');
    await schema.query('GRANT CONNECT ON DATABASE aviquiz TO aviquiz_runtime, doadmin');
    await schema.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    phase='schema';
    // Run the repository's immutable/checksummed migration path as the schema owner.
    const {migrateDatabase}=await import('./server/database/migrate.mjs');
    const makeURL=(user,password)=>`postgresql://${user}:${encodeURIComponent(password)}@${host}:25060/aviquiz`;
    const migrationConfig={DB_DRIVER:'postgres',DATABASE_URL:makeURL('aviquiz_migrator',state.migrator),DATABASE_SSL:'verify-full',DATABASE_CA_FILE:certificate};
    const applied=await migrateDatabase(migrationConfig);
    phase='privileges';
    await schema.query('BEGIN');
    try{
      await schema.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, aviquiz_runtime');
      await schema.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
      await schema.query('GRANT USAGE ON SCHEMA public TO aviquiz_runtime');
      await schema.query('GRANT SELECT,INSERT,UPDATE ON photo_reviews,app_users TO aviquiz_runtime');
      await schema.query('GRANT SELECT,INSERT ON app_identities,app_bootstrap,audit_events TO aviquiz_runtime');
      await schema.query('GRANT SELECT,INSERT,DELETE ON app_grants TO aviquiz_runtime');
      await schema.query('GRANT SELECT ON aviquiz_schema_migrations TO aviquiz_runtime');
      await schema.query('COMMIT');
    }catch(error){await schema.query('ROLLBACK');throw error;}
    phase='runtime_verification';
    const runtime=connection('aviquiz_runtime',state.runtime,'aviquiz',ca);handles.push(runtime);await runtime.connect();
    const tls=(await runtime.query('SELECT ssl,version,cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
    const rights=(await runtime.query(`SELECT current_user, current_database(),
      has_database_privilege(current_user,'aviquiz','CREATE') AS can_create,
      has_schema_privilege(current_user,'public','CREATE') AS can_create_schema_objects,
      has_table_privilege(current_user,'audit_events','INSERT') AS can_insert_audit,
      has_table_privilege(current_user,'audit_events','UPDATE') AS can_update_audit,
      has_table_privilege(current_user,'audit_events','DELETE') AS can_delete_audit,
      has_table_privilege(current_user,'audit_events','TRUNCATE') AS can_truncate_audit,
      has_table_privilege(current_user,'aviquiz_schema_migrations','INSERT') AS can_change_migrations`)).rows[0];
    if(!tls.ssl||rights.can_create||rights.can_create_schema_objects||!rights.can_insert_audit||rights.can_update_audit||rights.can_delete_audit||rights.can_truncate_audit||rights.can_change_migrations)throw Error('Runtime privilege verification failed');
    // Roll back a synthetic account + audit transaction; no test users persist.
    const testId=randomUUID();await runtime.query('BEGIN');
    try{
      await runtime.query("INSERT INTO app_users(id,email,created_at) VALUES($1,'setup-check@invalid.example',$2)",[testId,new Date().toISOString()]);
      await runtime.query("INSERT INTO audit_events VALUES($1,$2,'setup.check','user',$2,'{}',$3)",[randomUUID(),testId,new Date().toISOString()]);
    }finally{await runtime.query('ROLLBACK');}
    await runtime.query('SELECT COUNT(*) FROM photo_reviews');
    phase='environment_files';
    await fs.mkdir('/etc/aviquiz',{recursive:true,mode:0o750});
    const environment=url=>`DB_DRIVER=postgres\nDEPLOYMENT_TARGET=standalone\nDATABASE_URL=${url}\nDATABASE_SSL=verify-full\nDATABASE_CA_FILE=${certificate}\nDATABASE_POOL_MAX=5\nPUBLIC_ORIGIN=https://aviquiz.org\n`;
    await writeProtected('/etc/aviquiz/aviquiz.env',environment(makeURL('aviquiz_runtime',state.runtime)));
    await writeProtected('/etc/aviquiz/migration.env',environment(migrationConfig.DATABASE_URL));
    console.log(JSON.stringify({phase:'provisioned',database:'aviquiz',runtimeUser:'aviquiz_runtime',schemaOwner:'aviquiz_migrator',migrations:applied.applied,tls,rights,syntheticTestRolledBack:true,credentialFilesWritten:true}));
    phase='cleanup';
    await fs.unlink(adminFile);
    await fs.unlink(stateFile);
    console.log('Temporary administrator and provisioning-state credential files removed.');
  }
}catch(error){
  // No message/stack/query/connection object: any of them can contain secrets.
  const safeCode=/^[A-Z0-9_]{2,30}$/.test(error.code||'')?error.code:'REDACTED';
  console.error(JSON.stringify({status:'failed',phase,code:safeCode,credentialsNotPrinted:true,administratorFileKept:true}));process.exitCode=1;
}finally{for(const handle of handles.reverse()){try{await handle.end();}catch{}}}
