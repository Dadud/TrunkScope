# AI providers

TrunkScope never bundles AI models. All transcription, summarization, and geocoding run on **external** services you configure — on your LAN or in the cloud.

## Enrichment behavior and current limitations

The scheduled and manual transcript enrichment paths accept only completed calls with clear encryption status and nonempty transcripts. Encrypted, unknown-encryption, active, and failed calls are excluded even when a legacy record contains text.

Task results are saved to the appliance SQLite database. Scheduled processing checks both the transcript and the effective provider, endpoint, model, prompt, and prompt version before reusing a completed result. Changing these settings invalidates the cached result on the next scheduled pass.

Model output must be a JSON object. Invalid JSON is reported as `invalid-output`; provider timeouts are reported separately. Missing confidence is unknown, not an automatically assigned score. Top-level evidence quotes must occur verbatim in the transcript; invalid quotes are reported as `invalid-evidence`. Offsets are derived in Unicode code points. This validates the quoted text, not whether it supports an extracted field; nested field-level evidence validation is still incomplete.

Audio dispatch-tone classification is not implemented. The scheduler reports it as skipped, and manual execution reports it as unavailable. Transcript words such as “tone out” do not establish that two-tone, MDC, or DTMF audio was detected.

The current correlation task extracts potential references from individual calls; it does not yet establish cross-channel incident links. The map-placement task extracts location candidates; it does not yet implement the full confidence-based placement/review workflow. Per-task fallback routing, evidence-span verification, and the workload dashboard still require implementation and end-to-end acceptance. A successful appliance build or an HTTP 200 response does not establish completion of these features.

## Network rule

Inside Docker, **`localhost` is the container itself**. Always use the host **LAN IP**:

```text
Good:  http://192.168.1.10:11434/api/generate
Bad:   http://localhost:11434/api/generate
Bad:   http://ollama:11434/...        (only works in multi-service Compose)
```

## Configure in the UI

1. Open **Appliance → AI & Integrations**
2. Enable **AI**
3. Pick a **stack preset** or enter URLs manually
4. Add API keys for cloud providers
5. Click **Test transcription**, **Test summary**, **Test geocoder**
6. Save

First-run wizard offers the same presets on initial launch.

## Stack presets

| Preset | Transcription | Summary | Geocode |
|--------|---------------|---------|---------|
| **Local GPU** | Speaches + Qwen3-ASR | Ollama `llama3.2:3b` | Nominatim |
| **Local CPU** | Speaches small | Ollama | Nominatim |
| **vLLM homelab** | Speaches or Groq | vLLM chat completions | LocationIQ |
| **Cloud hybrid** | Groq Whisper | OpenRouter | Google Geocoding |
| **Privacy max** | Local Speaches | Ollama only | Regex hints only (no geocoder URL) |
| **Custom** | Manual URLs | Manual | Manual |

Replace `192.168.1.10` in preset URLs with your AI host IP.

---

## Transcription (ASR)

**Protocol:** OpenAI-compatible multipart `POST` with `file`, `model`, `response_format=json` → `{ "text": "..." }`

| Provider key | Type | Example URL | Auth |
|--------------|------|-------------|------|
| `openai-compatible` | Self-hosted | `http://HOST:8000/v1/audio/transcriptions` | Optional Bearer |
| `speaches` | Self-hosted | Same as above | Usually none |
| `openai-whisper` | Cloud | `https://api.openai.com/v1/audio/transcriptions` | Bearer `sk-…` |
| `groq-whisper` | Cloud | `https://api.groq.com/openai/v1/audio/transcriptions` | Bearer |

### Recommended models

| Use case | Model |
|----------|-------|
| CPU / low latency | `Systran/faster-distil-whisper-small.en` |
| GPU general | `large-v3` via faster-whisper or Speaches |
| Radio-tuned | `Qwen/Qwen3-ASR-1.7B`, `chrullis/qwen3-asr-radio-1.7b` |

### Environment

```bash
TRUNKSCOPE_TRANSCRIBE_URL=http://192.168.1.10:8000/v1/audio/transcriptions
TRUNKSCOPE_TRANSCRIBE_API_KEY=          # optional
TRUNKSCOPE_TRANSCRIBE_MODEL=Systran/faster-distil-whisper-small.en
```

---

## Summary and Ask AI

Used for per-call summaries, operations brief (1h/4h/12h), and **Ask AI**.

| Provider key | Protocol | Example URL | Auth |
|--------------|----------|-------------|------|
| `ollama` | Ollama generate | `http://HOST:11434/api/generate` | None |
| `openai-compatible` | Chat completions | `http://HOST:PORT/v1/chat/completions` | Optional Bearer |
| `anthropic` | Messages API | `https://api.anthropic.com/v1/messages` | `x-api-key` header |

`openai-compatible` covers vLLM, LM Studio, LocalAI, OpenRouter, Groq, and Together.

### Environment

```bash
TRUNKSCOPE_SUMMARY_URL=http://192.168.1.10:11434/api/generate
TRUNKSCOPE_SUMMARY_API_KEY=
TRUNKSCOPE_SUMMARY_MODEL=llama3.2:3b
```

When AI is unavailable, the operations brief falls back to structured thread headlines — it does not pretend fallback text was AI-generated.

---

## Geocoding

Location hints are extracted from transcripts (regex + optional LLM pass), then sent to the configured geocoder.

| Provider key | Auth | Notes |
|--------------|------|-------|
| `nominatim` | None (public) or self-hosted | Default; respect OSM usage policy |
| `locationiq` | API key in query | `geocoderUrl` = LocationIQ search endpoint |
| `google` | API key | Uses Google Geocoding JSON API |
| `mapbox` | Access token | Mapbox Geocoding API |

### Environment

```bash
TRUNKSCOPE_GEOCODER_URL=https://nominatim.openstreetmap.org/search
TRUNKSCOPE_GEOCODER_API_KEY=
```

---

## Discord notifications

- Default webhook: `discordWebhookUrl`
- **Keyword rules**: match transcript/summary text → optional override webhook
- **Talkgroup rules**: route by decimal talkgroup ID → dedicated webhook

Test: **Test Discord webhook** button or `POST /api/v1/integrations/discord/test`

---

## Encrypted traffic policy

Encrypted P25 calls retain **metadata only**. TrunkScope never sends encrypted audio to ASR or summary providers.

---

## Self-hosted examples

### Ollama (summary)

```bash
# On AI host
ollama pull llama3.2:3b
ollama serve   # listens on :11434
```

TrunkScope URL: `http://AI_HOST:11434/api/generate`

### Speaches (transcription)

Run [Speaches](https://github.com/speaches-ai/speaches) or compatible faster-whisper server on port 8000.

TrunkScope URL: `http://AI_HOST:8000/v1/audio/transcriptions`

### vLLM (summary via OpenAI-compatible)

```bash
vllm serve meta-llama/Llama-3.2-3B-Instruct --port 8001
```

Set `summaryProvider` = `openai-compatible`  
URL: `http://AI_HOST:8001/v1/chat/completions`

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| AI worker `error` | Diagnostics → AI failure reason; test buttons in Integrations |
| Empty transcripts | `transcribeUrl` reachable from container (`docker exec` curl) |
| Summary always fallback | `summaryUrl` wrong protocol (Ollama vs chat completions) |
| Geocoder no results | API key, rate limits, hint text too vague |

More: [troubleshooting.md](troubleshooting.md)
