# Central decoder configuration

Copy `config.example.json` to `config.json`, then replace the receiver-node LAN
address, source center frequency, P25 control channels, and system short name.
Populate `talkgroups.csv` when a directory export is available; unknown groups
are recorded during initial discovery.

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
