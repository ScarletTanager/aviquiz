import {runLocationCacheTests} from './test-geography.mjs';
import {runInvitationTests} from './test-invitations.mjs';
import {importSnapshot,readTables,tableDigest,TABLES} from './server/database/snapshot.mjs';
import {resolveDatabaseConfig} from './server/database/config.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {createDatabase,createDatabaseEnvironment} from './server/database/index.mjs';
import {migrateDatabase} from './server/database/migrate.mjs';
import {postgresPoolOptions} from './server/database/postgres.mjs';
import {postgresQuery} from './server/database/placeholders.mjs';
import {databaseForEnvironment} from './worker/database.mjs';
import {accountService,AccessDenied} from './worker/accounts.mjs';
import {resolvePrincipal,principalForUser} from './worker/identity.mjs';
import {hasPermission} from './worker/permissions.mjs';
import {accountApi,trustedSiteOwner} from './worker/account-api.mjs';
import worker,{api} from './dist/server/index.js';
const catalog=JSON.parse(await fs.readFile('dist/data.json','utf8'));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-db-'));
const pgURL=process.env.TEST_DATABASE_URL;
if(!pgURL)throw Error('TEST_DATABASE_URL is required; use scripts/test-local-postgres.mjs.');
const checked=new URL(pgURL);
if(!['127.0.0.1','localhost','[::1]'].includes(checked.hostname)||checked.pathname!=='/aviquiz_test')throw Error('Tests require a local disposable /aviquiz_test database.');
const caFixture=path.join(root,'public-ca.crt');
await fs.writeFile(caFixture,'-----BEGIN CERTIFICATE-----\nPUBLIC TEST FIXTURE\n-----END CERTIFICATE-----\n');
assert.match((await resolveDatabaseConfig({DB_DRIVER:'postgres',DATABASE_CA_FILE:caFixture})).DATABASE_CA,/PUBLIC TEST FIXTURE/);
await assert.rejects(()=>resolveDatabaseConfig({DB_DRIVER:'postgres',DATABASE_CA_FILE:caFixture,DATABASE_CA:'ambiguous'}),/not both/);
await assert.rejects(()=>resolveDatabaseConfig({DB_DRIVER:'postgres',DATABASE_CA_FILE:path.join(root,'missing.crt')}));
const configs=[{DB_DRIVER:'sqlite',SQLITE_PATH:path.join(root,'app.sqlite')},
  {DB_DRIVER:'postgres',DATABASE_URL:pgURL,DATABASE_SSL:'disable',DATABASE_POOL_MAX:'5'}];
assert.deepEqual(postgresQuery("SELECT '?',\"?\",? -- ?\n, $$?$$, $body$?$body$, /* ? /* nested ? */ */ ?",[1,2]),
  {text:"SELECT '?',\"?\",$1 -- ?\n, $$?$$, $body$?$body$, /* ? /* nested ? */ */ $2",values:[1,2]});
