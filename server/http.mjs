import {t} from '../dist/i18n.mjs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import application from '../dist/server/index.js';
import {authConfig as defaults} from '../dist/auth-config.mjs';
import {createDatabaseEnvironment} from './database/index.mjs';
export function publicAuthConfig(config){
  const origin=new URL(config.PUBLIC_ORIGIN);
  if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw Error(t("server-http:public_origin_must_be_an_origin_766e8c93"));
  if(origin.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error(t("server-http:production_requires_https_5e0d4bcf"));
  return {enabled:config.AUTH_ENABLED==='true',authority:config.AUTH_ISSUER||defaults.authority,
    client_id:config.AUTH_CLIENT_ID||defaults.client_id,cognitoDomain:config.AUTH_DOMAIN||defaults.cognitoDomain,
    redirect_uri:origin.origin+'/auth/callback',post_logout_redirect_uri:origin.origin+'/'};
}
async function bodyFor(request,limit){
  return new Promise((resolve,reject)=>{
    let size=0,chunks=[];
    const fail=()=>{request.removeAllListeners('data');request.resume();reject(Error('body'));};
    request.on('data',chunk=>{size+=chunk.length;if(size>limit)fail();else chunks.push(chunk);});
    request.on('end',()=>resolve(Buffer.concat(chunks)));
    request.on('aborted',()=>reject(Error('aborted')));request.on('error',reject);
  });
}
export function createHttpServer(env,{app=application}={}){
  const origin=new URL(env.PUBLIC_ORIGIN),auth=publicAuthConfig(env);
  const server=http.createServer({maxHeaderSize:32768,headersTimeout:10000,requestTimeout:15000},async(req,res)=>{
    const id=randomUUID();
    res.setHeader('x-request-id',id);
    try{
      if(!req.url?.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end();return;}
      if(req.headers.host!==origin.host&&!((req.url==='/healthz')&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))){res.writeHead(421);res.end();return;}
      const url=new URL(req.url,origin);
      if(url.pathname==='/healthz'){
        if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        await env.DB.prepare('SELECT 1 AS ready').first();
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end('{"status":"ok"}');return;
      }
      const headers=new Headers();
      for(const [name,value] of Object.entries(req.headers)){
        if(name.startsWith('oai-')||['connection','transfer-encoding','host'].includes(name))continue;
        if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
      }
      let body;
      if(!['GET','HEAD'].includes(req.method)){
        const limit=url.pathname.startsWith('/api/statistics/')?1000000:200000;
        if(Number(req.headers['content-length'])>limit){res.writeHead(413);res.end();req.resume();return;}
        try{body=await bodyFor(req,limit);}catch{res.writeHead(413);res.end();return;}
      }
      let response;
      if(url.pathname==='/auth-config.mjs'&&['GET','HEAD'].includes(req.method))response=new Response('export const authConfig=Object.freeze('+JSON.stringify(auth)+');\n',{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'}});
      else response=await app.fetch(new Request(url,{method:req.method,headers,...(body?{body}: {})}),env);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
    }catch{
      console.error(JSON.stringify({event:'request_failed',requestId:id}));
      if(!res.headersSent)res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:t("server-http:service_temporarily_unavailable_9a6e032d")}));
    }
  });
  server.maxConnections=128;
  return server;
}
export async function startServer(config){
  const host=config.HOST||'127.0.0.1',port=Number(config.PORT||3000);
  if(host!=='127.0.0.1')throw Error(t("server-http:the_application_must_bind_to_loopback_behind_its_proxy_6a13b5fb"));
  const env=await createDatabaseEnvironment(config);
  const server=createHttpServer(env);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  let stopping;
  const stop=()=>stopping??=(async()=>{
    const timer=setTimeout(()=>server.closeAllConnections(),20000);timer.unref();
    await new Promise(resolve=>server.close(resolve));clearTimeout(timer);await env.DB.close();
  })();
  return {server,stop};
}
if(import.meta.main){
  startServer(process.env).then(({stop})=>{
    console.log('AviQuiz listening on loopback.');
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop().catch(()=>{process.exitCode=1;});});
  }).catch(()=>{console.error('AviQuiz startup failed; verify protected configuration and database access.');process.exitCode=1;});
}
