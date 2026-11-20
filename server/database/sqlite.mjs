import {DatabaseSync} from 'node:sqlite';
export function createSqliteDatabase(filename) {
  const sqlite=new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if(filename!==':memory:')sqlite.exec('PRAGMA journal_mode=WAL;');
  const owner={};
  function query(sql,values,method){
    try{return sqlite.prepare(sql)[method](...values);}
    catch(error){error.databaseError=true;throw error;}
  }
  class Statement {
    constructor(sql,values=[]){this.sql=sql;this.values=values;this.owner=owner;}
    bind(...values){return new Statement(this.sql,values);}
    async first(){return query(this.sql,this.values,'get')||null;}
    async all(){return {results:query(this.sql,this.values,'all')};}
    async run(){const result=query(this.sql,this.values,'run');return {success:true,meta:{changes:Number(result.changes)}};}
  }
  return {dialect:'sqlite',prepare:sql=>new Statement(sql),
    async batch(statements){
      if(statements.some(s=>s.owner!==owner))throw Error('Statement belongs to another database.');
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results=statements.map(s=>{const r=query(s.sql,s.values,'run');return {success:true,meta:{changes:Number(r.changes)}};});
        sqlite.exec('COMMIT');return results;
      } catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
    async atomicFirst(statement){if(statement.owner!==owner)throw Error('Statement belongs to another database.');return statement.first();},
    async close(){sqlite.close();}
  };
}
