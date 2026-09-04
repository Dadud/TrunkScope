# Configuration

Settings are persisted in `audio/settings.json` on the appdata volume. Environment variables apply at **first run** and as fallbacks when a field is empty in settings.

## Web UI

Open **Console** (gear icon) → tabs:

| Tab | Contents |
|-----|----------|
| **Sources** | Capture mode, device defaults, SDR receivers (presets, auto-tune, recorder pools), site filter |
| **Systems** | P25 / FM profiles, per-system talkgroups, site editor, CSV import, MDC decode |
| **Monitoring** | Live coverage view (decoder mode); legacy FM scan lists (radiod mode only) |
| **AI & Integrations** | Providers, API keys, Discord, retention |
| **Policy** | Public feed allowlist and privacy |
| **Diagnostics** | Runtime state, decoder config preview, forced apply |
| **Security** | Password rotation |

Saves apply automatically: the running capture reloads within a few seconds (the header shows **PENDING APPLY** until it does). Diagnostics offers a forced reload for impatience.

## Core settings (`AppSettings`)

| Field | Description |
|-------|-------------|
| `radioMode` | `decoder` (production), `radiod`, or `simulator` |
| `radioDevice` | Soapy device string |
| `radioFrequencyHz` | Center frequency (Hz) |
| `radioSampleRateHz` | Sample rate (Hz) |
| `radioGainDb` / `radioAgc` / `radioPpm` | Receiver tuning |
| `siteFilter` | Case-insensitive substring for P25 site names |
| `aiEnabled` | Master switch for transcription and summary workers |
| `wizardCompleted` | First-run wizard dismissed |

## AI integration fields

| Field | Description |
|-------|-------------|
| `transcribeProvider` | `openai-compatible`, `openai-whisper`, `groq-whisper`, etc. |
| `transcribeUrl` | ASR endpoint (multipart Whisper-style) |
| `transcribeApiKey` | Bearer token for cloud ASR |
| `transcribeModel` | Model name sent to ASR |
| `summaryProvider` | `ollama`, `openai-compatible`, `anthropic` |
| `summaryUrl` | Summary endpoint |
| `summaryApiKey` | API key / bearer |
| `summaryModel` | Model identifier |
| `geocoderProvider` | `nominatim`, `locationiq`, `google`, `mapbox` |
| `geocoderUrl` | Geocoder base URL |
| `geocoderApiKey` | Provider API key |
| `discordWebhookUrl` | Default Discord webhook |
| `discordKeywordRules` | Keyword → optional override webhook |
| `discordTalkgroupRules` | Talkgroup decimal ID → webhook |
| `compatIngestEnabled` | Enable `POST /api/call-upload` |

Test buttons call `POST /api/v1/integrations/{transcribe,summary,geocoder}/test`.

Full provider catalog: [ai-providers.md](ai-providers.md)

## Environment variables

### Radio

| Variable | Purpose |
|----------|---------|
| `TRUNKSCOPE_RADIO_MODE` | `decoder`, `radiod`, or `simulator` |
| `TRUNKSCOPE_RADIO_DEVICE` | Soapy device string |
| `TRUNKSCOPE_RADIO_FREQUENCY_HZ` | Default center frequency |
| `TRUNKSCOPE_RADIO_SAMPLE_RATE_HZ` | Default sample rate |
| `TRUNKSCOPE_RADIO_BANDWIDTH_HZ` | Bandwidth hint |
| `TRUNKSCOPE_RADIO_GAIN_DB` | Manual gain |
| `TRUNKSCOPE_RADIO_AGC` | `true` / `false` |
| `TRUNKSCOPE_RADIO_PPM` | PPM correction |
| `TRUNKSCOPE_SITE_FILTER` | P25 site name filter |

### Paths (defaults under `/var/lib/trunkscope`)

