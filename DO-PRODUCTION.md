# DigitalOcean production deployment

Updated November 19, 2026. **https://aviquiz.org is live** on DigitalOcean.
ChatGPT staging remains active, unchanged, and protected by its existing access
control. Both environments use the existing Cognito pool/client; their application
databases and browser storage remain separate. Production callback and logout URLs
were configured by Sandy. No AWS management actions were performed for deployment.

## Infrastructure inventory

| Item | Current value |
| --- | --- |
| Region | NYC1 |
| Droplet original public IPv4 | 162.243.164.249 |
| Reserved IPv4, attached to Droplet | 104.248.108.210 |
| Droplet VPC interface | 10.116.0.2/20 |
| OS | Ubuntu 24.04.5 LTS, x86_64 |
| Droplet sizing | 1 vCPU, 1 GiB RAM, 25 GB SSD |
| Managed database selection | PostgreSQL 18, Standard Edition; user provisioning separately |
| Intended production hostname | aviquiz.org, registered/DNS managed at Porkbun |
| Node installation | v24.22.3; official binary, SHA-256 checked |
| Caddy installation | 2.11.9 from Caddy's signed stable apt repository |

Database endpoint supplied by Sandy (not a credential):
`private-aviquiz-db-pgsql-nyc1-08185-do-user-49273569-0.h.db.ondigitalocean.com`,
port 25060. Initial connection information names `doadmin` and `defaultdb`.
The initial DNS lookup returned “name not found”; subsequent checks now resolve
the endpoint to 10.116.0.3 through the VPC resolver, Cloudflare and Google DNS.
The Droplet has a directly connected route for 10.116.0.0/20 and reaches the
PostgreSQL TLS endpoint on port 25060. The database project CA supplied by Sandy is now installed at
/etc/aviquiz/db-ca.crt, root-owned mode 0644 under the service-readable config
directory. SHA-256 certificate fingerprint:
E1:26:9C:2D:1C:19:B2:AF:01:B1:CF:C2:97:F6:D2:32:48:76:D3:B7:E6:2D:CF:43:FB:93:FA:D0:03:A4:6C:D0.
A fresh TLS 1.3 handshake with this CA and explicit hostname verification
succeeded (Verification: OK, matching private endpoint). System-wide trust was
not modified. Configure DATABASE_CA_FILE=/etc/aviquiz/db-ca.crt for both the
app and migration CLI. PostgreSQL authentication, schema setup and a service-user health check have
since completed successfully; see the database provisioning section below.

## Installed configuration

- `deploy` login user: original public authorized key copied from root; fresh SSH
  login verified. Member of `aviquiz` group for release-file access.
- `aviquiz` service user: system account, no login shell and no home directory.
- `/srv/aviquiz/releases`: deploy-owned, service-group readable; immutable
  releases and the active `current` symlink live here.
- `/etc/aviquiz`: root-owned configuration directory. The application `aviquiz.env` and separate
  `migration.env` are root-owned mode 0600. Neither is readable by deploy or
  directly by the service account; systemd loads the application environment
  before changing to the service user.
- `/opt/node24`: symlink to the versioned official Node binary installation;
  node/npm/npx exposed in `/usr/local/bin`. The fetched binary checksum is saved
  at `/var/lib/aviquiz-setup/node-checksum.txt`.
- `/etc/systemd/system/aviquiz.service`: enabled and active.
  Condition checks require both the `server/http.mjs` and real
  environment file. Runs as `aviquiz`, listens on loopback port 3000 by config,
  restarts on failure, and restricts filesystem writes and privilege escalation.
  Node heap is capped at 384 MiB; service MemoryHigh/MemoryMax are 600/700 MiB.
  This unit is intended for PostgreSQL, not a writable local SQLite database.
- Caddy: validated reverse proxy configuration for aviquiz.org to loopback 3000;
  enabled and active, with a verified Let's Encrypt certificate and HTTP-to-HTTPS redirect.
