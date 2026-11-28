# Adding geography data to AviQuiz

Run these commands from `sites/colombia-bird-quiz`. Python 3.10+ and Node 22+ are required; the collector uses its separately installed browser environment. Data paths below are outside Git. Processing, conversion, assembly, validation, and preparation are local operations. Only the photo collector contacts Cornell. None of these commands deploys the app.

## 1. Process a new geography

```sh
scripts/process-ebd start CO
scripts/process-ebd start US-NC
scripts/process-ebd status
scripts/process-ebd status CO
scripts/process-ebd stop CO
scripts/process-ebd start CO --resume
```

Use eBird country, state/province, county, or public hotspot IDs. A hotspot requires `--parent`, for example `start L651593 --parent US-NC`. The default inputs are the completed September 2026 partition manifest and `outputs/ebd_reference/taxonomy-2026.json`, relative to the workspace. Override with `--manifest` and `--taxonomy`. Original worldwide tarballs first need the existing partitioning workflow.

Jobs retain all source years in daily SQLite facts. The serving export defaults to 2017–2025; use `--first-year` and `--last-year` for a different historical reference. The format supports arbitrary-precision hexadecimal year masks. Date windows selected by a quiz taker are matched against the reference years, rather than interpreted as requests for observations in the future travel year.

At most two jobs per root run concurrently, with default 20 GiB/job, 768 MiB worker memory, 24 hours, and a 60 GiB free-space floor. Adjust `--disk-gib` or `--hours` as needed. Do not bypass the concurrency limit with multiple roots to start additional simultaneous jobs. A fresh root can preserve prior completed runs: `scripts/process-ebd --root ../../outputs/ebd_jobs_next start CO`.

Each geography has independent state and stage folders. Resume verifies completed extraction/aggregation and restarts an interrupted stage in a new folder. Unresolved taxonomy stops with a report rather than guessing. The private extracts and reconciliation files must not be published. Status's `completed.export.package` identifies the package directory.

## 2. Convert an existing validated daily database instead

This skips the expensive EBD extraction and aggregation. The report must match the database size, SHA-256, and geography. By default, years come from the database's actual effort range. Output must be a new directory.

Colombia can use the existing ZIP's **manifest only** as place metadata. The converter does not reuse its facts or species numbering:

```sh
scripts/process-ebd convert CO \
  --database ../../outputs/ebd_aggregation/co-20261122T070336/daily.sqlite \
  --report ../../outputs/ebd_aggregation/co-20261122T070336/analysis-report.json \
  --places ../../outputs/ebd_aggregation/co-20261122T070336/quiz-export/colombia-quiz.zip \
  --output ../../outputs/ebd_common/co-converted-next
```

NC can use the cached node list and an explicit reference range:

```sh
scripts/process-ebd convert US-NC \
  --database ../../outputs/ebd_aggregation/nc-20261121-r2/daily.sqlite \
  --report ../../outputs/ebd_aggregation/nc-20261121-r2/analysis-report.json \
  --places dist/nc-locations.json \
  --first-year 2017 --last-year 2025 \
  --output ../../outputs/ebd_common/nc-converted-next
```

`--places` accepts `{nodes:[...]}`, `{place_names:{...}}`, a map by place ID, or legacy department summaries. A place without cached naming metadata retains its public ID as the label. Use the ZIP manifest or complete nodes for correct hotspot parent relationships.

## 3. Collect photo metadata using the shared queue

Processing and conversion enqueue species into `../../outputs/photo_metadata/queue.sqlite`. `--photo-db` can override this. Species already collected for another geography retain their photos and quarter job state. Seeding does not reset blocked/no-results/review quarter jobs or their challenge history. The target is two dated photos per quarter per species.

```sh
scripts/collect-photos start --manual-verification
scripts/collect-photos status
scripts/collect-photos stop
```

The wrapper defaults to the same queue and `../../outputs/photo_metadata/seasonal/` output. Use one collector at a time to share Cornell pacing and challenge controls. Manual verification permits a human to complete a challenge; collection never solves it automatically. Stop/start without manual verification preserves the backoff. A manual restart permits one recovery visit while retaining the minimum request interval and clears its access block only after validating catalog access.

## 4. Assemble a new photo revision

Use a new output directory and substitute the package path from processing/conversion. Assembly reads a consistent snapshot of the shared queue and never writes to it. Additional existing catalogs can contribute public Cornell references; scientific identities must match. Credits are required. This step updates species metadata and coverage without rebuilding the daily facts or changing the chunk bytes.

