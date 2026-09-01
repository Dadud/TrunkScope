#!/usr/bin/env python3
"""Generate deploy/decoder/config.json from the checked-in example."""
import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("receiver_ip")
    parser.add_argument("control_channels", nargs="+", type=int)
    parser.add_argument("--system", default="local-p25")
    parser.add_argument("--port", type=int, default=55132)
    parser.add_argument("--device", help="full SDR device string for a locally attached SDR")
    parser.add_argument("--output", type=Path, default=Path("deploy/decoder/config.json"))
    args = parser.parse_args()

    example = Path("deploy/decoder/config.example.json")
    config = json.loads(example.read_text(encoding="utf-8"))
    source = config["sources"][0]
    source["device"] = args.device or (
        "soapy=0,driver=remote,remote=tcp://"
        f"{args.receiver_ip}:{args.port},remote:driver=sdrplay,remote:format=CS16"
    )
    source["center"] = args.control_channels[0]
    system = config["systems"][0]
    system["shortName"] = args.system
    system["control_channels"] = args.control_channels
    args.output.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
