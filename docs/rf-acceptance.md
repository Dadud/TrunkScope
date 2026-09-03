# RF acceptance procedure

The software and hardware checks prove that TrunkScope can capture, decode,
record, ingest, and play back traffic. The remaining RF gate requires a known
transmission so squelch and tone filtering can be distinguished from ambient
traffic.

## Conventional FM

Use an appropriately authorized test transmitter at low power and a safe
location. Configure one scan channel at a time:

1. Transmit voice with the configured CTCSS tone (`123.0` on 154.445 MHz or
   `82.5` on 151.0625 MHz) for at least 5 seconds.
2. Confirm one new clear WAV and archive record with the expected frequency,
   tone metadata, and a duration covering the transmission.
3. Repeat with carrier/no tone and with a deliberately different tone.
4. Confirm those mismatched cases do not create a playable call or AI job.
5. Capture the UI diagnostics, archive row, and the acceptance report.

The matching case passes only when audio is playable and the mismatched cases
are suppressed. Do not mark the gate green from signal strength alone.

## P25

Use a known permitted talkgroup on the configured Black River Falls site. Save
the decoder log lines showing control-channel start/system-ID decode, voice
channel following, and the resulting WAV/archive record. Encrypted traffic must
remain metadata-only.

## Evidence command

```sh
TRUNKSCOPE_URL=http://APPLIANCE:18088 \
TRUNKSCOPE_CREDENTIAL_FILE=target/admin-bootstrap-credentials.json \
TRUNKSCOPE_EVENT_WAIT_SECONDS=30 \
python scripts/verified-hardware-acceptance.py
```

The report is software-observable evidence; the transmission details and
operator authorization must be recorded separately.
