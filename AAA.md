# Identity and permissions foundation

The account/identity portion is active as of November 18, 2026: Cognito sign-in
connects to permanent AviQuiz user IDs in D1, with one-time owner administrator
bootstrap. Guest quizzes remain available. Route collaboration services remain
staged, and delegated invitation/review interfaces are not yet connected. No
passwords or provider tokens are stored in D1. See the active backend section
below for the deployed verification and bootstrap boundaries.

## Boundaries and implemented interfaces

| File | Interface / purpose |
| --- | --- |
| `worker/identity.mjs` | `resolvePrincipal(request, {db, verifyIdentity})` maps a verified `(issuer, subject)` pair to an immutable AviQuiz user ID. Anonymous requests need no database lookup. Unknown identities do not automatically create accounts. |
| `worker/permissions.mjs` | Pure deny-by-default checks for global grants, feature availability, and a specific route's ownership/membership. |
| `worker/accounts.mjs` | Server-internal account registration and grant/route sharing services. Reloads actor grants for each call, checks object access, and commits mutations and audit events together. |
| `schema/identity-routes.sql` | Staged SQLite-compatible tables and constraints, tested with the current D1-shaped adapter. This is not a registered production migration. |
| `test-accounts.mjs` | Real SQLite tests for identity isolation, privileges, route boundaries, constraints, revocation, and audit rollback. |

The `verifyIdentity` function is the deliberately small provider adapter seam. It must use a supported authentication/session library to validate credentials and return either `null` (no credentials) or `{issuer, subject, email, emailVerified}` from trusted, verified provider claims. Invalid credentials must raise an error, not silently become a signed-in user. Issuer and subject are exact, case-sensitive identifiers; email is not an identity key.

Before a real adapter is accepted, test issuer allowlisting, signature validation and key rotation, audience, token lifetime and intended token use, and applicable state/nonce/PKCE/session protections. Do not pass decoded unverified JWTs, request headers, request bodies, or localStorage claims to these services. The structural `verifiedIdentity` validator is **not cryptographic authentication**. Current Sites headers are not an independent AviQuiz provider adapter.

The future controller resolves the actor server-side and passes the resulting internal user ID to service calls. It must never let a caller supply an acting user ID. `readRoute(null, id)` intentionally supports guest access to public routes. An account disabled in the database is treated as unauthenticated for public reading, and cannot perform protected mutations. No long-lived grant cache is introduced; each new resolution/call sees revocation.

## Identity and registration

- `app_users.id` is a random UUID, separate from provider identifiers. Routes, grants, and audit events reference it.
- `app_identities` has a composite primary key of issuer and subject. A subject at another issuer is a different identity.
- Explicit `registerVerifiedUser` requires a provider-verified email and creates a user with no global grants. It is intended only for a trusted signup callback after authentication.
- Equal email addresses never merge accounts. Email is not unique in this initial schema because it is not sufficient to establish identity. Duplicate issuer/subject registrations fail atomically without orphan users or audit records; the future controller must handle signup retries.
- Provider migration/account linking requires explicit verified ownership of both identities. No linking endpoint or method exists yet. Ownership transfer and account deletion/recovery also need deliberate workflows.

## Global grants and features

Grants are `users.invite`, `system.admin`, `experiment.id-tips`, `annotations.read`, `annotations.edit`, and `annotations.publish`. Unknown grants/actions are rejected. These are composable capabilities, not automatic role inheritance: an annotation editor does not receive publication privileges or experimental access merely by being an editor. UI roles can later bundle the appropriate read/edit grants.

`system.admin` authorizes the known privileged operations. `setGrant` requires an administrator and records the target and permission, but intentionally refuses to assign/revoke `system.admin`. Initial administrator bootstrap now uses the constrained one-time owner workflow described below. Additional administrator assignment, last-administrator protection, stronger authentication, recovery, and privileged grant lifecycle remain separate work; no general self-promotion endpoint exists.

`canUseExperiment` requires both a trusted global enable switch and the user's grant. The implemented feature key is `id-tips`; unknown features fail closed. No feature gate has yet replaced the existing public experimental checkbox or review API authorization. Agent/service identities and narrower annotation permissions must be integrated explicitly before that change.

`quiz.practice` is always allowed. Public-route read/practice is also permitted without an account. Private routes require ownership, a valid per-route membership, or administrative access. The hosting environment's outer access gate is a separate concern.

## Route permissions and persistence

| Relationship | Read / practice | Add sites | Remove sites / edit details | Sharing / visibility | Delete |
| --- | --- | --- | --- | --- | --- |
| Guest / non-member, public route | Yes | No | No | No | No |
| Guest / non-member, private route | No | No | No | No | No |
| Viewer | Yes | No | No | No | No |
| Contributor | Yes | Yes | No | No | No |
| Editor | Yes | Yes | Yes | No | No |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Administrator | Yes | Yes | Yes | Yes | Yes |

