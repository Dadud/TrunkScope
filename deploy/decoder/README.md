# Central decoder configuration

Generate `config.json` from the example after you know the receiver address and
control channels:

```bash
python3 scripts/configure-decoder.py RECEIVER_LAN_IP 851012500 851512500 \
  --system "my-p25-site"
```

The first channel is used as the source center frequency; the full list is
written to the P25 system. You can also copy `config.example.json` manually and
replace those same fields. Populate `talkgroups.csv` when a directory export is
available; unknown groups are recorded during initial discovery.
Populate `talkgroups.csv` when a directory export is available; unknown groups
are recorded during initial discovery.

Before starting the profile, validate the IQ link from the main host:

```bash
./scripts/main-preflight.sh RECEIVER_LAN_IP
```

Then run the Docker-native receiver throughput check:

```bash
./scripts/hardware-smoke-test.sh RECEIVER_LAN_IP 851012500
```

It must report `selfTestResult` with `healthy:true` and zero overruns before
starting Trunk Recorder.

The first test should use one known control channel and a conservative recorder
count. Increase `digitalRecorders` only after sustained clean receiver metrics.

Run the central decoder profile with all DSP on the main appliance:

```bash
TRUNKSCOPE_RADIO_MODE=decoder docker compose -f deploy/compose.yml --profile decoder up -d --build
```

For local transcription and summaries, first pull the Ollama model, then launch
both profiles with `TRUNKSCOPE_AI_ENABLED=true`:

```bash
docker compose -f deploy/compose.yml --profile ai run --rm ollama pull llama3.2:3b
TRUNKSCOPE_AI_ENABLED=true TRUNKSCOPE_RADIO_MODE=decoder \
  docker compose -f deploy/compose.yml --profile decoder --profile ai up -d --build
```

The receiver laptop only supplies IQ through SoapyRemote. Trunk Recorder sends
live call lifecycle events to the TrunkScope control plane and writes completed
WAV/JSON artifacts into the shared call volume. Encrypted calls are retained as
metadata only by TrunkScope and are never attached to playable audio.
For a real P25 deployment, render `config.json` from appliance settings instead of
using the example file:

```sh
TRUNKSCOPE_P25_SYSTEM_NAME="Wood County P25" \
TRUNKSCOPE_P25_CONTROL_CHANNELS="851012500,852012500" \
TRUNKSCOPE_RADIO_DEVICE="soapy=0" \
TRUNKSCOPE_RADIO_FREQUENCY_HZ="851012500" \
scripts/render-decoder-config.sh deploy/decoder/config.json
```

The generated file is intentionally ignored by source control and can contain
site-specific receiver addresses. Keep `talkgroups.csv` beside it and enable the
Compose `decoder` profile only after validating the generated configuration.
