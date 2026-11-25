# AviQuiz runbook

For the current end-to-end staging and production release procedure, use
[DEPLOYMENT.md](DEPLOYMENT.md). It consolidates packaging, data publication,
migrations, approval gates, verification and rollback. Older deployment examples
below remain operational context; prefer the consolidated procedure and the
current Sites skill when their workflow details differ.

Updated November 19, 2026. Production runs at https://aviquiz.org on DigitalOcean with PostgreSQL; ChatGPT staging remains on Sites/D1 behind its existing access control. Commands below run from the repository root unless stated otherwise.

## Identify the system before changing it

| Item | Current value / source of truth |
| --- | --- |
| Repository | <https://github.com/ScarletTanager/aviquiz> |
| Hosted quiz | <https://sandy-colombia-bird-quiz.scarlet-tanager.chatgpt.site> |
| Shared review workspace | <https://sandy-colombia-bird-quiz.scarlet-tanager.chatgpt.site/review> |
| Project ID | Read `.openai/hosting.json`; currently `appgprj_6ade5e114ee881919dad878f0f62fb49`. Reuse it; do not create a replacement Site. |
| Backend source | `worker/index.mjs` |
| Generated deployment entrypoint | `dist/server/index.js` |
| Shared database | D1 binding `DB`, table `photo_reviews` |
| Runtime configuration | `REVIEW_OWNER_EMAIL`; secret `REVIEW_AGENT_KEY` |

Use `git status --short` and `git log -1 --oneline` to identify local changes and the source revision. Use Sites `get_site` and saved-version/deployment tools for current live revision, audience, and status; local HEAD is not proof of deployment. Never change audience as a workaround for a failed operation.

See [ARCHITECTIURE.md](ARCHITECTIURE.md) for boundaries, components, and future plans.

The dev statistics MVP is documented in [STATISTICS.md](STATISTICS.md). It is not
deployed: apply migration 0004 and the explicit PostgreSQL runtime grants before
deploying compatible code. The feature stores cumulative personal totals and latest
comparisons, with no quiz archive. Existing browser history is kept until explicit
account import succeeds; do not clear testers' browser data as a deployment step.

## Page navigation checks

After deployment, check `/` (landing), `/quiz` (configuration), `/statistics` (accuracy), and `/review` (shared review). Refresh `/quiz/` and `/statistics/` directly to verify Worker aliases; assets use absolute paths. A plain static-file server previews navigation from `/`, but cannot resolve these extensionless paths on refresh. Use the built Worker for route checks (`test-review.mjs`). Check that browser Back/Forward works and existing photo/audio history remains present. Never rename storage keys as part of a display-brand change.

## Prerequisites and credential handling

See [SECURITY.md](SECURITY.md) for GitHub scans, pinned tools, local audit commands, and repository settings. Workflow changes do not deploy the site. Review CodeQL alerts as well as job conclusions; successful scanning does not mean no findings. Keep built-in secret scanning/push protection distinct from the post-push Gitleaks CI check.

- Node 24+ for ES-module tooling, `import.meta.dirname`, and SQLite-backed tests; Python 3 for the optional static preview. Run npm ci for build and authentication/database dependencies.
- Git and authorized source-repository access for publishing. GitHub `origin` and the source repository returned by Sites may differ; verify both rather than assuming a push to one updates the other.
- Access to the Sites tools and installed Sites workflow helper for hosted deployment. The helper is supplied by the plugin, not checked into this repository.
- Owner sign-in for browser review operations, or the local ignored `.review-agent.json` plus runtime-matching agent key and supported Site service access for batch operations.

Keep tokens and secret values out of command arguments, Git, manifests, batch documents, screenshots, and logs. Pass transient credentials through protected stdin/session memory. Do not print `get_site` or credential responses wholesale. Keep `.review-agent.json` readable only by its operator (mode 0600); do not rotate its runtime counterpart merely to inspect state. No production credential is needed for the automated tests.

## Start and stop a local quiz preview

For browser-only development:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8000/>. Stop it with Ctrl-C in the terminal that launched it. If the port is occupied, identify the existing process or select another port; do not terminate unrelated processes.

This serves quiz assets only. `/api/annotations` is absent, so the browser reports shared reviews unavailable and falls back to built-in guidance. `/review` is not an equivalent local API-backed workspace; even opening `/review.html` does not provide a backend. This preview does not emulate Sites identities, D1, hosted access checks, or deployment behavior. Localhost also has a different browser-storage origin from the hosted site.

For a local API-backed server, build the Worker, then run `DB_DRIVER=sqlite SQLITE_PATH=/absolute/local.sqlite PUBLIC_ORIGIN=http://localhost:3000 AUTH_ENABLED=false node server/http.mjs` after applying migrations. No complete local Worker/D1 emulator command is maintained. `test-review.mjs` exercises the API against in-memory SQLite; it is a test, not a running development server. Do not expose a development server that accepts untrusted identity headers as production.

Browser/screen-capture automation is not part of this runbook. It has been disabled at the owner's request; use automated logic/API checks and voluntary manual browser checks.

## Validate and build a code change

```sh
node test.mjs
node test-audio.mjs
node test-app-audio.mjs
node test-accounts.mjs
node test-context.mjs
AUDIO_CATALOG_FAIL=1 node test-app-audio.mjs
node scripts/build-worker.mjs
node test-review.mjs
git diff --check
```

Stop on the first failed check and resolve it before publishing. The build must run before `test-review.mjs`, which imports the generated Worker. The build embeds current top-level supported assets in `dist/`; do not edit `dist/server/index.js` directly. When adding a new asset type, check `scripts/build-worker.mjs` because its extension allowlist determines what is embedded.

