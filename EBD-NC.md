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
  Missing matches or mismatches in usable outings prevent promotion. A mismatch
  in an already-quarantined conflicting shared group remains an audited exclusion;
  no member of that group can enter either numerator or denominator. Sample audit references stay
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

The first NC reconciliation pass found one date disagreement: an American Crow
observation dated February 22, 2024 joined a sampling copy dated February 21.
The shared group itself had eligible sampling copies on both dates and was
already excluded for conflicting local metadata. The validator was adjusted to
retain that discrepancy in the private audit without blocking unrelated valid
outings. It is not a per-record exception: the same rule applies only to groups
already proven unusable by shared-group validation. The original records are
unchanged, and date/geography mismatches in usable outings still fail closed.

## Completed NC run - November 21, 2026

The successful run used source commit `2d5cbe4` and completed in 710.97 seconds
(about 11 minutes 51 seconds). Input files and production were unchanged. Source
and output validation passed, including SQLite integrity, foreign keys and the
check that detections never exceed eligible effort. An independent post-run
comparison reproduced the earlier Chatham Kirtland's Warbler counts and rates.

| Measurement | Result |
| --- | ---: |
| NC sampling / observation rows reconciled | 2,545,248 / 35,141,068 |
| Eligible submissions / independent outings | 1,967,669 / 1,694,551 |
| Conflicting local / cross-region outings excluded | 1,682 / 23 |
| Outside-NC sampling rows checked | 174,053,615 |
| Independent outing-species detections | 26,706,921 |
| NC statewide / counties / public hotspots | 1 / 100 / 2,837 |
| Daily effort / detection rows | 810,626 / 21,928,842 |
| Species with qualifying NC detections, all source years | 484 |
| Daily database | 3,601,432,576 bytes (about 3.35 GiB) |
| Peak monitored working-directory size | 4.56 GiB |
| Peak monitored worker RSS | 495.81 MiB |
| Minimum monitored free disk | 403.69 GiB |

The daily facts cover qualifying outings from 1941–2026. Reference windows below
use 2017–2025, excluding the partial 2026 autumn. This is not an official complete
NC bird list: sensitive-data omissions, eligibility rules and available effort
limit the evidence. Taxonomy metadata covers 515 source-native species parents;
only qualifying approved detections enter the 484-species empirical result.

### Kirtland's Warbler checks

| Scope / season | Reporting outings / effort | Raw rate | Day-balanced rate | Reporting seasons / sampled seasons | Raw / day-balanced / recurrence-first rank |
| --- | --- | --- | --- | --- | --- |
| NC, September | 216 / 93,892 | 0.23% | 0.32% | 4 / 9 | 202 / 191 / 191 of 350 |
| Chatham, Sept 20–Oct 10 | 107 / 2,411 | 4.44% | 1.44% | 1 / 9 | 70 / 98 / 176 of 209 |
| Chatham, Sept 27–30 | 107 / 573 | 18.67% | 7.58% | 1 / 9 | 35 / 59 / 130 of 158 |
| Jordan Lake dam, Sept 20–Oct 10 | 99 / 172 | 57.56% | 7.22% | 1 / 9 | 8 / 56 / 84 of 110 |

The wider Chatham and dam results exactly reproduce the previous pilot, including
the one-season classification. The narrow-window raw rank changes from 34 to 35
because identifiable-group rollups can increase another species' rate. Chatham's
all-year eligible effort for 2017–2025 is now 36,212 versus 36,216 under the old
county-only grouping rules; the autumn denominator remains 2,411.

Statewide Kirtland's appears in four sampled seasons and is classified recurring,
although its frequency remains low. Recurrence and day balancing are useful
signals, not a universal rarity classifier or encounter-probability model.
Evidence tiers must stay geography- and season-specific. Day balancing can also
increase a species' frequency, as the statewide result demonstrates.

### Audit and exclusions

All observation outcomes sum to the full 35,141,068 input rows. Counts include
31,281,482 accepted species-level rows; 550,216 ISSF, 28,464 form and two intergrade
rows folded into species; 2,857,889 rows from ineligible submissions; 106,613 rows
from conflicting outings plus the one audited metadata mismatch; and 443
non-approved rows. Excluded ambiguous/domestic categories are 138,309 domestic,
48,222 slash, 125,677 spuh and 3,750 hybrid rows. These are policy exclusions,
not unreported parser failures or destroyed source data.

No observation was missing its sampling event. The one date disagreement was
inside an already-quarantined group, and no disagreement in a usable outing was
accepted. The private audit retains the conflicting group and record reference;
the group contributes to neither numerator nor denominator. Regression tests
also verify that a date mismatch in a usable outing still blocks promotion.

There are 6,402 eligible submissions with no observation rows and 6,745 valid
independent outings without approved identifiable species detections. They remain
in effort totals; these counts alone cannot establish whether a visit truly had
zero birds or whether observations were omitted/filtered. Six valid outings have
no usable county code; they contribute to NC and their public hotspot if present,
without inventing a county assignment. Private locations never become hotspot
catalog entries. The initial failed attempt is isolated and not part of the final
aggregate.

