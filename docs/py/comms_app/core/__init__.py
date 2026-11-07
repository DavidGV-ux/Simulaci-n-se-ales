"""Núcleo de simulación (sin dependencias de la interfaz)."""

from .analog import AMConfig, AMResult, simulate_am
from .channel import ChannelConfig, ChannelReport, apply_channel, fsl_db
from .digital import (
    ASKConfig,
    BPSKConfig,
    DigitalResult,
    FSKConfig,
    ber_theory,
    make_bits,
    simulate_ask,
    simulate_bpsk,
    simulate_fsk,
)
from .pcm import PCMConfig, PCMResult, simulate_pcm

__all__ = [
    "AMConfig",
    "AMResult",
    "simulate_am",
    "ChannelConfig",
    "ChannelReport",
    "apply_channel",
    "fsl_db",
    "ASKConfig",
    "BPSKConfig",
    "DigitalResult",
    "FSKConfig",
    "ber_theory",
    "make_bits",
    "simulate_ask",
    "simulate_bpsk",
    "simulate_fsk",
    "PCMConfig",
    "PCMResult",
    "simulate_pcm",
]
