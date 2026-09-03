# DMR ingest via external decoder

TrunkScope's single-container appliance decodes **P25** and **conventional FM** natively. **DMR is not decoded inside the container.**

## Supported path: external upload

1. Run SDRTrunk, rdio-scanner, or another decoder on a separate host.
2. In TrunkScope, open **Appliance → AI & Integrations**.
3. Enable **Rdio-scanner compatible ingest** (`compatIngestEnabled`).
4. Configure the external tool to POST finished calls to:

```
POST https://YOUR_APPLIANCE:18088/api/call-upload
```

TrunkScope applies the same transcription, summary, geocoding, and Discord routing as locally decoded calls.

## What you get

- Call metadata and audio in the main feed
- AI pipeline (external Speaches/Ollama or cloud providers)
- Map pins and archive playback when location metadata is present

## What you do not get

- Native DMR trunking inside Trunk Recorder
- USB SDR DMR decode on the appliance itself

## Recommended external tools

| Tool | Role |
|------|------|
| **SDRTrunk** | DMR/P25 decode on a Windows or Linux host |
| **rdio-scanner** | Multi-protocol ingest hub with upload plugins |

Point the upload URL at your TrunkScope appliance LAN address. Do not expose `/api/call-upload` to the public internet without authentication.

## Security

- Keep `TRUNKSCOPE_LOCAL_ONLY=true` only on trusted LANs.
- When authentication is enabled, configure the upload tool with valid credentials or restrict by network ACL.
