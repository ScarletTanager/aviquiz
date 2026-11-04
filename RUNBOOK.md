# Aviquiz runbook

Documented November 1, 2026 for the current Sites-hosted Worker and D1 deployment. Azure and independent Aviquiz authentication are proposals, not operating environments. Commands below run from the repository root unless stated otherwise.

## Identify the system before changing it

| Item | Current value / source of truth |
| --- | --- |
| Repository | <https://github.com/ScarletTanager/aviquiz> |
| Hosted quiz | <https://sandy-colombia-bird-quiz.lovelyquail12.chatgpt.site> |
| Shared review workspace | <https://sandy-colombia-bird-quiz.lovelyquail12.chatgpt.site/review> |
| Project ID | Read `.openai/hosting.json`; currently `appgprj_6ade5e114ee881919dad878f0f62fb49`. Reuse it; do not create a replacement Site. |
| Backend source | `worker/index.mjs` |
| Generated deployment entrypoint | `dist/server/index.js` |
| Shared database | D1 binding `DB`, table `photo_reviews` |
| Runtime configuration | `REVIEW_OWNER_EMAIL`; secret `REVIEW_AGENT_KEY` |

Use `git status --short` and `git log -1 --oneline` to identify local changes and the source revision. Use Sites `get_site` and saved-version/deployment tools for current live revision, audience, and status; local HEAD is not proof of deployment. Never change audience as a workaround for a failed operation.

See [ARCHITECTIURE.md](ARCHITECTIURE.md) for boundaries, components, and future plans.

## Prerequisites and credential handling

See [SECURITY.md](SECURITY.md) for GitHub scans, pinned tools, local audit commands, and repository settings. Workflow changes do not deploy the site. Review CodeQL alerts as well as job conclusions; successful scanning does not mean no findings. Keep built-in secret scanning/push protection distinct from the post-push Gitleaks CI check.

- Node 24+ for ES-module tooling, `import.meta.dirname`, and SQLite-backed tests; Python 3 for the optional static preview. No npm installation is currently required.
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

No complete local Worker/D1 server command is maintained. `test-review.mjs` exercises the API against in-memory SQLite; it is a test, not a running development server. Do not expose a development server that accepts untrusted identity headers as production.

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
| Photo/audio unavailable | Inspect the asset URL/status and content type. Try another candidate or skip without scoring. A Cornell outage/403 cannot be repaired by redeploying unchanged Aviquiz code. |
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