Checks cover selection/filters and matching, history/statistics, audio geography, DOM/media-event integration, experimental-statistics exclusion, personal annotation review, and the review API with real SQLite. They do not establish audible clip clarity, native-player appearance, or every arrow's visual accuracy.

Documentation-only edits do not require a Worker deployment. Changes to catalogs or application assets do; ordinary shared annotation saves do not.

## Deploy code or catalog changes

This is the current supported Sites workflow. Native tool names below are operations in the Sites connector, not shell executables.

1. Read `.openai/hosting.json`. Call `get_site` for that exact project ID and retain its audience. Record the current live saved version and take a shared-review export before a database-affecting release.
2. Call `create_source_repository_write_credential` for the same project. Keep the returned credential in session memory. Do not request automatic private publication for the currently shared Site.
3. Open/synchronize source using the plugin helper from this checkout:

   ```text
   node <sites-plugin-root>/scripts/site-workflow.mjs --project-id <project-id-from-manifest>
   ```

   The angle-bracket values are placeholders. Launch through a PTY; after the helper says stdin is hidden, send a newline-terminated JSON object containing `credential`. For opening, omit `archivePath`. Read the returned `checkout_path` and use that checkout. Retain the full opening result as `source` for packaging. Do not force-reset a dirty checkout to resolve synchronization trouble.
4. Implement the change, run the checks/build above, and review the diff. Preserve hosting bindings and secrets. Migration files under `drizzle/` must be schema-only; add a new migration rather than editing an applied one.
5. Run the same helper again with protected stdin containing `credential`, the full opening `source`, `commands` for any remaining ordered checks/builds, and an absolute `archivePath` outside the repository. Use `commands: []` when checks/build already passed on unchanged inputs. The helper commits/pushes and packages the exact source. Retain its returned `project_id`, `commit_sha`, and `archive` unchanged. Renew an expired credential before retrying; do not bypass expiration checks.
6. Call `save_site_version` with those exact returned values. Include the archive. Keep it unchanged until saving succeeds. Retain the saved version's exact `id`.
7. For the current shared audience, call `deploy_site_version` with the project ID and saved version ID. Preserve audience. If the initial status is `pending`, `building`, or `publishing`, call `get_deployment_status` using the returned deployment ID until terminal. A `failed` result is not a completed release; record the failure, project, version, and deployment IDs.
8. If `origin` is a separate GitHub mirror, push the reviewed source commit there using the configured authenticated Git workflow and verify the resulting SHA. Do not embed credentials in the remote URL. Keep release records of source SHA, saved version, deployment ID, and verification result.
9. Perform post-deployment verification below.

The provider applies declared D1 migrations during deployment. A source push alone is not proof of a running release. Never substitute an unsaved build, project ID, or deployment ID for a saved version ID.

## Verify a release

Use a signed-in authorized browser, or approved HTTP probes with the Site service credential passed through protected stdin. An unauthenticated HTTP redirect/access denial may be the hosting gate, not a Worker failure.

- Confirm deployment status `succeeded` and its literal URL.
- Confirm `/`, `/app.mjs`, `/data.json`, `/audio.json`, and `/annotation-review.mjs` return the expected content. Confirm `/review` serves the workspace shell.
- Confirm `GET /api/annotations` returns JSON and the expected coverage. Coverage was 126 approved photos / 123 species after the October 31 batch; compare against a fresh pre-release export rather than hardcoding that forever.
- Confirm an ordinary non-owner cannot fetch `/api/reviews` (403), while the owner/agent can. Loading the workspace shell alone does not prove edit authorization.
- Check the three corrected original photos remain corrected if the release affects annotations: ML433956961, ML205367721, ML279526541.
- When doing manual QA, try one photo session and one audio session, an unscored media skip, separate statistics, and an experimental session that leaves history unchanged. For personal review, mark a photo and confirm it is excluded next time while a skipped photo remains eligible.

A media HEAD request can establish availability/content type but cannot establish that a recording is clear, local, or correctly foregrounded. Do not download/rehost media to work around a remote access restriction.

## Start, stop, restrict, or roll back the hosted system

**Start/update:** deploy a saved version successfully. The managed Worker runs on requests; there is no repository daemon, `npm start`, SSH service, or process to restart.

**Stop:** there is no implemented application shutdown or maintenance switch. Use a verified provider-supported suspension/unpublish facility if one is available to the operator; this repository does not supply a shutdown command. Restricting the Site audience can limit visitor access during an incident but is not a shutdown and can affect users. Make such an access change only when explicitly authorized, record the original policy, and restore it deliberately. Do not delete the Site or database to stop traffic.

**Roll back code:** identify a known-good saved version from the same project, assess migration compatibility with the current database, and redeploy that version through the appropriate deployment tool. Check terminal status and run the smoke checks. Reconcile source history afterward so the next release does not inadvertently reintroduce the problem.

Code rollback does not roll back D1 contents, secrets, provider access settings, Cornell media, or browser-local histories. There is no automated migration downgrade. A code rollback must not be assumed safe after an incompatible schema change.

**Withdraw a bad annotation:** use `unpublish` for that exact review document, or correct and reapprove it. Saving a draft leaves the previous approved annotation live. New quizzes reload approved snapshots; already-running quizzes may retain loaded tips. No deployment is required.

## Update shared photo annotations

### Owner workspace

Open `/review` while signed in as the owner. Refresh shared state, choose a species/photo, inspect the original and eBird/Merlin account, edit the document, inspect the rendered preview, and save a draft or approve. Review visible features only; do not put an arrow on an absent feature or infer visibility from metadata. Keep original media and source attribution.

Work breadth-first: one approved photo per uncovered species before another round. Revising an already approved photo is allowed. A 409 requires refreshing and reconciling with the current revision, not forcing an overwrite. Refresh before exporting.

### Agent batches

