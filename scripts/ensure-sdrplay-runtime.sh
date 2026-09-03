#!/usr/bin/env sh
set -eu

# SDRplay's Linux runtime is often shipped with a versioned SONAME only. The
# SoapySDR plugin requests the stable .so.3 name, so make that link explicit.
runtime_root="${TRUNKSCOPE_SDRPLAY_RUNTIME:-/opt/sdrplay}"
library_dir="$runtime_root/lib"
target="$library_dir/libsdrplay_api.so.3"

if [ ! -d "$library_dir" ]; then
  echo "SDRplay runtime library directory not found: $library_dir" >&2
  exit 1
fi

if [ ! -e "$target" ]; then
  versioned=$(find "$library_dir" -maxdepth 1 -type f -name 'libsdrplay_api.so.3.*' | sort | head -n 1)
  if [ -z "$versioned" ]; then
    echo "No versioned libsdrplay_api.so.3.* library found in $library_dir" >&2
    exit 1
  fi
  ln -s "$(basename "$versioned")" "$target"
fi

echo "SDRplay runtime ready: $target"
