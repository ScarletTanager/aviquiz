#!/usr/bin/env python3
"""One explicit Roles Anywhere authentication probe; never prints credentials."""
import configparser
import datetime
import json
import shlex
import subprocess
import sys

try:
    config = configparser.ConfigParser(interpolation=None)
    config.read('/etc/aviquiz/roles-anywhere/aws-config')
    command = shlex.split(config['profile aviquiz-invitations']['credential_process'])
    if command[0] != '/usr/local/bin/aws_signing_helper' or command[1] != 'credential-process':
        raise ValueError('Unexpected credential command')
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if result.returncode:
        # Raw helper stderr may include signed request or response details.
        print(json.dumps({'authenticated': False, 'helperExitCode': result.returncode, 'detailsWithheld': True}))
        sys.exit(1)
    credentials = json.loads(result.stdout)
    if credentials.get('Version') != 1 or not all(credentials.get(k) for k in ['AccessKeyId','SecretAccessKey','SessionToken','Expiration']):
        raise ValueError('Incomplete credential result')
    expires = datetime.datetime.fromisoformat(credentials['Expiration'].replace('Z','+00:00'))
    if expires <= datetime.datetime.now(datetime.timezone.utc):
        raise ValueError('Expired credential result')
    print(json.dumps({'authenticated': True, 'expiresAt': expires.isoformat(), 'credentialValuesWithheld': True}))
except (Exception,):
    print(json.dumps({'authenticated': False, 'detailsWithheld': True}))
    sys.exit(1)