assert.throws(()=>postgresQuery('SELECT ?',[]));
assert.throws(()=>postgresPoolOptions({DATABASE_URL:'postgresql://user@remote.example/db',DATABASE_SSL:'disable'}));
assert.throws(()=>postgresPoolOptions({DATABASE_URL:'postgresql://user@remote.example/db?sslmode=no-verify'}));
assert.equal(postgresPoolOptions({DATABASE_URL:'postgresql://user@remote.example/db'}).ssl.rejectUnauthorized,true);
await assert.rejects(()=>createDatabase({}),/DB_DRIVER/);
await assert.rejects(()=>createDatabase({DB_DRIVER:'other'}),/DB_DRIVER/);
assert.throws(()=>databaseForEnvironment({DB_DRIVER:'postgres',DB:{prepare(){},batch(){}}}),/adapter/);
const ownerHeaders={'oai-authenticated-user-id':'0a42fa64-ecdd-4efa-98c5-e2c95f94320f'}; // gitleaks:allow -- Public client/hosting identifier; not a credential.
let adminClient;
try {
  adminClient=new pg.Client({connectionString:pgURL});await adminClient.connect();
  for(const config of configs) {
    assert.equal((await migrateDatabase(config)).applied.length,config.DB_DRIVER==='sqlite'?4:3);
    assert.equal((await migrateDatabase(config)).applied.length,0);
    const env=await createDatabaseEnvironment({...config,REVIEW_OWNER_EMAIL:'owner@example.org',REVIEW_AGENT_KEY:'local-review-test-only'});
    const db=databaseForEnvironment(env),service=accountService(db);
    const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
    const count=async table=>Number((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n);
    const claims=subject=>({issuer:'https://test.example/pool',subject,email:'owner@example.org',emailVerified:true});
    assert.equal(trustedSiteOwner(new Request('https://quiz.example',{headers:ownerHeaders}),env),false);
    const admin=await service.registerVerifiedUser(claims('admin'));
    const viewer=await service.registerVerifiedUser(claims('viewer'));
    assert.notEqual(admin,viewer);
    let before=await count('app_users');
    await assert.rejects(()=>service.registerVerifiedUser(claims('admin')));
    assert.equal(await count('app_users'),before);assert.equal(await count('audit_events'),before);
    const duplicateRace=await Promise.allSettled([service.registerVerifiedUser(claims('racing')),service.registerVerifiedUser(claims('racing'))]);
    assert.equal(duplicateRace.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await count('app_users'),before+1);assert.equal(await count('audit_events'),before+1);before++;
    const applied=await db.prepare('SELECT id,checksum FROM aviquiz_schema_migrations ORDER BY id LIMIT 1').first();
    await run('UPDATE aviquiz_schema_migrations SET checksum=? WHERE id=?','tampered',applied.id);
    await assert.rejects(()=>migrateDatabase(config),/modified/);
    await run('UPDATE aviquiz_schema_migrations SET checksum=? WHERE id=?',applied.checksum,applied.id);
    assert.equal((await resolvePrincipal(new Request('https://quiz.example'),{db,verifyIdentity:async()=>({...claims('admin'),email:'changed@example.org'})})).userId,admin);
    await run("INSERT INTO app_grants VALUES (?,'system.admin')",admin);
    await service.setGrant(admin,viewer,'users.invite',true);
    assert.equal(hasPermission(await principalForUser(db,viewer),'users.invite'),true);
    assert.equal(hasPermission(await principalForUser(db,viewer),'system.admin'),false);
    await service.setGrant(admin,viewer,'users.invite',false);
    assert.equal(hasPermission(await principalForUser(db,viewer),'users.invite'),false);
    // Inject an invalid audit row as the second statement: the first mutation must roll back.
    await assert.rejects(()=>db.batch([
      db.prepare("INSERT INTO app_grants VALUES (?,'annotations.read')").bind(viewer),
      db.prepare("INSERT INTO audit_events VALUES (?,'missing-user','bad','grant',?,'{}','now')").bind(crypto.randomUUID(),viewer)
    ]));
    assert.equal(hasPermission(await principalForUser(db,viewer),'annotations.read'),false);
    await assert.rejects(()=>run("UPDATE audit_events SET action='tamper'"));
    await assert.rejects(()=>run('DELETE FROM audit_events'));
    if(config.DB_DRIVER==='postgres')await assert.rejects(()=>run('TRUNCATE audit_events'));
    // The still-staged route services use an isolated test schema, not production migrations.
    if(config.DB_DRIVER==='postgres')await adminClient.query(await fs.readFile('schema/postgres-routes.sql','utf8'));
    else {
      const {DatabaseSync}=await import('node:sqlite');const raw=new DatabaseSync(config.SQLITE_PATH);
      raw.exec(await fs.readFile('schema/postgres-routes.sql','utf8'));raw.close();
    }
    const trip=await service.createRoute(admin,'Local test trip');
    assert.equal((await service.readRoute(admin,trip)).visibility,'private');
    await assert.rejects(()=>service.readRoute(viewer,trip),AccessDenied);
    await service.setRouteMember(admin,trip,viewer,'viewer');
    assert.equal((await service.readRoute(viewer,trip)).id,trip);
    await assert.rejects(()=>service.setRouteVisibility(viewer,trip,'public'),AccessDenied);
    await service.setRouteMember(admin,trip,viewer,null);
    await assert.rejects(()=>service.readRoute(viewer,trip),AccessDenied);
    // This value must remain data, not executable SQL.
    const quoted="Bird's ? trip'); DROP TABLE app_users; --";
    const quotedTrip=await service.createRoute(admin,quoted);
    assert.equal((await service.readRoute(admin,quotedTrip)).title,quoted);
    assert.equal(await count('app_users'),before);
    const request=(url,body,headers={})=>new Request('https://quiz.example'+url,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json',origin:'https://quiz.example'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const call=async(url,body,headers={})=>{const response=await api(request(url,body,headers),env);return {status:response.status,body:await response.json()};};
    assert.equal((await worker.fetch(request('/quiz'),env)).status,200);
    assert.equal((await call('/api/annotations')).status,200);
    assert.equal((await call('/api/reviews',null,ownerHeaders)).status,403); // forged Sites headers can't authorize standalone requests
    const bird=catalog.birds[0];
    const document=(photo)=>({speciesId:bird.id,photoId:photo.id,source:`https://ebird.org/species/${bird.id}`,width:1200,height:800,tips:['Test paraphrased guidance.'],features:[{title:'Visible feature',lines:['Test this visible feature.'],point:[.5,.4]}],notes:'Local test only',sourceChecked:true,photoChecked:true});
    const key={'x-review-agent-key':'local-review-test-only'};
    let result=await call('/api/reviews/save',{action:'draft',revision:0,document:document(bird.photos[0])},key);assert.equal(result.status,200);
    assert.equal((await call('/api/annotations')).body.annotations.length,0);
    assert.equal((await call('/api/reviews/save',{action:'draft',revision:0,document:document(bird.photos[0])},key)).status,409);
    assert.equal((await call('/api/reviews/save',{action:'approve',revision:1,document:document(bird.photos[0])},{...key,origin:'https://elsewhere.example'})).status,403);
    result=await call('/api/reviews/save',{action:'approve',revision:1,document:document(bird.photos[0])},key);assert.equal(result.status,200);
    assert.equal((await call('/api/annotations')).body.annotations[0].notes,undefined);
    assert.equal((await call('/api/reviews/save',{action:'unpublish',revision:2,document:document(bird.photos[0])},key)).status,200);
    assert.equal((await call('/api/annotations')).body.annotations.length,0);
    // Start clean and race two photos of the same species. Exactly one may publish.
    await run('DELETE FROM photo_reviews');
    const racing=await Promise.all(bird.photos.slice(0,2).map(photo=>call('/api/reviews/save',{action:'approve',revision:0,document:document(photo)},key)));
    assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call('/api/annotations')).body.annotations.length,1);
    // Standalone sign-in can link an account, but cannot bootstrap admin from Sites headers.
    const response=await accountApi(request('/api/account/enroll',{},ownerHeaders),env,{verifyIdentity:async()=>claims('new-user')});
    const enrolled=await response.json();assert.equal(response.status,200);assert.equal(enrolled.canBootstrap,false);
    const bootstrap=await accountApi(request('/api/account/bootstrap',{},ownerHeaders),env,{verifyIdentity:async()=>claims('new-user')});assert.equal(bootstrap.status,403);
    await run("UPDATE app_users SET status='disabled' WHERE id=?",viewer);
    await assert.rejects(()=>service.createRoute(viewer,'disabled'),AccessDenied);
    await assert.rejects(()=>db.prepare('SELECT * FROM absent_table').first(),error=>error.databaseError===true);
    const broken={...env,DB:{...db,prepare(){const e=new Error('private database detail');e.databaseError=true;throw e;}}};
    const failure=await api(request('/api/annotations'),broken);
    assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes('private database detail'));
    await runInvitationTests(db);
    await runLocationCacheTests(db);
    await db.close();
    console.log(`Passed ${config.DB_DRIVER}: migrations/idempotence, permanent identities, grant isolation/revocation, atomic audit rollback, immutable audit, staged trip permissions, parameter binding, guest quiz, protected reviews, revisions, cross-origin denial, concurrent approval guard, standalone header/bootstrapping denial.`);
  }
  await adminClient.query('CREATE SCHEMA transfer_test');
  await adminClient.query('SET search_path TO transfer_test');
  await adminClient.query(await fs.readFile('migrations/postgres/0001_reviews_accounts.sql','utf8'));
  const fixture={format:'aviquiz-database-snapshot',version:1,tables:{
    app_users:[{id:'u1',email:'test@example.org',status:'active',created_at:'2026-11-19T00:00:00Z'}],
    app_identities:[{issuer:'https://identity.example',subject:'subject1',user_id:'u1'}],
    app_grants:[{user_id:'u1',permission:'system.admin'}],
    app_bootstrap:[{id:1,user_id:'u1',attempt:'attempt1',created_at:'2026-11-19T00:00:00Z'}],
    audit_events:[{id:'a1',actor_user_id:'u1',action:'admin.bootstrap',resource_type:'grant',resource_id:'u1',details_json:'{}',created_at:'2026-11-19T00:00:00Z'}],
    photo_reviews:[{photo_id:'p1',species_id:'b1',status:'draft',revision:3,document_json:'{}',approved_json:null,updated_at:'2026-11-19T00:00:00Z'}]
  }};
  const brokenFixture=structuredClone(fixture);brokenFixture.tables.audit_events[0].actor_user_id='missing';
  await assert.rejects(()=>importSnapshot(adminClient,brokenFixture));
  assert.ok(Object.values(await readTables(adminClient)).every(rows=>rows.length===0));
  let backup;
  const transferred=await importSnapshot(adminClient,fixture,{saveBackup:async value=>{backup=value;}});
  assert.equal(transferred.alreadyImported,false);assert.ok(Object.values(backup.tables).every(rows=>!rows.length));
  const transferredRows=await readTables(adminClient);
  for(const table of Object.keys(TABLES))assert.equal(tableDigest(transferredRows[table]),tableDigest(fixture.tables[table]));
  assert.equal((await importSnapshot(adminClient,fixture)).alreadyImported,true);
  const changed=structuredClone(fixture);changed.tables.app_users[0].email='other@example.org';
  await assert.rejects(()=>importSnapshot(adminClient,changed),/not empty/);
  assert.equal(tableDigest((await readTables(adminClient)).app_users),tableDigest(fixture.tables.app_users));
  console.log('Passed PostgreSQL data transfer: preserved identities/grants/audit/revisions, pre-import backup, FK-failure rollback, all-table hashes, idempotence, and overwrite refusal.');
} finally {
  if(adminClient)await adminClient.end();
  await fs.rm(root,{recursive:true,force:true});
}
