# Troubleshooting

Common issues running the TrunkScope single-container appliance.

## Docker / host

### Windows development

Docker Desktop must use **Linux containers**. See [docker-troubleshooting.md](docker-troubleshooting.md) for Inference Manager errors.

### Container won't start

```bash
docker logs trunkscope --tail 100
```

Check USB device passthrough (`--device /dev/bus/usb`) and appdata mount permissions.

### Port already in use

Change host port in `deploy/appliance.yml`:

```yaml
ports:
  - "18089:8080"
```

## SDR / receiver

### No device found

1. `lsusb` on host — confirm SDR visible
2. Container has `/dev/bus/usb` mapped
3. `TRUNKSCOPE_RADIO_DEVICE` matches hardware (`rtlsdr`, `airspy`, `sdrplay`)
4. SDRplay: `/opt/sdrplay` mount present and `LD_LIBRARY_PATH` set (handled in image)

### Remote SoapyRemote fails

- Ping laptop from appliance
- Port `55132` open on firewall
- Device string includes `remote=tcp://HOST:55132`
- SoapyRemote has no auth — verify LAN-only access

### Diagnostics show `simulated: true` unexpectedly

`TRUNKSCOPE_RADIO_MODE=simulator` — set to `decoder` for production.

## Trunk Recorder / decoder

### Decoder offline in UI

Trunk Recorder runs inside the same container. Check:

```bash
curl -s http://127.0.0.1:18088/api/v1/diagnostics | jq .decoder
```

Evidence paths:

- WebSocket `/api/v1/decoder/status` connected
- Recent sidecar ingest via `/api/v1/decoder/ingest`
- `.decoder-health` file fresh in calls volume

### No P25 voice following

- Control channel MHz correct in system profile
- `siteFilter` not excluding active site
- NAC matches system (see diagnostics / TR logs)
- IQ span: config requests ≥ 6 MHz sample rate for P25

### Conventional FM no recordings

- `analog-fm` system with valid `frequencyHz`
- `analog-channels.csv` generated beside decoder config
- Squelch/tone settings match channel

### Regenerate decoder config

Save any system or settings change in the UI, or restart the container. Preview in **Appliance → Diagnostics**.

## AI providers

### Transcription fails

| Check | Action |
|-------|--------|
| URL uses LAN IP | Not `localhost` from inside container |
| Reachable from container | `docker exec trunkscope curl -s http://AI_HOST:8000/...` |
| Model name valid | Match Speaches/Ollama loaded model |
| API key | Set in UI or `TRUNKSCOPE_TRANSCRIBE_API_KEY` |

Use **Test transcription** in Integrations tab.

### Summary wrong protocol

| Provider | URL must end with |
|----------|-------------------|
| Ollama | `/api/generate` |
| vLLM / OpenRouter | `/v1/chat/completions` |

Set `summaryProvider` accordingly.

### Geocoder returns nothing

- Hint text may be too vague — check transcript in call detail
- Rate limits on public Nominatim — use self-hosted or LocationIQ
- Google/Mapbox require valid API keys

## Persistence

### Calls lost after restart

Confirm `trunkscope.db` exists on appdata volume and is writable. Without SQLite, only the in-memory ring (last ~200 calls) is kept until the deferred Postgres path is enabled.

### Settings revert

Environment variables apply when settings fields are empty. Save in UI to persist to `audio/settings.json`.

## Authentication

### Locked out

- Restore `audio/auth.json` from backup, or
- Temporarily set `TRUNKSCOPE_LOCAL_ONLY=true` on trusted LAN, rotate password in UI, disable local-only

### `/api/call-upload` returns 404

Enable **Rdio-scanner compatible ingest** in Integrations (`compatIngestEnabled`).

## Getting help

When reporting issues, include:

1. `GET /api/v1/diagnostics` JSON (redact secrets)
2. `docker logs trunkscope --tail 200`
3. Radio mode, device string, and whether AI is enabled
4. SDR model and host OS (Unraid version if applicable)

Hardware acceptance: [rf-acceptance.md](rf-acceptance.md)  
Operations: [operations.md](operations.md)
