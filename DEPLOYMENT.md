# Packaging and deploying AviQuiz

Updated November 25, 2026. This is the procedure for updating the existing staging
and production installations. It also defines the inputs, outputs, and failure
handling needed to implement a deployment script for either target. Commands are
examples for an authorized operator; writing this document does not authorize or
perform a deployment.

Run local commands from this repository's root, not the parent birding workspace.
Remote commands are explicitly identified. `$AVIQUIZ_*` values are operator-supplied
paths or nonsecret release metadata. Never substitute secret values into examples.

## 1. Targets and boundaries

| Property | Staging | Production |
| --- | --- | --- |
| Host | Existing ChatGPT Sites project | Existing DigitalOcean Ubuntu Droplet |
| URL | Use the deployment tool's literal returned URL; existing reference: `https://sandy-colombia-bird-quiz.scarlet-tanager.chatgpt.site` | `https://aviquiz.org` |
| Project / host | `.openai/hosting.json`: `appgprj_6ade5e114ee881919dad878f0f62fb49` | Reserved IPv4 `104.248.108.210`; SSH host-key verification required |
| Runtime | Worker ES module | Node 24, bundled Worker, systemd, Caddy |
| Application database | Sites-managed D1 binding `DB` | Managed PostgreSQL via existing private VPC endpoint |
| Seasonal objects | Sites-managed R2 binding `EBD_BUCKET` | Read-only files under the selected release's `ebd/` directory |
| Code selection | Frozen, pushed `dev` candidate | Approved candidate promoted to pushed `main` and tagged |
| Activation | Saved Site version, then deployment | Atomic `current` symlink replacement, then service restart |
| Audience | Preserve the existing hosting access control | Public guest quizzes; account APIs enforce application identity |

These hosts use different deployment containers. The staging archive and production
archive will **not** be byte-identical. Preserve the tested application source,
package revisions, species/photo metadata, and seasonal chunk hashes across promotion.
Runtime adapters, environment configuration, and dependency packaging differ by target.

Staging and production have separate application databases and browser origins.
Sharing the sign-in pool does not share account rows, statistics, permissions, or
browser data. Never copy the staging database over production as a routine release.

DigitalOcean Spaces is not required by the current serving path. Do not upload the
original EBD archives, analytical databases, or private regional partitions during
an application release. Canonical data retention in Spaces is a separate operation.

## 2. Release controls

The normal sequence is:

1. Develop, commit, and push to `dev`.
2. Finish data/photo assembly, commit the generated public registry, and push it.
3. Test the resulting frozen candidate locally and check applicable GitHub results.
4. Package and deploy that candidate to staging when authorized.
5. Upload/verify its seasonal objects and perform staging checks.
6. Record the owner's explicit staging approval against the candidate and data hashes.
7. **Required for every production release:** finalize the matching entry in
   `data/releases.json`, setting `productionDeployedAt` to the production cutover
   date (`YYYY-MM-DD`, America/New_York). For `v0.2.0-alpha.1`, leave it null
   until its production deployment. Commit/push the metadata and regenerate the
   localized release pages before tagging and packaging; follow the release-notes
   procedure below to keep the reviewed source and immutable tag consistent.
8. Promote the approved candidate to `main`, tag it, package, and deploy production.
9. Verify the live footer version and its release-notes production date, then
   record the actual activated release and post-deployment verification.

There is no separate staging branch requirement. Do not silently advance a frozen
candidate to a newer `dev` HEAD. A new application, schema, catalog, or registry change
invalidates the approval for that changed content and needs staging verification.
Never move a published version tag. Use an operator-selected semver tag such as
`vX.Y.Z-alpha.N`; do not guess the next release number.

Only one deployment per target may modify source/publication state at a time. A
deployment script should hold a local lock and, for production activation, a remote
lock. Store a resumable receipt outside the source tree. A failed command must stop
the phase; never continue using missing IDs, a partial archive, or stale build output.

When an assistant operates AWS, project rules require confirmation for each account
action. Routine AviQuiz deployment requires no AWS configuration changes. Preserve
existing sign-in callbacks, sender configuration, and certificate authentication.
Testing the invitation page must not send an invitation as an automatic smoke test.

## 3. Prerequisites and release inputs

Use Node 24 and locked npm dependencies, Python 3.10+ (`python3.13` on the current
Mac), Git, SSH/SCP, tar, SHA-256 tooling, and the installed Sites plugin for staging.
`jq` is convenient for the examples. Record actual versions in the release receipt.
Build outside the 1 GiB production Droplet.

Required nonsecret inputs:

| Input | Meaning |
| --- | --- |
| `candidate_sha` | Full GitHub commit SHA selected for staging |
| `source_tree` | Git tree SHA for that candidate |
| `packages[]` | Frozen assembled NC and Colombia package directories, their geography IDs, revisions, and `package.json` hashes |
| `common_objects_dir` | Content-addressed objects produced by `prepare-seasonal.mjs` |
| `legacy_nc_dir` | Legacy NC chunks still referenced by `worker/nc-index.json` |
| `migration_plan` | Pending migration IDs/checksums, grants, backup and compatibility plan |
| `staging_project_id` | Existing project ID from the manifest |
| `production_host` | Existing verified SSH destination |
| `release_tag` | Required before production packaging |

