"""Modulaciones digitales requeridas: ASK/OOK, FSK y BPSK (para PCM).

La cadena es: bits -> pulsos -> portadora -> canal -> detector -> BER.
Se incluyen detección coherente y de envolvente/no coherente según el caso.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import hilbert
from scipy.special import erfc

from .channel import ChannelConfig, ChannelReport, apply_channel
from .signals import spectrum


def qfunc(x):
    return 0.5 * erfc(np.asarray(x, dtype=float) / np.sqrt(2.0))


def band_snr_db(ebn0_db: float, rb: float, bandwidth_hz: float) -> float:
    """Convierte Eb/N0 en SNR dentro de la banda ocupada.

    Para un ruido blanco, N = N0·B y Eb = Ps/Rb, por lo que
    Ps/N = (Eb/N0)·(Rb/B).
    """
    if bandwidth_hz <= 0 or rb <= 0:
        return float(ebn0_db)
    return float(ebn0_db + 10.0 * np.log10(rb / bandwidth_hz))


def ber_theory(scheme: str, ebn0_db, detector: str = "coherent"):
    """BER teórica en AWGN para los esquemas implementados.

    OOK/ASK coherente (bits equiprobables, Eb = energía promedio por bit):
        Pb = Q(sqrt(2*Eb/N0)).
    BPSK: Q(sqrt(2 Eb/N0)).
    OOK/ASK y BFSK no coherentes: 0.5 exp(-Eb/(2 N0)).
    BFSK ortogonal coherente: Q(sqrt(Eb/N0)).
    """
    g = 10.0 ** (np.asarray(ebn0_db, dtype=float) / 10.0)
    scheme = scheme.upper()
    noncoherent = detector.lower().startswith(("non", "no", "env"))
    if scheme == "ASK":
        if noncoherent:
            # OOK con detector de envolvente / no coherente: no existe forma
            # cerrada universal de la BER (depende del umbral, ganancia, AGC y
            # la distribucion del ruido tras la envolvente). La fórmula de
            # BFSK no aplicica aqui; se debe usar la curva de Monte Carlo.
            raise NotImplementedError(
                "BER teorica de ASK/OOK no coherente no tiene forma cerrada; "
                "usar la curva de Monte Carlo del detector."
            )
        # OOK coherente con bits equiprobables: Eb = A^2*Tb/4 (energia promedio).
        # Pb = Q(sqrt(2*Eb/N0)).
        return qfunc(np.sqrt(2.0 * g))
    if scheme == "BPSK":
        return qfunc(np.sqrt(2.0 * g))
    if scheme == "FSK":
        if noncoherent:
            return 0.5 * np.exp(-g / 2.0)
        return qfunc(np.sqrt(g))
    raise ValueError(f"Esquema desconocido: {scheme}")


def make_bits(
    nbits: int,
    mode: str = "random",
    manual: str = "10110010",
    seed: int = 1,
) -> np.ndarray:
    """Genera una secuencia binaria de longitud nbits."""
    nbits = int(max(1, nbits))
    mode = mode.lower()
    if mode == "random":
        rng = np.random.default_rng(seed)
        return rng.integers(0, 2, nbits, dtype=np.uint8)
    if mode == "manual":
        clean = "".join(ch for ch in manual if ch not in " \t,;_-")
        if not clean or any(ch not in "01" for ch in clean):
            raise ValueError("La secuencia manual solo puede contener 0 y 1")
        arr = np.fromiter((int(ch) for ch in clean), dtype=np.uint8)
        reps = int(np.ceil(nbits / arr.size))
        return np.tile(arr, reps)[:nbits]
    if mode == "alternating":
        return (np.arange(nbits, dtype=np.uint8) % 2)
    if mode == "prbs7":
        state = 0x7F
        out = np.empty(nbits, dtype=np.uint8)
        for i in range(nbits):
            bit = ((state >> 6) ^ (state >> 5)) & 1
            state = ((state << 1) | bit) & 0x7F
            out[i] = bit
        return out
    raise ValueError(f"Modo de bits desconocido: {mode}")


def bit_windows(x: np.ndarray, nbits: int, sps: int, offset_frac: float = 0.0) -> np.ndarray:
    """Extrae ventanas de un bit, con un desplazamiento de temporización."""
    x = np.asarray(x, dtype=float)
    sps = int(sps)
    offset = int(round(float(offset_frac) * sps))
    pad = sps + abs(offset) + 2
    xp = np.pad(x, (pad, pad), mode="edge")
    start = pad + offset
    total = int(nbits) * sps
    if start < 0:
        xp = np.pad(xp, (-start, 0), mode="edge")
        start = 0
    if start + total > xp.size:
        xp = np.pad(xp, (0, start + total - xp.size + 2), mode="edge")
    return np.lib.stride_tricks.sliding_window_view(xp, sps)[start : start + total : sps]


@dataclass
class ASKConfig:
    nbits: int = 200
    bit_mode: str = "random"
    manual_bits: str = "10110010"
    rb: float = 1000.0
    fc: float = 6000.0
    amplitude: float = 1.0
    sps: int = 32
    detector: str = "coherent"  # coherent | envelope
    agc_error_db: float = 0.0
    timing_offset_frac: float = 0.0
    seed: int = 1
    channel: ChannelConfig = field(default_factory=ChannelConfig)


@dataclass
class FSKConfig:
    nbits: int = 200
    bit_mode: str = "random"
    manual_bits: str = "10110010"
    rb: float = 1000.0
    fc: float = 6000.0
    amplitude: float = 1.0
    sps: int = 32
    modulation_index: float = 1.0
    detector: str = "noncoherent"  # coherent | noncoherent
    timing_offset_frac: float = 0.0
    seed: int = 1
    channel: ChannelConfig = field(default_factory=ChannelConfig)


@dataclass
class BPSKConfig:
    nbits: int = 200
    bit_mode: str = "random"
    manual_bits: str = "10110010"
    rb: float = 1000.0
    fc: float = 6000.0
    amplitude: float = 1.0
    sps: int = 32
    timing_offset_frac: float = 0.0
    seed: int = 1
    channel: ChannelConfig = field(default_factory=ChannelConfig)


@dataclass
class DigitalResult:
    scheme: str
    t: np.ndarray
    bits: np.ndarray
    tx: np.ndarray
    rx: np.ndarray
    clean: np.ndarray
    detected: np.ndarray
    ber: float
    errors: int
    nbits: int
    fs: float
    rb: float
    sps: int
    report: ChannelReport
    ebn0_eff_db: float
    snr_eff_db: float
    spectrum_f: np.ndarray
    spectrum_db: np.ndarray
    eye: np.ndarray | None = None
    extras: dict = field(default_factory=dict)


def snap_carrier(fc: float, rb: float, fs: float, min_cycles: int = 1) -> tuple[float, int]:
    """Ajusta la portadora a un número entero de ciclos por bit.

    Si la portadora no completa un número entero de ciclos dentro de cada bit,
    la correlación coherente depende de la fase inicial del bit y aparecen
    errores sistemáticos aunque el ruido sea bajo. Ajustar ``fc`` a un múltiplo
    entero de ``rb`` elimina ese problema y es una práctica habitual en los
    transmisores reales.
    """
    rb = float(rb)
    fs = float(fs)
    max_cycles = max(1, int(np.floor((0.5 * fs - 1e-9) / rb)))
    cycles = int(round(float(fc) / rb))
    cycles = max(int(min_cycles), min(cycles, max_cycles))
    return cycles * rb, cycles


def _base_time(nbits: int, sps: int, rb: float) -> tuple[np.ndarray, float, float]:
    fs = float(sps * rb)
    tb = 1.0 / rb
    t = np.arange(int(nbits) * int(sps), dtype=float) / fs
    return t, fs, tb


def simulate_ask(cfg: ASKConfig) -> DigitalResult:
    """Simula ASK binaria. Con amplitudes (A, 0) equivale a OOK.

    OOK es un caso particular de ASK donde el bit 0 transmite ausencia de
    portadora (amplitud 0) y el bit 1 transmite una ráfaga de portadora de
    amplitud A. La energía promedio por bit (bits equiprobables) es
    Eb = A^2 * Tb / 4.
    """
    bits = make_bits(cfg.nbits, cfg.bit_mode, cfg.manual_bits, cfg.seed)
    nbits = int(bits.size)
    sps = int(cfg.sps)
    t, fs, tb = _base_time(nbits, sps, cfg.rb)
    fc, fc_cycles = snap_carrier(cfg.fc, cfg.rb, fs)
    pulse = np.repeat(bits.astype(float), sps)
    carrier = cfg.amplitude * np.cos(2.0 * np.pi * fc * t)
    tx = pulse * carrier

    # Energía media por bit de OOK: (E1 + E0)/2 = A^2 Tb / 4.
    eb = cfg.amplitude**2 * tb / 4.0
    cfg.channel.eb = eb
    rx, report, clean = apply_channel(tx, fs, cfg.channel, t=t, rng=np.random.default_rng(cfg.seed + 11))

    offset = cfg.timing_offset_frac
    if cfg.detector.lower().startswith("env"):
        env = np.abs(hilbert(rx))
        win = bit_windows(env, nbits, sps, offset)
        sample = win[:, sps // 2]
        threshold = 0.5 * cfg.amplitude * report.gain_linear * 10.0 ** (cfg.agc_error_db / 20.0)
        detected = (sample > threshold).astype(np.uint8)
    else:
        ref = cfg.amplitude * np.cos(2.0 * np.pi * fc * t)
        ref_win = bit_windows(ref, nbits, sps, offset)
        win = bit_windows(rx, nbits, sps, offset)
        corr = np.sum(win * ref_win, axis=1) / fs
        e1 = float(np.mean(np.sum(ref_win**2, axis=1) / fs))
        threshold = 0.5 * e1 * report.gain_linear * 10.0 ** (cfg.agc_error_db / 20.0)
        detected = (corr > threshold).astype(np.uint8)

    errors = int(np.sum(detected != bits))
    ber = errors / max(nbits, 1)
    f, mag = spectrum(tx, fs)
    eye = bit_windows(rx, min(nbits, 200), sps, offset)
    return DigitalResult(
        scheme="ASK",
        t=t,
        bits=bits,
        tx=tx,
        rx=rx,
        clean=clean,
        detected=detected,
        ber=float(ber),
        errors=errors,
        nbits=nbits,
        fs=fs,
        rb=cfg.rb,
        sps=sps,
        report=report,
        ebn0_eff_db=report.ebn0_eff_db,
        snr_eff_db=report.snr_eff_db,
        spectrum_f=f,
        spectrum_db=mag,
        eye=eye,
        extras={
            "eb": eb,
            "fc": float(fc),
            "cycles_per_bit": int(fc_cycles),
            "threshold": float(threshold),
            "detector": cfg.detector,
            "bandwidth_hz": 2.0 * cfg.rb,
            "snr_band_db": band_snr_db(report.ebn0_eff_db, cfg.rb, 2.0 * cfg.rb),
            "efficiency_bps_hz": cfg.rb / (2.0 * cfg.rb),
        },
    )


def simulate_fsk(cfg: FSKConfig) -> DigitalResult:
    bits = make_bits(cfg.nbits, cfg.bit_mode, cfg.manual_bits, cfg.seed)
    nbits = int(bits.size)
    sps = int(cfg.sps)
    t, fs, tb = _base_time(nbits, sps, cfg.rb)
    df = 0.5 * cfg.modulation_index * cfg.rb
    f0 = max(1.0, cfg.fc - df)
    f1 = cfg.fc + df
    tbit = np.arange(sps, dtype=float) / fs
    tone0 = cfg.amplitude * np.cos(2.0 * np.pi * f0 * tbit)
    tone1 = cfg.amplitude * np.cos(2.0 * np.pi * f1 * tbit)
    tx = np.where(bits[:, None] == 1, tone1, tone0).ravel()

    eb = cfg.amplitude**2 * tb / 2.0
    cfg.channel.eb = eb
    rx, report, clean = apply_channel(tx, fs, cfg.channel, t=t, rng=np.random.default_rng(cfg.seed + 13))

    offset_samples = float(cfg.timing_offset_frac) * sps
    tl = (np.arange(sps, dtype=float) + offset_samples) / fs
    c0, s0 = np.cos(2.0 * np.pi * f0 * tl), np.sin(2.0 * np.pi * f0 * tl)
    c1, s1 = np.cos(2.0 * np.pi * f1 * tl), np.sin(2.0 * np.pi * f1 * tl)
    win = bit_windows(rx, nbits, sps, cfg.timing_offset_frac)

    coherent = cfg.detector.lower().startswith("coh")
    if coherent:
        corr0 = win @ c0 / fs
        corr1 = win @ c1 / fs
        detected = (corr1 > corr0).astype(np.uint8)
    else:
        e0 = (win @ c0) ** 2 + (win @ s0) ** 2
        e1 = (win @ c1) ** 2 + (win @ s1) ** 2
        detected = (e1 > e0).astype(np.uint8)

    errors = int(np.sum(detected != bits))
    ber = errors / max(nbits, 1)
    f, mag = spectrum(tx, fs)
    return DigitalResult(
        scheme="FSK",
        t=t,
        bits=bits,
        tx=tx,
        rx=rx,
        clean=clean,
        detected=detected,
        ber=float(ber),
        errors=errors,
        nbits=nbits,
        fs=fs,
        rb=cfg.rb,
        sps=sps,
        report=report,
        ebn0_eff_db=report.ebn0_eff_db,
        snr_eff_db=report.snr_eff_db,
        spectrum_f=f,
        spectrum_db=mag,
        eye=None,
        extras={
            "eb": eb,
            "f0": float(f0),
            "f1": float(f1),
            "df": float(df),
            "h": float(cfg.modulation_index),
            "bandwidth_hz": 2.0 * (df + cfg.rb),
            "snr_band_db": band_snr_db(report.ebn0_eff_db, cfg.rb, 2.0 * (df + cfg.rb)),
            "orthogonal": bool(abs(cfg.modulation_index - 1.0) < 0.05),
            "detector": cfg.detector,
        },
    )


def simulate_bpsk(cfg: BPSKConfig) -> DigitalResult:
    bits = make_bits(cfg.nbits, cfg.bit_mode, cfg.manual_bits, cfg.seed)
    nbits = int(bits.size)
    sps = int(cfg.sps)
    t, fs, tb = _base_time(nbits, sps, cfg.rb)
    fc, fc_cycles = snap_carrier(cfg.fc, cfg.rb, fs)
    pulse = 2.0 * bits.astype(float) - 1.0
    carrier = cfg.amplitude * np.cos(2.0 * np.pi * fc * t)
    tx = np.repeat(pulse, sps) * carrier

    eb = cfg.amplitude**2 * tb / 2.0
    cfg.channel.eb = eb
    rx, report, clean = apply_channel(tx, fs, cfg.channel, t=t, rng=np.random.default_rng(cfg.seed + 17))

    ref = cfg.amplitude * np.cos(2.0 * np.pi * fc * t)
    ref_win = bit_windows(ref, nbits, sps, cfg.timing_offset_frac)
    win = bit_windows(rx, nbits, sps, cfg.timing_offset_frac)
    corr = np.sum(win * ref_win, axis=1) / fs
    detected = (corr > 0).astype(np.uint8)

    errors = int(np.sum(detected != bits))
    ber = errors / max(nbits, 1)
    f, mag = spectrum(tx, fs)
    return DigitalResult(
        scheme="BPSK",
        t=t,
        bits=bits,
        tx=tx,
        rx=rx,
        clean=clean,
        detected=detected,
        ber=float(ber),
        errors=errors,
        nbits=nbits,
        fs=fs,
        rb=cfg.rb,
        sps=sps,
        report=report,
        ebn0_eff_db=report.ebn0_eff_db,
        snr_eff_db=report.snr_eff_db,
        spectrum_f=f,
        spectrum_db=mag,
        eye=bit_windows(rx, min(nbits, 200), sps, cfg.timing_offset_frac),
        extras={"eb": eb, "fc": float(fc), "cycles_per_bit": int(fc_cycles), "detector": "coherent",
                "bandwidth_hz": 2.0 * cfg.rb,
                "snr_band_db": band_snr_db(report.ebn0_eff_db, cfg.rb, 2.0 * cfg.rb)},
    )
