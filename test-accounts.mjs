import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {GUEST,resolvePrincipal,principalForUser,verifiedIdentity} from './worker/identity.mjs';
import {hasPermission,canAccessRoute,canUseExperiment} from './worker/permissions.mjs';
import {accountService,AccessDenied} from './worker/accounts.mjs';

const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
sqlite.exec(fs.readFileSync('drizzle/0000_photo_reviews.sql','utf8'));
sqlite.exec("INSERT INTO photo_reviews VALUES ('existing','species','draft',1,'{}',NULL,'before')");
sqlite.exec(fs.readFileSync('schema/identity-routes.sql','utf8'));
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM photo_reviews').get().n,1);
class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.sql,args);}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
  async run(){return sqlite.prepare(this.sql).run(...this.args);}
}
const db={prepare:sql=>new Statement(sql),batch:async statements=>{
  sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
}};
const service=accountService(db),claims=(subject,extra={})=>({issuer:'https://identity.example/',subject,email:'birder@example.org',emailVerified:true,...extra});
const count=table=>sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const identityRequest=new Request('https://quiz.example/',{headers:{'x-user-id':'forged','x-role':'system.admin','oai-authenticated-user-id':'forged'}});
assert.equal(await resolvePrincipal(identityRequest,{db,verifyIdentity:async()=>null}),GUEST);
await assert.rejects(()=>resolvePrincipal(identityRequest,{db}),/verifier/);
await assert.rejects(()=>resolvePrincipal(identityRequest,{db,verifyIdentity:async()=>{throw Error('Invalid signature');}}),/Invalid signature/);
await assert.rejects(()=>service.registerVerifiedUser(claims('unverified',{emailVerified:false})),/verified email/);
assert.equal(count('app_users'),0);
assert.throws(()=>verifiedIdentity(claims('x',{issuer:'http://identity.example'})),/issuer/);
assert.throws(()=>verifiedIdentity(claims('x',{subject:''})),/identity/);

const owner=await service.registerVerifiedUser(claims('owner'));
const other=await service.registerVerifiedUser(claims('other')); // Same email is not account linking.
const secondProvider=await service.registerVerifiedUser(claims('owner',{issuer:'https://second.example/'}));
const admin=await service.registerVerifiedUser(claims('admin'));
assert.notEqual(owner,other);assert.notEqual(owner,secondProvider);
assert.equal(count('app_users'),4);
await assert.rejects(()=>service.registerVerifiedUser(claims('owner')));
assert.equal(count('app_users'),4);assert.equal(count('audit_events'),4); // Duplicate identity rolled back.
const principal=await resolvePrincipal(identityRequest,{db,verifyIdentity:async()=>claims('owner',{email:'changed@example.org'})});
assert.equal(principal.userId,owner);assert.deepEqual(principal.grants,[]);
assert.equal((await resolvePrincipal(identityRequest,{db,verifyIdentity:async()=>claims('unknown')})).kind,'unregistered');
assert.equal(hasPermission(GUEST,'quiz.practice'),true);
assert.equal(hasPermission(GUEST,'system.admin'),false);assert.equal(hasPermission(principal,'anything.unknown'),false);
assert.equal(hasPermission({kind:'user',userId:owner},'system.admin'),false);
assert.equal(canUseExperiment(principal,'id-tips',{enabled:true}),false);

// Test-only privileged provisioning. There is deliberately no production bootstrap API.
sqlite.prepare("INSERT INTO app_grants VALUES (?,'system.admin')").run(admin);
await assert.rejects(()=>service.setGrant(owner,owner,'annotations.publish',true),AccessDenied);
await assert.rejects(()=>service.setGrant(admin,owner,'system.admin',true),/bootstrap/);
await service.setGrant(admin,owner,'experiment.id-tips',true);
let refreshed=await principalForUser(db,owner);
assert.equal(canUseExperiment(refreshed,'id-tips',{enabled:true}),true);
assert.equal(canUseExperiment(refreshed,'id-tips',{enabled:false}),false);
assert.equal(canUseExperiment(refreshed,'unrecognized',{enabled:true}),false);
assert.equal(hasPermission(refreshed,'annotations.publish'),false);
await service.setGrant(admin,owner,'annotations.edit',true);
refreshed=await principalForUser(db,owner);
assert.equal(hasPermission(refreshed,'annotations.edit'),true);assert.equal(hasPermission(refreshed,'annotations.publish'),false);
await service.setGrant(admin,owner,'experiment.id-tips',false);
assert.equal(canUseExperiment(await principalForUser(db,owner),'id-tips',{enabled:true}),false);

