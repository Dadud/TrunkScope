# TrunkScope documentation

TrunkScope is a self-hosted, receive-only SDR scanner appliance. One Docker container runs decoding, recording, the operator console, and persistence. AI services stay external.

## Start here

| Document | Audience | Contents |
|----------|----------|----------|
| [Installation](installation.md) | Operators | Single-container deploy, Unraid, USB SDR, first-run wizard |
| [Configuration](configuration.md) | Operators | Settings, environment variables, radio profiles, auth |
| [Receivers](receivers.md) | Operators | Multi-SDR, USB indices, SoapyRemote nodes, system assignment |
| [AI providers](ai-providers.md) | Operators | Speaches, Ollama, vLLM, cloud APIs, test buttons |
| [Operations](operations.md) | Operators | Health, backup, retention, scan lists, acceptance harness |
| [Imports](imports.md) | Operators | RadioReference CSV (talkgroups, sites, systems) |
| [DMR ingest](dmr-ingest.md) | Operators | External SDRTrunk / rdio-scanner upload path |
| [Architecture](architecture.md) | Developers | Components, data flow, persistence model |
| [Development](development.md) | Developers | Build, test, local workflow |
| [AI contributing](ai-contributing.md) | AI agents | Commit/push rules, verification, OpenCode handoff |
| [RF acceptance](rf-acceptance.md) | Integrators | Physical test procedure for FM/P25 gates |
| [Troubleshooting](troubleshooting.md) | Everyone | Docker, SDR, decoder, AI connectivity |
| [Completion ledger](completion-status.md) | Maintainers | Evidence-based integration status |

## Supported install path

**Use the single-container appliance only:**

```bash
docker compose -f deploy/appliance.yml up -d --build
```

[`deploy/compose.yml`](../deploy/compose.yml) (Postgres, MinIO, multi-service) is **deferred** — development reference only.

## Repository map

```text
apps/control-plane   Rust API, SQLite, Trunk Recorder integration, AI workers
apps/web             React operator console (map, feed, appliance drawer)
native/radiod        Optional native SDR boundary (radiod mode)
crates/domain        Shared types
deploy/appliance.yml Supported operator Compose file
deploy/unraid/       Unraid Community Applications template
docs/                This documentation set
scripts/             Acceptance, backup, decoder generation
```

## Safety defaults

- Receive-only — no transmission.
- Public feeds disabled until an administrator configures an allowlist.
- Encrypted calls: metadata only; no audio playback or AI processing.
- Default retention: 30 days audio, 365 days transcripts/metadata.

## License

GPL-3.0-or-later. See [LICENSE](../LICENSE).
