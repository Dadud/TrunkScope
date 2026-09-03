#!/bin/sh
set -eu

install -d \
  /var/lib/trunkscope/audio/decoder \
  /var/lib/trunkscope/calls \
  /var/log/supervisor \
  /var/run

# Generated decoder config lives under the audio volume. Trunk Recorder's
# conventional channelFile still points at /generated/decoder/... so keep
# that path working inside the single container.
ln -sfn /var/lib/trunkscope/audio /generated

if [ -x /opt/sdrplay/sdrplay_apiService ]; then
  echo "starting mounted SDRplay API service"
  /opt/sdrplay/sdrplay_apiService &
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/trunkscope.conf
