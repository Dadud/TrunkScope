# TrunkScope operations

## Health and lifecycle

The control plane exposes `/api/v1/health/live` for process liveness and
`/api/v1/health/ready` for dependency readiness. `/api/v1/runtime` reports the
decoder connection, receiver states, active calls, AI enablement, and call
storage path.

Receiver controls are administrator-only:

- `POST /api/v1/receivers/{id}/probe`
- `POST /api/v1/receivers/{id}/start`
- `POST /api/v1/receivers/{id}/stop`
- `POST /api/v1/receivers/{id}/restart`

Settings are persisted in `TRUNKSCOPE_SETTINGS_PATH` (by default inside the
audio volume). Radio and AI changes are loaded on the next control-plane
restart; map and privacy policy changes apply immediately.

## Scan lists

Scan lists are persisted in `TRUNKSCOPE_SCAN_LISTS_PATH`. Each channel has its
own dwell, priority, lockout, squelch, and optional CTCSS/DCS tone. A required
tone rejects traffic when the decoder does not report a matching tone. Decoder
events support exact CTCSS and DCS matching; the native radiod path currently
reports CTCSS only, so DCS-required profiles must use a decoder that supplies
the DCS code. Keep
SoapyRemote on a trusted LAN or VPN; it does not provide authentication or
encryption.

## Audio and privacy

`GET /api/v1/audio/{id}` requires an administrator session or the configured
audio bearer token and supports HTTP byte ranges for browser playback. Calls
marked encrypted never receive an audio asset or AI processing. Public feeds
remain disabled until an explicit allowlist is configured.

## Backup

Back up the PostgreSQL volume plus the audio volume, including `settings.json`,
`systems.json`, and `scan-lists.json`. Restore volumes before starting the
control plane so persisted configuration is loaded during initialization.

Run `scripts/retention-cleanup.sh` on a schedule with
`TRUNKSCOPE_RETENTION_DRY_RUN=true` first; set it to `false` only after reviewing
the candidate list. The script refuses paths outside the TrunkScope call volume.
Run `scripts/backup.sh /path/to/backups` to archive deployment configuration;
database and object-storage volumes still require their platform-native backup.
The backup emits a SHA-256 manifest. To verify a restore without touching the
live appliance, run `scripts/restore-config.sh ARCHIVE.tar.gz /tmp/trunkscope-restore`
and review the staged files before restarting services.
## Acceptance harness

Run the software-observable checks with an authenticated session:

```sh
TRUNKSCOPE_URL=http://trunkscope:18088 \
TRUNKSCOPE_CREDENTIAL_FILE=/secure/path/admin-credentials.json \
python scripts/verified-hardware-acceptance.py
```

The harness deliberately records live-event evidence separately. A quiet
radio system can pass process/storage checks while still leaving the
transmission-dependent gate pending.
