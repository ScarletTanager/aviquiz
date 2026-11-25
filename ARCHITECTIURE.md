# AviQuiz architecture

Status: current implementation, updated November 18, 2026; standalone PostgreSQL/SQLite adapters are locally tested and not yet deployed. Proposed capabilities are identified separately below. This file retains the filename requested for the architecture document.

## System context

### Personal statistics MVP on dev (not deployed)

`worker/statistics-api.mjs` binds cumulative statistics to the verified application
user ID through the existing SQLite/D1/PostgreSQL adapters. Two tables store the
preference and one aggregate document per user. Completed practice contributes
species/site counters and overwrites latest comparison results; no quiz archive
is retained. Small session cursors provide retry safety, while revision guards
serialize concurrent additions. Browser consent and optional account persistence
are independent. A bounded five-quiz contribution window provides local aggregate
statistics, with a protected one-time legacy migration path. See
[STATISTICS.md](STATISTICS.md) for data retention, exclusions, import and deployment.

### Common geography integration on dev (November 25, 2026; not deployed)

The geography launcher and quiz sessions share `/api/geography/quiz` for NC and
Colombia. `worker/seasonal-api.mjs` reads the committed public package registry,
verifies bounded compressed records through `EBD_BUCKET`, and uses
`dist/seasonal-core.mjs` for arbitrary-precision historical year masks. Sites supplies
the bucket in staging; the standalone filesystem adapter supplies it on Node.
The generated registry contains public navigation, species/photo metadata and
hashes. Binary facts and private analytical databases remain outside Git.

Conversion verifies the existing daily database against its report. Photo assembly
reads the shared collector database without changing its queue, creates a new
photo revision, and preserves immutable seasonal chunks. Preparation compiles
the package metadata and copies content-addressed objects locally. Package selection
is frozen in the committed registry; local `active.json` pointers alone do not change
a running app. The original itinerary and old NC API retain their existing behavior.

See [the CLI workflow](docs/ebd-geography-cli.md) for conversion, photo assembly,
validation, preparation, and separate staging/production publication steps.

AviQuiz provides photo and vocalization identification quizzes from a prepared Colombia trip checklist. Visitors select sites, families, lifer filters, question counts, and regular or mistake-review practice. Experimental photo guidance combines paraphrased eBird/Merlin descriptions with manually checked arrows on specific Macaulay Library photographs.

The deployed application is a browser application plus a small HTTP Worker and a shared database. Quiz selection, answer matching, statistics, and personal annotation-review marks run in the browser. The backend serves application assets and manages shared annotation drafts and published snapshots. Media streams directly from Cornell; the backend does not proxy or store it.

Current hosted site: <https://sandy-colombia-bird-quiz.scarlet-tanager.chatgpt.site>

Source repository: <https://github.com/ScarletTanager/aviquiz>

The current Sites audience controls entry to the hosted site. Application-level guest use means no separate AviQuiz account; it does not bypass that staging/hosting access policy. Permanent anonymous access to ordinary quizzes is a product requirement for future public production hosting.

## Page structure

The landing page at `/` introduces AviQuiz and the current collection. Quiz configuration, sessions, and results live at `/quiz`; accuracy summaries and linked species lists live at `/statistics`. The shared review workspace remains at `/review`. The Worker serves the same application shell for `/quiz` and `/statistics` (including trailing slashes); browser History API navigation switches views without resetting quiz settings. Species drilldowns retain their `#species/...` links, including older bookmarks. All pages share the existing origin and unchanged browser-storage keys, so rebranding does not migrate learning history.

## Component interaction diagram

Solid connections represent runtime or build dependencies. The data preparation path is offline; it is not run by a visitor request.

