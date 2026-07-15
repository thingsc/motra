"""Entry point: python __main__.py [--port COMx] [--baud N]  (or run.bat)"""
from __future__ import annotations

import argparse

from config import DISPLAY_SAMPLES, SAMPLE_TIME_S, SERIAL, SerialCfg


def main() -> int:
    ap = argparse.ArgumentParser(description="Python host for mcb_open_loop_control")
    ap.add_argument("--port", default=SERIAL.port, help="serial port (default %(default)s)")
    ap.add_argument("--baud", type=int, default=SERIAL.baud,
                    help="baud rate (default %(default)s)")
    ap.add_argument("--ts", type=float, default=SAMPLE_TIME_S,
                    help="sample period Ts in seconds (default %(default)s)")
    ap.add_argument("--nsamples", type=int, default=DISPLAY_SAMPLES,
                    help="samples per screen N (default %(default)s)")
    args = ap.parse_args()

    from gui import run  # import here so --help works without Qt
    return run(SerialCfg(port=args.port, baud=args.baud), ts=args.ts, n=args.nsamples)


if __name__ == "__main__":
    raise SystemExit(main())
