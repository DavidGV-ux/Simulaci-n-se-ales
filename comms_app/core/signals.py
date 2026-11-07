"""Señales de prueba, espectros y utilidades de muestreo.

El módulo no depende de la interfaz gráfica. Todas las funciones reciben
parámetros explícitos y devuelven arreglos de NumPy, de modo que puedan
probarse por separado.
"""

from __future__ import annotations

import ast
import math
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Iterable

import numpy as np
from scipy.signal import butter, filtfilt


# ---------------------------------------------------------------------------
# Generación de señales
# ---------------------------------------------------------------------------

WAVEFORM_LABELS = {
    "sine": "Senoidal",
    "square": "Cuadrada",
    "triangle": "Triangular",
    "sawtooth": "Diente de sierra",
    "chirp": "Chirp (barrido)",
    "two_tone": "Dos tonos",
    "formula": "Fórmula personalizada",
    "csv": "CSV / datos externos",
}


def time_vector(fs: float, duration: float, start: float = 0.0) -> np.ndarray:
    """Vector de tiempo uniforme, sin incluir el extremo final."""
    if fs <= 0 or duration <= 0:
        raise ValueError("fs y duration deben ser positivos")
    n = max(1, int(round(fs * duration)))
    return start + np.arange(n, dtype=float) / fs


