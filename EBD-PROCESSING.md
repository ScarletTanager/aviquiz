# Regional EBD processing

Initial implementation: November 20, 2026. Offline preparation only. No worldwide
scan, cloud upload, processing server, or production species-list import has run.

## Reading order and processing priorities

The original archives each contain one gzip-compressed text member. Reading
them is sequential; a state or country is not a separately seekable tar member.
Observation and sampling streams must be read independently, without assuming
that matching events, years, or countries are adjacent or in the same order.

`scripts/ebd-partition.py partition` reads each input once and writes compressed
regional projections: one partition per US state, and one per other country.
US records with no state have a residual `US` partition. Rows outside the explicit
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
the reserve is rechecked periodically. At most eight gzip writers are open,
with at most 1,024 region keys and a 1 MiB input-line buffer. Reopening a regional
writer appends a valid concatenated gzip member, without another TSV header.
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
