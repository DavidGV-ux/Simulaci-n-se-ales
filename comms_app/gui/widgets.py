"""Widgets reutilizables: tarjetas, gráficas, panel de canal y trabajadores."""

from __future__ import annotations

import traceback
from typing import Callable

import numpy as np
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg, NavigationToolbar2QT
from matplotlib.figure import Figure
from PySide6.QtCore import QObject, QRunnable, QSize, Qt, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from ..core.channel import ChannelConfig, fsl_db
from .theme import (
    AMBER,
    BORDER,
    CHART_COLORS,
    CYAN,
    FAINT,
    GREEN,
    MAGENTA,
    MUTED,
    RED,
    SURFACE,
    SURFACE_2,
    TEXT,
    VIOLET,
)


# ---------------------------------------------------------------------------
# Tarjetas de métricas
# ---------------------------------------------------------------------------


class MetricCard(QFrame):
    def __init__(self, title: str, value: str = "—", hint: str = "", accent: str = CYAN):
        super().__init__()
        self.setObjectName("MetricCard")
        self.setMinimumHeight(74)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 12, 0)
        lay.setSpacing(10)
        bar = QFrame()
        bar.setFixedWidth(3)
        bar.setStyleSheet(f"background:{accent}; border-radius:1px;")
        lay.addWidget(bar)
        text = QVBoxLayout()
        text.setContentsMargins(0, 10, 0, 9)
        text.setSpacing(1)
        self.title = QLabel(title.upper())
        self.title.setObjectName("MetricTitle")
        self.value = QLabel(value)
        self.value.setObjectName("MetricValue")
        self.hint = QLabel(hint)
        self.hint.setObjectName("MetricHint")
        text.addWidget(self.title)
        text.addWidget(self.value)
        text.addWidget(self.hint)
        lay.addLayout(text, 1)

    def set(self, value: str, hint: str | None = None, color: str | None = None) -> None:
        self.value.setText(value)
        if hint is not None:
            self.hint.setText(hint)
        if color is not None:
            self.value.setStyleSheet(f"color:{color};")


# ---------------------------------------------------------------------------
# Gráficas
# ---------------------------------------------------------------------------


class PlotCanvas(QWidget):
    """Figura de matplotlib con barra de navegación discreta."""

    def __init__(self, rows: int = 2, cols: int = 2, figsize: tuple[float, float] = (10.0, 6.8)):
        super().__init__()
        self.figure = Figure(figsize=figsize, dpi=100, layout="constrained")
        self.canvas = FigureCanvasQTAgg(self.figure)
        self.canvas.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.toolbar = NavigationToolbar2QT(self.canvas, self)
        self.toolbar.setIconSize(QSize(14, 14))
        self.toolbar.setStyleSheet("QToolBar{spacing:1px;padding:0px;}")

        lay = QVBoxLayout(self)
        lay.setContentsMargins(4, 4, 4, 2)
        lay.setSpacing(0)
        lay.addWidget(self.canvas, 1)
        lay.addWidget(self.toolbar, 0, Qt.AlignLeft)

        self.axes = self.figure.subplots(rows, cols, squeeze=False).ravel().tolist()
        for ax in self.axes:
            self.clean_axis(ax)

    @staticmethod
    def clean_axis(ax) -> None:
        ax.set_facecolor(SURFACE)
        ax.grid(True, color=CHART_COLORS["grid"], alpha=0.55, linewidth=0.7)
        for spine in ax.spines.values():
            spine.set_color(BORDER)
        ax.tick_params(colors=FAINT, labelsize=8.5)
        ax.title.set_color(TEXT)
        ax.xaxis.label.set_color(MUTED)
        ax.yaxis.label.set_color(MUTED)

    def reset_axes(self) -> None:
        for ax in self.axes:
            ax.clear()
            self.clean_axis(ax)

    def save(self, path: str) -> None:
        self.figure.savefig(path, dpi=170, bbox_inches="tight")


# ---------------------------------------------------------------------------
# Ayudas de formulario
# ---------------------------------------------------------------------------


def field_label(text: str) -> QLabel:
    lab = QLabel(text)
    lab.setObjectName("FieldLabel")
    return lab


def section_label(text: str) -> QLabel:
    lab = QLabel(text.upper())
    lab.setObjectName("SectionTitle")
    return lab


