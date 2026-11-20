# Configurable application databases

Updated November 19, 2026. PostgreSQL 18.7 now serves DigitalOcean production;
ChatGPT/Sites staging remains on D1, and SQLite remains available for local use.
See DO-PRODUCTION.md for the completed migration and RUNBOOK.md for operations.

## Deployment selection

| Target | Configuration | Connection |
| --- | --- | --- |
| ChatGPT/Sites | DB_DRIVER omitted or `d1` | Existing platform-injected `DB` D1 binding |
| Standalone local development | `DB_DRIVER=sqlite`, `SQLITE_PATH` | Node 24 SQLite file adapter |
| Standalone/DigitalOcean | `DB_DRIVER=postgres`, `DATABASE_URL` | `pg` connection pool |

`server/database/index.mjs` creates a standalone adapter and environment;
`worker/database.mjs` validates the injected adapter without importing Node
libraries into the Worker. Standalone startup must specify a driver explicitly.
It checks database connectivity and never silently falls back to SQLite after
a PostgreSQL failure. Application HTTP controllers resolve the configured
adapter before handling persistent data. The startup integration is:

```js
import application from './dist/server/index.js';
import {createDatabaseEnvironment} from './server/database/index.mjs';
const env = await createDatabaseEnvironment(process.env);
// server/http.mjs forwards a Web Request:
const response = await application.fetch(request, env);
// On graceful shutdown, after draining requests:
await env.DB.close();
```

The HTTP listener is server/http.mjs; Caddy, systemd and release packaging are
documented in DO-PRODUCTION.md. `createDatabaseEnvironment` sets
`DEPLOYMENT_TARGET=standalone`; it must not be overridden with untrusted data.
Sites does not use that Node initializer and keeps its current D1 binding.

## Interface and SQL

All three targets expose `prepare(sql).bind(...values).first()/all()/run()` and
atomic `batch(statements)`. Values stay bound, never interpolated into SQL.
The PostgreSQL adapter converts application `?` parameters to `$1`, `$2`, etc.,
preserving ordinary SQL strings, quoted identifiers, dollar strings and comments.
This is a small portable application-SQL contract, not a general SQLite-to-
PostgreSQL SQL translator. Native PostgreSQL JSON `?` operators and dialect-
specific escape strings are outside that contract; migrations use native SQL.

PostgreSQL batches reserve one pool client for BEGIN/statements/COMMIT and roll
back all mutations on failure, including failed audit insertion. The review
write path takes a transaction-scoped advisory lock before executing its
revision/count guard. This coordinates approvals across pooled connections and
future app instances; two photos cannot both pass the same breadth-first count
check from stale snapshots. D1 retains its existing atomic statement guard.

IDs, ISO timestamps and serialized JSON remain TEXT in both schemas, preserving
current API types and simplifying a later reviewed data transfer. This does not
require the two engines to share identical migration syntax.

## PostgreSQL connection configuration

- `DATABASE_URL`: connection details from secure runtime configuration; never Git,
  command arguments, application logs, or browser code.
- `DATABASE_SSL=verify-full`: default. Certificate validation stays enabled.
- `DATABASE_CA`: optional PEM CA certificate supplied through runtime config.
- `DATABASE_CA_FILE`: alternatively, a readable PEM CA file path. Both app startup
  and the migration CLI support it; setting both CA options is rejected.
- `DATABASE_POOL_MAX=5`: default, configurable from 1 to 50. Keep the application
  pool small on the proposed 1 GiB Droplet and allow for administrative sessions.
- Connections have a 5-second acquisition/connect timeout, 30-second idle timeout,
  and 10-second statement timeout. Errors returned by the API contain no SQL or
  connection details. No automatic retry of arbitrary mutations is attempted.

Remove URL parameters `ssl`, `sslmode`, `sslcert`, `sslkey` and `sslrootcert`;
these can override node-postgres's explicit TLS settings and are rejected.
Use the dedicated settings above instead. `DATABASE_SSL=disable` is accepted
only for loopback PostgreSQL, for isolated local tests. Production DO TLS and
network restrictions still need testing against the real managed service.

See node-postgres [transactions](https://node-postgres.com/features/transactions)
and [SSL configuration](https://node-postgres.com/features/ssl) for the driver
behavior behind these choices.

## Schemas and migrations

- D1: existing immutable `drizzle/` files and Sites deployment migration flow.
- Standalone SQLite: the same active drizzle SQL, applied by the local CLI.
- PostgreSQL: native SQL in `migrations/postgres/` for photo reviews, accounts,
  identities, grants, immutable audit records, and administrator-bootstrap state.
- Trip collaboration tables remain staged in `schema/identity-routes.sql` and
  `schema/postgres-routes.sql`. Integration tests create them in disposable test
  databases only. Browser trip sharing behavior is unchanged.

Run `npm ci` first. For a standalone target, load private environment settings
and run `npm run db:migrate`. Migrations are explicit, not run during requests.
They are transactional, serialized with a database lock, and recorded by ID and
SHA-256 checksum in `aviquiz_schema_migrations`. A second run applies nothing;
changed or missing applied migration files are rejected. Existing unmanaged
SQLite tables are not silently adopted. D1 must continue through Sites migrations,
not this CLI. Use separate migration and restricted application DB credentials
when configuring the real managed database; database owners remain trusted.

The migration CLI creates schema only. It does not copy the current D1 rows,
reset identities, or assign administrators. Production cutover still requires a
reviewed export/import preserving account UUIDs, issuer/subject mappings, grants,
audit and bootstrap records, annotations, and revisions.

## Identity boundary

Standalone configurations do not trust `oai-authenticated-*` headers. This also
disables the Sites-only owner bootstrap endpoint. Production should import the
existing administrator mapping; no first-user or email-only admin shortcut has
been introduced. Existing service-agent review authorization remains available
when explicitly configured, but the user-facing review UI still needs its
Cognito permission integration before independent hosting. An actual standalone
HTTP entry point must set the deployment target through the initializer above.

## Local verification

PostgreSQL 17.12 and 18.7 were installed through Homebrew for these checks.
PostgreSQL 18 is the recommended new DigitalOcean production version. No background
login service was enabled. The test wrapper starts a separate, temporary cluster
bound to `127.0.0.1` on an available port, runs both database suites, stops the
cluster, then removes its temporary files. The Homebrew default cluster is not
used. Allow approximately 100 MiB of temporary space. The wrapper defaults to PostgreSQL 18. Override `PG_BIN` or pass
`--pg-bin /absolute/path/to/bin` if the
PostgreSQL executables are elsewhere.

```sh
npm run test:database
```

For CI or an already provisioned **disposable local** test service, set
`TEST_DATABASE_URL` to a loopback PostgreSQL database named `aviquiz_test`, build
with `node scripts/build-worker.mjs`, then run `node test-database.mjs`. That
suite intentionally rejects remote hosts and other database names. It requires
a fresh test database, creates test schemas and data, and is never a production
migration command. The GitHub security workflow has a dedicated PostgreSQL 17/18
service matrix for this suite, bound to runner loopback only.

SQLite and both PostgreSQL versions passed migration/idempotence and modified-history rejection,
concurrent duplicate registration with no orphan users, permanent identity
mapping, grants/revocation, atomic audit rollback, audit immutability, staged
trip sharing permissions, bound SQL values, guest quiz access, protected review
writes, revision conflicts, cross-origin rejection, concurrent approval limits,
and rejection of forged Sites owner headers/bootstrap. Existing D1-shaped
account, JWT, review and quiz regression tests also remain applicable.
