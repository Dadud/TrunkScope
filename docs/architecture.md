# Architecture

TrunkScope separates RF decoding from the control plane. The **supported production shape** is a single container with SQLite persistence and external AI.

## Production topology

```text
┌─────────────────────────────────────────────────────────┐
│  TrunkScope container (deploy/appliance.yml)            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Web UI     │  │ Control plane│  │ Trunk Recorder │  │
│  │  (static)   │──│ Rust API     │──│ P25 + FM       │  │
│  └─────────────┘  └──────┬───────┘  └───────┬────────┘  │
│                          │                   │          │
│                    trunkscope.db         calls/*.wav    │
│                    settings.json                          │
└──────────────────────────┼───────────────────┼──────────┘
                           │                   │
              ┌────────────┴────────────┐      │ USB or SoapyRemote
              │  External AI (optional)   │      ▼
              │  ASR · LLM · Geocoder    │   SDR hardware
              └──────────────────────────┘
```

## Components

| Path | Role |
|------|------|
| `apps/control-plane` | HTTP API, WebSocket live feed, auth, SQLite, AI workers, decoder ingest |
| `apps/web` | React PWA — map, live feed, archive, appliance configuration |
| `native/radiod` | Optional native capture (`radiod` mode); simulator for CI |
| `crates/domain` | Shared `Call`, `Receiver`, policy types |
| Trunk Recorder | In-container P25 trunking and conventional FM decode |

## Call pipeline

```text
RF → Trunk Recorder → WAV + JSON sidecar
                   → WebSocket status (call_start / call_end)
                   → uploadScript → POST /api/v1/decoder/ingest

Control plane:
  ingest → validate path → archive call (SQLite + memory ring)
        → queue AI worker (10s dwell for adjacent segments)
        → transcribe → summarize → geocode hint → Discord notify
```

### Conversation sessions

Rapid dispatch/reply traffic on the same talkgroup is grouped into **conversation sessions** with a 10-second quiet dwell before finalization. Operations brief and merged playback use these boundaries.

### Encrypted calls

Metadata is stored; audio is not played, transcribed, or summarized.

## Persistence model

| Store | Authoritative for | Notes |
|-------|-------------------|-------|
| `trunkscope.db` (SQLite) | Call history | Hydrated on startup; upsert on every call change |
| `audio/*.json` | Settings, systems, talkgroups, scan lists, auth | Atomic write on save |
| `calls/` | WAV recordings | Trunk Recorder `captureDir` |
| `calls-export.json` | Human backup | Periodic export; SQLite is source of truth |

Optional `TRUNKSCOPE_DATABASE_URL` enables a **legacy Postgres mirror** for the deferred multi-service Compose stack. The appliance path does not set this.

## Decoder configuration

`decoder_config_value()` in the control plane generates Trunk Recorder JSON from:

- Persisted system profiles and site filter
- Per-system talkgroup CSV files
- Receiver / Soapy device settings
- NAC and control channel lists

Written to `audio/decoder/config.json` on startup and after profile changes, and reloaded automatically (see `apply.rs`). Multi-channel behavior:

- Trunk Recorder monitors **every planned channel inside a source's coverage simultaneously** — there is no scanning. Conventional channels get dedicated recorders; trunked calls draw from the source's `digitalRecorders` (default 6) / `analogRecorders` (default 4) pools, overridable per receiver.
- Global knobs: `minDuration 1.0` (drops squelch flutter), `maxDuration 3600`, `controlRetuneLimit` sized to the largest control-channel plan, `compressWav true`, and a `filenameFormat` that organizes recordings under `{short_name}/{date}/`.
- Call ingestion is idempotent: the status WebSocket, upload script, and sidecar poller may all deliver the same call — audio-path aliasing merges them into one call and the AI pipeline runs exactly once.
- Audio playback resolves recording paths against the configured `TRUNKSCOPE_CALLS_PATH` (plus the documented default root), so custom roots never orphan recordings.

## AI provider layer

`providers.rs` implements adapters:

- **Transcription** — OpenAI Whisper multipart
- **Summary** — Ollama generate, OpenAI chat completions, Anthropic messages
- **Geocode** — Nominatim, LocationIQ, Google, Mapbox

Settings select provider type + URL + API key. No models ship inside the TrunkScope image.

## Authentication

- Argon2-hashed credentials in `audio/auth.json`
- Session cookie for admin routes
- `TRUNKSCOPE_LOCAL_ONLY=true` bypasses auth (trusted LAN only)
- Audio download requires session or bearer token

## Public publication boundary

All resources are private by default. Public feed policy evaluates allowlist, delay, and exposure flags before any delayed publication. Encrypted calls are always excluded.

## Deferred: multi-service Compose

[`deploy/compose.yml`](../deploy/compose.yml) split control plane, web nginx, Postgres, MinIO, and optional AI sidecars. That layout is **not** the supported operator path. New features must not depend on it.

## Remote SDR mode

```text
SoapyRemote host ──TCP 55132──► Appliance (decoder mode, remote Soapy device string)
```

Decoding and recording remain on the appliance; only IQ capture runs remotely.
