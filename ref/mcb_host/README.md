# mcb_host — Python host for mcb_open_loop_control (F28069M)

Reimplements the send/receive logic of `mcb_open_loop_control_host_model.slx` in
Python, with a live pyqtgraph display. Sends the speed/run command to the LaunchPad
and plots the two telemetry channels (phase currents Ia/Ib) it streams back.

All commands below are run **from inside this `mcb_host/` folder** — the project
is self-contained, no parent folder needed.

## Install

```
python -m pip install -r requirements.txt
```

(numpy + pyserial + pyqtgraph + PySide6; pytest only for the offline tests.)

## Run against the LaunchPad

1. Flash the existing target model to the board.
2. Find the board's COM port (Device Manager) and launch (or just double-click `run.bat`):

```
python __main__.py --port COM8 --baud 5625000
```

3. Set **Speed (RPM)**, press **Start motor**. The two plots show the live telemetry.

## Wire protocol (must match the target firmware)

| Direction | Format |
|-----------|--------|
| **TX** PC→target | 2× `int16` little-endian, no framing: `[speed_rpm, motor_on]`. Speed is **raw RPM** (no scaling); `motor_on` = 0/1. |
| **RX** target→PC | frame = `0x4545` + `600 × [ch1, ch2]` `uint16` LE + `0x5353` (2404 bytes). Raw counts, no descaling. |
| Port | 8 data bits, no parity, 1 stop bit, little-endian, no flow control. |

Note: the target emits `EE`(0x4545) first and `SS`(0x5353) last; the decoder locks on
that real order (the Simulink block's `Header 'SS'` label is the reverse — a known quirk).

## ⚠ Baud caveat

The stock model uses **5 625 000 baud** — a non-standard rate. It works only if the
LaunchPad's FTDI/XDS100 VCP driver accepts it (FTDI supports arbitrary rates up to
12 M, and pyserial passes the integer straight to the OS driver). If Windows rejects
it, set **both** the target SCI `UserBaudRate` *and* `--baud` to a standard rate
(e.g. `115200`) and re-flash the target.

## Repurposing channel-2 to show commanded Speed

Once you modify the target to send commanded speed on the 2nd telemetry channel
(the firmware mod discussed separately), only edit `mcb_host/config.py`:

```python
RX_CHANNELS = [
    RxChannel("Ia (ADC counts)"),
    RxChannel("Speed (RPM)", signed=True, scale=1.0, unit="rpm"),  # was Ib
]
```

For a Q17 fixed-point channel use `scale=2**-17`. No other code changes.

## Offline testing (no hardware)

Just double-click `test.bat`, or run manually:

```
python -m pytest tests/ -q          # codec + frame-assembler unit tests
python tools/mock_target.py --selftest
```

Loopback smoke test with a com0com virtual COM pair (e.g. COM20↔COM21):

```
python tools/mock_target.py --port COM20 --baud 115200
python __main__.py --port COM21 --baud 115200
```

## Layout

Flat layout — the source modules sit directly in this folder, so everything runs
from here without a parent package.

```
mcb_host/
  run.bat          # one-click GUI launcher (python __main__.py)
  test.bat         # one-click offline tests (pytest + mock selftest)
  requirements.txt
  conftest.py      # puts this folder on sys.path for pytest
  __main__.py      # entry point: python __main__.py
  config.py        # all protocol/display config (channels, port, framing)
  protocol.py      # pure codec: encode_command, FrameAssembler, decode_payload
  serial_link.py   # pyserial port + RX thread; thread-safe send_command
  gui.py           # pyqtgraph window + controls
  tools/mock_target.py
  tools/sniff.py
  tests/test_protocol.py
```
