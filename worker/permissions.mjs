export const GLOBAL_PERMISSIONS=Object.freeze([
  'system.admin','experiment.id-tips','annotations.read','annotations.edit','annotations.publish'
]);
const routeRights={
  viewer:['route.read','route.practice'],
  contributor:['route.read','route.practice','route.add-site'],
  editor:['route.read','route.practice','route.add-site','route.remove-site','route.update']
};
const ownerRights=[...routeRights.editor,'route.share','route.visibility','route.delete'];
const isUser=p=>p?.kind==='user'&&typeof p.userId==='string'&&p.userId.length>0&&Array.isArray(p.grants);
export function hasPermission(principal,permission){
  if(permission==='quiz.practice')return true;
  if(!GLOBAL_PERMISSIONS.includes(permission)||!isUser(principal))return false;
  return principal.grants.includes('system.admin')||principal.grants.includes(permission);
}
export function canUseExperiment(principal,feature,{enabled=false}={}){
  return enabled===true&&feature==='id-tips'&&hasPermission(principal,'experiment.id-tips');
}
export function canAccessRoute(principal,action,route,membership=null){
  if(!route||route.deleted_at||!ownerRights.includes(action))return false;
  if(['route.read','route.practice'].includes(action)&&route.visibility==='public')return true;
  if(!isUser(principal))return false;
  if(hasPermission(principal,'system.admin')||route.owner_user_id===principal.userId)return true;
  // Membership must be loaded server-side for this exact route and user.
  if(membership?.route_id!==route.id||membership?.user_id!==principal.userId)return false;
  return (routeRights[membership.role]||[]).includes(action);
}
