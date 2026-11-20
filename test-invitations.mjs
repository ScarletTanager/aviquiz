import assert from 'node:assert/strict';
import {invitationApi} from './worker/invitations.mjs';
import {cognitoInvitationProvider} from './server/invitation-provider.mjs';
import {accountApi} from './worker/account-api.mjs';
import {createSqliteDatabase} from './server/database/sqlite.mjs';
import {migrateDatabase} from './server/database/migrate.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
export async function runInvitationTests(db){
  const issuer='https://cognito-idp.us-east-2.amazonaws.com/us-east-2_Test';
  const q=(sql,...args)=>db.prepare(sql).bind(...args);
  const actor=crypto.randomUUID(),ordinary=crypto.randomUUID(),admin=crypto.randomUUID();
  for(const [id,subject] of [[actor,'inviter'],[ordinary,'ordinary'],[admin,'invite-admin']])await db.batch([
    q('INSERT INTO app_users (id,email,created_at) VALUES (?,?,?)',id,subject+'@example.org',new Date().toISOString()),
    q('INSERT INTO app_identities VALUES (?,?,?)',issuer,subject,id)
  ]);
  await q("INSERT INTO app_grants VALUES (?,'users.invite')",actor).run();
  await q("INSERT INTO app_grants VALUES (?,'system.admin')",admin).run();
  let prepares=0,deliveries=0,failDelivery=false,lastDeliveryEmail;
  const provider={async prepare(email){prepares++;return {issuer,subject:'invited-'+email,username:email};},async deliver(email){lastDeliveryEmail=email;deliveries++;if(failDelivery)throw Error('private provider failure');}};
  const env={DB_DRIVER:db.dialect,DB:db,DEPLOYMENT_TARGET:'standalone',AUTH_ISSUER:issuer,INVITATION_PROVIDER:provider};
  const call=async(body,subject='inviter',extras={})=>{
    const method=body?'POST':'GET';
    const response=await invitationApi(new Request('https://quiz.example/api/invitations',{method,headers:{...(body?{'content-type':'application/json',origin:'https://quiz.example'}:{}),...extras},...(body?{body:JSON.stringify(body)}:{})}),env,{verifyIdentity:async()=>subject?{issuer,subject}:null});
    return {status:response.status,body:await response.json()};
  };
  const invite=email=>({email,requestId:crypto.randomUUID()});
  assert.equal((await call(null,null)).status,403);
  assert.equal((await call(null,'ordinary')).status,403);
  assert.equal((await call(null,'invite-admin')).body.available,true);
  assert.equal((await call(invite('x@example.org'),'ordinary')).status,403);
  assert.equal((await call(invite('x@example.org'),'inviter',{origin:'https://evil.example'})).status,403);
  for(const email of ['one@example.org,two@example.org','invalid','a b@example.org',42,{},null])assert.equal((await call(invite(email))).status,400);
  assert.equal((await call({...invite('x@example.org'),permission:'system.admin'})).status,400);
  assert.equal(prepares,0);
  const first=invite('  New@Example.org  ');
  assert.equal((await call(first)).status,201);
  assert.equal((await call(first)).status,200);assert.equal(prepares,1);assert.equal(deliveries,1);assert.equal(lastDeliveryEmail,'new@example.org');
  assert.equal((await call(invite('new@example.org'))).status,409);
  const mapping=await q('SELECT user_id FROM app_identities WHERE issuer=? AND subject=?',issuer,'invited-new@example.org').first();
  assert.ok(mapping?.user_id);
  assert.equal((await q('SELECT * FROM app_grants WHERE user_id=?',mapping.user_id).all()).results.length,0);
  const enrolled=await accountApi(new Request('https://quiz.example/api/account/enroll',{method:'POST',headers:{origin:'https://quiz.example','content-type':'application/json'},body:'{}'}),env,{verifyIdentity:async()=>({issuer,subject:'invited-new@example.org',email:'new@example.org',emailVerified:true})});
  assert.equal((await enrolled.json()).userId,mapping.user_id);
  // Race same email with distinct keys: exactly one provisioning and delivery.
  const before=prepares;
  const race=await Promise.all([call(invite('race@example.org')),call(invite('race@example.org'))]);
  assert.equal(race.filter(r=>r.status===201).length,1);assert.equal(prepares,before+1);
  failDelivery=true;const failed=invite('failed@example.org');
  const result=await call(failed);assert.equal(result.status,503);assert.ok(!JSON.stringify(result).includes('private provider failure'));
  assert.equal((await q('SELECT state FROM app_invitations WHERE id=?',failed.requestId).first()).state,'needs_attention');
  const attention=await q("SELECT details_json FROM audit_events WHERE action='user.invite.attention' AND resource_id=?",actor).first();assert.equal(JSON.parse(attention.details_json).stage,'send-email');
  assert.match(result.body.error,/account was created/);assert.equal(result.body.requiresReview,true);
  const delivered=deliveries;assert.equal((await call(failed)).status,409);assert.equal(deliveries,delivered);failDelivery=false;
  const existing=await call(invite('ordinary@example.org'));assert.equal(existing.status,409);
  // Fill the remaining personal quota; failed/ambiguous attempts consume quota.
  let n=Number((await q('SELECT COUNT(*) n FROM app_invitations WHERE actor_user_id=?',actor).first()).n);
  while(n++<5)assert.equal((await call(invite('limit'+n+'@example.org'))).status,201);
  assert.equal((await call(invite('over@example.org'))).status,429);
  await q("UPDATE app_users SET status='disabled' WHERE id=?",actor).run();
  assert.equal((await call(null)).status,403);
  assert.equal((await call(invite('disabled@example.org'))).status,403);
  assert.equal(Number((await q("SELECT COUNT(*) n FROM audit_events WHERE actor_user_id=? AND action='user.invite.send'",actor).first()).n),4);
  // Provider creation timeout is also ambiguous and must not be retried.
  provider.prepare=async()=>{prepares++;throw Error('private provider error');};
  const failedCreate=invite('creation-failed@example.org');
  assert.equal((await call(failedCreate,'invite-admin')).status,503);
  const attempts=prepares;assert.equal((await call(failedCreate,'invite-admin')).status,409);assert.equal(prepares,attempts);
  env.INVITATION_PROVIDER=null;assert.equal((await call(null,'invite-admin')).body.available,false);
  assert.equal((await call(invite('disabled-provider@example.org'),'invite-admin')).status,503);env.INVITATION_PROVIDER=provider;
  // Other actors also share a global rolling-day limit.
  let total=Number((await q('SELECT COUNT(*) n FROM app_invitations').first()).n);
  while(total++<20)await q("INSERT INTO app_invitations (id,actor_user_id,email,state,created_at,updated_at) VALUES (?,?,?,'preparing',?,?)",crypto.randomUUID(),ordinary,`quota-${total}@example.org`,new Date().toISOString(),new Date().toISOString()).run();
  assert.equal((await call(invite('global-limit@example.org'),'invite-admin')).status,429);
  console.log(`Passed ${db.dialect}: invitation permission, input/origin checks, identity precreation, ordinary access, enrollment reuse, duplicates/concurrency, delivery failure/no retry, quotas, disabled inviter and audit.`);
}
if(import.meta.main){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-invites-'));
  const config={DB_DRIVER:'sqlite',SQLITE_PATH:path.join(folder,'test.sqlite')};
  let db;
  try{await migrateDatabase(config);db=createSqliteDatabase(config.SQLITE_PATH);await runInvitationTests(db);}
  finally{await db?.close();await fs.rm(folder,{recursive:true,force:true});}
  const commands=[];
  const issuer='https://cognito-idp.us-east-2.amazonaws.com/us-east-2_Test';
  const provider=cognitoInvitationProvider({AUTH_ISSUER:issuer},{client:{async send(command){commands.push(command.input);return {User:{Username:'stable-username',Attributes:[{Name:'sub',Value:'stable-subject'}]}};}}});
  const identity=await provider.prepare('new@example.org');await provider.deliver('new@example.org');
  assert.equal(identity.subject,'stable-subject');assert.equal(commands[0].MessageAction,'SUPPRESS');
  assert.equal(commands[1].MessageAction,'RESEND');assert.equal(commands[1].Username,'new@example.org');
  assert.ok(commands.every(c=>c.ForceAliasCreation===false&&c.DesiredDeliveryMediums[0]==='EMAIL'&&!('TemporaryPassword' in c)));
  console.log('Passed mocked provider commands. No AWS requests or emails sent.');
  const source=(await fs.readFile('dist/invite.mjs','utf8')).replace("import {accountFetch} from './auth-session.mjs';",'');
  async function ui(status=200,available=true){
    const elements=Object.fromEntries(['invite-form','invite-email','invite-send','invite-access','invite-result','invite-introduction','invite-reference'].map(id=>[id,{hidden:id==='invite-form',textContent:'',value:'friend@example.org',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},reportValidity(){return true;},reset(){elements['invite-email'].value='';}}]));
    const calls=[];let release;
    const context=vm.createContext({document:{getElementById:id=>elements[id]},crypto,accountFetch:async(url,options)=>{calls.push({url,options});return options?new Promise(resolve=>{release=resolve;}):{ok:status===200,status,json:async()=>({available})};}});
    vm.runInContext(source,context);await new Promise(r=>setImmediate(r));
    return {elements,calls,finish:response=>release(response)};
  }
  assert.equal((await ui(403)).elements['invite-form'].hidden,true);
  assert.equal((await ui(200,false)).elements['invite-form'].hidden,true);
  const page=await ui(),form=page.elements['invite-form'];assert.equal(form.hidden,false);
  const submitting=form.listeners.submit({preventDefault(){}});
  await form.listeners.submit({preventDefault(){}});assert.equal(page.calls.length,2);
  assert.equal(page.elements['invite-send'].disabled,true);assert.equal(page.elements['invite-email'].disabled,true);
  const body=JSON.parse(page.calls[1].options.body);assert.equal(body.email,'friend@example.org');assert.ok(body.requestId);
  page.finish({ok:true,json:async()=>({sent:true})});await submitting;
  assert.equal(page.elements['invite-send'].disabled,false);assert.match(page.elements['invite-result'].textContent,/Invitation sent/);
  const failedPage=await ui();const sending=failedPage.elements['invite-form'].listeners.submit({preventDefault(){}});
  failedPage.finish({ok:false,status:503,json:async()=>({error:'Could not confirm.',requiresReview:true})});await sending;
  assert.equal(failedPage.elements['invite-form'].hidden,true);assert.match(failedPage.elements['invite-reference'].textContent,/Support reference/);
  console.log('Passed invitation screen permission/configuration states, single-flight submission, success, and uncertain-result handling.');
}
