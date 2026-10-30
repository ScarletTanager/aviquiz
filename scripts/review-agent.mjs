// Shared review batch client. No credentials belong in batch files or Git.
// The Sites service credential is read from stdin; the local review key is ignored.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const input=JSON.parse(await new Promise(resolve=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>value+=c);process.stdin.on('end',()=>resolve(value));}));
const base='https://sandy-colombia-bird-quiz.lovelyquail12.chatgpt.site';
const {key}=JSON.parse(fs.readFileSync(path.join(root,'.review-agent.json')));
const headers={'content-type':'application/json','x-review-agent-key':key,...(input.serviceToken?{'OAI-Sites-Authorization':`Bearer ${input.serviceToken}`}:{})};
const call=async(route,body)=>{
 const response=await fetch(base+route,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw Error(`${response.status}: ${result.error||'Review request failed'}`);return result;
};
if(input.seed)await call('/api/reviews/seed',{});
let state=await call('/api/reviews');
if(input.exportPath)fs.writeFileSync(input.exportPath,JSON.stringify(state,null,2),{mode:0o600});
if(input.batchPath){
 const batch=JSON.parse(fs.readFileSync(input.batchPath));
 for(const item of batch){
  const existing=state.rows.find(r=>r.photoId===item.document.photoId);
  if(existing?.approved&&input.skipApproved!==false){console.log(`Already approved: ${item.document.speciesId}`);continue;}
  const saved=await call('/api/reviews/save',{action:item.action||'draft',revision:existing?.revision||0,document:item.document});
  state.rows=state.rows.filter(r=>r.photoId!==saved.row.photoId);state.rows.push(saved.row);
  console.log(`${saved.row.status}: ${saved.row.speciesId} / ML${saved.row.photoId} (revision ${saved.row.revision})`);
 }
 state=await call('/api/reviews');
}
console.log(JSON.stringify({coverage:state.coverage}));
