#!/usr/bin/env python3
"""Prepare public-only CloudFormation parameters locally. Makes no AWS calls."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ca-certificate', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source = Path(args.ca_certificate)
public = source.read_text()
if public.count('-----BEGIN CERTIFICATE-----') != 1 or 'PRIVATE KEY' in public:
    raise SystemExit('Provide exactly one public CA certificate, never a private key.')
subprocess.run(['openssl', 'verify', '-CAfile', str(source), str(source)], check=True, stdout=subprocess.DEVNULL)
text = subprocess.check_output(['openssl', 'x509', '-in', str(source), '-text', '-noout']).decode()
if 'CA:TRUE' not in text:
    raise SystemExit('The certificate must be a CA certificate.')
values = [{'ParameterKey':'CaCertificatePem','ParameterValue':public},
          {'ParameterKey':'Enabled','ParameterValue':'false'}]
with Path(args.output).open('x') as handle:
    json.dump(values, handle, indent=2)
    handle.write('\n')
print('Wrote public certificate parameters; AWS resources remain untouched.')