| Variable | Default |
|----------|---------|
| `TRUNKSCOPE_SETTINGS_PATH` | `audio/settings.json` |
| `TRUNKSCOPE_SYSTEMS_PATH` | `audio/systems.json` |
| `TRUNKSCOPE_TALKGROUPS_PATH` | `audio/talkgroups.json` |
| `TRUNKSCOPE_SCAN_LISTS_PATH` | `audio/scan-lists.json` |
| `TRUNKSCOPE_CALLS_PATH` | `calls/` |
| `TRUNKSCOPE_SQLITE_PATH` | `trunkscope.db` |
| `TRUNKSCOPE_DECODER_CONFIG_PATH` | `audio/decoder/config.json` |

### AI fallbacks

| Variable | Purpose |
|----------|---------|
| `TRUNKSCOPE_AI_ENABLED` | Bootstrap AI on/off |
| `TRUNKSCOPE_TRANSCRIBE_URL` | ASR URL if settings empty |
| `TRUNKSCOPE_TRANSCRIBE_API_KEY` | ASR auth |
| `TRUNKSCOPE_TRANSCRIBE_MODEL` | ASR model |
| `TRUNKSCOPE_SUMMARY_URL` | Summary URL if settings empty |
| `TRUNKSCOPE_SUMMARY_API_KEY` | Summary auth |
| `TRUNKSCOPE_SUMMARY_MODEL` | Summary model |
| `TRUNKSCOPE_GEOCODER_URL` | Geocoder URL |
| `TRUNKSCOPE_GEOCODER_API_KEY` | Geocoder auth |
| `TRUNKSCOPE_DISCORD_WEBHOOK_URL` | Discord default webhook |

### Security

| Variable | Purpose |
|----------|---------|
| `TRUNKSCOPE_LOCAL_ONLY` | Skip login; grant admin to all clients |
| `TRUNKSCOPE_AUTH_PATH` | `audio/auth.json` credential store |

### Workers

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRUNKSCOPE_AI_WORKERS` | `4` | Parallel AI workers (1–4) |
| `TRUNKSCOPE_UPLOAD_SCRIPT` | ingest script path | Trunk Recorder upload hook |

## P25 system profiles

Configure in **Appliance → Systems**:

- **Protocol** `p25`: control channel(s), NAC, sites
- **Sites**: control/voice channel lists, lat/lon (manual or CSV import)
- **Talkgroups**: per-system CSV files generated for Trunk Recorder

`siteFilter` limits which sites appear in generated decoder config (useful for statewide systems).

## DMR system profiles

**Protocol** `dmr`: trunked DMR (Tier III / MotoTRBO). Control channel(s) + talkgroups work exactly like P25; NAC does not apply. Each source exposes a `dmrRecorders` pool (default 4, one consumed per active TDMA slot). Calls ingest with category **DMR**; encryption withholding applies identically.

## P25 encrypted-call metadata

P25 systems can enable **Monitor encrypted** (Trunk Recorder's `monitorEncrypted`): encrypted calls are tracked for talkgroup activity metadata without recording audio — matching the TrunkScope rule that encrypted calls retain metadata only.

## Conventional FM

- **Protocol** `analog-fm`: frequency, bandwidth, squelch, CTCSS/DCS tone
- Scan lists drive radiod mode channel hopping
- Decoder mode uses `analog-channels.csv` generated beside decoder config

## Retention

| Setting | Default | Effect |
|---------|---------|--------|
| `audioRetentionDays` | 30 | Delete WAV files after N days |
| `transcriptRetentionDays` | 365 | Strip transcript/summary |
| `metadataRetentionDays` | 365 | Purge call rows entirely |

An in-process retention worker runs hourly. Manual purge: **Archive → Purge** with undo support.

## Public feed policy

Disabled by default. Enabling requires:

- At least one allowed talkgroup UUID
- Explicit delay, transcript, radio ID, and location exposure flags

Encrypted calls are never published regardless of policy.
