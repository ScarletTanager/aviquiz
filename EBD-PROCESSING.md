# Regional EBD processing

Initial implementation: November 20, 2026. Offline preparation only. No cloud
upload, processing Droplet, or production species-list import has run. Full local
preparation requires the separately authorized limits described below.

## Planned cloud storage and private networking

Retain the original EBD archives in private DigitalOcean Spaces Cold Storage.
Keep validated analytical facts, quiz-serving artifacts, manifests, taxonomy
profiles, and validation reports in Standard Storage (`aviquiz-data`). Geographic
observation/sampling partitions are temporary processing inputs, not retained
cloud datasets: do not upload them to Spaces. The owner prefers the cost of
repartitioning the original EBD when a rebuild is needed over paying to retain
duplicate data. Keep local partitions while jobs depend on them; remove them only
after validated outputs are safely retained and deletion is authorized. Local
originals must remain until cloud copies are verified and deletion is separately
authorized. This retention policy was clarified on November 22, 2026.

All Droplet-to-Spaces transfers must use DigitalOcean's internal network. Configure
the Droplet with its VPC-local DNS resolver as the exclusive resolver, including
any container or processing service that performs transfers. Select a compatible
Spaces region: DigitalOcean supports internal traffic within a region and across
datacenters in the NYC region group. Use the Spaces origin endpoint, not a CDN.

Before enabling transfers, verify the effective resolver, the actual bucket
hostname's DNS response, and the route selected for each resolved address from
the process's network environment. Treat public routing or an unverifiable path
as a failed preflight; do not silently fall back to a public transfer. These are
deployment requirements, not a claim that the current Droplet has been checked.