`node scripts/review-agent.mjs` reads a JSON instruction from stdin **until EOF**, unlike the workflow helper's single newline-terminated instruction. Use a protected, echo-disabled input channel. Supported fields are:

| Field | Purpose |
| --- | --- |
| `serviceToken` | Transient Site service credential; never put this in a file. |
| `exportPath` | Absolute path for a pre-batch review-state export. |
| `batchPath` | Absolute path to a credential-free JSON array of `{action, document}`. |
| `skipApproved` | Defaults to skipping already approved photos. Set `false` only for intentional edits to them. |
| `seed` | Idempotent original six-photo import; not a normal batch operation. |

The client currently targets the hosted URL explicitly in its source; update/review that target when creating another environment. It reads `.review-agent.json` automatically, loads current revisions, saves sequentially, stops on failure, and reports coverage. A batch is not atomic: earlier successful items remain saved if a later item fails. Export/reconcile server state before retrying. Default skipping helps an interrupted approval batch resume, but must not conceal an intended correction.

Documents contain actual image dimensions, normalized arrow points, paraphrased source tips, source URL, private notes, and actual source/photo verification flags. Approval requires at least one visible-feature callout and inspected proof; setting flags in a file is not a substitute for inspection. See [REVIEW.md](REVIEW.md) for schema/limits.

After a batch, export fresh state and verify every intended photo's published features, distinct species count, and preservation of existing corrections. Shared approval and a visitor's personal “Mark reviewed & next” are separate operations; neither substitutes for the other.

## Backup and recovery

Before bulk edits, export current review state through the owner workspace or `exportPath`. Keep the export and its timestamp, source SHA, environment, and coverage in durable private storage outside Git. Exports may contain draft notes. A file left in `/private/tmp` is temporary staging, not a durable backup. The batch client creates exports with mode 0600; protect copies as well.

Git backs up application source and prepared catalogs, not D1 records or browser history. The application has no automatic export/restore scheduler. Verify provider-native database backup/recovery availability separately before relying on it; this runbook does not claim a configured backup service or recovery-time guarantee.

There is no exact database-restore command in the app. To repair selected content, compare an export to current rows and submit reviewed corrections using current revisions. The export is a `{schema, rows, coverage}` object, not a directly importable batch. Replaying it would require deliberate conversion and approval-order handling and would not preserve original revisions/timestamps. For full loss/corruption, preserve evidence, confirm provider recovery options, and plan restoration before writing new data. The seed endpoint restores only six original pilot photos.

Browser-local histories and personal review marks have no implemented backup/import UI. Do not clear site storage as a routine troubleshooting step; it removes that browser's learning history. Preserve any needed data first. A hosting-origin migration needs a separate explicit history-transfer design.

## Diagnose runtime problems

Record the URL/route, time with timezone, source/deployment version, user access category, browser, media asset ID if relevant, HTTP status, and reproduction steps. Redact credentials and private draft content. Browser Network/Console tools can be used manually; no screen recording is required. The app has no dedicated log viewer or health endpoint. Use deployment status for release failures and any supported provider runtime diagnostics available to the operator; do not assume deployment logs explain a request-time fault.

| Symptom | Checks and response |
| --- | --- |
| Entire site inaccessible | Check Sites status, current audience, sign-in, and deployment status first. Distinguish a hosting redirect/403 from a Worker response. Preserve access policy. |
| Page loads but stale behavior | Verify live saved version/SHA; inspect `/app.mjs` and catalog responses. Reload the page. Assets use `no-cache`; do not erase localStorage. A long-lived open session may retain old state. |
| Shared tips unavailable / API 503 | Check `DB` binding, migration/deployment status, and `/api/annotations`. Missing DB explicitly returns 503; SQLite/D1 errors are sanitized. Ordinary quizzes can fall back while shared review writes remain unavailable. |
| Review API 403 for owner | Confirm authenticated identity reaches the Worker and owner ID or `REVIEW_OWNER_EMAIL` matches the provider identity. For an agent, verify both hosting service access and matching review key without printing either. Do not make the API public. |
| Save 409 | Reload current review state. Resolve a stale revision or breadth-first approval conflict, then resubmit deliberately. |
| Save 400 / 413 / 415 | Check document validation/length limits, JSON syntax, body size, action, and `application/json` content type. Cross-origin POSTs with an Origin header are rejected. |
| Photo/audio unavailable | Inspect the asset URL/status and content type. Try another candidate or skip without scoring. A Cornell outage/403 cannot be repaired by redeploying unchanged AviQuiz code. |
| Audio selector disabled | Check `/audio.json` load/validation and console errors. Photo practice should remain usable. Subspecies/locality uncertainty is a catalog limitation, not necessarily a playback defect. |
| Audio cannot be answered yet | Press Play; the app gates scoring on the playback event. Check native-player support and loading errors; retry or skip unclear/unavailable media. |
| Unexpected statistics or review birds | Check selected medium, site membership, retained last-20 attempts, strict >25% threshold, reveals, and experimental exclusion. Earlier experimental attempts were not tagged and remain in old history. Local histories differ across origins/devices. |
| Site-only rate empty or different from general rate | Check the display switch. Only answers after context tracking from this exact site with All families selected count; family/all-sites sessions cannot enter or evict this independent window. No backfill of older history is possible. Linked site lists carry `/site-only` when appropriate. |
| Site clue missing or unexpected | It is offered for family or all-sites regular/mistake-review quizzes, defaults off on page load, and uses checklist occurrence, not media locality. No named site may be assigned. It stays fixed within a question and carries visibility between questions until disabled. |
| Photo repeats in personal review | Confirm “Mark reviewed & next” was used, storage is writable, and browser/origin is unchanged. Merely opening or skipping does not mark reviewed. The original 26 require the explicit one-click mark if reviewed before tracking existed. |
| Annotation correction not visible | Verify approved snapshot, not only draft. Check exact photo ID and start a new quiz to reload tips. General fallback text is not an arrow-reviewed photo. |
| CLI succeeds partly then fails | Batch writes are sequential and partial. Export fresh state, identify the last successful item, and resume deliberately. A source credential expiry requires renewal, not changing Git URLs to contain a token. |

