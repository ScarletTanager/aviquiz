import {resolveDatabaseConfig} from './config.mjs';
import {fileEbdBucket} from '../ebd-files.mjs';
import {fileURLToPath} from 'node:url';
// Node startup only. The Worker receives its existing D1 binding unchanged.
export async function createDatabase(config,{d1}={}) {
  const driver=config.DB_DRIVER;
  if(driver==='d1') {
    if(!d1?.prepare||!d1?.batch)throw Error('D1 requires a platform database binding.');
    return d1;
  }
  if(driver==='sqlite') {
    if(!config.SQLITE_PATH)throw Error('SQLITE_PATH is required for standalone SQLite.');
    const {createSqliteDatabase}=await import('./sqlite.mjs');
    return createSqliteDatabase(config.SQLITE_PATH);
  }
  if(driver==='postgres') {
    const {createPostgresDatabase}=await import('./postgres.mjs');
    return createPostgresDatabase(await resolveDatabaseConfig(config));
  }
  throw Error('Set DB_DRIVER to d1, sqlite, or postgres. No database fallback is permitted.');
}
export async function createDatabaseEnvironment(config,options) {
  const db=await createDatabase(config,options);
  try{await db.prepare('SELECT 1 AS ready').first();}
  catch{await db.close?.();throw Error('Configured database is unavailable.');}
  let invitations;
  try{
    if(config.INVITATIONS_ENABLED==='true'){
      if(config.AUTH_ENABLED!=='true')throw Error('Invitations require account sign-in.');
      const {cognitoInvitationProvider}=await import('../invitation-provider.mjs');
      invitations=cognitoInvitationProvider(config);
    }
  }catch{await db.close?.();throw Error('Invitation provider configuration is invalid.');}
  const {createEbirdLocations}=await import('../ebird-locations.mjs');
  let apiKey=config.EBIRD_API_KEY;
  try{if(config.EBIRD_API_KEY_FILE){const fs=await import('node:fs/promises');apiKey=(await fs.readFile(config.EBIRD_API_KEY_FILE,'utf8')).trim();} }catch{await db.close();throw Error('eBird location key file is unavailable.');}
  const {locationCache}=await import('../location-cache.mjs');
  const locations=createEbirdLocations({apiKey,store:locationCache(db)});
  let ebd;
  try{
    if(config.EBD_STORAGE==='spaces'){const {spacesEbdBucket}=await import('../ebd-spaces.mjs');ebd=await spacesEbdBucket(config);}
    else if(!config.EBD_STORAGE||config.EBD_STORAGE==='files')ebd=await fileEbdBucket(config.EBD_DATA_DIR||fileURLToPath(new URL('../../ebd/',import.meta.url)),{optional:!config.EBD_DATA_DIR});
    else throw Error('Unknown EBD storage driver');
  }
  catch{await db.close();throw Error('EBD serving data configuration is invalid.');}
  return {...config,EBD_BUCKET:ebd,LOCATION_DIRECTORY:locations,DEPLOYMENT_TARGET:'standalone',DB:db,INVITATION_PROVIDER:invitations};
}