Membership is scoped to an exact `(route_id, user_id)` pair; a role from one route cannot authorize another. Ownership is a separate foreign key, not a membership role. Membership updates cannot change ownership. Contributors/editors cannot reshare or delete a route.

The service implements creation of a route shell (always private), authorized reading, assigning/removing existing-user membership, changing visibility, and soft deletion. Soft-deleted routes are inaccessible through normal reads, including admin reads; a future administrative restore workflow is separate. Authorized clients receive the route shell, not a generated species list.

The policy expresses future site-editing rights, but **ordered route stops, stop mutations, dates, revisions/conflict handling, route listing/search, invitations/email delivery, public discovery, ownership transfer, restoration, and quiz integration are not implemented**. There is no eBird ingestion. No promise of production concurrency behavior or complete route management is made by these foundations.

## Accounting and storage

Every successful mutation in `accountService` uses `db.batch` to write its audit event in the same transaction. The database adapter must guarantee atomic batch execution; this is tested against real SQLite and is a required contract for any future storage adapter. Failed audit insertion rolls back the associated mutation. SQL triggers prevent application SQL from updating/deleting audit rows. Provider database administrators remain trusted and can change schema; this is not an external tamper-proof audit service.

Audit events contain actor ID, action, resource type/ID, narrowly selected change details, and time. Registration events do not contain provider tokens or email. This is not full event sourcing or an authentication log: denied actions, login/session events, administrative recovery, retention/anonymization, and operational monitoring still require integration. The current review system is not being retroactively audited by this library.

## Validation and remaining activation work

Run with Node 24+ from the repository root:

```sh
node test-accounts.mjs
```

Tests apply the existing review migration and staged schema to an in-memory database with foreign keys enabled, preserving an existing review row. They exercise forged identity headers, verification failures, unmapped identities, no email merging, duplicate signup rollback, public guest access, all route-role actions, cross-route/user isolation, publication/experiment separation, grant and membership revocation, disabled accounts, owner/admin deletion, and append-only atomic accounting.

For the remaining staged features:

1. Cognito is the selected provider. Its browser login was tested by Sandy; test the new backend account linkage after deployment. Keep staging and production identities/data separate.
2. Implement and adversarially test the trusted provider adapter and session/CSRF boundary; decide email changes, signup retries, account linking, MFA/assurance for privileged actions, and recovery.
3. Define administrator bootstrap/lifecycle and scoped service identities; never accept arbitrary acting user IDs or trust application roles from client storage.
4. The account tables are promoted through drizzle/0001_accounts.sql. Route tables remain staged; use a new reviewed migration when activating them. Do not manually apply the entire staged file to the live database.
5. Add protected HTTP controllers and connect grant checks to experimental/review operations; preserve guest quiz access. Address mutation races, access-denial logging, input/output filtering, and endpoint abuse controls at that boundary.
6. Add route stops and collaboration UI with revision guards, then exercise owner/viewer/contributor/editor/admin flows end to end.

No fake sign-in or test-provider bypass should be deployed. Turnstile is intentionally deferred. Cornell clarification remains a prerequisite for the separate bulk-data integration.

Launch policy subsequently agreed: AviQuiz account creation will be administrator-invited only; public guest quizzes remain permanent. The dormant registration method does not yet implement invitation validation and must not be exposed until expiring, single-use, verified-email-bound invitations and limits are enforced. Route membership for existing users is separate from account invitations. Cognito Essentials is the current candidate, not a provisioned integration; self-service signup must be disabled before launch.

