"""Página de modulación de amplitud (AM)."""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ...core.analog import AMConfig, simulate_am
from ...core.analysis import am_fidelity_curve
from ...core.signals import WAVEFORM_LABELS, CsvSignal, load_csv_signal
from ..theme import AMBER, CHART_COLORS, CYAN, FAINT, GREEN, MAGENTA, RED, VIOLET
from ..widgets import ChannelControls, field_label, spin
from .base import SimulationPage, bits_text, db_text, fmt, pct


class AMPage(SimulationPage):
    accent = CYAN

    def __init__(self, parent: QWidget | None = None):
        self.csv_signal: CsvSignal | None = None
        super().__init__(
            "Modulación de amplitud · AM",
            "La amplitud de la portadora sigue a la señal moduladora. Compara el detector de "
            "envolvente con el detector coherente y observa la sobremodulación.",
            plot_rows=3,
            plot_cols=2,
            figsize=(10.4, 7.6),
            parent=parent,
        )

    # -- Interfaz ------------------------------------------------------------
    def build_metrics(self) -> None:
        self.add_metric("m", "Índice de modulación", CYAN, "m = Vm / Vp")
        self.add_metric("power", "Potencia total", AMBER, "Pt / Pc")
        self.add_metric("env", "Error envolvente", VIOLET, "MSE en régimen permanente")
        self.add_metric("coh", "Error coherente", GREEN, "MSE en régimen permanente")
        self.add_metric("link", "SNR efectiva", MAGENTA, "Nominal menos atenuación")

    def build_controls(self) -> None:
        # Señal --------------------------------------------------------------
        sig = QGroupBox("SEÑAL MODULADORA")
        form = QFormLayout(sig)
        form.setContentsMargins(10, 14, 10, 10)
        form.setHorizontalSpacing(8)
        form.setVerticalSpacing(6)

        self.waveform = QComboBox()
        for key, label in WAVEFORM_LABELS.items():
            self.waveform.addItem(label, key)
        self.waveform.setCurrentIndex(0)
        self.waveform.currentIndexChanged.connect(self._sync_waveform)
        form.addRow(field_label("Forma de onda"), self.waveform)

        self.fm = spin(10.0, 20000.0, 1000.0, decimals=1, step=50.0, suffix="Hz")
        self.phase = spin(-180.0, 180.0, 0.0, decimals=0, step=15.0, suffix="°")
        self.duty = spin(0.05, 0.95, 0.5, decimals=2, step=0.05)
        self.f_end = spin(20.0, 50000.0, 3000.0, decimals=0, step=100.0, suffix="Hz")
        form.addRow(field_label("Frecuencia fm"), self.fm)
        form.addRow(field_label("Fase"), self.phase)
        form.addRow(field_label("Ciclo de trabajo"), self.duty)
        form.addRow(field_label("Chirp f final"), self.f_end)

        self.formula = QLineEdit()
        self.formula.setPlaceholderText("0.8*sin(2*pi*1000*t) + 0.2*sin(2*pi*3000*t)")
        self.formula.setText("0.8*sin(2*pi*1000*t) + 0.2*sin(2*pi*3000*t)")
        self.formula.setToolTip(
            "Fórmula segura en función de t (segundos). Funciones: sin, cos, exp, log, sqrt, "
            "abs, sign, where, clip, heaviside…"
        )
        form.addRow(field_label("Fórmula"), self.formula)

        self.csv_btn = QPushButton("Cargar CSV…")
        self.csv_btn.setObjectName("Mini")
        self.csv_btn.clicked.connect(self._load_csv)
        self.csv_label = QLabel("Sin archivo")
        self.csv_label.setObjectName("Caption")
        self.csv_label.setWordWrap(True)
        csv_row = QHBoxLayout()
        csv_row.setSpacing(6)
        csv_row.addWidget(self.csv_btn)
        csv_row.addWidget(self.csv_label, 1)
        form.addRow(field_label("Datos externos"), csv_row)

        self.fm.valueChanged.connect(self._sync_int_freq)
        self.add_control(sig)

        # Parámetros AM -------------------------------------------------------
        amp = QGroupBox("PARÁMETROS AM")
        amp_form = QFormLayout(amp)
        amp_form.setContentsMargins(10, 14, 10, 10)
        amp_form.setHorizontalSpacing(8)
        amp_form.setVerticalSpacing(6)
        self.m = spin(0.0, 2.0, 0.8, decimals=2, step=0.05, tooltip="m > 1 produce sobremodulación")
        self.Vp = spin(0.05, 5.0, 1.0, decimals=2, step=0.1, suffix="V")
        self.fc = spin(1000.0, 200000.0, 20000.0, decimals=0, step=1000.0, suffix="Hz")
        self.fs = spin(50000.0, 2000000.0, 400000.0, decimals=0, step=10000.0, suffix="Hz")
        self.duration = spin(1.0, 100.0, 10.0, decimals=1, step=1.0, suffix="ms")
        amp_form.addRow(field_label("Índice m"), self.m)
        amp_form.addRow(field_label("Portadora Vp"), self.Vp)
        amp_form.addRow(field_label("Frecuencia fc"), self.fc)
        amp_form.addRow(field_label("Muestreo fs"), self.fs)
        amp_form.addRow(field_label("Duración"), self.duration)
        self.fc.valueChanged.connect(self._sync_int_freq)
        self.add_control(amp)

        self.channel = ChannelControls(
            metric="snr",
            default_fc=20000.0,
            default_int_freq=24000.0,
            default_target=20.0,
            amplitude=1.0,
        )
        self.add_control(self.channel)

        note = QLabel(
            "Con m ≤ 1 el detector de envolvente recupera la señal. Con m > 1 la envolvente "
            "se invierte y el detector de envolvente distorsiona; el detector coherente sigue "
            "siendo lineal."
        )
        note.setObjectName("Caption")
        note.setWordWrap(True)
        self.add_control(note)
        self._sync_waveform()
        self._sync_int_freq()

    def build_plots(self) -> None:
        pass

    def defaults(self) -> None:
        self.waveform.setCurrentIndex(0)
        self.fm.setValue(1000.0)
        self.phase.setValue(0.0)
        self.duty.setValue(0.5)
        self.f_end.setValue(3000.0)
        self.formula.setText("0.8*sin(2*pi*1000*t) + 0.2*sin(2*pi*3000*t)")
        self.m.setValue(0.8)
        self.Vp.setValue(1.0)
        self.fc.setValue(20000.0)
        self.fs.setValue(400000.0)
        self.duration.setValue(10.0)
        self.channel.preset.setCurrentText("AWGN ideal")
        self.channel._apply_preset()
        self.csv_signal = None
        self.csv_label.setText("Sin archivo")
        self._sync_waveform()

    # -- Utilidades de interfaz ---------------------------------------------
    def _sync_waveform(self, *_args) -> None:
        kind = self.waveform.currentData()
        self.formula.setEnabled(kind == "formula")
        self.csv_btn.setEnabled(True)
        self.f_end.setEnabled(kind == "chirp")
        self.duty.setEnabled(kind in {"square", "sawtooth"})
        if kind == "csv" and self.csv_signal is not None:
            self.csv_label.setText(self.csv_signal.name)

    def _sync_int_freq(self, *_args) -> None:
        if hasattr(self, "channel"):
            self.channel.int_freq.setValue(max(1.0, self.fc.value() + 2.0 * self.fm.value()))

    def _load_csv(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Cargar señal desde CSV", "", "Datos (*.csv *.txt);;Todos (*)"
        )
        if not path:
            return
        try:
            self.csv_signal = load_csv_signal(path)
        except Exception as exc:  # noqa: BLE001
            self.show_error(f"CSV inválido: {exc}")
            return
        self.csv_label.setText(f"{self.csv_signal.name} · {self.csv_signal.x.size} muestras")
        idx = self.waveform.findData("csv")
        if idx >= 0:
            self.waveform.setCurrentIndex(idx)
        self.status_label.setText("CSV cargado; pulsa Simular")
        self.error_banner.setVisible(False)

    # -- Simulación ----------------------------------------------------------
    def make_config(self) -> AMConfig:
        kind = self.waveform.currentData()
        if self.fc.value() <= self.fm.value():
            raise ValueError("fc debe ser mayor que fm")
        if self.fs.value() <= 2.0 * self.fc.value():
            raise ValueError("fs debe ser mayor que 2·fc para representar la portadora")
        if kind == "csv" and self.csv_signal is None:
            raise ValueError("Seleccionaste CSV pero no has cargado un archivo")
        formula = self.formula.text().strip() if kind == "formula" else None
        if kind == "formula" and not formula:
            raise ValueError("La fórmula personalizada está vacía")
        csv_t = self.csv_signal.t if kind == "csv" and self.csv_signal else None
        csv_x = self.csv_signal.x if kind == "csv" and self.csv_signal else None
        return AMConfig(
            waveform=kind,
            fm=self.fm.value(),
            phase_deg=self.phase.value(),
            duty=self.duty.value(),
            f_end=self.f_end.value() if kind == "chirp" else None,
            formula=formula,
            csv_t=csv_t,
            csv_x=csv_x,
            Vp=self.Vp.value(),
            fc=self.fc.value(),
            m=self.m.value(),
            fs=self.fs.value(),
            duration=self.duration.value() / 1000.0,
            channel=self.channel.config(),
        )

    def compute(self, cfg: AMConfig):
        result = simulate_am(cfg)
        curve = am_fidelity_curve(cfg)
        return {"am": result, "curve": curve, "cfg": cfg}

    # -- Presentación --------------------------------------------------------
    def present(self, payload) -> None:
        res = payload["am"]
        curve = payload["curve"]
        cfg = payload["cfg"]
        met = res.metrics
        axes = self.plot.axes
        self.plot.reset_axes()
        t_ms = res.t * 1e3
        zoom = t_ms <= t_ms[0] + 4.0 / cfg.fm * 1e3

        # 1) Señal moduladora y recuperación ---------------------------------
        ax = axes[0]
        ax.plot(t_ms[zoom], res.message[zoom], color=CHART_COLORS["message"], lw=2.1, label="m(t) original")
        ax.plot(t_ms[zoom], res.env[zoom], color=CHART_COLORS["env"], lw=1.15, label="detector envolvente")
        ax.plot(t_ms[zoom], res.coh[zoom], color=CHART_COLORS["coh"], lw=1.0, ls="--", label="detector coherente")
        ax.set_title("Recuperación de la señal")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("amplitud normalizada")
        ax.set_ylim(-1.8, 1.8)
        ax.legend(loc="upper right", ncols=1)

        # 2) Señal de RF ------------------------------------------------------
        ax = axes[1]
        gain = max(res.report.gain_linear, 1e-30)
        rx_plot = res.rx / gain
        ax.plot(t_ms[zoom], res.tx[zoom], color=CHART_COLORS["tx"], lw=0.9, label="tx")
        ax.plot(t_ms[zoom], rx_plot[zoom], color=CHART_COLORS["rx"], lw=0.75, alpha=0.9, label="rx (compensada por atenuación)")
        ax.set_title("Señal AM transmitida y recibida")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("amplitud")
        ax.legend(loc="upper right", fontsize=7.5)

        # 3) Espectro ---------------------------------------------------------
        ax = axes[2]
        ftx = res.spectrum_tx_f / 1e3
        frx = res.spectrum_rx_f / 1e3
        ax.plot(ftx, res.spectrum_tx_db, color=CHART_COLORS["tx"], lw=1.1, label="tx")
        ax.plot(frx, res.spectrum_rx_db, color=CHART_COLORS["rx"], lw=0.8, alpha=0.9, label="rx")
        for f0, lab in ((cfg.fc - cfg.fm, "fc−fm"), (cfg.fc, "fc"), (cfg.fc + cfg.fm, "fc+fm")):
            ax.axvline(f0 / 1e3, color=FAINT, lw=0.7, ls=":")
        ax.set_xlim(0, min(cfg.fs / 2e3, (cfg.fc + 6 * cfg.fm) / 1e3))
        ax.set_ylim(-90, 3)
        ax.set_title("Espectro (cada traza normalizada a su pico)")
        ax.set_xlabel("frecuencia (kHz)")
        ax.set_ylabel("magnitud (dB)")
        ax.legend(loc="upper right")
        ax.text(0.01, 0.03, "fc, fc±fm", transform=ax.transAxes, color=FAINT, fontsize=8)

        # 4) Errores ----------------------------------------------------------
        ax = axes[3]
        trim = max(5, len(t_ms) // 20)
        ax.plot(t_ms[trim:-trim], res.env_err[trim:-trim], color=CHART_COLORS["env"], lw=0.9, label="envolvente")
        ax.plot(t_ms[trim:-trim], res.coh_err[trim:-trim], color=CHART_COLORS["coh"], lw=0.9, label="coherente")
        ax.axhline(0, color=FAINT, lw=0.6)
        ax.set_title("Error de recuperación")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("recuperada − original")
        ax.legend(loc="upper right")

        # 5) Curva de fidelidad ----------------------------------------------
        ax = axes[4]
        s = curve["snr_db"]
        ax.semilogy(s, np.maximum(curve["mse_env"], 1e-12), color=CHART_COLORS["env"], marker="o", ms=3, label="envolvente")
        ax.semilogy(s, np.maximum(curve["mse_coh"], 1e-12), color=CHART_COLORS["coh"], marker="s", ms=3, label="coherente")
        snr_eff = met["snr_eff_db"]
        if np.isfinite(snr_eff):
            ax.axvline(snr_eff, color=MAGENTA, lw=1.0, ls="--", alpha=0.8)
            ax.scatter([snr_eff], [max(met["mse_env"], 1e-12)], color=CHART_COLORS["env"], edgecolor="white", zorder=5, s=34)
            ax.scatter([snr_eff], [max(met["mse_coh"], 1e-12)], color=CHART_COLORS["coh"], edgecolor="white", zorder=5, s=34)
            ax.text(snr_eff, ax.get_ylim()[1] * 0.35, " actual", color=MAGENTA, fontsize=8, va="top")
        ax.set_title("Fidelidad frente a SNR (AWGN)")
        ax.set_xlabel("SNR nominal (dB)")
        ax.set_ylabel("MSE")
        ax.legend(loc="lower left")

        # 6) Reparto de potencia ---------------------------------------------
        ax = axes[5]
        m = met["m"]
        carrier = met["carrier_fraction"]
        side = met["sideband_fraction"] / 2.0
        vals = [carrier, side, side]
        labels = ["portadora", "BLI", "BLS"]
        colors = [AMBER, CYAN, VIOLET]
        left = 0.0
        for val, lab, col in zip(vals, labels, colors):
            ax.barh([0], [val * 100], left=left * 100, height=0.5, color=col, alpha=0.85, label=lab)
            if val > 0.05:
                ax.text((left + val / 2) * 100, 0, f"{val * 100:.1f}%", ha="center", va="center",
                        color="#04101f", fontsize=8, fontweight="bold")
            left += val
        ax.set_xlim(0, 100)
        ax.set_yticks([])
        ax.set_title(f"Reparto de potencia AM · m={m:.2f} · Pt/Pc={met['pt_pc']:.3f}")
        ax.set_xlabel("porcentaje de la potencia total")
        ax.legend(loc="upper right", fontsize=7.2, frameon=False)

        self.plot.canvas.draw_idle()

        # Métricas -----------------------------------------------------------
        over = met["overmodulation"]
        self.metrics["m"].set(
            f"{met['m']:.2f}", "m > 1: sobremodulación" if over else f"{met['m_percent']:.0f} % · lineal",
            RED if over else CYAN,
        )
        self.metrics["power"].set(f"{met['pt_pc']:.2f} × Pc", f"portadora {met['carrier_fraction']*100:.1f} %")
        self.metrics["env"].set(f"{met['mse_env']:.2e}", f"correlación {met['corr_env']:.4f}", VIOLET)
        self.metrics["coh"].set(f"{met['mse_coh']:.2e}", f"correlación {met['corr_coh']:.4f}", GREEN)
        self.metrics["link"].set(db_text(met["snr_eff_db"]), f"pérdida {met['total_atten_db']:.1f} dB", MAGENTA)

    def source_text(self, cfg: AMConfig) -> str:
        label = WAVEFORM_LABELS.get(cfg.waveform, cfg.waveform)
        return f"{label} · fm={fmt(cfg.fm, 'Hz')} · m={cfg.m:.2f} · fc={fmt(cfg.fc, 'Hz')}"

    def export_rows(self):
        res = self._result["am"] if isinstance(self._result, dict) else None
        if res is None:
            return ["t_s"], [[]]
        return (
            ["t_s", "m_t", "tx", "rx", "env_rec", "coh_rec", "env_err", "coh_err"],
            [res.t, res.message, res.tx, res.rx, res.env, res.coh, res.env_err, res.coh_err],
        )
