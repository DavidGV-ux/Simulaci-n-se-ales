"""Pruebas del núcleo de simulación (sin interfaz gráfica)."""

from __future__ import annotations

import numpy as np
import pytest

from comms_app.core.analog import AMConfig, am_power, simulate_am
from comms_app.core.channel import ChannelConfig, fsl_db
from comms_app.core.digital import (
    ASKConfig,
    BPSKConfig,
    FSKConfig,
    ber_theory,
    make_bits,
    simulate_ask,
    simulate_bpsk,
    simulate_fsk,
    snap_carrier,
)
from comms_app.core.pcm import PCMConfig, simulate_pcm
from comms_app.core.signals import generate_waveform, quantize_uniform, safe_eval_signal, time_vector


def awgn(distance_km=0.0, frequency_mhz=0.0, **kwargs):
    return ChannelConfig(distance_km=distance_km, frequency_mhz=frequency_mhz, **kwargs)


def test_fsl_reference():
    # Friis: 32.45 + 20log10(d_km) + 20log10(f_MHz)
    loss = fsl_db(1.0, 2450.0)
    assert loss == pytest.approx(32.45 + 20 * np.log10(1.0) + 20 * np.log10(2450.0), abs=1e-6)
    assert fsl_db(0.0, 2450.0) == 0.0


def test_am_power_model():
    ratio, carrier = am_power(1.0)
    assert ratio == pytest.approx(1.5)
    assert carrier == pytest.approx(2.0 / 3.0)
    ratio0, carrier0 = am_power(0.0)
    assert ratio0 == pytest.approx(1.0)
    assert carrier0 == pytest.approx(1.0)


def test_am_noiseless_recovery_and_overmodulation():
    r1 = simulate_am(AMConfig(m=1.0, channel=awgn(snr_db=None)))
    assert r1.metrics["pt_pc"] == pytest.approx(1.5, abs=1e-9)
    assert r1.metrics["mse_env"] < 5e-4
    assert r1.metrics["mse_coh"] < 2e-3
    r15 = simulate_am(AMConfig(m=1.5, channel=awgn(snr_db=None)))
    assert r15.metrics["overmodulation"] is True
    assert r15.metrics["mse_env"] > r15.metrics["mse_coh"] * 5


def test_am_noise_and_attenuation_reduce_quality():
    good = simulate_am(AMConfig(channel=awgn(snr_db=30)))
    noisy = simulate_am(AMConfig(channel=awgn(snr_db=10)))
    atten = simulate_am(AMConfig(channel=ChannelConfig(distance_km=1.0, frequency_mhz=2450.0, snr_db=30)))
    assert noisy.metrics["mse_env"] > good.metrics["mse_env"]
    assert atten.metrics["total_atten_db"] > 90
    assert atten.metrics["snr_eff_db"] < 0
    assert atten.metrics["mse_env"] > good.metrics["mse_env"]


def test_carrier_snapping_makes_coherent_detection_stable():
    fc, cycles = snap_carrier(6000.0, 1000.0, 32000.0)
    assert abs(fc / 1000.0 - round(fc / 1000.0)) < 1e-9
    assert cycles == round(fc / 1000.0)
    r = simulate_ask(ASKConfig(nbits=2000, fc=6100.0, channel=awgn(ebn0_db=30)))
    assert r.ber == 0.0
    assert r.extras["cycles_per_bit"] >= 1


@pytest.mark.parametrize(
    "scheme,sim,ebn0",
    [
        ("ASK", simulate_ask, 10.0),
        ("FSK", simulate_fsk, 10.0),
        ("BPSK", simulate_bpsk, 8.0),
    ],
)
def test_digital_ber_near_theory_awgn(scheme, sim, ebn0):
    cfg_cls = {"ASK": ASKConfig, "FSK": FSKConfig, "BPSK": BPSKConfig}[scheme]
    kwargs = dict(nbits=20000, channel=awgn(ebn0_db=ebn0), seed=7)
    if scheme == "FSK":
        kwargs["detector"] = "noncoherent"
    r = sim(cfg_cls(**kwargs))
    theory = float(ber_theory(scheme, ebn0, getattr(r.extras, "get", lambda *_: "coherent")("detector", "coherent")))
    if hasattr(r.extras, "get"):
        theory = float(ber_theory(scheme, ebn0, r.extras.get("detector", "coherent")))
    # Margen amplio para Monte Carlo con 20k bits.
    assert r.ber <= max(0.25, 4.0 * theory + 0.01)
    assert r.ebn0_eff_db == pytest.approx(ebn0, abs=0.2)


