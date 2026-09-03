#!/usr/bin/env bash
set -euo pipefail

destination="${1:?usage: backup.sh DESTINATION_DIR}"
app_root="${TRUNKSCOPE_APPDATA_ROOT:-/mnt/user/appdata/trunkscope}"
audio_root="${TRUNKSCOPE_AUDIO_DATA_ROOT:-$app_root/audio}"
decoder_root="${TRUNKSCOPE_DECODER_CONFIG_ROOT:-$app_root/decoder}"
mkdir -p -- "$destination"
[[ -d "$app_root" ]] || { echo "app data root does not exist: $app_root" >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$destination/trunkscope-config-$stamp.tar.gz"
manifest="$destination/trunkscope-config-$stamp.sha256"
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT

# Copy only durable operator configuration. Missing optional files are noted;
# a backup never reports success while silently producing an empty archive.
mkdir -p "$stage"
for relative in settings.json systems.json scan-lists.json receivers.json conversation-sessions.json audit.json auth.json; do
  if [[ -e "$audio_root/$relative" ]]; then
    mkdir -p "$stage/audio"
    cp -a "$audio_root/$relative" "$stage/audio/$relative"
  fi
done
if [[ -d "$decoder_root" ]]; then
  mkdir -p "$stage/decoder"
  cp -a "$decoder_root/." "$stage/decoder/"
fi

if [[ -z "$(find "$stage" -type f -print -quit)" ]]; then
  echo "no durable configuration found below $app_root" >&2
  exit 1
fi
tar -C "$stage" -czf "$archive" .
sha256sum "$archive" > "$manifest"
echo "configuration backup written to $archive"
echo "checksum written to $manifest"
echo "Database/object/audio volumes require their platform-native backup procedures."
