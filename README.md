# TrunkScope

TrunkScope is a clean-sheet, receive-only SDR scanner appliance. The first release targets
P25 Phase 1/2 and conventional NFM on Linux with RTL-SDR, Airspy, and SDRplay receivers.

## Quick start (recommended)

The **single-container appliance** is the only supported operator install path. See [docs/appliance-install.md](docs/appliance-install.md).

```bash
docker compose -f deploy/appliance.yml up -d --build
```

Open `http://127.0.0.1:18088`. On Unraid, import
[`deploy/unraid/trunkscope.xml`](deploy/unraid/trunkscope.xml).

External AI (Speaches, Ollama, vLLM, or cloud APIs) is configured in the web UI or via env vars — it is never bundled in the image.

### Docker Compose multi-service stack (deferred)

The full Compose stack (Postgres, MinIO, multi-service) in `deploy/compose.yml` is **deferred** — kept for development reference only, not documented as an install path.

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
Operational health, lifecycle, scan-list, audio, privacy, and backup procedures are in
[docs/operations.md](docs/operations.md).
If Docker Desktop cannot start its Linux engine, see
[docs/docker-troubleshooting.md](docs/docker-troubleshooting.md).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
