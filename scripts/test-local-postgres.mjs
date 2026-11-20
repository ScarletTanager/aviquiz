// Disposable loopback-only PostgreSQL. Never starts a login/system service.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
const option=process.argv.indexOf('--pg-bin');
if(option>=0&&!process.argv[option+1])throw Error('--pg-bin requires a path.');
const bin=(option>=0?process.argv[option+1]:process.env.PG_BIN)||'/opt/homebrew/opt/postgresql@18/bin';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-pg-'));
let started=false;
function command(name,args){
  const result=spawnSync(path.join(bin,name),args,{encoding:'utf8'});
  if(result.status!==0)throw Error(`Local PostgreSQL ${name} failed. ${result.stderr||result.error?.message||''}`);
  return result.stdout;
}
try {
  console.log(command('postgres',['--version']).trim());
  const port=await new Promise((resolve,reject)=>{
    const server=net.createServer();server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
  });
  await fs.mkdir(path.join(root,'socket'),{mode:0o700});
  command('initdb',['-D',path.join(root,'data'),'-A','trust','--no-locale','--encoding=UTF8','--username=aviquiz_test']);
  command('pg_ctl',['-D',path.join(root,'data'),'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${path.join(root,'socket')} -c shared_buffers=16MB -c max_connections=20`,'-w','start']);
  started=true;
  command('createdb',['-h','127.0.0.1','-p',String(port),'-U','aviquiz_test','aviquiz_test']);
  const result=spawnSync(process.execPath,['test-database.mjs'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:`postgresql://aviquiz_test@127.0.0.1:${port}/aviquiz_test`}});
  process.exitCode=result.status??1;
} catch(error){console.error(error.message);process.exitCode=1;}
finally {
  if(started)command('pg_ctl',['-D',path.join(root,'data'),'-w','-m','fast','stop']);
  await fs.rm(root,{recursive:true,force:true});
}
