# Single-user invitations

Deployed to **https://aviquiz.org/invite** on November 19, 2026 in release
`aviquiz-6b23bf6bd925365b`. The invitation migration and runtime grants are applied;
certificate-based sender authentication is configured and enabled. ChatGPT
staging remains unchanged. No live invitation has been sent during deployment.

The native PostgreSQL pre-upgrade backup is
`/root/aviquiz-backups/pre-invitations-2026-11-19T13-55-13.402Z.dump` (34,311 bytes,
mode 0600). Its archive listing was verified. The prior release remains available
for code rollback; the additive invitation tables should be retained on rollback.
Keep the feature disabled if code is rolled back.

Production checks passed for health, invitation page/assets, guest GET/POST
denial, internal administrator access, provider availability, certificate
readability as the service user, and unchanged public annotation digest (126
reviews). The readiness probe made no AWS calls. Interactive invitation delivery
remains an explicit approved-recipient test. Luis Miguel's grant is still pending
his first application sign-in; the database contained one account at deployment.

## User flow and permissions

Signed-in administrators and users explicitly granted `users.invite` see
“Invite a birder” in the main navigation. `/invite` accepts one email address
and disables the form while sending. The server independently checks the
verified identity, active application account, and permission on every request.
Guest quizzes are unchanged. New accounts receive no elevated permissions;
inviters cannot assign grants, review photos, or administer the application
unless separately authorized.

The UI prevents simultaneous submissions; server-side email uniqueness and a
request UUID prevent duplicate sends from tabs or retries. Server-enforced limits
are 5 attempts per inviter and 20 attempts globally in a rolling 24-hour window.
Ambiguous/failed attempts consume quota. A transactional singleton row serializes
reservation across PostgreSQL processes. These small initial limits can be
revisited as adoption grows.

## Account creation and delivery

1. Reserve an `app_invitations` record with actor, normalized email, request ID,
   and timestamps before calling the provider.
2. Create the managed user with delivery suppressed. Obtain the provider's
   stable `sub` and actual username; never merge an existing account by email.
3. In one database transaction, create the ordinary `app_users` record, map
   `(issuer, subject)` to that UUID, update the invitation to `ready`, and append
   `user.invite.prepare` to the audit log. No grants are inserted.
4. Request the managed invitation email with its generated temporary password.
   Neither browser nor application code receives/stores that password.
5. Record `sent` and append `user.invite.send` after provider acceptance.
   Acceptance is not a guarantee of inbox delivery; recipients should check spam.

The local account therefore exists before delivery, and its first verified
sign-in reuses that UUID. `app_users.status` remains the existing active/disabled
model; invitation state is tracked separately, rather than treating email as
a pending identity. The adapter sets `email_verified=true` for this controlled
admin-created invitation flow: sign-in requires the temporary password delivered
to that mailbox and a new permanent password. This is not general email-based
account linking. Alias takeover is explicitly disabled.

Provider calls use AWS SDK v3 on Node only, pinned in package-lock.json, with one
attempt and bounded HTTP timeouts. The existing pool/region comes from trusted
server AUTH_ISSUER; clients cannot choose another pool or grant permissions.
The browser calls only `/api/invitations` with its usual signed-in assertion.

Official API semantics: [AdminCreateUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html).

## Failure and recovery

The external provider and application database cannot share a transaction.
Crashes/timeouts can leave `preparing`, `ready`, or `needs_attention` records.
The application never automatically deletes a managed user, attaches an existing
identity by email, resets an existing user's password, or retries an uncertain
send. Repeated requests return a conflict; an exact completed request returns
success without sending again. The UI displays a request reference and stops
submissions after an uncertain result. Error responses contain no provider
exception, email message, credentials, or passwords.

An administrator should inspect the full invitation and relevant audit records
using that request reference, then determine actual provider state before any
repair. Provider inspection or resend by the agent still requires explicit AWS
approval. `provider_username` temporarily holds an internal claim UUID before
provisioning succeeds; only `ready`/`sent` rows guarantee it contains the actual
provider username. A crash after external creation but before database commit
requires manual reconciliation using the confirmed provider subject. Do not
delete an invitation row and press Send again as a recovery procedure.

Email addresses already in the local database are rejected. Accounts created
directly in Cognito, such as Luis Miguel's, should sign in once to enroll normally;
do not use this screen to resend their console-created invitation.

## Activation checklist

- Back up production using a full native PostgreSQL backup or managed snapshot,
  including all tables. The original version-1 staging transfer helper covers
  only the original six tables and is not a continuing full-backup tool.
- Apply new immutable migration `0002_invitations.sql`. SQLite/D1 has its
  corresponding additive migration and journal entry; existing migrations are
  unchanged. Do not deploy changes to ChatGPT staging without a separate release.
- Apply `deploy/invitations-runtime-grants.sql` as schema owner for the dedicated
  runtime role. No audit mutation or schema privileges are added.
- Configure a dedicated server identity with only
  `cognito-idp:AdminCreateUser` on the existing pool. The reviewed policy template
  is `deploy/invitation-sender-policy.json`; replace the account ID placeholder.
  See [AWS's authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cognito-idp.html).
  Do not use the operator's privileged profile or add this permission to a
  browser identity. Credential provisioning/storage is a separate approved step;
  no credentials or new IAM resources are included in this change.
- Ensure AUTH_ENABLED=true, the existing trusted AUTH_ISSUER is set, and explicitly
  set INVITATIONS_ENABLED=true only on the intended production server.
- Deploy the built Node release and verify an authorized GET to `/api/invitations`
  reports available. Confirm guest/ordinary-user denial. No AWS call is made by
  GET or during construction of the SDK client.
- Review the current managed invitation email template: it must contain username
  and temporary-password placeholders and should direct recipients to
  https://aviquiz.org. Test with one explicitly authorized recipient; no test
  recipient was created as part of automated tests.
- Keep the AWS sender disabled in staging for now, since the same pool/client is
  shared. The existing ChatGPT gate remains in place.

## Validation

`node test-invitations.mjs` covers permission/configuration UI, one submission
at a time, malformed inputs, cross-origin denial, stable identity precreation,
zero elevated grants, enrollment reuse, duplicate/racing requests, ambiguous
creation and email failure, no automatic retry, rolling personal/global limits,
disabled inviters, and audit records. The SDK is mocked: no AWS calls or emails.
`npm run test:database` runs the same service checks against SQLite and a temporary
real PostgreSQL instance. CI also runs PostgreSQL 17 and 18.

Certificate-based sender preparation now lives in [deploy/roles-anywhere/README.md](deploy/roles-anywhere/README.md). It includes the offline CA/CSR/signing workflow, a disabled-by-default CloudFormation stack, SDK credential-process configuration, expiry checks, and recovery instructions. The production resource state and completed authentication probe are recorded there.

## Invitation delivery correction, November 19, 2026

CloudTrail confirmed an InvalidParameterException (Username should be an email)
on the first live RESEND attempt. Account creation with SUPPRESS succeeded. The
provider now passes the invitation email to RESEND while retaining issuer/subject
for identity mapping. Mocked SDK regression and real SQLite/PostgreSQL checks
passed; the corrected release is deployed. Failure responses distinguish account
setup from unconfirmed email delivery; audit attention records include a safe
stage and error category. The UI separates support references from outcomes and
avoids telling administrators to contact themselves. No automatic resend was
performed. Existing pending accounts must be recovered through separately
approved resend calls, not deletion/recreation or invitation-row deletion.
