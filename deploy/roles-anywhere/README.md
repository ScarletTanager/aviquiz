# AviQuiz certificate authentication preparation

Updated November 19, 2026. The approved stack is UPDATE_COMPLETE with its
Enabled parameter true. Public resource ARNs are recorded in production-resources.json.
Sandy created the offline CA; the server key and CSR were generated on the Droplet
in /root/aviquiz-inviter-request-20261119. Only the public CSR was copied locally
to /Users/sandy/col_birding/aviquiz-inviter-server.csr.pem. The signed server certificate (expires February 17, 2027), helper 1.8.6 (official
SHA-256 verified), protected SDK configuration, systemd drop-in, and daily expiry
timer are now installed. The chain/key and expiry checks passed. The application has now been restarted with the certificate-reader group; its
health and internal administrator invitation-readiness checks passed. AWS enabling is complete. The approved CreateSession probe succeeded as the
aviquiz service user, with temporary credentials kept out of output. The
application invitation release/migration are deployed. An approved live delivery
test remains outstanding. The CA private key was never copied to the Droplet.
They use OpenSSL 3+ and Python 3 standard libraries. No paid CA or IAM user is
needed. The CA is dedicated to production invitation sending.

## First action for Sandy: create and back up the CA

Run this yourself in a local terminal. The target directory must not already
exist and must be outside this repository. Choose a strong CA-key passphrase
when OpenSSL prompts; it will prompt again when issuing the CA certificate.
Do not send that passphrase or the CA private key to the agent.

```sh
python3 /Users/sandy/col_birding/sites/colombia-bird-quiz/deploy/roles-anywhere/pki.py init-ca \
  --directory "$HOME/aviquiz-offline-ca"
```

The directory contains an encrypted 3072-bit RSA CA private key (`ca.key.pem`),
public CA certificate (`ca.cert.pem`), and public OpenSSL configuration. Directory
mode is 0700 and files are 0600. Back up the directory in protected offline
storage; store the passphrase separately in your password manager. Do not put it
on the Droplet, in Git, a chat, or an unencrypted shared folder. Losing it prevents
renewal under this anchor. The CA lasts ten years; its replacement still needs
planning well before expiry. Only the PUBLIC ca.cert.pem is needed by AWS/the
agent. The optional --passphrase-file flag is for protected-file automation/test
fixtures; normal user setup should use the interactive prompt.

## Subsequent coordinated steps

1. The agent generates the server key/CSR on the Droplet, in a NEW protected
   directory, using `pki.py csr --directory /root/aviquiz-inviter-request-YYYYMMDD`.
   Copy only server.csr.pem back to Sandy. The server key never leaves that host.
2. Sandy verifies that the CSR came from the intended Droplet and signs it locally:

   ```sh
   python3 /Users/sandy/col_birding/sites/colombia-bird-quiz/deploy/roles-anywhere/pki.py sign \
     --ca-directory "$HOME/aviquiz-offline-ca" \
     --csr /absolute/path/server.csr.pem \
     --output /absolute/new/path/server.cert.pem
   ```

   This issues a 90-day certificate with the exact production subject and
   digitalSignature/clientAuth usage; CSR extensions are not copied. The serial
   is random. The script refuses a different CSR subject or an existing output.
   Return only server.cert.pem and public ca.cert.pem to the agent.
3. Prepare a local CloudFormation parameter file containing the public CA PEM,
   then review stack.json and a change set. Creating the change set is an AWS
   action and requires separate confirmation, as does executing it. Use profile
   aviquiz and explicitly select us-east-2 (the CLI default is us-east-1).
   The stack creates exactly one trust anchor, role, and profile. It references
   the existing pool and grants only AdminCreateUser; it creates no Cognito pool,
   IAM user, access key, CA service, or application user. CAPABILITY_IAM is needed.
   Enabled defaults to false for both anchor/profile; enabling is a later reviewed
   update. Do not create duplicate console resources alongside the stack.
