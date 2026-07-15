"""Configuration for the Python host of mcb_open_loop_control.

Everything that is wire-protocol or display specific lives here so the rest of the
code stays generic. To repurpose telemetry channel-2 from "Ib" to commanded speed
(the target-firmware mod discussed separately), you only edit ``RX_CHANNELS[1]`` --
no other code changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SerialCfg:
    """pyserial port settings. Mirrors the host `Host Serial Setup` block."""
    port: str = "COM3"          # FT232 telemetry port (XDS100 VCP is COM9/COM10)
    baud: int = 1_500_000       # actual on-wire baud. The .slx SCI_A UserBaudRate is
                                # 1562500 (nominal), but the achieved/FT232-matchable
                                # rate is 1500000; SS/EE frames only lock at 1500000.
    bytesize: int = 8
    parity: str = "N"
    stopbits: int = 1
    timeout: float = 0.05       # read timeout (s)


@dataclass(frozen=True)
class RxChannel:
    """One received telemetry column.

    Raw wire value is uint16. ``signed`` reinterprets it as int16 first, then the
    engineering value is ``raw * scale + offset``.
    """
    name: str
    signed: bool = False
    scale: float = 1.0
    offset: float = 0.0
    unit: str = "counts"


@dataclass(frozen=True)
class TxField:
    """One transmitted command word. ``fmt`` is a struct format for a single value.

    The host's Data_Conditioning does single -> int16 -> uint16(SI), so the field
    is uint16 on the wire. encode_command() masks the (rounded) value to the field
    width first, reproducing the host's int16 wrap-on-overflow before packing.
    """
    name: str
    fmt: str = "<H"             # uint16 little-endian (matches host Serial Send input)


@dataclass(frozen=True)
class FrameCfg:
    """RX framing on the wire: start + nominal_pairs*[ch...] uint16 LE + end.

    Verified by the raw sniffer: on the wire each frame is
    0x5353 ('SS') + 600*[ch1,ch2] uint16 LE + 0x4545 ('EE'), i.e. SS is the
    header and EE is the terminator -- exactly what the Simulink `Host Serial
    Receive` block params (Header 'SS', Terminator 'EE') say. Marker bytes are
    palindromic so endianness is irrelevant for them.
    """
    start: bytes = b"\x53\x53"  # 'SS' = hex2dec('5353'), frame header
    end: bytes = b"\x45\x45"    # 'EE' = hex2dec('4545'), frame terminator
    nominal_pairs: int = 600    # DataSize [600 2]
    pair_tolerance: int = 4     # accept frames within +/- this many sample-rows
    max_buffer: int = 1 << 20   # cap the resync buffer (bytes)


# --- The default GENERIC configuration --------------------------------------
# Stock model: two channels are the phase currents as raw ADC counts.
RX_CHANNELS: list[RxChannel] = [
    RxChannel("Ia (ADC counts)"),
    # Channel 2 = commanded speed. NOTE: requires the target firmware to actually
    # send speed (raw integer RPM) on this column; the stock firmware still sends Ib.
    # signed=True so negative speed shows correctly; scale=1.0 for integer RPM
    # (use scale=2**-17 if the target sends it as Q17 fixed-point instead).
    RxChannel("Speed (RPM)", signed=True, scale=1.0, unit="rpm"),
]

# Command order matches the host Mux: in:1 = speed, in:2 = motor on/off.
TX_FIELDS: list[TxField] = [
    TxField("speed_rpm", "<H"),
    TxField("motor_on", "<H"),
]

SERIAL = SerialCfg()
FRAME = FrameCfg()

# --- Display defaults (per-screen sampling) ---------------------------------
SAMPLE_TIME_S = 5e-5        # per-sample period Ts (s); span = N * SAMPLE_TIME_S
DISPLAY_SAMPLES = 6000      # default samples per screen (N)
N_SAMPLES_MIN = 2          # need at least 2 points to draw a line
N_SAMPLES_MAX = 1_000_000  # cap to keep memory/redraw sane (2ch*float64*1e6 ~ 16MB)


def n_channels() -> int:
    return len(RX_CHANNELS)
