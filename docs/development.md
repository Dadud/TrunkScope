# Development

Local development workflow for TrunkScope contributors and coding agents.

## Agent onboarding

If you are an **OpenCode**, **Cursor**, or other coding agent, start at [CONTRIBUTING.md](../CONTRIBUTING.md) and [ai-contributing.md](ai-contributing.md) before editing. Human developers can skip straight to prerequisites below.

## Prerequisites

| Tool | Version |
|------|---------|
| Rust | 1.85+ (see `rust-version` in `Cargo.toml`) |
| Node.js | 22+ |
| pnpm | 10+ |
| Docker | Linux engine (for appliance image builds) |

## Repository layout

```text
apps/control-plane/   Rust binary (API + workers)
apps/web/             React/Vite frontend
crates/domain/        Shared types
native/radiod/        SDR daemon (Linux)
deploy/appliance.yml  Supported deploy file for integration testing
deploy/compose.yml    Deferred multi-service stack (dev reference only)
deploy/vllm-asr/      Optional Windows/WSL2 vLLM stack for Qwen3-ASR transcription
```

## Conventions agents must know

### Supported vs deferred paths

| Path | Status |
|------|--------|
| `deploy/appliance.yml` | **Supported** operator install |
| `deploy/compose.yml` | Deferred dev reference only |
| `deploy/vllm-asr/` | Optional external transcription host |

### React (apps/web)

- **Hooks order:** never `return` early before all `useState` / `useEffect` calls in a component. Early return after hooks is fine (see `ApplianceDrawer.tsx`).
- **Frequencies:** use `MhzField` + `mhzToHz` / `hzToMhz` in `format.ts` — UI shows MHz, API stores Hz.
- **New entity IDs:** use nil UUID `00000000-0000-0000-0000-000000000000`, not `""`. Empty strings break UUID deserialization (HTTP 422).
- **API client:** add helpers in `apps/web/src/api.ts`; normalize payloads before POST when IDs or optional fields need cleanup.

### Rust (control-plane)

- Shared settings/types: `apps/control-plane/src/state.rs` and `crates/domain/`.
- Register new routes in `router()` inside `api.rs`; add `#[cfg(test)]` coverage when behavior is non-trivial.
- Regenerate decoder config when receivers or systems change (`write_decoder_config`).

### AI integrations

- Models are **discovered** from configured endpoints (`providers.rs`, `integrationModels.ts`).
- Do not reintroduce manual ASR profile dropdowns.
- Appliance containers must use **LAN IPs** for AI URLs, not `localhost`.
- GPU transcription on Windows Docker Desktop requires **WSL 2** backend, not Docker VMM — see `deploy/vllm-asr/README.md`.

### Files to avoid committing

- `.env` (any path) — use `.env.example` templates
- `hardware-acceptance.json` unless from a real hardware acceptance run
- Secrets, operator passwords, or live tokens from chat

## Build and test

```bash
# Rust
cargo fmt --all --check
cargo test --workspace
cargo clippy --workspace -- -D warnings   # optional

# Web
pnpm install --frozen-lockfile
pnpm --filter @trunkscope/web lint
pnpm --filter @trunkscope/web test
pnpm --filter @trunkscope/web build
```

## Run control plane locally

```bash
export TRUNKSCOPE_RADIO_MODE=simulator
export TRUNKSCOPE_AI_ENABLED=false
cargo run -p trunkscope-control-plane
```

API: `http://127.0.0.1:8080`

## Run web dev server

```bash
pnpm --filter @trunkscope/web dev
```

UI: `http://127.0.0.1:5173` (proxies API to control plane if configured in Vite)

## Run appliance image

```bash
docker compose -f deploy/appliance.yml up -d --build
```

Validate Compose syntax:

```bash
docker compose -f deploy/appliance.yml config --quiet
```

**Do not** treat `deploy/compose.yml` as the operator install path. Use it only when explicitly testing the deferred multi-service layout.

## Configuration in development

- Bootstrap: environment variables (see [configuration.md](configuration.md))
- Runtime: JSON files under a writable `TRUNKSCOPE_*_PATH` tree
- Simulator mode emits synthetic trunked calls without hardware

Optional legacy Postgres (`TRUNKSCOPE_DATABASE_URL`) mirrors writes when testing the deferred Compose stack. The appliance path uses SQLite only.

## Native radiod

Linux-only. Build with SoapySDR when hardware is available:

```bash
# Hardware-independent build uses simulator backend
cargo build -p trunkscope-radiod
```

## Key modules (control plane)

| Module | Purpose |
|--------|---------|
| `api.rs` | HTTP routes, decoder config generation |
| `state.rs` | `AppSettings`, `AppState`, persistence paths |
| `decoder.rs` | Trunk Recorder WebSocket + ingest |
| `processor.rs` | AI call pipeline |
| `providers.rs` | External ASR/LLM/geocode adapters |
| `sqlite.rs` | Call history database |
| `retention.rs` | Scheduled retention enforcement |
| `imports.rs` | RadioReference CSV parsers |
| `receiver_presets.rs` | SDR driver defaults and capabilities |

## Common change patterns

### Add an API endpoint

1. Handler in `apps/control-plane/src/api.rs`
2. Register in `router()`
3. Client helper in `apps/web/src/api.ts`
4. UI in `ApplianceDrawer.tsx` or relevant component
5. Test in `api.rs` `#[cfg(test)]` module

### Add a system / FM channel

- Protocol `analog-fm` requires `frequencyHz`, `bandwidthHz` (6250 | 12500 | 25000), and `modulation`.
- PL tone optional; blank means carrier squelch. CTCSS/DCS validated server-side.
- Assign `receiverId` when multiple SDRs are configured.

### Add integration UI

- Use `IntegrationModelField.tsx` with `discoverTranscribeModels` / `discoverSummaryModels`.
- POST discovery overrides so models can be listed before settings are saved.

## Documentation

Operator docs live in `docs/`. Update them when changing install paths, env vars, or provider behavior. The index is [docs/README.md](README.md).

Agent context for automation:

- [AGENTS.md](../AGENTS.md) — architecture and live deployment facts
- [ai-contributing.md](ai-contributing.md) — git and verification rules
- [CONTRIBUTING.md](../CONTRIBUTING.md) — entry index for humans and agents

These are not a substitute for reading the code.

## CI-equivalent check (pre-push)

```bash
cargo test --workspace && \
pnpm --filter @trunkscope/web lint && \
pnpm --filter @trunkscope/web test && \
pnpm --filter @trunkscope/web build && \
docker compose -f deploy/appliance.yml config --quiet
```
