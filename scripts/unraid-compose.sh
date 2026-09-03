#!/usr/bin/env sh
set -eu

# Always load the appliance environment explicitly. Running Compose from a
# different working directory otherwise substitutes empty USB/runtime paths.
app_root="${TRUNKSCOPE_APP_ROOT:-/mnt/user/appdata/trunkscope/app}"
env_file="${TRUNKSCOPE_ENV_FILE:-$app_root/.env}"
compose_file="$app_root/deploy/compose.yml"

if [ ! -f "$env_file" ]; then
  echo "Missing Unraid environment file: $env_file" >&2
  exit 1
fi

exec docker compose --env-file "$env_file" -f "$compose_file" "$@"