```mermaid
flowchart TB
    visitor[Visitor browser]
    reviewer[Owner review browser]
    platform[Sites access and identity boundary]
    worker[Worker HTTP router and review API]
    assets[Embedded HTML, CSS, ES modules and catalogs]
    db[(D1: photo_reviews)]
    storage[(Per-origin browser localStorage)]
    cornell[Cornell / Macaulay media CDN]
    source[eBird / Merlin source accounts]
    agent[Authorized review batch client]
    prep[Offline Python data preparation]
    inputs[Checklist, life lists, taxonomy and public media metadata]
    repo[Git source: dist, worker, scripts, migrations]
    build[Node Worker build and Sites packaging]

    visitor -->|HTML, modules, catalogs, approved tips| platform
    reviewer -->|Review UI and protected API requests| platform
    agent -->|Site service access plus review agent key| platform
    platform -->|HTTP requests; trusted visitor identity when signed in| worker
    worker --> assets
    worker -->|Annotation reads and revision-guarded writes| db
    visitor -->|Quiz history and personal review marks| storage
    visitor -->|Images and audio directly| cornell
    reviewer -->|Original images| cornell
    visitor -->|Attribution / study links| source
    reviewer -->|Source verification| source
    inputs --> prep
    prep -->|Prepared JSON and CSV| repo
    repo --> build
    build -->|Versioned Worker deployment| worker
```

## Component inventory and technology choices

| Component | Source / technology | Responsibility and reason |
| --- | --- | --- |
| Quiz shell and presentation | `dist/index.html`, `dist/style.css`; HTML/CSS | Responsive setup, quiz, statistics, results, and annotation views without a UI framework. |
| Browser orchestration | `dist/app.mjs`; JavaScript ES modules | Loads catalogs and shared tips; coordinates filters, media events, sessions, and views. |
| Selection and grading | `dist/quiz.mjs` | Pure selection and common/scientific-name matching, including punctuation normalization and limited, unambiguous typo tolerance. |
| Progress and statistics | `dist/progress.mjs`, `dist/statistics.mjs`; localStorage | Separate photo/audio rolling histories and weighted summaries without requiring an AviQuiz account or backend personal-data storage. |
| Personal annotation review | `dist/annotation-review.mjs` | Tracks explicitly reviewed photo IDs separately from shared publication and quiz accuracy. |
| Audio selection | `dist/audio.mjs`, `dist/audio.json` | Ranks saved Macaulay records by geographic preference. A local catalog makes behavior repeatable and avoids an archive search on every quiz. |
| Photo guidance | `dist/id-tips.mjs`; generated SVG | Combines shared annotations with species text and built-in fallback guidance. Normalized coordinates and uncropped images retain landmark placement across display sizes; labels sit outside the image. |
| Shared review UI | `dist/review.html`, `dist/review-app.mjs`, `dist/review.css` | Owner editing, preview, approval, withdrawal, export, and breadth-first queue. |
| Review validation | `dist/review-core.mjs` | Shared browser/server validation and coverage rules reduce inconsistent approval behavior. |
| HTTP backend | `worker/index.mjs`; Worker ESM, Web Request/Response APIs | Serves embedded assets and a small JSON API without a long-running application server. |
| Shared persistence | D1 binding `DB`; SQLite-compatible SQL | Stores annotation documents, published snapshots, and revision numbers. Transactional statement guards prevent stale edits and competing approvals from violating review rounds. |
| Build | `scripts/build-worker.mjs`; Node.js | Embeds authored assets and shared validation into generated `dist/server/index.js`. The generated bundle is ignored by Git. |
| Deployment | Sites tools/helper and `.openai/hosting.json` | Packages a pushed source revision, deploys a saved version, provisions the declared database migration, and preserves the site's access policy. |
| Offline preparation | `prepare_data.py`, `finalize_photos.py`, `scripts/prepare-audio-catalog.py`; Python, `openpyxl` for workbook parsing | Converts source documents and public metadata into runtime catalogs. These tools are not required for an ordinary code deployment. |
| Batch annotation maintenance | `scripts/review-agent.mjs`; Node.js | Sequential, revision-aware shared-data updates without a code deployment. It does not itself inspect or approve the accuracy of images. |

`dist/` is primarily authored source despite its name. Only its generated `server/` and `.openai/` subdirectories are ignored build output. There is currently no package-manager build/install step. Node 24+ is used for tooling/tests, including `node:sqlite` in backend tests; it is not the browser or deployed Worker runtime.

## Data inventory and ownership

