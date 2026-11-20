import {resolveDatabaseConfig} from './config.mjs';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {postgresPoolOptions} from './postgres.mjs';
const root=new URL('../../',import.meta.url);
export async function migrateDatabase(config) {
  config=await resolveDatabaseConfig(config);
  const driver=config.DB_DRIVER;
  let execute,read,close;
  if(driver==='postgres') {
    const {default:pg}=await import('pg');
    const client=new pg.Client({...postgresPoolOptions(config),max:undefined});
    await client.connect();
    execute=(sql,values=[])=>client.query(sql,values);
    read=async()=> (await execute('SELECT id,checksum FROM aviquiz_schema_migrations')).rows;
    close=()=>client.end();
  } else if(driver==='sqlite') {
    if(!config.SQLITE_PATH)throw Error('SQLITE_PATH is required.');
    const {DatabaseSync}=await import('node:sqlite');
    const sqlite=new DatabaseSync(config.SQLITE_PATH);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    execute=async (sql,values=[])=>values.length?sqlite.prepare(sql).run(...values):sqlite.exec(sql);
    read=async()=>sqlite.prepare('SELECT id,checksum FROM aviquiz_schema_migrations').all();
    close=async()=>sqlite.close();
  } else throw Error('Use Sites migrations for D1; standalone migrations require DB_DRIVER=sqlite or postgres.');
  try {
    await execute(driver==='sqlite'?'BEGIN IMMEDIATE':'BEGIN');
    if(driver==='postgres')await execute("SELECT pg_advisory_xact_lock(hashtextextended('aviquiz:migrations',0))");
    await execute('CREATE TABLE IF NOT EXISTS aviquiz_schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const directory=new URL(driver==='postgres'?'migrations/postgres/':'drizzle/',root);
    const files=(await fs.readdir(directory)).filter(n=>/^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
    const applied=new Map((await read()).map(r=>[r.id,r.checksum]));
    if([...applied.keys()].some(id=>!files.includes(id)))throw Error('Applied migration is missing from source.');
    const added=[];
    for(const id of files) {
      const sql=await fs.readFile(new URL(id,directory),'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      if(applied.has(id)){if(applied.get(id)!==checksum)throw Error('Applied migration was modified.');continue;}
      await execute(sql);
      const now=new Date().toISOString();
      if(driver==='postgres')await execute('INSERT INTO aviquiz_schema_migrations VALUES ($1,$2,$3)',[id,checksum,now]);
      else await execute('INSERT INTO aviquiz_schema_migrations VALUES (?,?,?)',[id,checksum,now]);
      added.push(id);
    }
    await execute('COMMIT');return {driver,applied:added};
  } catch(error){try{await execute('ROLLBACK');}catch{}throw error;}
  finally{await close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  migrateDatabase(process.env).then(result=>console.log(JSON.stringify(result))).catch(()=>{
    console.error('Database migration failed. Verify configuration, access, and immutable migration history; connection details were not logged.');process.exitCode=1;
  });
}
