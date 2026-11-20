# Bounded local EBD benchmark

Initial run: November 18, 2026. Offline only; no DigitalOcean/AWS resources,
network calls, production data changes, or archive extraction. No dependencies
beyond Python's standard library were installed.

## Scope and implementation

`scripts/ebd-benchmark.py` builds a disk-backed SQLite baseline using the paired
Tuscaloosa County, Alabama sample (March 2025, relMar-2025). It projects required
fields, joins observations to sampling events by ID, verifies date/locality
agreement, collapses shared outings, excludes conflicting outings, and creates
daily effort and species-detection facts using the existing seasonal schema.
Only approved species-level records are counted. Taxonomy rollup and additional
effort cutoffs remain future work, as in the original pilot. This is not the
proposed DuckDB/Parquet pipeline and does not measure that engine's storage or
performance. It does not implement incremental EBD updates or concurrent trip
requests.

It then reads a time-bounded prefix of each worldwide September 2026 archive,
streaming the existing `.txt.gz` member from its outer tar. These scans split and
check field counts and track date ranges. They do not join the two prefixes,
retain observation rows, or establish regional coverage. The observation and
sampling prefixes cover different years; they are not a paired development
extract. A stopped gzip prefix has not verified the member's final checksum.

## Actual initial results

Machine: macOS ARM64, 12 logical CPUs; Python 3.13.18, SQLite 3.54.1.
These numbers describe this machine and input prefix, not a cloud sizing promise.

| Measurement | Result |
| --- | ---: |
| Sample observation / sampling rows | 4,863 / 317 |
| Eligible submissions / independent outings | 243 / 202 |
| Species / sampled dates | 119 / 31 |
| Missing sampling matches / date-location disagreements | 0 / 0 |
| Daily species-detection facts | 1,368 |
| Sample processing plus 30 query executions | 0.097 seconds |
| Sample worker peak RSS | 23.47 MiB |
| Sample staging file before aggregation | 520 KiB |
| Aggregate-only SQLite database | 260 KiB |
| First seasonal query / median subsequent query | 1.52 / 1.32 milliseconds |
| Observation prefix, 10 seconds | 5,711,314 rows; 571,130 rows/second |
| Sampling prefix, 10 seconds | 9,002,475 rows; 900,245 rows/second |
| Observation decompressed parse throughput | 215.36 MiB/second |
| Sampling decompressed parse throughput | 214.40 MiB/second |
| Highest sampled workspace usage during the main run | 799,473 bytes |
| Retained main-run files, including reports | 386,922 bytes |

The observation prefix covered 2012; the sampling prefix covered January through
September 2026. Cache state, record lengths, compression ratio, joins, sorting,
partition cardinality and cloud storage performance can change throughput.
Do not multiply the tiny sample's aggregate size by worldwide row count or
interpret its query latency as a production/concurrency result.

Full local report:
`/Users/sandy/col_birding/outputs/ebd_benchmark/local-baseline-2026-11-18/report.json`.
Aggregate database: `sample/aggregate.sqlite` beneath that directory. Generated
outputs stay outside the repository/deployment. Successful runs remove staging
checklist IDs; incomplete staging files may remain for diagnosis and must stay
private.

## Controls and failure behavior

- Default output budget: 500 MiB; default monitored worker RSS ceiling: 256 MiB.
  Reserve at least an additional 2 GiB of free filesystem space before starting.
- Each of two SQLite files and its DELETE journal is bounded to one quarter of
  remaining disk budget, with a 4 MiB reporting reserve. SQLite file-backed temp
  spill is disabled; its heap is limited. Worker JSON is bounded; source line
  buffering is limited to 1 MiB. Larger source lines stop the run explicitly.
- Supervisor samples child RSS and directory size about every 50 ms. RSS is a
  monitored ceiling, not a strict OS resident-memory allocation guarantee;
  transient overshoot and parent-process overhead are possible. On Linux an
  additional address-space limit is set to twice the worker RSS ceiling.
- The sample has a 60-second supervisor deadline. Each prefix scan has a
  10-second work budget and two seconds of supervisor shutdown allowance.
  A prefix stop is expected and explicitly labeled `bounded_prefix`.
- Resource stops, malformed rows, mismatched pairs, and unavailable monitoring
  produce an `incomplete` report and no completed aggregate database. Promotion
  requires the sample stage to finish its checks. No result is auto-published.
- Restart means re-reading inputs in a **new** output directory. Existing output
  directories are rejected; no append or mid-gzip checkpoint resume is claimed.
- macOS `ps` is required for live RSS monitoring. The Codex filesystem sandbox
  blocked it on the first attempt; the monitored runs were separately approved
  outside that sandbox. Monitoring failure is now reported as incomplete.

## Reproduce

From the repository root, use a new output directory for each run:

```sh
/opt/homebrew/bin/python3.13 -B scripts/ebd-benchmark.py \
  --output /Users/sandy/col_birding/outputs/ebd_benchmark/another-local-run \
  --disk-mib 500 --memory-mib 256 --sample-seconds 60 --scan-seconds 10
```

Use `--skip-scans` for the small paired-sample stage only. `--observations`,
`--sampling`, `--observation-archive`, and `--sampling-archive` override the local
paths. When changing paired inputs, set `--place`, `--first-year`, `--last-year`,
and `--release` to their actual scope. A matching release flag is provenance
supplied by the caller, not automatic proof the source files are paired.

Run correctness and stop/restart tests:

```sh
/opt/homebrew/bin/python3.13 -B scripts/test-ebd-benchmark.py
```

Tests compare every output field for all 119 ranked sample taxa with the
independent original in-memory pilot. They also exercise missing sampling IDs,
disk/memory/runtime limits, no partial serving-artifact promotion, clean restart,
gzip-in-tar streaming, and truncated gzip rejection. Test temporary directories
are removed on completion. No network or production access is needed.

## Next stage and longer-term storage

Use these controls as a starting point for a measured regional run, followed by
DuckDB/Parquet and cloud comparisons. The initial local benchmark deliberately
caps configured output at 500 MiB. Larger cloud runs need a reviewed budget and
configuration change, and complete matched regional inputs rather than archive
prefixes.

The intended long-term arrangement is private DigitalOcean storage for the full
original archives, a separate processing workspace, and small paired development
extracts retained locally. Development extracts must record their release,
geography/date scope, projection and selection policy, and reconciliation
counts. Production application accounts/trips remain separate from bulk import
work. Upload, retention, archive deletion and cloud spending were not performed
or authorized by this local benchmark.
