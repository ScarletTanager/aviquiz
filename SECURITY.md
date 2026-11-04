# Security checks and reporting

## Automated checks

`.github/workflows/security.yml` runs on pull requests, pushes to `main`, manual dispatch, and Tuesdays at 09:23 UTC. It includes:

- Quiz and authorization regression tests, including the live review API against isolated SQLite, dormant route/account permissions, experimental-statistics exclusions, and site-context behavior. No production database or credentials are used.
- Gitleaks full-history scanning of fetched refs, using built-in rules plus `.gitleaks.toml` rules for eBird, review-agent, and Sites service tokens. Synthetic fixtures exercise the custom rules and verify redaction. Scanner binaries are version/checksum pinned; reports and console output are redacted, and secret reports are not uploaded as artifacts.
- `pip-audit` checks of the explicit direct/transitive dependencies in `requirements-dev.txt`. These belong to offline Python preparation; the Worker has no npm package dependencies to audit today. Adding dependencies requires updating the inventory and the audit coverage.

`.github/workflows/codeql.yml` runs on the same events, with its weekly schedule at 09:41 UTC. JavaScript/TypeScript, Python, and GitHub Actions are analyzed using `security-extended`. Authored code inside `dist/` is included. Only generated `dist/server` and `dist/.openai` output is excluded in the CodeQL configuration.

CodeQL publishes findings in the repository's Security / Code scanning view. A successful analysis job means the scanner ran, not that it found zero vulnerabilities. Review alerts separately. Branch protection / mandatory merge checks are not configured by these workflows; establish those after the initial baseline has been reviewed.

Actions are pinned to full commit hashes and checkout credentials are not persisted. Only CodeQL jobs receive `security-events: write` for uploading analysis; other jobs use read-only repository access. Workflows use `pull_request`, never `pull_request_target` to execute untrusted pull-request code. They receive no AWS, Cognito, Sites, review-agent, or eBird application secrets and do not deploy the site.

`.github/dependabot.yml` requests weekly GitHub Actions and Python version-update PRs. These are intentionally enabled and reviewed before merging; there is no automatic merge configuration. Separately, the owner enabled Dependabot alerts but did not enable automatic security-update PRs. Review scanner/tool version changes and any associated checksums together; the Gitleaks checksum and pip-audit pin require deliberate maintenance because those inline version strings are not managed by this Dependabot configuration.

## Repository settings

On November 4, 2026, the owner confirmed the repository's **Settings / Code security** configuration:

1. Secret scanning was already enabled.
2. Secret scanning push protection was already enabled.
3. Dependabot alerts are enabled; automatic dependency security-update PRs are not enabled.

The setup token can write repository content but received HTTP 403 attempting to manage these settings and read CodeQL alerts. The status above is owner-confirmed, not independently read through that token. No broader token is needed for the current workflows. CodeQL uses an advanced workflow; GitHub default setup should be disabled if it conflicts with that workflow. If GitHub policy blocks CodeQL uploads, check code-scanning availability/settings and the run diagnostics.

Gitleaks in CI runs after code is pushed; it does not prevent the initial publication of a secret. Push protection is a separate GitHub control, and supported-token pattern coverage is not universal. If a genuine key is found, revoke/rotate it first, assess exposure, and coordinate history cleanup without forcing away collaborators' work. Do not suppress real leaks merely to make a check green.

## Local checks

With Node 24+, run the test/build commands in [RUNBOOK.md](RUNBOOK.md). For dependency auditing, use a disposable Python environment rather than changing the Codex bundled runtime:

```sh
python3 -m venv /private/tmp/aviquiz-audit
/private/tmp/aviquiz-audit/bin/python -m pip install 'pip-audit==2.10.1'
/private/tmp/aviquiz-audit/bin/python -m pip_audit --strict --no-deps --disable-pip -r requirements-dev.txt
```

Python 3.10+ is required for the pinned audit tool. This audits the declared package versions using advisory services; a clean result is not proof of safe application behavior or of every tool in an operator's environment being patched.

With Gitleaks 8.30.1 installed from its official verified release:

```sh
python3 scripts/test-secret-rules.py
gitleaks git --config .gitleaks.toml --log-opts="--all" --redact=100 --exit-code 1 --no-banner
```

History scans cover commits, not uncommitted files. `.review-agent.json` and local environment files must remain outside Git. Do not run an unredacted directory scan over a workspace containing actual credentials and paste its output into issues or chat.

## Scope and reporting

Automated scans complement a focused manual review. They cannot establish the correctness of route sharing, guest access, per-user privileges, or a future eBird API proxy's endpoint allowlist, validation, rate limits, caching, and token isolation. Tests and security review must evolve with those features. Current authentication/route foundations remain dormant as described in [AAA.md](AAA.md).

Do not put credentials, private drafts, personal data, or exploit details in a public issue. Contact the maintainer privately; use GitHub private vulnerability reporting if it is available/enabled for the repository. No dedicated security response SLA or bounty program exists.
