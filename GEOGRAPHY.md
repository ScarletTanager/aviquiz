# Geography quiz launcher

The new flow uses `/explore`. The original `/quiz` configuration, Colombia
catalog, trips prototype, statistics storage keys, and December itinerary remain
available. There is no timed removal; retain the original quiz at least through
Sandy's return on December 18, 2026. Guest browsing and single-place quizzes do
not require an account. Signed-in users see a placeholder for future trip choices;
trip/account-backed statistics work is deferred.

## Metadata and coverage

Countries, administrative subregions and public hotspots are directory metadata,
not evidence of seasonal species occurrence. The Node-only eBird adapter uses
fixed official reference endpoints and a server-held `EBIRD_API_KEY_FILE` or
`EBIRD_API_KEY`. It exposes no key, arbitrary destination, observation endpoint,
or free-form upstream query. Inputs must be known navigation nodes; returned
region codes/names are validated. Calls have time/payload limits, single-flight
coalescing, a shared 60-request/hour ceiling, and 429 backoff. No periodic refresh
runs automatically and no worldwide crawl is performed.

`location_metadata_cache` stores validated metadata lists and fetch timestamps
in PostgreSQL/SQLite/D1. Normal requests reuse the cache indefinitely, including
after restart. Administrators may explicitly refresh the current directory through
`POST /api/geography/refresh`. The API checks the active server-side administrator
grant and same-origin JSON requests and records an audit event. Cached data is
served during refresh: fetch -> validate -> persist the complete replacement in
one atomic statement -> publish in memory. Failed/rate-limited refreshes preserve
the prior list. The cache has bounded list size and overall pilot capacity; no
multi-gigabyte local outputs are produced.

Country grouping is a separate bundled UN M49 navigation mapping, splitting the
Americas into South America and North America (including Central America and the
Caribbean). This deliberately differs from eBird listing continents. Taiwan is
an explicit addition; eBird countries not in the mapping appear under Other
countries / areas. Existing pilot sites/subregions form a limited fallback if
upstream metadata is unavailable. eBird has at most two subnational region levels;
not every country has both. Private checklist locations are not represented as
public eBird hotspots. Existing public trip-checklist pilot sites remain labeled
as pilot sites.

Sources:
- [Official eBird API collection](https://documenter.getpostman.com/view/664302/S1ENwy59)
- [UN M49 geographic grouping](https://unstats.un.org/unsd/methodology/m49/overview/)

## Season and quiz handoff

The launcher accepts inclusive start/end dates, up to 366 days, with an optional
whole-month shortcut and leap-year handling. Dates select a recurring seasonal
window across the available observation years, not a future-year prediction.

Until the EBD ingestion supplies complete regional lists, generation uses only
existing pilot evidence. Every selected day must fall within a pilot place's
supported seasonal window; a partial overlap is not silently treated as full
coverage. Country/region scope unions qualifying pilot lists and explicitly labels
that limitation. The user must opt into the incomplete pilot list before Start
quiz enables. Unsupported dates or locations remain browsable but cannot launch
an empty/misrepresented quiz. Start is available at country level and below,
where pilot species/photos exist; world/continent quiz scope is not offered.

The first geography pilot supports photo quizzes and optional family filtering.
It reuses the photo session and grading engine, returns to `/explore` on exit/reset,
and does not alter original Colombia statistics. Geography-aware audio is not
silently given Colombia-specific recording preferences; that is separate future
work. No original quiz data or progress keys were renamed.

## Operations

Apply immutable migration `0003_location_cache.sql` after a protected native
PostgreSQL backup, then grant `SELECT, INSERT, UPDATE` on
`location_metadata_cache` to the runtime role. No new schema or audit mutation
privileges are needed. Keep the API key in a service-readable protected file
outside releases and Git; never display its contents. On production, use the
existing dedicated `aviquiz-auth` group and `EBIRD_API_KEY_FILE` in the root-only
environment file. The deployment bundle must include server/ebird-locations.mjs
and server/location-cache.mjs. Staging remains on its existing release.

If a list looks outdated, an administrator opens it and selects Refresh this
directory. Its prior contents remain visible while the request runs; the last
updated timestamp changes only after success. A refresh affects only the current
list (or the shared country directory for continent/world navigation), not every
hotspot in the world. A full import/regeneration scheduler is not included.

Validation: `node test-geography.mjs`, `node test-app-audio.mjs`, and
`npm run test:database` cover API security, persistent cache, in-flight/failing
refresh behavior, SQLite/PostgreSQL, dates, supported-range selection, the actual
launcher DOM flow, geography/session handoff, and unchanged legacy statistics.
No screen recording or browser automation is used.