```sh
scripts/process-ebd assemble ../../outputs/ebd_common/co-converted-next/serving \
  --catalog dist/data.json --catalog dist/nc-birds.json \
  --output ../../outputs/ebd_common/co-photos-next
scripts/process-ebd assemble ../../outputs/ebd_common/nc-converted-next/serving \
  --catalog dist/nc-birds.json --catalog dist/data.json \
  --output ../../outputs/ebd_common/nc-photos-next
scripts/process-ebd validate ../../outputs/ebd_common/co-photos-next
```

Both geographies use `aviquiz-seasonal-package-v1`: `package.json` identifies immutable files and revision hashes; `manifest.json` indexes gzip records within chunk files; `places.json` contains the navigation nodes; `species.json` establishes bird indices and credited photo references. Assembly adds `photo-coverage.json`. Validation checks file/revision hashes, record bounds/digests, decompressed sizes, year masks, species indices, place coverage, photo references, and detections against effort masks.

## 5. Prepare application integration locally

Supply the full set of packages to register; this replaces the generated registry, so include both NC and Colombia. It validates packages, copies chunks to content-addressed local objects, and atomically writes public metadata to `worker/seasonal-packages.json`. No binary facts, raw EBD, private identifiers, or collector database go into Git.

```sh
AVIQUIZ_PYTHON=python3.13 node scripts/prepare-seasonal.mjs \
  --package ../../outputs/ebd_common/nc-photos-next \
  --package ../../outputs/ebd_common/co-photos-next \
  --objects ../../outputs/ebd_common/objects
node scripts/build-worker.mjs
```

The application uses `/api/geography/quiz` for every common-format geography. Its shared reader selects the package/place, reads a bounded range through `EBD_BUCKET`, verifies the compressed digest, and decodes hexadecimal masks with `BigInt`. It supports family filters, leap days, and cross-year windows. Photos matching the travel quarters are preferred; other dates are allowed when matching coverage is unavailable. Species without photos appear in coverage lists but cannot become photo questions. The original Colombia practice itinerary remains available.

For a standalone local app, set `EBD_DATA_DIR` to the prepared objects directory alongside the existing local database/auth configuration. PostgreSQL or SQLite application storage does not alter the serving format. Geography browsing uses existing cached/API metadata plus package nodes. Browsing a place without serving coverage can still use the explicitly labeled pilot fallback where supported.

`activate PACKAGE --target DIR` additionally creates a validated local copy and atomic `active.json` pointer. It is a local inventory operation: the app currently uses the committed/compiled registry, not live pointer changes. Use preparation and rebuild to change the app's active package revisions. Keep prior packages to prepare a rollback.

## 6. Commit and verify before deployment

Commit the source and generated public registry, run the shared-reader, launcher, and package tests, and push to `dev`. Binary objects stay outside Git. Staging deployment requires separate authorization. A future Sites upload uses `/api/geography/import?sha=...`, accepting only the exact sizes/hashes compiled into the registry. Standalone production packaging reads `EBD_COMMON_OBJECTS_DIR` (default `../../outputs/ebd_common/objects`) and includes verified objects for its filesystem adapter. It retains the existing NC legacy adapter for compatibility.

Checks available locally:

```sh
python3.13 -B scripts/test-seasonal-package.py
node scripts/build-worker.mjs
node test-seasonal.mjs
node test-geography.mjs
AVIQUIZ_PYTHON=python3.13 node scripts/test-seasonal-daily.mjs
```

The daily comparison check uses the existing private NC and Colombia analytical databases. No eBird, Macaulay, AWS, or DigitalOcean calls are made. Geography quizzes continue to exclude responses from saved statistics.

### Launcher activation and collection counts

After the generated common package registry is included in a deployment,
`/api/geography/catalog` derives collection counts from all installed packages:
unique species IDs (including species without photos), represented first-level
subregions (US states or national equivalents such as Colombian departments),
and unique processed hotspot/site IDs. Cached directory entries alone do not
count. A first-level subregion with processed descendants counts even if it lacks
its own aggregate. Counties and country roots are not extra first-level regions.

`/api/geography` marks each directory entry with `supported` for navigation and
`quizSupported` for its own processed species list. The launcher disables and
grays out entries without coverage or covered descendants. Installing a new
package automatically enables its locations and ancestor path; there is no
separate country/continent allowlist to edit. A country may be navigable to reach
a supported state without offering a whole-country quiz. Upload the referenced
objects as part of the same staged release so enabled locations can serve data.
Run `node test-collection.mjs` in addition to the checks above.

The launcher selects recurring months and days, not travel years. Earlier end
dates span New Year; February 29 remains available. Internal reference years
serialize this calendar window for the existing shared reader and are not shown
in the date controls or quiz titles. The legacy itinerary/trip editor still has
real visit dates and remains independent.

