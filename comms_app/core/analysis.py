"""Curvas de barrido para la interfaz gráfica y los informes.

Las curvas se calculan sobre un canal AWGN limpio (sin multitrayecto,
interferencia ni desvanecimiento) para comparar la implementación con la
teoría. El punto de operación actual se dibuja aparte, de modo que cualquier
degradación por factores externos se hace evidente.
"""

from __future__ import annotations

import copy
from typing import Sequence

import numpy as np

from .analog import AMConfig, am_noise_bandwidth_hz, simulate_am
from .channel import ChannelConfig
from .digital import (
    ASKConfig,
    BPSKConfig,
    FSKConfig,
    ber_theory,
    simulate_ask,
    simulate_bpsk,
    simulate_fsk,
)
from .pcm import PCMConfig, simulate_pcm


def _clean_channel(seed: int) -> ChannelConfig:
    return ChannelConfig(distance_km=0.0, frequency_mhz=0.0, seed=int(seed))


def am_fidelity_curve(
    cfg: AMConfig,
    snr_values: Sequence[float] | None = None,
) -> dict:
    """MSE de los detectores AM en función de la SNR nominal (AWGN)."""
    if snr_values is None:
        snr_values = np.arange(0.0, 41.0, 5.0)
    snr_values = np.asarray(snr_values, dtype=float)
    mse_env = np.empty_like(snr_values)
    mse_coh = np.empty_like(snr_values)
    for i, snr in enumerate(snr_values):
        c = copy.deepcopy(cfg)
        ch = _clean_channel(cfg.channel.seed)
        ch.snr_db = float(snr)
        ch.noise_bandwidth_hz = am_noise_bandwidth_hz(cfg)
        c.channel = ch
        r = simulate_am(c)
        mse_env[i] = r.metrics["mse_env"]
        mse_coh[i] = r.metrics["mse_coh"]
    return {"snr_db": snr_values, "mse_env": mse_env, "mse_coh": mse_coh}


def digital_ber_curve(
    cfg: ASKConfig | FSKConfig | BPSKConfig,
    scheme: str,
    ebn0_values: Sequence[float] | None = None,
    *,
    nbits_min: int = 20000,
) -> dict:
    """BER Monte Carlo en AWGN para ASK, FSK o BPSK.

    Se usa un mínimo de 20 000 bits por punto para que la curva tenga
    resolución suficiente en la región de interés. La curva teórica se
    devuelve en la misma rejilla.
    """
    if ebn0_values is None:
        ebn0_values = np.arange(0.0, 14.1, 1.0)
    ebn0_values = np.asarray(ebn0_values, dtype=float)
    scheme = scheme.upper()
    functions = {"ASK": simulate_ask, "FSK": simulate_fsk, "BPSK": simulate_bpsk}
    if scheme not in functions:
        raise ValueError(f"Esquema desconocido: {scheme}")
    measured = np.empty_like(ebn0_values)
    # Para la UI: suficiente resolución sin bloquear demasiado.
    curve_nbits = int(max(nbits_min, min(12000, int(getattr(cfg, "nbits", nbits_min)))))
    for i, ebn0 in enumerate(ebn0_values):
        c = copy.deepcopy(cfg)
        c.nbits = curve_nbits
        c.channel = _clean_channel(cfg.channel.seed)
        c.channel.ebn0_db = float(ebn0)
        r = functions[scheme](c)
        measured[i] = r.ber
    detector = str(getattr(cfg, "detector", "coherent") or "coherent").lower()
    if scheme == "ASK" and detector.startswith(("env", "non", "no")):
        # ASK/OOK con detector de envolvente/no coherente: no existe forma
        # cerrada de la BER teoria. Se usa la referencia coherente
        # (Qb = Q(sqrt(2*Eb/N0))) para dibujar la recta de comparacion.
        theory = np.asarray(ber_theory(scheme, ebn0_values, "coherent"), dtype=float)
    else:
        theory = np.asarray(ber_theory(scheme, ebn0_values, detector), dtype=float)
    return {
        "ebn0_db": ebn0_values,
        "ber_sim": measured,
        "ber_theory": theory,
        "nbits": curve_nbits,
    }


def pcm_sqnr_bits_curve(
    cfg: PCMConfig,
    bits_values: Sequence[int] | None = None,
) -> dict:
    """SQNR de cuantificación y de reconstrucción al variar el número de bits."""
    if bits_values is None:
        bits_values = np.arange(2, 13)
    bits_values = np.asarray(bits_values, dtype=int)
    sqnr_rec = np.empty(bits_values.size)
    sqnr_q = np.empty(bits_values.size)
    for i, n_bits in enumerate(bits_values):
        c = copy.deepcopy(cfg)
        c.n_bits = int(n_bits)
        c.ebn0_db = None
        c.channel = _clean_channel(cfg.channel.seed)
        r = simulate_pcm(c)
        sqnr_rec[i] = r.sqnr_db
        sqnr_q[i] = r.sqnr_quant_db
    theory = 6.02 * bits_values + 1.76 + 20.0 * np.log10(max(cfg.amplitude, 1e-9))
    return {
        "n_bits": bits_values,
        "sqnr_rec_db": sqnr_rec,
        "sqnr_quant_db": sqnr_q,
        "sqnr_theory_db": theory,
    }


def pcm_sqnr_ebn0_curve(
    cfg: PCMConfig,
    ebn0_values: Sequence[float] | None = None,
) -> dict:
    """SQNR de reconstrucción frente al Eb/N0 del enlace PCM.

    Muestra el comportamiento de umbral: mientras el enlace digital es fiable,
    manda la cuantificación; al acercarse al umbral, los errores de bit
    producen saltos grandes en la señal reconstruida.
    """
    if ebn0_values is None:
        ebn0_values = np.arange(0.0, 16.1, 2.0)
    ebn0_values = np.asarray(ebn0_values, dtype=float)
    sqnr = np.empty_like(ebn0_values)
    ber = np.empty_like(ebn0_values)
    for i, ebn0 in enumerate(ebn0_values):
        c = copy.deepcopy(cfg)
        c.ebn0_db = float(ebn0)
        c.channel = _clean_channel(cfg.channel.seed)
        r = simulate_pcm(c)
        sqnr[i] = r.sqnr_db
        ber[i] = r.ber
    return {"ebn0_db": ebn0_values, "sqnr_db": sqnr, "ber": ber}


def pcm_ber_ebn0_curve(
    cfg: PCMConfig,
    ebn0_values: Sequence[float] | None = None,
) -> dict:
    """BER del enlace PCM interior (ASK/FSK/BPSK) en AWGN."""
    if ebn0_values is None:
        ebn0_values = np.arange(0.0, 14.1, 1.0)
    ebn0_values = np.asarray(ebn0_values, dtype=float)
    ber = np.empty_like(ebn0_values)
    for i, ebn0 in enumerate(ebn0_values):
        c = copy.deepcopy(cfg)
        c.ebn0_db = float(ebn0)
        # Repite con semillas distintas para reducir la varianza.
        total_bits = 0
        total_errors = 0
        for k in range(4):
            # Semilla por subiteracion (la semilla debe ir al canal).
            c.channel = _clean_channel(cfg.seed + 101 * k)
            r = simulate_pcm(c)
            total_bits += r.nbits_total
            total_errors += r.errors
        ber[i] = total_errors / max(total_bits, 1)
    return {"ebn0_db": ebn0_values, "ber": ber, "nbits": total_bits}
