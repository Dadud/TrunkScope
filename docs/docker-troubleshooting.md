# Docker Desktop troubleshooting

TrunkScope targets a Linux Docker engine. On Windows development hosts, Docker
Desktop must be switched to **Linux containers** and its engine must be healthy
before image builds can run.

If startup reports an Inference Manager error for
`%LOCALAPPDATA%\\Docker\\run\\dockerInference`:

1. Quit Docker Desktop completely (including the tray process).
2. Restart Windows, then launch Docker Desktop and wait for “Engine running”.
3. Confirm the Linux engine from PowerShell:

   ```powershell
   docker info --format '{{.ServerVersion}} {{.OSType}}'
   ```

   The second value must be `linux`.

4. Validate and build TrunkScope:

   ```bash
   docker compose -f deploy/compose.yml config --quiet
   docker compose -f deploy/compose.yml build
   ```

Do not expose the SoapyRemote port (`55132`) outside the trusted LAN or VPN.