- UFW: enabled, default incoming deny/outgoing allow; rate-limited SSH port 22
  and allowed HTTP/HTTPS ports 80/443, for IPv4 and IPv6. Database/app ports are
  not publicly opened. SSH source restrictions remain a later step once the
  administrator and deployment-runner networks are chosen. No DO Cloud Firewall
  was created through an API by this work.
- SSH: password and keyboard-interactive authentication disabled, public keys
  enabled; root public-key access retained for recovery. `sshd -t` passed.
- Deploy sudo: only exact start/stop/restart/is-active commands for
  aviquiz.service; no general sudo or system configuration editing. Deployment
  code is trusted application code and can access its process environment when
  run by the service, despite the root-owned environment file.
- Journald: 100 MiB persistent / 50 MiB runtime log budgets, 14-day retention.
- Unattended Ubuntu security updates enabled; automatic reboots disabled.
  Remaining available OS updates were applied, including a new kernel.
  Reboot completed; kernel 6.8.0-149-generic is running.

## Rebuild and operation

These scripts target a fresh Ubuntu 24.04 x64 Droplet and require root privileges.
Review before reuse: preparation copies root's authorized keys to `deploy`, so
it is not an ongoing user-key management tool. Keep an authenticated recovery
session until a fresh deploy login succeeds. Public SSH host-key verification
uses OpenSSH known_hosts and must not be disabled for later deployments.

1. Run `deploy/prepare-ubuntu.sh` over the existing root SSH session. It installs
   dependencies, users, SSH/firewall rules and log/update policies. It does not
   deploy app code, request database credentials, change DNS, or reboot.
2. Copy deploy/aviquiz.service, deploy/Caddyfile, deploy/aviquiz.env.example and
   deploy/install-service.sh to a private working directory on the server.
3. Run `bash install-service.sh /path/to/that/directory` as root. It validates the
   systemd and Caddy configurations and enables only the conditional app unit;
   Caddy stays disabled. Verify a fresh `deploy` SSH login separately.
4. Reboot during this pre-production window, then confirm SSH, UFW and service
   state before deploying. Root recovery access remains available.

After an app release and protected environment are installed:

```sh
sudo systemctl start aviquiz.service
sudo systemctl is-active aviquiz.service
```

The deploy user can use those exact service-management commands. Root can inspect
`journalctl -u aviquiz.service` for diagnosis; do not print process environments,
connection strings, request Authorization headers or token-bearing callback URLs.
Root enables Caddy only after successful loopback app checks and correct DNS.

## Active release and migration

Active release: `aviquiz-809e8823048a163f`, promoted November 20 after staging
approval, from GitHub main commit `1a9780b92e42393da3af0989852445693a226f9e`.
Built outside the Droplet with Node 24.22.3. Archive SHA-256:
`2229f6661bcab5a6112a4134146f7dd980cddf7988f1ab19318a2bb883938d9f`.
The release metadata records the source commit and branch. The prior release
`aviquiz-1c505af041f6e40b` remains available for code rollback. Production-only
dependencies were copied from that release after both package manifests matched
byte-for-byte. No migration was needed. Health, geography metadata, original quiz,
statistics, guest invitation denial, and the unchanged 126 public annotations
were verified after restart.
The service uses `server/http.mjs`, the bundled Worker, and production-only npm
dependencies. Its entrypoint is tested through a release symlink. Production
strips Sites identity headers and verifies account permissions independently.

The staging snapshot was imported transactionally, preserving existing IDs,
identity mapping, grants, review revisions, and audit records:

| Table | Rows |
| --- | ---: |
| app_users | 1 |
| app_identities | 1 |
| app_grants | 1 |
| app_bootstrap | 1 |
| audit_events | 2 |
| photo_reviews | 126 |

Two complete paginated source reads matched before import, and another complete
read after launch still matched. Each destination table matched its source
canonical SHA-256 inside the import transaction. All 126 published annotations
also matched the production public API digest. The source read is a sequence of
pages, not an atomic database snapshot; future migrations should use a write
freeze or an atomic export when available.

