"""Exercise real Gitleaks rules in a disposable directory, never real credentials."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
scanner = os.environ.get("GITLEAKS_BIN") or shutil.which("gitleaks")
if not scanner:
    raise SystemExit("Install the pinned Gitleaks scanner first.")
with tempfile.TemporaryDirectory(prefix="aviquiz-secret-rules-") as directory:
    fixture = Path(directory)
    token = secrets.token_hex(24)
    # Construct variable names so the test source never resembles a live assignment.
    names = ["EBIRD_" + "API_TOKEN", "REVIEW_" + "AGENT_KEY", "siwc_" + "bypass_bearer_token"]
    for index, name in enumerate(names):
        (fixture / f"assigned-{index}.txt").write_text(f'{name}="{token}"\n')
    (fixture / ".review-agent.json").write_text(json.dumps({"key": token}))
    report = fixture.parent / (fixture.name + "-report.json")
    try:
        result = subprocess.run([
            scanner, "dir", str(fixture), "--config", str(root / ".gitleaks.toml"),
            "--redact=100", "--no-banner", "--report-format", "json", "--report-path", str(report)
        ], capture_output=True, text=True)
        if result.returncode != 1 or not report.exists():
            # Do not print subprocess output or fixture contents, even on failure.
            raise SystemExit("Gitleaks did not report the expected synthetic leaks.")
        findings = json.loads(report.read_text())
        detected = {Path(finding["File"]).name for finding in findings
                    if finding["RuleID"].startswith("aviquiz-")}
        expected = {f"assigned-{index}.txt" for index in range(len(names))} | {".review-agent.json"}
        if not expected <= detected:
            raise SystemExit("A custom secret detection case failed.")
        if token in report.read_text():
            raise SystemExit("Scanner report was not fully redacted.")
    finally:
        report.unlink(missing_ok=True)
print("Passed custom secret rules: assigned service tokens and local review-key file; redacted reports.")