Authentication is supplied separately: GitHub access through the existing credential
helper, Sites access through the supported provider credential flow, SSH through the
agent, and production secrets through existing root-owned environment files. Do not
put credentials into a release plan, Git remote URL, archive, command argument, shell
trace, or log. Avoid `set -x` around deployment operations. Do not print environment
files, account records, authorization headers, or token-bearing callback URLs.

The documented production paths are `/srv/aviquiz/releases`, `/srv/aviquiz/current`,
`/etc/aviquiz/aviquiz.env`, `/etc/aviquiz/migration.env`, and `/etc/aviquiz/db-ca.crt`.
Confirm the actual service/unit/drop-ins before changing anything. Files in this
repository are templates and historical records, not evidence of current live state.
Do not rerun fresh-host provisioning or `deploy/install-service.sh` for an update;
the latter intentionally disables Caddy during initial setup.

## 4. Freeze seasonal data and photos

Use the completed NC regeneration and the selected Colombia package. Discover the
NC path from its actual job state rather than assuming a dated folder name:

```sh
scripts/process-ebd --root ../../outputs/ebd_jobs_nc_refresh status US-NC
```

The required path is `completed.export.package`. A running/failed job is not a
release input. If necessary, convert an already validated daily database using
the commands in [docs/ebd-geography-cli.md](docs/ebd-geography-cli.md).

For the planned NC/Colombia release, finish the agreed collector run, then assemble
a photo revision for each package using the same frozen photo database snapshot.
The collector database may use WAL; **do not copy only its `.sqlite` file while it
is active**. Use SQLite's backup API to make a consistent private snapshot, or use
an explicitly stopped/checkpointed database. For example, on the development host:

```sh
python3.13 - "$AVIQUIZ_PHOTO_DB" "$AVIQUIZ_FROZEN_PHOTO_DB" <<'PY'
import os, pathlib, sqlite3, sys
source, destination = map(pathlib.Path, sys.argv[1:])
fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
os.close(fd)
with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as src:
    with sqlite3.connect(destination) as dst:
        src.backup(dst)
PY

scripts/process-ebd assemble "$AVIQUIZ_NC_PACKAGE" \
  --photo-db "$AVIQUIZ_FROZEN_PHOTO_DB" \
  --catalog dist/nc-birds.json --catalog dist/data.json \
  --output "$AVIQUIZ_NC_ASSEMBLED"
scripts/process-ebd assemble "$AVIQUIZ_CO_PACKAGE" \
  --photo-db "$AVIQUIZ_FROZEN_PHOTO_DB" \
  --catalog dist/data.json --catalog dist/nc-birds.json \
  --output "$AVIQUIZ_CO_ASSEMBLED"
scripts/process-ebd validate "$AVIQUIZ_NC_ASSEMBLED"
scripts/process-ebd validate "$AVIQUIZ_CO_ASSEMBLED"
```

Choose new assembly directories. Retain both assembled packages and validation
receipts outside Git. Do not reassemble after staging approval: new collector
progress belongs in a later release unless the candidate is deliberately reopened.

Prepare the complete package set, including both geographies:

```sh
AVIQUIZ_PYTHON=python3.13 node scripts/prepare-seasonal.mjs \
  --package "$AVIQUIZ_NC_ASSEMBLED" \
  --package "$AVIQUIZ_CO_ASSEMBLED" \
  --objects "$AVIQUIZ_COMMON_OBJECTS_DIR"
```

This validates/copies chunks to files named by SHA-256 and replaces the generated
`worker/seasonal-packages.json`. It replaces the set, not just one entry: omitting a
geography removes it from this registry. Commit the public registry with the source.
Keep chunk binaries, the photo queue, and private processing outputs outside Git.
Record the registry file hash, each package revision, year range and chunk hash/size.

`process-ebd activate` is a local package-inventory operation. Its `active.json`
pointer does not deploy or change a running app; application selection comes from
the committed registry. Never substitute local pointer changes for publication.

## 5. Validate and freeze source

Install dependencies and verify any generated authentication assets before selecting
the candidate SHA. If generation changes tracked assets, review/commit them first.

```sh
npm ci --ignore-scripts
npm run build:auth
git diff --exit-code -- dist/oidc-client-ts.mjs dist/jwt-decode.mjs
node scripts/build-worker.mjs
node test.mjs
node test-audio.mjs
node test-app-audio.mjs
AUDIO_CATALOG_FAIL=1 node test-app-audio.mjs
node test-context.mjs
node test-auth.mjs
node test-accounts.mjs
node test-account-api.mjs
node test-review.mjs
node test-review-permissions.mjs
node test-invitations.mjs
node test-http.mjs
node test-geography.mjs
node test-seasonal.mjs
node test-ebd-files.mjs
node test-statistics-api.mjs
node test-statistics-client.mjs
node test-statistics-ui.mjs
python3.13 -B scripts/test-seasonal-package.py
AVIQUIZ_PYTHON=python3.13 node scripts/test-seasonal-daily.mjs
node scripts/test-local-postgres.mjs
git diff --check
```

