#!/usr/bin/env python3
"""Synchronize this checkout to Unraid and rebuild the reference stack.

This intentionally uploads source and deployment files before building. It
prevents a successful local build from being mistaken for a deployed build.
Credentials are supplied through environment variables, never stored here.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path


EXCLUDED_DIRS = {".git", "target", "node_modules", "dist", "__pycache__", ".codex-remote-attachments"}
EXCLUDED_FILES = {".env"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("TRUNKSCOPE_SSH_HOST"), required=False)
    parser.add_argument("--user", default=os.environ.get("TRUNKSCOPE_SSH_USER", "root"))
    parser.add_argument("--password", default=os.environ.get("TRUNKSCOPE_SSH_PASSWORD"))
    parser.add_argument("--remote-root", default=os.environ.get("TRUNKSCOPE_REMOTE_ROOT", "/mnt/user/appdata/trunkscope/app"))
    parser.add_argument("--no-build", action="store_true", help="sync only; do not rebuild or restart containers")
    args = parser.parse_args()
    if not args.host or not args.password:
        parser.error("set --host/--password or TRUNKSCOPE_SSH_HOST/TRUNKSCOPE_SSH_PASSWORD")

    try:
        import paramiko
    except ImportError as exc:
        raise SystemExit("paramiko is required (python -m pip install paramiko)") from exc

    root = Path(__file__).resolve().parents[1]
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(args.host, username=args.user, password=args.password, timeout=15)
    sftp = client.open_sftp()
    uploaded = 0

    def ensure_remote_directory(path: str) -> None:
        parts = path.rstrip("/").split("/")
        current = ""
        for part in parts:
            if not part:
                current += "/"
                continue
            current += part if current.endswith("/") else "/" + part
            try:
                sftp.mkdir(current)
            except OSError:
                pass

    try:
        for directory, subdirs, files in os.walk(root):
            relative = Path(directory).relative_to(root)
            subdirs[:] = [item for item in subdirs if item not in EXCLUDED_DIRS]
            remote_dir = args.remote_root if str(relative) == "." else f"{args.remote_root}/{relative.as_posix()}"
            ensure_remote_directory(remote_dir)
            for filename in files:
                if filename in EXCLUDED_FILES or filename.endswith(".pyc"):
                    continue
                local_path = Path(directory) / filename
                sftp.put(str(local_path), f"{remote_dir}/{filename}")
                uploaded += 1
    finally:
        sftp.close()
    print(f"synchronized {uploaded} files to {args.host}:{args.remote_root}")
    if not args.no_build:
        command = (
            f"cd {args.remote_root} && "
            "docker compose --env-file .env -f deploy/compose.yml build control-plane web && "
            "docker compose --env-file .env -f deploy/compose.yml --profile radio up -d control-plane web sdrplay-service decoder && "
            "docker compose --env-file .env -f deploy/compose.yml ps"
        )
        _, stdout, stderr = client.exec_command(command, timeout=1800)
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        # Windows PowerShell may use cp1252; Docker progress includes Unicode
        # status glyphs, so keep deployment reporting portable.
        print(output.encode("ascii", "replace").decode("ascii"))
        if error:
            print(error.encode("ascii", "replace").decode("ascii"))
        status = stdout.channel.recv_exit_status()
        if status:
            raise SystemExit(status)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