Private source snapshot: project `outputs/db-migration-2026-11-19/staging-snapshot.json`
(outside this source checkout), mode 0600. Snapshot SHA-256:
`7bcb63070dbaa60ebe56a8821d88751959f2feabe11a3a8c4364eb7417e18801`.
The protected server copy is `/root/aviquiz-db-setup/staging-snapshot.json`.
Pre-import backup and receipt are in `/root/aviquiz-backups/`, mode 0600.
These files contain private account/review data and must not enter Git or releases.
The import helper refuses a different nonempty destination and supports exact
repeat imports. A post-launch restore must use a separately reviewed recovery plan.

HTTPS health, landing/configuration/statistics/review pages, redirect, public
annotation parity, and denial of guest/forged-header review access passed.
Both services are enabled for boot; initial app memory was about 44 MiB with no
restarts. Interactive production sign-in and browser-data import remain manual
user checks. Browser statistics are not part of this database copy: each user
must export from staging and import at aviquiz.org in each relevant browser.

Private archive/object storage and eBird processing infrastructure are separate
future work. No full archives were copied to this Droplet.


## Database provisioning completed

Created database `aviquiz` on PostgreSQL 18.7, with schema owned by the login
`aviquiz_migrator` and an independent `aviquiz_runtime` application login.
Both have generated high-entropy passwords retained only in root-owned 0600
files on the Droplet. The application environment is `/etc/aviquiz/aviquiz.env`;
migration credentials are `/etc/aviquiz/migration.env`. No doadmin password is
retained in either file. The caller-supplied `/root/aviquiz-db-admin.env` and
intermediate provisioning-state credentials were removed after verification.

The active migration `0001_reviews_accounts.sql` has been applied and its SHA-256
recorded in the database. It is now immutable. PUBLIC access to this database
and schema was revoked; explicit application grants cover the current API:

| Tables | Runtime privileges |
| --- | --- |
| photo_reviews, app_users | SELECT, INSERT, UPDATE |
| app_identities, app_bootstrap, audit_events | SELECT, INSERT |
| app_grants | SELECT, INSERT, DELETE |
| aviquiz_schema_migrations | SELECT |

The runtime role has no superuser, CREATEDB, CREATEROLE or BYPASSRLS attributes,
no database/schema CREATE privileges, and cannot update/delete/truncate audit
rows or write migration history. Future schema changes must explicitly grant
new runtime privileges where required. The runtime role permits up to ten
connections (application pool remains five); the schema-owner role permits two.

Provisioning used `deploy/provision-database.mjs`, copied with the tested driver
and migrations to a root-only setup directory. It reads administrator values
literally, not with shell eval/source, and never prints errors containing secret
values. Generated ASCII passwords are sent to role creation as PostgreSQL
SCRAM-SHA-256 verifiers, not plaintext SQL. A first role-grant attempt returned
0LP01 and rolled back; setup was corrected to use createrole_self_grant and then
completed. Its protected state supports resuming partial setup without rotating
unrelated/existing credentials; after successful cleanup it intentionally does
not rerun against existing objects without a reviewed recovery plan.

Verification used a runtime login over TLS 1.3, an insert/audit transaction that
was rolled back, explicit permission checks, and `deploy/check-database.mjs`
bundled to `/srv/aviquiz/support/db-check.cjs`. The final check ran as user/group
aviquiz through a transient systemd unit using EnvironmentFile loading. It
reported `ready`, database aviquiz, role aviquiz_runtime and SSL enabled. The initial empty-database check preceded the successful data import and public
launch described above.

The invitation release applies additive migration 0002 and dedicated runtime table
grants after a verified native PostgreSQL dump. Certificate authentication and the
expiry timer are installed; the app runs with SupplementaryGroups=aviquiz-auth.
See INVITATIONS.md for backup path, release checks, limits, and pending delivery test.

The delivery correction archive contains app code only. Production dependencies
were copied from the prior immutable release only after package.json and
package-lock.json compared byte-for-byte equal. No schema migration was needed.
