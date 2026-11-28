# AviQuiz repository instructions

## Production releases

- Develop on dev and push that branch, then run local checks.
- Deploy the exact tested dev commit to staging, preserving its access controls.
- Wait for Sandy to test and explicitly approve the staging result.
- Only then promote the approved source to main and deploy production.
- A separate staging branch is not required. Never deploy uncommitted code to production.
- Commit and push the exact source revision to GitHub before packaging/deploying.
- Build deployment artifacts from that clean, pushed revision, not a dirty tree.
- Record the Git commit SHA in release metadata and deployment documentation.
- Release dates represent initial packaging/tagging, not deployment. Set
  `releaseDate` in `data/releases.json` to the America/New_York calendar date
  (YYYY-MM-DD) before creating/pushing the immutable release tag and staging package.
  Commit regenerated English/Spanish pages before tagging. Carry the same date,
  source commit and tag through staging and production; never redate on promotion.
  Keep the date null only for development candidates not yet packaged/tagged.
- Display release notes newest semantic version first. Clearly identify candidates
  whose capabilities shipped through a later release, preserving their history.
- Public website release notes contain only end-user changes and limitations.
  Record technical workflow details in `docs/releases/<tag>.md` and the matching
  GitHub release notes; never include secrets or private account details there.
- Keep ChatGPT staging unchanged unless its deployment is explicitly requested.
- Preserve the original Colombia quiz and itinerary at least through December 18, 2026.

## Credential safety

- Never commit API keys, private keys, passwords, temporary credentials, protected
  environment files, database exports, or account-data snapshots.
- Read secrets only within the process that needs them; never print them in logs
  or tool output. Public Cognito client/pool IDs and public resource ARNs are not secrets.
- Run a redacted secret scan on the proposed source changes before pushing.
- User confirmation is required before each AWS account action, even reads and
  credential renewal. Documentation searches/retrieval are exempt. The AWS profile
  is aviquiz; specify the service's intended Region explicitly.
