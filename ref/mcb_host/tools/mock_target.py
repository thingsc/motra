"""Mock F28069M target for offline testing (no hardware).

Emits synthetic telemetry frames (EE + 600x[Ia,Ib] uint16 LE + SS) and prints any
command bytes it receives, decoding them as [speed_rpm, motor_on].

Two modes:
  --selftest          : feed generated frames straight through FrameAssembler (pure, no port)
  --port COMx         : stream frames out of a serial port (e.g. one end of a com0com pair)

Example with a com0com virtual pair COM20<->COM21:
  python tools/mock_target.py --port COM20
  python __main__.py --port COM21 --baud 115200
"""
from __future__ import annotations

import argparse
import math
import struct
import sys
import time

import numpy as np

sys.path.insert(0, ".")
from config import FRAME, RX_CHANNELS, TX_FIELDS  # noqa: E402
from protocol import FrameAssembler, build_frame  # noqa: E402


def synth_block(t: float, n: int = None) -> np.ndarray:
    """A plausible (n_pairs, 2) uint16 block: two phase currents ~120deg apart,
    biased into the unsigned ADC range so it survives a uint16 view."""
    n = n or FRAME.nominal_pairs
    k = np.arange(n)
    base = 2048
    amp = 1500
    ph = t * 5.0
    ia = base + amp * np.sin(2 * math.pi * k / n + ph)
    ib = base + amp * np.sin(2 * math.pi * k / n + ph - 2 * math.pi / 3)
    return np.stack([ia, ib], axis=1).astype(np.uint16)


def selftest() -> int:
    fa = FrameAssembler(RX_CHANNELS, FRAME)
    block = synth_block(0.0)
    frames = fa.feed(build_frame(block, FRAME))
    assert len(frames) == 1, frames
    assert frames[0].shape == (FRAME.nominal_pairs, len(RX_CHANNELS))
    print(f"selftest OK: decoded 1 frame {frames[0].shape}, "
          f"ch means = {frames[0].mean(axis=0).round(1)}")
    return 0


def stream(port: str, baud: int, fps: float) -> int:
    import serial  # local import so --selftest needs no pyserial

    ser = serial.Serial(port, baud, timeout=0.0)
    print(f"mock target streaming on {port} @ {baud} ({fps} frame/s). Ctrl-C to stop.")
    period = 1.0 / fps
    t0 = time.time()
    try:
        while True:
            t = time.time() - t0
            ser.write(build_frame(synth_block(t), FRAME))
            # echo any received command
            waiting = ser.in_waiting
            if waiting:
                cmd = ser.read(waiting)
                width = sum(struct.calcsize(f.fmt) for f in TX_FIELDS)
                if len(cmd) >= width:
                    speed, motor = struct.unpack("<hh", cmd[-width:])
                    print(f"  <- cmd speed={speed} rpm motor={'ON' if motor else 'off'}")
            time.sleep(period)
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        ser.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--port")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--fps", type=float, default=30.0)
    args = ap.parse_args()
    if args.selftest or not args.port:
        return selftest()
    return stream(args.port, args.baud, args.fps)


if __name__ == "__main__":
    raise SystemExit(main())
