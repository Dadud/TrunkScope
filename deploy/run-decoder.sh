#!/bin/sh
set -eu

CONFIG="${TRUNKSCOPE_DECODER_CONFIG_PATH:-/var/lib/trunkscope/audio/decoder/config.json}"
MODE="${TRUNKSCOPE_RADIO_MODE:-decoder}"

if [ "$MODE" != "decoder" ]; then
  echo "Trunk Recorder idle (TRUNKSCOPE_RADIO_MODE=$MODE)"
  exec tail -f /dev/null
fi

i=0
while [ "$i" -lt 90 ]; do
  if [ -f "$CONFIG" ] && wget -q -O /dev/null http://127.0.0.1:8080/api/v1/health; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ ! -f "$CONFIG" ]; then
  echo "decoder config not yet written at $CONFIG"
fi

exec trunk-recorder --config="$CONFIG"
