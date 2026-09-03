# AI agent contribution guidelines

This document is for **OpenCode**, **Cursor**, and other coding agents working in this repository. Read it together with [`AGENTS.md`](../AGENTS.md).

## Mission

TrunkScope is a receive-only SDR scanner appliance. Your job is to make **small, correct, test-backed changes** that keep the single-container install path, operator UI, and physical RF acceptance story honest.

## Read before you edit

| File | Why |
|------|-----|
| [`AGENTS.md`](../AGENTS.md) | Architecture, product decisions, live deployment facts |
| [`docs/README.md`](README.md) | Operator vs developer docs index |
| [`docs/ai-providers.md`](ai-providers.md) | External AI services (never bundle models) |
| [`docs/receivers.md`](receivers.md) | Multi-SDR behavior |
| [`opencode.json`](../opencode.json) | OpenCode permissions for this repo |

## Git rules

### When you may commit

Commit **only when the user explicitly asks** (e.g. “commit this”, “push if good”). Do not commit opportunistically after finishing a task.

### When you may push

Push **only when the user explicitly asks**. Pushing to `main` publishes to production for this project — treat it as a release action.

### Never do these without explicit user instruction

- `git push --force` (especially to `main` / `master`)
- `git commit --amend` (unless all safety conditions in user rules are met)
- `git config` (any scope)
- Skip hooks (`--no-verify`, `--no-gpg-sign`)
- Commit secrets: `.env`, credentials, tokens, private keys, live passwords from chat
- Commit `hardware-acceptance.json` unless it is output from a real acceptance run the user wants recorded
- Rewrite history on shared branches

### Standard commit workflow

Run these in parallel first:

```bash
git status
git diff
git diff --cached
git log -5 --oneline
```

Then:

1. **Review** every changed file. Exclude accidental artifacts, local-only JSON, and secrets.
2. **Test** proportionally (see Verification below).
3. **Stage** only relevant paths — prefer explicit `git add <paths>`, not blind `git add -A`.
4. **Commit** with a 1–2 sentence message focused on **why**, not a file list.
5. **Verify** with `git status` after commit.
6. **Push** only if the user asked: `git push origin <branch>`.

### Commit message style

Follow recent history on the branch (`git log`). Examples:

```text
Add multi-SDR support and endpoint-based AI model discovery.

Operators can assign receivers to systems and pick transcribe models from the configured provider URL.
```

```text
Fix password PUT and integration status badges in the appliance drawer.
```

Use imperative mood. One subject line; optional body paragraph.

### Branch policy

- Default branch: `main`
- Prefer focused commits on `main` when the user asks for a direct push
- For large or risky work, suggest a feature branch — but only create/push it when the user wants that workflow

## Verification before commit

Minimum for most code changes:

```bash
cargo test --workspace
pnpm --filter @trunkscope/web lint
pnpm --filter @trunkscope/web test
pnpm --filter @trunkscope/web build
```

Also run when touching deployment:

```bash
docker compose -f deploy/appliance.yml config --quiet
```

Report what you ran and what failed. Do not claim “all green” without executing checks.

## Code change principles

1. **Minimize scope** — smallest correct diff; no drive-by refactors.
2. **Match conventions** — read surrounding code before adding abstractions.
3. **No dead UI** — controls must change runtime behavior, persist a deliberate deferred operation, or be removed.
4. **Persisted settings win** — env vars are first-run defaults only.
5. **Keep docs in sync** — if behavior changes, update the relevant `docs/` page and `AGENTS.md` when agents need the fact.

## AI / integration specifics

- Transcription: OpenAI-compatible `POST /v1/audio/transcriptions`
- Summary: Ollama `/api/generate` or OpenAI `/v1/chat/completions`
- Model pickers discover from the configured endpoint — do not reintroduce a static ASR profile dropdown
- Qwen3-ASR needs vLLM (or compatible ASR server), not Whisper-only Speaches
- Use **LAN IPs** in examples and presets, not `localhost`, for appliance → AI host connectivity

## OpenCode handoff checklist

When taking over a session:

1. `git status` and `git log -3`
2. Read `AGENTS.md` and this file
3. Confirm whether the user wants commits/pushes or working-tree-only changes
4. If deploying to Unraid (`192.168.1.4:18088`), distinguish simulated vs hardware evidence
5. Do not store operator passwords or tokens in the repo

## Pull requests

If the user asks for a PR instead of a direct push:

```bash
git status
git diff
git log main..HEAD
git push -u origin HEAD
gh pr create --title "..." --body "..."
```

Summarize **all** commits on the branch, not only the latest one.
