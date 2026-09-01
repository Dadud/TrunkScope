# TrunkScope

TrunkScope is a clean-sheet, receive-only SDR scanner appliance. The first release targets
P25 Phase 1/2 and conventional NFM on Linux with RTL-SDR, Airspy, and SDRplay receivers.

This repository currently contains the first executable vertical slice:

- `apps/control-plane`: Rust API and live-event service with a deterministic RF simulator.
- `apps/web`: React/TypeScript progressive web application.
- `native/radiod`: native Linux RF daemon boundary and simulator contract.
- `crates/domain`: shared radio, call, policy, and configuration types.
- `contracts`: public/internal wire contracts.
- `deploy`: PostgreSQL and local object-storage development services.

## Quick start

Requirements: Rust 1.85+, Node 22+, pnpm 10+, and Docker for the appliance path.

Docker Compose on a Linux host is the primary supported installation method. It
works on a standard Linux server, mini-PC, or VM and is the reference path for
testing and upgrades. Unraid is a secondary deployment option using the same
Compose stack and is documented in [deploy/unraid/README.md](deploy/unraid/README.md).

```bash
cp .env.example .env
docker compose -f deploy/compose.yml up -d
```

In another terminal:

```bash
pnpm install
pnpm --filter @trunkscope/web dev
```

The API listens on `http://127.0.0.1:8080`; the UI listens on
`http://127.0.0.1:5173`. The built-in simulator emits trunked calls so the live
console works without radio hardware.

## RSP1B over LAN

The receiver laptop runs only SDRplay's vendor API and SoapyRemote. The main
Linux appliance owns Trunk Recorder, P25/NFM decoding, recording, transcription,
and summaries. On the laptop, install SDRplay API v3.15+ and SoapySDRPlay3, then
run `scripts/rsp1b-preflight.sh LAPTOP_LAN_IP`. On the appliance, install
SoapySDR tools and run `scripts/main-preflight.sh LAPTOP_LAN_IP` before enabling
the decoder profile. Copy `deploy/decoder/config.example.json` to
`deploy/decoder/config.json` and replace the example control channel/system.

SoapyRemote has no authentication or encryption; keep port 55132 on a trusted
LAN or VPN and never expose it directly to the internet.

## Safety defaults

- Transmission is not implemented.
- Public feeds are disabled until an administrator explicitly enables a policy.
- Encrypted calls retain metadata only and never expose audio.
- Audio defaults to 30-day retention; metadata defaults to 365 days.

See [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md).
If Docker Desktop cannot start its Linux engine, see
[docs/docker-troubleshooting.md](docs/docker-troubleshooting.md).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
