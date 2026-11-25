import {t} from '../dist/i18n.mjs';
// Runtime-neutral: no Node, filesystem, PostgreSQL driver, or connection secrets.
export function databaseForEnvironment(env) {
  const driver=env.DB_DRIVER||'d1';
  if(!['d1','sqlite','postgres'].includes(driver))throw Error(t("worker-database:unsupported_database_driver_c780d78d"));
  if(!env.DB||typeof env.DB.prepare!=='function'||typeof env.DB.batch!=='function')throw Error(t("worker-database:database_unavailable_0f450bc5"));
  if(driver!=='d1'&&env.DB.dialect!==driver)throw Error(t("worker-database:database_driver_does_not_match_its_adapter_8ce8585d"));
  if(driver==='d1'&&env.DB.dialect&&env.DB.dialect!=='d1')throw Error(t("worker-database:database_driver_does_not_match_its_adapter_8ce8585d"));
  return env.DB;
}
export const firstReviewWrite=(db,statement)=>db.atomicFirst?db.atomicFirst(statement,'photo-reviews'):statement.first();
export const usesSitesIdentity=env=>(env.DEPLOYMENT_TARGET||'sites')==='sites'&&(env.DB_DRIVER||'d1')==='d1';
