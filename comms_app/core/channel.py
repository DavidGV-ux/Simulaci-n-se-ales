"""Modelo de canal: atenuación, ruido, multitrayecto e interferencia.

La convención es importante: ``snr_db`` y ``ebn0_db`` se interpretan como
valores *nominales de referencia* medidos sobre la señal transmitida. La
atenuación se aplica a la señal, pero no al ruido; por eso la relación
señal/ruido efectiva en recepción disminuye con la pérdida de trayecto. Así
se puede observar el efecto real de alejar el receptor o subir la frecuencia.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import hilbert


@dataclass
class ChannelConfig:
    distance_km: float = 1.0
    frequency_mhz: float = 2450.0
    extra_atten_db: float = 0.0
    snr_db: float | None = None
    ebn0_db: float | None = None
    eb: float | None = None
    # Si se especifica, la SNR nominal se interpreta dentro de esta banda.
    # El ruido blanco se genera sobre todo el ancho fs/2 y se escala para que
    # la potencia de ruido dentro de la banda sea la solicitada.
    noise_bandwidth_hz: float | None = None
    multipath: bool = False
    mp_delay_us: float = 1.0
    mp_gain_db: float = -6.0
    mp_phase_deg: float = 180.0
    interference: bool = False
    int_freq_hz: float = 0.0
    int_amp_db: float = -20.0
    freq_offset_hz: float = 0.0
    phase_noise_rms: float = 0.0
    gain_step_db: float = 0.0
    gain_step_at: float = 0.5
    clip_level: float | None = None
    seed: int = 1


@dataclass
class ChannelReport:
    path_loss_db: float = 0.0
    total_atten_db: float = 0.0
    gain_linear: float = 1.0
    noise_power: float = 0.0
    snr_eff_db: float = float("inf")
    snr_band_db: float = float("inf")
    ebn0_eff_db: float = float("inf")
    n0: float = 0.0
    noise_bandwidth_hz: float = 0.0


def fsl_db(distance_km: float, frequency_mhz: float) -> float:
    """Pérdida de espacio libre (Friis en dB).

    FSL = 32.45 + 20 log10(d_km) + 20 log10(f_MHz)
    """
    if distance_km <= 0 or frequency_mhz <= 0:
        return 0.0
    return float(32.45 + 20.0 * np.log10(distance_km) + 20.0 * np.log10(frequency_mhz))


def _phase_shift_real(x: np.ndarray, phase_rad: float) -> np.ndarray:
    """Desfase de una señal pasabanda usando su señal analítica."""
    if abs(np.sin(phase_rad)) < 1e-12:
        return np.cos(phase_rad) * x
    z = hilbert(x)
    return np.real(z * np.exp(1j * phase_rad))


def _frequency_shift(x: np.ndarray, fs: float, df_hz: float) -> np.ndarray:
    """Desplaza en frecuencia una señal real pasabanda."""
    if abs(df_hz) < 1e-12 or x.size < 8:
        return x
    t = np.arange(x.size, dtype=float) / fs
    z = hilbert(x)
    return np.real(z * np.exp(1j * 2.0 * np.pi * df_hz * t))


def apply_channel(
    x: np.ndarray,
    fs: float,
    cfg: ChannelConfig | None = None,
    *,
    t: np.ndarray | None = None,
    rng: np.random.Generator | None = None,
) -> tuple[np.ndarray, ChannelReport, np.ndarray]:
    """Aplica el canal y devuelve (rx, informe, señal limpia sin ruido).

    La señal limpia incluye atenuación, multitrayecto, interferencia y
    desfases, pero no el ruido blanco. Es útil para separar en las gráficas
    lo que hizo el canal de lo que hizo el ruido.
    """
    cfg = cfg or ChannelConfig()
    x = np.asarray(x, dtype=float)
    if x.size < 2:
        raise ValueError("La señal debe tener al menos dos muestras")
    if fs <= 0:
        raise ValueError("fs debe ser positivo")
    if t is None:
        t = np.arange(x.size, dtype=float) / fs
    else:
        t = np.asarray(t, dtype=float)
        if t.size != x.size:
            raise ValueError("t y x deben tener el mismo tamaño")
    rng = rng or np.random.default_rng(cfg.seed)

    path_loss = fsl_db(cfg.distance_km, cfg.frequency_mhz)
    total_atten = float(path_loss + max(0.0, cfg.extra_atten_db))
    gain = float(10.0 ** (-total_atten / 20.0))
    y = gain * x

    # Multitrayecto de dos rayos: directo + eco con retardo y fase.
    if cfg.multipath and cfg.mp_delay_us > 0:
        delay = int(round(cfg.mp_delay_us * 1e-6 * fs))
        if 0 < delay < x.size:
            echo = np.concatenate([np.zeros(delay), x[:-delay]])
            echo = _phase_shift_real(echo, np.deg2rad(cfg.mp_phase_deg))
            y = y + gain * (10.0 ** (cfg.mp_gain_db / 20.0)) * echo

    # Cambio repentino de ganancia (AGC, desvanecimiento lento, etc.).
    if abs(cfg.gain_step_db) > 1e-9:
        idx = int(np.clip(cfg.gain_step_at, 0.0, 1.0) * x.size)
        step = 10.0 ** (cfg.gain_step_db / 20.0)
        y = y.copy()
        y[idx:] *= step

    if abs(cfg.freq_offset_hz) > 1e-9:
        y = _frequency_shift(y, fs, cfg.freq_offset_hz)

    if cfg.phase_noise_rms > 0:
        phi = rng.normal(0.0, cfg.phase_noise_rms, y.size)
        y = np.real(hilbert(y) * np.exp(1j * phi))

    if cfg.interference and cfg.int_freq_hz > 0:
        # Amplitud de interferencia relativa a la señal de referencia.
        ref_rms = float(np.sqrt(np.mean(x**2))) or 1.0
        amp = ref_rms * 10.0 ** (cfg.int_amp_db / 20.0)
        y = y + amp * np.cos(2.0 * np.pi * cfg.int_freq_hz * t + 0.37)

    if cfg.clip_level is not None and cfg.clip_level > 0:
        y = np.clip(y, -cfg.clip_level, cfg.clip_level)

    clean = y.copy()
    p_noise = 0.0
    n0 = 0.0
    bw_noise = float(cfg.noise_bandwidth_hz) if cfg.noise_bandwidth_hz and cfg.noise_bandwidth_hz > 0 else fs / 2.0
    bw_noise = float(min(bw_noise, fs / 2.0))
    if cfg.snr_db is not None:
        p_ref = float(np.mean(x**2))
        # La SNR nominal se refiere a la banda de ruido declarada. El ruido
        # blanco se reparte sobre fs/2, por lo que su potencia total se escala
        # por (fs/2)/B para que dentro de B valga p_ref/SNR.
        p_noise = (p_ref / (10.0 ** (cfg.snr_db / 10.0))) * (fs / 2.0) / max(bw_noise, 1e-9)
        y = y + rng.normal(0.0, np.sqrt(max(p_noise, 0.0)), y.size)
    elif cfg.ebn0_db is not None and cfg.eb is not None and cfg.eb > 0:
        n0 = float(cfg.eb / (10.0 ** (cfg.ebn0_db / 10.0)))
        p_noise = n0 * fs / 2.0
        y = y + rng.normal(0.0, np.sqrt(max(p_noise, 0.0)), y.size)

    p_clean = float(np.mean(clean**2))
    snr_eff = float(10.0 * np.log10(max(p_clean, 1e-30) / max(p_noise, 1e-30))) if p_noise > 0 else float("inf")
    snr_band = (
        float(10.0 * np.log10(max(p_clean, 1e-30) / max(p_noise, 1e-30) * (fs / 2.0) / max(bw_noise, 1e-9)))
        if p_noise > 0
        else float("inf")
    )
    ebn0_eff = float("inf")
    if n0 > 0 and cfg.eb is not None:
        # Escala media de energía del canal lineal (sin interferencia).
        linear = gain * x
        if cfg.multipath and cfg.mp_delay_us > 0:
            delay = int(round(cfg.mp_delay_us * 1e-6 * fs))
            if 0 < delay < x.size:
                echo = np.concatenate([np.zeros(delay), x[:-delay]])
                echo = _phase_shift_real(echo, np.deg2rad(cfg.mp_phase_deg))
                linear = linear + gain * (10.0 ** (cfg.mp_gain_db / 20.0)) * echo
        if abs(cfg.gain_step_db) > 1e-9:
            idx = int(np.clip(cfg.gain_step_at, 0.0, 1.0) * x.size)
            linear = linear.copy()
            linear[idx:] *= 10.0 ** (cfg.gain_step_db / 20.0)
        scale = float(np.mean(linear**2) / max(np.mean(x**2), 1e-30))
        eb_rx = float(cfg.eb * scale)
        ebn0_eff = float(10.0 * np.log10(max(eb_rx, 1e-30) / max(n0, 1e-30)))

    report = ChannelReport(
        path_loss_db=float(path_loss),
        total_atten_db=float(total_atten),
        gain_linear=gain,
        noise_power=float(p_noise),
        snr_eff_db=snr_eff,
        snr_band_db=snr_band,
        ebn0_eff_db=ebn0_eff,
        n0=float(n0),
        noise_bandwidth_hz=bw_noise,
    )
    return y, report, clean