## Catalog and source-data maintenance

Do not rerun preparation during a routine deployment. `prepare_data.py` depends on the parent workspace's workbook/life-list outputs and `/private/tmp/ebird-taxonomy.csv`; it rebuilds checklist output and resets photo attachments. `finalize_photos.py` reattaches saved metadata from `photo-metadata.json`. These are workspace-specific utilities, not a clean-checkout ingestion pipeline. Preserve inputs, inspect the output diff, reconcile names/IDs and live annotations, then run the complete checks before publishing regenerated data.

Audio preparation is `python3 scripts/prepare-audio-catalog.py /absolute/path/to/metadata-cache`. Its cache consists of public Cornell metadata described in [AUDIO.md](AUDIO.md). It rewrites `dist/audio.json`; inspect provenance, exclusions, coverage changes, and geographic selection before building/deploying. Do not bypass source access challenges or silently substitute another media provider.

Annotation records reference catalog species/photo IDs. Removing or changing IDs can orphan published content or make it impossible to edit with current validation. Plan reconciliation before publishing a catalog replacement.

## Dormant identity/route foundation

See [AAA.md](AAA.md). `node test-accounts.mjs` validates the server libraries and staged SQL using isolated in-memory SQLite. It requires no provider or secrets. The staged `schema/identity-routes.sql` is intentionally outside `drizzle/`; do not apply it to the live database. No new account/route endpoints, bootstrap workflow, or feature enforcement is active. Existing `worker/index.mjs` remains the live owner/agent boundary. Provider selection, session verification, administrative recovery, production migration, and controller integration must precede activation. Do not deploy a simulated-identity adapter or treat the library's actor-ID arguments as safe request parameters.

## When hosting or identity changes

Update this runbook alongside the change. Establish separate environment IDs, databases, secrets, authentication clients/callbacks, and access policies. Document the new runtime build/launch/shutdown, schema migration, logs, backups/restoration, guest access, rollback, and provider identity validation. The current trusted-header owner check cannot simply be exposed on a generic Azure endpoint. Independent managed authentication, per-user/per-route permissions, public guest hosting, and eBird ingestion are not implemented by these documents.

## Moving browser progress to a new hostname

In Statistics, use Export progress to download an AviQuiz JSON backup. The file carries visual and audio history, independent site-only attempts, latest completed quiz results, and personal annotation review marks. Each browser/device has its own history and needs its own export.

On the destination hostname, open Statistics, select the JSON backup, check the preview, and choose Replace saved progress with this file. Import restores the snapshot and replaces existing browser progress. Export any destination history to keep before importing. Repeated imports restore the same snapshot. Close other AviQuiz tabs during import. History has no unique attempt IDs or timestamps suitable for a reliable merge.

Import validates the entire file before writing. A temporary recovery record retains the previous values until all writes succeed. Failed writes roll back. If browser storage prevents rollback, reload to retry recovery before practicing.

Shared photo-review drafts and approvals live in the backend database and require a separate database migration. Browser backups contain personal quiz progress and review marks.


## Cognito-backed account setup

After deployment, reload AviQuiz while signed in with the owner's Cognito
account and the existing Sites owner session. The status line should show
“AviQuiz administrator”. This first request links the stable provider identity
to a permanent app account and performs the one-time audited administrator
bootstrap. No AWS-console role or Cognito group becomes an AviQuiz role.

If the browser reports Cognito sign-in succeeded but account setup failed,
inspect `/api/account/enroll` in browser network tools WITHOUT copying its
Authorization header or any tokens. 401 means the assertion could not be
verified (check expiry, deployed issuer/audience and public-key availability);
403 means an unverified email, disabled app account, or rejected origin; 503
means account storage is unavailable. Check migration/deployment status before
changing SQL. If enrollment succeeds but admin status is absent, check that
Sites authenticated the owner, REVIEW_OWNER_EMAIL matches the verified Cognito
email, and whether app_bootstrap was already consumed. Do not delete that
record or grant privileges by email to work around a failure. Recovery must be
reviewed separately. Existing browser statistics are not migrated by login.

Local backend builds now require `npm ci` first, then
`node scripts/build-worker.mjs`. Run `node test-account-api.mjs` for local
signature, bootstrap and database tests; it makes no AWS requests. Cognito
runtime verifies public keys via fixed issuer JWKS, without AWS management
credentials. Each agent AWS action still requires separate user confirmation.


Account API routing: both the exported `api` handler and default Worker `fetch`
must dispatch `/api/account` and its children to accountApi before the review
controller. A 404 with “Unknown review route” means the wrong API controller
handled the account request, rather than a Cognito login failure. Regression
test-review.mjs checks both entry points. The account status identifies the
registration or administrator-setup phase in user-facing language. Technical
HTTP status is available as data-account-setup-status on #account-status and in
browser network tools, without displaying the provider name or tokens.

## Offline bounded EBD benchmark

Use `python3 -B scripts/ebd-benchmark.py --output /absolute/new/output/directory`
with the existing paired sample and source archives. Outputs must remain outside
the source/deployment checkout. The default local run caps new output at 500 MiB,
monitors a 256 MiB worker RSS ceiling, and streams each worldwide archive for
only 10 seconds. Use `--skip-scans` to run just the small sample. It makes no
network calls or production changes. Read EBD-BENCHMARK.md for exact input paths,
limits, caveats, tests and restart procedure. Never substitute the in-memory
pilot as evidence that a worldwide ingestion fits those resource limits.

## Standalone database selection and migrations