| Data | Location | Durability / scope |
| --- | --- | --- |
| Prepared species, taxonomy, site X flags, photos, and lifer booleans | Versioned `dist/data.json` | Shared, deployed with source. Lifer flags currently reflect the original user's export, not a visitor's own life list. |
| Audio IDs, credits, localities, and provenance | Versioned `dist/audio.json` | Shared, deployed with source; incomplete catalog. |
| Trip lifer comparison | Versioned `dist/trip_lifer_comparison.csv` | Downloadable prepared output. |
| Original workbook and personal observation inputs | Parent workspace, outside the app's runtime assets | Not sent to visitors or bundled into the Worker. Preparation currently depends on local files, including temporary taxonomy input. |
| Photo/audio binaries | Cornell infrastructure | External availability; no bundled or backend-hosted media copies. |
| Shared annotation drafts and approved snapshots | D1 `photo_reviews` | Cross-device shared content, independent of Git and application deployments. |
| Visual attempts | localStorage `colombia-field-quiz:progress:v1` | This browser profile and origin only. |
| Audio attempts | localStorage `colombia-field-quiz:audio-progress:v1` | Independent from visual attempts. |
| Personal annotation-review marks | localStorage `colombia-field-quiz:annotation-review:v1` | Photo IDs marked by the visitor; no cross-device sync and no revision-based reset. |

The original catalog has 849 species and 13 named sites, with four photo records per species. Audio initially covers 188 species with 674 recordings. The last verified annotation batch on October 31, 2026 brought published coverage to 126 photos across 123 species. These are dated baselines, not constants; query the live API for current review coverage.

Browser storage is not identity or an authorization boundary. Clearing site data, changing browser profiles, or moving the site to another origin does not transfer these histories. A separate memory fallback allows practice when browser storage fails, but it does not provide durable recovery.

## Important runtime flows

### Quiz and statistics

The browser fetches checklist/audio catalogs, selects eligible media, and streams the chosen asset directly from Cornell. Audio requires playback before an answer can be scored. It prefers named site-area records, then department, Colombia, neighboring countries, and broader fallbacks within the saved catalog. Site subspecies and recording elevation matches are not verified.

Each medium retains the last 20 scored attempts per species. Mistake review includes species with a strictly greater than 25% miss rate. Statistics divide retained correct attempts by retained scored attempts, rather than averaging species percentages. A site's X-marked species can contribute answers made in other quiz scopes. Reveals are misses; unavailable/unclear media skips do not count.

The optional Site-only quizzes view uses separately recorded per-site/per-species windows within each medium's existing progress object (`siteSpecies`). Only quizzes scoped to that exact site with All families selected qualify, including site-scoped mistake reviews. Both views are tracked independent of the display switch; family summaries and mistake-review eligibility remain general. Old records lack scope and cannot be attributed retrospectively. `dist/site-clue.mjs` supplies an independent optional checklist-site clue for family/all-sites questions: the browser chooses one valid site per question, retains it through toggles/media retries, and keeps the off-by-default visibility preference for the page visit. This does not assert media locality or change selection/scoring.

All sessions with experimental ID tips enabled bypass progress writes, including correct answers and species without tips. Personal annotation review likewise never affects learning statistics. Earlier saved attempts cannot be retrospectively separated into experimental and normal sessions.

### Annotation publication and personal review

At startup and before a new photo quiz, the browser requests approved snapshots from `/api/annotations`. Normal experimental quizzes show guidance after a wrong/revealed answer. Exact approved photographs get arrows; other photographs of covered species get general text with visibility caveats. The dedicated personal-review mode shows the species and annotations directly and filters out explicitly marked photo IDs.

An owner or authorized batch client saves a draft or approves a document. Draft edits preserve the last published snapshot. Approval replaces it; `unpublish` removes it. Each successful save increments a revision. Stale requests return 409. New-photo approvals obey a global breadth-first round; revising an already approved photo remains possible.

`photo_reviews` stores `photo_id`, `species_id`, `status`, `revision`, `document_json`, `approved_json`, and `updated_at`. This is current state plus one published snapshot, not a full audit/version history. Published API responses exclude private notes and source/photo-check flags.

