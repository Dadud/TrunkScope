# TrunkScope agent handoff

This file is the durable project brief for future agents. Treat it as context and operational guidance, not as a substitute for verifying the current repository and deployment.

## Start here (agents)

| Order | Document | Why |
|-------|----------|-----|
| 1 | [`docs/ai-contributing.md`](docs/ai-contributing.md) | Git, verify, commit/push rules |
| 2 | [`docs/development.md`](docs/development.md) | Build, test, module map, pitfalls |
| 3 | This file | Architecture, product decisions, live facts |
| 4 | [`opencode.json`](opencode.json) | OpenCode permissions |
| 5 | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Human + agent entry index |

OpenCode and Cursor should run from the **repository root** so config files are discovered.

## Project objective

TrunkScope is a self-hosted, receive-only SDR scanner appliance. The **single-container appliance** (`deploy/appliance.yml`, Unraid template) is the only supported operator install path. Unraid is the primary tested deployment target.

Supported targets:

- P25 Phase 1/2 trunking through Trunk Recorder.
- Trunked DMR (Tier III / MotoTRBO) through Trunk Recorder: protocol `dmr`, control channels + talkgroups like P25, `dmrRecorders` pool per source (default 4), calls categorized "DMR" at ingestion.
- Conventional analog NFM/FM with squelch and CTCSS/DCS support.
- Local SDRplay RSP1B, RTL-SDR, and Airspy-compatible receivers.
- Remote SDR nodes over trusted LAN/VPN through SoapyRemote.
- Simulator mode for development and CI only.

## Architecture

- `apps/control-plane`: Rust API, persistence, receiver lifecycle, decoder event ingestion, audio safety, AI processing, operations summaries, auth, diagnostics, imports, provider model discovery, and WebSocket/event state.
- `apps/web`: React/Vite responsive operator console and mobile UI.
- `native/radiod`: native SDR capture boundary and simulator contract.
- `crates/domain`: shared radio, call, policy, settings, and conversation types.
- `deploy/appliance.yml`: **supported** single-container operator install.
- `deploy/compose.yml`: deferred multi-service stack (development reference only).
- `deploy/unraid`: Unraid setup, Community Applications XML template, and operational documentation.
- `deploy/receiver-node`: optional remote SoapyRemote receiver deployment.
- `deploy/decoder`: Trunk Recorder configuration, fixtures, and generated profile documentation.
- `scripts`: deployment, backup/restore, retention, failure injection, decoder generation, and hardware acceptance tools.
- `docs`: operator and developer documentation — start at `docs/README.md`.

## Product decisions

- No UI control may be a dead end. It must change runtime behavior, persist a deliberate deferred operation, or be removed.
- Persisted settings are authoritative after startup; environment variables are first-run defaults.
- Public feeds are disabled by default and require an allowlist plus privacy policy.
- Encrypted calls retain metadata only. Encrypted audio/transcripts never enter playback or AI pipelines.
- Short dispatch/reply transmissions are grouped into conversation sessions with dwell/merge behavior before transcription and summarization.
- Operations summaries are AI-written narratives over structured site/channel activity, with an explicit structured fallback when AI is unavailable.
- The project remains integration-incomplete until physical RF acceptance gates are proven; compilation and a healthy web page are not sufficient evidence.

## Completed implementation areas

### Runtime and receiver

- Persisted settings drive mode, device arguments, frequency, sample rate, bandwidth, gain, AGC, and PPM.
- **Multi-SDR:** multiple local USB devices (Soapy indices) and remote SoapyRemote nodes; see `docs/receivers.md`.
- Receivers carry `enabled`, `role`, `soapyIndex`, and driver presets (`apps/control-plane/src/receiver_presets.rs`).
- `GET /api/v1/receivers/discover` lists local Soapy devices for the UI.
- `SystemProfile.receiverId` assigns P25/analog systems to a receiver; multi-receiver installs emit multiple Trunk Recorder `sources[]` entries (`decoder_config_value` in `api.rs`).
- Receiver states and diagnostics distinguish RF capture, decoder, recording, ingestion, and AI status.
- Receiver lifecycle operations include probe, start, stop, restart, reconnect, capabilities, and verify.
- Remote Soapy endpoints are parsed and probed explicitly.
- RSP1B defaults are capability-oriented rather than one hard-coded gain value.
- Appliance image installs Soapy modules for RTL-SDR, Airspy, and remote; SDRplay uses the vendor runtime mount.
- **Saves apply automatically:** config generation tracking (`config_generation`/`applied_generation` in `AppState`, task in `apply.rs`) reloads the capture after saves — radiod interrupts its child, decoder mode runs `supervisorctl restart decoder` (supervisord has a unix socket), `POST /api/v1/decoder/apply` forces it. UI reports `decoderConfigPending` as a header pill; never tell operators to "restart to apply".
- Per-receiver `autoTune` toggles Trunk Recorder's experimental offset auto-correction (useful for RTL-SDR clocks).
- **Deferred:** per-receiver `radiod` workers with health attribution (single capture path today).

### Radio and decoding

