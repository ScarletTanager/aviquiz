// Read-only R2-compatible range reads for immutable, packaged serving artifacts.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
export async function fileEbdBucket(directory,{optional=false}={}){
 const root=path.resolve(directory);
 try{if(!(await fs.stat(root)).isDirectory())throw Error('Not a directory');}
 catch(error){if(optional&&error.code==='ENOENT')return undefined;throw Error('EBD serving directory is unavailable.');}
 async function open(key){
  if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid EBD artifact key.');
  try{return await fs.open(path.join(root,key),constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 return {
  async head(key){const file=await open(key);if(!file)return null;try{return {size:(await file.stat()).size};}finally{await file.close();}},
  async get(key,{range}={}){
   const file=await open(key);if(!file)return null;
   try{
    const stat=await file.stat(),offset=range?.offset??0,length=range?.length??stat.size;
    if(!stat.isFile()||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||length>32*1024*1024||offset+length>stat.size)throw Error('Invalid EBD range.');
    const bytes=Buffer.alloc(length);let done=0;
    while(done<length){const result=await file.read(bytes,done,length-done,offset+done);if(!result.bytesRead)throw Error('Incomplete EBD artifact.');done+=result.bytesRead;}
    return {arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
   }finally{await file.close();}
  },
  async put(){throw Error('Packaged EBD serving data is read-only.');}
 };
}