### HTTP surface

| Route | Current purpose / access |
| --- | --- |
| `/`, static asset paths | Quiz and authored assets, subject to hosting access policy. |
| `/review` | Review application shell; the shell itself does not grant API permissions. |
| `GET /api/annotations` | Published annotation snapshots and coverage, subject to hosting policy. |
| `GET /api/reviews` | Drafts, published state, revisions, and coverage; owner or review agent only. |
| `POST /api/reviews/save` | `draft`, `approve`, `skip`, or `unpublish`; owner or review agent only. |
| `POST /api/reviews/seed` | Idempotent original six-photo import; maintenance only. |

## Security boundaries

Sites supplies the current hosting access boundary and trusted visitor identity headers. The Worker allows review editing for the configured owner identity/email or the review agent key. These headers are trusted only behind the hosting boundary; running this Worker on a new provider requires replacing or reproducing that trust boundary before exposing protected APIs.

The owner's current ID is in `worker/index.mjs`; `REVIEW_OWNER_EMAIL` handles the platform's site-scoped identity case. `REVIEW_AGENT_KEY` is a runtime secret. Its ignored local counterpart `.review-agent.json` is used by the batch client. Unattended hosted requests also use the platform service credential. Platform access does not itself give a caller a visitor identity or application editing privileges.

Server checks include JSON payload validation, same-origin checks when an Origin header is supplied, revision checks, and approval guards. This is a narrow owner/agent model, not the proposed general AAA system. There is no AviQuiz password store, customer signup, per-user feature authorization, general admin console, comprehensive audit trail, or Turnstile integration today. Experimental UI options are not currently restricted by per-user grants.

## Availability and operational limits

The application depends on Sites dispatch, the deployed Worker, D1 for shared tips/reviews, and Cornell for playable media. A database/API failure can leave ordinary quiz functionality available using already loaded or built-in photo guidance. An audio-catalog load failure disables audio while retaining photo practice. Unavailable external media has retry/skip paths.

There is no application health endpoint, background job, scheduler, queue, full local Worker/D1 development launcher, implemented maintenance switch, or application-managed shutdown endpoint. The Worker is request-driven. Provider monitoring, database recovery, and access controls must be operated through supported provider facilities; the repository does not configure alerting or automated backups.

See [RUNBOOK.md](RUNBOOK.md) for deployment, verification, backups, and incident diagnosis. Existing feature details remain in [README.md](README.md), [AUDIO.md](AUDIO.md), and [REVIEW.md](REVIEW.md).

## Dormant account foundation

Server-only `worker/identity.mjs`, `worker/permissions.mjs`, and `worker/accounts.mjs` now provide identity mapping, global and per-route authorization, private route shells/sharing, and transactional audit records. `schema/identity-routes.sql` is staged outside active migrations; `test-accounts.mjs` validates it in isolated SQLite. These modules are not imported by the deployed Worker and do not alter the runtime diagram, owner/agent authorization, or guest quizzes. They are a foundation, not activated AAA or route features. See [AAA.md](AAA.md) for boundaries, permissions, implemented methods, and activation requirements.

## Planned evolution, not activated

- Permanent guest quizzes, with independent managed AviQuiz authentication for account-backed capabilities. Provider selection and hosting compatibility remain undecided; production may use Azure or another host.
- Immutable internal user IDs linked to verified provider identities; no application password storage. Global grants for administration, experimentation, and annotation editing/publication.
- Seasonal species evidence for future routes: see [EBD.md](EBD.md) for archive findings, the local aggregate schema and query, and refresh limits. This is not deployed.
- Server-owned routes: ordered sites and optional dates, private/public visibility, owner-only deletion except explicit administrator intervention, invited viewers, contributors, and optional editors. Per-route permissions must be checked server-side.
- Account-backed history and personal review marks with explicit, deduplicated import of local history. Staging and production identity/data must be isolated.
- Versioned eBird bulk-data ingestion and derived seasonal/geographic species lists. This requires an ingestion/storage design and confirmation of permitted use, including commercial-guide use, attribution, redistribution, and sensitive-species handling.
- Audit events, stronger privileged-user authentication, and optional later Turnstile integration.

