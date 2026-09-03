# vLLM + Qwen3-ASR (radio) for TrunkScope

Self-hosted transcription for TrunkScope using **vLLM** and the radio-tuned model **`chrullis/qwen3-asr-radio-1.7b`**.

TrunkScope expects an OpenAI-compatible endpoint:

```text
POST http://<LAN_IP>:8000/v1/audio/transcriptions
GET  http://<LAN_IP>:8000/v1/models
```

Use your Windows PC **LAN IP** in TrunkScope (e.g. `192.168.1.105`), not `localhost` — the Unraid appliance reaches AI over the network.

## Prerequisites (Docker Desktop on Windows)

1. **NVIDIA GPU** with a current driver (RTX 3060+ recommended for official vLLM).
2. **Docker VM backend must be WSL 2** — GPU passthrough is **not available on Docker VMM** yet ([Docker docs](https://docs.docker.com/desktop/features/gpu)). If you switched to **Docker VMM** in Settings → General → Virtual Machine Manager, switch back to **WSL 2** on this GPU host for vLLM, or run vLLM natively inside a WSL2 distro instead of Docker Desktop.
3. **Windows Firewall**: allow inbound TCP **8000** on private networks so Unraid can connect.

### Docker VMM vs WSL 2 (important)

| Backend | GPU in Linux containers | Good for |
|---------|-------------------------|----------|
| **Docker VMM** | No (as of Docker Desktop 4.89) | General containers, TrunkScope dev without GPU |
| **WSL 2** | Yes (`gpus: all`) | vLLM, Qwen3-ASR, CUDA workloads |

TrunkScope on Unraid does not care which backend you use. **This vLLM stack does** — it needs GPU access.

**If you want to keep Docker VMM as default elsewhere:** use WSL2 only on the transcription PC, or run from an Ubuntu WSL2 shell:

```bash
# Inside WSL2 (Ubuntu), from this repo path
cd /mnt/d/TrunkScope/deploy/vllm-asr
docker compose up -d
```

WSL2’s own Docker context gets GPU even when Docker Desktop’s VM manager is set to VMM — but the simplest fix is **WSL 2** as the Desktop backend on the machine that runs vLLM.

### Validate GPU before starting vLLM

```powershell
docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu24.04 nvidia-smi
```

If this fails on Docker VMM, switch the backend to WSL 2 and retry.

### WSL2 pinned-memory requirement (UVA error)

On WSL 2, recent vLLM builds gate pinned memory behind
`VLLM_WSL2_ENABLE_PIN_MEMORY=1` (see `vllm/platforms/cuda.py`). Without it the
engine crashes at startup with `RuntimeError: UVA is not available` even though
`nvidia-smi` and `torch.cuda.is_available()` both work. The compose file in this
directory already sets the variable — keep it set on any hand-run container.

## Quick start

From the repository root:

```powershell
cd deploy\vllm-asr
copy .env.example .env
docker compose down
docker compose pull
docker compose up -d
docker compose logs -f vllm-asr
```

First start downloads the model (several GB) and may take **10–20 minutes**.

## Verify

On the GPU host:

```powershell
curl http://127.0.0.1:8000/v1/models
```

From the Unraid appliance or another LAN host (replace IP):

```bash
curl http://192.168.1.105:8000/v1/models
```

You should see `chrullis/qwen3-asr-radio-1.7b` (or your configured model id).

## TrunkScope settings

In **Appliance → Integrations**:

| Field | Value |
|-------|--------|
| Transcribe URL | `http://<LAN_IP>:8000/v1/audio/transcriptions` |
| Transcribe provider | `openai-compatible` |
| Transcribe model | pick from **Discover models** (or `chrullis/qwen3-asr-radio-1.7b`) |

Click **Test transcription** after save.

## Reset / rebuild

```powershell
cd deploy\vllm-asr
docker compose down
docker compose pull
docker compose up -d --force-recreate
```

To wipe the Hugging Face cache and re-download:

```powershell
docker compose down -v
docker compose up -d
```

## Alternate model

Edit `.env`:

```env
VLLM_ASR_MODEL=Qwen/Qwen3-ASR-1.7B
```

Then `docker compose up -d --force-recreate`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `docker pull` I/O error after switching VM backend | Restart Docker Desktop; prune images (`docker system prune`); retry pull |
| `nvidia-smi` fails in test container | On Docker VMM → switch to **WSL 2** backend or run compose from WSL2 |
| Container exits immediately | Check `docker compose logs`; GPU not visible → see above |
| `curl` hangs from Unraid | Windows Firewall / wrong IP / container not healthy yet |
| HTTP 502 from TrunkScope test | Model still loading — wait for healthcheck / logs show `Uvicorn running` |
| Out of VRAM | Lower `VLLM_GPU_MEMORY_UTILIZATION` (e.g. `0.65`) or `VLLM_MAX_NUM_SEQS` |

More: [`docs/ai-providers.md`](../../docs/ai-providers.md), [`docs/troubleshooting.md`](../../docs/troubleshooting.md).