The geographic checks require the frozen local objects and, for the independent
daily comparison, the existing private NC/Colombia analytical databases. Supply
`EBD_COMMON_OBJECTS_DIR` where supported if using a different object directory.
The older NC tests still need legacy artifacts in their documented directory.
The PostgreSQL check uses a disposable loopback cluster; it does not touch production.
Record explicitly if an optional/environment-dependent check cannot run; do not
report it as passed. Also run the repository's secret/security checks described in
[SECURITY.md](SECURITY.md). Review findings, not only green workflow badges.

Once code and data preparation are committed and pushed:

```sh
git status --porcelain
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git ls-remote --exit-code origin refs/heads/dev
```

Require a clean tree and the selected SHA at remote `dev`. Tests/builds may create
ignored output; never hand-edit that output. `.github/workflows/security.yml`
currently runs on main pushes, PRs, schedules and manual dispatch, not every dev
push. Open a PR or deliberately dispatch applicable checks when a candidate needs
GitHub verification. A dev push by itself is not a CI success record.

## 6. Staging source and archive handoff

Staging uses the supported Sites connector and installed source helper. Native
operations below are **not shell commands** and this repository supplies no
general-purpose standalone Sites publishing CLI. A deployment script must have a
supported connector/tool adapter, or pause for an operator to perform those steps.
Do not invent REST endpoints, extract browser cookies, or invoke private APIs.

1. Call `get_site` for the existing project. Confirm identity, audience, currently
   deployed version and URL. Record the previous saved version for rollback.
2. Obtain `create_source_repository_write_credential` for the same project. Keep
   the returned object in memory. In `work_proxy` mode there is no token to extract;
   use its supported helper/remote transport unchanged.
3. Discover the installed plugin root (`scripts/site-workflow.mjs`); its versioned
   absolute path is machine-specific. Open from the intended checkout:

   ```text
   node <sites-plugin-root>/scripts/site-workflow.mjs --project-id <existing-project-id>
   ```

   Use a PTY. After `Ready for Site workflow JSON on stdin (input is hidden).`,
   send one newline-terminated JSON object containing `credential`. For opening,
   omit `archivePath`. Retain the complete returned opening object and use its
   `checkout_path`. It is not the same as the credential object.
4. Compare the opened source to the frozen candidate. The Sites source remote and
   GitHub origin can differ. The helper can fast-forward or refuse divergent
   history; it must not be bypassed by a force push or destructive reset. Resolve
   differences deliberately and repeat candidate verification if runtime content
   changed. Ensure the source intended for deployment is committed on GitHub.
5. Build in that returned checkout using `node scripts/build-worker.mjs`. Its output
   is `dist/server/index.js`; the copied hosting manifest is
   `dist/.openai/hosting.json`. The source manifest must keep `project_id`, `d1: DB`
   and `r2: EBD_BUCKET`, and must omit `static` for this Worker application.
6. Run the helper again with a new absolute archive destination outside the checkout.
   The newline-delimited stdin object contains `credential`, the **complete** opening
   result as `source`, remaining ordered argument-array `commands`, and `archivePath`.
   Use `commands: []` if those checks/builds already passed on unchanged inputs.
   The helper commits/pushes source and creates the archive. Any newly created source
   commit must also be on GitHub and have the approved candidate's runtime/data tree.
7. Retain its exact `project_id`, `commit_sha`, and `archive` result. Verify exit
   status, archive readability and SHA-256. Inspect archive members without changing
   them: Worker output, manifest, and `dist/.openai/drizzle/` must be present. The
   plugin packages the Drizzle migrations and journal from the source checkout.

The credentials must never be written into the stdin transcript, a JSON file, shell
history, or release receipt. The helper's source/opening results can be retained
without the credential. An expired credential requires a fresh supported credential,
not a patched helper. Never replace the produced archive before the save completes.

## 7. Save and deploy staging

1. Call `save_site_version` using the exact helper-returned project, commit and
   archive fields. Persist the returned saved-version ID. A source-only saved
   version does not substitute for an archive-backed version.
2. Preserve the observed audience. The existing shared staging site uses
   `deploy_site_version(project_id, saved-version-id)` through its tool schema.
   If the audience genuinely changes to owner-private, use the skill's matching
   private-deployment operation; do not change audience merely to deploy.
3. Persist the actual deployment ID, status and literal URL. Sites applies pending
   D1 migrations **before uploading the Worker**. A failed deployment can therefore
   leave new schema with the previous app still active. Read actual migration state
   before retrying or rolling back; never edit an applied migration or journal entry.
4. A nonterminal publish result is not success. Retain the IDs and resume status
   inspection through the supported provider operation instead of issuing another
   deploy. When operating through the current Sites skill, follow its asynchronous
   handoff/status rules rather than an unbounded polling loop. Record a terminal
   succeeded result before moving to data/readiness verification.

This task's dev source includes additive migration `0004_user_statistics`; staging
must apply it before serving the statistics API. No production database data is
copied into D1. Protect pre-release D1/review data with the provider's supported
backup/export procedure. No universal D1 backup/restore CLI is checked into this repo;
an external script must supply that provider integration and record its receipt.

## 8. Load staging seasonal objects

The Sites archive contains application metadata, not the content-addressed seasonal
objects. After the matching Worker is deployed, upload each unique common chunk to:

```text
POST <staging-url>/api/geography/import?sha=<chunk.sha256>
Content-Type: application/octet-stream
Body: exact compressed chunk bytes, unmodified
```

