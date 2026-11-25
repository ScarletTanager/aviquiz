# Personal statistics MVP

Implemented on dev; not deployed. This feature provides personal practice totals
and a latest-result comparison, not an archive of quizzes or classroom records.

## What is retained

Signed-in account statistics are cumulative correct/attempted counters per species
and medium, with separate counters for site-only practice. Each completed eligible
quiz is folded into those counters. Only the latest comparison result for each
site/family and medium is kept, plus the latest overall result in each medium.
Old comparison results are overwritten. A bounded recent-attempt buffer continues
to power mistake review; it has no guesses, media, timestamps, or question metadata.
Accuracy uses cumulative counters, while mistake review still uses recent attempts.

The RDBMS has only two statistics tables:

- `user_statistics_settings`: optional account storage, on by default.
- `user_statistics_summary`: one aggregate document/revision per account, including
  latest comparisons, import fingerprint, and small synchronization cursors.

There is no table of quiz sessions, answer logs, or historical quiz results.
Uploads contain compact species contributions and a current comparison summary;
they are merged and discarded. A browser-session cursor and monotonically increasing
sequence prevent duplicate additions on retries. Compare-and-swap revisions and
transactional preference gates prevent concurrent devices from losing updates.

Browser statistics cover the five most recent completed eligible quizzes across
photo and audio together. Five compact contribution buckets allow exact removal of
the oldest contribution when the next quiz finishes. They are internal bookkeeping,
not a user-facing quiz archive. The cache includes minimal synchronization IDs and
state so pending totals can be retried. Account history is never written into this
cache. Without consent, the recent aggregate lasts only in memory for the visit.

Eligibility retains the existing MVP scope: original regular quizzes and mistake
reviews count. Experimental tips/annotation review, trip prototypes, and geography
quizzes continue to be excluded. Guest quizzes never require sign-in or consent.

## Storage controls and legacy import

Every entry page offers the browser statistics consent dialog with storage details.
One minimal flag remembers allow/decline. Declining removes the new recent cache.
Essential sign-in session storage and personal annotation-review marks are separate.
The Statistics page allows the browser choice to be changed later.

Signed-in users see the default-on historical-storage switch and its help dialog.
Turning it off prevents future account additions, retaining existing totals. Results
recorded while off are not retroactively uploaded when it is re-enabled. Recent
local practice can still be included on that device if browser consent allows it.

The login-only import button explicitly imports the frozen pre-feature photo/audio
statistics. An import adds the information actually available in those snapshots;
answers discarded by the older rolling-history implementation cannot be recreated.
It does not invent dated quizzes or import photo review marks. One import fingerprint
per account makes a repeat of the same snapshot a no-op; a different overlapping
snapshot is refused for manual resolution. The snapshot payload itself is not kept
on the server after folding its counts into the aggregate.

Old browser keys are deliberately preserved until a successful explicit import.
They are the one migration exception to the new five-quiz storage limit. New quizzes
never append to those old keys. After acknowledgement, the client removes only the
exact old bytes submitted, preserving a concurrent change from another tab. Failed
imports retain the browser copy. Exporting a backup first is supported.

Browser backup files can carry aggregate statistics and review marks. Restoring one
prepares a snapshot for explicit account import; it does not replace live account
history. An aggregate backup is refused if it may overlap existing counted quizzes.

Only five contribution buckets survive a reload. If more than five are awaiting
synchronization, the UI asks the user to keep the tab open and reconnect. This MVP
does not provide an unlimited offline queue. A stopped or expired session cannot
upload another account's contributions: ownership comes from the verified identity,
and the client also supplies an expected-account guard.

## API and privacy boundary

`GET /api/statistics` returns only the caller's aggregate, preference, and cursors.
`POST /api/statistics/preferences`, `/quiz`, and `/import` require a registered active
identity, same-origin JSON, bounded input, and validated fields. Client-supplied user
IDs do not select the owner. No email, guesses, raw media, or credentials are added
to statistics. Responses are not cached and storage errors do not expose SQL details.

## Deployment prerequisites

No live changes are made by this implementation. Deploy to staging only after the
usual request and review. Apply the additive `0004_user_statistics` migration before
running the new app. Sites uses the Drizzle journal/D1 migration; standalone SQLite
and PostgreSQL use `server/database/migrate.mjs` with their configured environment.
Do not change an applied migration.

For DigitalOcean, back up the current database using the established procedure,
apply the PostgreSQL migration as schema owner, then apply
`deploy/statistics-runtime-grants.sql`. It grants only SELECT/INSERT/UPDATE on the
two new tables to `aviquiz_runtime`. Migration credentials remain separate from
runtime credentials. The production packager includes migrations and these grants.
The database snapshot tooling includes aggregate statistics and reads older snapshots
as having empty statistics tables. It is not a live data merge tool.

Before release, verify import with a copy of browser data in staging; do not clear
the original browser history until the intended account has confirmed the import.
Staging and production have separate application databases even when the sign-in
pool is shared, so importing into staging does not populate production totals.

## Local checks

```sh
node scripts/build-worker.mjs
node test-statistics-api.mjs
node test-statistics-client.mjs
node test-statistics-ui.mjs
node test-app-audio.mjs
node scripts/test-local-postgres.mjs
```

The PostgreSQL harness creates a disposable loopback-only database and shuts it
down afterward. All authentication is mocked; these checks make no AWS calls.
