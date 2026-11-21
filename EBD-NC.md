# North Carolina daily aggregation

Local analytical work only. This does not deploy code, contact AWS, change the
production database, or publish a new quiz species list.

`scripts/ebd-aggregate-region.py` consumes a completed partition manifest and a
source-native taxon profile tied to the observation file's SHA-256 and row count.
The NC input contains 2,545,248 sampling rows and 35,141,068 observation rows.

## Policy

- Complete stationary/traveling submissions (`P21`/`P22`) provide eligible effort.
  No additional duration/distance cutoff is imposed in this first policy.
- Shared submissions become one outing. A disagreement in date, locality,
  county or locality type excludes the whole outing from numerator and denominator.
  Other regional sampling files are checked for conflicting shared groups and
  duplicate event IDs involving NC, not merely ignored at the state boundary.
- Every observation must join its sampling record and agree on geography/date.
  Missing matches or mismatches prevent promotion. Sample audit references stay
  in a separate private staging database; no observer identities are retained.
- Approved positive species detections (`X` or positive integer) are counted once
  per outing/species. Explicit zero counts are not detections. Non-approved rows,
  ambiguous taxa, domestics and ineligible submissions are counted in the report
  as exclusions, not silently removed as data-format failures.
- Species, identifiable subspecific groups, intergrades and recognizable forms
  roll up only to a unique species with the exact source scientific name. This
  follows the normalized scientific-name approach in Cornell's
  [auk rollup](https://cornelllabofornithology.github.io/auk/reference/auk_rollup.html)
  and [implementation](https://github.com/CornellLabofOrnithology/auk/blob/main/R/auk-rollup.R).
  Unresolved identifiable taxa block the run until their parent is established.
  NC's Eurasian Whimbrel parent was verified in the same release's GB partition;
  no newer taxonomy or guessed binomial is substituted.

The reconciliation tables contain event IDs and group IDs and remain private.
The output daily database contains only release/taxon/place metadata, daily
eligible outing totals, and daily species detections. It retains neither event
identifiers nor personal locations. Private sampling sites contribute to their
state/county but do not become public hotspot entries. Unassigned county codes
contribute to the state (and a public hotspot if explicitly marked `H`), without
being invented as counties.

## Aggregates and reporting

Each eligible independent outing contributes directly to NC and its assigned
county, and to its locality only when explicitly a public hotspot. These are
separate views of the same evidence; their totals must not be added together.
Daily facts retain all source years. Reference windows use completed years
2017–2025, excluding partial 2026, and report raw frequency, mean daily frequency,
reporting/sampled seasons and days, and recurrence tiers. Chatham comparisons
cover September 20–October 10 and September 27–30; Jordan Lake dam (`L651593`)
uses the wider window. Records from only one sampled season remain visible in
the separate single-season tier; rates are reporting evidence, not encounter
probabilities. Complete zero-detection outings remain in the denominator and
are reported separately for quality review.

The former Chatham pilot counted only species-level rows and validated local
shared groups. Its Kirtland's Warbler result was 107/2,411 outings, 4.44% raw,
1.44% day-balanced, one reporting season. New rollups and checks beyond the
county/state boundary can legitimately change species rankings or effort;
differences must be explained rather than forcing the old result to match.

## Run and safeguards

```sh
python3 -B scripts/ebd-aggregate-region.py \
  --manifest /Users/sandy/col_birding/outputs/ebd_ingestion/relSep2026-20261120-r2/manifest.json \
  --taxonomy-profile /Users/sandy/col_birding/outputs/ebd_nc_taxa_profile.json \
  --output /Users/sandy/col_birding/outputs/ebd_aggregation/nc-20261121 \
  --region US-NC --disk-gib 40 --memory-mib 768 --hours 12
```

Use a new directory outside Git and the immutable input partitions. The worker
runs at reduced priority, with SQLite page limits, a private disk-spill directory,
SQLite heap limits, a supervised RSS limit and deadline, and a 60 GiB free-space
floor. The supervisor also watches total filesystem growth to account for SQLite
temporary files that may already be unlinked and invisible to directory scans.
Other applications' disk growth can conservatively stop this job. No full text
archive extraction is performed. `caffeinate -i` can wrap the command on macOS.

`manifest.json` records progress; `analysis-report.json`, seasonal ranking CSVs,
and `daily.sqlite` are produced only after successful reconciliation and database
checks. The final filename is promoted after candidate integrity checks. Supervisor
failure withdraws that filename and marks the run incomplete. All artifacts remain
`serving_ready: false` until reviewed and integrated through the normal release
process. The private reconciliation database is initially retained for inspection.

Tests: `python3 -B scripts/test-ebd-aggregate-region.py` independently checks exact
daily totals, shared-copy/species-rollup deduplication, conflicts across state
boundaries, zero-observation effort, private-site exclusion, county-less outings,
seasonal rankings, taxonomy ambiguity, and failure without database promotion.