Iterate `packages[].index.chunks` from the frozen registry, deduplicated by SHA-256.
Read the source bytes from `common_objects_dir/<sha256>` and verify length/hash before
sending. The endpoint accepts only hashes/sizes compiled into that Worker and
returns `stored: true`; `unchanged: true` is an idempotent success. Stop on other
statuses or an unexpected body. Do not treat a hosting login redirect/HTML page as
an upload success. Use an authorized browser or supported Sites service-access
transport with transient credentials outside logs. The reviewed repository has no
standalone common-object uploader that supplies this hosting authentication.

If retaining the legacy NC API, also ensure its `worker/nc-index.json` objects exist.
Their compatible endpoint is `POST /api/nc/import?chunk=N`, reading the exact bytes
from the selected legacy NC directory and checking that index's size/hash first.

The current common upload endpoint knows only the **currently deployed** registry.
It cannot preload hashes absent from that registry. The first deployment of a new
data revision can therefore briefly return 503 for new places until upload finishes.
Track `code_published` and `data_ready` separately and do not announce the release
as ready before both are true. A future zero-gap staging flow needs an authorized
preload mechanism or separate preauthorization/activation design; it is not currently
implemented. Keep prior content-addressed objects so older saved versions can read
their original data after rollback.

## 9. Staging verification and approval

Use the existing hosting gate. An unauthenticated redirect is not proof of an app
failure; do not make staging public as a workaround. Verify:

- `/`, `/explore`, `/quiz`, `/statistics`, `/review` and direct route reloads.
- `/api/geography/catalog` lists exactly the intended NC/CO package revisions and
  year ranges; country, department/county and hotspot queries return usable pools.
- Seasonal species and eligible-photo counts match local API receipts from the
  frozen packages. Check a leap day, New Year window, family filter, all-species
  sizing, original Colombia itinerary, audio quiz, and photo credits/season fallback.
- Public annotations match a fresh pre-release snapshot; guest review mutations
  remain denied. Do not hardcode historical annotation counts as perpetual truth.
- Consent/details work; a dedicated test account can change historical storage,
  sync cumulative statistics, and import a **copy** of legacy data. No quiz archive
  should be created. Guests retain ordinary quiz access and do not see account import.
- Sign-in/out use the staging return URLs. Merely opening `/review` or `/invite`
  does not establish authorization or justify sending an invitation.

Record the owner's approval with source SHA/tree, package revisions, registry hash,
Site saved version/deployment IDs and date. Staging imports do not populate the
production database. Never clear Luis Miguel's or the owner's original browser
statistics because a staging test import succeeded.

## 10. Promote the approved candidate

After approval, promote from a clean checkout. The simplest case is a fast-forward:

```sh
git switch main
git pull --ff-only origin main
git merge --ff-only "$AVIQUIZ_APPROVED_SHA"
git push origin main
git tag -a "$AVIQUIZ_RELEASE_TAG" -m "AviQuiz approved release"
git push origin "$AVIQUIZ_RELEASE_TAG"
```

Do not force this if histories diverged. Resolve the promotion, compare its tree to
the approved candidate, and restage any runtime/data/schema changes. If only release
documentation differs, record the explicit tree/content comparison; do not assert
that different commits are identical without evidence. Check applicable GitHub
security/CodeQL results on the promoted SHA and review findings before production.

The production packager itself requires a clean tree, branch `main`, and exact
HEAD equality with remote `main`. It records a matching semver tag when present,
but does **not** require one. The deployment wrapper must enforce the release-tag
requirement and verify the tag resolves to the approved production SHA.

## 11. Package production

Use the same frozen registry and objects tested in staging. On a compatible build
host, install locked development dependencies and run:

```sh
EBD_SERVING_DIR="$AVIQUIZ_LEGACY_NC_DIR" \
EBD_COMMON_OBJECTS_DIR="$AVIQUIZ_COMMON_OBJECTS_DIR" \
node scripts/package-do.mjs
```

The final JSON is `{release, folder}`. Current implementation writes
`/private/tmp/aviquiz-<16-hex-digest>`; retain and validate that returned absolute path
rather than constructing an assumed name. The directory contains:

- `server/http.mjs`, the built Worker and standalone database/storage modules.
- Public auth defaults; production's HTTP adapter generates public callbacks from
  protected runtime configuration and `PUBLIC_ORIGIN`, without editing source.
- SQL migrations and the statistics runtime-grants file.
- Legacy and common objects at `ebd/<sha256>`, each checked against its index.
- `release.json` recording commit, branch, optional version, timestamp and file list.

The packager verifies objects but does not install production dependencies, create
the transport archive, upload, back up/migrate a database, switch services, or verify
the deployed app. It creates/reuses its digest directory; a wrapper should use a
fresh build workspace and reject unexpected pre-existing content, not assume that
an old directory is pristine. Do not rebuild or modify an approved archive in place.

Install production-only dependencies into the returned folder using a build platform
compatible with Ubuntu x86_64 / Node 24, outside the Droplet:

```sh
npm ci --omit=dev --ignore-scripts --prefix "$AVIQUIZ_RELEASE_DIR"
```

Review dependency changes that require native modules or lifecycle scripts. Do not
copy macOS-native binaries onto Linux. An already approved production `node_modules`
can be reused only after `package.json` and `package-lock.json` both compare
byte-for-byte and runtime/platform compatibility is confirmed; record its provenance.
The release digest is calculated before installing dependencies, so also record
the final archive hash and lockfile hash, not only the digest directory name.