- Trunk Recorder is the production P25 backend.
- Generated decoder configuration supports filtered systems/sites, control channels, talkgroups, recordings, and JSON/event ingestion.
- Analog FM profiles support direct frequency, modulation, bandwidth, squelch, tone, deviation, dwell, lockout, and scan behavior.
- CTCSS/DCS validation and matching tests exist.
- Black River Falls site filtering is supported through `TRUNKSCOPE_SITE_FILTER`.
- Test fixtures include Black River Falls/Jackson and Wood County data.

### Audio, archive, and AI

- Finalized audio is validated against the calls volume before archive insertion.
- Authenticated playback/download endpoints exist.
- Call state flows through detection, recording, finalization, archive, transcription, and summary processing.
- Conversation sessions merge rapid back-and-forth traffic.
- Operations summaries support 1h, 4h, and 12h windows, grouped by site and channel plan.
- AI narrative summaries use the configured Ollama/summary provider and report provider failure instead of pretending fallback text is AI-generated.
- **Transcription and summary models are discovered from the configured endpoint**, not chosen from a static ASR profile list:
  - `GET` or `POST /api/v1/integrations/transcribe/models` — queries `{origin}/v1/models` (OpenAI-compatible catalog).
  - `GET` or `POST /api/v1/integrations/summary/models` — queries Ollama `{origin}/api/tags` when `summaryProvider` is `ollama` or the URL contains `/api/generate`; otherwise OpenAI `/v1/models`.
  - POST accepts draft URL/provider/API key overrides so the UI can discover **before** settings are saved.
  - Implementation: `apps/control-plane/src/providers.rs`; selection heuristics: `apps/web/src/integrationModels.ts`.
- `aiProfile` is **derived** from the selected transcribe model name (e.g. Qwen3-ASR → `gpu-qwen3`, radio-tuned Qwen → `experimental-radio`) and stored for diagnostics; operators do not pick it manually.
- Compatible ASR backends: any OpenAI-compatible `POST /v1/audio/transcriptions` server (Speaches, vLLM with `vllm[audio]`, Groq, OpenAI). Qwen3-ASR requires vLLM or similar — not Speaches/Whisper-only stacks.
- Discord notification support exists through a configured webhook.

### UI

- Desktop and mobile navigation expose the same major capabilities.
- Main feed is bounded to the five most relevant transmissions.
- New calls update without stealing the selected call.
- Feed rows expand inline to show audio, transcript, summary, location, and metadata.
- Operations brief uses 1h/4h/12h tabs and configurable refresh interval (default 15 minutes).
- Map center defaults to Spaulding Rd / Old Hwy 54, Pittsville, Wisconsin, while persisted home settings win.
- Error boundaries and route-level loading/error states are present.
- **Console drawer** (`ApplianceDrawer.tsx`): tabs are **Sources** (capture settings + receivers with device presets from `GET /api/v1/receivers/presets`), **Systems** (per-system card with P25 NAC hex / FM PL tone + per-system talkgroups + CSV import; no standalone Talkgroups tab), **Scanning** (radiod-only), integrations with endpoint-based model pickers (`IntegrationModelField.tsx`), policy, security, diagnostics. Frequencies are edited in MHz (`MhzField`); the API stays Hz.
- **Trunk Recorder fidelity:** talkgroup CSV uses canonical RR column order with `Mode` (A/D/M/T) and `Priority` (-1 when record off); conventional systems emit sanitized `shortName: "FM"` (display names never reach filenames), system squelch seeds from the FM profile, and `decodeMDC` is profile-driven.
- **TR multi-channel:** sources emit `digitalRecorders`/`analogRecorders` (defaults 6/4, per-receiver overridable); global `minDuration 1.0`, `maxDuration 3600`, `controlRetuneLimit` sized to the control plan, `compressWav true`, organized `filenameFormat`. TR monitors every planned channel in a source's coverage simultaneously — no scanning; the Monitoring tab shows coverage/recorder pools (radiod scan lists are legacy, radiod-mode only).
- **Ingestion is idempotent:** WS + upload script + sidecar poller may deliver the same call; audio-path aliasing (`audio_alias` in `AppState`) merges them into one call, and `enqueued_calls` guarantees the AI pipeline runs once. Playback resolves audio keys against the configured calls root (custom roots never 404).
- **Stale-call sweep** (`decoder::spawn_stale_sweep`): decoder calls Active longer than 5 minutes without an event are finalized metadata-only; a late sidecar still attaches audio via upsert.
- P25 systems expose `monitorEncrypted` (Trunk Recorder experimental): metadata-only tracking of encrypted calls; TrunkScope ingestion already withholds encrypted audio everywhere.
- **Integrations tab:** stack presets seed URLs; transcribe/summary models auto-discover on URL change (debounced) with manual override fallback; derived ASR profile shown read-only.
- **First-run wizard** uses the same model discovery flow as the integrations tab.

### Deployment and authentication

