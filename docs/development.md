# Development

Local development workflow for TrunkScope contributors.

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
```

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

## Adding API routes

1. Handler in `apps/control-plane/src/api.rs`
2. Register in `router()`
3. Client helper in `apps/web/src/api.ts`
4. UI in `ApplianceDrawer` or relevant component
5. Test in `api.rs` `#[cfg(test)]` module

## Documentation

Operator docs live in `docs/`. Update them when changing install paths, env vars, or provider behavior. The index is [docs/README.md](README.md).

Agent context for automation: [AGENTS.md](../AGENTS.md) (not a substitute for reading the code).

## CI-equivalent check (pre-push)

```bash
cargo test --workspace && \
pnpm --filter @trunkscope/web lint && \
pnpm --filter @trunkscope/web test && \
pnpm --filter @trunkscope/web build && \
docker compose -f deploy/appliance.yml config --quiet
```