## 7. External serving objects and Spaces preload

Processing packages remain `aviquiz-seasonal-package-v1`. Preparation now produces
`aviquiz-serving-release-v1`: a thin committed manifest and external, immutable
navigation/species/photo objects as well as the existing fact chunks. Both NC and
Colombia follow this path, as will every new geography. See
[the format specification](serving-format.md) for schemas, byte/hash rules, limits,
sharing, storage adapters and version compatibility.

After `prepare-seasonal.mjs`, verify all objects without network access:

```sh
node scripts/verify-seasonal.mjs worker/seasonal-packages.json \
  ../../outputs/ebd_common/objects
node test-serving-release.mjs
node test-ebd-spaces.mjs
node test-seasonal.mjs
```

Pass `--registry PATH` to preparation to write a candidate manifest elsewhere;
this does not activate it. Always supply the complete desired set of packages.
For example, prepare NC, Colombia and ten additional assembled countries together;
shared identical species records are stored once. Upstream processing jobs can
continue filling the same species-aware photo queue before one collection pass.
Queue/collector inputs remain the processing catalogs, not the compressed serving
shards. Do not pass `worker/seasonal-packages.json` to the photo collector as a
species catalog. Assembly then preparation incorporates new photo metadata.

An authorized operator can preload the immutable release into Spaces using these
nonsecret settings; the secret stays in its protected file:

```sh
EBD_STORAGE=spaces \
SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com \
SPACES_BUCKET=aviquiz-data \
SPACES_ACCESS_KEY_ID='<Spaces access key ID>' \
SPACES_SECRET_KEY_FILE='/protected/path/spaces-secret' \
SPACES_REQUIRE_PRIVATE=true \
node scripts/upload-seasonal.mjs \
  --registry /path/to/seasonal-packages.json \
  --objects /path/to/objects \
  --receipt /path/to/new-upload-receipt.json
```

Run this from the Droplet for VPC-private transfer. It checks the manifest revision
and all local bytes before writing, uploads missing objects with private access,
then reads back and verifies every selected object. Existing hashes are verified,
not overwritten; upload interruption can be resumed with the same manifest and a
new receipt path. The CLI never updates an active pointer, deploys code, deletes
objects, or uploads original/derived EBD archives. An upload receipt's complete
verified set is required before promoting its manifest. Do not alter a validated
manifest by hand: regenerate it from processing packages.

For local development keep `EBD_STORAGE=files` and point `EBD_DATA_DIR` at the object
directory. Production can select `spaces` while staging keeps `EBD_BUCKET` bound to
R2; the byte format and reader are identical. The production packager retains a
verified filesystem mirror for rollback/local deployment, including all metadata
objects, not just chunks. Staging imports must likewise enumerate **all** objects
using `servingObjects()` rather than only `packages[].index.chunks`. See
[DEPLOYMENT.md](../DEPLOYMENT.md) for the initial R2 preload limitation and approval
boundary. No storage configuration change deploys the new app automatically.

For a migration, compare the new reader with a retained pre-migration API receipt:

```sh
node scripts/test-serving-parity.mjs /path/to/frozen-expected-api.json
AVIQUIZ_PYTHON=python3.13 node scripts/test-seasonal-daily.mjs
```

CI tests generate tiny synthetic packages when private object files are unavailable;
local checks with the real files continue exercising NC and Colombia. Python CLI
integration also tests export -> serving preparation -> object verification when
`node` is installed (or `AVIQUIZ_NODE` names its executable). It verifies that the
shared photo queue preserves already collected coverage across geographies.

When retaining the older `/api/nc/*` endpoint, supply
`--legacy-dir ../../outputs/ebd_serving/nc-20261121` to the upload command too. It
verifies/uploads the four pinned legacy NC objects as well; it does not regenerate
or substitute them for the common-format NC package. A Spaces-only production
archive requires a receipt covering both sets. Set
`EBD_PACKAGE_STORAGE=spaces EBD_UPLOAD_RECEIPT=/path/to/receipt.json` when running
`package-do.mjs` to omit the filesystem object mirror. The default `files` mode
continues to include all objects. Runtime `EBD_STORAGE` must match the chosen mode;
a Spaces-only archive cannot serve through the filesystem adapter.

The frozen API parity check also accepts `EBD_STORAGE=spaces` and the same
`SPACES_*` settings. Run it on the Droplet to exercise the real private range-read
adapter against a pre-migration receipt, then close the client. This validates quiz
behavior over Spaces without changing the active application or involving its
relational database.