References: [VPC-local resolver](https://docs.digitalocean.com/products/networking/vpc/how-to/use-local-dns-resolver/)
and [Spaces private networking](https://docs.digitalocean.com/products/spaces/).

## Reading order and processing priorities

The original archives each contain one gzip-compressed text member. Reading
them is sequential; a state or country is not a separately seekable tar member.
Observation and sampling streams must be read independently, without assuming
that matching events, years, or countries are adjacent or in the same order.

`scripts/ebd-partition.py partition` reads each input once and writes compressed
regional projections: one partition per US state, and one per other country.
US records with no state (including the release’s `US-` placeholder) have a
residual `US` partition. The original state-code field remains unchanged. Rows outside the explicit
observation-year range are counted and excluded. This step does not filter taxa,
deduplicate outings, or calculate reporting rates.

After both complete input scans, `plan` produces a reorderable work list. The
default order is North Carolina, remaining US states alphabetically by name,
Colombia, then remaining countries alphabetically by name. The residual US
partition follows the named states in the US group. The first matching priority
rule wins; `*` automatically includes remaining partitions. For example:

```sh
python3 -B scripts/ebd-partition.py plan /private/processing/run/manifest.json \
  --priorities 'US-NC,US-*,CO,*'

# Change the queue without rereading either archive:
python3 -B scripts/ebd-partition.py plan /private/processing/run/manifest.json \
  --priorities 'CO,US-NC,US-*,*'
```

Priority changes the later aggregation/validation order, not which source rows
we can read first. A region is not considered complete just because its records
stopped appearing. Early regional availability would require an independently
complete paired regional download, or a previously prepared complete partition.

## Private projections and completion evidence

The manifest records source file identities, release and year selection,
projection/policy version, source and retained row counts, completion state,
and output sizes and SHA-256 hashes. Source identities use file size and mtime,
not full-archive cryptographic hashes. The release and pairing are operator
assertions, not inferred proof from filenames. Gzip inputs are consumed to EOF,
including trailer/checksum verification, before their completion flag is set.

Retained fields include event and shared-group IDs, dates, locality IDs/types,
administrative codes, effort/completeness, taxon identities, and approval status.
They exclude observer identities, comments, and exact coordinates. The files
remain **private intermediate data**, outside Git and web deployments; locality
IDs and checklist identifiers must not become a public downloadable catalog.

Only after both sources finish do `.partial.tsv.gz` files become `.tsv.gz` and
the manifest become `partitioned`. This means ready for aggregation and
validation, **not ready for serving**. `serving_ready` remains false. A source
read error, truncation, timeout, or output limit leaves an incomplete manifest
and a blocked work list. A crash during finalization still leaves the prior
incomplete manifest. Existing output directories are never reused.

## Bounded local operation

The current tool accepts plain `.txt`, `.gz`, or these uncompressed `.tar`
containers. It has no extra Python dependencies. Use an explicit year range;
do not mistake observation date for edit date or an incremental watermark.

For the existing small paired sample:

```sh
python3 -B scripts/ebd-partition.py partition \
  --sampling /path/to/ebd_sample_sampling.txt \
  --observations /path/to/ebd_sample.txt \
  --output /private/processing/new-sample-run \
  --release relMar-2025 --first-year 2025 --last-year 2025 \
  --max-output-mib 10 --max-seconds 60
```

Output must be outside the repository. The local output limit is 1–500 MiB,
defaulting to 500 MiB, with a manifest reserve and conservative compression
overhead accounting. At least the output budget plus 2 GiB free disk is required;
the reserve is rechecked periodically. At most eight output files are open, with up to 256 retained compression states,
1,024 region keys and a 1 MiB input-line buffer. Compression states survive file
closure so geographically interleaved records do not force a fresh gzip member
on every file reopen. Evicting a compression state finalizes its gzip member;
reopening that state appends a valid member without another TSV header.
The default cooperative deadline is 60 seconds. `--max-rows` is a per-source
diagnostic bound; hitting it labels the result incomplete. These are preparation
guards, not strict OS memory limits or cloud-job supervision.

These local limits deliberately do not authorize a worldwide production run.
The whole release would exceed the local output cap. A larger cloud workspace,
resource supervision, capacity budget, and storage lifecycle need separate
configuration and agreement. No extraction of the uncompressed worldwide text
is necessary. Interrupting a gzip scan does not create a midstream resume point;
restart a preparation attempt in a new directory and reread the source.

## Validation and next work

Run `python3 -B scripts/test-ebd-partition.py`. Synthetic inputs test reordered
source streams, geography routing, named priority changes, private-field
exclusion, gzip-in-tar, truncation, bounded prefixes, budgets, and clean restart.
When the local Cornell sample is available, the test also compares every ranked
aggregate field before/after projection: all 119 taxa match exactly. CI runs the
synthetic checks; its sample-dependent comparison is explicitly skipped.

The retained local sample run is at
`/Users/sandy/col_birding/outputs/ebd_partition/local-sample-2026-11-20/manifest.json`.
It completed both sources (317 sampling rows and 4,863 observation rows), producing
one Alabama partition. The two compressed projections total 141,210 bytes, plus
the small manifest. No worldwide rows were scanned in this run.

The next execution stage will validate matching event IDs/date/locality,
duplicate/conflicting shared groups (including boundaries between partitions),
effort policy, taxonomy rollup/crosswalk, and denominators. Regional daily facts
then replace their old versions atomically; validated compact seasonal catalogs
can be published separately. Country and state/county/hotspot rates must not be
constructed by blindly adding overlapping aggregates. The existing county-only
SQLite benchmark remains a correctness baseline, not a worldwide serving engine.

Unchanged partitions can be retained on a later release, but the tool does not
implement a deletion-aware delta feed or gzip checkpoint resume. See [EBD.md](EBD.md)
for reconciliation requirements and [EBD-BENCHMARK.md](EBD-BENCHMARK.md) for the
earlier sizing measurements. Bulk analytical data stays separate from AviQuiz's
production account/trip database and the small application Droplet.

## Supervised full local preparation

On November 20 Sandy authorized local processing provided the machine stays
responsive and free disk does not fall below 50 GiB. The separate full-run
supervisor `scripts/ebd-ingest.py` has stricter controls than the small direct
partitioner: two low-priority processes (nice increment 10), 256 MiB monitored
RSS per worker by default, an independent hard cap on compressed bytes emitted
by each writer, and a 60 GiB free-space stop threshold. Initial free space must
cover the complete chosen output cap plus that reserve. The maximum configured
output cap is 350 GiB, including a 4 MiB metadata reserve; sampling receives
1/14 and observations 13/14 of the compressed-data allowance. If a source exceeds
its allowance the whole run is incomplete rather than expanding automatically.

```sh
python3 -B scripts/ebd-ingest.py \
  --observations /Users/sandy/col_birding/ebd_relSep-2026.tar \
  --sampling /Users/sandy/col_birding/ebd_sampling_relSep-2026.tar \
  --output /Users/sandy/col_birding/outputs/ebd_ingestion/relSep2026-20261120 \
  --release relSep-2026 --output-gib 350 --reserve-free-gib 60 \
  --memory-mib 256 --max-hours 24
```

The supervisor checks disk and worker RSS every second and terminates the workers
on a limit, monitor failure, worker failure, or interruption. Each worker also
checks free disk and supervisor liveness every 2,000 rows. A 10 GiB disk margin
allows time to stop, but no process can prevent unrelated software from filling
the filesystem. Total ingestion worker RAM is bounded to 512 MiB monitored RSS,
plus the small supervisor and normal OS/process overhead; monitor limits can
transiently overshoot. Linux workers additionally have an address-space limit.
The parent remains alive for the run and does not depend on a browser session.
On macOS, run through `caffeinate -i` to prevent idle system sleep while it runs;
closing the lid or deliberately sleeping/shutting down the machine can interrupt
or pause processing.

This full preparation retains all valid source observation dates rather than
silently imposing a lookback window. Temporal selection, completed-season rules,
and cross-year handling belong in the later aggregation/serving policy. The two
files are **not** joined by row position. No uncompressed worldwide text is
created and neither original archive is modified or deleted.

`status.json` contains counts, archive progress, memory peaks and free disk;
`manifest.json` records the Git commit and script hashes, limits and provenance.
To stop deliberately, send SIGINT to the supervisor PID in the manifest. A stopped
run remains incomplete and is not resumable mid-gzip. Completed source projections
are kept private; only after both scans finish are files finalized and hashed and
the manifest marked `partitioned`. It still has `serving_ready: false`: this is
preparation, not production publication or validated species frequencies.

Tests: `scripts/test-ebd-ingest.py`, `scripts/test-ebd-local-sizing.py`, and
`scripts/test-ebd-partition.py`. The full supervisor test uses tiny fixtures but
retains the real 60 GiB reserve; CI explicitly skips that one test when free space
is insufficient. The other control, routing, privacy and incomplete-source checks
run with synthetic data.

## Completed September 2026 preparation

The full supervised local run finished November 20, 2026 at 9:19 p.m. Eastern,
using source commit `83dc6115734a3c095f8e209eb4b64a3197fbb334`. Both original
archives were read completely and their gzip checksums verified. Their file
size/mtime identities remained unchanged. The scan plus finalization took
304.41 minutes (about 5 hours 4 minutes).

| Measurement | Result |
| --- | ---: |
| Observation rows retained | 2,329,179,451 |
| Sampling-event rows retained | 176,598,863 |
| Regional partitions / compressed files | 304 / 608 |
| Compressed projected data | 116,797,606,110 bytes (108.78 GiB) |
| Minimum monitored free space | 411.46 GiB |
| Peak monitored sampling / observation worker RSS | 92.77 / 93.08 MiB |
| North Carolina observation / sampling rows | 35,141,068 / 2,545,248 |

The only validation adjustment was to recognize the release's country-only
`US-` state placeholder as the residual `US` partition. The successful run
retained all 43 sampling rows and 44 observation rows with that placeholder,
leaving the original state-code field unchanged. No rows were discarded and
none of those rows were assigned to a specific state. The earlier attempt
stopped on that unsupported placeholder; its partial outputs remain marked
incomplete and are excluded from the successful manifest. No further validation
failures occurred after the fix. Unexpected format, geography, date, missing-ID,
checksum, or resource failures still stop a run rather than silently dropping
records or publishing incomplete data.

The agent checked state hourly and watched for terminal errors. Both source
counts reconcile exactly to the sum of their regional partition counts. Every
output size matches its manifest, every file has a recorded SHA-256 hash, and
no `.partial.tsv.gz` files remain in the successful run. The residual-US outputs
were independently read back through gzip/CSV to verify their row counts and
preserved state codes. Full per-region join and taxonomy/effort validation
remain part of aggregation, not this preparation step.

Private artifacts (outside Git):
`/Users/sandy/col_birding/outputs/ebd_ingestion/relSep2026-20261120-r2/` contains
`manifest.json`, `verification.json`, `status.json`, and the two regional trees.
The queue begins with NC, followed by the remaining US states, Colombia and
other countries alphabetically. The manifest remains `serving_ready: false`;
no new quiz coverage was published. North Carolina aggregation and the Chatham County rarity validation are now
complete locally; see [EBD-NC.md](EBD-NC.md) for results and remaining serving work.
