#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Root is required.' >&2; exit 1; }
source_dir=${1:?Provide directory containing aviquiz.service, Caddyfile and aviquiz.env.example}
install -o root -g root -m 0644 "$source_dir/aviquiz.service" /etc/systemd/system/aviquiz.service
install -o root -g root -m 0644 "$source_dir/Caddyfile" /etc/caddy/Caddyfile
install -o root -g root -m 0644 "$source_dir/aviquiz.env.example" /etc/aviquiz/aviquiz.env.example
systemd-analyze verify /etc/systemd/system/aviquiz.service
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable aviquiz.service
systemctl disable --now caddy.service
printf 'AviQuiz service prepared; app and proxy are not started.\n'
