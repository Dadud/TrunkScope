# Development

## Commands

```bash
cargo fmt --all -- --check
cargo test --workspace
pnpm install --frozen-lockfile
pnpm -r lint
pnpm -r test
pnpm -r build
```

## Configuration

Configuration is read from environment variables for bootstrap only. Systems,
receivers, talkgroups, policies, and retention settings belong in the database and
are changed through revisioned APIs.

## Native development

The native daemon is Linux-only. Configure with `TRUNKSCOPE_WITH_SOAPY=ON` once
SoapySDR and a supported module are installed. Hardware-independent builds retain
the simulator backend.
