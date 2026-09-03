#!/usr/bin/env sh
set -eu

# Render a Trunk Recorder configuration from environment variables without
# baking LAN addresses or talkgroups into the image. Run this on the appliance
# before enabling the compose `decoder` profile.
: "${TRUNKSCOPE_P25_CONTROL_CHANNELS:?Set comma-separated control channel Hz values}"
: "${TRUNKSCOPE_P25_SYSTEM_NAME:?Set the P25 system short name}"

output="${1:-deploy/decoder/config.json}"
channels=$(printf '%s' "$TRUNKSCOPE_P25_CONTROL_CHANNELS" | awk -F, '{ for (i=1; i<=NF; i++) { if ($i !~ /^[0-9]+$/) exit 1; if (i>1) printf ","; printf "%s", $i } }')
device="${TRUNKSCOPE_RADIO_DEVICE:-soapy=0}"
rate="${TRUNKSCOPE_RADIO_SAMPLE_RATE_HZ:-2400000}"
center="${TRUNKSCOPE_RADIO_FREQUENCY_HZ:-0}"

mkdir -p "$(dirname "$output")"
cat >"$output" <<JSON
{
  "ver": 2,
  "captureDir": "/var/lib/trunkscope/calls",
  "statusServer": "ws://control-plane:8080/api/v1/decoder/status",
  "audioArchive": true,
  "callLog": true,
  "softVocoder": true,
  "sources": [{"center": ${center:-0}, "rate": ${rate}, "error": 0, "gain": 0, "digitalRecorders": 4, "analogRecorders": 2, "driver": "osmosdr", "device": "${device}"}],
  "systems": [{"type": "p25", "shortName": "${TRUNKSCOPE_P25_SYSTEM_NAME}", "control_channels": [${channels}], "talkgroupsFile": "/config/talkgroups.csv", "modulation": "qpsk", "squelch": -60, "recordUnknown": true, "hideEncrypted": false}]
}
JSON
printf 'Rendered %s\n' "$output"
