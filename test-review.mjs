import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reviewCoverage,reviewQueue,validateReview} from './dist/review-core.mjs';
import {applySharedTips,tipsFor,annotatedBirds} from './dist/id-tips.mjs';
import worker,{api} from './dist/server/index.js';
const catalog=JSON.parse(fs.readFileSync('dist/data.json'));
const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('drizzle/0000_photo_reviews.sql','utf8'));
class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.sql,args);}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
  async run(){return sqlite.prepare(this.sql).run(...this.args);}
}
const DB={prepare:sql=>new Statement(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sqlite.exec('COMMIT');return values;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const env={DB,REVIEW_AGENT_KEY:'test-agent-key',REVIEW_OWNER_EMAIL:'owner@example.org'},owner='0a42fa64-ecdd-4efa-98c5-e2c95f94320f';
const req=(path,body,headers={})=>new Request('https://quiz.example'+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const call=async(path,body,headers={'oai-authenticated-user-id':owner})=>{const response=await api(req(path,body,headers),env);return {status:response.status,body:await response.json()};};
assert.equal((await call('/api/reviews',null,{})).status,403);
assert.equal((await call('/api/reviews',null,{'oai-authenticated-user-id':'viewer'})).status,403);
assert.equal((await call('/api/reviews',null,{'oai-authenticated-user-id':'site-scoped-owner','oai-authenticated-user-email':'OWNER@example.org'})).status,200);
assert.equal((await call('/api/reviews',null,{'oai-authenticated-user-email':'owner@example.org'})).status,403);
assert.equal((await call('/api/reviews',null,{'x-review-agent-key':'wrong'})).status,403);
assert.equal((await call('/api/reviews',null,{'x-review-agent-key':'test-agent-key'})).status,200);
const bird=catalog.birds[0],photo=bird.photos[0];
const doc={speciesId:bird.id,photoId:photo.id,source:`https://ebird.org/species/${bird.id}`,width:1200,height:800,tips:['Paraphrased source guidance.'],features:[{title:'Visible feature',lines:['Inspect this visible feature.'],point:[.5,.4]}],notes:'Draft note',sourceChecked:true,photoChecked:true};
assert.throws(()=>validateReview({...doc,source:'https://other.example'},catalog.birds));
assert.throws(()=>validateReview({...doc,features:[{...doc.features[0],point:[2,.4]}]},catalog.birds));
assert.throws(()=>validateReview({...doc,photoChecked:false},catalog.birds,{approve:true}));
let result=await call('/api/reviews/save',{action:'draft',revision:0,document:doc});assert.equal(result.status,200);
assert.equal((await call('/api/annotations',null,{})).body.annotations.length,0);
assert.equal((await call('/api/reviews/save',{action:'draft',revision:0,document:doc})).status,409);
assert.equal((await call('/api/reviews/save',{action:'approve',revision:1,document:doc},{'oai-authenticated-user-id':owner,origin:'https://other.example'})).status,403);
result=await call('/api/reviews/save',{action:'approve',revision:1,document:doc});assert.equal(result.status,200);
const published=(await call('/api/annotations',null,{})).body;assert.equal(published.annotations.length,1);assert.equal(published.annotations[0].notes,undefined);
assert.equal(published.coverage.covered,1);
result=await call('/api/reviews/save',{action:'draft',revision:2,document:{...doc,tips:['Changed draft.']}});assert.equal(result.status,200);
assert.deepEqual((await call('/api/annotations',null,{})).body.annotations[0].tips,doc.tips);
const next={...doc,photoId:bird.photos[1].id};
assert.equal((await call('/api/reviews/save',{action:'approve',revision:0,document:next})).status,409);
const all=(await call('/api/reviews')).body.rows;
const queue=reviewQueue(catalog.birds,all);assert.equal(queue[0].speciesId,catalog.birds[1].id);assert.ok(new Set(queue.map(q=>q.speciesId)).size===queue.length);
assert.ok(reviewQueue(catalog.birds,all,{family:'Furnariidae'}).every(q=>catalog.birds.find(b=>b.id===q.speciesId).family==='Furnariidae'));
assert.equal(reviewCoverage(catalog.birds,all).round,1);
result=await call('/api/reviews/save',{action:'unpublish',revision:3,document:doc});assert.equal(result.status,200);
assert.equal((await call('/api/annotations',null,{})).body.annotations.length,0);
assert.equal((await call('/api/reviews/seed',{})).status,200);assert.equal((await call('/api/reviews/seed',{})).status,200);
assert.equal((await call('/api/annotations',null,{})).body.annotations.length,6);
const raceBird=catalog.birds[1];
const racing=await Promise.all(raceBird.photos.slice(0,2).map(p=>call('/api/reviews/save',{action:'approve',revision:0,document:{...doc,speciesId:raceBird.id,photoId:p.id,source:`https://ebird.org/species/${raceBird.id}`}})));
assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);
const skipped=bird.photos.map(p=>({photoId:String(p.id),speciesId:bird.id,status:'skipped',approved:null}));
assert.ok(reviewCoverage(catalog.birds,skipped).blocked.includes(bird.id));
assert.equal(reviewCoverage([bird],skipped).round,1);
assert.ok(!reviewQueue(catalog.birds,skipped).some(q=>q.speciesId===bird.id));
applySharedTips([doc]);
assert.equal(tipsFor(bird,photo,{enabled:true,answered:true,correct:false}).kind,'annotated');
assert.equal(tipsFor(bird,bird.photos[1],{enabled:true,answered:true,correct:false}).kind,'general');
assert.equal(annotatedBirds(catalog.birds).length,1);
applySharedTips([]);
assert.equal(tipsFor(bird,photo,{enabled:true,answered:true,correct:false}),null);
for(const path of ['/','/review','/review-app.mjs','/data.json'])assert.equal((await worker.fetch(req(path),env)).status,200);
assert.equal((await worker.fetch(req('/unknown'),env)).status,404);
assert.equal((await api(req('/api/reviews'),{})).status,503);
console.log('Passed: real SQLite storage/migration, owner and agent access, viewer denial, cross-origin denial, draft isolation, approval, revision conflicts, concurrent breadth-first approvals, exhausted candidates, unpublish, idempotent pilot import, shared tips across families and withdrawal, Worker assets, storage failure.');
