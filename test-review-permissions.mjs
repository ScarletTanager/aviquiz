import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {createSqliteDatabase} from './server/database/sqlite.mjs';
import {DatabaseSync} from 'node:sqlite';
import {accountService} from './worker/accounts.mjs';
import {identityVerifier} from './worker/cognito.mjs';
import {api} from './dist/server/index.js';
const raw=new DatabaseSync(':memory:');
raw.exec(await fs.readFile('drizzle/0000_photo_reviews.sql','utf8'));raw.exec(await fs.readFile('drizzle/0001_accounts.sql','utf8'));
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return raw.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:raw.prepare(this.sql).all(...this.args)};}
 async run(){return raw.prepare(this.sql).run(...this.args);}
}
const db={dialect:'sqlite',prepare:s=>new Statement(s),async batch(items){raw.exec('BEGIN');try{for(const s of items)await s.run();raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}}};
const {privateKey,publicKey}=await generateKeyPair('RS256');const key=await exportJWK(publicKey);key.kid='test';
const issuer='https://identity.example/pool',audience='local-client';
const verifyIdentity=identityVerifier({issuer,clientId:audience,keySet:createLocalJWKSet({keys:[key]})});
const uid=await accountService(db).registerVerifiedUser({issuer,subject:'owner',email:'owner@example.org',emailVerified:true});
const token=await new SignJWT({token_use:'id',email:'owner@example.org',email_verified:true}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(audience).setSubject('owner').setIssuedAt().setExpirationTime('5m').sign(privateKey);
const env={DB:db,DB_DRIVER:'sqlite',DEPLOYMENT_TARGET:'standalone'};
const catalog=JSON.parse(await fs.readFile('dist/data.json','utf8')),bird=catalog.birds[0],photo=bird.photos[0];
const document={speciesId:bird.id,photoId:photo.id,source:`https://ebird.org/species/${bird.id}`,width:1200,height:800,tips:['Paraphrased local test.'],features:[{title:'Feature',lines:['Check this feature.'],point:[.5,.4]}],sourceChecked:true,photoChecked:true};
async function call(path,body,headers={authorization:'Bearer '+token}){
 const response=await api(new Request('https://quiz.example'+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'content-type':'application/json',origin:'https://quiz.example'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{verifyIdentity});
 return {status:response.status,body:await response.json()};
}
const grant=p=>raw.prepare('INSERT INTO app_grants VALUES (?,?)').run(uid,p);
assert.equal((await call('/api/reviews',null,{})).status,403);
assert.equal((await call('/api/reviews',null,{authorization:'Bearer invalid'})).status,401);
assert.equal((await call('/api/reviews')).status,403);
grant('annotations.read');let result=await call('/api/reviews');assert.equal(result.status,200);assert.equal(result.body.canEdit,false);
assert.equal((await call('/api/reviews/save',{action:'draft',revision:0,document})).status,403);
grant('annotations.edit');assert.equal((await call('/api/reviews/save',{action:'draft',revision:0,document})).status,200);
assert.equal((await call('/api/reviews/save',{action:'approve',revision:1,document})).status,403);
grant('annotations.publish');assert.equal((await call('/api/reviews/save',{action:'approve',revision:1,document})).status,200);
assert.equal((await call('/api/reviews/seed',{})).status,403);
raw.prepare('DELETE FROM app_grants WHERE user_id=?').run(uid);grant('system.admin');assert.equal((await call('/api/reviews')).body.canPublish,true);
raw.prepare("UPDATE app_users SET status='disabled' WHERE id=?").run(uid);assert.equal((await call('/api/reviews')).status,403);
raw.close();console.log('Passed signed-identity review authorization: guest/invalid/unprivileged denial, independent read/edit/publish, admin inheritance, seed restriction, and disabled-account denial. No AWS calls.');