def _zero_mean(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    return x - np.mean(x)


def generate_waveform(
    kind: str,
    t: np.ndarray,
    *,
    amplitude: float = 1.0,
    frequency: float = 1000.0,
    phase_deg: float = 0.0,
    duty: float = 0.5,
    f_end: float | None = None,
    formula: str | None = None,
    csv_t: np.ndarray | None = None,
    csv_x: np.ndarray | None = None,
    normalize: bool = True,
    remove_dc: bool = True,
) -> np.ndarray:
    """Genera una señal de prueba.

    ``kind`` puede ser sine, square, triangle, sawtooth, chirp, two_tone,
    formula o csv. Para ``formula`` se evalúa una expresión segura en función
    de ``t``. Para ``csv`` se interpola el archivo cargado sobre ``t``.
    """
    t = np.asarray(t, dtype=float)
    if t.ndim != 1 or t.size < 2:
        raise ValueError("t debe ser un vector con al menos dos muestras")

    w = 2.0 * np.pi * frequency * t + np.deg2rad(phase_deg)
    kind = kind.lower().strip()

    if kind == "sine":
        x = amplitude * np.sin(w)
    elif kind == "square":
        frac = (frequency * t + phase_deg / 360.0) % 1.0
        x = np.where(frac < duty, amplitude, -amplitude)
    elif kind == "triangle":
        x = amplitude * (2.0 / np.pi) * np.arcsin(np.sin(w))
    elif kind == "sawtooth":
        frac = (frequency * t + phase_deg / 360.0) % 1.0
        x = amplitude * (2.0 * frac - 1.0)
    elif kind == "chirp":
        if f_end is None:
            f_end = max(frequency * 2.0, frequency + 1.0)
        duration = max(t[-1] - t[0], 1e-12)
        k = (f_end - frequency) / duration
        x = amplitude * np.sin(2.0 * np.pi * (frequency * t + 0.5 * k * t**2) + np.deg2rad(phase_deg))
    elif kind == "two_tone":
        x = amplitude * (
            0.62 * np.sin(w)
            + 0.38 * np.sin(2.0 * np.pi * 3.0 * frequency * t + np.deg2rad(phase_deg) / 2.0)
        )
    elif kind == "formula":
        if not formula:
            raise ValueError("Seleccionaste fórmula personalizada pero está vacía")
        x = safe_eval_signal(formula, t)
        x = amplitude * np.asarray(x, dtype=float)
    elif kind == "csv":
        if csv_t is None or csv_x is None or len(csv_t) < 2:
            raise ValueError("No hay datos CSV cargados")
        x = np.interp(t, csv_t, csv_x, left=csv_x[0], right=csv_x[-1])
        x = amplitude * np.asarray(x, dtype=float)
    else:
        raise ValueError(f"Forma de onda desconocida: {kind}")

    x = np.asarray(x, dtype=float)
    if remove_dc:
        x = _zero_mean(x)
    if normalize:
        peak = float(np.max(np.abs(x)))
        if peak > 1e-12:
            x = x / peak
    return x


# ---------------------------------------------------------------------------
# Evaluador seguro de fórmulas
# ---------------------------------------------------------------------------

_ALLOWED_FUNCS = {
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "arcsin": np.arcsin,
    "arccos": np.arccos,
    "arctan": np.arctan,
    "exp": np.exp,
    "log": np.log,
    "log10": np.log10,
    "sqrt": np.sqrt,
    "abs": np.abs,
    "sign": np.sign,
    "heaviside": np.heaviside,
    "where": np.where,
    "minimum": np.minimum,
    "maximum": np.maximum,
    "clip": np.clip,
    "floor": np.floor,
    "ceil": np.ceil,
    "round": np.round,
    "mod": np.mod,
    "sinh": np.sinh,
    "cosh": np.cosh,
    "tanh": np.tanh,
}
_ALLOWED_CONSTANTS = {"pi": np.pi, "e": np.e, "tau": 2.0 * np.pi}


def safe_eval_signal(expr: str, t: np.ndarray) -> np.ndarray:
    """Evalúa una expresión matemática con una lista blanca de operaciones.

    No usa ``eval`` directamente: recorre el AST y solo permite nombres,
    constantes, operadores aritméticos y llamadas a funciones de la lista.
    El objetivo es que el campo de fórmula no pueda ejecutar código arbitrario.
    """
    if len(expr) > 600:
        raise ValueError("La fórmula es demasiado larga (máximo 600 caracteres)")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Fórmula inválida: {exc.msg}") from exc

    env = {"t": np.asarray(t, dtype=float), **_ALLOWED_CONSTANTS, **_ALLOWED_FUNCS}

    def _eval(node: ast.AST):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return float(node.value)
            raise ValueError("Solo se permiten constantes numéricas")
        if isinstance(node, ast.Name):
            if node.id in env:
                return env[node.id]
            raise ValueError(f"Nombre no permitido: {node.id}")
        if isinstance(node, ast.BinOp):
            a, b = _eval(node.left), _eval(node.right)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            if isinstance(node.op, ast.Div):
                return a / b
            if isinstance(node.op, ast.Pow):
                return a**b
            if isinstance(node.op, ast.Mod):
                return np.mod(a, b)
            raise ValueError("Operador no permitido")
        if isinstance(node, ast.UnaryOp):
            a = _eval(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +a
            if isinstance(node.op, ast.USub):
                return -a
            raise ValueError("Operador unario no permitido")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
                raise ValueError("Función no permitida")
            if node.keywords:
                raise ValueError("No se permiten argumentos con nombre")
            args = [_eval(a) for a in node.args]
            func_name = node.func.id
            if func_name == "heaviside" and len(args) != 2:
                raise ValueError("heaviside requiere dos argumentos: heaviside(t, umbral)")
            return _ALLOWED_FUNCS[func_name](*args)
        raise ValueError(f"Expresión no permitida: {type(node).__name__}")

    value = _eval(tree)
    arr = np.asarray(value, dtype=float)
    if arr.ndim == 0:
        arr = np.full_like(t, float(arr), dtype=float)
    if arr.shape != t.shape:
        try:
            arr = np.broadcast_to(arr, t.shape).astype(float)
        except ValueError as exc:
            raise ValueError("La fórmula no produce un vector compatible con t") from exc
    if not np.all(np.isfinite(arr)):
        raise ValueError("La fórmula produce valores no finitos")
    return arr


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------


@dataclass
class CsvSignal:
    path: str
    t: np.ndarray
    x: np.ndarray

    @property
    def name(self) -> str:
        return Path(self.path).name


def load_csv_signal(path: str) -> CsvSignal:
    """Carga un CSV/TXT de dos columnas (tiempo, amplitud) o una columna.

    Acepta coma, punto y coma o espacios como separador. Si hay una sola
    columna, se usa el índice de muestra como tiempo normalizado.
    """
    p = Path(path)
    if not p.exists():
        raise ValueError(f"No existe el archivo: {path}")
    raw = p.read_text(encoding="utf-8", errors="replace").splitlines()
    rows: list[list[float]] = []
    for line in raw:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.replace(";", ",")
        parts = [p.strip() for p in line.split(",") if p.strip()]
        if len(parts) == 1:
            parts = line.split()
        try:
            vals = [float(v.replace(",", ".")) for v in parts]
        except ValueError:
            continue
        if len(vals) >= 2:
            rows.append([vals[0], vals[1]])
        elif len(vals) == 1:
            rows.append([float(len(rows)), vals[0]])
    if len(rows) < 3:
        raise ValueError("El CSV debe tener al menos 3 filas numéricas")
    data = np.asarray(rows, dtype=float)
    order = np.argsort(data[:, 0])
    t = data[order, 0]
    x = data[order, 1]
    # Elimina tiempos duplicados para que np.interp no falle.
    keep = np.concatenate([[True], np.diff(t) > 0])
    t, x = t[keep], x[keep]
    if t.size < 2:
        raise ValueError("El CSV no contiene dos tiempos distintos")
    return CsvSignal(str(p), t, x)


# ---------------------------------------------------------------------------
# Muestreo, cuantificación y reconstrucción
# ---------------------------------------------------------------------------


def sample_signal(
    x: np.ndarray,
    t: np.ndarray,
    fs: float,
    duration: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Muestrea una señal definida en alta resolución."""
    if duration is None:
        duration = float(t[-1] - t[0])
    ts = time_vector(fs, duration, start=float(t[0]))
    xs = np.interp(ts, t, x, left=x[0], right=x[-1])
    return ts, xs


def quantize_uniform(
    x: np.ndarray, n_bits: int, full_scale: float = 1.0
) -> tuple[np.ndarray, np.ndarray, float, np.ndarray]:
    """Cuantificación uniforme de tipo midrise.

    Devuelve la señal cuantificada, los índices enteros, el paso ``q`` y el
    error de cuantificación (cuantificada - original).
    """
    if not 2 <= n_bits <= 16:
        raise ValueError("n_bits debe estar entre 2 y 16")
    if full_scale <= 0:
        raise ValueError("full_scale debe ser positivo")
    x = np.asarray(x, dtype=float)
    levels = 2**n_bits
    q = 2.0 * full_scale / levels
    idx = np.floor((x + full_scale) / q).astype(int)
    idx = np.clip(idx, 0, levels - 1)
    xq = -full_scale + (idx + 0.5) * q
    return xq, idx, q, xq - x


def pcm_encode(x: np.ndarray, n_bits: int, full_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """Muestrea/cuantifica y devuelve bits MSB-first y la señal cuantificada."""
    xq, idx, q, _ = quantize_uniform(x, n_bits, full_scale)
    shifts = np.arange(n_bits - 1, -1, -1)
    bits = ((idx[:, None] >> shifts) & 1).astype(np.uint8)
    return bits, idx, xq, q


def pcm_decode(bits: np.ndarray, n_bits: int, full_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray, float]:
    """Decodifica bits MSB-first a índices y niveles cuantificados."""
    bits = np.asarray(bits, dtype=np.uint8)
    if bits.ndim == 1:
        bits = bits.reshape(-1, n_bits)
    if bits.shape[1] != n_bits:
        raise ValueError("La matriz de bits no coincide con n_bits")
    shifts = np.arange(n_bits - 1, -1, -1)
    idx = (bits.astype(int) << shifts).sum(axis=1)
    levels = 2**n_bits
    q = 2.0 * full_scale / levels
    xq = -full_scale + (idx + 0.5) * q
    return xq, idx, q


def zero_order_hold(xs: np.ndarray, ts: np.ndarray, t_out: np.ndarray) -> np.ndarray:
    """Reconstrucción ZOH (convertidor D/A ideal de retención)."""
    if xs.size == 0:
        return np.zeros_like(t_out)
    dt = float(ts[1] - ts[0])
    idx = np.floor((t_out - ts[0]) / dt).astype(int)
    idx = np.clip(idx, 0, xs.size - 1)
    return xs[idx]


def sinc_interp(
    x: np.ndarray,
    t_in: np.ndarray,
    t_out: np.ndarray,
    half: int = 24,
) -> np.ndarray:
    """Interpolación de banda limitada (reconstructor sinc).

    Cuando la rejilla de salida es uniforme se usa un sobremuestreo FFT, que
    reproduce exactamente una señal de banda limitada y evita el error de
    truncamiento de la sinc ventaneada. Si la proporción entre rejillas no es
    racional (o el sobremuestreo sería desmesurado) se usa como respaldo una
    sinc ventaneada con normalización de ganancia, que también es adecuada
    para visualización.

    El resultado se apoya en la extensión periódica implícita del FFT; por eso
    las métricas de PCM descartan los bordes del registro.
    """
    x = np.asarray(x, dtype=float)
    t_in = np.asarray(t_in, dtype=float)
    t_out = np.asarray(t_out, dtype=float)
    if x.size < 2:
        return np.full_like(t_out, x[0] if x.size else 0.0, dtype=float)
    if t_in.size != x.size:
        raise ValueError("t_in y x deben tener el mismo tamaño")
    dt = float(t_in[1] - t_in[0])
    if dt <= 0:
        raise ValueError("t_in debe ser decreciente")
    steps = np.diff(t_in)
    if not np.allclose(steps, dt, rtol=1e-6, atol=1e-12 * max(1.0, abs(dt))):
        raise ValueError("t_in debe ser una rejilla uniforme")
    if t_out.size == 0:
        return np.zeros(0, dtype=float)

    # Proporción entre la rejilla de entrada y la de salida. Para PCM ambas
    # parten del mismo instante y fs_analog/fs_sample es una fracción sencilla.
    dt_out = float(np.median(np.diff(t_out))) if t_out.size > 1 else dt
    ratio = Fraction(dt / dt_out).limit_denominator(2048) if dt_out > 0 else Fraction(1, 1)
    up, down = int(ratio.numerator), int(ratio.denominator)
    n_up = x.size * max(up, 1)
    aligned = abs(float(t_out[0] - t_in[0])) <= max(1e-12, 0.25 * min(dt, dt_out))
    use_fft = (
        aligned
        and up > 0
        and down > 0
        and n_up <= max(2_000_000, 8 * t_out.size)
        and n_up <= 16_000_000
    )
    if use_fft:
        spec = np.fft.rfft(x)
        out_spec = np.zeros(n_up // 2 + 1, dtype=complex)
        out_spec[: spec.size] = spec
        # La frecuencia de Nyquist de la rejilla original representa las dos
        # mitades del espectro; al sobremuestrear hay que repartirla.
        if x.size % 2 == 0 and spec.size == x.size // 2 + 1:
            out_spec[spec.size - 1] *= 0.5
        y_up = np.fft.irfft(out_spec, n=n_up) * float(up)
        t_up = t_in[0] + np.arange(n_up, dtype=float) * dt / up
        return np.interp(t_out, t_up, y_up, left=y_up[0], right=y_up[-1])

    # Respaldo: sinc ventaneada (Blackman), con padding reflejado y
    # normalización de la ganancia para conservar el nivel de continua.
    half = max(4, int(half))
    pad = 2 * half
    xp = np.pad(x, pad, mode="reflect")
    u = (t_out - t_in[0]) / dt
    i0 = np.floor(u).astype(int)
    idx = i0 + pad
    y = np.zeros_like(t_out, dtype=float)
    wsum = np.zeros_like(t_out, dtype=float)
    for k in range(-half + 1, half + 1):
        arg = u - (i0 + k)
        win = 0.54 - 0.46 * np.cos(np.pi * (arg + half) / half)
        kernel = np.sinc(arg) * win
        y += xp[np.clip(idx + k, 0, xp.size - 1)] * kernel
        wsum += kernel
    return y / np.where(np.abs(wsum) > 1e-12, wsum, 1.0)


def lowpass(x: np.ndarray, fs: float, cutoff: float, order: int = 4) -> np.ndarray:
    """Filtro Butterworth pasa-bajos de fase cero (para visualización)."""
    cutoff = float(np.clip(cutoff, 1e-6, 0.49 * fs))
    b, a = butter(order, cutoff / (fs / 2.0), btype="low")
    if len(x) <= max(len(a), len(b)) * 3:
        return np.asarray(x, dtype=float)
    return filtfilt(b, a, np.asarray(x, dtype=float))


def anti_alias_filter(x: np.ndarray, fs_analog: float, fs_sample: float, order: int = 6) -> np.ndarray:
    """Filtro antialias previo al muestreo, con corte en fs_sample/2."""
    return lowpass(x, fs_analog, cutoff=0.45 * fs_sample, order=order)


# ---------------------------------------------------------------------------
# Espectros y métricas
# ---------------------------------------------------------------------------


def spectrum(
    x: np.ndarray,
    fs: float,
    *,
    nfft: int | None = None,
    window: str = "hann",
    dB: bool = True,
    normalize: bool = True,
) -> tuple[np.ndarray, np.ndarray]:
    """Espectro unilateral de una señal real."""
    x = np.asarray(x, dtype=float)
    n = x.size
    if n < 4:
        raise ValueError("La señal es demasiado corta para calcular el espectro")
    if nfft is None:
        nfft = 1 << int(np.ceil(np.log2(max(1024, n))))
    nfft = max(256, int(nfft))
    w = np.hanning(n) if window == "hann" else np.ones(n)
    xw = (x - np.mean(x)) * w
    X = np.fft.rfft(xw, n=nfft)
    f = np.fft.rfftfreq(nfft, d=1.0 / fs)
    mag = np.abs(X)
    if normalize:
        peak = float(np.max(mag))
        if peak > 0:
            mag = mag / peak
    if dB:
        mag = 20.0 * np.log10(np.maximum(mag, 1e-12))
    return f, mag


def signal_bandwidth(
    x: np.ndarray, fs: float, *, threshold_db: float = -20.0, max_fraction: float = 0.5
) -> float:
    """Ancho de banda ocupado aproximado (última frecuencia sobre umbral)."""
    f, mag_db = spectrum(x, fs, dB=True, normalize=True)
    above = np.where(mag_db >= threshold_db)[0]
    if above.size == 0:
        return 0.0
    return float(min(f[above[-1]], max_fraction * fs))


def rms(x: np.ndarray) -> float:
    x = np.asarray(x, dtype=float)
    return float(np.sqrt(np.mean(x**2))) if x.size else 0.0


def power_db(x: np.ndarray) -> float:
    p = float(np.mean(np.asarray(x, dtype=float) ** 2))
    return float(10.0 * np.log10(max(p, 1e-30)))


def snr_db(signal: np.ndarray, noise: np.ndarray) -> float:
    ps = float(np.mean(np.asarray(signal, dtype=float) ** 2))
    pn = float(np.mean(np.asarray(noise, dtype=float) ** 2))
    return float(10.0 * np.log10(max(ps, 1e-30) / max(pn, 1e-30)))


def mse(reference: np.ndarray, test: np.ndarray, trim: int = 0) -> float:
    a = np.asarray(reference, dtype=float)
    b = np.asarray(test, dtype=float)
    if trim > 0:
        a = a[trim:-trim]
        b = b[trim:-trim]
    return float(np.mean((a - b) ** 2))


def correlation(reference: np.ndarray, test: np.ndarray, trim: int = 0) -> float:
    a = np.asarray(reference, dtype=float)
    b = np.asarray(test, dtype=float)
    if trim > 0:
        a = a[trim:-trim]
        b = b[trim:-trim]
    if a.size < 2:
        return 0.0
    a = a - np.mean(a)
    b = b - np.mean(b)
    denom = float(np.sqrt(np.sum(a**2) * np.sum(b**2)))
    if denom < 1e-15:
        return 0.0
    return float(np.sum(a * b) / denom)