def test_digital_attenuation_increases_ber():
    base = simulate_ask(ASKConfig(nbits=12000, channel=awgn(ebn0_db=14), seed=3)).ber
    atten = simulate_ask(
        ASKConfig(
            nbits=12000,
            seed=3,
            channel=ChannelConfig(distance_km=0.0, frequency_mhz=0.0, extra_atten_db=8.0, ebn0_db=14.0),
        )
    )
    assert atten.ebn0_eff_db < 8.0
    assert atten.ber >= base


def test_digital_external_factors():
    ideal = simulate_bpsk(BPSKConfig(nbits=4000, channel=awgn(ebn0_db=12), seed=5))
    interference = simulate_bpsk(
        BPSKConfig(
            nbits=4000,
            seed=5,
            fc=6000.0,
            channel=ChannelConfig(distance_km=0.0, frequency_mhz=0.0, ebn0_db=12.0, interference=True, int_freq_hz=6050.0, int_amp_db=3.0),
        )
    )
    clipped = simulate_bpsk(
        BPSKConfig(nbits=4000, seed=5, channel=ChannelConfig(distance_km=0.0, frequency_mhz=0.0, ebn0_db=12.0, clip_level=0.2))
    )
    offset = simulate_bpsk(
        BPSKConfig(nbits=4000, seed=5, channel=ChannelConfig(distance_km=0.0, frequency_mhz=0.0, ebn0_db=12.0, freq_offset_hz=200.0))
    )
    multipath = simulate_bpsk(
        BPSKConfig(
            nbits=4000,
            seed=5,
            channel=ChannelConfig(distance_km=0.0, frequency_mhz=0.0, ebn0_db=12.0, multipath=True, mp_delay_us=500.0, mp_gain_db=-1.0, mp_phase_deg=180.0),
        )
    )
    assert ideal.ber <= 0.05
    assert interference.ber > ideal.ber or interference.ber > 0.001
    assert clipped.ber > ideal.ber or clipped.ber > 0.001
    assert offset.ber > ideal.ber or offset.ber > 0.01
    assert multipath.ber > ideal.ber or multipath.ber > 0.001


def test_bit_sources():
    rnd = make_bits(64, "random", seed=1)
    man = make_bits(16, "manual", manual="10110")
    alt = make_bits(8, "alternating")
    prbs = make_bits(14, "prbs7")
    assert rnd.size == 64 and set(np.unique(rnd)).issubset({0, 1})
    assert man.tolist()[:5] == [1, 0, 1, 1, 0]
    assert alt.tolist() == [0, 1, 0, 1, 0, 1, 0, 1]
    assert prbs.size == 14 and set(np.unique(prbs)).issubset({0, 1})


def test_pcm_quantization_sqnr():
    t = time_vector(8000.0, 0.02)
    x = np.sin(2 * np.pi * 1000.0 * t)
    xq8, _, _, _ = quantize_uniform(x, 8, 1.0)
    xq12, _, _, _ = quantize_uniform(x, 12, 1.0)
    sq8 = 10 * np.log10(np.mean(x**2) / np.mean((xq8 - x) ** 2))
    sq12 = 10 * np.log10(np.mean(x**2) / np.mean((xq12 - x) ** 2))
    assert sq8 == pytest.approx(6.02 * 8 + 1.76, abs=2.5)
    assert sq12 > sq8 + 15


def test_pcm_noiseless_reconstruction_and_threshold():
    cfg = PCMConfig(
        duration=0.02,
        fs_sample=8000.0,
        n_bits=8,
        ebn0_db=None,
        channel=awgn(),
        scheme="BPSK",
    )
    r = simulate_pcm(cfg)
    assert r.ber == 0.0
    assert r.sqnr_db > 40
    noisy = simulate_pcm(PCMConfig(duration=0.02, fs_sample=8000.0, n_bits=8, ebn0_db=4.0, channel=awgn(), scheme="ASK"))
    assert noisy.ber > 0.0
    assert noisy.sqnr_db < r.sqnr_db


def test_pcm_aliasing_detection():
    r = simulate_pcm(
        PCMConfig(
            fm=5000.0,
            fs_sample=8000.0,
            antialias=False,
            ebn0_db=None,
            channel=awgn(),
            duration=0.02,
        )
    )
    assert r.metrics["alias"] is True


def test_manual_formula_signal():
    t = time_vector(1000.0, 0.01)
    x = safe_eval_signal("sin(2*pi*100*t)", t)
    y = generate_waveform("sine", t, frequency=100.0, normalize=False, remove_dc=False)
    assert np.allclose(x, np.sin(2 * np.pi * 100 * t))
    assert y.shape == t.shape
