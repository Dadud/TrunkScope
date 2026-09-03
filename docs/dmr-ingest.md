# DMR ingest via external decoder

TrunkScope's single-container appliance decodes **P25** and **conventional FM** natively. **DMR is not decoded inside the container.**

See also: [installation](installation.md) · [configuration](configuration.md) · [operations](operations.md)

## Supported path: external upload

1. Run **SDRTrunk**, **rdio-scanner**, or another decoder on a separate host.
2. In TrunkScope: **Appliance → AI & Integrations** → enable **Rdio-scanner compatible ingest**.
3. Configure the external tool to POST finished calls to:

```http
POST http://YOUR_APPLIANCE:18088/api/call-upload
Content-Type: application/json
```

TrunkScope applies the same transcription, summary, geocoding, and Discord routing as locally decoded calls.

## What you get

- Call metadata and audio in the main feed and archive
- External AI pipeline (Speaches/Ollama or cloud providers)
- Map pins and playback when location metadata is present

## What you do not get

- Native DMR trunking inside Trunk Recorder
- USB SDR DMR decode on the appliance itself

## Recommended external tools

| Tool | Role |
|------|------|
| [SDRTrunk](https://github.com/DSheirer/sdrtrunk) | DMR/P25 decode on Windows or Linux |
| [rdio-scanner](https://github.com/chuot/rdio-scanner) | Multi-protocol ingest hub |

Point the upload URL at your appliance **LAN address**. Do not expose `/api/call-upload` to the public internet without authentication.

## Security

- `TRUNKSCOPE_LOCAL_ONLY=true` is for trusted LANs only.
- With normal auth enabled, restrict upload sources by network ACL or configure credentials in the upstream tool if supported.
- Compat ingest is disabled by default (`compatIngestEnabled: false`).

## Related settings

| Setting | Location |
|---------|----------|
| `compatIngestEnabled` | Appliance → AI & Integrations |
| AI providers | [ai-providers.md](ai-providers.md) |
