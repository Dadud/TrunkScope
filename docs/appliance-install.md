# TrunkScope single-container appliance

This is the **only supported operator install path** for TrunkScope.

## Quick start

```bash
docker compose -f deploy/appliance.yml up -d --build
```

Or on Unraid, import [`deploy/unraid/trunkscope.xml`](unraid/trunkscope.xml) and map:

- **Appdata:** `/mnt/user/appdata/trunkscope` → `/var/lib/trunkscope`
- **Port:** `18088` → container `8080`
- **USB:** pass through your SDR device

## What runs inside one container

- Control plane (Rust API + SQLite persistence)
- React operator console
- Trunk Recorder (P25 + conventional FM)

## What stays external

AI is never bundled. Configure providers in **Appliance → AI & Integrations** or the first-run wizard:

| Role | Self-hosted examples | Cloud examples |
|------|---------------------|----------------|
| Transcription | Speaches, vLLM-compatible ASR | OpenAI Whisper, Groq |
| Summary | Ollama, vLLM, LM Studio | OpenAI, OpenRouter, Anthropic |
| Geocoding | Nominatim | LocationIQ, Google, Mapbox |

**Important:** Use your **LAN IP** (e.g. `http://192.168.1.10:11434`), not `localhost` — inside Docker, localhost is the container itself.

Environment fallbacks:

- `TRUNKSCOPE_TRANSCRIBE_URL`, `TRUNKSCOPE_TRANSCRIBE_API_KEY`
- `TRUNKSCOPE_SUMMARY_URL`, `TRUNKSCOPE_SUMMARY_API_KEY`
- `TRUNKSCOPE_GEOCODER_URL`, `TRUNKSCOPE_GEOCODER_API_KEY`

## Storage

One appdata volume (`/var/lib/trunkscope`):

| Path | Purpose |
|------|---------|
| `trunkscope.db` | SQLite call history (survives restart) |
| `calls/` | WAV recordings from Trunk Recorder |
| `audio/settings.json` | Operator settings |
| `audio/systems.json` | P25/FM system profiles |
| `calls-export.json` | Periodic JSON backup (recovery aid) |

No Postgres or MinIO required.

## DMR and external decoders

TrunkScope does not decode DMR natively. Enable **Rdio-scanner compatible ingest** in Integrations, then push calls from SDRTrunk or rdio-scanner to:

```
POST /api/call-upload
```

See [dmr-ingest.md](dmr-ingest.md) for setup details.

## Deferred: full Compose stack

The multi-service stack in [`deploy/compose.yml`](../compose.yml) (Postgres, MinIO, separate web/nginx) is kept for development reference only. Do not use it for production appliance installs.
