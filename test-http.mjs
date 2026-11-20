import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHttpServer,publicAuthConfig} from './server/http.mjs';
import {accountRequestHeaders} from './dist/auth-session.mjs';
const origin='https://aviquiz.org';
const auth=publicAuthConfig({PUBLIC_ORIGIN:origin,AUTH_ENABLED:'true',DATABASE_URL:'private-do-not-expose'});
assert.equal(auth.redirect_uri,origin+'/auth/callback');assert.equal(auth.post_logout_redirect_uri,origin+'/');
assert.ok(!JSON.stringify(auth).includes('private-do-not-expose'));
assert.throws(()=>publicAuthConfig({PUBLIC_ORIGIN:'https://user:password@aviquiz.org'}));
assert.throws(()=>accountRequestHeaders('https://outside.example/api',origin,{}, {id_token:'test-token'}));
assert.equal(accountRequestHeaders('/api/reviews',origin,{}, {id_token:'test-token',expired:false}).get('authorization'),'Bearer test-token');
assert.equal(accountRequestHeaders('/api/reviews',origin,{}, {id_token:'test-token',expired:true}).get('authorization'),null);
let forwarded;
const env={PUBLIC_ORIGIN:origin,AUTH_ENABLED:'true',DB:{prepare(){return {async first(){return {ready:1};}};}}};
const server=createHttpServer(env,{app:{async fetch(request){forwarded=request;return new Response('ok',{headers:{'content-type':'text/plain'}});}}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
function request(path,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{host:'aviquiz.org',...headers}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString(),headers:res.headers}));
  });req.on('error',reject);req.end(body);
 });
}
try{
 assert.equal((await request('/healthz')).status,200);
 assert.equal((await request('/quiz',{headers:{host:'evil.example'}})).status,421);
 const config=await request('/auth-config.mjs');assert.equal(config.status,200);assert.ok(config.body.includes('https://aviquiz.org/auth/callback'));
 assert.equal((await request('/auth-config.mjs',{method:'HEAD'})).body,'');
 assert.equal((await request('/api/example',{method:'POST',headers:{origin,'oai-authenticated-user-id':'forged','content-type':'application/json'},body:'{}'})).status,200);
 assert.equal(forwarded.headers.get('oai-authenticated-user-id'),null);assert.equal(new URL(forwarded.url).origin,origin);
 assert.equal((await request('/api/example',{method:'POST',headers:{'content-length':'200001'},body:'x'.repeat(200001)})).status,413);
 assert.equal((await request('//outside.example/')).status,400);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('Passed standalone HTTP health, canonical origin/host handling, private auth-config filtering, HEAD, body limits, forged hosting-header stripping, and same-origin credential forwarding. No AWS requests.');

// Deployment invokes the entrypoint through a release symlink; main detection must survive it.
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-entry-'));
let child;
try{
 const link=path.join(temporary,'entry.mjs');await fs.symlink(path.resolve('server/http.mjs'),link);
 child=spawn(process.execPath,[link],{env:{...process.env,DB_DRIVER:'sqlite',SQLITE_PATH:':memory:',PUBLIC_ORIGIN:'http://localhost',HOST:'127.0.0.1',PORT:'0'}});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Symlink entrypoint did not start')),10000);
  child.stdout.on('data',bytes=>{if(bytes.toString().includes('listening on loopback')){clearTimeout(timer);resolve();}});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Symlink entry exited early: '+code));});
  child.once('error',reject);
 });
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');assert.equal(await exited,0);
}finally{child?.kill();await fs.rm(temporary,{recursive:true,force:true});}
console.log('Passed real process startup through release symlink and graceful SIGTERM shutdown.');
