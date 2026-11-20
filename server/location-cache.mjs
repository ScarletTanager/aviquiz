// Public directory metadata only. API keys are never stored in cache records.
export function locationCache(db){
 return {
  async get(key){const row=await db.prepare('SELECT body_json,fetched_at FROM location_metadata_cache WHERE cache_key=?').bind(key).first();return row?{rows:JSON.parse(row.body_json),fetchedAt:row.fetched_at}:null;},
  async put(key,value){
   const body=JSON.stringify(value.rows);if(Buffer.byteLength(body)>3*1024*1024)throw Error('Location list too large.');
   // Keep this small-host pilot cache below ~32 million characters and 1,000 lists.
   const statement=db.prepare("INSERT INTO location_metadata_cache (cache_key,body_json,fetched_at) SELECT ?,?,? WHERE (SELECT COALESCE(SUM(LENGTH(body_json)),0) FROM location_metadata_cache WHERE cache_key<>?)+LENGTH(?)<=32000000 AND (SELECT COUNT(*) FROM location_metadata_cache WHERE cache_key<>?)<1000 ON CONFLICT(cache_key) DO UPDATE SET body_json=excluded.body_json,fetched_at=excluded.fetched_at").bind(key,body,value.fetchedAt,key,body,key);
   const result=await statement.run();if(result.meta?.changes!==1)throw Error('Location cache capacity reached.');
  }
 };
}
