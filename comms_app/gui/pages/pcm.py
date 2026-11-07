"""Página PCM: muestreo, cuantificación, codificación y reconstrucción."""

from __future__ import annotations

import numpy as np
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QWidget,
)

from ...core.analysis import pcm_sqnr_bits_curve, pcm_sqnr_ebn0_curve
from ...core.pcm import PCMConfig, simulate_pcm
from ...core.signals import WAVEFORM_LABELS, CsvSignal, load_csv_signal
from ..theme import AMBER, CHART_COLORS, CYAN, FAINT, GREEN, MAGENTA, RED, VIOLET
from ..widgets import ChannelControls, field_label, integer_spin, spin
from .base import SimulationPage, db_text, fmt


class PCMPage(SimulationPage):
    accent = VIOLET

    def __init__(self, parent: QWidget | None = None):
        self.csv_signal: CsvSignal | None = None
        super().__init__(
            "Modulación por pulsos codificados · PCM",
            "Muestreo, cuantificación uniforme, codificación binaria y transmisión digital. "
            "Compara la señal original con la reconstruida y observa el umbral del enlace.",
            plot_rows=3,
            plot_cols=2,
            figsize=(10.4, 7.8),
            parent=parent,
        )

    def build_metrics(self) -> None:
        self.add_metric("sqnr", "SQNR reconstrucción", VIOLET, "señal / error total")
        self.add_metric("quant", "SQNR cuantificación", CYAN, "6.02n + 1.76 dB")
        self.add_metric("ber", "BER del enlace", GREEN, "errores / bits")
        self.add_metric("rate", "Tasa de bits", AMBER, "fs · n")
        self.add_metric("ebn0", "Eb/N0 efectiva", MAGENTA, "nominal − atenuación")

    def build_controls(self) -> None:
        sig = QGroupBox("SEÑAL ANALÓGICA")
        form = QFormLayout(sig)
        form.setContentsMargins(10, 14, 10, 10)
        form.setHorizontalSpacing(8)
        form.setVerticalSpacing(6)
        self.waveform = QComboBox()
        for key, label in WAVEFORM_LABELS.items():
            self.waveform.addItem(label, key)
        self.waveform.currentIndexChanged.connect(self._sync_waveform)
        self.fm = spin(10.0, 20000.0, 1000.0, decimals=1, step=50.0, suffix="Hz")
        self.phase = spin(-180.0, 180.0, 0.0, decimals=0, step=15.0, suffix="°")
        self.duty = spin(0.05, 0.95, 0.5, decimals=2, step=0.05)
        self.f_end = spin(20.0, 50000.0, 3000.0, decimals=0, step=100.0, suffix="Hz")
        self.formula = QLineEdit("0.8*sin(2*pi*1000*t)")
        self.formula.setToolTip("Fórmula segura en función de t (segundos)")
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
        self.amplitude = spin(0.05, 1.0, 0.8, decimals=2, step=0.05, suffix="V")
        form.addRow(field_label("Forma de onda"), self.waveform)
        form.addRow(field_label("Frecuencia fm"), self.fm)
        form.addRow(field_label("Fase"), self.phase)
        form.addRow(field_label("Ciclo de trabajo"), self.duty)
        form.addRow(field_label("Chirp f final"), self.f_end)
        form.addRow(field_label("Fórmula"), self.formula)
        form.addRow(field_label("Datos externos"), csv_row)
        form.addRow(field_label("Amplitud pico"), self.amplitude)
        self.add_control(sig)

        pcm = QGroupBox("MUESTREO Y CUANTIFICACIÓN")
        pf = QFormLayout(pcm)
        pf.setContentsMargins(10, 14, 10, 10)
        pf.setHorizontalSpacing(8)
        pf.setVerticalSpacing(6)
        self.fs_sample = spin(500.0, 192000.0, 8000.0, decimals=0, step=500.0, suffix="Hz")
        self.nbits = integer_spin(2, 16, 8, suffix="bits")
        self.duration = spin(2.0, 100.0, 20.0, decimals=1, step=1.0, suffix="ms")
        self.full_scale = spin(0.1, 2.0, 1.0, decimals=2, step=0.1, suffix="V")
        self.antialias = QCheckBox("Filtro antialias antes del muestreo")
        self.antialias.setChecked(True)
        pf.addRow(field_label("Muestreo fs"), self.fs_sample)
        pf.addRow(field_label("Bits por muestra"), self.nbits)
        pf.addRow(field_label("Duración"), self.duration)
        pf.addRow(field_label("Fondo de escala"), self.full_scale)
        pf.addRow(self.antialias)
        self.add_control(pcm)

        link = QGroupBox("ENLACE DIGITAL PCM")
        lf = QFormLayout(link)
        lf.setContentsMargins(10, 14, 10, 10)
        lf.setHorizontalSpacing(8)
        lf.setVerticalSpacing(6)
        self.scheme = QComboBox()
        self.scheme.addItem("BPSK", "BPSK")
        self.scheme.addItem("ASK / OOK", "ASK")
        self.scheme.addItem("FSK", "FSK")
        self.scheme.currentIndexChanged.connect(self._sync_carrier)
        self.fc = spin(1000.0, 1000000.0, 20000.0, decimals=0, step=1000.0, suffix="Hz")
        self.sps = integer_spin(8, 64, 16, step=4, suffix="muestras/bit")
        self.fc.valueChanged.connect(self._sync_carrier)
        self.sps.valueChanged.connect(self._sync_carrier)
        self.fs_sample.valueChanged.connect(self._sync_carrier)
        self.nbits.valueChanged.connect(self._sync_carrier)
        self.carrier_info = QLabel("—")
        self.carrier_info.setObjectName("Caption")
        self.carrier_info.setWordWrap(True)
        lf.addRow(field_label("Esquema"), self.scheme)
        lf.addRow(field_label("Portadora fc"), self.fc)
        lf.addRow(field_label("Muestras por bit"), self.sps)
        lf.addRow(self.carrier_info)
        self.add_control(link)

        self.channel = ChannelControls(
            metric="ebn0",
            default_fc=64000.0,
            default_int_freq=70000.0,
            default_target=10.0,
            amplitude=1.0,
        )
        self.add_control(self.channel)

        note = QLabel(
            "La frecuencia de muestreo debe superar 2·fm (Nyquist). La reconstrucción usa "
            "interpolación sinc; el retenedor de orden cero se muestra como referencia del "
            "convertidor D/A real. Los bordes se descartan en las métricas."
        )
        note.setObjectName("Caption")
        note.setWordWrap(True)
        self.add_control(note)
        self._sync_waveform()
        self._sync_carrier()

    def build_plots(self) -> None:
        pass

    def defaults(self) -> None:
        self.waveform.setCurrentIndex(0)
        self.fm.setValue(1000.0)
        self.phase.setValue(0.0)
        self.duty.setValue(0.5)
        self.f_end.setValue(3000.0)
        self.formula.setText("0.8*sin(2*pi*1000*t)")
        self.amplitude.setValue(0.8)
        self.fs_sample.setValue(8000.0)
        self.nbits.setValue(8)
        self.duration.setValue(20.0)
        self.full_scale.setValue(1.0)
        self.antialias.setChecked(True)
        self.scheme.setCurrentIndex(0)
        self.fc.setValue(20000.0)
        self.sps.setValue(16)
        self.channel.preset.setCurrentText("AWGN ideal")
        self.channel._apply_preset()
        self.csv_signal = None
        self.csv_label.setText("Sin archivo")
        self._sync_waveform()
        self._sync_carrier()

    # -- Utilidades ----------------------------------------------------------
    def _sync_waveform(self, *_args) -> None:
        kind = self.waveform.currentData()
        self.formula.setEnabled(kind == "formula")
        self.f_end.setEnabled(kind == "chirp")
        self.duty.setEnabled(kind in {"square", "sawtooth"})

    def _sync_carrier(self, *_args) -> None:
        rb = self.fs_sample.value() * self.nbits.value()
        fs_rf = rb * self.sps.value()
        fc = max(rb, round(self.fc.value() / rb) * rb) if rb > 0 else 0.0
        max_fc = fs_rf / 2.0
        if fc >= max_fc:
            fc = rb * max(1, int(np.floor((max_fc - 1e-9) / rb)))
        cycles = int(round(fc / rb)) if rb > 0 else 0
        self.carrier_info.setText(
            f"Rb = {rb/1e3:.1f} kbit/s · fs RF = {fs_rf/1e6:.2f} MHz<br>"
            f"fc real = {fc/1e3:.2f} kHz · {cycles} ciclo(s) por bit"
        )
        self.carrier_info.setStyleSheet(f"color:{FAINT}; font-size:10px;")
        if hasattr(self, "channel"):
            self.channel.int_freq.setValue(max(1.0, fc + 0.5 * rb))

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

    def _check_limits(self, cfg: PCMConfig) -> None:
        n_rf = cfg.duration * cfg.fs_sample * cfg.n_bits * cfg.sps
        if n_rf > 4_000_000:
            raise ValueError(
                f"El enlace generaría {n_rf/1e6:.1f} M muestras RF. Reduce duración, fs, bits o sps."
            )
        rb = cfg.fs_sample * cfg.n_bits
        fs_rf = rb * cfg.sps
        if cfg.fc >= fs_rf / 2.0:
            raise ValueError("fc debe ser menor que (fs·n·sps)/2; reduce fc o aumenta sps")
        if cfg.duration * cfg.fs_sample > 50000:
            raise ValueError("Demasiadas muestras PCM; reduce la duración o fs.")

    # -- Simulación ----------------------------------------------------------
    def make_config(self) -> PCMConfig:
        kind = self.waveform.currentData()
        if kind == "csv" and self.csv_signal is None:
            raise ValueError("Seleccionaste CSV pero no has cargado un archivo")
        formula = self.formula.text().strip() if kind == "formula" else None
        if kind == "formula" and not formula:
            raise ValueError("La fórmula personalizada está vacía")
        if self.amplitude.value() > self.full_scale.value():
            raise ValueError(
                "La amplitud supera el fondo de escala: la cuantificación recortará la señal. "
                "Aumenta el fondo de escala o reduce la amplitud."
            )
        cfg = PCMConfig(
            waveform=kind,
            fm=self.fm.value(),
            phase_deg=self.phase.value(),
            duty=self.duty.value(),
            f_end=self.f_end.value() if kind == "chirp" else None,
            formula=formula,
            csv_t=self.csv_signal.t if kind == "csv" and self.csv_signal else None,
            csv_x=self.csv_signal.x if kind == "csv" and self.csv_signal else None,
            amplitude=self.amplitude.value(),
            fs_sample=self.fs_sample.value(),
            n_bits=self.nbits.value(),
            duration=self.duration.value() / 1000.0,
            full_scale=self.full_scale.value(),
            antialias=self.antialias.isChecked(),
            scheme=self.scheme.currentData(),
            fc=self.fc.value(),
            sps=self.sps.value(),
            ebn0_db=None,
            seed=self.channel.seed.value(),
            channel=self.channel.config(),
        )
        self._check_limits(cfg)
        return cfg

    def compute(self, cfg: PCMConfig):
        result = simulate_pcm(cfg)
        bits_curve = pcm_sqnr_bits_curve(cfg)
        link_curve = pcm_sqnr_ebn0_curve(cfg)
        return {"pcm": result, "bits_curve": bits_curve, "link_curve": link_curve, "cfg": cfg}

    # -- Presentación --------------------------------------------------------
    def present(self, payload) -> None:
        res = payload["pcm"]
        bits_curve = payload["bits_curve"]
        link_curve = payload["link_curve"]
        cfg = payload["cfg"]
        met = res.metrics
        axes = self.plot.axes
        self.plot.reset_axes()

        t_ms = res.t_analog * 1e3
        keep_ms = min(cfg.duration * 1e3, 10.0)
        m = t_ms <= keep_ms
        ts_ms = res.t_s * 1e3
        ms = ts_ms <= keep_ms
        # Ventana de régimen permanente para la reconstrucción.
        edge_ms = min(cfg.duration * 1e3 * 0.35, 32.0 / cfg.fs_sample * 1e3)
        mr = (t_ms >= edge_ms) & (t_ms <= keep_ms)
        msr = (ts_ms >= edge_ms) & (ts_ms <= keep_ms)

        # 1) Muestreo ---------------------------------------------------------
        ax = axes[0]
        ax.plot(t_ms[m], res.x_analog[m], color=CHART_COLORS["message"], lw=1.2, label="analógica")
        ax.plot(ts_ms[ms], res.x_s[ms], "o", color=CHART_COLORS["tx"], ms=3.4, label="muestras")
        ax.vlines(ts_ms[ms], res.x_s[ms], res.xq[ms], color=CHART_COLORS["env"], lw=0.8, alpha=0.7, label="error de cuantización")
        ax.set_title("Muestreo y cuantificación")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("amplitud (V)")
        ax.legend(loc="upper right", fontsize=7.5)

        # 2) Error de cuantización -------------------------------------------
        ax = axes[1]
        ax.plot(ts_ms[ms], res.qerr[ms] * 1e3, color=CHART_COLORS["env"], lw=0.9, label="xq − x")
        ax.axhline(+res.q / 2 * 1e3, color=FAINT, lw=0.8, ls="--", label="±q/2")
        ax.axhline(-res.q / 2 * 1e3, color=FAINT, lw=0.8, ls="--")
        ax.axhline(0, color=FAINT, lw=0.5)
        ax.set_title(f"Error de cuantificación · q={res.q*1e3:.3f} mV")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("error (mV)")
        ax.legend(loc="upper right", fontsize=7.5)

        # 3) Reconstrucción ---------------------------------------------------
        ax = axes[2]
        ax.plot(t_ms[mr], res.x_analog[mr], color=CHART_COLORS["message"], lw=1.4, label="original")
        ax.plot(t_ms[mr], res.x_zoh[mr], color=FAINT, lw=1.0, alpha=0.8, label="ZOH")
        ax.plot(t_ms[mr], res.x_rec[mr], color=CHART_COLORS["env"], lw=1.3, label="reconstruida (sinc)")
        ax.plot(ts_ms[msr], res.xq[msr], "o", color=CHART_COLORS["tx"], ms=2.8, alpha=0.9, label="niveles")
        ax.set_title("Reconstrucción")
        ax.set_xlabel("tiempo (ms)")
        ax.set_ylabel("amplitud (V)")
        ax.legend(loc="upper right", fontsize=7.5)

        # 4) Espectro y aliasing ---------------------------------------------
        ax = axes[3]
        fa = res.spectrum_analog_f / 1e3
        fs_ = res.spectrum_sampled_f / 1e3
        ax.plot(fa, res.spectrum_analog_db, color=CHART_COLORS["message"], lw=1.0, label="analógica")
        ax.plot(fs_, res.spectrum_sampled_db, color=CHART_COLORS["tx"], lw=1.0, alpha=0.9, label="muestreada")
        ax.axvline(cfg.fm / 1e3, color=AMBER, lw=0.8, ls=":", label="fm")
        ax.axvline(met["nyquist_hz"] / 1e3, color=RED, lw=0.9, ls="--", label="Nyquist")
        ax.set_xlim(0, min(max(2.2 * cfg.fm, 1.3 * met["nyquist_hz"]) / 1e3, cfg.fs_sample / 2e3))
        ax.set_ylim(-90, 3)
        ax.set_title("Espectro · muestreo y aliasing")
        ax.set_xlabel("frecuencia (kHz)")
        ax.set_ylabel("magnitud (dB)")
        ax.legend(loc="upper right", fontsize=7.5)
        if met["alias"]:
            ax.text(0.02, 0.06, "¡fm supera Nyquist: alias!", transform=ax.transAxes, color=RED, fontsize=9, fontweight="bold")

        # 5) SQNR vs bits -----------------------------------------------------
        ax = axes[4]
        nb = bits_curve["n_bits"]
        ax.plot(nb, bits_curve["sqnr_theory_db"], color=CHART_COLORS["theory"], lw=1.3, label="teoría 6.02n+1.76")
        ax.plot(nb, bits_curve["sqnr_quant_db"], color=CHART_COLORS["tx"], marker="o", ms=3, lw=1.1, label="cuantificación")
        ax.plot(nb, bits_curve["sqnr_rec_db"], color=CHART_COLORS["env"], marker="s", ms=3, lw=1.0, label="reconstrucción")
        ax.scatter([cfg.n_bits], [res.sqnr_db], s=56, color=CHART_COLORS["accent"], edgecolor="white", zorder=6, label="actual")
        ax.set_title("SQNR frente al número de bits")
        ax.set_xlabel("bits por muestra")
        ax.set_ylabel("SQNR (dB)")
        ax.legend(loc="upper left", fontsize=7.5)

        # 6) SQNR vs Eb/N0 ----------------------------------------------------
        ax = axes[5]
        e = link_curve["ebn0_db"]
        ax.plot(e, link_curve["sqnr_db"], color=CHART_COLORS["env"], marker="o", ms=3, lw=1.2, label="reconstrucción")
        ax.axhline(res.sqnr_quant_db, color=CHART_COLORS["tx"], lw=0.9, ls="--", label="límite de cuantificación")
        ebn0_eff = res.ebn0_eff_db
        if np.isfinite(ebn0_eff):
            ax.scatter([ebn0_eff], [res.sqnr_db], s=56, color=CHART_COLORS["accent"], edgecolor="white", zorder=6, label="actual")
        ax.set_title(f"Umbral del enlace PCM · {cfg.scheme}")
        ax.set_xlabel("Eb/N0 (dB)")
        ax.set_ylabel("SQNR reconstrucción (dB)")
        ax.legend(loc="lower right", fontsize=7.5)

        self.plot.canvas.draw_idle()

        # Métricas -----------------------------------------------------------
        qcolor = GREEN if res.sqnr_db >= res.sqnr_quant_db - 3 else (AMBER if res.sqnr_db > 15 else RED)
        self.metrics["sqnr"].set(
            f"{res.sqnr_db:.1f} dB",
            f"teoría {res.metrics['sqnr_theory_db']:.1f} dB",
            qcolor,
        )
        self.metrics["quant"].set(f"{res.sqnr_quant_db:.1f} dB", f"q={res.q*1e3:.2f} mV · {met['levels']} niveles", CYAN)
        ber = res.ber
        bcolor = GREEN if ber == 0 else (AMBER if ber < 1e-2 else RED)
        self.metrics["ber"].set(f"{ber:.2e}", f"{res.errors} / {res.nbits_total} bits", bcolor)
        self.metrics["rate"].set(
            f"{met['bit_rate_bps']/1e3:.1f} kbit/s",
            f"{met['samples']} muestras · {cfg.scheme}",
            AMBER,
        )
        self.metrics["ebn0"].set(
            db_text(res.ebn0_eff_db),
            f"nominal {cfg.channel.ebn0_db:.1f} dB · pérdida {met['total_atten_db']:.1f} dB",
            MAGENTA,
        )

    def source_text(self, cfg: PCMConfig) -> str:
        label = WAVEFORM_LABELS.get(cfg.waveform, cfg.waveform)
        return (
            f"{label} · fm={fmt(cfg.fm, 'Hz')} · fs={fmt(cfg.fs_sample, 'Hz')} · {cfg.n_bits} bits · {cfg.scheme}"
        )

    def export_rows(self):
        res = self._result["pcm"] if isinstance(self._result, dict) else None
        if res is None:
            return ["t_analog_s"], [[]]
        return (
            ["t_analog_s", "x_analog", "x_rec", "x_zoh", "t_sample_s", "x_sample", "x_quant"],
            [res.t_analog, res.x_analog, res.x_rec, res.x_zoh, res.t_s, res.x_s, res.xq],
        )
