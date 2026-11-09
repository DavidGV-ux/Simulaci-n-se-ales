/**
 * channel.js
 * Modelo físico de canal: pérdida de espacio libre (Friis), atenuación extra,
 * multitrayecto, interferencia, offset de portadora, ruido de fase y AWGN reproducible.
 */

import { hilbert } from "./signal_generator.js";

export function fslDb(distanceKm, frequencyMHz) {
    if (distanceKm <= 0 || frequencyMHz <= 0) return 0.0;
    return 32.45 + 20.0 * Math.log10(distanceKm) + 20.0 * Math.log10(frequencyMHz);
}

/**
 * Generador pseudo-aleatorio de 32 bits (Mulberry32) reproducible con semilla.
 */
export function createPRNG(seed = 1) {
    let s = Math.floor(Math.abs(seed)) || 1;
    return function next() {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
    };
}

/**
 * Generador de distribución Normal(0, 1) mediante transformada de Box-Muller.
 */
export function createGaussian(prng) {
    let hasSpare = false;
    let spare = 0.0;
    return function nextGaussian(mean = 0.0, std = 1.0) {
        if (hasSpare) {
            hasSpare = false;
            return mean + std * spare;
        }
        let u = 0, v = 0;
        while (u === 0) u = prng();
        while (v === 0) v = prng();
        const r = Math.sqrt(-2.0 * Math.log(u));
        const theta = 2.0 * Math.PI * v;
        spare = r * Math.sin(theta);
        hasSpare = true;
        return mean + std * (r * Math.cos(theta));
    };
}

function phaseShiftReal(x, phaseRad) {
    if (Math.abs(Math.sin(phaseRad)) < 1e-12) {
        const cosP = Math.cos(phaseRad);
        const out = new Float64Array(x.length);
        for (let i = 0; i < x.length; i++) out[i] = x[i] * cosP;
        return out;
    }
    const { real, imag } = hilbert(x);
    const cosP = Math.cos(phaseRad);
    const sinP = Math.sin(phaseRad);
    const n = x.length;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = real[i] * cosP - imag[i] * sinP;
    }
    return out;
}

function frequencyShift(x, fs, dfHz) {
    if (Math.abs(dfHz) < 1e-12 || x.length < 8) {
        return new Float64Array(x);
    }
    const { real, imag } = hilbert(x);
    const n = x.length;
    const out = new Float64Array(n);
    const dt = 1.0 / fs;
    const twoPiDf = 2.0 * Math.PI * dfHz;
    for (let i = 0; i < n; i++) {
        const angle = twoPiDf * (i * dt);
        out[i] = real[i] * Math.cos(angle) - imag[i] * Math.sin(angle);
    }
    return out;
}