The current SQL binding and Sites identity integration are provider-specific. A hosting migration is more than moving static files: port the Worker/API, storage access and migrations, secrets, identity verification, data, and operating procedures; verify public guest access separately.


### Cognito-backed application accounts

The optional browser OIDC session now enrolls through the Worker account API.
The Worker verifies identity assertions with jose against the fixed Cognito
issuer, audience and public signing keys, then maps issuer/subject to a D1
AviQuiz user UUID. D1 stores current grants, not credentials or tokens. A
Sites-owner plus verified Cognito-email check permits one-time audited admin
bootstrap. This hosting-specific bootstrap must be removed on migration.
The esbuild development dependency bundles jose into the Worker. Public quizzes
and browser-local statistics retain their existing behavior. `users.invite` is
a reserved granular capability; delegated invitation UI and provider-side user
creation are future work. See AAA.md for security boundaries and RUNBOOK.md for
bootstrap diagnosis.

### Configurable database adapters (production and staging)

The application resolves a small runtime-neutral database interface through
`worker/database.mjs`. Sites defaults to its existing D1 binding. The Node-only
`server/database/index.mjs` startup factory supports explicit standalone SQLite
or PostgreSQL selection; PostgreSQL connections use the maintained `pg` driver
with a bounded pool and verified TLS. Node imports and connection configuration
are excluded from the Cloudflare Worker bundle. Native PostgreSQL migrations
are separate from the existing immutable SQLite/D1 migration history.

```mermaid
flowchart LR
    sites[Sites deployment] --> d1[D1 platform binding]
    startup[Standalone Node startup] --> config[DB_DRIVER configuration]
    config --> sqlite[SQLite file adapter]
    config --> pg[PostgreSQL pooled adapter]
    api[Account and review controllers] --> contract[Shared database contract]
    contract --> d1
    contract --> sqlite
    contract --> pg
```

PostgreSQL transaction batches keep mutations and audit events on one connection.
A transaction-scoped review lock preserves breadth-first approval invariants
across concurrent writers. Standalone environments reject Sites owner headers
and the Sites-only bootstrap mechanism. This wiring was verified against local
SQLite and real PostgreSQL 17 and 18. DigitalOcean production now runs Node
24.22.3 behind Caddy with managed PostgreSQL 18.7; Sites staging retains D1 and
its existing access gate. See DATABASES.md and DO-PRODUCTION.md for configuration,
migration boundaries and deployment details. Bulk eBird processing
remains a separate offline workload, not part of this application database.

### DigitalOcean runtime (November 19, 2026)

```mermaid
flowchart LR
    guest[Guest or signed-in browser] -->|HTTPS aviquiz.org| caddy[Caddy TLS and reverse proxy]
    caddy -->|Loopback HTTP| node[Node 24 HTTP adapter]
    node --> worker[Bundled Worker application]
    worker --> db[Shared database interface]
    db -->|Verified TLS over VPC| pg[Managed PostgreSQL 18]
    browser[Signed-in browser] --> auth[Existing Cognito pool/client]
    worker -->|JWT public-key verification| auth
    staging[ChatGPT access gate and Sites Worker] --> d1[Separate staging D1]
```

The Node adapter provides canonical-origin routing, bounded requests, health
checks, graceful shutdown, and public environment-specific authentication
configuration. It strips hosting identity headers before reaching the Worker.
Caddy terminates and renews TLS; systemd runs the app as a restricted service
account. PostgreSQL uses a five-connection pool with a separate migration role.
These choices keep the small host focused on request serving and permit SQLite
for local development without maintaining a second application implementation.

Production preserves the existing account UUID/identity mapping, administrator
grant, audit/bootstrap history, and 126 reviews. Staging remains an independent
copy. The existing managed identity pool and client serve both callback origins
for now; a separate staging pool can be reconsidered as the user base grows.
Statistics remain browser-local and need export/import across origins. Production
guest quizzes are publicly accessible; review data/mutations require granular
application permissions. No AWS management credentials are required by the app.

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