Create a transport archive containing the directory's contents, not its absolute
parent path. On macOS, suppress AppleDouble/extended attributes:

```sh
COPYFILE_DISABLE=1 tar -C "$AVIQUIZ_RELEASE_DIR" -czf "$AVIQUIZ_ARCHIVE_PATH" .
shasum -a 256 "$AVIQUIZ_ARCHIVE_PATH"
```

Use a fresh archive path, inspect its members, and record its byte size and SHA-256.
Linux operators can use `sha256sum`. Reject absolute paths, `..` traversal, and
symlinks escaping the release directory; ordinary internal npm symlinks are expected.
No `.env`, private keys, databases, source `.git`, raw EBD, or browser profile belongs
in this archive. Include `node_modules`; it is installed after `release.json` is
created and is not individually enumerated in that file.

## 12. Transfer and verify production files

Use the existing SSH agent and verified host key. Never disable host-key checking.
Upload as `deploy`, for example:

```sh
scp "$AVIQUIZ_ARCHIVE_PATH" deploy@104.248.108.210:/srv/aviquiz/releases/
```

Remote deployment logic, running as `deploy`, must:

1. Hold `flock` on `/srv/aviquiz/.deployment.lock` for the deployment critical section.
2. Record `readlink -f /srv/aviquiz/current` and that release's `release.json`. Preserve
   the previous release and objects; historical names in DO-PRODUCTION.md are not
   necessarily today's rollback target.
3. Check free space for the archive, extracted release/dependencies, backups, and
   one retained rollback release. Do not copy EBD analytical datasets onto this host.
4. Run `sha256sum` on the uploaded archive and compare the local receipt exactly.
5. Inspect members before extracting into a **new** `/srv/aviquiz/releases/<release>`
   directory. Reject existing/different content rather than overwrite a live release.
6. Use service-readable permissions, e.g. group `aviquiz` and no world access. Do
   not follow unsafe archive links or restore arbitrary ownership from the builder.
   The release owner should be `deploy`; service code is immutable by release policy.
7. Compare `release.json` commit/tag to the approval receipt and verify all `ebd/`
   bytes against the approved registry/legacy index. The archive hash covers the
   packaged code and dependencies; `release.json` is metadata, not a signature.
8. Check environment compatibility without printing secrets: `PUBLIC_ORIGIN` must
   be `https://aviquiz.org`, `DB_DRIVER=postgres`, TLS verification/CA must be retained,
   and `EBD_DATA_DIR` must be unset (release-local default) or point at the approved
   complete object set. An override pointing at an old folder can cause data 503s.

Do not overwrite systemd/Caddy configuration or protected environments merely to
deploy application code. Preserve existing Roles Anywhere supplementary-group and
certificate configuration; repository service templates may omit installed drop-ins.

## 13. Production backup, migration and grants

This is a separate root-authorized phase. The `deploy` user can manage the app service
but cannot read migration credentials or perform arbitrary privileged operations.
Use `/etc/aviquiz/migration.env` with systemd `EnvironmentFile` loading; do not shell
`source` it or place the database URL/password on a process command line.

Required algorithm for the privileged deployment adapter:

1. Make a native PostgreSQL custom-format dump under `/root/aviquiz-backups/`, with
   mode 0600 and a unique name. Use matching PostgreSQL 18 `pg_dump`/`pg_restore` tools.
   Existing one-off `deploy/upgrade-invitations.mjs` and `upgrade-geography.mjs` show
   the protected-environment backup pattern, but are not generic update commands:
   their imports and grant filenames depend on a prepared support-directory layout.
2. Parse the loaded `DATABASE_URL` in memory. Pass host, port, user, password and
   database to `pg_dump` through its child environment (`PGHOST`, `PGPORT`, `PGUSER`,
   `PGPASSWORD`, `PGDATABASE`); retain `PGSSLMODE=verify-full` and `PGSSLROOTCERT`.
   Arguments contain only `--format=custom --no-owner --no-acl --file <backup-path>`.
   Never print the URL, child environment or raw driver errors.
3. Require a successful dump and readable `pg_restore --list`; record backup size,
   SHA-256 and protected path. Listing verifies readability, not a full restore test.
4. Compare applied migration IDs/checksums to the release migration plan. Unknown
   applied migrations, edited history, or an incompatible schema must halt activation.
5. Run the new release's migration CLI as schema owner. For example, on the server
   as root (use a unique, validated unit name):

   ```sh
   systemd-run --wait --collect --pipe \
     --unit="$AVIQUIZ_MIGRATION_UNIT" \
     --property="WorkingDirectory=$AVIQUIZ_RELEASE_DIR" \
     --property=EnvironmentFile=/etc/aviquiz/migration.env \
     /opt/node24/bin/node server/database/migrate.mjs
   ```

   The CLI applies all pending files under `migrations/postgres/` in a transaction
   with checksummed migration history and a PostgreSQL advisory lock. It does not
   back up, seed accounts, import data, or grant runtime permissions.
