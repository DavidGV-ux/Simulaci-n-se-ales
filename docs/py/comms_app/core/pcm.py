"""PCM: muestreo, cuantificación uniforme, codificación y transmisión
digital. Se puede elegir ASK, FSK o BPSK para el enlace PCM y comparar la
reconstrucción con la señal original.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .channel import ChannelConfig, ChannelReport, apply_channel
from .digital import band_snr_db, bit_windows, snap_carrier
from .signals import (
    generate_waveform,
    lowpass,
    pcm_decode,
    pcm_encode,
    quantize_uniform,
    sample_signal,
    sinc_interp,
    spectrum,
    time_vector,
    zero_order_hold,
)


@dataclass
class PCMConfig:
    waveform: str = "sine"
    fm: float = 1000.0
    phase_deg: float = 0.0
    duty: float = 0.5
    f_end: float | None = None
    formula: str | None = None
    csv_t: np.ndarray | None = None
    csv_x: np.ndarray | None = None
    amplitude: float = 0.8
    fs_sample: float = 8000.0
    n_bits: int = 8
    duration: float = 0.01
    full_scale: float = 1.0
    antialias: bool = True
    scheme: str = "BPSK"
    fc: float = 20000.0
    sps: int = 16
    ebn0_db: float | None = 12.0
    seed: int = 1
    channel: ChannelConfig = field(default_factory=ChannelConfig)


@dataclass
class PCMResult:
    t_analog: np.ndarray
    x_analog: np.ndarray
    x_analog_f: np.ndarray
    t_s: np.ndarray
    x_s: np.ndarray
    xq: np.ndarray
    x_rec: np.ndarray
    x_zoh: np.ndarray
    qerr: np.ndarray
    q: float
    idx: np.ndarray
    bits: np.ndarray
    detected: np.ndarray
    ber: float
    errors: int
    nbits_total: int
    sqnr_db: float
    sqnr_quant_db: float
    sqnr_theory_db: float
    report: ChannelReport
    ebn0_eff_db: float
    snr_eff_db: float
    spectrum_analog_f: np.ndarray
    spectrum_analog_db: np.ndarray
    spectrum_sampled_f: np.ndarray
    spectrum_sampled_db: np.ndarray
    t_rf: np.ndarray
    tx: np.ndarray
    rx: np.ndarray
    clean: np.ndarray
    fs_rf: float
    fc: float
    fc_cycles: int
    spectrum_rf_f: np.ndarray
    spectrum_rf_db: np.ndarray
    metrics: dict
    bitstring: str


def _bits_to_text(bits: np.ndarray, max_samples: int = 8) -> str:
    rows = []
    for row in np.asarray(bits)[:max_samples]:
        rows.append("".join(str(int(b)) for b in row))
    return "  ".join(rows)


def simulate_pcm(cfg: PCMConfig) -> PCMResult:
    n_bits = int(cfg.n_bits)
    if not 2 <= n_bits <= 16:
        raise ValueError("n_bits debe estar entre 2 y 16")
    if cfg.fs_sample <= 0:
        raise ValueError("fs_sample debe ser positivo")
    if cfg.duration <= 0:
        raise ValueError("duration debe ser positivo")
    if cfg.fc <= 0:
        raise ValueError("fc debe ser positivo")

    # Señal analógica en alta resolución para poder visualizar el muestreo.
    fs_analog = float(max(40.0 * cfg.fm, 12.0 * cfg.fs_sample, 50000.0))
    fs_analog = min(fs_analog, 4.0e6)
    t_analog = time_vector(fs_analog, cfg.duration)
    x_analog = cfg.amplitude * generate_waveform(
        cfg.waveform,
        t_analog,
        amplitude=1.0,
        frequency=cfg.fm,
        phase_deg=cfg.phase_deg,
        duty=cfg.duty,
        f_end=cfg.f_end,
        formula=cfg.formula,
        csv_t=cfg.csv_t,
        csv_x=cfg.csv_x,
        normalize=True,
        remove_dc=True,
    )

    if cfg.antialias and cfg.fs_sample < fs_analog:
        # Filtro antialias: corte por debajo de Nyquist (fs_sample/2)
        # para atenuar componentes que causarían aliasing.
        x_analog_f = lowpass(x_analog, fs_analog, 0.45 * cfg.fs_sample, order=6)
    else:
        x_analog_f = x_analog

    t_s, x_s = sample_signal(x_analog_f, t_analog, cfg.fs_sample, cfg.duration)
    xq, idx, q, qerr = quantize_uniform(x_s, n_bits, cfg.full_scale)
    bits, idx2, xq2, q2 = pcm_encode(x_s, n_bits, cfg.full_scale)
    n_samples = bits.shape[0]
    bits_flat = bits.reshape(-1)

    rb = cfg.fs_sample * n_bits
    sps = int(cfg.sps)
    fs_rf = rb * sps
    if cfg.fc >= fs_rf / 2.0:
        raise ValueError("fc debe ser menor que fs_rf/2; reduce fc o aumenta sps")
    fc, fc_cycles = snap_carrier(cfg.fc, rb, fs_rf)
    tb = 1.0 / rb
    t_rf = np.arange(bits_flat.size * sps, dtype=float) / fs_rf
    carrier = np.cos(2.0 * np.pi * fc * t_rf)
    scheme = cfg.scheme.upper()

    if scheme == "ASK":
        tx = np.repeat(bits_flat.astype(float), sps) * carrier
        eb = tb / 4.0
    elif scheme == "BPSK":
        tx = np.repeat(2.0 * bits_flat.astype(float) - 1.0, sps) * carrier
        eb = tb / 2.0
    elif scheme == "FSK":
        df = 0.5 * rb
        f0, f1 = max(1.0, fc - df), fc + df
        tbit = np.arange(sps, dtype=float) / fs_rf
        tone0 = np.cos(2.0 * np.pi * f0 * tbit)
        tone1 = np.cos(2.0 * np.pi * f1 * tbit)
        tx = np.where(bits_flat[:, None] == 1, tone1, tone0).ravel()
        eb = tb / 2.0
    else:
        raise ValueError("Esquema PCM desconocido; usa ASK, FSK o BPSK")

    cfg.channel.eb = eb
    if cfg.ebn0_db is not None:
        cfg.channel.ebn0_db = cfg.ebn0_db
        cfg.channel.snr_db = None
    rx, report, clean = apply_channel(
        tx,
        fs_rf,
        cfg.channel,
        t=t_rf,
        rng=np.random.default_rng(cfg.seed + 31),
    )

    # Demodulación de bits.
    win = bit_windows(rx, bits_flat.size, sps, 0.0)
    if scheme == "ASK":
        ref = np.cos(2.0 * np.pi * fc * t_rf)
        ref_win = bit_windows(ref, bits_flat.size, sps, 0.0)
        corr = np.sum(win * ref_win, axis=1) / fs_rf
        e1 = float(np.mean(np.sum(ref_win**2, axis=1) / fs_rf))
        detected = (corr > 0.5 * e1 * report.gain_linear).astype(np.uint8)
    elif scheme == "BPSK":
        ref = np.cos(2.0 * np.pi * fc * t_rf)
        ref_win = bit_windows(ref, bits_flat.size, sps, 0.0)
        corr = np.sum(win * ref_win, axis=1) / fs_rf
        detected = (corr > 0.0).astype(np.uint8)
    else:
        df = 0.5 * rb
        f0, f1 = max(1.0, fc - df), fc + df
        tl = np.arange(sps, dtype=float) / fs_rf
        c0, s0 = np.cos(2.0 * np.pi * f0 * tl), np.sin(2.0 * np.pi * f0 * tl)
        c1, s1 = np.cos(2.0 * np.pi * f1 * tl), np.sin(2.0 * np.pi * f1 * tl)
        e0 = (win @ c0) ** 2 + (win @ s0) ** 2
        e1v = (win @ c1) ** 2 + (win @ s1) ** 2
        detected = (e1v > e0).astype(np.uint8)

    errors = int(np.sum(detected != bits_flat))
    ber = errors / max(bits_flat.size, 1)
    bits_rx = detected.reshape(n_samples, n_bits)
    xq_rx, idx_rx, _ = pcm_decode(bits_rx, n_bits, cfg.full_scale)
    # Filtro de reconstrucción ideal (sinc ventaneada). El retenedor de orden
    # cero se conserva aparte como referencia visual del convertidor D/A real.
    zoh = zero_order_hold(xq_rx, t_s, t_analog)
    x_rec = sinc_interp(xq_rx, t_s, t_analog, half=24)
    # El filtro sinc es no causal y usa 24 muestras a cada lado; se descartan
    # los transitorios de borde para medir la fidelidad en régimen permanente.
    trim = max(5, min(len(t_analog) // 4, int(round(32.0 * fs_analog / cfg.fs_sample))))
    err_rec = x_analog - x_rec
    sqnr = float(10.0 * np.log10(max(np.mean(x_analog[trim:-trim] ** 2), 1e-30) / max(np.mean(err_rec[trim:-trim] ** 2), 1e-30)))
    err_q = xq - x_s
    sqnr_q = float(10.0 * np.log10(max(np.mean(x_s**2), 1e-30) / max(np.mean(err_q**2), 1e-30)))
    # Para una senoide de amplitud A y cuantificación uniforme de n bits.
    sqnr_theory = float(6.02 * n_bits + 1.76 + 20.0 * np.log10(max(cfg.amplitude, 1e-9)))

    f_a, s_a = spectrum(x_analog_f, fs_analog)
    f_s, s_s = spectrum(x_s, cfg.fs_sample)
    f_rf, s_rf = spectrum(tx, fs_rf)
    nyquist = 0.5 * cfg.fs_sample
    alias = bool(cfg.fm > nyquist * 1.02)
    bandwidth_hz = (2.0 * (0.5 * rb + rb)) if scheme == "FSK" else (2.0 * rb)
    metrics = {
        "fs_sample": float(cfg.fs_sample),
        "nyquist_hz": float(nyquist),
        "n_bits": int(n_bits),
        "levels": int(2**n_bits),
        "q": float(q),
        "bit_rate_bps": float(rb),
        "symbol_rate_bps": float(rb),
        "fc_hz": float(fc),
        "fc_cycles": int(fc_cycles),
        "fs_rf": float(fs_rf),
        "samples": int(n_samples),
        "ber": float(ber),
        "errors": int(errors),
        "sqnr_db": float(sqnr),
        "sqnr_quant_db": float(sqnr_q),
        "sqnr_theory_db": float(sqnr_theory),
        "alias": alias,
        "antialias": bool(cfg.antialias),
        "scheme": scheme,
        "ebn0_eff_db": float(report.ebn0_eff_db),
        "snr_eff_db": float(report.snr_eff_db),
        "path_loss_db": float(report.path_loss_db),
        "total_atten_db": float(report.total_atten_db),
        "bits_per_sample": int(n_bits),
    }
    return PCMResult(
        t_analog=t_analog,
        x_analog=x_analog,
        x_analog_f=x_analog_f,
        t_s=t_s,
        x_s=x_s,
        xq=xq,
        x_rec=x_rec,
        x_zoh=zoh,
        qerr=qerr,
        q=float(q),
        idx=idx,
        bits=bits,
        detected=detected,
        ber=float(ber),
        errors=errors,
        nbits_total=int(bits_flat.size),
        sqnr_db=float(sqnr),
        sqnr_quant_db=float(sqnr_q),
        sqnr_theory_db=float(sqnr_theory),
        report=report,
        ebn0_eff_db=float(report.ebn0_eff_db),
        snr_eff_db=float(report.snr_eff_db),
        spectrum_analog_f=f_a,
        spectrum_analog_db=s_a,
        spectrum_sampled_f=f_s,
        spectrum_sampled_db=s_s,
        t_rf=t_rf,
        tx=tx,
        rx=rx,
        clean=clean,
        fs_rf=fs_rf,
        fc=float(fc),
        fc_cycles=int(fc_cycles),
        spectrum_rf_f=f_rf,
        spectrum_rf_db=s_rf,
        metrics=metrics,
        bitstring=_bits_to_text(bits, 8),
    )
