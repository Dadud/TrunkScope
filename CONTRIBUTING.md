# Contributing to TrunkScope

Thank you for helping improve TrunkScope. This project is a **receive-only SDR scanner appliance** — one supported Docker install path, external AI services, and evidence-backed RF acceptance.

## For AI agents (OpenCode, Cursor, etc.)

Read these **in order** before editing:

| # | File | Purpose |
|---|------|---------|
| 1 | [`AGENTS.md`](AGENTS.md) | Architecture, product decisions, live deployment facts |
| 2 | [`docs/ai-contributing.md`](docs/ai-contributing.md) | Git rules, verification, commit/push workflow |
| 3 | [`docs/development.md`](docs/development.md) | Build, test, module map, common pitfalls |
| 4 | [`opencode.json`](opencode.json) | OpenCode permissions (commit/push prompts) |

**OpenCode:** run from the repository root so `opencode.json` and `AGENTS.md` load automatically.

**Cursor:** project rules live in [`.cursor/rules/`](.cursor/rules/).

### Agent quick rules

- Commit and push **only when the operator explicitly asks**.
- Never commit `.env`, credentials, or stale `hardware-acceptance.json`.
- Keep changes small and test-backed (`cargo test`, `pnpm lint`, `pnpm test`, `pnpm build`).
- The **single-container appliance** (`deploy/appliance.yml`) is the only supported operator install path.
- Do not mark RF acceptance complete without physical evidence.

## For human developers

1. Read [docs/development.md](docs/development.md) for prerequisites and local workflow.
2. Browse [docs/README.md](docs/README.md) for operator vs developer documentation.
3. Open a PR or push to `main` per your team process; follow existing commit message style (`git log`).

## Pre-push verification

```bash
cargo test --workspace
pnpm --filter @trunkscope/web lint
pnpm --filter @trunkscope/web test
pnpm --filter @trunkscope/web build
docker compose -f deploy/appliance.yml config --quiet
```

## What belongs in commits

| Include | Exclude |
|---------|---------|
| Source, tests, operator docs under `docs/` | `.env`, secrets, live passwords |
| `AGENTS.md` updates when agent-relevant facts change | `hardware-acceptance.json` unless from a real acceptance run |
| Deployment templates and `deploy/` READMEs | Large binary recordings or model weights |

## Questions

- **Operators:** start at [docs/installation.md](docs/installation.md)
- **Architecture:** [docs/architecture.md](docs/architecture.md)
- **AI stack:** [docs/ai-providers.md](docs/ai-providers.md) and [deploy/vllm-asr/README.md](deploy/vllm-asr/README.md)

License: GPL-3.0-or-later — see [LICENSE](LICENSE).
