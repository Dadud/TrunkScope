# TrunkScope completion ledger

Evidence-based integration status. Operator documentation: [README.md](README.md).

This file is deliberately evidence-based. A green software check does not
stand in for an RF acceptance test.

| Gate | Status | Evidence |
| --- | --- | --- |
| Docker/Unraid deployment | PASS | `docker compose config --quiet`; live rebuild from the complete checkout succeeded on Unraid; `/api/v1/health/ready` returned 200 after restart |
| Software-observable hardware acceptance | PASS | `scripts/verified-hardware-acceptance.py` against `192.168.1.4:18088` passed readiness, admin session, non-simulated capture, decoder, capabilities, stream, ingestion, recording, and session checks; local RSP1B is now the persisted source |
| Conventional FM hardware activity | PASS (signal observed) | Acceptance harness observed 45 archived clear recordings across both configured frequencies (`151062500` and `154445000` Hz); tone-match/mismatch isolation remains a separate RF test |
| Real capture (not simulator) | PASS | live `/api/v1/diagnostics` reports `simulated: false` and delegated hardware capture |
| Decoder process and event ingestion | PARTIAL | local RSP1B is attached and Trunk Recorder is healthy with Black River Falls control-channel/system identification (`B0C`, NAC `B00`); a fresh call/event-ledger heartbeat still requires an active clear transmission |
| FM recording/archive/playback | PARTIAL | live Trunk Recorder logs show conventional signal detection and repeated recordings on Jackson County Law `151.062500 MHz`; generated channel CSV preserves Fire `123.0` and Law `82.5` tones; authenticated playback returned readable RIFF/WAV payloads; known-signal tone-match acceptance still required |
| FM squelch/CTCSS/DCS rejection | CODE COMPLETE | native detector/scanner tests plus strict simulated radiod self-test: 1,228 ms WAV emitted with DCS `D023N`, zero sample timeouts/overflows; physical matching/mismatched transmission evidence pending |
| P25 control-channel lock | PASS (hardware log evidence) | live Trunk Recorder log shows `Started with Control Channel: 152.112500`, retune to `152.217500`, and `Decoding System ID B0C WACN: 1 NAC: B00`; API lock-age telemetry remains unavailable because the status stream does not emit a structured lock event |
| P25 voice following | PASS (hardware log evidence) | live logs show permitted TG 111 being recorded on `151.047500`, `152.112500`, and `152.592500` after control-channel decode; authenticated WAV playback succeeds |
| Conversation dwell/merged playback | PASS | persisted sessions, ten-second finalizer, merged WAV endpoint |
| AI transcription/summarization | PASS (when providers enabled) | persisted call enrichment path, bounded parallel workers, restart-safe sidecar baseline; live Speaches/Ollama services are healthy, queue is `0`, and live archive contains a transcript plus summary |
| Operator listening feed | PASS | live feed retains the latest 20 transmissions, supports text/category filters, and exposes authenticated clear-audio playback per row |
| ASR deployment profiles | CODE COMPLETE | persisted CPU/GPU/radio profile, endpoint, model, VAD setting, and schema migration; physical model performance remains deployment-specific |
| Import preview/apply | PASS | `/api/v1/imports/{systems,talkgroups}/preview` and explicit UI apply |
| Authentication hardening | PASS (bootstrap) | first-run `/api/v1/auth/setup`, Argon2 credential persistence, protected admin/audio paths, password rotation UI; live login and `/auth/me` both returned 200 after the rebuilt image, including a whitespace-padded username |
| Audio access control | PASS | live unauthenticated audio request returned `401`; credentialed request returned `200` with WAV data |
| Control-plane regression suite | PASS | `cargo test -p trunkscope-control-plane`: 29 passed; includes provider-outage retry/error reporting and authenticated protected-route fixtures |
| Retention/backup/failure injection | PARTIAL | live decoder stop produced `running-unverified` after 20s and recovered by restart; control-plane timeout recovered and remained responsive across six 10-second probes; bounded Speaches restart harness passed; queued-call provider outage test now passes in the control-plane suite; clean Debian-container and live Unraid durable-volume restore round trips pass (live archive SHA-256 `d1c0420458eac3f220f44bab71667c83606b7dbfb7b86791fb1f6b70c04befec`); live queued-call outage report remains deployment evidence follow-up |

Run `python scripts/verified-hardware-acceptance.py` with
`TRUNKSCOPE_URL` pointed at the appliance to regenerate the software-observable
report. Do not mark the pending RF rows green without a known transmission or
decoder control-channel evidence.
