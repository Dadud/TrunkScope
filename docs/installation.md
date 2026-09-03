# Installation

TrunkScope ships as a **single Docker container** that includes:

- Control plane (Rust API)
- Web operator console
- Trunk Recorder (P25 + conventional FM decode)

One published port and one appdata volume are all that is required.

## Requirements

| Item | Detail |
|------|--------|
| Host OS | Linux with Docker (Unraid, Debian, Ubuntu, etc.) |
| RAM | 2 GB minimum; 4 GB+ recommended with AI on the same host |
| Storage | SSD appdata share; size depends on retention (WAVs dominate) |
| SDR | RTL-SDR, Airspy, or SDRplay RSP1B via USB passthrough |
| SDRplay only | Licensed API runtime mounted at `/opt/sdrplay` inside the container |

## Quick start (Docker Compose)

From the repository root:

```bash
docker compose -f deploy/appliance.yml up -d --build
```

Default URL: `http://127.0.0.1:18088`

### docker run (published image)

```bash
docker run --name trunkscope --restart unless-stopped \
  -p 18088:8080 \
  --device /dev/bus/usb \
  --shm-size 256m --ipc host \
  -v trunkscope-data:/var/lib/trunkscope \
  ghcr.io/dadud/trunkscope:latest
```

## Appdata layout

Mount one host directory to `/var/lib/trunkscope`:

| Path | Purpose |
|------|---------|
| `trunkscope.db` | SQLite call history (survives restart) |
| `calls/` | Trunk Recorder WAV output and sidecars |
| `audio/settings.json` | Operator settings |
| `audio/systems.json` | P25 / FM system profiles |
| `audio/talkgroups.json` | Talkgroup catalog |
| `audio/scan-lists.json` | Conventional scan lists |
| `audio/decoder/config.json` | Generated Trunk Recorder config |
| `calls-export.json` | Periodic JSON backup (recovery aid) |

Back up the entire appdata folder. No Postgres or MinIO volume is required.

## Environment variables

First-run defaults only — persisted settings in the web UI win after save. See [configuration.md](configuration.md) for the full list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRUNKSCOPE_RADIO_MODE` | `decoder` | `decoder` (Trunk Recorder), `radiod`, or `simulator` |
| `TRUNKSCOPE_RADIO_DEVICE` | `soapy=0,driver=rtlsdr` | Soapy device string |
| `TRUNKSCOPE_SITE_FILTER` | empty | Substring filter for P25 sites (e.g. `black river falls`) |
| `TRUNKSCOPE_LOCAL_ONLY` | `false` | Skip login on trusted LAN (**never expose publicly**) |
| `TRUNKSCOPE_AI_ENABLED` | `false` | Enable transcription/summary workers |
| `TRUNKSCOPE_HTTP_PORT` | `18088` | Host port (Compose file only) |

Copy [`deploy/appliance.env.example`](../deploy/appliance.env.example) as a starting point.

## SDR device strings

| Hardware | `TRUNKSCOPE_RADIO_DEVICE` |
|----------|---------------------------|
| RTL-SDR | `soapy=0,driver=rtlsdr` |
| Airspy | `soapy=0,driver=airspy` |
| SDRplay RSP1B | `soapy=0,driver=sdrplay` + `/opt/sdrplay` mount |

### SDRplay on Unraid

1. Install SDRplay API on the host and copy runtime files to e.g. `/mnt/user/appdata/trunkscope/sdrplay`.
2. Set template variable `TRUNKSCOPE_SDRPLAY_RUNTIME` to that path.
3. Pass USB to the container.
4. Set `TRUNKSCOPE_RADIO_DEVICE=soapy=0,driver=sdrplay`.

## Unraid

Import [`deploy/unraid/trunkscope.xml`](../deploy/unraid/trunkscope.xml):

| Template field | Typical value |
|----------------|---------------|
| Appdata | `/mnt/user/appdata/trunkscope` → `/var/lib/trunkscope` |
| Port | `18088` → `8080` |
| USB | `/dev/bus/usb` |

Build on-box:

```bash
cd /mnt/user/appdata/trunkscope/repo
docker compose -f deploy/appliance.yml build
docker compose -f deploy/appliance.yml up -d
```

More detail: [deploy/unraid/README.md](../deploy/unraid/README.md)

## First-run wizard

On first launch (when `wizardCompleted` is false), the web UI offers:

1. AI stack preset (Local GPU, Cloud hybrid, Privacy max)
2. Transcribe / summary / geocoder URLs
3. Optional site filter

Use **LAN IPs** for AI services (`http://192.168.1.10:11434`), not `localhost`.

Finish setup in **Appliance → AI & Integrations** anytime. Provider details: [ai-providers.md](ai-providers.md).

## Authentication

- First visit: create an administrator account (`/api/v1/auth/setup`) unless `TRUNKSCOPE_LOCAL_ONLY=true`.
- Local-only mode grants admin to anyone who can reach the port — restrict to LAN/VPN only.

## Remote SDR (SoapyRemote)

Split deployment when the SDR is not on the appliance host:

```text
Laptop: SDRplay API + SoapyRemote (port 55132)
Appliance: TrunkScope decoder mode → remote Soapy endpoint
```

On the laptop:

```bash
scripts/rsp1b-preflight.sh LAPTOP_LAN_IP
```

On the appliance:

```bash
scripts/main-preflight.sh LAPTOP_LAN_IP
```

Set:

```text
TRUNKSCOPE_RADIO_DEVICE=driver=remote,remote=tcp://LAPTOP_IP:55132,remote:driver=sdrplay,remote:format=CS16
```

SoapyRemote has **no authentication**. Use a trusted LAN or VPN only.

## Verify installation

```bash
curl -s http://127.0.0.1:18088/api/v1/health/ready
curl -s http://127.0.0.1:18088/api/v1/diagnostics | jq .
```

With credentials:

```bash
TRUNKSCOPE_URL=http://127.0.0.1:18088 \
TRUNKSCOPE_CREDENTIAL_FILE=/path/to/admin.json \
python scripts/verified-hardware-acceptance.py
```

## What not to install

**Do not use** [`deploy/compose.yml`](../deploy/compose.yml) for production. That multi-service stack (Postgres, MinIO, separate web/nginx) is deferred and kept for development reference only.
