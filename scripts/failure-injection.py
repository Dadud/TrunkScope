#!/usr/bin/env python3
"""Safe, bounded dependency-recovery smoke test for a Docker/Unraid appliance.

This intentionally restarts only the selected AI container and records what the
control plane actually reports. It never treats a restart as proof that a
queued transcription succeeded.
"""
import argparse, json, os, time
from datetime import datetime, timezone
import requests

def stamp():
    return datetime.now(timezone.utc).isoformat()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("TRUNKSCOPE_URL", "http://127.0.0.1:18088"))
    parser.add_argument("--service", choices=("speaches", "ollama"), default="speaches")
    parser.add_argument("--seconds", type=int, default=15)
    parser.add_argument("--ssh-host", default=os.environ.get("TRUNKSCOPE_SSH_HOST"))
    parser.add_argument("--ssh-user", default=os.environ.get("TRUNKSCOPE_SSH_USER", "root"))
    parser.add_argument("--ssh-password", default=os.environ.get("TRUNKSCOPE_SSH_PASSWORD"))
    parser.add_argument("--report", default="failure-injection.json")
    args = parser.parse_args()
    base = args.url.rstrip("/")
    report = {"startedAt": stamp(), "baseUrl": base, "service": args.service, "checks": []}
    def check(name, passed, detail): report["checks"].append({"name": name, "passed": bool(passed), "detail": detail})
    try:
        before = requests.get(base + "/api/v1/diagnostics", timeout=8)
        check("baseline-control-plane", before.ok, before.text[:300])
        if not (args.ssh_host and args.ssh_password):
            check("injection", False, "Set TRUNKSCOPE_SSH_HOST and TRUNKSCOPE_SSH_PASSWORD to run the bounded restart")
        else:
            import paramiko
            client = paramiko.SSHClient(); client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(args.ssh_host, username=args.ssh_user, password=args.ssh_password, timeout=10)
            container = "trunkscope-" + args.service + "-1"
            _, out, err = client.exec_command(f"docker restart {container}", timeout=20)
            output = out.read().decode(errors="replace"); error = err.read().decode(errors="replace")
            check("injection", not error.strip(), output.strip() or error.strip())
            time.sleep(max(1, min(120, args.seconds)))
            client.close()
            after = requests.get(base + "/api/v1/diagnostics", timeout=8)
            check("control-plane-after-restart", after.ok, after.text[:300])
            if after.ok:
                payload = after.json()
                check("ai-status-explicit", payload.get("ai", {}).get("state") in {"idle", "processing", "error", "disabled"}, payload.get("ai"))
                check("no-unearned-success", payload.get("ai", {}).get("state") != "error" or bool(payload.get("aiFailureReason")), payload.get("aiFailureReason"))
    except Exception as exc:
        check("harness", False, str(exc))
    report["finishedAt"] = stamp(); report["passed"] = all(item["passed"] for item in report["checks"])
    with open(args.report, "w", encoding="utf-8") as handle: json.dump(report, handle, indent=2); handle.write("\n")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1

if __name__ == "__main__": raise SystemExit(main())