See [DATABASES.md](DATABASES.md) for the implemented local PostgreSQL/SQLite
adapters. Sites keeps its platform D1 binding and existing migration flow.
Standalone startup requires `DB_DRIVER=postgres` plus secure `DATABASE_URL`, or
`DB_DRIVER=sqlite` plus `SQLITE_PATH`; it does not fall back on connection failure.
PostgreSQL defaults to verified TLS and a five-connection pool.

Run `npm ci`, load private deployment settings, then run `npm run db:migrate`
explicitly before standalone startup. This command creates schema only; it does
not transfer current D1 records or bootstrap a new administrator. Migration
history is transactional and checksum-checked. Keep existing migration files
immutable and back up the destination before applying future changes.

Run `npm run test:database` for temporary local PostgreSQL plus SQLite tests.
The wrapper starts and stops its own loopback-only PostgreSQL cluster and cleans
up test data. It does not start the Homebrew default cluster or a permanent
service. Production uses the PostgreSQL adapter; see DO-PRODUCTION.md for the completed deployment and migration.

## DigitalOcean host preparation

See [DO-PRODUCTION.md](DO-PRODUCTION.md) for the prepared NYC1 host, reserved IP,
service accounts, systemd/Caddy templates, firewall, validation, and remaining
launch requirements. Server setup is complete but the app/proxy are inactive;
protected PostgreSQL credentials and the empty application schema are now
installed, but staging application data has not been transferred. OS updates
require a pre-launch reboot, which has not been performed. The supplied database
private hostname now resolves and its TLS endpoint is reachable; installing the
DO project CA certificate is complete, and a TLS 1.3 handshake with certificate
and hostname verification passed. Dedicated runtime authentication is now verified through systemd as the service
user. See DO-PRODUCTION.md for role permissions and credential file paths.


The production PostgreSQL schema is owned by aviquiz_migrator; runtime grants
are narrower and do not include audit mutation or schema changes. The applied
PostgreSQL migration file must remain immutable. `/etc/aviquiz/aviquiz.env` and
`/etc/aviquiz/migration.env` are root-only 0600 files; never display them in logs
or chat. The temporary doadmin handoff file was removed after successful setup.
The read-only service-user health probe is `/srv/aviquiz/support/db-check.cjs`.
Run it via a transient systemd unit with User/Group=aviquiz and the application
EnvironmentFile; do not make the environment file world/group readable to run it.

## DigitalOcean production operations

See [DO-PRODUCTION.md](DO-PRODUCTION.md) for inventory, protected paths, release
identity, and migration evidence. Production and staging share one managed
identity pool/client for now, but have separate app databases. Do not change
staging access controls or publish a staging update as part of a DO deployment.

Build on a development machine, not the 1 GiB Droplet:

```sh
npm ci --ignore-scripts
node scripts/build-worker.mjs
node test-http.mjs
node test-review-permissions.mjs
node scripts/package-do.mjs
```

The packager prints a `/private/tmp/aviquiz-<digest>` directory. Install locked
production-only dependencies there with `npm ci --omit=dev --ignore-scripts`,
archive its contents without macOS extended attributes, and record the archive
SHA-256. Upload as `deploy` to `/srv/aviquiz/releases`, verify the checksum,
extract to a new immutable release directory, and atomically replace `current`
with a symlink to that release. Never upload source exports, secrets, or EBD
archives. For schema changes, back up first, then run the migration CLI with
`/etc/aviquiz/migration.env` as root before switching compatible code. Do not
run migrations with runtime credentials or edit an applied migration.

The deploy account may run exactly:

```sh
sudo /usr/bin/systemctl restart aviquiz.service
sudo /usr/bin/systemctl stop aviquiz.service
sudo /usr/bin/systemctl start aviquiz.service
sudo /usr/bin/systemctl is-active aviquiz.service
```

Verify `curl -f http://127.0.0.1:3000/healthz` on the Droplet, then
`curl -f https://aviquiz.org/healthz` externally. Other loopback requests must
include `Host: aviquiz.org`; a 421 otherwise is intentional. Check `/`, `/quiz`,
`/statistics`, `/review`, public `/api/annotations`, and private API denial to
guests. The review HTML is public; its data and mutations require authorization.
Use a normal browser for sign-in/sign-out and review permission verification;
never copy tokens or token-bearing callback URLs into logs or chat.

Root diagnosis: `systemctl status aviquiz caddy`,
`journalctl -u aviquiz.service -n 100`, and `journalctl -u caddy -n 100`.
A 502 suggests the app is not listening; check app startup/DB connectivity.
A 503 health response suggests DB failure. A 401/403 on account APIs calls for
checking the configured issuer/client, account status, and app grants. Runtime
logs deliberately omit request credentials and query strings. Do not print
protected environment files. Root can run the bundled database health probe
through a transient systemd service using the runtime EnvironmentFile.

For code rollback, atomically point `current` at the previous compatible release
and restart; schema/data rollback is separate and must not overwrite post-launch
changes. Root controls Caddy start/stop/reload; stopping it removes public access.
Caddy renews HTTPS certificates automatically. Both services are enabled at boot.
Protect and test managed PostgreSQL backups: redeploying a Droplet restores code,
not user data. The initial import receipt is not a continuing backup policy.

## Single-recipient invitations (production)

See [INVITATIONS.md](INVITATIONS.md) for the locally implemented invitation
screen, audited account creation, permission boundary, quotas, partial-failure
recovery, and activation checklist. Production release aviquiz-513b4f8eb3a4e29d now includes this feature with
certificate-based sender authentication and migration 0002 applied. Staging is unchanged.

Certificate-based sender preparation now lives in [deploy/roles-anywhere/README.md](deploy/roles-anywhere/README.md). It includes the offline CA/CSR/signing workflow, a disabled-by-default CloudFormation stack, SDK credential-process configuration, expiry checks, and recovery instructions. The deployed resource state and authentication probe are recorded there.

