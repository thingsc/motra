"""Raw serial sniffer: dump the real wire framing so we can see why frames
won't assemble. No GUI, no decode -- just marker statistics.

Usage:
    python tools/sniff.py [PORT] [BAUD] [NBYTES]
    python tools/sniff.py COM8 5625000 60000
"""
import collections
import sys

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM8"
BAUD = int(sys.argv[2]) if len(sys.argv) > 2 else 5_625_000
NBYTES = int(sys.argv[3]) if len(sys.argv) > 3 else 60_000


def all_offsets(b: bytes, marker: bytes) -> list[int]:
    out, i = [], b.find(marker)
    while i >= 0:
        out.append(i)
        i = b.find(marker, i + 1)
    return out


def gap_hist(offsets: list[int], label: str) -> None:
    if len(offsets) < 2:
        print(f"  {label}: <2 occurrences, no gaps")
        return
    gaps = [offsets[i + 1] - offsets[i] for i in range(len(offsets) - 1)]
    c = collections.Counter(gaps)
    print(f"  {label} gap histogram (top 6): {c.most_common(6)}")


def main() -> None:
    print(f"opening {PORT} @ {BAUD} ...")
    ser = serial.Serial(PORT, BAUD, timeout=2)
    buf = bytearray()
    while len(buf) < NBYTES:
        chunk = ser.read(8192)
        if not chunk:
            print("  read timeout (no more data)")
            break
        buf += chunk
    ser.close()
    print(f"captured {len(buf)} bytes")
    print(f"first 16 bytes (hex): {buf[:16].hex(' ')}")

    ee = all_offsets(bytes(buf), b"\x45\x45")  # 'EE' = 0x4545, expected START
    ss = all_offsets(bytes(buf), b"\x53\x53")  # 'SS' = 0x5353, expected END
    print(f"\n0x4545 ('EE') count = {len(ee)}  first offsets: {ee[:8]}")
    gap_hist(ee, "EE->EE")
    print(f"0x5353 ('SS') count = {len(ss)}  first offsets: {ss[:8]}")
    gap_hist(ss, "SS->SS")

    # For the first EE, where is the next SS? That distance = payload+2 if order is EE..SS.
    if ee and ss:
        first_ee = ee[0]
        nxt_ss = next((o for o in ss if o > first_ee), None)
        if nxt_ss is not None:
            payload = nxt_ss - first_ee - 2
            print(
                f"\nfirst EE@{first_ee} -> next SS@{nxt_ss}: "
                f"payload={payload} bytes => {payload/2:.1f} uint16 "
                f"=> {payload/4:.1f} pairs(2ch)"
            )
    print(
        "\nExpected for the stock model: EE->EE gap == 2404, "
        "payload 2400 bytes == 600 pairs(2ch)."
    )


if __name__ == "__main__":
    main()