6. Apply applicable runtime grants using the schema-owner connection with verified
   TLS. Current feature files are `deploy/invitations-runtime-grants.sql`,
   `deploy/geography-runtime-grants.sql`, and `deploy/statistics-runtime-grants.sql`.
   Apply only reviewed grants for installed features. The production packager now
   includes the statistics grant file; older grant files must be supplied separately
   from the exact approved checkout if needed and hash-checked on transfer.
   A privileged Node wrapper can use `resolveDatabaseConfig(process.env)`,
   `postgresPoolOptions(config)`, `new pg.Client(...)`, and `client.query(sql)` to
   execute these files without printing connection values. Close the client even
   on failure. No generic root backup/migrate/grant wrapper exists for all features.
7. Probe using the **runtime** environment and role: `createDatabase(process.env)`
   plus read-only queries should confirm connectivity, TLS, and SELECT access to
   required tables, including both statistics tables. Confirm required INSERT/UPDATE
   privileges without granting schema creation, superuser, or audit mutation rights.

For statistics, `0004_user_statistics` adds preference and aggregate-summary tables.
No user's browser history is imported during deployment. Users explicitly import
their own old snapshot after sign-in; preserve the browser copy until success.

The additive migrations currently in source are intended to coexist with the old
application during transition. For any future incompatible migration, explicitly
plan a maintenance window or expand/contract release; do not infer compatibility.
Coordinate application write access during backup/restore planning. A backup file
is not permission to restore it over new user activity automatically.

## 14. Activate production and check readiness

Only after files, dependencies, database and grants pass, atomically change the
symlink on the same filesystem. Example remote Linux commands as `deploy`:

```sh
ln -s "$AVIQUIZ_RELEASE_DIR" /srv/aviquiz/.current-next
mv -Tf /srv/aviquiz/.current-next /srv/aviquiz/current
sudo /usr/bin/systemctl restart aviquiz.service
sudo /usr/bin/systemctl is-active aviquiz.service
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
```

Validate the release path under `/srv/aviquiz/releases` before this step. If the
temporary symlink already exists, inspect it and resolve the interrupted operation;
do not blindly remove an unrelated path. These commands belong inside the remote
deployment lock. This is an atomic path switch plus a service restart, not a
zero-downtime multi-process rollout.

Other loopback requests need `Host: aviquiz.org` because canonical-host checks are
intentional. Verify externally from the operator machine:

```sh
curl --fail --silent --show-error https://aviquiz.org/healthz
curl --fail --silent --show-error https://aviquiz.org/api/geography/catalog
curl --fail --silent --show-error \
  'https://aviquiz.org/api/geography/quiz?place=US-NC-037&from=2026-09-20&to=2026-10-10'
curl --fail --silent --show-error \
  'https://aviquiz.org/api/geography/quiz?place=CO-MET&from=2026-09-20&to=2026-10-10'
```

Compare returned revisions/counts to the frozen local and approved staging receipts,
not old hardcoded example counts. Repeat the staging functional/security checklist
for the production environment. `/healthz` checks basic DB access, not package
coverage, new table grants, login, or every feature. Production uses packaged files;
do not POST data to the staging import route on the read-only filesystem adapter.

Record actual `current`, release commit/tag, health result, package revisions,
annotation parity, access denials and manual sign-in outcome. Root can inspect
`systemctl status aviquiz caddy` and redacted journald output if checks fail.
Never log request credentials or protected process environments.

## 15. Rollback and failure recovery

| Failure point | Required behavior |
| --- | --- |
| Candidate/data validation | Stop; no publication. Retain reports and fix inputs. |
| Source-helper or archive save | Keep local source and result IDs. Reconcile/renew access; do not deploy a different archive under the old commit. |
| Sites migration/deployment | Determine which migrations actually applied. Preserve the old saved version and database; don't edit applied SQL. |
| Staging object upload | Retry exact missing hashes idempotently. Report code published/data incomplete; don't approve the release yet. |
| Production archive verification | Reject it before extraction/activation. Do not overwrite the previous release. |
| Backup/migration/grants | Keep `current` unchanged. Inspect actual schema before retrying; restore is a separate reviewed operation. |
| New app fails after activation | Restore the recorded prior symlink, restart and recheck, if its code is schema-compatible. |

Staging code rollback redeploys a known-good **saved version from the same project**,
retaining audience. Its original content-addressed objects must remain available.
Production code rollback uses the recorded prior release path and the same atomic
symlink/restart procedure. Do not infer a rollback path from a dated document.

Neither rollback reverses database migrations, account/statistics writes, published
annotations, credentials, browser storage, or external media changes. Keep additive
tables and user data. An old app may stop saving account statistics during rollback;
record that limitation instead of deleting data or replaying unverified browser
snapshots. Incompatible schema rollback requires its own recovery plan and approval.

## 16. State contract for a deployment script

The following is a proposed orchestration contract, **not** the output of an existing
all-in-one command. Persist nonsecret state atomically after each successful phase:

| Phase | Required outputs / evidence |
| --- | --- |
| `candidate_frozen` | GitHub candidate SHA/tree, branch, lockfile/tool versions, tests/security receipts |
| `data_frozen` | Package paths/revisions/manifest hashes, registry hash, common and legacy object hashes/sizes |
| `staging_packaged` | Source-helper project/commit/archive, archive hash, migration journal/file hashes |
| `staging_published` | Saved version, deployment ID, literal URL, succeeded status |
| `staging_data_ready` | Each common/legacy object upload acknowledgement and successful representative reads |
| `staging_approved` | Owner approval tied to the above code/data/verification evidence |
| `production_packaged` | Main commit/tag, returned release ID/folder, final archive hash/size, dependency provenance |
| `production_prepared` | Verified upload/extraction, previous release, private backup receipt, migration/grant results |
| `production_active` | Actual current symlink, service/HTTPS checks, observed package revisions |

