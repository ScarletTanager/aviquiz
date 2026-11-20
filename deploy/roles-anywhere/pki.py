#!/usr/bin/env python3
"""Offline PKI preparation. Never calls AWS or prints private key material."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import sys

SUBJECT = '/O=AviQuiz/OU=production/CN=aviquiz-production-inviter'
CA_SUBJECT = '/O=AviQuiz/CN=AviQuiz Production Invitation CA'
REPO = next((p for p in Path(__file__).resolve().parents if (p / '.git').exists()), None)

def openssl(*args, capture=False):
    result = subprocess.run(['openssl', *map(str, args)], check=True,
                            stdout=subprocess.PIPE if capture else subprocess.DEVNULL)
    return result.stdout if capture else None

def new_directory(value):
    path = Path(value).expanduser().absolute()
    resolved = path.resolve()
    if REPO is not None and (resolved == REPO or REPO in resolved.parents):
        raise ValueError('Private output must be outside the repository.')
    # mkdir without exist_ok refuses reuse, symlinks, and overwriting keys.
    path.mkdir(mode=0o700)
    return path

def pass_args(args, option):
    if not args.passphrase_file:
        return []  # OpenSSL prompts in the user's terminal.
    path = Path(args.passphrase_file).expanduser().resolve()
    if path.stat().st_mode & 0o077:
        raise ValueError('Passphrase file must be mode 0600 or stricter.')
    return [option, 'file:' + str(path)]

def init_ca(args):
    password = pass_args(args, '-pass')
    folder = new_directory(args.directory)
    key, cert = folder / 'ca.key.pem', folder / 'ca.cert.pem'
    config = folder / 'ca.cnf'
    config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\n'
                      'basicConstraints=critical,CA:true,pathlen:0\n'
                      'keyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n')
    openssl('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072',
            '-aes-256-cbc', *password, '-out', key)
    openssl('req', '-new', '-x509', '-sha256', '-days', '3650', '-key', key,
            *pass_args(args, '-passin'), '-subj', CA_SUBJECT, '-config', config, '-out', cert)
    print('Created encrypted CA key and public CA certificate in ' + str(folder))
    print('Keep the CA key and its passphrase private; back them up separately.')

def csr(args):
    folder = new_directory(args.directory)
    openssl('req', '-new', '-newkey', 'rsa:3072', '-noenc', '-sha256',
            '-keyout', folder / 'server.key.pem', '-out', folder / 'server.csr.pem',
            '-subj', SUBJECT)
    print('Created server key and public CSR in ' + str(folder))

def sign(args):
    ca = Path(args.ca_directory).expanduser().resolve()
    csr_path = Path(args.csr).expanduser().resolve()
    output = Path(args.output).expanduser().absolute()
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing to overwrite an existing certificate.')
    openssl('req', '-in', csr_path, '-verify', '-noout')
    # Check the public CSR's exact subject; do not sign arbitrary CSR identities.
    subject = openssl('req', '-in', csr_path, '-noout', '-subject', '-nameopt', 'RFC2253', capture=True).decode().strip()
    if subject != 'subject=CN=aviquiz-production-inviter,OU=production,O=AviQuiz':
        raise ValueError('CSR subject is not the dedicated production inviter.')
    openssl('x509', '-in', ca / 'ca.cert.pem', '-checkend', str(91 * 86400), '-noout')
    extensions = output.with_suffix(output.suffix + '.extensions')
    # Exclusive creation prevents accidental replacement or symlink following.
    with extensions.open('x') as handle:
        handle.write('basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\n'
                     'extendedKeyUsage=clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    try:
        with output.open('xb') as handle:
            completed = subprocess.run(['openssl', 'x509', '-req', '-in', str(csr_path),
                '-CA', str(ca / 'ca.cert.pem'), '-CAkey', str(ca / 'ca.key.pem'),
                *pass_args(args, '-passin'), '-set_serial', '0x' + secrets.token_hex(20),
                '-days', '90', '-sha256', '-extfile', str(extensions)], stdout=handle)
            if completed.returncode:
                output.unlink()
                raise ValueError('Certificate signing failed.')
    finally:
        extensions.unlink()
    openssl('verify', '-CAfile', ca / 'ca.cert.pem', output)
    print('Signed 90-day production certificate: ' + str(output))

def check(args):
    cert, ca = Path(args.certificate), Path(args.ca_certificate)
    openssl('verify', '-CAfile', ca, cert)
    openssl('x509', '-in', cert, '-checkend', str(args.days * 86400), '-noout')
    if args.key:
        key_pub = openssl('pkey', '-in', args.key, '-pubout', capture=True)
        cert_pub = openssl('x509', '-in', cert, '-pubkey', '-noout', capture=True)
        if key_pub != cert_pub:
            raise ValueError('Certificate does not match the server key.')
    print('Certificate chain/key checks passed; validity exceeds ' + str(args.days) + ' days.')

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    ca = commands.add_parser('init-ca'); ca.add_argument('--directory', required=True)
    ca.add_argument('--passphrase-file'); ca.set_defaults(run=init_ca)
    request = commands.add_parser('csr'); request.add_argument('--directory', required=True); request.set_defaults(run=csr)
    signing = commands.add_parser('sign'); signing.add_argument('--ca-directory', required=True)
    signing.add_argument('--csr', required=True); signing.add_argument('--output', required=True)
    signing.add_argument('--passphrase-file'); signing.set_defaults(run=sign)
    checking = commands.add_parser('check'); checking.add_argument('--certificate', required=True)
    checking.add_argument('--ca-certificate', required=True); checking.add_argument('--key')
    checking.add_argument('--days', type=int, default=30); checking.set_defaults(run=check)
    args = parser.parse_args()
    try:
        args.run(args)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print('PKI operation failed. Check paths, permissions, certificate validity, and OpenSSL diagnostics. Existing keys were not overwritten.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
