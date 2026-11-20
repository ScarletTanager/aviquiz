import pg from 'pg';
import {postgresQuery} from './placeholders.mjs';
export function postgresPoolOptions(config) {
  if(!config.DATABASE_URL)throw Error('DATABASE_URL is required for PostgreSQL.');
  let url;
  try{url=new URL(config.DATABASE_URL);}catch{throw Error('Invalid PostgreSQL connection configuration.');}
  if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('Invalid PostgreSQL connection configuration.');
  // URL SSL parameters can override pg's explicit SSL object; reject that ambiguity.
  for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert'])if(url.searchParams.has(key))throw Error('Configure TLS with DATABASE_SSL and DATABASE_CA, not URL SSL parameters.');
  const mode=config.DATABASE_SSL||'verify-full';
  if(!['verify-full','disable'].includes(mode))throw Error('DATABASE_SSL must be verify-full or disable.');
  if(mode==='disable'&&!['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname)&&!url.searchParams.has('host'))throw Error('TLS can only be disabled for local PostgreSQL.');
  if(url.searchParams.has('host'))throw Error('Database host must be specified in the URL authority.');
  const max=Number(config.DATABASE_POOL_MAX||5);
  if(!Number.isInteger(max)||max<1||max>50)throw Error('Invalid database pool size.');
  return {connectionString:config.DATABASE_URL,max,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,
    statement_timeout:10000,ssl:mode==='disable'?false:{rejectUnauthorized:true,...(config.DATABASE_CA?{ca:config.DATABASE_CA}:{})}};
}
export function createPostgresDatabase(config) {
  const pool=new pg.Pool(postgresPoolOptions(config)),owner={};
  // Never emit an error object: driver errors can contain query or connection data.
  pool.on('error',()=>console.error('Idle PostgreSQL connection failed.'));
  class Statement {
    constructor(sql,values=[]){this.sql=sql;this.values=values;this.owner=owner;}
    bind(...values){return new Statement(this.sql,values);}
    query(){return postgresQuery(this.sql,this.values);}
    async first(){return (await query(this.query())).rows[0]||null;}
    async all(){return {results:(await query(this.query())).rows};}
    async run(){const r=await query(this.query());return {success:true,meta:{changes:r.rowCount},results:r.rows};}
  }
  const fail=error=>{error.databaseError=true;throw error;};
  const query=async statement=>pool.query(statement).catch(fail);
  const check=statements=>{if(statements.some(s=>s.owner!==owner))throw Error('Statement belongs to another database.');};
  async function transaction(callback) {
    const client=await pool.connect().catch(fail);
    let discard=false;
    try {
      await client.query('BEGIN');
      const result=await callback(client);await client.query('COMMIT');return result;
    } catch(error){try{await client.query('ROLLBACK');}catch{discard=true;}fail(error);}
    finally{client.release(discard);}
  }
  return {dialect:'postgres',prepare:sql=>new Statement(sql),
    async batch(statements){check(statements);return transaction(async client=>{
      const results=[];
      for(const statement of statements){const r=await client.query(statement.query());results.push({success:true,meta:{changes:r.rowCount},results:r.rows});}
      return results;
    });},
    async atomicFirst(statement,lock){
      check([statement]);if(lock!=='photo-reviews')throw Error('Unknown database lock.');
      return transaction(async client=>{
        // One lock coordinates all app instances. READ COMMITTED then sees the
        // preceding approval before evaluating the count guard in this statement.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('aviquiz:photo-reviews',0))");
        return (await client.query(statement.query())).rows[0]||null;
      });
    },
    async close(){await pool.end();}
  };
}
