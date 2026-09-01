#!/usr/bin/env bash
set -euo pipefail

receiver_ip="${1:-${TRUNKSCOPE_RECEIVER_IP:-}}"
receiver_port="${TRUNKSCOPE_SOAPYREMOTE_PORT:-55132}"
device="driver=remote,remote=tcp://${receiver_ip}:${receiver_port},remote:driver=sdrplay,remote:format=CS16"
[[ -n "$receiver_ip" ]] || { echo "usage: $0 RECEIVER_LAN_IP" >&2; exit 2; }
command -v SoapySDRUtil >/dev/null 2>&1 || { echo "ERROR: install SoapySDR tools" >&2; exit 1; }
echo "== TCP reachability =="
if command -v nc >/dev/null 2>&1; then nc -zvw3 "$receiver_ip" "$receiver_port"; else timeout 3 bash -c "</dev/tcp/${receiver_ip}/${receiver_port}"; fi
echo "== Remote Soapy device =="
SoapySDRUtil --find="$device"
probe="$(SoapySDRUtil --probe="$device" 2>&1)"
printf '%s\n' "$probe"
grep -qi 'RSP1B' <<<"$probe" || { echo "ERROR: remote probe did not identify RSP1B" >&2; exit 1; }
echo "PASS: set TRUNKSCOPE_RADIO_DEVICE to:"
echo "$device"
