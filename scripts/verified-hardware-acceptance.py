#!/usr/bin/env python3
"""Run the software-observable portion of TrunkScope's hardware gate.

This intentionally does not claim RF reception: FM tone and P25 voice gates
still require a known transmission. The report records exactly what the main
appliance observed so an operator can attach transmission evidence later.
"""
import json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path
import requests

base = os.environ.get("TRUNKSCOPE_URL", "http://127.0.0.1:18088").rstrip("/")
report_path = Path(os.environ.get("TRUNKSCOPE_ACCEPTANCE_REPORT", "hardware-acceptance.json"))
report = {"startedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": base, "checks": []}
client = requests.Session()
credential_file = os.environ.get("TRUNKSCOPE_CREDENTIAL_FILE")
if credential_file and Path(credential_file).is_file():
    credentials = json.loads(Path(credential_file).read_text(encoding="utf-8"))
    login = client.post(base + "/api/v1/auth/login", json=credentials, timeout=15)
    check_login = login.ok
else:
    username = os.environ.get("TRUNKSCOPE_ADMIN_USERNAME")
    password = os.environ.get("TRUNKSCOPE_ADMIN_PASSWORD")
    check_login = True
    if username and password:
        check_login = client.post(base + "/api/v1/auth/login", json={"username": username, "password": password}, timeout=15).ok

def check(name, passed, detail):
    report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})

def get(path):
    response = client.get(base + path, timeout=15)
    response.raise_for_status()
    return response.json()

def get_status(path):
    response = client.get(base + path, timeout=15)
    response.raise_for_status()
    return response

try:
    ready = get_status("/api/v1/health/ready")
    check("control-plane-ready", ready.status_code == 200, ready.text or "HTTP 200")
    check("administrator-session", check_login, "credentialed session available for protected checks")
    diagnostics = get("/api/v1/diagnostics")
    check("non-simulated-capture", not diagnostics.get("simulated", True), diagnostics.get("capture"))
    check("decoder-connected", diagnostics.get("decoder", {}).get("state") == "connected", diagnostics.get("decoder"))
    check("recording-asset", diagnostics.get("recording", {}).get("state") == "ready", diagnostics.get("lastAudioFile"))
    snapshot = get("/api/v1/snapshot")
    fm_calls = [call for call in snapshot.get("calls", []) if call.get("frequencyHz") in {154445000, 151062500} and call.get("audio") and call["audio"].get("durationMs", 0) > 0]
    check("conventional-fm-recording-observed", bool(fm_calls), {"count": len(fm_calls), "frequenciesHz": sorted({call.get("frequencyHz") for call in fm_calls})})
    receivers = get("/api/v1/receivers")
    check("receiver-inventory", bool(receivers), f"{len(receivers)} receiver(s)")
    if receivers:
        receiver = receivers[0]
        caps = get(f"/api/v1/receivers/{receiver['id']}/capabilities")
        check("capabilities-present", bool(caps.get("sampleRatesHz")) and bool(caps.get("gainElements")), caps)
        verify = client.post(base + f"/api/v1/receivers/{receiver['id']}/verify", timeout=20)
        verification = verify.json() if verify.ok else {"error": verify.text}
        required_checks = [item for item in verification.get("checks", []) if item.get("name") not in {"event-ingestion", "recording-file"}]
        # Preserve the service's aggregate result. The event check is reported
        # separately below, but a failed aggregate must never be presented as
        # a passing receiver verification.
        aggregate_passed = bool(verification.get("passed"))
        check("receiver-verification", verify.ok and aggregate_passed and all(item.get("passed") for item in required_checks), verification)
        event_check = next((item for item in verification.get("checks", []) if item.get("name") == "event-ingestion"), None)
        # Traffic is intermittent. Poll diagnostics for a bounded period so a
        # quiet control/voice channel is not mistaken for a dead decoder.
        wait_seconds = max(0, min(120, int(os.environ.get("TRUNKSCOPE_EVENT_WAIT_SECONDS", "30"))))
        deadline = time.monotonic() + wait_seconds
        while event_check and not event_check.get("passed") and time.monotonic() < deadline:
            time.sleep(3)
            latest = get("/api/v1/diagnostics")
            if latest.get("lastEvent"):
                event_check = {"name": "event-ingestion", "passed": True, "detail": latest["lastEvent"]}
                break
        check("live-event-observed", bool(event_check and event_check.get("passed")), event_check or "No event evidence in the observation window")
    sessions = get("/api/v1/operations/sessions")
    check("conversation-ledger", bool(sessions), f"{len(sessions)} session(s)")
except Exception as exc:
    check("harness", False, str(exc))

report["finishedAt"] = datetime.now(timezone.utc).isoformat()
report["passed"] = all(item["passed"] for item in report["checks"])
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
sys.exit(0 if report["passed"] else 1)
