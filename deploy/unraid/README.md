# TrunkScope on Unraid

Use the **single-container template** for production. The Compose Manager multi-service stack is deferred — see [docs/installation.md](../../docs/installation.md).

## Single-container template (recommended)

Import [`trunkscope.xml`](trunkscope.xml):

| Setting | Value |
|---------|-------|
| **Repository / image** | `ghcr.io/dadud/trunkscope:latest` or local build |
| **Container port** | `8080` |
| **Host port** | `18088` (or free port) |
| **Appdata** | `/mnt/user/appdata/trunkscope` → `/var/lib/trunkscope` |
| **USB** | `/dev/bus/usb` |

### Template variables

| Variable | Purpose |
|----------|---------|
| `TRUNKSCOPE_RADIO_MODE` | `decoder` (default) |
| `TRUNKSCOPE_RADIO_DEVICE` | `soapy=0,driver=sdrplay` for RSP1B |
| `TRUNKSCOPE_SDRPLAY_RUNTIME` | Host path → `/opt/sdrplay` (SDRplay only) |
| `TRUNKSCOPE_LOCAL_ONLY` | `true` = no login (LAN only) |
| `TRUNKSCOPE_AI_ENABLED` | `false` until AI URLs configured |
| `TRUNKSCOPE_TRANSCRIBE_URL` | LAN URL to Speaches/Whisper |
| `TRUNKSCOPE_SUMMARY_URL` | LAN URL to Ollama/vLLM |

Full configuration: [docs/configuration.md](../../docs/configuration.md)  
AI setup: [docs/ai-providers.md](../../docs/ai-providers.md)

### SDRplay RSP1B

1. Install SDRplay API on Unraid (or copy runtime to appdata).
2. Mount runtime at `/mnt/user/appdata/trunkscope/sdrplay` → container `/opt/sdrplay`.
3. Pass USB to container.
4. Set `TRUNKSCOPE_RADIO_DEVICE=soapy=0,driver=sdrplay`.

### Build on Unraid

```bash
git clone https://github.com/Dadud/TrunkScope.git /mnt/user/appdata/trunkscope/repo
cd /mnt/user/appdata/trunkscope/repo
docker compose -f deploy/appliance.yml build
docker compose -f deploy/appliance.yml up -d
```

### Verify

Open `http://UNRAID_IP:18088`. Run acceptance harness from a workstation:

```bash
TRUNKSCOPE_URL=http://192.168.1.x:18088 \
TRUNKSCOPE_CREDENTIAL_FILE=/path/admin.json \
python scripts/verified-hardware-acceptance.py
```

## Backup

Snapshot `/mnt/user/appdata/trunkscope` (includes `trunkscope.db`, `calls/`, `audio/`). See [docs/operations.md](../../docs/operations.md).

## Deferred: Compose Manager full stack

The multi-service `deploy/compose.yml` layout (Postgres, MinIO, separate web) remains in the repository for development only. **Do not** use it as the primary Unraid install path.

If you maintain a legacy Compose deployment, see the historical notes in git history and `deploy/unraid/.env.example` — new installs should use `deploy/appliance.yml` only.

## Remote SDR (laptop + SoapyRemote)

When the RSP1B stays on a laptop:

1. Run SoapyRemote on the laptop (`scripts/rsp1b-preflight.sh`).
2. Set appliance `TRUNKSCOPE_RADIO_DEVICE` to the remote Soapy string.
3. Keep TCP `55132` on a trusted LAN/VPN.

Details: [docs/installation.md#remote-sdr-soapyremote](../../docs/installation.md#remote-sdr-soapyremote)