- Docker Compose is the full multi-service reference stack.
- The single-container appliance (`Dockerfile`, Unraid `trunkscope.xml`) is the **only supported operator install path**: one volume, one published port, Trunk Recorder + control plane + web UI + SQLite persistence.
- The full Compose stack (`deploy/compose.yml`) is **deferred** — development reference only.
- Unraid synchronization/build tooling is in `scripts/unraid-deploy.py`.
- The deployment script must use `--env-file .env -f deploy/compose.yml` and run from the app root.
- SDRplay vendor runtime is mounted from the configured Unraid path and USB access is isolated to the vendor service.
- `TRUNKSCOPE_LOCAL_ONLY=true` is supported for trusted-LAN appliances. It skips login and grants administrator access to anyone who can reach the service. It is disabled by default and must never be exposed publicly.
- Normal credential-based authentication remains available.

## Known live deployment facts

The tested Unraid appliance is on the local network at `192.168.1.4:18088`.

- A physical SDRplay RSP1B is attached directly to Unraid (`USB ID 1df7:3050`).
- The live persisted source is local `driver=sdrplay`, not a laptop/remote endpoint.
- The live P25 site filter is Black River Falls.
- Control channels are 152.1125 MHz and 152.2175 MHz.
- Trunk Recorder has identified system ID `B0C` and NAC `B00` on the physical receiver.
- Jackson County FM test channels are configured at 154.445 MHz / 123.0 PL and 151.0625 MHz / 82.5 PL.
- Ollama summary on the appliance LAN (`192.168.1.4:11434`) is healthy with `qwen3.5:9b-q4_K_M` installed.
- Transcription may target a **separate** LAN host (e.g. vLLM on a Windows PC with a 3060). Use the LAN IP in `transcribeUrl`, not `localhost`; confirm `GET {origin}/v1/models` responds from the appliance network before expecting transcripts.
- **Docker VMM** (Docker Desktop’s new VM backend) does **not** expose NVIDIA GPUs to Linux containers yet. The vLLM transcription host must use the **WSL 2** backend or run vLLM inside WSL2 — see `deploy/vllm-asr/README.md`.
- Local-only mode is currently enabled on the tested appliance; keep the port restricted to the trusted LAN/VPN.

Do not store passwords, tokens, private keys, or live credential files in this repository. Obtain them from the operator/environment when deployment work explicitly requires them.

## Verification evidence

Routine source checks:

```bash
cargo test --workspace
pnpm --filter @trunkscope/web lint
pnpm --filter @trunkscope/web test
pnpm --filter @trunkscope/web build
docker compose -f deploy/appliance.yml config --quiet
```

Hardware acceptance should use `scripts/verified-hardware-acceptance.py` and the procedure in `docs/rf-acceptance.md`. A true completion claim requires physical proof for:

1. RSP1B probe and applied settings.
2. Continuous non-simulated RF metrics.
3. FM recording with static suppressed.
4. Matching and mismatched tone behavior.
5. P25 control-channel lock.
6. Talkgroup voice following.
7. Readable WAV playback.
8. Archive ingestion with correct metadata.
9. Transcription and AI summary after finalization.
10. Recovery from SDR, decoder, storage, and AI failures.
11. Clean Docker and Unraid smoke tests.
12. UI controls changing behavior or reporting intentional deferral.

## Agent workflow

1. Inspect the current repository, git status, Compose configuration, and persisted/live state before making claims.
2. Read this file plus the relevant `docs/` and deployment README before changing runtime behavior.
3. **AI agents:** follow [`docs/ai-contributing.md`](docs/ai-contributing.md) for commit, push, and verification rules. OpenCode loads [`opencode.json`](opencode.json); Cursor loads [`.cursor/rules/`](.cursor/rules/).
4. Keep source, Docker, Unraid, and UI changes synchronized; never validate only a local build when the user asked about the appliance.
5. Prefer `rg` for discovery and `apply_patch` for source edits.
6. Run proportionate tests after changes. For deployment changes, validate Compose config and rebuild the affected services.
7. When testing live Unraid, report the exact observed state and distinguish hardware, simulated, unavailable, and stale-recording evidence.
8. Update `docs/completion-status.md` only with evidence-backed status. Do not mark physical acceptance gates complete based on old recordings or software-only checks.
9. Keep the five-call feed and AI operations brief behavior intact unless the operator explicitly changes that product decision.

## Agent pointers (high-churn areas)

| Area | Primary files |
|------|----------------|
| Multi-SDR / decoder sources | `apps/control-plane/src/api.rs`, `receiver_presets.rs`, `docs/receivers.md` |
| AI provider + model discovery | `apps/control-plane/src/providers.rs`, `apps/web/src/integrationModels.ts`, `IntegrationModelField.tsx` |
| Integrations UI | `apps/web/src/components/ApplianceDrawer.tsx`, `FirstRunWizard.tsx` |
| Settings persistence | `apps/control-plane/src/state.rs`, `apps/web/src/api.ts` |
| AI operator docs | `docs/ai-providers.md` |
| Agent onboarding | `CONTRIBUTING.md`, `docs/ai-contributing.md`, `opencode.json`, `.cursor/rules/` |

## GitHub

The repository is hosted at:

https://github.com/Dadud/TrunkScope

The initial published snapshot was committed on `main` as `9690f8e`.
