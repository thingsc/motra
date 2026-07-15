"""pyqtgraph live GUI: rolling telemetry plots + speed / start-stop controls."""
from __future__ import annotations

import numpy as np
import pyqtgraph as pg
from pyqtgraph.Qt import QtCore, QtGui, QtWidgets

from config import (
    DISPLAY_SAMPLES,
    N_SAMPLES_MAX,
    N_SAMPLES_MIN,
    RX_CHANNELS,
    SAMPLE_TIME_S,
    SERIAL,
    SerialCfg,
)
from serial_link import SerialLink

_PEN = [(0, 170, 255), (255, 140, 0), (0, 200, 120), (230, 60, 60)]
_UI_MS = 30          # plot refresh period

# span / time-axis units: (label, factor) where factor = units per second.
_UNITS = {"µs": 1e6, "ms": 1e3, "s": 1.0}


def _pick_unit(t_s: float) -> tuple[str, float]:
    """Choose a display unit so the numeric value stays readable."""
    if t_s < 1e-3:
        return "µs", 1e6
    if t_s < 1.0:
        return "ms", 1e3
    return "s", 1.0


class HostWindow(QtWidgets.QMainWindow):
    def __init__(
        self,
        cfg: SerialCfg | None = None,
        ts: float = SAMPLE_TIME_S,
        n: int = DISPLAY_SAMPLES,
    ) -> None:
        super().__init__()
        self.cfg = cfg or SERIAL
        self.link = SerialLink(self.cfg)
        self.setWindowTitle("mcb_open_loop_control - Python host")
        self.resize(1000, 720)

        # per-screen sampling state
        self._ts = float(ts)                       # sample period Ts (s)
        self._n = int(np.clip(n, N_SAMPLES_MIN, N_SAMPLES_MAX))  # samples/screen
        self._span_unit = _pick_unit(self._n * self._ts)        # (label, factor)
        self._updating = False                     # re-entrancy guard for fields

        self._bufs = [np.zeros(self._n) for _ in RX_CHANNELS]
        self._filled = 0

        self._build_ui()
        # initialise the three linked fields + time axis from current state
        self._recompute_span_from_n()
        self._apply_time_axis()

        self._timer = QtCore.QTimer(self)
        self._timer.timeout.connect(self._update)
        self._timer.start(_UI_MS)

    # --- UI ------------------------------------------------------------------
    def _build_ui(self) -> None:
        central = QtWidgets.QWidget()
        self.setCentralWidget(central)
        root = QtWidgets.QVBoxLayout(central)

        root.addLayout(self._control_bar())

        self.glw = pg.GraphicsLayoutWidget()
        root.addWidget(self.glw, stretch=1)
        self.curves = []
        plots = []
        for i, ch in enumerate(RX_CHANNELS):
            p = self.glw.addPlot(row=i, col=0)
            p.showGrid(x=True, y=True, alpha=0.3)
            p.setLabel("left", ch.name, units=ch.unit)
            plots.append(p)
            self.curves.append(p.plot(pen=pg.mkPen(_PEN[i % len(_PEN)], width=1)))
        # Share one common time axis across all channel plots: link every plot's
        # x-range to the bottom one (the master) so they never drift apart, and
        # show x tick values only on the bottom plot.
        self._bottom_plot = plots[-1]          # relabelled by _apply_time_axis()
        for p in plots[:-1]:
            p.setXLink(self._bottom_plot)
            p.getAxis("bottom").setStyle(showValues=False)

        self.status = QtWidgets.QLabel("disconnected")
        self.statusBar().addWidget(self.status)

    def _control_bar(self) -> QtWidgets.QHBoxLayout:
        bar = QtWidgets.QHBoxLayout()

        bar.addWidget(QtWidgets.QLabel("Port"))
        self.port_edit = QtWidgets.QLineEdit(self.cfg.port)
        self.port_edit.setMaximumWidth(90)
        bar.addWidget(self.port_edit)

        bar.addWidget(QtWidgets.QLabel("Baud"))
        self.baud_edit = QtWidgets.QLineEdit(str(self.cfg.baud))
        self.baud_edit.setMaximumWidth(110)
        bar.addWidget(self.baud_edit)

        self.connect_btn = QtWidgets.QPushButton("Connect")
        self.connect_btn.clicked.connect(self._toggle_connect)
        bar.addWidget(self.connect_btn)

        # --- per-screen sampling: Ts / N / span (linked by span = N * Ts) ---
        bar.addSpacing(20)
        bar.addWidget(QtWidgets.QLabel("Ts (s)"))
        self.ts_edit = QtWidgets.QLineEdit(repr(self._ts))
        self.ts_edit.setMaximumWidth(80)
        ts_val = QtGui.QDoubleValidator(1e-12, 1e3, 12, self.ts_edit)
        ts_val.setNotation(QtGui.QDoubleValidator.ScientificNotation)
        self.ts_edit.setValidator(ts_val)
        self.ts_edit.editingFinished.connect(self._on_ts_edited)
        bar.addWidget(self.ts_edit)

        bar.addWidget(QtWidgets.QLabel("Points"))
        self.n_edit = QtWidgets.QLineEdit(str(self._n))
        self.n_edit.setMaximumWidth(90)
        self.n_edit.setValidator(QtGui.QIntValidator(N_SAMPLES_MIN, N_SAMPLES_MAX, self.n_edit))
        self.n_edit.editingFinished.connect(self._on_n_edited)
        bar.addWidget(self.n_edit)

        bar.addWidget(QtWidgets.QLabel("Span"))
        self.span_edit = QtWidgets.QLineEdit()
        self.span_edit.setMaximumWidth(90)
        span_val = QtGui.QDoubleValidator(self.span_edit)
        span_val.setBottom(0.0)
        self.span_edit.setValidator(span_val)
        self.span_edit.editingFinished.connect(self._on_span_edited)
        bar.addWidget(self.span_edit)
        self.span_unit_cb = QtWidgets.QComboBox()
        self.span_unit_cb.addItems(list(_UNITS.keys()))
        self.span_unit_cb.currentIndexChanged.connect(self._on_span_edited)
        bar.addWidget(self.span_unit_cb)

        bar.addSpacing(20)
        bar.addWidget(QtWidgets.QLabel("Speed (RPM)"))
        self.speed_spin = QtWidgets.QSpinBox()
        self.speed_spin.setRange(-30000, 30000)
        self.speed_spin.setSingleStep(50)
        self.speed_spin.setValue(0)
        self.speed_spin.valueChanged.connect(self._send_cmd)
        bar.addWidget(self.speed_spin)

        self.motor_btn = QtWidgets.QPushButton("Start motor")
        self.motor_btn.setCheckable(True)
        self.motor_btn.toggled.connect(self._on_motor_toggle)
        bar.addWidget(self.motor_btn)

        bar.addStretch(1)
        return bar

    # --- actions -------------------------------------------------------------
    def _toggle_connect(self) -> None:
        if self.link.is_open:
            self.link.close()
            self.connect_btn.setText("Connect")
            self.status.setText("disconnected")
            return
        try:
            self.link.cfg = SerialCfg(
                port=self.port_edit.text().strip(),
                baud=int(self.baud_edit.text()),
            )
            self.link = SerialLink(self.link.cfg)
            self.link.open()
            self.connect_btn.setText("Disconnect")
            self._send_cmd()  # push current setpoint on connect
        except Exception as exc:  # noqa: BLE001
            QtWidgets.QMessageBox.critical(self, "Serial error", str(exc))

    def _on_motor_toggle(self, on: bool) -> None:
        self.motor_btn.setText("Stop motor" if on else "Start motor")
        self._send_cmd()

    def _send_cmd(self) -> None:
        self.link.send_command(self.speed_spin.value(), int(self.motor_btn.isChecked()))

    # --- per-screen sampling (Ts / N / span linkage) -------------------------
    def _on_ts_edited(self) -> None:
        if self._updating:
            return
        try:
            ts = float(self.ts_edit.text())
        except ValueError:
            ts = 0.0
        if ts <= 0.0:                       # required, must be > 0 -> revert
            self._set_text(self.ts_edit, repr(self._ts))
            return
        self._ts = ts                       # keep N, recompute span
        self._recompute_span_from_n()
        self._apply_time_axis()

    def _on_n_edited(self) -> None:
        if self._updating:
            return
        try:
            n = int(self.n_edit.text())
        except ValueError:
            self._set_text(self.n_edit, str(self._n))
            return
        n = int(np.clip(n, N_SAMPLES_MIN, N_SAMPLES_MAX))
        self._set_text(self.n_edit, str(n))
        self._resize_buffers(n)
        self._recompute_span_from_n()
        self._apply_time_axis()

    def _on_span_edited(self) -> None:
        if self._updating:
            return
        try:
            value = float(self.span_edit.text())
        except ValueError:
            value = 0.0
        factor = _UNITS[self.span_unit_cb.currentText()]
        t_s = value / factor
        if t_s <= 0.0:                      # invalid span -> revert from N
            self._recompute_span_from_n()
            return
        n = int(np.clip(round(t_s / self._ts), N_SAMPLES_MIN, N_SAMPLES_MAX))
        self._set_text(self.n_edit, str(n))
        self._resize_buffers(n)
        self._recompute_span_from_n()       # normalise span/unit to the real N
        self._apply_time_axis()

    def _recompute_span_from_n(self) -> None:
        """span = N * Ts; refresh the span value + unit (auto-scaled)."""
        t_s = self._n * self._ts
        label, factor = _pick_unit(t_s)
        self._span_unit = (label, factor)
        self._updating = True
        self.span_edit.setText(f"{t_s * factor:.6g}")
        self.span_unit_cb.setCurrentText(label)
        self._updating = False

    def _resize_buffers(self, n: int) -> None:
        if n == self._n:
            return
        self._n = n
        self._bufs = [np.zeros(n) for _ in RX_CHANNELS]
        self._filled = 0                    # clear & refill on resize

    def _apply_time_axis(self) -> None:
        if self._bottom_plot is not None:
            self._bottom_plot.setLabel("bottom", "time", units=self._span_unit[0])

    @staticmethod
    def _set_text(edit: QtWidgets.QLineEdit, text: str) -> None:
        edit.blockSignals(True)
        edit.setText(text)
        edit.blockSignals(False)

    # --- plot loop -----------------------------------------------------------
    def _drain(self) -> None:
        got = False
        while True:
            try:
                frame = self.link.frames.get_nowait()
            except Exception:
                break
            got = True
            n = frame.shape[0]
            for c in range(len(self._bufs)):
                b = self._bufs[c]
                if n >= self._n:
                    b[:] = frame[-self._n:, c]
                else:
                    b[:-n] = b[n:]
                    b[-n:] = frame[:, c]
            self._filled = min(self._n, self._filled + n)
        return got

    def _update(self) -> None:
        if self._drain():
            factor = self._span_unit[1]     # units per second
            x = np.arange(self._filled) * self._ts * factor
            for c, curve in enumerate(self.curves):
                curve.setData(x, self._bufs[c][self._n - self._filled:])
        if self.link.is_open:
            err = f"  ERR: {self.link.error}" if self.link.error else ""
            unit = self._span_unit[0]
            span = self._n * self._ts * self._span_unit[1]
            self.status.setText(
                f"{self.link.cfg.port} @ {self.link.cfg.baud}  |  "
                f"frames={self.link.frames_in}  bytes={self.link.bytes_in}"
                f"  dropped={self.link._assembler.dropped}"
                f"  |  N={self._n} pts  span={span:.6g} {unit}{err}"
            )

    def closeEvent(self, ev) -> None:  # noqa: N802 (Qt signature)
        self.link.close()
        super().closeEvent(ev)


def run(cfg: SerialCfg | None = None, ts: float = SAMPLE_TIME_S,
        n: int = DISPLAY_SAMPLES) -> int:
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    win = HostWindow(cfg, ts=ts, n=n)
    win.show()
    return app.exec()
