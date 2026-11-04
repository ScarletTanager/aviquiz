import {verifiedIdentity,principalForUser} from './identity.mjs';
import {GLOBAL_PERMISSIONS,hasPermission,canAccessRoute} from './permissions.mjs';

// No HTTP endpoints or provider SDKs here. A future server controller supplies
// actor IDs ONLY from resolvePrincipal, never from a request body or localStorage.
export class AccessDenied extends Error{
  constructor(){super('Access denied.');this.status=403;}
}
export function accountService(db){
  const stamp=()=>new Date().toISOString();
  const statement=(sql,...args)=>db.prepare(sql).bind(...args);
  const audit=(actor,action,type,id,details={})=>statement(
    'INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)',
    crypto.randomUUID(),actor,action,type,id,JSON.stringify(details),stamp());
  const user=async id=>{const p=await principalForUser(db,id);if(!p.userId)throw new AccessDenied();return p;};
  const administrator=async id=>{const p=await user(id);if(!hasPermission(p,'system.admin'))throw new AccessDenied();return p;};
  async function authorizedRoute(actorId,routeId,action){
    const principal=actorId?await principalForUser(db,actorId):null;
    const route=await statement('SELECT * FROM routes WHERE id=?',routeId).first();
    const member=principal?.userId?await statement('SELECT * FROM route_members WHERE route_id=? AND user_id=?',routeId,principal.userId).first():null;
    // Return the same error for missing and unauthorized objects.
    if(!canAccessRoute(principal,action,route,member))throw new AccessDenied();
    return route;
  }
  return {
    // Trusted signup callback only: not an email-based account-linking function.
    async registerVerifiedUser(claims){
      const identity=verifiedIdentity(claims);
      if(!identity.emailVerified||typeof identity.email!=='string'||identity.email.length>320||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email))throw Error('A provider-verified email is required.');
      const id=crypto.randomUUID();
      await db.batch([
        statement('INSERT INTO app_users (id,email,created_at) VALUES (?,?,?)',id,identity.email,stamp()),
        statement('INSERT INTO app_identities (issuer,subject,user_id) VALUES (?,?,?)',identity.issuer,identity.subject,id),
        audit(id,'user.register','user',id)
      ]);
      return id;
    },
    async setGrant(actorId,targetId,permission,enabled){
      await administrator(actorId);await user(targetId);
      if(!GLOBAL_PERMISSIONS.includes(permission)||typeof enabled!=='boolean')throw Error('Invalid grant.');
      // Administrator bootstrap/recovery and last-admin protection need an explicit
      // operational design; do not expose admin grants through this first service.
      if(permission==='system.admin')throw Error('Administrator assignment requires a separate bootstrap/recovery workflow.');
      await db.batch([
        enabled?statement('INSERT INTO app_grants (user_id,permission) VALUES (?,?) ON CONFLICT DO NOTHING',targetId,permission):
          statement('DELETE FROM app_grants WHERE user_id=? AND permission=?',targetId,permission),
        audit(actorId,enabled?'grant.add':'grant.remove','grant',targetId,{permission})
      ]);
    },
    async createRoute(actorId,title){
      await user(actorId);
      if(typeof title!=='string'||!title.trim()||title.trim().length>200)throw Error('Route title must contain 1–200 characters.');
      const id=crypto.randomUUID();
      await db.batch([
        statement('INSERT INTO routes (id,owner_user_id,title,created_at) VALUES (?,?,?,?)',id,actorId,title.trim(),stamp()),
        audit(actorId,'route.create','route',id)
      ]);
      return id;
    },
    async readRoute(actorId,routeId){return authorizedRoute(actorId,routeId,'route.read');},
    async setRouteMember(actorId,routeId,targetId,role){
      const route=await authorizedRoute(actorId,routeId,'route.share');await user(targetId);
      if(targetId===route.owner_user_id)throw Error('Route ownership cannot be changed through membership.');
      if(role!==null&&!['viewer','contributor','editor'].includes(role))throw Error('Invalid route role.');
      await db.batch([
        role===null?statement('DELETE FROM route_members WHERE route_id=? AND user_id=?',routeId,targetId):
          statement('INSERT INTO route_members (route_id,user_id,role) VALUES (?,?,?) ON CONFLICT(route_id,user_id) DO UPDATE SET role=excluded.role',routeId,targetId,role),
        audit(actorId,role===null?'route.member.remove':'route.member.set','route-member',routeId,{userId:targetId,role})
      ]);
    },
    async setRouteVisibility(actorId,routeId,visibility){
      await authorizedRoute(actorId,routeId,'route.visibility');
      if(!['private','public'].includes(visibility))throw Error('Invalid visibility.');
      await db.batch([
        statement('UPDATE routes SET visibility=? WHERE id=?',visibility,routeId),
        audit(actorId,'route.visibility','route',routeId,{visibility})
      ]);
    },
    async deleteRoute(actorId,routeId){
      await authorizedRoute(actorId,routeId,'route.delete');
      await db.batch([
        statement('UPDATE routes SET deleted_at=? WHERE id=?',stamp(),routeId),
        audit(actorId,'route.delete','route',routeId)
      ]);
    }
  };
}
