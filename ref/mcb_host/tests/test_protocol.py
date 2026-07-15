"""Hardware-free tests for the serial codec."""
import numpy as np
import pytest

from config import FrameCfg, RxChannel, TX_FIELDS
from protocol import (
    FrameAssembler,
    build_frame,
    decode_payload,
    encode_command,
)

FRAME = FrameCfg()
CH2 = [RxChannel("Ia"), RxChannel("Ib")]


# --- TX ---------------------------------------------------------------------
def test_encode_default_command():
    # 3000 -> 0x0BB8 LE = b8 0b ; motor 0 -> 00 00
    assert encode_command([3000, 0], TX_FIELDS) == b"\xb8\x0b\x00\x00"


def test_encode_motor_on():
    assert encode_command([1500, 1], TX_FIELDS) == b"\xdc\x05\x01\x00"


def test_encode_negative_speed_twos_complement():
    # -100 as int16 LE = 0x FF9C -> bytes 9c ff
    assert encode_command([-100, 0], TX_FIELDS) == b"\x9c\xff\x00\x00"


def test_encode_rounds():
    assert encode_command([2999.6, 0], TX_FIELDS) == b"\xb8\x0b\x00\x00"


def test_encode_wrong_arity():
    with pytest.raises(ValueError):
        encode_command([1], TX_FIELDS)


# --- decode -----------------------------------------------------------------
def test_decode_unsigned_counts():
    payload = np.array([[10, 20], [30, 40]], dtype="<u2").tobytes()
    out = decode_payload(payload, CH2)
    assert out.shape == (2, 2)
    np.testing.assert_array_equal(out, [[10, 20], [30, 40]])


def test_decode_signed_channel():
    ch = [RxChannel("Ia"), RxChannel("Speed", signed=True)]
    # 0xFFFF as int16 = -1
    payload = np.array([[5, 0xFFFF]], dtype="<u2").tobytes()
    out = decode_payload(payload, ch)
    assert out[0, 0] == 5
    assert out[0, 1] == -1


def test_decode_scale_offset():
    ch = [RxChannel("a", scale=2.0, offset=1.0), RxChannel("b")]
    payload = np.array([[3, 7]], dtype="<u2").tobytes()
    out = decode_payload(payload, ch)
    assert out[0, 0] == 7.0  # 3*2+1
    assert out[0, 1] == 7.0


# --- FrameAssembler ---------------------------------------------------------
def _sample_block(n=FRAME.nominal_pairs):
    rng = np.random.default_rng(0)
    return rng.integers(0, 4096, size=(n, 2), dtype=np.uint16)


def test_assembler_single_frame_roundtrip():
    block = _sample_block()
    fa = FrameAssembler(CH2, FRAME)
    frames = fa.feed(build_frame(block, FRAME))
    assert len(frames) == 1
    np.testing.assert_array_equal(frames[0].astype(np.uint16), block)


def test_assembler_leading_garbage():
    block = _sample_block()
    fa = FrameAssembler(CH2, FRAME)
    frames = fa.feed(b"\x00\x01\x02garbage" + build_frame(block, FRAME))
    assert len(frames) == 1
    np.testing.assert_array_equal(frames[0].astype(np.uint16), block)


def test_assembler_split_chunks():
    wire = build_frame(_sample_block(), FRAME)
    fa = FrameAssembler(CH2, FRAME)
    out = []
    # feed one byte at a time
    for b in wire:
        out += fa.feed(bytes([b]))
    assert len(out) == 1


def test_assembler_back_to_back():
    b1, b2 = _sample_block(), _sample_block()
    wire = build_frame(b1, FRAME) + build_frame(b2, FRAME)
    fa = FrameAssembler(CH2, FRAME)
    frames = fa.feed(wire)
    assert len(frames) == 2


def test_assembler_rejects_wrong_length():
    # A short block (not within tolerance) must be dropped, not yielded.
    short = _sample_block(n=10)
    fa = FrameAssembler(CH2, FRAME)
    frames = fa.feed(build_frame(short, FRAME) + build_frame(_sample_block(), FRAME))
    # only the valid full frame comes through
    assert len(frames) == 1
    assert fa.dropped >= 1


def test_assembler_false_marker_in_payload():
    # Force a data word equal to the end marker (0x5353) inside the payload.
    block = _sample_block()
    block[5, 0] = 0x5353
    fa = FrameAssembler(CH2, FRAME)
    # The premature 'end' makes the first attempt too short -> dropped & resync.
    # Append a clean following frame so the stream can recover.
    frames = fa.feed(build_frame(block, FRAME) + build_frame(_sample_block(), FRAME))
    # At least the trailing clean frame must be recovered.
    assert len(frames) >= 1