## Geography launcher and directory cache

See [GEOGRAPHY.md](GEOGRAPHY.md) for `/explore`, persistent region/hotspot
metadata, administrator refresh behavior, season selection, pilot coverage
limits, and preservation of the original Colombia quiz through December 18.

## Required source checkpoint before production

Commit and push the exact source to GitHub before production packaging.
`package-do.mjs` refuses dirty trees or a local HEAD that differs from the
current branch on origin, builds the Worker only after that check, and records
Git SHA/branch in release.json. Deploy the artifact from that revision only.
Never copy a dirty working tree to production. Run the redacted secret scan
and verify private files are ignored before committing. Public client IDs and
resource ARNs may be tracked; actual API keys and private keys must not be.

Release promotion uses dev -> staging deployment -> Sandy verification -> main
-> production deployment. A staging branch is optional and is not used by default.
Production packaging rejects branches other than main. A GitHub push alone does
not authorize production deployment; obtain the user staging sign-off first.

## Prepare regional EBD work

See [EBD-PROCESSING.md](EBD-PROCESSING.md) for `ebd-partition.py partition` and
`plan`. Run outside the repository with an explicit release/year range and a new
output directory. Incomplete manifests are blocked; `partitioned` still requires
aggregation and validation before serving. Do not run a full worldwide preparation
on the 1 GiB application Droplet or treat the local 500 MiB cap as cloud sizing.

## NC analytical aggregation

See [EBD-NC.md](EBD-NC.md) for the regional aggregation command, resource limits,
source-native taxonomy mapping, audit rules, completed NC results, and artifact
paths. These daily facts are local analytical output, not a production database
migration or a new live quiz list. Keep the reconciliation database private.

### NC seasonal data build and staging upload

The dev branch now has a shared NC/Colombia package reader and launcher integration.
It has not been deployed. For new packages use [the common geography CLI workflow](docs/ebd-geography-cli.md),
including photo assembly, validation, and preparation. The instructions below describe
the legacy NC publication path still retained for compatibility. The shared import
route is `/api/geography/import?sha=<compiled chunk hash>`; it accepts only exact
registry-approved bytes. Preparing or activating a local package is not deployment.

Run `scripts/ebd-export-quiz.py` with `--database` pointing to the validated
`daily.sqlite`, `--taxonomy` to the public eBird species taxonomy JSON, `--regions`
and `--hotspots` to cached NC geography API responses, and `--output` to a private
artifact directory outside Git. Review the photo coverage report and queue before
publication. Commit the generated NC metadata and content-hash index with the
application source; never commit the analytical database or binary data packs.

Sites provisions `EBD_BUCKET` through the hosting manifest. After deploying the
exact pushed/tested commit, POST each binary pack to `/api/nc/import?chunk=N`.
This is an immutable content publication endpoint: the compiled index fixes the
only accepted bytes, SHA-256, and object name. It accepts neither arbitrary data
nor object paths nor remote URLs, and an existing object is never overwritten.
There is no general-purpose storage upload capability or new upload credential.
A new data release requires a reviewed source commit with new approved hashes.
The bucket has no public read endpoint. Quiz reads fetch only one bounded place
range, verify its digest, and decompress it. Keep hosting access controls intact.

Run `node test-nc.mjs` against the exported artifacts, plus geography, app-session,
and shared-review regression tests. Test Chatham with/without single-season
species, a county/hotspot cold reload, a family filter, leap day, and a window
crossing New Year. NC quizzes currently leave saved statistics unchanged.

### Background photo metadata queue

`scripts/photo-metadata-worker.py` uses a durable local SQLite queue at
`outputs/photo_metadata/queue.sqlite` under the project workspace root (outside
Git). It currently requests eBird species-page metadata and accepts only a
Cornell image URL with an exact species match and an explicit photographer
credit. A challenge page is rejected even if it includes image metadata. No
photographs are downloaded. A separate adapter queries Macaulay catalog metadata with its own queue under
`outputs/photo_metadata/macaulay/`, selected with `--host search.macaulaylibrary.org`
and an explicit `--db` path. Its access state is independent of eBird's.
Catalog JSON is accepted only when it explicitly supplies photo type, exact
species identity, asset ID, and contributor; unknown schemas need review.

Feed catalogs with `python3 scripts/photo-metadata-worker.py --enqueue
/path/to/catalog.json`; repeated enqueue calls are idempotent. EBD quiz exports
feed the queue automatically and reuse verified references on their next build.
The worker never edits source catalogs or publishes a release while running.

Run `python3 scripts/photo-metadata-worker.py --run --hours 24 --interval 90
--max-requests 100` in a supervised process. One worker per queue is enforced by
an OS lock. The queue survives process restarts. Use SIGTERM to stop the worker.
It waits at least 90 seconds between requests, caps response size at 2 MiB, rejects
redirects, and backs off 30 minutes on challenges or rate/server errors (honoring
longer numeric/date Retry-After values). After a second challenge, that host is
persistently blocked; adding species or restarting never clears the block.
`--fresh-attempt` requires explicit owner authorization. Never run it as part of
an automated import. The owner's November 21 fresh attempt was to eBird, not
Macaulay, and returned an HTTP 200 challenge.

`status.json`, `access-log.tsv`, and `verified-photos.json` next to the queue
provide progress, lookup failures, and validated references. `needs_review` means
missing/unrecognized metadata or a non-success response, not a verified photo.
Check the status timestamp as well as the PID to confirm the worker is alive.
Local work pauses during sleep/offline periods; this is not yet an always-on
DigitalOcean service. A verified-metadata build still follows dev, staging,
owner review, then production.

