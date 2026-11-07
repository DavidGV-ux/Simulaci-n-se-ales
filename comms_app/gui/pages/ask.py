"""Página de modulación ASK / OOK."""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QGroupBox,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from ...core.analysis import digital_ber_curve
from ...core.digital import ASKConfig, ber_theory, simulate_ask
from ..theme import AMBER, CHART_COLORS, CYAN, FAINT, GREEN, MAGENTA, RED, VIOLET
from ..widgets import ChannelControls, field_label, integer_spin, spin
from .base import SimulationPage, bits_text, db_text, fmt


class ASKPage(SimulationPage):
    accent = CYAN

    def __init__(self, parent: QWidget | None = None):
        super().__init__(
            "Amplitud conmutada · ASK / OOK",
            "La portadora se enciende y se apaga según el bit. Analiza el espectro, el diagrama "
            "de ojo, la detección coherente o de envolvente y la tasa de error.",
            plot_rows=2,
            plot_cols=2,
            figsize=(10.4, 6.9),
            parent=parent,
        )

    def build_metrics(self) -> None:
        self.add_metric("ber", "BER medida", GREEN, "errores / bits")
        self.add_metric("ebn0", "Eb/N0 efectiva", CYAN, "nominal − atenuación")
        self.add_metric("snr", "SNR efectiva", VIOLET, "señal / ruido")
        self.add_metric("bw", "Ancho de banda", AMBER, "2·Rb")
        self.add_metric("carrier", "Portadora real", MAGENTA, "entera por bit")

    def build_controls(self) -> None:
        bits = QGroupBox("SECUENCIA DE BITS")
        form = QFormLayout(bits)
        form.setContentsMargins(10, 14, 10, 10)
        form.setHorizontalSpacing(8)
        form.setVerticalSpacing(6)
        self.nbits = integer_spin(16, 200000, 4000, step=1000, suffix="bits")
        self.bitmode = QComboBox()
        self.bitmode.addItem("Aleatoria", "random")
        self.bitmode.addItem("Manual", "manual")
        self.bitmode.addItem("Alternada 0101…", "alternating")
        self.bitmode.addItem("PRBS-7", "prbs7")
        self.bitmode.currentIndexChanged.connect(self._sync_bits)
        self.manual_bits = QLineEdit("1011001011100101")
        self.manual_bits.setPlaceholderText("Solo 0 y 1; se repite hasta completar nbits")
        self.manual_bits.setToolTip("La secuencia se repite cíclicamente hasta alcanzar el número de bits.")
        self.seed = integer_spin(1, 999999, 1, tooltip="Semilla de la secuencia y del ruido")
        form.addRow(field_label("Número de bits"), self.nbits)
        form.addRow(field_label("Fuente"), self.bitmode)
        form.addRow(field_label("Bits manuales"), self.manual_bits)
        form.addRow(field_label("Semilla"), self.seed)
        self.add_control(bits)

        mod = QGroupBox("MODULACIÓN Y RECEPTOR")
        mf = QFormLayout(mod)
        mf.setContentsMargins(10, 14, 10, 10)
        mf.setHorizontalSpacing(8)
        mf.setVerticalSpacing(6)
        self.rb = spin(100.0, 100000.0, 1000.0, decimals=0, step=100.0, suffix="bit/s")
        self.fc = spin(500.0, 1000000.0, 6000.0, decimals=0, step=500.0, suffix="Hz")
        self.amplitude = spin(0.05, 5.0, 1.0, decimals=2, step=0.1, suffix="V")
        self.sps = integer_spin(8, 128, 32, step=4, suffix="muestras/bit")
        self.detector = QComboBox()
        self.detector.addItem("Coherente", "coherent")
        self.detector.addItem("Envolvente", "envelope")
        self.timing = spin(-0.45, 0.45, 0.0, decimals=2, step=0.05, tooltip="Desplazamiento del instante de muestreo, en fracción de bit")
        self.agc = spin(-20.0, 20.0, 0.0, decimals=1, step=1.0, suffix="dB", tooltip="Error de calibración del umbral en el receptor")
        mf.addRow(field_label("Tasa de bits Rb"), self.rb)
        mf.addRow(field_label("Portadora fc"), self.fc)
        mf.addRow(field_label("Amplitud"), self.amplitude)
        mf.addRow(field_label("Muestras por bit"), self.sps)
        mf.addRow(field_label("Detector"), self.detector)
        mf.addRow(field_label("Error de timing"), self.timing)
        mf.addRow(field_label("Error de AGC"), self.agc)
        self.rb.valueChanged.connect(self._sync_int)
        self.fc.valueChanged.connect(self._sync_int)
        self.add_control(mod)

        self.channel = ChannelControls(
            metric="ebn0",
            default_fc=6000.0,
            default_int_freq=8000.0,
            default_target=10.0,
            amplitude=1.0,
        )
        self.add_control(self.channel)

        note = QLabel(
            "ASK OOK transmite un bit 1 como ráfaga de portadora y un 0 como silencio. "
            "La portadora se ajusta al múltiplo entero de Rb más cercano para que la fase "
            "de cada bit sea reproducible."
        )
        note.setObjectName("Caption")
        note.setWordWrap(True)
        self.add_control(note)
        self._sync_bits()
        self._sync_int()

    def build_plots(self) -> None:
        pass

    def defaults(self) -> None:
        self.nbits.setValue(4000)
        self.bitmode.setCurrentIndex(0)
        self.manual_bits.setText("1011001011100101")
        self.seed.setValue(1)
        self.rb.setValue(1000.0)
        self.fc.setValue(6000.0)
        self.amplitude.setValue(1.0)
        self.sps.setValue(32)
        self.detector.setCurrentIndex(0)
        self.timing.setValue(0.0)
        self.agc.setValue(0.0)
        self.channel.preset.setCurrentText("AWGN ideal")
        self.channel._apply_preset()
        self._sync_bits()

    # -- Utilidades ----------------------------------------------------------
    def _sync_bits(self, *_args) -> None:
        self.manual_bits.setEnabled(self.bitmode.currentData() == "manual")

    def _sync_int(self, *_args) -> None:
        if hasattr(self, "channel"):
            self.channel.int_freq.setValue(max(1.0, self.fc.value() + 1.5 * self.rb.value()))

    # -- Simulación ----------------------------------------------------------
    def make_config(self) -> ASKConfig:
        rb = self.rb.value()
        sps = self.sps.value()
        if self.fc.value() >= 0.5 * rb * sps:
            raise ValueError("fc debe ser menor que (Rb·sps)/2; reduce fc o aumenta sps")
        mode = self.bitmode.currentData()
        if mode == "manual":
            clean = "".join(ch for ch in self.manual_bits.text() if ch not in " \t,;_-")
            if not clean or any(ch not in "01" for ch in clean):
                raise ValueError("La secuencia manual solo puede contener 0 y 1")
        return ASKConfig(
            nbits=self.nbits.value(),
            bit_mode=mode,
            manual_bits=self.manual_bits.text(),
            rb=rb,
            fc=self.fc.value(),
            amplitude=self.amplitude.value(),
            sps=sps,
            detector=self.detector.currentData(),
            agc_error_db=self.agc.value(),
            timing_offset_frac=self.timing.value(),
            seed=self.seed.value(),
            channel=self.channel.config(),
        )

    def compute(self, cfg: ASKConfig):
        result = simulate_ask(cfg)
        curve = digital_ber_curve(cfg, "ASK")
        return {"ask": result, "curve": curve, "cfg": cfg}

    # -- Presentación --------------------------------------------------------
    def present(self, payload) -> None:
        res = payload["ask"]
        curve = payload["curve"]
        cfg = payload["cfg"]
        axes = self.plot.axes
        self.plot.reset_axes()
        gain = max(res.report.gain_linear, 1e-30)
        t_ms = res.t * 1e3
        nshow = min(24, res.nbits)
        mask = t_ms <= t_ms[0] + nshow / res.rb * 1e3
        rx_n = res.rx / gain

        # 1) Forma de onda ----------------------------------------------------
        ax = axes[0]
        ax.plot(t_ms[mask], res.tx[mask], color=CHART_COLORS["tx"], lw=1.0, label="tx")
        ax.plot(t_ms[mask], rx_n[mask], color=CHART_COLORS["rx"], lw=0.75, alpha=0.9, label="rx / ganancia")
        centers = (np.arange(nshow) + 0.5) / res.rb * 1e3
        ax.scatter(centers, res.detected[:nshow] * (cfg.amplitude * 1.08), s=16,
                   color=CHART_COLORS["accent"], zorder=5, label="bits detectados")
        ax.set_title(f"Secuencia y forma de onda · {bits_text(res.bits[:24])}")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("amplitud")
        ax.legend(loc="upper right", ncols=3, fontsize=7.5)

        # 2) Espectro ---------------------------------------------------------
        ax = axes[1]
        f = res.spectrum_f / 1e3
        ax.plot(f, res.spectrum_db, color=CHART_COLORS["tx"], lw=0.9, label="tx")
        ax.axvline(float(res.extras.get("fc", cfg.fc)) / 1e3, color=FAINT, lw=0.8, ls=":")
        for k in range(1, 3):
            ax.axvline((float(res.extras.get("fc", cfg.fc)) + k * res.rb) / 1e3, color=FAINT, lw=0.5, ls="--", alpha=0.5)
        ax.set_xlim(0, min(res.fs / 2e3, (float(res.extras.get("fc", cfg.fc)) + 6 * res.rb) / 1e3))
        ax.set_ylim(-80, 3)
        ax.set_title("Espectro ASK · lóbulos sinc")
        ax.set_xlabel("frecuencia (kHz)")
        ax.set_ylabel("magnitud (dB)")
        ax.legend(loc="upper right")

        # 3) Diagrama de ojo --------------------------------------------------
        ax = axes[2]
        eye = res.eye
        if eye is not None:
            eye_n = eye / gain
            ui = np.linspace(0.0, 1.0, eye_n.shape[1], endpoint=False)
            for row in eye_n[: min(160, eye_n.shape[0])]:
                ax.plot(ui, row, color=CHART_COLORS["rx"], lw=0.55, alpha=0.24)
            thr = float(res.extras.get("threshold", 0.0)) / gain
            ax.axhline(thr, color=CHART_COLORS["accent"], lw=1.0, ls="--", label="umbral")
            ax.set_title("Diagrama de ojo (160 bits)")
            ax.set_xlabel("tiempo normalizado (UI)")
            ax.set_ylabel("amplitud")
            ax.legend(loc="upper right")
        else:
            ax.text(0.5, 0.5, "Sin datos", ha="center", va="center", transform=ax.transAxes)

        # 4) BER --------------------------------------------------------------
        ax = axes[3]
        e = curve["ebn0_db"]
        ask_env = str(cfg.detector).lower() == "envelope"
        theory_label = "teoría (coherente)" if ask_env else "teoría"
        ax.semilogy(e, np.maximum(curve["ber_theory"], 1e-8), color=CHART_COLORS["theory"], lw=1.4, label=theory_label)
        measured = np.maximum(curve["ber_sim"], 0.5 / curve["nbits"])
        ax.semilogy(e, measured, color=CHART_COLORS["measured"], marker="o", ms=3.2, lw=1.1, label="Monte Carlo")
        ebn0_eff = res.ebn0_eff_db
        if np.isfinite(ebn0_eff):
            y = res.ber if res.ber > 0 else 0.5 / res.nbits
            ax.scatter([ebn0_eff], [y], s=55, color=CHART_COLORS["accent"], edgecolor="white", zorder=6, label="actual")
            ax.axvline(ebn0_eff, color=MAGENTA, lw=0.8, ls="--", alpha=0.7)
        ax.set_ylim(1e-6, 1.0)
        ax.set_xlim(float(e[0]), float(e[-1]))
        ax.set_title(f"BER · {curve['nbits']} bits por punto")
        ax.set_xlabel("Eb/N0 (dB)")
        ax.set_ylabel("BER")
        ax.legend(loc="lower left")

        self.plot.canvas.draw_idle()

        # Métricas -----------------------------------------------------------
        ber = res.ber
        color = GREEN if ber == 0 else (AMBER if ber < 1e-2 else RED)
        self.metrics["ber"].set(f"{ber:.2e}", f"{res.errors} errores / {res.nbits} bits", color)
        self.metrics["ebn0"].set(db_text(res.ebn0_eff_db), f"nominal {cfg.channel.ebn0_db:.1f} dB", CYAN)
        self.metrics["snr"].set(db_text(float(res.extras.get("snr_band_db", res.snr_eff_db))), "SNR en banda (2·Rb)", VIOLET)
        self.metrics["bw"].set(f"{2 * res.rb / 1e3:.1f} kHz", f"eficiencia {res.rb/(2*res.rb):.2f} bit/s/Hz", AMBER)
        self.metrics["carrier"].set(
            f"{res.extras.get('fc', cfg.fc)/1e3:.1f} kHz",
            f"{res.extras.get('cycles_per_bit', 0)} ciclos/bit · {res.extras.get('detector', '')}",
            MAGENTA,
        )

    def source_text(self, cfg: ASKConfig) -> str:
        return f"{cfg.bit_mode} · {cfg.nbits} bits · Rb={fmt(cfg.rb, 'bit/s')} · detector {cfg.detector}"

    def export_rows(self):
        res = self._result["ask"] if isinstance(self._result, dict) else None
        if res is None:
            return ["t_s"], [[]]
        return (
            ["t_s", "tx", "rx", "bits", "detected"],
            [res.t, res.tx, res.rx, res.bits.astype(float), res.detected.astype(float)],
        )
