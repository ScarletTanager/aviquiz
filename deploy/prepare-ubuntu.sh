#!/usr/bin/env bash
# Fresh AviQuiz Ubuntu 24.04 Droplet. Run as root over the existing SSH connection.
# No application deployment, database credentials, DNS change, or public service activation.
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Root is required.' >&2; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Expected Ubuntu 24.04.' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Expected x86_64.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
apt-get update -qq
apt-get upgrade --with-new-pkgs -y
apt-get install -y --no-install-recommends ca-certificates curl xz-utils git sudo ufw unattended-upgrades debian-keyring debian-archive-keyring gnupg
# Caddy's signed stable package repository, per its official Debian/Ubuntu instructions.
curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/aviquiz-caddy-key.asc
gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/aviquiz-caddy-key.asc
curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y --no-install-recommends caddy
systemctl disable --now caddy
# Resolve and checksum the current official Node 24 x64 binary; keep the versioned directory.
node_work=$(mktemp -d /tmp/aviquiz-node.XXXXXX)
trap 'rm -rf "$node_work"' EXIT
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$node_work/SHASUMS256.txt"
node_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$node_work/SHASUMS256.txt")
[[ "$node_archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || { echo 'Unexpected Node release manifest.' >&2; exit 1; }
curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v24.x/$node_archive" -o "$node_work/$node_archive"
(cd "$node_work"; awk -v f="$node_archive" '$2 == f' SHASUMS256.txt | sha256sum --check --status)
node_directory=${node_archive%.tar.xz}
if [[ ! -d /opt/$node_directory ]]; then tar -xJf "$node_work/$node_archive" -C /opt; fi
ln -sfn "/opt/$node_directory" /opt/node24
ln -sfn /opt/node24/bin/node /usr/local/bin/node
ln -sfn /opt/node24/bin/npm /usr/local/bin/npm
ln -sfn /opt/node24/bin/npx /usr/local/bin/npx
install -d -m 0755 /var/lib/aviquiz-setup
awk -v f="$node_archive" '$2 == f' "$node_work/SHASUMS256.txt" > /var/lib/aviquiz-setup/node-checksum.txt
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
id aviquiz >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin aviquiz
usermod -a -G aviquiz deploy
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
install -o deploy -g deploy -m 0600 /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
install -d -o deploy -g aviquiz -m 2750 /srv/aviquiz /srv/aviquiz/releases
install -d -o root -g aviquiz -m 0750 /etc/aviquiz
# Deliberately narrow sudo rights; deploy cannot edit system configuration or directly read the root-owned environment file.
cat > /etc/sudoers.d/aviquiz-deploy <<'SUDO'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart aviquiz.service, /usr/bin/systemctl start aviquiz.service, /usr/bin/systemctl stop aviquiz.service, /usr/bin/systemctl is-active aviquiz.service
SUDO
chmod 0440 /etc/sudoers.d/aviquiz-deploy
visudo -cf /etc/sudoers.d/aviquiz-deploy
# Preserve root public-key recovery access. Passwords are disabled; test deploy login separately.
cat > /etc/ssh/sshd_config.d/00-aviquiz.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
SSH
sshd -t
systemctl reload ssh
# Keep SSH reachable before enabling default-deny firewall. Tighten source allowlists
# after the deployment runner and administrator networks have been selected.
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment 'Key-only SSH with rate limiting'
ufw allow 80/tcp comment 'HTTP and ACME certificate validation'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
# Bound disk use from service logs on this small, replaceable app host.
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/aviquiz.conf <<'JOURNAL'
[Journal]
SystemMaxUse=100M
RuntimeMaxUse=50M
MaxRetentionSec=14day
JOURNAL
systemctl restart systemd-journald
# Enable security updates without unattended reboots.
cat > /etc/apt/apt.conf.d/52aviquiz-unattended <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "false";
APT
node --version
npm --version
ufw status verbose
echo 'Base setup complete; Caddy and AviQuiz remain inactive pending application/configuration.'
