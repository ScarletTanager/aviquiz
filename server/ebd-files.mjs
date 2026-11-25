import {t} from '../dist/i18n.mjs';
// Read-only R2-compatible range reads for immutable, packaged serving artifacts.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
export async function fileEbdBucket(directory,{optional=false}={}){
 const root=path.resolve(directory);
 try{if(!(await fs.stat(root)).isDirectory())throw Error(t("server-ebd-files:not_a_directory_83c54ca7"));}
 catch(error){if(optional&&error.code==='ENOENT')return undefined;throw Error(t("server-ebd-files:ebd_serving_directory_is_unavailable_c0be8f0e"));}
 async function open(key){
  if(!/^[a-f0-9]{64}$/.test(key))throw Error(t("server-ebd-files:invalid_ebd_artifact_key_444f099e"));
  try{return await fs.open(path.join(root,key),constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 return {
  async head(key){const file=await open(key);if(!file)return null;try{return {size:(await file.stat()).size};}finally{await file.close();}},
  async get(key,{range}={}){
   const file=await open(key);if(!file)return null;
   try{
    const stat=await file.stat(),offset=range?.offset??0,length=range?.length??stat.size;
    if(!stat.isFile()||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||length>32*1024*1024||offset+length>stat.size)throw Error(t("server-ebd-files:invalid_ebd_range_ec042cdd"));
    const bytes=Buffer.alloc(length);let done=0;
    while(done<length){const result=await file.read(bytes,done,length-done,offset+done);if(!result.bytesRead)throw Error(t("server-ebd-files:incomplete_ebd_artifact_bee70f9b"));done+=result.bytesRead;}
    return {arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
   }finally{await file.close();}
  },
  async put(){throw Error(t("server-ebd-files:packaged_ebd_serving_data_is_read_only_25c6c4d3"));}
 };
}