export function applyChannel(x, fs, cfg = {}, options = {}) {
    const {
        distanceKm = 1.0,
        frequencyMHz = 2450.0,
        extraAttenDb = 0.0,
        snrDb = null,
        ebn0Db = null,
        eb = null,
        noiseBandwidthHz = null,
        multipath = false,
        mpDelayUs = 1.0,
        mpGainDb = -6.0,
        mpPhaseDeg = 180.0,
        gainStepDb = 0.0,
        gainStepAt = 0.5,
        freqOffsetHz = 0.0,
        phaseNoiseRms = 0.0,
        interference = false,
        intFreqHz = 0.0,
        intAmpDb = -20.0,
        clipLevel = null,
        seed = 1,
    } = cfg;

    const n = x.length;
    if (n < 2) throw new Error("La señal debe tener al menos dos muestras");
    if (fs <= 0) throw new Error("fs debe ser positivo");

    const t = options.t || new Float64Array(n);
    if (!options.t) {
        const dt = 1.0 / fs;
        for (let i = 0; i < n; i++) t[i] = i * dt;
    }
    const prng = options.prng || createPRNG(seed);
    const nextGauss = createGaussian(prng);

    const pathLoss = fslDb(distanceKm, frequencyMHz);
    const totalAtten = pathLoss + Math.max(0.0, extraAttenDb);
    const gain = Math.pow(10.0, -totalAtten / 20.0);

    let y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = gain * x[i];

    // Multitrayecto (eco con retardo y desfase)
    if (multipath && mpDelayUs > 0) {
        const delay = Math.round(mpDelayUs * 1e-6 * fs);
        if (delay > 0 && delay < n) {
            const echoRaw = new Float64Array(n);
            for (let i = delay; i < n; i++) {
                echoRaw[i] = x[i - delay];
            }
            const echoShifted = phaseShiftReal(echoRaw, (mpPhaseDeg * Math.PI) / 180.0);
            const echoGain = gain * Math.pow(10.0, mpGainDb / 20.0);
            for (let i = 0; i < n; i++) {
                y[i] += echoGain * echoShifted[i];
            }
        }
    }

    // Salto de ganancia (AGC / fade repentino)
    if (Math.abs(gainStepDb) > 1e-9) {
        const idx = Math.floor(Math.max(0.0, Math.min(1.0, gainStepAt)) * n);
        const step = Math.pow(10.0, gainStepDb / 20.0);
        for (let i = idx; i < n; i++) y[i] *= step;
    }

    // Offset de frecuencia (CFO)
    if (Math.abs(freqOffsetHz) > 1e-9) {
        y = frequencyShift(y, fs, freqOffsetHz);
    }

    // Ruido de fase RMS
    if (phaseNoiseRms > 0) {
        const { real, imag } = hilbert(y);
        for (let i = 0; i < n; i++) {
            const phi = nextGauss(0.0, phaseNoiseRms);
            y[i] = real[i] * Math.cos(phi) - imag[i] * Math.sin(phi);
        }
    }

    // Tono de interferencia
    if (interference && intFreqHz > 0) {
        let sumSq = 0;
        for (let i = 0; i < n; i++) sumSq += x[i] * x[i];
        const refRms = Math.sqrt(sumSq / n) || 1.0;
        const amp = refRms * Math.pow(10.0, intAmpDb / 20.0);
        const twoPiIntF = 2.0 * Math.PI * intFreqHz;
        for (let i = 0; i < n; i++) {
            y[i] += amp * Math.cos(twoPiIntF * t[i] + 0.37);
        }
    }

    // Recorte no lineal (saturación)
    if (clipLevel !== null && clipLevel > 0) {
        for (let i = 0; i < n; i++) {
            if (y[i] > clipLevel) y[i] = clipLevel;
            else if (y[i] < -clipLevel) y[i] = -clipLevel;
        }
    }

    const clean = new Float64Array(y);

    // Adición de Ruido AWGN
    let pNoise = 0.0;
    let n0 = 0.0;
    let bwNoise = noiseBandwidthHz && noiseBandwidthHz > 0 ? Math.min(noiseBandwidthHz, fs * 0.5) : fs * 0.5;

    if (snrDb !== null && isFinite(snrDb)) {
        let pRef = 0.0;
        for (let i = 0; i < n; i++) pRef += x[i] * x[i];
        pRef /= n;
        // Escala para que dentro del ancho de banda útil B valga pRef / 10^(snr/10)
        pNoise = (pRef / Math.pow(10.0, snrDb / 10.0)) * (fs * 0.5) / Math.max(bwNoise, 1e-9);
        const stdNoise = Math.sqrt(Math.max(pNoise, 0.0));
        for (let i = 0; i < n; i++) {
            y[i] += nextGauss(0.0, stdNoise);
        }
    } else if (ebn0Db !== null && isFinite(ebn0Db) && eb !== null && eb > 0) {
        n0 = eb / Math.pow(10.0, ebn0Db / 10.0);
        pNoise = n0 * (fs * 0.5);
        const stdNoise = Math.sqrt(Math.max(pNoise, 0.0));
        for (let i = 0; i < n; i++) {
            y[i] += nextGauss(0.0, stdNoise);
        }
    }

    let pClean = 0.0;
    for (let i = 0; i < n; i++) pClean += clean[i] * clean[i];
    pClean /= n;

    const snrEff = pNoise > 0 ? 10.0 * Math.log10(Math.max(pClean, 1e-30) / Math.max(pNoise, 1e-30)) : Infinity;
    const snrBand = pNoise > 0
        ? 10.0 * Math.log10((Math.max(pClean, 1e-30) / Math.max(pNoise, 1e-30)) * (fs * 0.5) / Math.max(bwNoise, 1e-9))
        : Infinity;

    let ebn0Eff = Infinity;
    if (n0 > 0 && eb !== null) {
        let scale = pClean / Math.max(1e-30, rmsX(x));
        let ebRx = eb * scale;
        ebn0Eff = 10.0 * Math.log10(Math.max(ebRx, 1e-30) / Math.max(n0, 1e-30));
    }

    const report = {
        pathLossDb: pathLoss,
        totalAttenDb: totalAtten,
        gainLinear: gain,
        noisePower: pNoise,
        snrEffDb: snrEff,
        snrBandDb: snrBand,
        ebn0EffDb: ebn0Eff,
        n0,
        noiseBandwidthHz: bwNoise,
    };

    return { rx: y, report, clean };
}

function rmsX(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return s / x.length;
}

