// DigitalOcean only: explicit endpoint and credentials, never AWS's default chain.
import {S3Client,GetObjectCommand,HeadObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import dns from 'node:dns';
import https from 'node:https';
const MAX=32*1024*1024;
export function isPrivateIPv4(address){const a=address.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(a[0]===10||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168);}
export function privateSpacesLookup(requirePrivate=true,lookup=dns.lookup){return (host,options,callback)=>{
 if(typeof options==='number')options={family:options};
 lookup(host,{...options,all:true,family:4},(error,addresses)=>{
  if(error)return callback(error);
  if(!addresses.length||requirePrivate&&addresses.some(a=>!isPrivateIPv4(a.address)))return callback(Error('Spaces private DNS resolution required'));
  if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,4);
 });
};}
export async function spacesEbdBucket(config,{writable=false,client:provided}={}){
 const bucket=config.SPACES_BUCKET||'aviquiz-data',endpoint=config.SPACES_ENDPOINT||'https://nyc3.digitaloceanspaces.com';
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)||!/^https:\/\/[a-z0-9]+\.digitaloceanspaces\.com$/.test(endpoint))throw Error('Invalid Spaces endpoint or bucket');
 if(config.SPACES_REQUIRE_PRIVATE!==undefined&&!['true','false'].includes(config.SPACES_REQUIRE_PRIVATE))throw Error('Invalid Spaces private-network setting');
 let client=provided;
 if(!client){
  if(!config.SPACES_ACCESS_KEY_ID||!config.SPACES_SECRET_KEY_FILE)throw Error('Spaces key ID and private secret-file path required');
  const secretAccessKey=(await fs.readFile(config.SPACES_SECRET_KEY_FILE,'utf8')).trim();if(!secretAccessKey)throw Error('Spaces secret file is empty');
  client=new S3Client({endpoint,region:'us-east-1',forcePathStyle:false,maxAttempts:3,followRegionRedirects:false,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',credentials:{accessKeyId:config.SPACES_ACCESS_KEY_ID,secretAccessKey},requestHandler:{connectionTimeout:5000,requestTimeout:30000,httpsAgent:new https.Agent({keepAlive:true,maxSockets:8,lookup:privateSpacesLookup(config.SPACES_REQUIRE_PRIVATE!=='false')})}});
 }
 const keyOf=key=>{if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid serving object key');return {Bucket:bucket,Key:key};};
 async function send(command){try{return await client.send(command);}catch(e){if(e?.$metadata?.httpStatusCode===404||e.name==='NoSuchKey'||e.name==='NotFound')return null;const failure=Error('Spaces object request failed');failure.providerStatus=e?.$metadata?.httpStatusCode||null;failure.providerCode=['AccessDenied','InvalidAccessKeyId','SignatureDoesNotMatch','PreconditionFailed','NotImplemented','SlowDown','NoSuchBucket'].includes(e.name)?e.name:'SpacesRequestFailed';throw failure;}}
 const api={
  async head(key){const r=await send(new HeadObjectCommand(keyOf(key)));return r?{size:r.ContentLength}:null;},
  async get(key,{range}={}){
   if(range&&(!Number.isSafeInteger(range.offset)||range.offset<0||!Number.isSafeInteger(range.length)||range.length<1||range.length>MAX))throw Error('Invalid serving object range');
   const r=await send(new GetObjectCommand({...keyOf(key),...(range?{Range:`bytes=${range.offset}-${range.offset+range.length-1}`}:{})}));if(!r)return null;
   try{
    if(!Number.isSafeInteger(r.ContentLength)||r.ContentLength<1||r.ContentLength>MAX||range&&(r.ContentLength!==range.length||!r.ContentRange?.startsWith(`bytes ${range.offset}-${range.offset+range.length-1}/`)))throw Error('Invalid Spaces object response');
    const parts=[];let length=0;
    for await(const part of r.Body){length+=part.length;if(length>r.ContentLength)throw Error('Oversized Spaces object');parts.push(part);}
    if(length!==r.ContentLength)throw Error('Incomplete Spaces object');const bytes=Buffer.concat(parts,length);return {arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
   }finally{r.Body?.destroy?.();}
  },
  close(){client.destroy?.();}
 };
 if(writable)api.put=async(key,bytes)=>{if(bytes.byteLength>MAX)throw Error('Serving object exceeds size limit');if(!await send(new PutObjectCommand({...keyOf(key),Body:bytes,ContentLength:bytes.byteLength,ContentType:'application/octet-stream',ACL:'private',IfNoneMatch:'*'})))throw Error('Spaces upload failed');};
 return api;
}