4. Install the official Linux amd64 aws_signing_helper after pinning and verifying
   the release/checksum from AWS's official release source. No helper binary is
   bundled here and none has been installed by this preparation.
5. Install server key and signed/public certificates under
   /etc/aviquiz/roles-anywhere, directory root:aviquiz-auth 0750 and key root:aviquiz-auth
   0640. Create the dedicated AviQuiz authentication-reader group `aviquiz-auth`
   first; add only the service account through the systemd SupplementaryGroups
   setting. The current deploy account belongs to aviquiz, so do not reuse that
   group for certificate-directory access. Never copy the CA
   key. Granting deploy access to trusted application code still permits indirect
   access through that code; OS file permissions do not isolate a malicious
   deployer from the runtime.
6. Populate aws-config.example from actual stack outputs and install as aws-config
   in that directory, readable by the service. Install systemd-override.conf as
   a service drop-in. It selects the credential_process profile, disables IMDS,
   and removes environment-based credential providers. Ensure no static-key or
   container-credential settings remain in the service environment. The configured
   no-static-credentials path must not contain a credentials file.
7. Install certificate-check.service as aviquiz-certificate-check.service and the
   timer as aviquiz-certificate-check.timer. Enable the timer. It fails when the
   server cert has less than 30 days or the CA less than 90 days remaining.
   Check failure with systemctl --failed and journalctl. This is a local failure
   signal only, not an email/page. Connect an operator alert before relying on it
   as unattended monitoring; no notification channel is configured yet.
8. With explicit permission, test authentication without displaying temporary
   credentials. Do not run credential-process directly into tool output. Run an
   approved SDK/CLI operation whose output contains only the requested result.
   Even a GetCallerIdentity probe is an AWS action requiring confirmation.
9. Follow INVITATIONS.md for full PostgreSQL backup, migration, runtime grants,
   release deployment and enabling invitations. Test with an approved recipient.
   Keep staging unchanged and its sender disabled.

## Renewal and incident recovery

Renew around day 60, leaving at least 30 days of overlap. Generate a fresh server
key/CSR in a new protected directory and have Sandy sign it with the offline CA.
Verify chain, subject, expiry and key match using `pki.py check` before installing.
Keep a compatible old certificate/key pair temporarily for rollback. Switch the
pair together (for example via a versioned directory and atomic symlink) and
restart the service, then perform an approved AWS operation. Do not rotate the
CA or change the subject during an ordinary server renewal.

If a server key is compromised, disable the Roles Anywhere profile/anchor to
stop new sessions and use the IAM role's active-session revocation mechanism
when immediate termination is required. Existing sessions are not guaranteed to
end merely because issuance was disabled. Certificates can be revoked using a
properly configured CRL, but no CRL pipeline is included in this first version;
certificate rotation alone is not revocation of the old cert. All AWS incident
operations require their own confirmation. Rotate the server key and reconcile
any affected invitations/audit records before re-enabling. If the CA key is
compromised, replace the CA/trust configuration as well.

Stopping or breaking this sender must leave guest quizzes and ordinary sign-in
available. Disable INVITATIONS_ENABLED in the application for an invitation-only
outage. Do not remove the shared Cognito pool or change staging access controls.

## Offline verification

```sh
python3 -B deploy/roles-anywhere/test-pki.py
uv tool run --from cfn-lint cfn-lint deploy/roles-anywhere/stack.json
```

The PKI test creates disposable encrypted CA/server keys in a temporary directory,
checks permissions, signing, expiry, wrong keys/subjects, overwrite refusal and
repository-output refusal, then deletes its fixtures. It creates no real
production identity and calls no AWS APIs. Account-aware CloudFormation validation
and a real certificate session remain deployment-time checks requiring approval.

References: [Roles Anywhere trust model](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/trust-model.html),
[SDK credential helper](https://docs.aws.amazon.com/sdkref/latest/guide/access-rolesanywhere.html),
[CloudFormation profile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rolesanywhere-profile.html).
