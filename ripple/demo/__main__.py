"""`python -m ripple.demo [--out path]` prints the demo ScanResult JSON."""
from __future__ import annotations

import argparse
import sys

from . import build_demo_scan


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m ripple.demo", description="Generate the RIPPLE demo scan (offline).")
    ap.add_argument("--out", help="write JSON to this path instead of stdout")
    args = ap.parse_args()
    text = build_demo_scan().model_dump_json(indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