The November 21 separate Macaulay fresh probe also returned an HTTP 200
challenge. Its worker is on its own 30-minute cooldown and one-retry policy.
EBD exports feed both queues and merge verified references on the next build.

### Browser metadata pilot

The November 22 browser pilot collected one verified photo reference for each of
10 previously uncovered NC species, with one tab and roughly 20 seconds between
navigations. All 10 loaded without a visible challenge. Results and the batch
manifest are under `outputs/photo_metadata/browser-batch-10*.json` outside Git.
Prepared NC coverage is 96/457; this does not update a deployed catalog.

Use `scripts/import-browser-photos.py --db /path/to/queue.sqlite --input
/path/to/results.json` for observed browser results with page URL, title, species
heading, OG image URL, and OG attribution. It validates the complete batch before
writing, checks scientific/common identity and Cornell URL/credit, deduplicates
assets, and preserves direct-access host blocks. Browser access is a separate
observed success, not permission to copy session credentials into HTTP clients.
The original browser pilot ran through the interactive browser tool. The
standalone seasonal collector below can now run independently of Codex.

Future concurrency should separate retrieval from validation and publication.
Use one durable species queue, atomic leases, retry-safe result writes, and a
shared Cornell request budget across all tabs/workers and domains. Imports can
queue species while a browser retrieves and local validators prepare results.
Do not multiply retrieval traffic by launching several browser sessions. Test a
larger serial batch before considering bounded concurrent retrieval. Preserve the
30-minute challenge backoff and stop after the permitted retry.

### Publish verified references without rerunning EBD aggregation

Run `python3 scripts/reconcile-photo-catalog.py --catalog dist/nc-birds.json
--verified /path/to/verified-photos.json --report /private/path/coverage.json
--require-complete`. It validates numeric asset IDs, Cornell origin URLs,
matching common-name attribution (including explicit parenthesized forms), and
credits before atomically replacing the catalog. It preserves existing references.
The NC production gate is complete coverage of the current serving catalog.

Commit and push the resulting source to dev, run the metadata importer/worker,
NC seasonal, geography, application-session, and shared-review checks, then
package/deploy that exact revision to staging. A reference-only change does not
require re-uploading unchanged seasonal data packs. Verify live scope/photo
counts and preserve review annotations and hosting access. Wait for owner
approval before production promotion.

Earlier flat photo-count guideline (November 22, 2026): four per species.
This has been superseded by the seasonal two-per-quarter target below.

### Seasonal photo metadata MVP

The current target is **two dated photos per species per calendar quarter**:
January–March, April–June, July–September, and October–December (eight photos per
species when fully covered). This supersedes the flat four-photo guideline.
Location matching, subspecies targeting, and finer month/day selection are
separate future work; a quarter is calendar context, not a verified plumage label.

`scripts/seasonal-photo-metadata.py` owns two additional tables in the private
local metadata queue database: `photo_assets` stores unique species/asset pairs,
exact `observed_on` dates, derived quarters, full reference metadata and evidence;
`photo_quarter_jobs` tracks each species/quarter toward a target of two. This is
the metadata-processing database, not the production accounts/trips PostgreSQL
schema. Existing undated references remain stored with null date/quarter and do
not count as seasonal coverage.

The working public source is the Macaulay/eBird media catalog in list view. Its
visible per-photo `<time datetime>` gives the observation date; retain the exact
calendar date as `observationDate`, its original value as `observationDateRaw`,
and `observationDateSource: cornell-catalog-observation`. This is not upload date
or an assertion about EXIF capture time. Store the canonical asset/checklist
links and photographer credit. Discard browser tracking query parameters. Do
not extract browser credentials or bypass challenges. The inspected featured
Northern Cardinal asset ML297087301 resolved to a non-public asset after the
browser challenge cleared; its observation date remains unknown.

Seed jobs with `--seed dist/nc-birds.json`, import an observed catalog payload with
`--import-file /private/path/payload.json`, and write reports/exports with
`--output /private/path/seasonal`. `--plan N` yields one next-quarter job per
species in breadth-first order, prioritizing species with fewer covered quarters.
Run `scripts/test-seasonal-photo-metadata.py` before using a changed importer.
All four quarter jobs are recorded for every NC species, and checkpoints survive
browser interruptions. The standalone collector below consumes this queue.

Payloads contain the observed catalog URL and rows with species name/scientific
name, species URL, asset URL, image URL, photographer, exact `observedAt`, and a
checklist URL. Imports reject wrong identity, missing/invalid dates, stale results
outside the requested quarter, inconsistent asset IDs, and conflicting dates.
Empty results require explicit visible no-results confirmation. Distinct assets
are counted; duplicate imports are idempotent. Independent checklists are preferred
when available. Location fields are intentionally omitted from this MVP pass.

`coverage.json` reports dated/undated totals, completed species-quarter slots,
and fully covered species. `dated-photos.json` preserves the reference metadata
for later publication. `scripts/reconcile-photo-catalog.py --merge` can attach
that verified export to an existing catalog while retaining references and dates;
normal dev/staging review still applies. These collection changes do not activate
quarter-based selection in the deployed quiz.

### Standalone browser collection

`scripts/collect-photos` controls a local Playwright Chromium worker without
Codex, ChatGPT, or an AI API. It uses the existing private NC queue by default:
`/Users/sandy/col_birding/outputs/photo_metadata/queue.sqlite`. Completed quarter
jobs are skipped; restarting continues breadth-first from the saved queue. The
November 23 paused checkpoint contains 279 species / 558 dated references; its
next target is Yellow-bellied Flycatcher, quarter 1. This is one dated quarter
per covered species, not complete four-quarter coverage.

From the repository directory:

```sh
scripts/collect-photos status
scripts/collect-photos start
scripts/collect-photos stop
```