Suggested functions are `freezeData`, `verifyCandidate`, `packageStaging`,
`publishStaging`, `loadStagingObjects`, `verifyStaging`, `promoteApprovedCandidate`,
`packageProduction`, `prepareProduction`, `activateProduction`, and target-specific
`rollback`. Require an explicit target and approval input; never choose production
from a missing/unknown argument. Resume from recorded IDs and hashes, not the latest
available artifact or whichever branch happens to be checked out.

Existing tooling covers data assembly/validation/preparation, Worker builds, the
Sites source/archive helper, production file packaging, database migrations and
individual runtime grant SQL. Remaining orchestration work includes provider tool
transport, hosting-authenticated staging data upload, a generic privileged backup/
migrate/grant adapter, production transfer/activation, release receipts and rollback
automation. Implementing those adapters is separate from this documented procedure.

For operating details see [RUNBOOK.md](RUNBOOK.md), [DO-PRODUCTION.md](DO-PRODUCTION.md),
[STATISTICS.md](STATISTICS.md), [SECURITY.md](SECURITY.md), and the
[geography CLI workflow](docs/ebd-geography-cli.md). Where historical release notes
conflict with this procedure, inspect current source/live state and record the
resolution; don't execute obsolete one-off commands simply because they appear
in an earlier deployment record.

## Language message assets

Application wording is authored in `locales/{en,es-CO}/*.json`; page structure is
authored in `pages/*.html`. See [I18N.md](I18N.md). Before either staging or
production packaging, run `npm run test:i18n`; `node scripts/build-worker.mjs`
automatically generates the message resources and both language variants. Commit the
generated assets together with their canonical sources before release-source
verification. Do not edit generated `dist/*.html` directly.

The Worker contains the browser message resources and its own server runtime.
The standalone DigitalOcean package additionally includes `dist/i18n.mjs`,
`dist/messages-en.mjs`, `dist/messages-es-CO.mjs`, `dist/locale-preference.mjs`,
`dist/i18next.mjs`, and `dist/i18next-LICENSE.txt` for
server adapter imports. `scripts/package-do.mjs` adds these files to the release
manifest and digest. Deployment scripts must retain them. No extra runtime service is required. English is the default; the header selector
sets a host-specific language preference cookie. The Worker embeds both generated
HTML variants and message bundles. Run `npm run test:language` before promotion
and have native speakers review the Spanish interface in staging.

## Public release notes and footer version

`data/releases.json` is the canonical footer version and release history. The
version link targets `/releases#release-<tag>`; the general link targets
`/releases`. Both languages are generated with the normal message/page build.
Descriptions live in `locales/{en,es-CO}/releases.json`. A release contains a
brief introduction and key-item bullets. Sections show pending candidates first,
then production releases by newest deployment date (version breaks ties).

Keep an upcoming release's `productionDeployedAt` null during development and
staging review; it displays as a preview, not an already deployed production
release. The initial recorded production date is November 24, 2026, supported by
`DO-PRODUCTION.md`. Do not substitute a commit, tag, build or staging date for a
production deployment date. The current next production candidate is `v0.2.0-alpha.2`;
creating a notes entry does not create or publish a Git tag.

As part of the approved production cutover, finalize the release metadata with
the production deployment day (America/New_York calendar date), commit/push that metadata, and create the matching
immutable version tag before packaging. Coordinate this final metadata change
with the staging-approval process; it is a source change. The packager refuses a
missing/mismatched exact tag or a current entry still marked as a preview. Verify
the actual deployment day and public release section after activation. If the
cutover is delayed to a different day, correct the candidate metadata before
publishing that release; never move an already published tag or silently invent
a successful deployment record. Record deployment failures in the operator log,
not as successful public release dates.

For each subsequent release, add an entry and localized wording, update
`currentTag`, and retain older entries and anchors. Run
`node scripts/build-worker.mjs`, `node test-release-notes.mjs`,
`node test-i18n.mjs`, and the normal release checks. Published notes are part of
the immutable application artifact and change through the usual reviewed release
workflow. No database or external release-notes service is involved.

## Staging receipt - November 27, 2026

Staging version **57** is published at
https://sandy-colombia-bird-quiz.scarlet-tanager.chatgpt.site from frozen GitHub
commit `e4986df1fd93a3c273393f75ebe205471bf9c163`. Deployment ID:
`appgdep_6b0a20c712e48191ae9cc458a02e7e3e`. The saved version is
`appgprj_6ade5e114ee881919dad878f0f62fb49~appgver_07ed89729e348191a6605bc767b57fb7`.
The archive SHA-256 is
`ec162b7fc47d902ce306ecf4b6fac314cc38f895209b310bc3a1cd70c9939ae4`.
The custom staging audience remains unchanged (access-policy revision 1).
Previous saved version 56 remains the code rollback reference; old objects were
retained. The additive statistics migration created `user_statistics_settings`
and `user_statistics_summary`; rolling code back does not remove those tables.

