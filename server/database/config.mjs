import fs from 'node:fs/promises';
export async function resolveDatabaseConfig(config) {
  if(config.DB_DRIVER!=='postgres'||!config.DATABASE_CA_FILE)return config;
  if(config.DATABASE_CA)throw Error('Set DATABASE_CA or DATABASE_CA_FILE, not both.');
  const ca=await fs.readFile(config.DATABASE_CA_FILE,'utf8');
  if(!ca.includes('-----BEGIN CERTIFICATE-----'))throw Error('Database CA file is not a PEM certificate.');
  return {...config,DATABASE_CA:ca};
}