const routeId=await service.createRoute(owner,'Friends’ Colombia trip');
const route=await service.readRoute(owner,routeId);
assert.equal(route.visibility,'private');assert.equal(route.owner_user_id,owner);
const route2=await service.createRoute(other,'Another trip');
const adminPrincipal=await principalForUser(db,admin),otherPrincipal=await principalForUser(db,other);
const actions=['route.read','route.practice','route.add-site','route.remove-site','route.update','route.share','route.visibility','route.delete'];
const expected={viewer:[true,true,false,false,false,false,false,false],contributor:[true,true,true,false,false,false,false,false],editor:[true,true,true,true,true,false,false,false]};
for(const [role,rights] of Object.entries(expected)){
 const member={route_id:routeId,user_id:other,role};
 assert.deepEqual(actions.map(action=>canAccessRoute(otherPrincipal,action,route,member)),rights);
 assert.equal(canAccessRoute(otherPrincipal,'route.read',route,{...member,route_id:route2}),false);
 assert.equal(canAccessRoute(otherPrincipal,'route.read',route,{...member,user_id:owner}),false);
}
assert.ok(actions.every(action=>canAccessRoute(principal,action,route)));
assert.ok(actions.every(action=>canAccessRoute(adminPrincipal,action,route)));
assert.equal(canAccessRoute(principal,'route.unrecognized',route),false);
assert.equal(canAccessRoute(GUEST,'route.read',route),false);
await assert.rejects(()=>service.readRoute(null,routeId),AccessDenied);
await assert.rejects(()=>service.readRoute(other,routeId),AccessDenied);
await assert.rejects(()=>service.readRoute(other,'does-not-exist'),AccessDenied);
await assert.rejects(()=>service.createRoute(null,'Guest route'),AccessDenied);
await assert.rejects(()=>service.setRouteVisibility(other,routeId,'public'),AccessDenied);
await assert.rejects(()=>service.deleteRoute(other,routeId),AccessDenied);
await service.setRouteMember(owner,routeId,other,'editor');
assert.equal((await service.readRoute(other,routeId)).id,routeId);
await assert.rejects(()=>service.setRouteMember(other,routeId,secondProvider,'viewer'),AccessDenied);
await assert.rejects(()=>service.deleteRoute(other,routeId),AccessDenied);
await assert.rejects(()=>service.setRouteMember(owner,routeId,owner,'editor'),/ownership/);
await assert.rejects(()=>service.setRouteMember(owner,routeId,other,'owner'),/Invalid route role/);
await service.setRouteMember(owner,routeId,other,null);
await assert.rejects(()=>service.readRoute(other,routeId),AccessDenied);
await service.setRouteVisibility(owner,routeId,'public');
assert.equal((await service.readRoute(null,routeId)).visibility,'public');
assert.equal(canAccessRoute(GUEST,'route.practice',await service.readRoute(null,routeId)),true);
assert.equal(canAccessRoute(GUEST,'route.add-site',await service.readRoute(null,routeId)),false);
await service.setRouteVisibility(owner,routeId,'private');
await assert.rejects(()=>service.readRoute(null,routeId),AccessDenied);

// An audit storage failure must abort the operation, not silently lose accounting.
sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events WHEN NEW.action='route.visibility' BEGIN SELECT RAISE(ABORT,'Audit unavailable'); END");
await assert.rejects(()=>service.setRouteVisibility(owner,routeId,'public'),/Audit unavailable/);
assert.equal((await service.readRoute(owner,routeId)).visibility,'private');
sqlite.exec('DROP TRIGGER fail_audit');
assert.throws(()=>sqlite.exec("UPDATE audit_events SET action='tampered'"),/cannot be updated/);
assert.throws(()=>sqlite.exec('DELETE FROM audit_events'),/cannot be deleted/);
const auditRows=sqlite.prepare('SELECT * FROM audit_events').all();
assert.ok(auditRows.every(e=>e.actor_user_id&&e.action&&e.created_at));
assert.ok(auditRows.every(e=>!e.details_json.includes('@')&&!e.details_json.includes('token')));
sqlite.prepare("UPDATE app_users SET status='disabled' WHERE id=?").run(owner);
assert.equal((await resolvePrincipal(identityRequest,{db,verifyIdentity:async()=>claims('owner')})).userId,null);
await assert.rejects(()=>service.createRoute(owner,'Disabled'),AccessDenied);
await assert.rejects(()=>service.setRouteVisibility(owner,routeId,'public'),AccessDenied);
await service.deleteRoute(admin,routeId);
assert.ok(sqlite.prepare('SELECT deleted_at FROM routes WHERE id=?').get(routeId).deleted_at);
assert.equal(sqlite.prepare('SELECT owner_user_id FROM routes WHERE id=?').get(routeId).owner_user_id,owner);
await assert.rejects(()=>service.readRoute(admin,routeId),AccessDenied);
assert.equal((await service.readRoute(other,route2)).id,route2);
assert.throws(()=>sqlite.prepare("INSERT INTO route_members VALUES (?,?,'administrator')").run(route2,secondProvider));
assert.throws(()=>sqlite.prepare("INSERT INTO app_grants VALUES (?,'bad.permission')").run(other));
assert.throws(()=>sqlite.prepare("INSERT INTO routes (id,owner_user_id,title,created_at) VALUES ('bad','missing','Trip','now')").run());
console.log('Passed account foundation: isolated schema preserves reviews; verified identity mapping without email merges; guest access; disabled/revoked privileges; complete route-role matrix; private defaults; object isolation; sharing revocation; owner/admin deletion; immutable, atomic audit events. No provider or public endpoints activated.');
