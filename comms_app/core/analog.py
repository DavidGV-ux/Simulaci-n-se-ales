"""Modulación y demodulación de amplitud (AM) con detectores de envolvente
y coherente. Incluye el modelo de potencia del anexo y el efecto de
sobremodulación.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import hilbert

from .channel import ChannelConfig, ChannelReport, apply_channel
from .signals import (
    generate_waveform,
    lowpass,
    mse,
    correlation,
    spectrum,
    signal_bandwidth,
    time_vector,
)


@dataclass
class AMConfig:
    waveform: str = "sine"
    fm: float = 1000.0
    phase_deg: float = 0.0
    duty: float = 0.5
    f_end: float | None = None
    formula: str | None = None
    csv_t: np.ndarray | None = None
    csv_x: np.ndarray | None = None
    Vp: float = 1.0
    fc: float = 20000.0
    m: float = 0.8
    fs: float = 400000.0
    duration: float = 0.005
    channel: ChannelConfig = field(default_factory=ChannelConfig)


@dataclass
class AMResult:
    t: np.ndarray
    message: np.ndarray
    tx: np.ndarray
    rx: np.ndarray
    clean: np.ndarray
    env: np.ndarray
    coh: np.ndarray
    env_err: np.ndarray
    coh_err: np.ndarray
    spectrum_tx_f: np.ndarray
    spectrum_tx_db: np.ndarray
    spectrum_rx_f: np.ndarray
    spectrum_rx_db: np.ndarray
    report: ChannelReport
    metrics: dict


def am_power(m: float) -> tuple[float, float]:
    """Devuelve (Pt/Pc, fracción de potencia en la portadora)."""
    ratio = 1.0 + 0.5 * float(m) ** 2
    return ratio, 1.0 / ratio


def am_noise_bandwidth_hz(cfg: AMConfig) -> float:
    """Ancho de banda de ruido del receptor AM: 2·B_m efectivo (mín. 2·fm).

    Para una moduladora senoidal B_m = fm; para señales con varios componentes
    (cuadrada, chirp, dos tonos, CSV, fórmula) se usa el ancho efectivo del
    mensaje calculado desde el espectro.
    """
    from .signals import generate_waveform, signal_bandwidth, time_vector

    t = time_vector(cfg.fs, cfg.duration)
    msg = generate_waveform(
        cfg.waveform,
        t,
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
    msg_bw = signal_bandwidth(msg, cfg.fs)
    return max(2.0 * msg_bw, 2.0 * cfg.fm, 1.0)


def _bandpass_fft(x: np.ndarray, fs: float, center: float, width: float) -> np.ndarray:
    """Filtro de RF ideal (brick-wall) alrededor de la portadora.

    Un receptor real coloca un filtro de frecuencia intermedia antes del
    detector. Sin él, el detector de envolvente ve todo el ruido blanco del
    ancho de banda de simulación y su comportamiento deja de representar el
    enlace de RF que se quiere estudiar.
    """
    x = np.asarray(x, dtype=float)
    width = float(max(width, 1e-6))
    lo = max(0.0, center - 0.5 * width)
    hi = min(0.5 * fs, center + 0.5 * width)
    if hi <= lo:
        return x.copy()
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.size, d=1.0 / fs)
    spec[(f < lo) | (f > hi)] = 0.0
    return np.fft.irfft(spec, n=x.size)


def simulate_am(cfg: AMConfig) -> AMResult:
    if cfg.fs <= 2.0 * cfg.fc:
        raise ValueError("fs debe ser mayor que 2·fc para representar la portadora")
    if cfg.fc <= cfg.fm:
        raise ValueError("fc debe ser mayor que fm")
    if cfg.m < 0:
        raise ValueError("El índice de modulación m no puede ser negativo")

    t = time_vector(cfg.fs, cfg.duration)
    msg = generate_waveform(
        cfg.waveform,
        t,
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
    carrier = np.sin(2.0 * np.pi * cfg.fc * t)
    tx = cfg.Vp * (1.0 + cfg.m * msg) * carrier

    # La SNR nominal de AM se define en la banda RF de la señal (2·B_m).
    am_bw = am_noise_bandwidth_hz(cfg)
    cfg.channel.noise_bandwidth_hz = am_bw
    rx, report, clean = apply_channel(
        tx,
        cfg.fs,
        cfg.channel,
        t=t,
        rng=np.random.default_rng(cfg.channel.seed + 23),
    )

    # Filtro de RF del receptor: conserva las bandas laterales de la señal y
    # limita el ruido que entra al detector. Se usa un ancho algo mayor que
    # 2·fm para no recortar los bordes de las bandas laterales.
    b_if = min(max(1.2 * am_bw, 1.0), max(0.1 * cfg.fm, 0.96 * cfg.fs - 2.0 * cfg.fc))
    rx_if = _bandpass_fft(rx, cfg.fs, cfg.fc, b_if)

    # Detector de envolvente: |analítica| + pasa-bajos.
    env_raw = np.abs(hilbert(rx_if))
    cutoff = min(0.45 * cfg.fs, max(2.5 * cfg.fm, 50.0))
    env_lp = lowpass(env_raw, cfg.fs, cutoff, order=4)
    env = env_lp - np.mean(env_lp)
    denom_env = cfg.m * cfg.Vp * report.gain_linear
    if abs(denom_env) > 1e-12:
        env = env / denom_env

    # Detector coherente: multiplicación por la portadora local y pasa-bajos.
    coh_raw = 2.0 * rx_if * np.sin(2.0 * np.pi * cfg.fc * t)
    coh_lp = lowpass(coh_raw, cfg.fs, cutoff, order=4)
    coh = coh_lp - np.mean(coh_lp)
    denom_coh = cfg.m * cfg.Vp * report.gain_linear
    if abs(denom_coh) > 1e-12:
        coh = coh / denom_coh

    # Se descartan dos períodos de la moduladora en cada extremo para evitar
    # los transitorios de los filtros (especialmente en registros cortos).
    trim = max(5, min(len(t) // 4, int(round(2.0 * cfg.fs / max(cfg.fm, 1.0)))))
    env_err = env - msg
    coh_err = coh - msg
    ptot_ratio, carrier_fraction = am_power(cfg.m)
    f_tx, s_tx = spectrum(tx, cfg.fs)
    f_rx, s_rx = spectrum(rx, cfg.fs)

    metrics = {
        "m": float(cfg.m),
        "m_percent": float(100.0 * cfg.m),
        "overmodulation": bool(cfg.m > 1.0),
        "pt_pc": float(ptot_ratio),
        "carrier_fraction": float(carrier_fraction),
        "sideband_fraction": float(1.0 - carrier_fraction),
        "mse_env": float(mse(msg, env, trim)),
        "mse_coh": float(mse(msg, coh, trim)),
        "corr_env": float(correlation(msg, env, trim)),
        "corr_coh": float(correlation(msg, coh, trim)),
        "snr_eff_db": float(report.snr_band_db),
        "snr_total_db": float(report.snr_eff_db),
        "noise_bandwidth_hz": float(report.noise_bandwidth_hz),
        "if_bandwidth_hz": float(b_if),
        "path_loss_db": float(report.path_loss_db),
        "total_atten_db": float(report.total_atten_db),
        "bw_tx_hz": float(signal_bandwidth(tx, cfg.fs)),
        "bw_rx_hz": float(signal_bandwidth(rx, cfg.fs)),
        "vm": float(cfg.m * cfg.Vp),
        "pt_dbm": float(10.0 * np.log10(max(cfg.Vp**2 / 2.0, 1e-30) * ptot_ratio / 1e-3)),
    }
    return AMResult(
        t=t,
        message=msg,
        tx=tx,
        rx=rx,
        clean=clean,
        env=env,
        coh=coh,
        env_err=env_err,
        coh_err=coh_err,
        spectrum_tx_f=f_tx,
        spectrum_tx_db=s_tx,
        spectrum_rx_f=f_rx,
        spectrum_rx_db=s_rx,
        report=report,
        metrics=metrics,
    )