Both common packages were assembled from the same consistent SQLite backup of
the finished collector. NC has 457/457 species with photo references; Colombia
has 1,964/1,964. The shared queue has dated photos for all 2,171 unique species.
Quarter coverage is not complete: 8,630 of 8,684 slots reached the two-photo
target, with 39 needs-review slots and 15 partial slots remaining. Those gaps
were preserved, not retried or hidden. Package revisions:

- US-NC: `fc9668667dfa94abd20a0a8f87b3611e9c22f263548c3debd4f226031a7b02d9`.
- CO: `c473cdc3e4ca6a1da755cbddc18d9d5eb228144ca3525441b8624ef0f9eac1a5`.

All 11 unique common objects (41,619,824 bytes) passed local and upload digest
checks. Eighteen live API comparisons matched frozen local species/pool counts,
sampled seasons, and photo/date/credit signatures: NC, Chatham, Jordan Lake,
Colombia, Meta and a Caldas hotspot across autumn, New Year and leap-day windows.
Spanish country-level API output also passed. English/Spanish page routes,
month/day controls, footer/version notes, 126 unchanged approved annotations,
and guest review/statistics denial were checked. The installed statistics tables
were observed through the supported Sites database reader. Local application,
metadata, geography, release-notes, consent/history, authorization, standalone
HTTP, SQLite/PostgreSQL, and independent daily-data comparison checks passed.

Private photo snapshot, paginated logical backups of the eight non-cache staging
user/review tables, public-annotation baseline, gap list, package receipts,
archive, upload receipt and API comparisons are retained under
`outputs/releases/alpha02-staging-20261127/` at the workspace root, outside Git.
The logical backup is a paginated read, not a provider transaction/PITR image;
regenerable location cache rows were excluded.

Production is unchanged. `v0.2.0-alpha.1` is still a preview: no production date
or Git release tag was assigned. Native-speaker Spanish review, interactive
signed-in statistics/import testing, and owner staging approval remain required
before production promotion. Use a copy of browser statistics for import tests.

## Production receipt - November 28, 2026

Owner-approved staging version 58 (`1a27491cfc399d180373512feec6187a43dac7a0`)
was promoted as **v0.2.0-alpha.2**. The only candidate content changes before
promotion finalized `productionDeployedAt` to November 28 and regenerated its
localized pages. Main and the immutable tag point to
`41f8c2203fed72b9f481d0fa5df0cfe6200b3a10`.

Active production directory: `/srv/aviquiz/releases/aviquiz-1fdeeb1269406285`.
Archive SHA-256: `91fc344819b19f425001a085b5e3c7df9581ba4a5c8a861b225ff793d2e23808`.
Previous release `/srv/aviquiz/releases/aviquiz-1d80e9838caf2fa6` remains available
for code rollback. Both serving package revisions match staging version 58.
A verified readable native PostgreSQL backup was retained at
`/root/aviquiz-backups/pre-alpha02-2026-11-28T11-01-32.555Z.dump` (55,891 bytes);
this was a backup-readability check, not a restore exercise. Migration
`0004_user_statistics.sql` and its runtime grants succeeded before activation.
The running service configuration and certificate authentication were preserved.

Public HTTPS health, release/date, all main page navigation targets, photo credits,
and 18 NC/Colombia seasonal quiz count comparisons passed after activation. The
collection contains 2,171 unique species, 34 first-level geographies and 8,872 sites.
Signed-in browser-statistics import still requires the user's own interactive test.
Luis Miguel's supplied Cognito subject was matched to the active production account
and expected email; only `users.invite` was granted, with an application audit row.
No AWS account call or invitation email was required by this operation.

GitHub CodeQL, Gitleaks, dependency audit and PostgreSQL 17/18 integration passed.
The regression job failed at `test-geography.mjs` because the private common-object
directory is absent on GitHub runners; that complete test passed locally against
the frozen data. The follow-up development work supplies self-contained fixtures
for CI and keeps full local data comparisons. This failure was not recorded as a
successful CI workflow. Staging remains version 58, with its existing access controls.

## Follow-up development: external catalogs

The development serving format is specified in [docs/serving-format.md](docs/serving-format.md).
Its registry no longer embeds `catalog`, full `nodes`, or a full place index.
Before packaging either target, run `scripts/verify-seasonal.mjs` against the
selected manifest and object directory. Enumerate objects with `servingObjects()`
from `scripts/serving-release.mjs`: this includes navigation shards, species shards,
per-package bird indexes and fact chunks. The older chunk-only instructions in
sections 4/8 describe alpha.2's embedded format and are insufficient for the new
format. Never mix an old manifest or upload list with the external-catalog reader.

Use `scripts/upload-seasonal.mjs` for private Spaces preload and digest verification
before activation; credentials are read only from the protected runtime file.
The manifest is still committed/code-pinned. Retain objects for previous releases;
rollback switches code and its matching manifest together. No external-catalog
code, storage-driver change or new R2 objects have been deployed by the alpha.2
production promotion. The first staging transition needs a compatible preload
bootstrap or a documented controlled data-loading interval because its old import
endpoint cannot accept hashes absent from the active registry. Preserve staging
access controls throughout; an HTTP login page is not an import acknowledgement.
