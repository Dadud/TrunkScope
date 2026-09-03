# TrunkScope agent handoff

This file is the durable project brief for future agents. Treat it as context and operational guidance, not as a substitute for verifying the current repository and deployment.

## Project objective

TrunkScope is a self-hosted, receive-only SDR scanner appliance. The **single-container appliance** (`deploy/appliance.yml`, Unraid template) is the only supported operator install path. Unraid is the primary tested deployment target.

Supported targets:

- P25 Phase 1/2 trunking through Trunk Recorder.
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
- **Appliance drawer** (`ApplianceDrawer.tsx`): receivers (discover/probe/verify), systems with receiver assignment, integrations with endpoint-based model pickers (`IntegrationModelField.tsx`), policy, security, diagnostics.
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
3. Keep source, Docker, Unraid, and UI changes synchronized; never validate only a local build when the user asked about the appliance.
4. Prefer `rg` for discovery and `apply_patch` for source edits.
5. Run proportionate tests after changes. For deployment changes, validate Compose config and rebuild the affected services.
6. When testing live Unraid, report the exact observed state and distinguish hardware, simulated, unavailable, and stale-recording evidence.
7. Update `docs/completion-status.md` only with evidence-backed status. Do not mark physical acceptance gates complete based on old recordings or software-only checks.
8. Keep the five-call feed and AI operations brief behavior intact unless the operator explicitly changes that product decision.

## Agent pointers (high-churn areas)

| Area | Primary files |
|------|----------------|
| Multi-SDR / decoder sources | `apps/control-plane/src/api.rs`, `receiver_presets.rs`, `docs/receivers.md` |
| AI provider + model discovery | `apps/control-plane/src/providers.rs`, `apps/web/src/integrationModels.ts`, `IntegrationModelField.tsx` |
| Integrations UI | `apps/web/src/components/ApplianceDrawer.tsx`, `FirstRunWizard.tsx` |
| Settings persistence | `apps/control-plane/src/state.rs`, `apps/web/src/api.ts` |
| AI operator docs | `docs/ai-providers.md` |

## GitHub

The repository is hosted at:

https://github.com/Dadud/TrunkScope

The initial published snapshot was committed on `main` as `9690f8e`.