Private artifacts are under
`/Users/sandy/col_birding/outputs/ebd_aggregation/nc-20261121-r2/`:
`daily.sqlite`, `analysis-report.json`, `supervisor-report.json`, `verification.json`,
reference ranking CSVs, and the separate `reconciliation.private.sqlite` audit.
They remain outside Git; no new quiz coverage has been deployed. The next step is
reviewing the selection/ranking policy and building compact serving lists for the
launcher, rather than uploading the full event staging database to production.

## Seasonal quiz serving prototype (November 21)

The staging export uses complete calendar years 2017–2025: 457 species and 2,891
places with eligible effort (state, counties, public hotspots). Each place stores
month/day occurrence masks across those nine years, not individual records.
Arbitrary inclusive seasonal windows and leap days are preserved. Windows across
New Year use only complete season pairs, excluding January 2017 and December
2025. The serving copy supports presence and recurrence; it deliberately does
not claim to expose encounter-rate estimates. The analytical SQLite database
retains the underlying counts for later likelihood work.

A species needs reports in at least two sampled seasons by default when two or
more seasons have effort. The rarity checkbox includes one-season reports.
One sampled season is insufficient evidence to classify a species as exceptional.
Chatham September 20–October 10 produces 175 species by default and 209 with the
checkbox enabled; Kirtland's Warbler occurs only in the latter (one season).

Photo-catalog reconciliation is part of `scripts/ebd-export-quiz.py`: preserve
verified Macaulay references, map source scientific names to the eBird taxonomy,
write the separate `dist/nc-birds.json`, and produce `photo-coverage.json` with the
unresolved species queue. Winter Wren's source name Troglodytes hiemalis maps
explicitly to Nannus hiemalis. There are initially 86 species with photos and
371 pending. Existing persistent automated-access challenges prevent further
photo lookups under the owner's backoff policy. No photos are downloaded or
rehosted. Missing-media species remain visible in seasonal coverage but never
become photo questions. `dist/data.json` and original statistics are unchanged.

The compact serving artifacts total 16,042,075 compressed bytes. Private staging
R2 stores this derived copy; planned canonical retention is in `aviquiz-data`
(NYC3 Standard), with originals in `aviquiz-archive` (NYC3 Cold Storage). No
DigitalOcean data uploads are implied by a staging release.

## Completed NC photo coverage (November 22)

All 457 species in the 2017–2025 serving catalog now have validated photo
references: 715 photos total. The 371 previously uncovered species received one
reference each, in breadth-first browser batches of 10, 50, and 311. The sustained
serial browser sessions showed no visible access challenges. Direct HTTP access
remains separately blocked under the owner's retry policy. No browser session
credentials were extracted or transferred to the HTTP workers.

The browser records confirm the species-page title, scientific name, Cornell
asset URL, and photographer attribution. The source-native Winter Wren name
Troglodytes hiemalis is explicitly matched to the verified current genus name
Nannus hiemalis. Existing parenthesized subspecies/form labels are retained.
Browser records, queue state, and completion reports remain in the private local
`outputs/photo_metadata/` directory; the published source contains reference
metadata only. These references are not reviewed ID-tip annotations.

Use `scripts/reconcile-photo-catalog.py` to attach verified references to an
existing serving catalog without regenerating analytical data. The
`--require-complete` gate refuses to publish an incomplete catalog. Chatham's
September 20–October 10 scope now has 175/175 default species photo-ready, or
209/209 when single-season records are included. The historical window,
recurrence rules, serving data-pack hashes, original Colombia catalog, and saved
statistics keys are unchanged by this metadata release.

## Seasonal-photo collection started (November 22)

The seasonal target is two dated photos per calendar quarter per species. A
representative catalog sample confirmed exact observation dates for Northern
Cardinal (Q1), Dunlin (Q2), Mallard (Q3), and Blackburnian Warbler (Q4). The dates
come from Cornell's displayed per-photo observation metadata, not upload order or
inferred plumage. The exact date and original displayed datetime are retained;
no EXIF capture-time guarantee is made.

The first breadth-first batch added Q1 coverage for 50 NC species. Including the
four representative samples, the processing database holds 108 dated references
across 54 species-quarter targets. Three previously undated references were
backfilled; 712 existing references still have unknown dates. No species is yet
fully covered for all four quarters. All 1,828 NC quarter targets are persisted
in the queue. Coverage and evidence exports are private local work products under
`outputs/photo_metadata/seasonal/`; application catalogs and staging/production
photo selection have not been changed by this collection step.

`scripts/seasonal-photo-metadata.py` validates and stores dated records and plans
one next-quarter lookup per species, prioritizing species with fewer quarters
covered. Exact identity, asset URL, date validity, requested quarter, attribution,
and conflicting-date checks protect imports. The normalized dated-asset table is
the source for seasonal exports; undated references do not satisfy the target.
Date-preserving queue re-imports and the catalog publisher's explicit `--merge`
option allow future publication without losing the new fields. Location matching
is deferred, as requested. See RUNBOOK.md for the collection and publication steps.
