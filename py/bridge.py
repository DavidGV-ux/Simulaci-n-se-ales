"""Bridge between Pyodide/JS UI and the real comms_app.core simulation engine.

Functions accept plain dicts (from JS JSON) and return JSON-serializable dicts.
Large arrays are downsampled for charting.

Adapted for the web_app front (Plotly + ChartManager): returns full-length
arrays where the JS chart recomputes its own trims, and received signals (rx)
in the raw domain with the link gain published in the report (the JS chart
normalizes the received trace by that gain).
"""
from __future__ import annotations

import json
import math
import traceback
from typing import Any

import numpy as np

from comms_app.core.analog import AMConfig, simulate_am
from comms_app.core.analysis import (
    am_fidelity_curve,
    digital_ber_curve,
    pcm_sqnr_bits_curve,
    pcm_sqnr_ebn0_curve,
)
from comms_app.core.channel import ChannelConfig
from comms_app.core.digital import ASKConfig, FSKConfig, simulate_ask, simulate_fsk
from comms_app.core.pcm import PCMConfig, simulate_pcm
from comms_app.core.signals import load_csv_signal  # noqa: F401 - reserved for future


def _is_bad(x: float) -> bool:
    return not math.isfinite(float(x))


def s(v: Any) -> Any:
    """Make value JSON-safe."""
    if v is None:
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        fv = float(v)
        return None if _is_bad(fv) else fv
    if isinstance(v, (int, str)):
        return v
    if isinstance(v, dict):
        return {str(k): s(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [s(i) for i in v]
    if isinstance(v, np.ndarray):
        return s(v.tolist())
    try:
        fv = float(v)
        return None if _is_bad(fv) else fv
    except Exception:
        return str(v)


def downsample_xy(x, y, max_n: int = 1600):
    x = np.asarray(x, dtype=float).ravel()
    y = np.asarray(y, dtype=float).ravel()
    n = min(x.size, y.size)
    x, y = x[:n], y[:n]
    if n > max_n:
        step = max(1, int(math.ceil(n / max_n)))
        idx = np.arange(0, n, step)
        x, y = x[idx], y[idx]
    return [s(float(v)) for v in x], [s(float(v)) for v in y]


def ds_y(y, max_n: int = 1600):
    y = np.asarray(y, dtype=float).ravel()
    n = y.size
    if n > max_n:
        step = max(1, int(math.ceil(n / max_n)))
        y = y[::step]
    return [s(float(v)) for v in y]


def spec_xy(f, db, max_n: int = 900, fmax: float | None = None):
    f = np.asarray(f, dtype=float).ravel()
    db = np.asarray(db, dtype=float).ravel()
    n = min(f.size, db.size)
    f, db = f[:n], db[:n]
    if fmax is not None:
        m = f <= fmax
        f, db = f[m], db[m]
    if f.size > max_n:
        step = max(1, int(math.ceil(f.size / max_n)))
        f, db = f[::step], db[::step]
    return [s(float(v)) for v in f], [s(float(v)) for v in db]


def channel_cfg(d: dict, metric: str) -> ChannelConfig:
    c = ChannelConfig()
    c.distance_km = float(d.get("distance_km", 0) or 0)
    c.frequency_mhz = float(d.get("frequency_mhz", 2450) or 2450)
    c.extra_atten_db = float(d.get("extra_atten_db", 0) or 0)
    nominal = d.get("nominal_db", None)
    if metric == "ebn0":
        c.ebn0_db = float(nominal) if nominal is not None else None
        c.snr_db = None
    else:
        c.snr_db = float(nominal) if nominal is not None else None
        c.ebn0_db = None
    c.multipath = bool(d.get("multipath", False))
    c.mp_delay_us = float(d.get("mp_delay_us", 100) or 100)
    c.mp_gain_db = float(d.get("mp_gain_db", -6) or -6)
    c.mp_phase_deg = float(d.get("mp_phase_deg", 180) or 180)
    c.interference = bool(d.get("interference", False))
    c.int_freq_hz = float(d.get("int_freq_hz", 0) or 0)
    c.int_amp_db = float(d.get("int_amp_db", -12) or -12)
    c.freq_offset_hz = float(d.get("freq_offset_hz", 0) or 0)
    c.phase_noise_rms = float(d.get("phase_noise_rms", 0) or 0)
    c.gain_step_db = float(d.get("gain_step_db", 0) or 0)
    c.gain_step_at = float(d.get("gain_step_at", 0.5) or 0.5)
    clip = d.get("clip_level", None)
    if d.get("clip_on") and clip is not None and float(clip) > 0:
        c.clip_level = float(clip)
    else:
        c.clip_level = None
    c.seed = int(d.get("seed", 1) or 1)
    return c


def run_am(p: dict) -> dict:
    try:
        ch = channel_cfg(p.get("channel", {}), "snr")
        cfg = AMConfig(
            waveform=p.get("waveform", "sine"),
            fm=float(p.get("fm", 1000)),
            phase_deg=float(p.get("phase_deg", 0)),
            duty=float(p.get("duty", 0.5)),
            f_end=float(p["f_end"]) if p.get("f_end") not in (None, "") else None,
            formula=(p.get("formula") or None),
            Vp=float(p.get("Vp", 1.0)),
            fc=float(p.get("fc", 20000)),
            m=float(p.get("m", 0.8)),
            fs=float(p.get("fs", 400000)),
            duration=float(p.get("duration_ms", 10)) / 1000.0,
            csv_t=np.asarray(p.get("csv_t") or [], dtype=float) if p.get("csv_t") else None,
            csv_x=np.asarray(p.get("csv_x") or [], dtype=float) if p.get("csv_x") else None,
            channel=ch,
        )
        res = simulate_am(cfg)
        curve = am_fidelity_curve(cfg, snr_values=np.arange(0.0, 31.0, 5.0))
        t_ms = [float(v) for v in (res.t * 1e3).tolist()]
        fmax = min(cfg.fs / 2.0, cfg.fc + 6.0 * cfg.fm)
        return {
            "ok": True,
            "metrics": s(res.metrics),
            "report": {
                "path_loss_db": s(res.report.path_loss_db),
                "total_atten_db": s(res.report.total_atten_db),
                "gain_linear": s(res.report.gain_linear),
                "snr_eff_db": s(res.report.snr_eff_db),
                "snr_band_db": s(res.report.snr_band_db),
                "noise_bandwidth_hz": s(res.report.noise_bandwidth_hz),
            },
            "recovery": {
                "t_ms": t_ms,
                "msg": s(res.message.tolist()),
                "env": s(res.env.tolist()),
                "coh": s(res.coh.tolist()),
            },
            "rf": {
                "t_ms": t_ms,
                "tx": s(res.tx.tolist()),
                "rx": s(res.rx.tolist()),
            },
            "spec_tx": dict(zip(["f_khz", "db"], spec_xy(res.spectrum_tx_f / 1e3, res.spectrum_tx_db, 900, fmax / 1e3))),
            "spec_rx": dict(zip(["f_khz", "db"], spec_xy(res.spectrum_rx_f / 1e3, res.spectrum_rx_db, 900, fmax / 1e3))),
            "markers": [s((cfg.fc - cfg.fm) / 1e3), s(cfg.fc / 1e3), s((cfg.fc + cfg.fm) / 1e3)],
            "error": {
                "t_ms": t_ms,
                "env": s(res.env_err.tolist()),
                "coh": s(res.coh_err.tolist()),
            },
            "curve": {
                "snr_db": [s(float(v)) for v in curve["snr_db"]],
                "mse_env": [s(float(v)) for v in curve["mse_env"]],
                "mse_coh": [s(float(v)) for v in curve["mse_coh"]],
            },
            "power": {
                "m": s(res.metrics["m"]),
                "pt_pc": s(res.metrics["pt_pc"]),
                "carrier": s(res.metrics["carrier_fraction"]),
                "sideband_half": s(res.metrics["sideband_fraction"] / 2.0),
            },
            "xmax_khz": s(fmax / 1e3),
        }
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


def _digital_pack(res, cfg, scheme: str, curve, extra_fields=None):
    t = res.t
    t_ms = t * 1e3
    nshow = min(28 if scheme == "FSK" else 24, res.nbits)
    lim_ms = nshow / max(res.rb, 1e-9) * 1e3
    mask = t_ms <= (float(t_ms[0]) + lim_ms)
    gain = max(res.report.gain_linear, 1e-30)
    rx_n = res.rx / gain
    centers_ms = ((np.arange(min(nshow, res.detected.size)) + 0.5) / res.rb * 1e3).tolist()
    fmax = min(res.fs / 2.0, float(res.extras.get("fc", getattr(cfg, "fc", 0))) + 6.0 * res.rb)
    out = {
        "ok": True,
        "scheme": scheme,
        "ber": s(res.ber),
        "errors": int(res.errors),
        "nbits": int(res.nbits),
        "rb": s(res.rb),
        "fs": s(res.fs),
        "report": s({
            "ebn0_eff_db": res.report.ebn0_eff_db,
            "snr_eff_db": res.report.snr_eff_db,
            "snr_band_db": res.report.snr_band_db,
            "path_loss_db": res.report.path_loss_db,
            "total_atten_db": res.report.total_atten_db,
            "gain_linear": res.report.gain_linear,
        }),
        "ebn0_eff_db": s(res.ebn0_eff_db),
        "snr_eff_db": s(res.snr_eff_db),
        "extras": s(res.extras),
        "bits_show": "".join(str(int(b)) for b in res.bits[:32]),
        "wave": {
            "t_ms": downsample_xy(t_ms[mask], res.tx[mask], 1400)[0],
            "tx": ds_y(res.tx[mask], 1400),
            "rx": ds_y(res.rx[mask], 1400),
            "centers_ms": [s(v) for v in centers_ms],
            "det": [int(v) for v in res.detected[:min(nshow, res.detected.size)]],
        },
        "spec": dict(zip(["f_khz", "db"], spec_xy(res.spectrum_f / 1e3, res.spectrum_db, 900, fmax / 1e3))),
        "xmax_khz": s(fmax / 1e3),
        "curve": {
            "ebn0_db": [s(float(v)) for v in curve["ebn0_db"]],
            "ber_theory": [s(float(v)) for v in curve["ber_theory"]],
            "ber_sim": [s(float(v)) for v in curve["ber_sim"]],
            "nbits": int(curve["nbits"]),
        },
    }
    if res.eye is not None:
        eye = np.asarray(res.eye)
        ntr = min(160, eye.shape[0])
        ui = np.linspace(0.0, 1.0, eye.shape[1], endpoint=False).tolist()
        traces = []
        cols = eye.shape[1]
        ci = np.arange(cols)
        if cols > 80:
            step = max(1, cols // 80)
            ci = np.arange(0, cols, step)
        ui = [float(ui[i]) for i in ci]
        for row in eye[:ntr]:
            traces.append([s(float(row[i])) for i in ci])
        out["eye"] = {
            "ui": [s(v) for v in ui],
            "traces": traces,
            "threshold": s(float(res.extras.get("threshold", 0.0))),
        }
    if extra_fields:
        out.update(extra_fields)
    return out


def run_ask(p: dict) -> dict:
    try:
        ch = channel_cfg(p.get("channel", {}), "ebn0")
        cfg = ASKConfig(
            nbits=int(p.get("nbits", 4000)),
            bit_mode=p.get("bit_mode", "random"),
            manual_bits=p.get("manual_bits", "1011001011100101"),
            rb=float(p.get("rb", 1000)),
            fc=float(p.get("fc", 6000)),
            amplitude=float(p.get("amplitude", 1.0)),
            sps=int(p.get("sps", 32)),
            detector=p.get("detector", "coherent"),
            agc_error_db=float(p.get("agc_error_db", 0.0)),
            timing_offset_frac=float(p.get("timing_offset_frac", 0.0)),
            seed=int(p.get("seed", 1)),
            channel=ch,
        )
        res = simulate_ask(cfg)
        curve = digital_ber_curve(cfg, "ASK", ebn0_values=np.arange(0.0, 13.1, 2.0), nbits_min=3000)
        return _digital_pack(res, cfg, "ASK", curve)
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


def run_fsk(p: dict) -> dict:
    try:
        ch = channel_cfg(p.get("channel", {}), "ebn0")
        cfg = FSKConfig(
            nbits=int(p.get("nbits", 4000)),
            bit_mode=p.get("bit_mode", "random"),
            manual_bits=p.get("manual_bits", "1011001011100101"),
            rb=float(p.get("rb", 1000)),
            fc=float(p.get("fc", 6000)),
            amplitude=float(p.get("amplitude", 1.0)),
            sps=int(p.get("sps", 32)),
            modulation_index=float(p.get("h", 1.0)),
            detector=p.get("detector", "noncoherent"),
            timing_offset_frac=float(p.get("timing_offset_frac", 0.0)),
            seed=int(p.get("seed", 1)),
            channel=ch,
        )
        res = simulate_fsk(cfg)
        curve = digital_ber_curve(cfg, "FSK", ebn0_values=np.arange(0.0, 13.1, 2.0), nbits_min=3000)
        from scipy.signal import hilbert as _hilbert
        z = _hilbert(res.rx)
        phase = np.unwrap(np.angle(z))
        n_inst = min(res.nbits, phase.size // res.sps)
        fbit = {"t_ms": [], "f_khz": []}
        if n_inst > 1:
            seg = phase[: n_inst * res.sps].reshape(n_inst, res.sps)
            slope = (seg[:, -1] - seg[:, 0]) / ((res.sps - 1) / res.fs)
            f_b = slope / (2.0 * np.pi)
            t_b = (np.arange(n_inst) + 0.5) / res.rb * 1e3
            nshow = min(28, res.nbits)
            lim_ms = nshow / max(res.rb, 1e-9) * 1e3
            m2 = t_b <= lim_ms
            fbit = {"t_ms": [s(float(v)) for v in t_b[m2]], "f_khz": [s(float(v) / 1e3) for v in f_b[m2]]}
        return _digital_pack(res, cfg, "FSK", curve, extra_fields={"fbit": fbit})
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


def run_pcm(p: dict) -> dict:
    try:
        ch = channel_cfg(p.get("channel", {}), "ebn0")
        cfg = PCMConfig(
            waveform=p.get("waveform", "sine"),
            fm=float(p.get("fm", 1000)),
            phase_deg=float(p.get("phase_deg", 0)),
            duty=float(p.get("duty", 0.5)),
            f_end=float(p["f_end"]) if p.get("f_end") not in (None, "") else None,
            formula=(p.get("formula") or None),
            amplitude=float(p.get("amplitude", 0.8)),
            fs_sample=float(p.get("fs_sample", 8000)),
            n_bits=int(p.get("n_bits", 8)),
            duration=float(p.get("duration_ms", 20)) / 1000.0,
            full_scale=float(p.get("full_scale", 1.0)),
            antialias=bool(p.get("antialias", True)),
            scheme=p.get("scheme", "BPSK"),
            fc=float(p.get("fc", 20000)),
            sps=int(p.get("sps", 16)),
            detector=p.get("detector", "noncoherent"),
            ebn0_db=None,
            seed=int(p.get("seed", ch.seed)),
            csv_t=np.asarray(p.get("csv_t") or [], dtype=float) if p.get("csv_t") else None,
            csv_x=np.asarray(p.get("csv_x") or [], dtype=float) if p.get("csv_x") else None,
            channel=ch,
        )
        n_rf = cfg.duration * cfg.fs_sample * cfg.n_bits * cfg.sps
        if n_rf > 4_000_000:
            return {"ok": False, "error": f"El enlace generaría {n_rf/1e6:.1f} M muestras RF. Reduce duración, fs, bits o sps."}
        if cfg.amplitude > cfg.full_scale:
            return {"ok": False, "error": "La amplitud supera el fondo de escala. Aumenta el fondo de escala o reduce la amplitud."}
        res = simulate_pcm(cfg)
        bits_curve = pcm_sqnr_bits_curve(cfg, bits_values=np.arange(2, min(13, int(cfg.n_bits) + 5)))
        link_curve = pcm_sqnr_ebn0_curve(cfg, ebn0_values=np.arange(0.0, 14.1, 2.0))
        t_ms = res.t_analog * 1e3
        nyq = 0.5 * cfg.fs_sample
        fmax = min(max(2.2 * cfg.fm, 1.3 * nyq), cfg.fs_sample / 2.0)
        return {
            "ok": True,
            "metrics": s(res.metrics),
            "sqnr_db": s(res.sqnr_db),
            "sqnr_quant_db": s(res.sqnr_quant_db),
            "sqnr_theory_db": s(res.sqnr_theory_db),
            "ber": s(res.ber),
            "errors": int(res.errors),
            "nbits_total": int(res.nbits_total),
            "q": s(res.q),
            "ebn0_eff_db": s(res.ebn0_eff_db),
            "snr_eff_db": s(res.snr_eff_db),
            "report": s({
                "path_loss_db": res.report.path_loss_db,
                "total_atten_db": res.report.total_atten_db,
                "gain_linear": res.report.gain_linear,
                "ebn0_eff_db": res.report.ebn0_eff_db,
            }),
            "t_analog": [float(v) for v in t_ms.tolist()],
            "x_analog": s(res.x_analog.tolist()),
            "x_zoh": s(res.x_zoh.tolist()),
            "x_rec": s(res.x_rec.tolist()),
            "t_s": [float(v) for v in (res.t_s * 1e3).tolist()],
            "x_s": s(res.x_s.tolist()),
            "xq": s(res.xq.tolist()),
            "qerr": s(res.qerr.tolist()),
            "spec_a": dict(zip(["f_khz", "db"], spec_xy(res.spectrum_analog_f / 1e3, res.spectrum_analog_db, 700, fmax / 1e3))),
            "spec_s": dict(zip(["f_khz", "db"], spec_xy(res.spectrum_sampled_f / 1e3, res.spectrum_sampled_db, 700, fmax / 1e3))),
            "nyquist_khz": s(nyq / 1e3),
            "fm_khz": s(cfg.fm / 1e3),
            "alias": bool(res.metrics.get("alias")),
            "xmax_khz": s(fmax / 1e3),
            "bits_curve": {
                "n_bits": [int(v) for v in bits_curve["n_bits"]],
                "sqnr_theory_db": [s(float(v)) for v in bits_curve["sqnr_theory_db"]],
                "sqnr_quant_db": [s(float(v)) for v in bits_curve["sqnr_quant_db"]],
                "sqnr_rec_db": [s(float(v)) for v in bits_curve["sqnr_rec_db"]],
                "current_n": int(cfg.n_bits),
                "current_sqnr": s(res.sqnr_db),
            },
            "link_curve": {
                "ebn0_db": [s(float(v)) for v in link_curve["ebn0_db"]],
                "sqnr_db": [s(float(v)) for v in link_curve["sqnr_db"]],
                "quant_limit_db": s(res.sqnr_quant_db),
                "current_ebn0": s(res.ebn0_eff_db),
                "current_sqnr": s(res.sqnr_db),
            },
        }
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


DISPATCH = {"am": run_am, "ask": run_ask, "fsk": run_fsk, "pcm": run_pcm}


def run(module: str, params_json: str) -> str:
    try:
        params = json.loads(params_json) if isinstance(params_json, str) else (params_json or {})
        fn = DISPATCH.get(str(module).lower())
        if not fn:
            return json.dumps({"ok": False, "error": f"Módulo desconocido: {module}"})
        return json.dumps(fn(params))
    except Exception as e:
        traceback.print_exc()
        return json.dumps({"ok": False, "error": str(e)})
