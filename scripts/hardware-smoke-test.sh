#!/usr/bin/env bash
set -euo pipefail

# Validate the remote SDR path from the Docker host before starting decoding.
# Usage: ./scripts/hardware-smoke-test.sh RECEIVER_IP [FREQUENCY_HZ]
receiver_ip="${1:-${TRUNKSCOPE_RECEIVER_IP:-}}"
frequency_hz="${2:-${TRUNKSCOPE_RADIO_FREQUENCY_HZ:-851012500}}"
port="${TRUNKSCOPE_SOAPYREMOTE_PORT:-55132}"

[[ -n "$receiver_ip" ]] || { echo "usage: $0 RECEIVER_LAN_IP [FREQUENCY_HZ]" >&2; exit 2; }
if [[ "$receiver_ip" == "127.0.0.1" || "$receiver_ip" == "localhost" ]]; then
  if docker compose -f deploy/compose.yml ps --status running -q sdrplay-service 2>/dev/null | grep -q .; then
    echo "Local SDRplay device is owned by sdrplay-service; stop that service before running an exclusive smoke test." >&2
    exit 3
  fi
  device="driver=sdrplay"
else
  device="driver=remote,remote=tcp://${receiver_ip}:${port},remote:driver=sdrplay,remote:format=CS16"
fi

echo "Running 10-second radiod self-test against ${device}"
docker compose -f deploy/compose.yml --profile radio-tools run --rm radiod-tools \
  --self-test --device "$device" --frequency-hz "$frequency_hz" --seconds 10
