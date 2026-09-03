# TrunkScope

TrunkScope is a receive-only SDR scanner appliance for P25 Phase 1/2 trunking and conventional NFM/FM. It targets RTL-SDR, Airspy, and SDRplay hardware on Linux, with a map-centric operator console, call archive, and optional external AI.

## Install

The **single-container appliance** is the only supported operator path:

```bash
docker compose -f deploy/appliance.yml up -d --build
```

Open `http://127.0.0.1:18088` (or your host port). On Unraid, import [`deploy/unraid/trunkscope.xml`](deploy/unraid/trunkscope.xml).

Full instructions: **[docs/installation.md](docs/installation.md)**

## What you need

| Component | Required? | Notes |
|-----------|-----------|-------|
| Linux host with Docker | Yes | Unraid, mini-PC, or VM |
| USB SDR | For live RF | RTL-SDR, Airspy, or SDRplay RSP1B |
| One appdata volume | Yes | `/var/lib/trunkscope` — settings, SQLite, WAVs |
| External AI | Optional | Speaches/Ollama on LAN, or cloud APIs |

AI is **never bundled** in the image. Configure transcription, summary, and geocoding in the web UI (**Appliance → AI & Integrations**) or via environment variables. Use your **LAN IP** for service URLs inside Docker, not `localhost`.

## Documentation

| Topic | Link |
|-------|------|
| **All docs (index)** | [docs/README.md](docs/README.md) |
| **Contributing (humans + agents)** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Agent handoff** | [AGENTS.md](AGENTS.md) |
| Installation & Unraid | [docs/installation.md](docs/installation.md) |
| Settings & environment | [docs/configuration.md](docs/configuration.md) |
| AI provider setup | [docs/ai-providers.md](docs/ai-providers.md) |
| Backup, health, retention | [docs/operations.md](docs/operations.md) |
| RadioReference CSV import | [docs/imports.md](docs/imports.md) |
| DMR via external decoder | [docs/dmr-ingest.md](docs/dmr-ingest.md) |
| Architecture | [docs/architecture.md](docs/architecture.md) |
| Development | [docs/development.md](docs/development.md) |

## Remote SDR (optional)

An RSP1B can stay on a laptop running SoapyRemote; the appliance decodes over the LAN. See [docs/installation.md#remote-sdr-soapyremote](docs/installation.md#remote-sdr-soapyremote). Keep port `55132` on a trusted LAN or VPN only.

## Development

```bash
cargo test --workspace
pnpm install && pnpm --filter @trunkscope/web test && pnpm --filter @trunkscope/web build
```

Details: [docs/development.md](docs/development.md) · Agents: [CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md)

## Deferred: multi-service Compose

[`deploy/compose.yml`](deploy/compose.yml) (Postgres, MinIO, separate services) remains in the repository for development reference. **Do not use it for production appliance installs.**

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
