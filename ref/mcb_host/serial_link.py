"""Threaded serial link: RX decode thread + thread-safe command send."""
from __future__ import annotations

import queue
import threading
import time

import numpy as np
import serial

from config import FRAME, RX_CHANNELS, SERIAL, TX_FIELDS, SerialCfg
from protocol import FrameAssembler, encode_command

_PARITY = {"N": serial.PARITY_NONE, "E": serial.PARITY_EVEN, "O": serial.PARITY_ODD}
_STOP = {1: serial.STOPBITS_ONE, 2: serial.STOPBITS_TWO}


class SerialLink:
    """Owns the pyserial port. A background thread reads bytes, assembles frames,
    and pushes decoded (n_samples, n_channels) arrays onto ``self.frames`` queue.
    Commands are sent from any thread via :meth:`send_command`.
    """

    def __init__(self, cfg: SerialCfg | None = None) -> None:
        self.cfg = cfg or SERIAL
        self.frames: "queue.Queue[np.ndarray]" = queue.Queue(maxsize=256)
        self._ser: serial.Serial | None = None
        self._assembler = FrameAssembler(RX_CHANNELS, FRAME)
        self._rx_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._send_lock = threading.Lock()
        self._last_cmd = [0, 0]
        # diagnostics
        self.bytes_in = 0
        self.frames_in = 0
        self.error: str | None = None

    # --- lifecycle ----------------------------------------------------------
    def open(self) -> None:
        self._ser = serial.Serial(
            port=self.cfg.port,
            baudrate=self.cfg.baud,
            bytesize=self.cfg.bytesize,
            parity=_PARITY[self.cfg.parity],
            stopbits=_STOP[self.cfg.stopbits],
            timeout=self.cfg.timeout,
        )
        self._stop.clear()
        self.error = None
        self._rx_thread = threading.Thread(target=self._rx_loop, daemon=True)
        self._rx_thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._rx_thread:
            self._rx_thread.join(timeout=1.0)
        if self._ser and self._ser.is_open:
            self._ser.close()
        self._ser = None

    @property
    def is_open(self) -> bool:
        return self._ser is not None and self._ser.is_open

    # --- RX -----------------------------------------------------------------
    def _rx_loop(self) -> None:
        while not self._stop.is_set():
            try:
                n = self._ser.in_waiting or 1
                chunk = self._ser.read(n)
                if not chunk:
                    continue
                self.bytes_in += len(chunk)
                for frame in self._assembler.feed(chunk):
                    self.frames_in += 1
                    try:
                        self.frames.put_nowait(frame)
                    except queue.Full:
                        # drop oldest to stay live
                        try:
                            self.frames.get_nowait()
                            self.frames.put_nowait(frame)
                        except queue.Empty:
                            pass
            except serial.SerialException as exc:
                self.error = str(exc)
                break
            except Exception as exc:  # noqa: BLE001 - keep the thread alive on data glitches
                self.error = f"{type(exc).__name__}: {exc}"
                time.sleep(0.05)

    # --- TX -----------------------------------------------------------------
    def send_command(self, speed_rpm: float, motor_on: int) -> None:
        self._last_cmd = [speed_rpm, motor_on]
        if not self.is_open:
            return
        data = encode_command([speed_rpm, motor_on], TX_FIELDS)
        with self._send_lock:
            self._ser.write(data)

    def resend(self) -> None:
        """Keepalive: re-send the last command (host only sends on change)."""
        self.send_command(*self._last_cmd)
