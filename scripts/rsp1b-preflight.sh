#!/usr/bin/env bash
set -euo pipefail

# Run on the Linux laptop physically attached to an RSP1B.
bind_address="${1:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
port="${TRUNKSCOPE_SOAPYREMOTE_PORT:-55132}"
command -v SoapySDRUtil >/dev/null 2>&1 || { echo "ERROR: install SoapySDR tools" >&2; exit 1; }
command -v SoapySDRServer >/dev/null 2>&1 || { echo "ERROR: install SoapySDR server" >&2; exit 1; }

echo "== USB device =="
if command -v lsusb >/dev/null 2>&1; then lsusb -d 1df7: || echo "WARNING: no SDRplay USB device found"; fi
echo "== Local SoapySDR probe =="
find_output="$(SoapySDRUtil --find='driver=sdrplay' 2>&1 || true)"
printf '%s\n' "$find_output"
grep -qi 'RSP1B' <<<"$find_output" || { echo "ERROR: RSP1B not found; install SDRplay API v3.15+ and SoapySDRPlay3" >&2; exit 1; }
SoapySDRUtil --probe='driver=sdrplay'
[[ -n "$bind_address" ]] || { echo "ERROR: pass receiver LAN IP" >&2; exit 1; }
echo "Starting SoapySDRServer on ${bind_address}:${port}; keep this process running."
echo "SoapyRemote has no authentication/encryption; use a trusted LAN or VPN."
exec SoapySDRServer --bind="${bind_address}:${port}"
