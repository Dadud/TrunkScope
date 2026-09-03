#!/usr/bin/env bash
set -euo pipefail

root="${TRUNKSCOPE_CALLS_PATH:-/var/lib/trunkscope/calls}"
days="${TRUNKSCOPE_AUDIO_RETENTION_DAYS:-30}"
dry_run="${TRUNKSCOPE_RETENTION_DRY_RUN:-true}"

[[ "$root" == /var/lib/trunkscope/calls* ]] || { echo "refusing unsafe calls root: $root" >&2; exit 1; }
[[ "$days" =~ ^[1-9][0-9]*$ ]] || { echo "retention days must be positive" >&2; exit 1; }
[[ -d "$root" ]] || { echo "calls root does not exist: $root"; exit 0; }

mapfile -t stale < <(find "$root" -type f \( -name '*.wav' -o -name '*.flac' -o -name '*.mp3' \) -mtime "+$days" -print)
printf 'retention candidates: %s (older than %s days)\n' "${#stale[@]}" "$days"
if [[ "$dry_run" == "true" ]]; then printf '%s\n' "${stale[@]}"; exit 0; fi
for file in "${stale[@]}"; do rm -f -- "$file"; done
