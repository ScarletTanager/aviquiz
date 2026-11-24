# Offline EBD geography processing

Run these commands from the AviQuiz repository. They need a local Python 3.10 or newer and do not contact eBird, Cornell, AWS, or DigitalOcean. They do not deploy or publish data. The current defaults point to the completed September 2026 partition manifest and the local taxonomy snapshot in `outputs/ebd_reference/taxonomy-2026.json`. Both live outside Git. Override them with `--manifest` and `--taxonomy` when using other inputs.

```sh
scripts/process-ebd start US-NC
scripts/process-ebd start CO
scripts/process-ebd status
scripts/process-ebd status US-NC
scripts/process-ebd stop US-NC
scripts/process-ebd start US-NC --resume
```

Use eBird country, state/province, or county codes. A public hotspot requires its enclosing country or region: `scripts/process-ebd start L651593 --parent US-NC`. A country spanning multiple partitions is combined. `run` runs in the foreground instead of starting a background process. `--root` before the subcommand selects a different job directory, for example to preserve an older completed run. The same geography cannot run twice in the same root.

At most two jobs in the same root run concurrently. Each reserves up to 20 GiB by default and checks a 60 GiB free-space floor while running. Start checks the remaining reservations for other running jobs; the supervisor stops a job if its size, runtime, memory, or free-space limits are exceeded. Use `--disk-gib` and `--hours` to set larger or smaller limits. Simultaneous jobs compete for CPU and disk bandwidth. Start only one photo collector at a time; separate collectors do not share a Cornell request rate limit.

Outputs and progress are in `outputs/ebd_jobs/<code>/`. The status output identifies each stage directory and any error. Interrupted stages start again in a new directory; completed extraction and aggregation are checked and reused with `--resume`. Unresolved taxonomy is reported in the failing stage's `taxonomy-unresolved.json`; the job stops rather than guessing. Source partitions and private reconciliation outputs contain sensitive EBD records and must not be published. They can be large.

The extract retains all source years. The derived quiz facts default to 2017–2025; choose another bounded period with `--first-year` and `--last-year`. Processing verifies source checksums, deduplicates shared checklists, quarantines conflicting events, and exports a common versioned package. The export stage also seeds one shared photo queue at `outputs/photo_metadata/queue.sqlite` by default. Override with `--photo-db`. Existing photo references and completed quarter jobs are preserved for species already queued from another geography; only missing quarter jobs are added. A shared species code is fetched once for all geographies. Find the package directory in `completed.export.package` and validate or activate it with:

```sh
scripts/process-ebd validate /path/to/package
scripts/process-ebd activate /path/to/package
```

Activation copies the validated immutable package under `outputs/ebd_active/<geography>/` and atomically replaces that geography's `active.json` pointer. It does not deploy the package to staging or production. The package has one `package.json`, `manifest.json`, `places.json`, `species.json`, and content-hashed chunk files. Each place has an independently compressed record within bounded chunks, with full-range hexadecimal year masks. Each geography uses the same package schema and can be activated or rolled back locally by changing its active revision pointer.

Use the shared collector queue and output directory. For example:

```sh
scripts/collect-photos start --db outputs/photo_metadata/queue.sqlite --output outputs/photo_metadata --manual-verification
scripts/collect-photos status --db outputs/photo_metadata/queue.sqlite --output outputs/photo_metadata
```

The collector works breadth-first across the shared species queue and seeks dated coverage in each quarter. The CLI currently requires a completed paired partition manifest; it does not partition the original worldwide tarballs itself. To process a new release, first create its paired partitions using the existing ingestion tooling.
