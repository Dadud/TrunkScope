# Operations

Day-to-day operation of a TrunkScope appliance: health checks, backup, retention, and acceptance testing.

## Health endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/health` | Basic up |
| `GET /api/v1/health/live` | Process liveness |
| `GET /api/v1/health/ready` | Ready to serve |
| `GET /api/v1/runtime` | Decoder connection, receiver states, AI worker, queue depth |
| `GET /api/v1/diagnostics` | Capture, decoder, recording, ingestion, AI component detail |

Example:

```bash
curl -s http://APPLIANCE:18088/api/v1/diagnostics | jq .
```

Key diagnostics fields:

- `decoder.state` — Trunk Recorder connectivity
- `decoderControlLockAgeSeconds` — last control-channel lock signal
- `ai.state` / `aiFailureReason` — worker status
- `simulated` — `true` only in simulator mode

## Receiver lifecycle (admin)

| Action | Endpoint |
|--------|----------|
| Probe | `POST /api/v1/receivers/{id}/probe` |
| Start | `POST /api/v1/receivers/{id}/start` |
| Stop | `POST /api/v1/receivers/{id}/stop` |
| Restart | `POST /api/v1/receivers/{id}/restart` |

In **decoder** mode the visible receiver represents the SDR path consumed by Trunk Recorder.

## Settings apply behavior

| Change | When it applies |
|--------|-----------------|
| Map center, privacy policy, AI URLs | Immediately (workers re-read settings per call) |
| Radio device, mode, decoder profiles | After save; decoder config regenerated; may need controlled restart |
| Scan lists (radiod mode) | On scan list start/stop |

## Backup

Back up the **entire appdata volume** (`/var/lib/trunkscope`):

| Critical paths | Contents |
|----------------|----------|
| `trunkscope.db` | Call archive |
| `calls/` | WAV recordings |
| `audio/settings.json` | Operator configuration |
| `audio/systems.json` | Radio profiles |
| `audio/talkgroups.json` | Talkgroup catalog |
| `audio/auth.json` | Administrator credentials |
| `calls-export.json` | JSON export snapshot |

### Snapshot on Unraid

Stop the container (optional but safest), copy `/mnt/user/appdata/trunkscope`, restart.

### Config-only archive

```bash
scripts/backup.sh /path/to/backups
```

Review staged output with `scripts/restore-config.sh` before applying to a live appliance.

## Retention

Configured in **Appliance → AI & Integrations → Retention**:

| Setting | Default | Worker behavior |
|---------|---------|-----------------|
| Audio days | 30 | Delete WAV files; clear audio reference |
| Transcript days | 365 | Strip transcript and summary |
| Metadata days | 365 | Remove call row from SQLite and memory |

Hourly in-process worker. Manual purge via **Archive** with one-level undo.

Preview candidates (dry run):

```bash
TRUNKSCOPE_RETENTION_DRY_RUN=true scripts/retention-cleanup.sh
```

## Scan lists (radiod mode)

Persisted in `audio/scan-lists.json`. Each channel supports dwell, priority, lockout, squelch, and optional CTCSS/DCS.

Tone-required channels reject traffic when the decoder does not report a matching tone. DCS matching requires a decoder path that supplies DCS metadata.

## Audio access

`GET /api/v1/calls/{id}/audio` requires administrator session or configured bearer token. Supports HTTP range requests for browser playback.

Encrypted calls return no audio asset.

## Software acceptance harness

```bash
TRUNKSCOPE_URL=http://APPLIANCE:18088 \
TRUNKSCOPE_CREDENTIAL_FILE=/secure/admin-credentials.json \
python scripts/verified-hardware-acceptance.py
```

Output: `hardware-acceptance.json` in the working directory.

The harness validates process health, auth, decoder connectivity, and ingestion — not RF tone matching. Physical gates: [rf-acceptance.md](rf-acceptance.md).

## Logs

```bash
docker logs trunkscope -f --tail 200
```

Trunk Recorder and control plane log to stdout inside the container.

## Upgrades

```bash
docker compose -f deploy/appliance.yml pull
docker compose -f deploy/appliance.yml up -d
```

Appdata persists across image updates. Verify `/api/v1/health/ready` after upgrade.

## Security operations

- Rotate password: **Appliance → Security**
- Disable `TRUNKSCOPE_LOCAL_ONLY` before any port exposure beyond trusted LAN
- Never commit `auth.json` or API keys to git
- Restrict `/api/call-upload` to trusted networks when compat ingest is enabled

## Failure recovery

| Failure | Recovery |
|---------|----------|
| SDR unplugged | Replug USB; restart container if device node missing |
| Trunk Recorder stuck | Restart container; check `audio/decoder/config.json` |
| AI provider down | Calls still record; AI queue retries; fix URL and test in Integrations |
| Corrupt settings | Restore `audio/settings.json` from backup |
| Lost database | Restore `trunkscope.db` or import `calls-export.json` (metadata only) |

See [troubleshooting.md](troubleshooting.md).
