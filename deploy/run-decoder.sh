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

# Do not stop/restart the SDRplay API here.  The vendor service owns the
# libusb handle and SoapySDRPlay documents hangs/crashes when it is restarted
# while a client is opening or closing a stream.  supervisord owns its
# lifecycle; decoder startup must never create a second API session.
if grep -q 'driver=sdrplay' "$CONFIG" 2>/dev/null && command -v supervisorctl >/dev/null 2>&1; then
  j=0
  while [ "$j" -lt 30 ]; do
    status="$(supervisorctl status sdrplay-api 2>/dev/null || true)"
    case "$status" in
      *RUNNING*) break ;;
    esac
    j=$((j + 1))
    sleep 1
  done
fi

# Trunk Recorder runs in the background so the wrapper can publish a
# liveness heartbeat: the control plane's verify check and decoder status
# read this file to distinguish "process alive" from "config present".
CALLS_DIR="${TRUNKSCOPE_CALLS_PATH:-/var/lib/trunkscope/calls}"
rm -f "$CALLS_DIR/.decoder-health"

trunk-recorder --config="$CONFIG" &
TR_PID=$!

if kill -0 "$TR_PID" 2>/dev/null; then
  touch "$CALLS_DIR/.decoder-health"
fi

while kill -0 "$TR_PID" 2>/dev/null; do
  sleep 10
  touch "$CALLS_DIR/.decoder-health"
done

rm -f "$CALLS_DIR/.decoder-health"
wait "$TR_PID"
