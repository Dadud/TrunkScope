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

# Trunk Recorder can invoke uploadScript immediately as the sidecar is being
# closed. Retry transient validation failures while the JSON is still settling
# so a good recording is not lost from the event ledger.
attempt=0
# Sidecars can precede the final WAV and may briefly contain incomplete
# recorder metadata. Keep the upload retry bounded, but long enough for a
# busy recorder pool to finish closing the call.
while [ "$attempt" -lt 60 ]; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Content-Type: application/json" \
    -H "X-Sidecar-Path: ${FILE}" \
    --data-binary @"${FILE}" \
    http://127.0.0.1:8080/api/v1/decoder/ingest || true)
  case "$status" in
    2??) exit 0 ;;
    400|408|429|5??) sleep 0.5 ;;
    *) break ;;
  esac
  attempt=$((attempt + 1))
done
echo "trunkscope-ingest: upload failed for ${FILE} (HTTP ${status:-unknown})" >&2
exit 22