`start` detaches the worker from Terminal; closing Terminal or Codex does not
stop it. `stop` asks the worker to finish its current bounded browser operation,
save progress, and close the browser. `status` remains responsive during browser
operations and cooldowns, and reports checkpoint counts/next job even when no
worker is running. A second `start` reports the existing worker. The queue lock
also prevents overlap with the older HTTP worker. Do not run interactive imports
against this queue while the standalone collector is running.

For foreground operation or a bounded batch:

```sh
scripts/collect-photos run --max-requests 5
scripts/collect-photos start --max-requests 20
```

`--max-requests 0` (default) continues until no pending jobs remain, a persistent
challenge blocks access, or the process is stopped. `--interval 35` is the default;
values below 30 seconds are rejected. `--visible` opens a dedicated browser window;
headless is the default. The collector uses its own profile, never your personal
browser profile or cookies. It does not solve CAPTCHAs, modify its user-agent,
use proxies, or attempt challenge evasion. Headless browser acceptance by Cornell
is not guaranteed even when the interactive browser works.

A first challenge sets a durable 30-minute cooldown, followed by one retry.
A second challenge persistently blocks the browser collector; restarting does
not clear it. Review that blocker with the owner before any fresh attempt. HTTP
429 / server errors wait at least 30 minutes and honor a longer Retry-After.
Transient job failures are tried at most three times, then marked `needs_review`;
confirmed empty results are `no_results`, and a single valid photo is `partial`.
Other pending jobs continue. No pending work therefore does not imply complete
coverage. Review `coverage.json` and the log for gaps. Browser crashes get at most
two automatic relaunches with a one-minute pause. Unhandled errors stop safely
with an error status rather than looping forever.

Private files are under `outputs/photo_metadata/seasonal/` outside Git:

- `collector.log`: timestamped progress, failures, and challenge URLs.
- `collector-status.json`: latest phase, request count and collection result.
- `coverage.json`, `dated-photos.json`: cumulative metadata and coverage.
- `<species>-q<quarter>.json`: validated observed metadata evidence.
- `browser-profile/`: dedicated local browser state; do not upload or commit it.

```sh
tail -f /Users/sandy/col_birding/outputs/photo_metadata/seasonal/collector.log
```

The Mac must remain awake and connected. Sleep suspends progress; the persistent
queue/cooldown lets a later start resume safely. This is not a login-start service:
restart it explicitly after a reboot. It never uploads metadata or deploys AviQuiz.
Image, media, and font requests are blocked; only DOM reference metadata is saved.
Normal browser resources/cache can still use disk. No full-resolution photo
collection is created.

The isolated Python environment and Chromium binaries have been installed in
`outputs/photo_metadata/browser-venv` and `outputs/photo_metadata/browser-binaries`.
To recreate them on this checkout layout (Python 3.13 recommended):

```sh
python3 -m venv ../../outputs/photo_metadata/browser-venv
../../outputs/photo_metadata/browser-venv/bin/pip install -r scripts/browser-photo-requirements.txt
PLAYWRIGHT_BROWSERS_PATH="$(cd ../.. && pwd)/outputs/photo_metadata/browser-binaries" ../../outputs/photo_metadata/browser-venv/bin/python -m playwright install chromium
```

For another workspace layout, invoke `scripts/browser-photo-collector.py` using
that environment's Python with explicit `--db` and `--output` paths, and set
`PLAYWRIGHT_BROWSERS_PATH` to the browser install directory. For a new queue only,
add `--seed dist/nc-birds.json`; the current NC queue needs no reseeding.

Validation:

```sh
python3 scripts/test-browser-photo-collector.py
AVIQUIZ_BROWSER_TESTS=1 PLAYWRIGHT_BROWSERS_PATH="$(cd ../.. && pwd)/outputs/photo_metadata/browser-binaries" ../../outputs/photo_metadata/browser-venv/bin/python scripts/test-browser-photo-collector.py
```

The opt-in tests use local fixture HTML and a future cooldown for CLI lifecycle
checks; they make no Cornell requests. The production source remains the public
catalog's rendered DOM, subject to markup changes and access restrictions.

The November 23 bounded live standalone test received an automated-access
challenge on the next NC target (Yellow-bellied Flycatcher). It saved no new
photos, persisted the first challenge and 30-minute cooldown, and exited after
its one-request limit. Collection is stopped. The next `start` honors that saved
cooldown and consumes the one allowed retry; a repeated challenge blocks further
requests. Offline extraction/CLI tests passed, but unattended Cornell access has
not been established for this separate Chromium profile. No cookies were copied
from the interactive browser and no bypass was attempted.

#### Human verification in the standalone browser

To let the owner complete a challenge in the dedicated browser, start with:

```sh
scripts/collect-photos start --manual-verification
```

This implies `--visible`. If a collector is already running, stop it first:
`start` does not change a running worker's mode. On a challenge the worker sets
`phase: waiting_for_verification` in `status`, leaves the window open, and waits
indefinitely for the owner to complete verification. It only observes the DOM;
it does not click challenge controls, reload, or navigate to retry while waiting.
`stop` still works during this wait. Closing the browser stops collection safely.

Once the requested species/quarter catalog is visible and passes the normal
metadata validator, the worker saves that page and resumes automatically. This
successful verification clears only the standalone browser's challenge count,
block and cooldown; independent HTTP-worker blocks are untouched. An existing
persistent block is not cleared merely by starting in this mode. Without this
flag the original 30-minute / one-retry policy remains unchanged. Stopping before
verification succeeds preserves the challenge count and cooldown/block.

Manual mode permits normal browser resources, including images, so challenge
widgets can render correctly. The browser may cache those resources; the worker
still saves only reference metadata, not photo files. No personal browser profile
or cookies are imported. This mode requires occasional human participation when
the host requests verification; it is not a CAPTCHA solver or access bypass.
