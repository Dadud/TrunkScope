# TrunkScope on Unraid (secondary deployment)

Docker Compose on a standard Linux host is the primary TrunkScope installation
method. Use this Unraid guide when you want Unraid to own the appliance and its
storage; it follows the same images, environment variables, and upgrade path.

Unraid is the main appliance: it runs the web UI, control plane, PostgreSQL,
Trunk Recorder, and optional AI services. The RSP1B remains attached to a Linux
laptop and forwards IQ to Unraid over the LAN with SoapyRemote. No decoding or
audio processing happens on the laptop.

The same stack also supports an SDR physically attached to Unraid. The Compose
file passes `/dev/bus/usb` into the radio and decoder containers. RTL-SDR and
other open drivers work directly. For an RSP1B, place the licensed SDRplay API
runtime and SoapySDRPlay3 module under the path in
`TRUNKSCOPE_SDRPLAY_RUNTIME` (the tested layout is
`/mnt/user/appdata/trunkscope/sdrplay`) and start the API service profile:

```bash
docker compose --env-file .env -f deploy/compose.yml --profile radio up -d sdrplay-service
docker compose --env-file .env -f deploy/compose.yml --profile radio-tools run --rm radiod-tools --list-devices
```

Set `TRUNKSCOPE_RADIO_MODE=radiod` for the local radiod path, or use `decoder`
with a local `osmosdr` source generated with `--device 'soapy=0,driver=rtlsdr'`.

## Install with Compose Manager

Install Unraid's **Compose Manager** plugin, clone this repository into an
Unraid share (for example `/mnt/user/appdata/trunkscope/repo`), and run from the
repository root:

```bash
cp deploy/unraid/.env.example .env
# If the default port is already in use (for example by SABnzbd), change it:
# sed -i 's/^TRUNKSCOPE_HTTP_PORT=.*/TRUNKSCOPE_HTTP_PORT=18088/' .env
mkdir -p /mnt/user/appdata/trunkscope/{postgres,minio,audio,calls,huggingface,ollama}
docker compose --env-file .env -f deploy/compose.yml config --quiet
docker compose --env-file .env -f deploy/compose.yml up -d --build
```

Open `http://UNRAID_LAN_IP:${TRUNKSCOPE_HTTP_PORT}` (8088 by default). The simulator should show live calls
before any radio is connected.

## Enable the RSP1B and P25 decoder

1. On the receiver laptop, install SDRplay API v3.15+ and SoapySDRPlay3, then
   run `scripts/rsp1b-preflight.sh LAPTOP_LAN_IP`.
2. On Unraid, install SoapySDR tools in a small utility container or use the
   included Docker smoke test: `./scripts/hardware-smoke-test.sh LAPTOP_LAN_IP`.
3. Generate the decoder configuration:

   ```bash
   python3 scripts/configure-decoder.py LAPTOP_LAN_IP CONTROL_CHANNEL_HZ \
     --system "your-site"
   ```

4. Set `TRUNKSCOPE_RADIO_MODE=decoder` in `.env`, then start the decoder profile:

   ```bash
   docker compose -f deploy/compose.yml --profile decoder up -d --build
   ```

Keep TCP port 55132 restricted to the trusted LAN/VPN. SoapyRemote has no
authentication or encryption. For Unraid backup, include the `trunkscope`
appdata directory; it contains recordings and AI model caches.
