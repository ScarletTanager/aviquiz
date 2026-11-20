import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

BASE = Path(__file__).resolve().parent
SCRIPT = BASE / 'pki.py'

def run(*args, ok=True):
    result = subprocess.run(['python3', str(SCRIPT), *map(str, args)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert (result.returncode == 0) == ok, result.stderr.decode()
    return result

with tempfile.TemporaryDirectory(prefix='aviquiz-pki-test-') as temp:
    root = Path(temp)
    password = root / 'test-passphrase'
    password.write_text('disposable-test-passphrase\n'); password.chmod(0o600)
    ca, server = root / 'ca', root / 'server'
    run('init-ca', '--directory', ca, '--passphrase-file', password)
    assert (ca / 'ca.key.pem').stat().st_mode & 0o777 == 0o600
    parameters = root / 'parameters.json'
    subprocess.run(['python3', str(BASE / 'parameters.py'), '--ca-certificate', str(ca / 'ca.cert.pem'), '--output', str(parameters)], check=True, stdout=subprocess.DEVNULL)
    assert json.loads(parameters.read_text())[1]['ParameterValue'] == 'false'
    rejected = subprocess.run(['python3', str(BASE / 'parameters.py'), '--ca-certificate', str(ca / 'ca.key.pem'), '--output', str(root / 'bad.json')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert rejected.returncode != 0 and not (root / 'bad.json').exists()
    assert b'ENCRYPTED PRIVATE KEY' in (ca / 'ca.key.pem').read_bytes()
    original = (ca / 'ca.key.pem').read_bytes()
    run('init-ca', '--directory', ca, '--passphrase-file', password, ok=False)
    assert original == (ca / 'ca.key.pem').read_bytes()
    run('csr', '--directory', server)
    assert (server / 'server.key.pem').stat().st_mode & 0o777 == 0o600
    cert = root / 'server.cert.pem'
    run('sign', '--ca-directory', ca, '--csr', server / 'server.csr.pem', '--output', cert, '--passphrase-file', password)
    run('check', '--certificate', cert, '--ca-certificate', ca / 'ca.cert.pem', '--key', server / 'server.key.pem')
    run('check', '--certificate', cert, '--ca-certificate', ca / 'ca.cert.pem', '--days', '91', ok=False)
    run('sign', '--ca-directory', ca, '--csr', server / 'server.csr.pem', '--output', cert, '--passphrase-file', password, ok=False)
    run('csr', '--directory', BASE / 'must-not-create', ok=False)
    other = root / 'other'; run('csr', '--directory', other)
    run('check', '--certificate', cert, '--ca-certificate', ca / 'ca.cert.pem', '--key', other / 'server.key.pem', ok=False)
    wrong = root / 'wrong.csr'
    subprocess.run(['openssl', 'req', '-new', '-key', str(other / 'server.key.pem'), '-subj', '/CN=someone-else', '-out', str(wrong)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run('sign', '--ca-directory', ca, '--csr', wrong, '--output', root / 'wrong.cert', '--passphrase-file', password, ok=False)
    text = subprocess.check_output(['openssl', 'x509', '-in', str(cert), '-text', '-noout']).decode()
    assert 'CA:FALSE' in text and 'Digital Signature' in text
    assert 'sha256WithRSAEncryption' in text

stack = json.loads((BASE / 'stack.json').read_text())
resources = stack['Resources']
assert {r['Type'] for r in resources.values()} == {'AWS::IAM::Role', 'AWS::RolesAnywhere::TrustAnchor', 'AWS::RolesAnywhere::Profile'}
role = resources['InvitationRole']['Properties']
policy = role['Policies'][0]['PolicyDocument']['Statement'][0]
assert policy['Action'] == 'cognito-idp:AdminCreateUser' and '*' not in json.dumps(policy['Resource'])
condition = role['AssumeRolePolicyDocument']['Statement'][0]['Condition']
assert condition['StringEquals']['aws:PrincipalTag/x509Subject/CN'] == 'aviquiz-production-inviter'
assert 'aws:SourceArn' in condition['ArnEquals'] and 'aws:SourceAccount' in condition['StringEquals']
assert stack['Parameters']['Enabled']['Default'] == 'false'
assert resources['InvitationProfile']['Properties']['DurationSeconds'] == 900
print('Passed offline PKI lifecycle, encryption/permissions, overwrite/repository refusal, subject restriction, expiry, key mismatch, and template scope checks. Disposable keys removed. No AWS calls.')
