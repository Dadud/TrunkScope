#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: restore-config.sh ARCHIVE.tar.gz DESTINATION_ROOT}"
destination="${2:?usage: restore-config.sh ARCHIVE.tar.gz DESTINATION_ROOT}"
[[ -f "$archive" ]] || { echo "archive does not exist: $archive" >&2; exit 1; }
[[ "$destination" != "/" && "$destination" != "" ]] || { echo "refusing to restore into filesystem root" >&2; exit 1; }
mkdir -p -- "$destination"

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
find "$stage" -type f -print -quit | grep -q . || { echo "archive contains no files" >&2; exit 1; }

# Extraction is staged first so archive entries cannot escape the destination.
cp -a "$stage/." "$destination/"
echo "configuration restored to $destination"
echo "Restart TrunkScope services after reviewing the restored files."
