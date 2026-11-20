// Read-only probe, bundled for the service user; never log environment or driver errors.
import {createDatabaseEnvironment} from '../server/database/index.mjs';
async function main(){
  let db;
  try{
    const env=await createDatabaseEnvironment(process.env);db=env.DB;
    const session=await db.prepare('SELECT current_user AS username,current_database() AS database').first();
    const tls=await db.prepare('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()').first();
    const role=await db.prepare('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user').first();
    const counts=await db.prepare('SELECT (SELECT COUNT(*) FROM app_users) AS users,(SELECT COUNT(*) FROM photo_reviews) AS reviews,(SELECT COUNT(*) FROM audit_events) AS audit_events').first();
    if(!tls.ssl||Object.values(role).some(Boolean))throw Error('Unsafe database configuration');
    console.log(JSON.stringify({status:'ready',driver:db.dialect,session,tls,role,counts}));
  }catch{console.error('Database service-user verification failed; credential details withheld.');process.exitCode=1;}
  finally{await db?.close();}
}
main();
