#!/bin/sh
set -eu

FILE=${1:-}
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "trunkscope-ingest: missing sidecar file: ${FILE:-<none>}" >&2
  exit 1
fi

WAV="${FILE%.*}.wav"
i=0
while [ ! -f "$WAV" ] && [ "$i" -lt 20 ]; do
  i=$((i + 1))
  sleep 0.1
done

exec curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "X-Sidecar-Path: ${FILE}" \
  --data-binary @"${FILE}" \
  http://127.0.0.1:8080/api/v1/decoder/ingest
