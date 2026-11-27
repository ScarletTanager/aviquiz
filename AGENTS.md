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
- Every production deployment must finalize `productionDeployedAt` for that release
  in `data/releases.json` with the production cutover date (YYYY-MM-DD,
  America/New_York), regenerate and commit the release pages before tagging/packaging,
  and verify the live notes afterward. Keep the date null during development/staging;
  specifically, do not date `v0.2.0-alpha.1` until its production deployment.
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