Design references: [OpenID Connect identifiers](https://openid.net/specs/openid-connect-core-1_0.html#SubjectIDTypes), [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Cognito browser integration

`oidc-client-ts` 3.5.0 is pinned in package.json/package-lock.json. Run `npm ci`
and `npm run build:auth` to refresh the tracked browser ESM distribution and its
license. The Worker build embeds this asset; production needs no npm runtime.
Weekly Dependabot updates include npm dependencies.

`dist/auth-config.mjs` contains public identifiers supplied from the console for
“User pool - lfvjoz” (us-east-2). These have not been checked against AWS. The CLI
profile's default region us-east-1 does not change the pool's region. Confirm
that the supplied pool ID and client ID belong to this pool before enabling.

Before activation, set the actual Cognito managed-login domain, exact callback
URL (recommended `/auth/callback` on the selected host), and logout return URL.
Register those exact URLs on the public Cognito app client, enable authorization
code grant and openid/email scopes, and confirm invite-only registration settings.
Then set `enabled: true`. The current staging configuration is enabled using the
Cognito domain and registered URLs supplied by Sandy. Use a separate configuration/app client for each host
if needed; return URLs are validated against the current origin. AWS changes
require Sandy's individual confirmation. No discovery or auth requests occur
while disabled.

The frontend uses the library's code/PKCE redirect flow and callback processing,
with OIDC state and user data in sessionStorage. It does not render or log tokens. It sends the ID-token identity assertion only to the same-origin account API.
Automatic silent renewal is disabled per the library's Cognito guidance; expired
sessions require sign-in again. Sign-out clears this tab's stored session and
redirects to Cognito logout; this is not a global token-revocation guarantee.
Callback parameters are cleared after processing. Quizzes remain available to
guests. This browser account state is not authorization: the server verifies Cognito identity before account registration or administrator
bootstrap; statistics remain browser-local. The legacy photo-review controller
still uses its existing Sites-owner/agent authorization pending delegated review
UI integration.

Verify locally with `node test-auth.mjs`. A live sign-in round trip is pending user testing; configuration tests are not
proof of a working AWS login.


## Active backend account identity and administrator setup

The server verifies Cognito ID-token assertions using `jose`, the fixed deployed
issuer/app-client audience, RS256 signatures, expiry, subject and `token_use=id`.
The only key source is that issuer's public JWKS URL, cached with timeout and
rotation cooldown. These account endpoints accept an ID token as an identity
assertion, not as an OAuth scope-bearing API access token. Tokens, JWT contents,
and provider errors are never returned in errors or audit records. They are not
stored in D1. Public keys are fetched at runtime when a signed-in visitor first
uses the backend; no AWS management API credentials are needed.

`POST /api/account/enroll` maps a provider-verified email identity's exact
`(issuer, subject)` to a permanent generated AviQuiz UUID. It does not merge by
email or accept request-supplied identity claims. Repeated enrollment reuses the
mapping; disabled accounts are rejected. Email in app_users is the registration
snapshot, not a sign-in key. `GET /api/account` reads current permissions. Guests
remain guests and may practice without registration. POSTs require same-origin
JSON requests. Invalid bearer assertions fail closed; guest routes do not require
a token. Cognito token revocation/disable is not checked online on every request;
a valid issued token can remain valid until expiry. AviQuiz account disable and
grant revocation are loaded afresh from D1 per request.

On the owner's next signed-in page load, the browser enrolls the account and
calls `POST /api/account/bootstrap` only when the server reports eligibility.
Eligibility requires BOTH the existing Sites-authenticated owner AND a
cryptographically verified Cognito email matching the deployment's existing
REVIEW_OWNER_EMAIL. This special email check authorizes initial bootstrap only;
normal identity linkage uses issuer/subject. It does not make the first visitor
an administrator. A singleton app_bootstrap record consumes this one-time path,
and an atomic batch creates the system.admin grant and append-only audit record.
Automatic setup cannot restore a removed grant after bootstrap is consumed.
Administrator replacement/recovery requires a separately reviewed operation.

This bootstrap trusts Sites-injected headers ONLY behind the current Sites
hosting boundary. Remove it before hosting elsewhere; these headers are not
trusted identity on a public DigitalOcean origin. Never grant admin based only
on email, a browser role, Cognito group claims, or order of registration.

`users.invite` is a separate allowed backend capability. Administrators inherit
it, but an explicitly granted inviter gains no other privileges. No non-admin
has been granted it and no Cognito invitation endpoint exists yet. The planned
AviQuiz invitation form will check this grant server-side, audit invitations,
and create ordinary invited accounts without allowing the inviter to choose
roles. Luis Miguel can receive this grant after his verified account is linked;
he will not need AWS console access. Adding that endpoint requires separately
scoped AWS runtime access and abuse/cost controls, with Sandy's approval.

The active migration `drizzle/0001_accounts.sql` adds account, identity, grant,
audit, and bootstrap tables without altering existing photo reviews. The route
portion of schema/identity-routes.sql remains staged. Account and JWT tests use
local generated signing keys and SQLite, with no AWS requests. Run
`node test-account-api.mjs`, `node test-accounts.mjs`, and the existing quiz/review
regressions. Refresh a signed-in page to finish the real owner bootstrap; the
status line should say “AviQuiz administrator”.
# Invitation screen implementation (November 19, 2026)

Single-recipient invitation UI, audited account provisioning, and the server-only
provider adapter are deployed in DigitalOcean production with certificate-based
sender authentication. See [INVITATIONS.md](INVITATIONS.md) for the current design,
limits, failure recovery and deployment checklist. New users receive no grants;
only active administrators or explicit `users.invite` holders can send invitations.
