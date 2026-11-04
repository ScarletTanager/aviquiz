# Identity and permissions foundation

Implemented November 1, 2026 as server-only library code with isolated database tests. **Not activated:** the deployed Worker does not import these modules, the staged schema is outside `drizzle/`, and no customer signup, session, admin, or route endpoints exist. Current quiz behavior and the owner/agent review boundary remain unchanged. No provider has been selected and no passwords or tokens are stored by this subsystem.

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

Grants are `system.admin`, `experiment.id-tips`, `annotations.read`, `annotations.edit`, and `annotations.publish`. Unknown grants/actions are rejected. These are composable capabilities, not automatic role inheritance: an annotation editor does not receive publication privileges or experimental access merely by being an editor. UI roles can later bundle the appropriate read/edit grants.

`system.admin` authorizes the known privileged operations. `setGrant` requires an administrator and records the target and permission, but intentionally refuses to assign/revoke `system.admin`. Initial administrator bootstrap, last-administrator protection, stronger authentication, recovery, and privileged grant lifecycle must be designed before activation. There is no hardcoded new AviQuiz administrator or self-promotion path; SQL provisioning exists only in the isolated test fixture.

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

## Validation and activation path

Run with Node 24+ from the repository root:

```sh
node test-accounts.mjs
```

Tests apply the existing review migration and staged schema to an in-memory database with foreign keys enabled, preserving an existing review row. They exercise forged identity headers, verification failures, unmapped identities, no email merging, duplicate signup rollback, public guest access, all route-role actions, cross-route/user isolation, publication/experiment separation, grant and membership revocation, disabled accounts, owner/admin deletion, and append-only atomic accounting.

Before activation:

1. Choose the managed provider and verify integration with the target hosting environment. Keep staging and production identities/data separate.
2. Implement and adversarially test the trusted provider adapter and session/CSRF boundary; decide email changes, signup retries, account linking, MFA/assurance for privileged actions, and recovery.
3. Define administrator bootstrap/lifecycle and scoped service identities; never accept arbitrary acting user IDs or trust application roles from client storage.
4. Promote the staged SQL through a new reviewed migration and test migration/backup/recovery on a staging database. Do not manually apply this file to the live database as a shortcut.
5. Add protected HTTP controllers and connect grant checks to experimental/review operations; preserve guest quiz access. Address mutation races, access-denial logging, input/output filtering, and endpoint abuse controls at that boundary.
6. Add route stops and collaboration UI with revision guards, then exercise owner/viewer/contributor/editor/admin flows end to end.

No fake sign-in or test-provider bypass should be deployed. Turnstile is intentionally deferred. Cornell clarification remains a prerequisite for the separate bulk-data integration.

Launch policy subsequently agreed: AviQuiz account creation will be administrator-invited only; public guest quizzes remain permanent. The dormant registration method does not yet implement invitation validation and must not be exposed until expiring, single-use, verified-email-bound invitations and limits are enforced. Route membership for existing users is separate from account invitations. Cognito Essentials is the current candidate, not a provisioned integration; self-service signup must be disabled before launch.

Design references: [OpenID Connect identifiers](https://openid.net/specs/openid-connect-core-1_0.html#SubjectIDTypes), [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
