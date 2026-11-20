// Runtime-neutral: no Node, filesystem, PostgreSQL driver, or connection secrets.
export function databaseForEnvironment(env) {
  const driver=env.DB_DRIVER||'d1';
  if(!['d1','sqlite','postgres'].includes(driver))throw Error('Unsupported database driver.');
  if(!env.DB||typeof env.DB.prepare!=='function'||typeof env.DB.batch!=='function')throw Error('Database unavailable.');
  if(driver!=='d1'&&env.DB.dialect!==driver)throw Error('Database driver does not match its adapter.');
  if(driver==='d1'&&env.DB.dialect&&env.DB.dialect!=='d1')throw Error('Database driver does not match its adapter.');
  return env.DB;
}
export const firstReviewWrite=(db,statement)=>db.atomicFirst?db.atomicFirst(statement,'photo-reviews'):statement.first();
export const usesSitesIdentity=env=>(env.DEPLOYMENT_TARGET||'sites')==='sites'&&(env.DB_DRIVER||'d1')==='d1';