def spin(
    minimum: float,
    maximum: float,
    value: float,
    *,
    decimals: int = 0,
    step: float = 1.0,
    suffix: str = "",
    tooltip: str = "",
) -> QDoubleSpinBox:
    box = QDoubleSpinBox()
    box.setRange(minimum, maximum)
    box.setDecimals(decimals)
    box.setSingleStep(step)
    box.setValue(value)
    box.setKeyboardTracking(False)
    if suffix:
        box.setSuffix(f" {suffix}")
    if tooltip:
        box.setToolTip(tooltip)
    return box


def integer_spin(
    minimum: int,
    maximum: int,
    value: int,
    *,
    step: int = 1,
    suffix: str = "",
    tooltip: str = "",
) -> QSpinBox:
    box = QSpinBox()
    box.setRange(minimum, maximum)
    box.setSingleStep(step)
    box.setValue(value)
    box.setKeyboardTracking(False)
    if suffix:
        box.setSuffix(f" {suffix}")
    if tooltip:
        box.setToolTip(tooltip)
    return box


def divider() -> QFrame:
    line = QFrame()
    line.setFrameShape(QFrame.HLine)
    line.setStyleSheet(f"color:{BORDER}; background:{BORDER}; max-height:1px;")
    return line


# ---------------------------------------------------------------------------
# Panel de canal reutilizable
# ---------------------------------------------------------------------------


