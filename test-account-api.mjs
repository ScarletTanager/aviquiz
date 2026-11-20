import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {identityVerifier} from './worker/cognito.mjs';
import {accountApi} from './worker/account-api.mjs';
import {hasPermission} from './worker/permissions.mjs';
import {principalForUser} from './worker/identity.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
sql.exec(fs.readFileSync('drizzle/0000_photo_reviews.sql','utf8'));
sql.exec("INSERT INTO photo_reviews VALUES ('existing','species','draft',1,'{}',NULL,'before')");
// Exercise exact deployment migration chunks, including audit triggers.
for(const chunk of fs.readFileSync('drizzle/0001_accounts.sql','utf8').split('--> statement-breakpoint'))if(chunk.trim())sql.exec(chunk);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM photo_reviews').get().n,1);
class Statement {
 constructor(query,args=[]){this.query=query;this.args=args;}
 bind(...args){return new Statement(this.query,args);}
 async first(){return sql.prepare(this.query).get(...this.args)||null;}
 async all(){return {results:sql.prepare(this.query).all(...this.args)};}
 async run(){return sql.prepare(this.query).run(...this.args);}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{
 sql.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}
}};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);jwk.kid='local-test';
const issuer='https://identity.example/pool',clientId='test-client';
const verifyIdentity=identityVerifier({issuer,clientId,keySet:createLocalJWKSet({keys:[jwk]})});
const token=async(subject,extra={},options={})=>new SignJWT({token_use:'id',email:'owner@example.org',email_verified:true,...extra}).setProtectedHeader({alg:'RS256',kid:'local-test'}).setIssuer(options.issuer||issuer).setAudience(options.audience||clientId).setSubject(subject).setIssuedAt().setExpirationTime(options.exp||'5m').sign(privateKey);
const env={DB,REVIEW_OWNER_EMAIL:'owner@example.org'};
const ownerHeaders={'oai-authenticated-user-id':'0a42fa64-ecdd-4efa-98c5-e2c95f94320f'}; // gitleaks:allow -- Public client/hosting identifier; not a credential.
const call=async(path,bearer,headers={},method=path==='/api/account'?'GET':'POST')=>{
 const response=await accountApi(new Request('https://quiz.example'+path,{method,headers:{...(bearer?{authorization:`Bearer ${bearer}`} : {}),...(method==='POST'?{'content-type':'application/json',origin:'https://quiz.example'}:{}),...headers},...(method==='POST'?{body:'{}'}:{})}),env,{verifyIdentity});
 return {status:response.status,body:await response.json()};
};
assert.equal((await call('/api/account')).body.kind,'guest');
assert.equal((await call('/api/account/enroll')).status,401);
assert.equal((await call('/api/account/enroll','fake')).status,401);
for(const bearer of [await token('wrong',{}, {issuer:'https://wrong.example'}),await token('wrong',{}, {audience:'wrong-client'}),await token('wrong',{token_use:'access'}),await token('wrong',{}, {exp:1})])assert.equal((await call('/api/account/enroll',bearer)).status,401);
assert.equal((await call('/api/account/enroll',await token('unverified',{email_verified:false}))).status,403);
const stranger=await token('stranger',{email:'stranger@example.org'});
let result=await call('/api/account/enroll',stranger);assert.equal(result.status,200);assert.equal(result.body.administrator,false);assert.equal(result.body.canBootstrap,false);
assert.equal((await call('/api/account/bootstrap',stranger,ownerHeaders)).status,403);
const ownerToken=await token('owner');
assert.equal((await call('/api/account/bootstrap',ownerToken,ownerHeaders)).body.kind,'unregistered');
result=await call('/api/account/enroll',ownerToken,ownerHeaders);const ownerId=result.body.userId;
assert.equal(result.body.canBootstrap,true);assert.equal(result.body.administrator,false);
assert.equal((await call('/api/account/bootstrap',ownerToken)).status,403);
assert.equal((await call('/api/account/bootstrap',ownerToken,{...ownerHeaders,origin:'https://other.example'})).status,403);
assert.equal((await call('/api/account/bootstrap',ownerToken,ownerHeaders,'GET')).status,405);
result=await call('/api/account/bootstrap',ownerToken,ownerHeaders);assert.equal(result.status,200);assert.equal(result.body.administrator,true);
assert.equal((await call('/api/account/bootstrap',ownerToken,ownerHeaders)).status,403);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='admin.bootstrap'").get().n,1);
assert.equal((await call('/api/account/enroll',ownerToken,ownerHeaders)).body.userId,ownerId);
assert.equal((await call('/api/account/enroll',await token('owner',{email:'changed@example.org'}))).body.userId,ownerId);
const spoof=await token('another-sub');result=await call('/api/account/enroll',spoof,ownerHeaders);assert.notEqual(result.body.userId,ownerId);assert.equal(result.body.administrator,false);
// Only admins and an explicitly granted inviter can invite. The invitation endpoint is covered in test-invitations.mjs.
const otherId=result.body.userId;
assert.equal(hasPermission(await principalForUser(DB,otherId),'users.invite'),false);
sql.prepare("INSERT INTO app_grants VALUES (?,'users.invite')").run(otherId);
assert.equal(hasPermission(await principalForUser(DB,otherId),'users.invite'),true);
assert.equal(hasPermission(await principalForUser(DB,otherId),'system.admin'),false);
assert.equal(hasPermission(await principalForUser(DB,ownerId),'users.invite'),true);
sql.prepare("UPDATE app_users SET status='disabled' WHERE id=?").run(otherId);
assert.equal((await call('/api/account/enroll',spoof)).status,403);
assert.equal((await call('/api/account/bootstrap',spoof,ownerHeaders)).status,403);
await assert.rejects(DB.prepare("UPDATE audit_events SET action='tamper'").run(),/cannot be updated/);
console.log('Passed local signed JWT verification, wrong issuer/audience/use/expiry denial, registration isolation/idempotence, owner-only one-time audited bootstrap, email-change identity stability, inviter separation, disabled account denial, migration preservation and audit immutability. No AWS calls.');
