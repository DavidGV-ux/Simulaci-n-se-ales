"""Página de modulación por desplazamiento de frecuencia (FSK)."""

from __future__ import annotations

import numpy as np
from scipy.signal import hilbert
from PySide6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QGroupBox,
    QLabel,
    QLineEdit,
    QWidget,
)

from ...core.analysis import digital_ber_curve
from ...core.digital import FSKConfig, simulate_fsk
from ..theme import AMBER, CHART_COLORS, CYAN, FAINT, GREEN, MAGENTA, RED, VIOLET
from ..widgets import ChannelControls, field_label, integer_spin, spin
from .base import SimulationPage, bits_text, db_text, fmt


class FSKPage(SimulationPage):
    accent = AMBER

    def __init__(self, parent: QWidget | None = None):
        super().__init__(
            "Frecuencia conmutada · FSK",
            "El bit selecciona una de dos frecuencias. Observa la frecuencia instantánea, la "
            "ortogonalidad de los tonos, el espectro y la detección coherente o no coherente.",
            plot_rows=2,
            plot_cols=2,
            figsize=(10.4, 6.9),
            parent=parent,
        )

    def build_metrics(self) -> None:
        self.add_metric("ber", "BER medida", GREEN, "errores / bits")
        self.add_metric("ebn0", "Eb/N0 efectiva", AMBER, "nominal − atenuación")
        self.add_metric("h", "Índice h", CYAN, "h = 2·Δf / Rb")
        self.add_metric("bw", "Ancho de banda", VIOLET, "Carson: 2(Δf+Rb)")
        self.add_metric("tones", "Tonos f0 / f1", MAGENTA, "separación Δf")

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
        self.seed = integer_spin(1, 999999, 1)
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
        self.fc = spin(1000.0, 1000000.0, 6000.0, decimals=0, step=500.0, suffix="Hz")
        self.amplitude = spin(0.05, 5.0, 1.0, decimals=2, step=0.1, suffix="V")
        self.sps = integer_spin(8, 128, 32, step=4, suffix="muestras/bit")
        self.h = spin(0.1, 4.0, 1.0, decimals=2, step=0.1, tooltip="h = 2Δf/Rb. h=1 separa los tonos 1/Tb.")
        self.detector = QComboBox()
        self.detector.addItem("No coherente (I/Q)", "noncoherent")
        self.detector.addItem("Coherente", "coherent")
        self.timing = spin(-0.45, 0.45, 0.0, decimals=2, step=0.05)
        mf.addRow(field_label("Tasa de bits Rb"), self.rb)
        mf.addRow(field_label("Portadora central"), self.fc)
        mf.addRow(field_label("Amplitud"), self.amplitude)
        mf.addRow(field_label("Muestras por bit"), self.sps)
        mf.addRow(field_label("Índice h"), self.h)
        mf.addRow(field_label("Detector"), self.detector)
        mf.addRow(field_label("Error de timing"), self.timing)
        self.rb.valueChanged.connect(self._sync_int)
        self.fc.valueChanged.connect(self._sync_int)
        self.h.valueChanged.connect(self._sync_int)
        self.add_control(mod)

        self.channel = ChannelControls(
            metric="ebn0",
            default_fc=6000.0,
            default_int_freq=8500.0,
            default_target=10.0,
            amplitude=1.0,
        )
        self.add_control(self.channel)

        note = QLabel(
            "Con h = 1 los tonos están separados 1/Tb y son ortogonales en un intervalo de bit. "
            "La detección no coherente compara la energía de dos ramas I/Q y no necesita "
            "recuperar la fase de la portadora."
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
        self.h.setValue(1.0)
        self.detector.setCurrentIndex(0)
        self.timing.setValue(0.0)
        self.channel.preset.setCurrentText("AWGN ideal")
        self.channel._apply_preset()
        self._sync_bits()

    def _sync_bits(self, *_args) -> None:
        self.manual_bits.setEnabled(self.bitmode.currentData() == "manual")

    def _sync_int(self, *_args) -> None:
        if hasattr(self, "channel"):
            self.channel.int_freq.setValue(max(1.0, self.fc.value() + 2.0 * self.rb.value()))

    def make_config(self) -> FSKConfig:
        rb = self.rb.value()
        sps = self.sps.value()
        df = 0.5 * self.h.value() * rb
        f0, f1 = self.fc.value() - df, self.fc.value() + df
        if f0 <= 0:
            raise ValueError("f0 debe ser positiva; aumenta fc o reduce h·Rb")
        if f1 >= 0.5 * rb * sps:
            raise ValueError("f1 debe ser menor que (Rb·sps)/2; reduce fc/h o aumenta sps")
        mode = self.bitmode.currentData()
        if mode == "manual":
            clean = "".join(ch for ch in self.manual_bits.text() if ch not in " \t,;_-")
            if not clean or any(ch not in "01" for ch in clean):
                raise ValueError("La secuencia manual solo puede contener 0 y 1")
        return FSKConfig(
            nbits=self.nbits.value(),
            bit_mode=mode,
            manual_bits=self.manual_bits.text(),
            rb=rb,
            fc=self.fc.value(),
            amplitude=self.amplitude.value(),
            sps=sps,
            modulation_index=self.h.value(),
            detector=self.detector.currentData(),
            timing_offset_frac=self.timing.value(),
            seed=self.seed.value(),
            channel=self.channel.config(),
        )

    def compute(self, cfg: FSKConfig):
        result = simulate_fsk(cfg)
        curve = digital_ber_curve(cfg, "FSK")
        return {"fsk": result, "curve": curve, "cfg": cfg}

    def present(self, payload) -> None:
        res = payload["fsk"]
        curve = payload["curve"]
        cfg = payload["cfg"]
        axes = self.plot.axes
        self.plot.reset_axes()
        gain = max(res.report.gain_linear, 1e-30)
        t_ms = res.t * 1e3
        nshow = min(28, res.nbits)
        mask = t_ms <= t_ms[0] + nshow / res.rb * 1e3
        rx_n = res.rx / gain

        # 1) Forma de onda ----------------------------------------------------
        ax = axes[0]
        ax.plot(t_ms[mask], res.tx[mask], color=CHART_COLORS["tx"], lw=0.9, label="tx")
        ax.plot(t_ms[mask], rx_n[mask], color=CHART_COLORS["rx"], lw=0.7, alpha=0.9, label="rx / ganancia")
        centers = (np.arange(nshow) + 0.5) / res.rb * 1e3
        det_levels = (res.detected[:nshow].astype(float) * 2.0 - 1.0) * (cfg.amplitude * 1.12)
        ax.scatter(centers, det_levels, s=15,
                   color=CHART_COLORS["accent"], zorder=5, label="bits detectados")
        ax.set_title(f"Forma de onda FSK · {bits_text(res.bits[:28])}")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("amplitud")
        ax.legend(loc="upper right", ncols=3, fontsize=7.5)

        # 2) Frecuencia por bit (estimación de pendiente de fase) -------------
        ax = axes[1]
        z = hilbert(res.rx)
        phase = np.unwrap(np.angle(z))
        n_inst = min(res.nbits, phase.size // res.sps)
        if n_inst > 1:
            seg = phase[: n_inst * res.sps].reshape(n_inst, res.sps)
            slope = (seg[:, -1] - seg[:, 0]) / ((res.sps - 1) / res.fs)
            f_bit = slope / (2.0 * np.pi)
            t_bit = (np.arange(n_inst) + 0.5) / res.rb * 1e3
            m2 = t_bit <= t_ms[0] + nshow / res.rb * 1e3
            ax.step(t_bit[m2], f_bit[m2] / 1e3, where="mid", color=CHART_COLORS["rx"], lw=1.2, label="f estimada por bit")
        f0 = res.extras["f0"] / 1e3
        f1 = res.extras["f1"] / 1e3
        ax.axhline(f0, color=CYAN, lw=0.9, ls="--", label=f"f0={f0:.2f} kHz")
        ax.axhline(f1, color=AMBER, lw=0.9, ls="--", label=f"f1={f1:.2f} kHz")
        margin = max(0.5, 0.3 * abs(f1 - f0))
        ax.set_ylim(min(f0, f1) - margin, max(f0, f1) + margin)
        ax.set_title("Frecuencia estimada por bit")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("frecuencia (kHz)")
        ax.legend(loc="upper right", fontsize=7.5)

        # 3) Espectro ---------------------------------------------------------
        ax = axes[2]
        f = res.spectrum_f / 1e3
        ax.plot(f, res.spectrum_db, color=CHART_COLORS["tx"], lw=0.9, label="tx")
        ax.axvline(f0, color=CYAN, lw=0.8, ls="--")
        ax.axvline(f1, color=AMBER, lw=0.8, ls="--")
        ax.set_xlim(max(0, f0 - 4 * cfg.rb / 1e3), f1 + 4 * cfg.rb / 1e3)
        ax.set_ylim(-80, 3)
        ax.set_title(f"Espectro FSK · h={cfg.modulation_index:.2f}")
        ax.set_xlabel("frecuencia (kHz)")
        ax.set_ylabel("magnitud (dB)")
        ax.legend(loc="upper right")

        # 4) BER --------------------------------------------------------------
        ax = axes[3]
        e = curve["ebn0_db"]
        ax.semilogy(e, np.maximum(curve["ber_theory"], 1e-8), color=CHART_COLORS["theory"], lw=1.4, label="teoría")
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
        self.metrics["ebn0"].set(db_text(res.ebn0_eff_db), f"nominal {cfg.channel.ebn0_db:.1f} dB", AMBER)
        self.metrics["h"].set(
            f"{cfg.modulation_index:.2f}",
            "ortogonal" if res.extras.get("orthogonal") else "no ortogonal",
            CYAN,
        )
        bw = res.extras["bandwidth_hz"]
        self.metrics["bw"].set(f"{bw/1e3:.1f} kHz", f"eficiencia {res.rb/bw:.2f} bit/s/Hz", VIOLET)
        self.metrics["tones"].set(
            f"{res.extras['f0']/1e3:.2f} / {res.extras['f1']/1e3:.2f} kHz",
            f"Δf={res.extras['df']/1e3:.2f} kHz · {res.extras['detector']}",
            MAGENTA,
        )

    def source_text(self, cfg: FSKConfig) -> str:
        return (
            f"{cfg.bit_mode} · {cfg.nbits} bits · Rb={fmt(cfg.rb, 'bit/s')} · "
            f"h={cfg.modulation_index:.2f} · {cfg.detector}"
        )

    def export_rows(self):
        res = self._result["fsk"] if isinstance(self._result, dict) else None
        if res is None:
            return ["t_s"], [[]]
        return (
            ["t_s", "tx", "rx", "bits", "detected"],
            [res.t, res.tx, res.rx, res.bits.astype(float), res.detected.astype(float)],
        )