class ChannelControls(QGroupBox):
    """Controles del canal físico con presets y cálculo de enlace."""

    changed = Signal()

    PRESETS = [
        "Personalizado",
        "AWGN ideal",
        "Enlace a 1 km",
        "Atenuación fuerte",
        "Multitrayecto",
        "Interferencia",
        "Deriva y fase",
        "No lineal (AGC/clip)",
    ]

    def __init__(
        self,
        *,
        metric: str = "snr",
        default_fc: float = 6000.0,
        default_int_freq: float = 12000.0,
        default_target: float = 20.0,
        amplitude: float = 1.0,
        parent: QWidget | None = None,
    ):
        super().__init__("CANAL", parent)
        self.metric_kind = metric.lower()
        self.default_fc = float(default_fc)
        self.default_int_freq = float(default_int_freq)
        self.default_target = float(default_target)
        self.amplitude = float(amplitude)

        root = QVBoxLayout(self)
        root.setContentsMargins(10, 14, 10, 10)
        root.setSpacing(7)

        top = QHBoxLayout()
        top.setSpacing(6)
        self.preset = QComboBox()
        self.preset.addItems(self.PRESETS)
        self.preset.setToolTip("Configuraciones típicas de canal y hardware")
        self.apply_btn = QPushButton("Aplicar")
        self.apply_btn.setObjectName("Mini")
        self.apply_btn.clicked.connect(self._apply_preset)
        top.addWidget(self.preset, 1)
        top.addWidget(self.apply_btn)
        root.addLayout(top)

        form = QFormLayout()
        form.setContentsMargins(0, 2, 0, 0)
        form.setHorizontalSpacing(8)
        form.setVerticalSpacing(5)
        form.setLabelAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        form.setFieldGrowthPolicy(QFormLayout.AllNonFixedFieldsGrow)

        self.distance = spin(
            0.0, 200.0, 0.0, decimals=3, step=0.01, suffix="km",
            tooltip="0 km representa un enlace de laboratorio sin pérdida de trayecto.",
        )
        self.frequency = spin(
            1.0, 100000.0, 2450.0, decimals=0, step=50.0, suffix="MHz",
            tooltip="Frecuencia de la portadora. Se usa para la pérdida de espacio libre.",
        )
        self.extra_atten = spin(
            0.0, 120.0, 0.0, decimals=1, step=1.0, suffix="dB",
            tooltip="Pérdida adicional: cables, lluvia, obstáculos, desapuntamiento.",
        )
        form.addRow(field_label("Distancia"), self.distance)
        form.addRow(field_label("Frecuencia"), self.frequency)
        form.addRow(field_label("Atenuación extra"), self.extra_atten)

        if self.metric_kind == "ebn0":
            self.nominal = spin(
                -5.0, 180.0, 12.0, decimals=1, step=1.0, suffix="dB",
                tooltip="Eb/N0 nominal de referencia en el transmisor. La atenuación reduce el valor efectivo en recepción.",
            )
            form.addRow(field_label("Eb/N0 nominal TX"), self.nominal)
        else:
            self.nominal = spin(
                -10.0, 180.0, 30.0, decimals=1, step=1.0, suffix="dB",
                tooltip="SNR nominal de referencia en el transmisor. La atenuación reduce el valor efectivo en recepción.",
            )
            form.addRow(field_label("SNR nominal TX"), self.nominal)

        target_row = QHBoxLayout()
        target_row.setSpacing(5)
        self.target = spin(
            -5.0, 60.0, self.default_target, decimals=1, step=1.0, suffix="dB",
            tooltip="Relación deseada en recepción. El botón ajusta el valor nominal para compensar la pérdida actual.",
        )
        self.adjust_btn = QPushButton("Ajustar enlace")
        self.adjust_btn.setObjectName("Mini")
        self.adjust_btn.setToolTip("Ajusta el valor nominal para lograr el objetivo en recepción")
        self.adjust_btn.clicked.connect(self._adjust_link)
        target_row.addWidget(self.target, 1)
        target_row.addWidget(self.adjust_btn)
        form.addRow(field_label("Objetivo RX"), target_row)

        self.link_label = QLabel("—")
        self.link_label.setObjectName("Caption")
        self.link_label.setWordWrap(True)
        form.addRow(self.link_label)
        root.addLayout(form)

        def grid2(rows):
            g = QGridLayout()
            g.setContentsMargins(12, 0, 0, 0)
            g.setHorizontalSpacing(6)
            g.setVerticalSpacing(4)
            for r, (l1, w1, l2, w2) in enumerate(rows):
                g.addWidget(field_label(l1), r, 0)
                g.addWidget(w1, r, 1)
                if l2 is not None:
                    g.addWidget(field_label(l2), r, 2)
                    g.addWidget(w2, r, 3)
            g.setColumnStretch(1, 1)
            g.setColumnStretch(3, 1)
            return g

        self.mp_on = QCheckBox("Multitrayecto (eco)")
        self.mp_delay = spin(1.0, 5000.0, 100.0, decimals=1, step=10.0, suffix="µs",
            tooltip="Retardo del eco. Debe superar el período de muestreo para notarse.")
        self.mp_gain = spin(-40.0, 6.0, -6.0, decimals=1, step=1.0, suffix="dB")
        self.mp_phase = spin(-180.0, 180.0, 180.0, decimals=0, step=15.0, suffix="°")
        root.addWidget(self.mp_on)
        root.addLayout(grid2([("Retardo", self.mp_delay, "Ganancia", self.mp_gain),
                               ("Fase", self.mp_phase, None, None)]))

        self.int_on = QCheckBox("Interferencia (tono)")
        self.int_freq = spin(1.0, 500000.0, self.default_int_freq, decimals=0, step=100.0, suffix="Hz",
            tooltip="Frecuencia del tono interferente. Cerca de la portadora es más dañino.")
        self.int_amp = spin(-60.0, 20.0, -12.0, decimals=1, step=1.0, suffix="dB",
            tooltip="Amplitud del tono relativa a la señal transmitida.")
        root.addWidget(self.int_on)
        root.addLayout(grid2([("Frecuencia", self.int_freq, "Amplitud", self.int_amp)]))

        self.freq_offset = spin(-20000.0, 20000.0, 0.0, decimals=1, step=10.0, suffix="Hz",
            tooltip="Error de portadora entre transmisor y receptor (CFO).")
        self.phase_noise = spin(0.0, 1.0, 0.0, decimals=3, step=0.01, suffix="rad",
            tooltip="Desviación RMS del ruido de fase del oscilador.")
        self.gain_step = spin(-30.0, 30.0, 0.0, decimals=1, step=1.0, suffix="dB",
            tooltip="Cambio abrupto de ganancia (desvanecimiento lento, AGC).")
        self.gain_step_at = spin(0.0, 0.95, 0.5, decimals=2, step=0.05,
            tooltip="Instante del cambio, como fracción de la duración.")
        self.clip_on = QCheckBox("Limitar amplitud (clip)")
        self.clip_level = spin(0.05, 5.0, max(0.5, self.amplitude * 1.2), decimals=3, step=0.1,
            tooltip="Nivel máximo permitido a la salida del amplificador.")
        root.addLayout(grid2([("CFO", self.freq_offset, "Fase RMS", self.phase_noise),
                               ("Escalón", self.gain_step, "Instante", self.gain_step_at)]))
        clip_row = QHBoxLayout()
        clip_row.setContentsMargins(0, 0, 0, 0)
        clip_row.setSpacing(6)
        clip_row.addWidget(self.clip_on)
        clip_row.addWidget(field_label("Nivel"))
        clip_row.addWidget(self.clip_level, 1)
        root.addLayout(clip_row)

        self.seed = integer_spin(1, 999999, 1, tooltip="Semilla para reproducir el ruido")
        seed_form = QFormLayout()
        seed_form.setContentsMargins(0, 0, 0, 0)
        seed_form.setHorizontalSpacing(8)
        seed_form.addRow(field_label("Semilla"), self.seed)
        root.addLayout(seed_form)

        for w in (
            self.distance, self.frequency, self.extra_atten, self.nominal, self.target,
            self.mp_delay, self.mp_gain, self.mp_phase, self.int_freq, self.int_amp,
            self.freq_offset, self.phase_noise, self.gain_step, self.gain_step_at,
            self.clip_level,
        ):
            w.valueChanged.connect(self._on_change)
        for cb in (self.mp_on, self.int_on, self.clip_on):
            cb.toggled.connect(self._update_enabled)
            cb.toggled.connect(self._on_change)
        self.seed.valueChanged.connect(self._on_change)

        # Estado inicial coherente: enlace AWGN ideal sin emitir cambios.
        self.preset.blockSignals(True)
        idx = self.preset.findText("AWGN ideal")
        if idx >= 0:
            self.preset.setCurrentIndex(idx)
        self.preset.blockSignals(False)
        self._apply_preset_values("AWGN ideal")
        self._update_enabled()
        self._update_link_label()

    # -- API -----------------------------------------------------------------
    def config(self) -> ChannelConfig:
        metric = self.metric_kind
        cfg = ChannelConfig(
            distance_km=float(self.distance.value()),
            frequency_mhz=float(self.frequency.value()),
            extra_atten_db=float(self.extra_atten.value()),
            multipath=bool(self.mp_on.isChecked()),
            mp_delay_us=float(self.mp_delay.value()),
            mp_gain_db=float(self.mp_gain.value()),
            mp_phase_deg=float(self.mp_phase.value()),
            interference=bool(self.int_on.isChecked()),
            int_freq_hz=float(self.int_freq.value()),
            int_amp_db=float(self.int_amp.value()),
            freq_offset_hz=float(self.freq_offset.value()),
            phase_noise_rms=float(self.phase_noise.value()),
            gain_step_db=float(self.gain_step.value()),
            gain_step_at=float(self.gain_step_at.value()),
            clip_level=float(self.clip_level.value()) if self.clip_on.isChecked() else None,
            seed=int(self.seed.value()),
        )
        if metric == "ebn0":
            cfg.ebn0_db = float(self.nominal.value())
            cfg.snr_db = None
        else:
            cfg.snr_db = float(self.nominal.value())
            cfg.ebn0_db = None
        return cfg

    def total_atten_db(self) -> float:
        return float(
            fsl_db(self.distance.value(), self.frequency.value())
            + self.extra_atten.value()
        )

    def set_defaults(self) -> None:
        self.preset.setCurrentText("AWGN ideal")
        self._apply_preset()

    def _adjust_link(self) -> None:
        total = self.total_atten_db()
        self.nominal.setValue(min(self.nominal.maximum(), self.target.value() + total))
        self._update_link_label()

    def _on_change(self, *_args) -> None:
        self._update_link_label()
        self.changed.emit()

    def _update_enabled(self) -> None:
        for w in (self.mp_delay, self.mp_gain, self.mp_phase):
            w.setEnabled(self.mp_on.isChecked())
        for w in (self.int_freq, self.int_amp):
            w.setEnabled(self.int_on.isChecked())
        self.clip_level.setEnabled(self.clip_on.isChecked())

    def _update_link_label(self) -> None:
        total = self.total_atten_db()
        effective = self.nominal.value() - total
        self.link_label.setText(
            f"Pérdida total estimada: <b>{total:.1f} dB</b><br>"
            f"{'Eb/N0' if self.metric == 'ebn0' else 'SNR'} efectiva: "
            f"<b>{effective:.1f} dB</b>"
        )
        self.link_label.setStyleSheet(f"color:{FAINT}; font-size:10px;")

    def _apply_preset(self) -> None:
        name = self.preset.currentText()
        if name == "Personalizado":
            return
        self._apply_preset_values(name)
        self._update_enabled()
        self._update_link_label()
        self.changed.emit()

    def _apply_preset_values(self, name: str) -> None:
        if name == "Personalizado":
            return
        # Valores por defecto del preset.
        for w in (
            self.distance, self.frequency, self.extra_atten, self.nominal, self.target,
            self.mp_delay, self.mp_gain, self.mp_phase, self.int_freq, self.int_amp,
            self.freq_offset, self.phase_noise, self.gain_step, self.gain_step_at,
            self.clip_level,
        ):
            w.blockSignals(True)
        for cb in (self.mp_on, self.int_on, self.clip_on):
            cb.blockSignals(True)
        try:
            self.distance.setValue(0.0)
            self.frequency.setValue(2450.0)
            self.extra_atten.setValue(0.0)
            self.mp_on.setChecked(False)
            self.mp_delay.setValue(100.0)
            self.mp_gain.setValue(-6.0)
            self.mp_phase.setValue(180.0)
            self.int_on.setChecked(False)
            self.int_freq.setValue(self.default_int_freq)
            self.int_amp.setValue(-12.0)
            self.freq_offset.setValue(0.0)
            self.phase_noise.setValue(0.0)
            self.gain_step.setValue(0.0)
            self.gain_step_at.setValue(0.5)
            self.clip_on.setChecked(False)
            self.nominal.setValue(self.default_target)

            if name == "Enlace a 1 km":
                self.distance.setValue(1.0)
                self.frequency.setValue(2450.0)
                total = fsl_db(1.0, 2450.0)
                self.nominal.setValue(min(self.nominal.maximum(), self.default_target + total))
            elif name == "Atenuación fuerte":
                self.extra_atten.setValue(40.0)
                self.nominal.setValue(min(self.nominal.maximum(), self.default_target + 40.0))
            elif name == "Multitrayecto":
                self.mp_on.setChecked(True)
                self.mp_delay.setValue(250.0)
                self.mp_gain.setValue(-3.0)
                self.mp_phase.setValue(180.0)
            elif name == "Interferencia":
                self.int_on.setChecked(True)
                self.int_freq.setValue(self.default_int_freq)
                self.int_amp.setValue(-6.0)
            elif name == "Deriva y fase":
                self.freq_offset.setValue(120.0)
                self.phase_noise.setValue(0.06)
            elif name == "No lineal (AGC/clip)":
                self.gain_step.setValue(9.0)
                self.gain_step_at.setValue(0.45)
                self.clip_on.setChecked(True)
                self.clip_level.setValue(max(0.1, self.amplitude * 0.75))
        finally:
            for w in (
                self.distance, self.frequency, self.extra_atten, self.nominal, self.target,
                self.mp_delay, self.mp_gain, self.mp_phase, self.int_freq, self.int_amp,
                self.freq_offset, self.phase_noise, self.gain_step, self.gain_step_at,
                self.clip_level,
            ):
                w.blockSignals(False)
            for cb in (self.mp_on, self.int_on, self.clip_on):
                cb.blockSignals(False)


# ---------------------------------------------------------------------------
# Trabajos en segundo plano
# ---------------------------------------------------------------------------


class WorkerSignals(QObject):
    finished = Signal(object)
    failed = Signal(str)


class SimulationWorker(QRunnable):
    """Ejecuta una simulación fuera del hilo de la interfaz."""

    def __init__(self, fn: Callable[[], object]):
        super().__init__()
        self.fn = fn
        self.signals = WorkerSignals()
        # La página conserva la referencia para evitar entregar una señal desde
        # un QObject ya destruido cuando el runnable termina.
        self.setAutoDelete(False)

    def run(self) -> None:
        try:
            result = self.fn()
        except Exception as exc:  # noqa: BLE001 - se informa al usuario
            traceback.print_exc()
            self.signals.failed.emit(str(exc))
        else:
            self.signals.finished.emit(result)
