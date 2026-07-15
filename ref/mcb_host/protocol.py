"""Pure, hardware-free codec for the mcb_open_loop_control serial protocol.

This module has no I/O and no Qt dependency so it can be unit-tested directly.

Wire format (reverse-engineered from the .slx, see the plan / README):
  TX (PC -> target): 2x int16 little-endian, no framing: [speed_rpm, motor_on].
  RX (target -> PC): FRAME.start + nominal_pairs*[ch1, ch2, ...] uint16 LE + FRAME.end
"""
from __future__ import annotations

import struct
from typing import Iterable

import numpy as np

from config import FrameCfg, RxChannel, TxField


# --- TX ---------------------------------------------------------------------
def encode_command(values: Iterable[float], tx_fields: list[TxField]) -> bytes:
    """Pack command values into the outgoing byte string.

    Reproduces the host's single -> int16 -> uint16(SI) chain: the rounded value is
    masked to the field width (so negatives / overflow wrap exactly like the model)
    and packed as the field's unsigned little-endian type.

    >>> from config import TX_FIELDS
    >>> encode_command([3000, 0], TX_FIELDS)
    b'\\xb8\\x0b\\x00\\x00'
    >>> encode_command([-100, 1], TX_FIELDS)   # -100 -> uint16 0xFF9C
    b'\\x9c\\xff\\x01\\x00'
    """
    vals = list(values)
    if len(vals) != len(tx_fields):
        raise ValueError(f"expected {len(tx_fields)} values, got {len(vals)}")
    out = bytearray()
    for v, f in zip(vals, tx_fields):
        mask = (1 << (8 * struct.calcsize(f.fmt))) - 1
        out += struct.pack(f.fmt, int(round(v)) & mask)
    return bytes(out)


# --- RX ---------------------------------------------------------------------
def decode_payload(payload: bytes, channels: list[RxChannel]) -> np.ndarray:
    """Decode one frame payload into an (n_samples, n_channels) float array of
    engineering values. ``payload`` length must be a multiple of 2*n_channels."""
    nch = len(channels)
    raw = np.frombuffer(payload, dtype="<u2").reshape(-1, nch)
    out = np.empty(raw.shape, dtype=np.float64)
    for c, ch in enumerate(channels):
        col = raw[:, c]
        if ch.signed:
            col = col.astype(np.int16)
        out[:, c] = col.astype(np.float64) * ch.scale + ch.offset
    return out


class FrameAssembler:
    """Stateful byte-stream -> frame decoder that locks on FRAME.start/end and
    resyncs on garbage. Feed it whatever bytes arrive; it returns completed
    frames as engineering-value arrays.
    """

    def __init__(self, channels: list[RxChannel], frame: FrameCfg) -> None:
        self.channels = channels
        self.frame = frame
        self.nch = len(channels)
        self._buf = bytearray()
        self.dropped = 0  # count of discarded/garbled frames (diagnostics)

    def _payload_ok(self, payload: bytes) -> bool:
        stride = 2 * self.nch
        if len(payload) == 0 or len(payload) % stride != 0:
            return False
        pairs = len(payload) // stride
        f = self.frame
        return abs(pairs - f.nominal_pairs) <= f.pair_tolerance

    def feed(self, chunk: bytes) -> list[np.ndarray]:
        """Append bytes and return any frames completed by this chunk."""
        frames: list[np.ndarray] = []
        if chunk:
            self._buf += chunk

        start, end = self.frame.start, self.frame.end
        while True:
            s = self._buf.find(start)
            if s < 0:
                # No start marker yet; keep only a possible partial marker tail.
                if len(self._buf) > len(start):
                    del self._buf[: -len(start)]
                break

            # Drop anything before the start marker.
            if s > 0:
                del self._buf[:s]
                s = 0

            e = self._buf.find(end, len(start))
            if e < 0:
                break  # incomplete frame, wait for more bytes

            payload = bytes(self._buf[len(start):e])
            if self._payload_ok(payload):
                frames.append(decode_payload(payload, self.channels))
                del self._buf[: e + len(end)]  # consume through end marker
            else:
                # Bad frame (e.g. a data word equalled a marker). Skip this start
                # marker and resync from the next candidate.
                self.dropped += 1
                del self._buf[: len(start)]

            if len(self._buf) > self.frame.max_buffer:
                # Runaway with no valid frame: keep the tail, drop the rest.
                del self._buf[: -2 * self.frame.nominal_pairs * self.nch]
        return frames


def build_frame(samples: np.ndarray, frame: FrameCfg) -> bytes:
    """Inverse of the assembler, for tests / mock target. ``samples`` is an
    (n_pairs, n_channels) array of raw uint16 stored-integer values."""
    body = np.asarray(samples, dtype="<u2").tobytes()
    return frame.start + body + frame.end
