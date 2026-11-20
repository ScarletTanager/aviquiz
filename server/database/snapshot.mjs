import {createHash} from 'node:crypto';
export const TABLES=Object.freeze({
  app_users:['id','email','status','created_at'],
  app_identities:['issuer','subject','user_id'],
  app_grants:['user_id','permission'],
  app_bootstrap:['id','user_id','attempt','created_at'],
  audit_events:['id','actor_user_id','action','resource_type','resource_id','details_json','created_at'],
  photo_reviews:['photo_id','species_id','status','revision','document_json','approved_json','updated_at']
});
const keys={app_users:['id'],app_identities:['issuer','subject'],app_grants:['user_id','permission'],app_bootstrap:['id'],audit_events:['id'],photo_reviews:['photo_id']};
export function tableDigest(rows){
  const normalized=rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort();
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
export function validateSnapshot(snapshot){
  if(snapshot?.format!=='aviquiz-database-snapshot'||snapshot.version!==1)throw Error('Unsupported database snapshot.');
  if(JSON.stringify(Object.keys(snapshot.tables||{}).sort())!==JSON.stringify(Object.keys(TABLES).sort()))throw Error('Unexpected snapshot tables.');
  for(const [table,columns] of Object.entries(TABLES)){
    const rows=snapshot.tables[table];if(!Array.isArray(rows))throw Error('Invalid table rows.');
    const ids=new Set();
    for(const row of rows){
      if(!row||JSON.stringify(Object.keys(row).sort())!==JSON.stringify([...columns].sort()))throw Error('Unexpected snapshot columns.');
      if(Object.values(row).some(v=>v!==null&&!['string','number'].includes(typeof v)))throw Error('Invalid snapshot value.');
      const key=JSON.stringify(keys[table].map(k=>row[k]));if(ids.has(key))throw Error('Duplicate snapshot primary key.');ids.add(key);
      for(const column of columns.filter(c=>c.endsWith('_json')))if(row[column]!==null)JSON.parse(row[column]);
    }
  }
  return snapshot;
}
export async function readTables(client){
  const tables={};for(const table of Object.keys(TABLES))tables[table]=(await client.query(`SELECT * FROM ${table}`)).rows;
  return tables;
}
export async function importSnapshot(client,snapshot,{saveBackup=async()=>{}}={}){
  validateSnapshot(snapshot);
  await client.query('BEGIN');
  try{
    await client.query(`LOCK TABLE ${Object.keys(TABLES).join(',')} IN EXCLUSIVE MODE`);
    const before=await readTables(client);
    if(Object.values(before).some(rows=>rows.length)){
      if(Object.keys(TABLES).every(t=>tableDigest(before[t])===tableDigest(snapshot.tables[t]))){await client.query('ROLLBACK');return {alreadyImported:true,counts:Object.fromEntries(Object.keys(TABLES).map(t=>[t,before[t].length]))};}
      throw Error('Target application tables are not empty; no overwrite is allowed.');
    }
    await saveBackup({format:'aviquiz-database-snapshot',version:1,capturedAt:new Date().toISOString(),source:{kind:'postgres-pre-import'},tables:before});
    for(const [table,columns] of Object.entries(TABLES)){
      const query=`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`;
      for(const row of snapshot.tables[table])await client.query(query,columns.map(c=>row[c]));
    }
    const after=await readTables(client);
    const digests={};
    for(const table of Object.keys(TABLES)){
      digests[table]=tableDigest(after[table]);
      if(digests[table]!==tableDigest(snapshot.tables[table]))throw Error('Imported rows do not match source.');
    }
    await client.query('COMMIT');
    return {alreadyImported:false,counts:Object.fromEntries(Object.keys(TABLES).map(t=>[t,after[t].length])),digests};
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
}
