/**
 * modulations.js
 * Modulaciones analógicas y digitales: AM, ASK/OOK, FSK, BPSK y PCM.
 * Detectores, cálculo de BER, diagramas de ojo y curvas de barrido analítico.
 */

import {
    timeVector,
    generateWaveform,
    butterworthLowpassFilter,
    antiAliasFilter,
    spectrum,
    hilbert,
    mse,
    correlation,
    signalBandwidth,
    zeroMean,
    quantizeUniform,
    pcmEncode,
    pcmDecode,
    zeroOrderHold,
    sincInterp,
    rfft,
} from "./signal_generator.js";

import { applyChannel, createPRNG } from "./channel.js";

// ---------------------------------------------------------------------------
// Funciones Matemáticas de Probabilidad y BER
// ---------------------------------------------------------------------------
export function erfc(x) {
    if (x < 0) return 2.0 - erfc(-x);
    // Aproximación de Abramowitz & Stegun 7.1.26 con error < 1.5e-7
    const p = 0.3275911;
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;

    const t = 1.0 / (1.0 + p * x);
    const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
    return poly * Math.exp(-x * x);
}

export function qfunc(x) {
    return 0.5 * erfc(x / Math.SQRT2);
}

export function bandSnrDb(ebn0Db, rb, bandwidthHz) {
    if (bandwidthHz <= 0 || rb <= 0 || !isFinite(ebn0Db)) return ebn0Db;
    return ebn0Db + 10.0 * Math.log10(rb / bandwidthHz);
}

export function berTheory(scheme, ebn0Db, detector = "coherent") {
    const g = Math.pow(10.0, ebn0Db / 10.0);
    const s = scheme.toUpperCase();
    const noncoherent = detector.toLowerCase().startsWith("non") || detector.toLowerCase().startsWith("env") || detector.toLowerCase().startsWith("no");

    if (s === "ASK") {
        if (noncoherent) return 0.5 * Math.exp(-g / 2.0);
        return qfunc(Math.sqrt(g));
    }
    if (s === "BPSK") {
        return qfunc(Math.sqrt(2.0 * g));
    }
    if (s === "FSK") {
        if (noncoherent) return 0.5 * Math.exp(-g / 2.0);
        return qfunc(Math.sqrt(g));
    }
    return 0.0;
}

export function amPower(m) {
    const ratio = 1.0 + 0.5 * m * m;
    return {
        ptPc: ratio,
        carrierFraction: 1.0 / ratio,
        sidebandFraction: (0.5 * m * m) / ratio,
    };
}

export function snapCarrier(fc, rb, fs, minCycles = 1) {
    const maxCycles = Math.max(1, Math.floor((0.5 * fs - 1e-9) / rb));
    let cycles = Math.round(fc / rb);
    cycles = Math.max(minCycles, Math.min(cycles, maxCycles));
    return { fc: cycles * rb, cycles };
}

export function makeBits(nbits, mode = "random", manual = "10110010", seed = 1) {
    nbits = Math.max(1, Math.floor(nbits));
    const m = mode.toLowerCase();
    const out = new Uint8Array(nbits);

    if (m === "random") {
        const prng = createPRNG(seed);
        for (let i = 0; i < nbits; i++) {
            out[i] = prng() < 0.5 ? 0 : 1;
        }
        return out;
    }
    if (m === "manual") {
        const clean = manual.replace(/[^01]/g, "");
        if (!clean) throw new Error("Secuencia binaria manual vacía");
        const clen = clean.length;
        for (let i = 0; i < nbits; i++) {
            out[i] = clean.charCodeAt(i % clen) === 49 ? 1 : 0;
        }
        return out;
    }
    if (m === "alternating") {
        for (let i = 0; i < nbits; i++) {
            out[i] = i % 2;
        }
        return out;
    }
    if (m === "prbs7") {
        let state = 0x7f;
        for (let i = 0; i < nbits; i++) {
            const bit = ((state >> 6) ^ (state >> 5)) & 1;
            state = ((state << 1) | bit) & 0x7f;
            out[i] = bit;
        }
        return out;
    }
    throw new Error(`Modo de bits desconocido: ${mode}`);
}

export function bitWindows(x, nbits, sps, offsetFrac = 0.0) {
    const offset = Math.round(offsetFrac * sps);
    const rows = [];
    const n = x.length;
    for (let b = 0; b < nbits; b++) {
        const start = b * sps + offset;
        if (start >= 0 && start + sps <= n) {
            rows.push(x.subarray(start, start + sps));
        } else {
            const row = new Float64Array(sps);
            for (let s = 0; s < sps; s++) {
                const idx = start + s;
                row[s] = idx < 0 ? x[0] : (idx >= n ? x[n - 1] : x[idx]);
            }
            rows.push(row);
        }
    }
    return rows;
}

// Filtro pasabanda ideal en frecuencia para frecuencia intermedia (FI)
function bandpassFFT(x, fs, center, width) {
    const n = x.length;
    const lo = Math.max(0.0, center - 0.5 * width);
    const hi = Math.min(0.5 * fs, center + 0.5 * width);
    if (hi <= lo) return new Float64Array(x);

    const { real, imag, N } = rfft(x);
    const nBins = real.length;
    const df = fs / N;
    for (let i = 0; i < nBins; i++) {
        const f = i * df;
        if (f < lo || f > hi) {
            real[i] = 0.0;
            imag[i] = 0.0;
        }
    }
    // IFFT
    const fullReal = new Float64Array(N);
    const fullImag = new Float64Array(N);
    for (let i = 0; i < nBins; i++) {
        fullReal[i] = real[i];
        fullImag[i] = imag[i];
    }
    for (let i = 1; i < (N >> 1); i++) {
        fullReal[N - i] = real[i];
        fullImag[N - i] = -imag[i];
    }
    // Inverse FFT Cooley-Tukey
    bitReverseCore(fullReal, fullImag, N);
    fftCore(fullReal, fullImag, N, 1);
    const invN = 1.0 / N;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = fullReal[i] * invN;
    }
    return out;
}

function bitReverseCore(real, imag, N) {
    let j = 0;
    for (let i = 0; i < N - 1; i++) {
        if (i < j) {
            let tr = real[i]; real[i] = real[j]; real[j] = tr;
            let ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
        }
        let k = N >> 1;
        while (k <= j) {
            j -= k;
            k >>= 1;
        }
        j += k;
    }
}

function fftCore(real, imag, N, direction) {
    for (let len = 2; len <= N; len <<= 1) {
        const halfLen = len >> 1;
        const angle = (direction * 2.0 * Math.PI) / len;
        const wStepReal = Math.cos(angle);
        const wStepImag = Math.sin(angle);
        for (let i = 0; i < N; i += len) {
            let wReal = 1.0;
            let wImag = 0.0;
            for (let j = 0; j < halfLen; j++) {
                const uReal = real[i + j];
                const uImag = imag[i + j];
                const vReal = real[i + j + halfLen] * wReal - imag[i + j + halfLen] * wImag;
                const vImag = real[i + j + halfLen] * wImag + imag[i + j + halfLen] * wReal;
                real[i + j] = uReal + vReal;
                imag[i + j] = uImag + vImag;
                real[i + j + halfLen] = uReal - vReal;
                imag[i + j + halfLen] = uImag - vImag;
                const nextWReal = wReal * wStepReal - wImag * wStepImag;
                wImag = wReal * wStepImag + wImag * wStepReal;
                wReal = nextWReal;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Simulador AM (Modulación de Amplitud)
// ---------------------------------------------------------------------------
export function simulateAM(cfg) {
    const {
        waveform = "sine",
        fm = 1000.0,
        phaseDeg = 0.0,
        duty = 0.5,
        fEnd = null,
        formula = null,
        csvT = null,
        csvX = null,
        Vp = 1.0,
        fc = 20000.0,
        m = 0.8,
        fs = 400000.0,
        duration = 0.005,
        channel = {},
    } = cfg;

    if (fs <= 2.0 * fc) throw new Error("fs debe ser mayor que 2·fc");
    if (fc <= fm) throw new Error("fc debe ser mayor que fm");
    if (m < 0) throw new Error("El índice m no puede ser negativo");

    const t = timeVector(fs, duration);
    const n = t.length;
    const msg = generateWaveform(waveform, t, {
        amplitude: 1.0,
        frequency: fm,
        phaseDeg,
        duty,
        fEnd,
        formula,
        csvT,
        csvX,
        normalize: true,
        removeDC: true,
    });

    const tx = new Float64Array(n);
    const twoPiFc = 2.0 * Math.PI * fc;
    for (let i = 0; i < n; i++) {
        const carrier = Math.sin(twoPiFc * t[i]);
        tx[i] = Vp * (1.0 + m * msg[i]) * carrier;
    }

    const chanCfg = { ...channel, noiseBandwidthHz: Math.max(2.0 * fm, 1.0) };
    const { rx, report, clean } = applyChannel(tx, fs, chanCfg, { t });

    // Filtro IF de receptor (ancho 2.2*fm)
    const bIf = Math.min(Math.max(2.2 * fm, 1.0), Math.max(0.1 * fm, 0.96 * fs - 2.0 * fc));
    const rxIf = bandpassFFT(rx, fs, fc, bIf);

    // Detector de envolvente
    const { envelope: envRaw } = hilbert(rxIf);
    const cutoff = Math.min(0.45 * fs, Math.max(2.5 * fm, 50.0));
    const envLp = butterworthLowpassFilter(envRaw, fs, cutoff, 4);
    const envZero = zeroMean(envLp);
    const denomEnv = m * Vp * report.gainLinear;
    const env = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        env[i] = Math.abs(denomEnv) > 1e-12 ? envZero[i] / denomEnv : envZero[i];
    }

    // Detector coherente
    const cohRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        cohRaw[i] = 2.0 * rxIf[i] * Math.sin(twoPiFc * t[i]);
    }
    const cohLp = butterworthLowpassFilter(cohRaw, fs, cutoff, 4);
    const cohZero = zeroMean(cohLp);
    const coh = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        coh[i] = Math.abs(denomEnv) > 1e-12 ? cohZero[i] / denomEnv : cohZero[i];
    }

    const trim = Math.max(5, Math.min(Math.floor(n / 4), Math.round((2.0 * fs) / Math.max(fm, 1.0))));
    const envErr = new Float64Array(n);
    const cohErr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        envErr[i] = env[i] - msg[i];
        cohErr[i] = coh[i] - msg[i];
    }

    const { ptPc, carrierFraction, sidebandFraction } = amPower(m);
    const specTx = spectrum(tx, fs);
    const specRx = spectrum(rx, fs);

    const metrics = {
        m,
        mPercent: 100.0 * m,
        overmodulation: m > 1.0,
        ptPc,
        carrierFraction,
        sidebandFraction,
        mseEnv: mse(msg, env, trim),
        mseCoh: mse(msg, coh, trim),
        corrEnv: correlation(msg, env, trim),
        corrCoh: correlation(msg, coh, trim),
        snrEffDb: report.snrBandDb,
        snrTotalDb: report.snrEffDb,
        noiseBandwidthHz: report.noiseBandwidthHz,
        ifBandwidthHz: bIf,
        pathLossDb: report.pathLossDb,
        totalAttenDb: report.totalAttenDb,
        bwTxHz: signalBandwidth(tx, fs),
        bwRxHz: signalBandwidth(rx, fs),
        vm: m * Vp,
        ptDbm: 10.0 * Math.log10((Math.max(Vp * Vp * 0.5, 1e-30) * ptPc) / 1e-3),
    };

    return {
        t,
        message: msg,
        tx,
        rx,
        clean,
        env,
        coh,
        envErr,
        cohErr,
        spectrumTxF: specTx.f,
        spectrumTxDb: specTx.mag,
        spectrumRxF: specRx.f,
        spectrumRxDb: specRx.mag,
        report,
        metrics,
    };
}

// ---------------------------------------------------------------------------
// 2. Simulador ASK / OOK
// ---------------------------------------------------------------------------
export function simulateASK(cfg) {
    const {
        nbits = 200,
        bitMode = "random",
        manualBits = "10110010",
        rb = 1000.0,
        fc = 6000.0,
        amplitude = 1.0,
        sps = 32,
        detector = "coherent",
        agcErrorDb = 0.0,
        timingOffsetFrac = 0.0,
        seed = 1,
        channel = {},
    } = cfg;

    const bits = makeBits(nbits, bitMode, manualBits, seed);
    const nBits = bits.length;
    const fs = sps * rb;
    const tb = 1.0 / rb;
    const totalSamples = nBits * sps;
    const t = new Float64Array(totalSamples);
    const dt = 1.0 / fs;
    for (let i = 0; i < totalSamples; i++) t[i] = i * dt;

    const { fc: realFc, cycles: fcCycles } = snapCarrier(fc, rb, fs);
    const tx = new Float64Array(totalSamples);
    const twoPiFc = 2.0 * Math.PI * realFc;

    let sampleIdx = 0;
    for (let b = 0; b < nBits; b++) {
        const bitVal = bits[b];
        for (let s = 0; s < sps; s++) {
            tx[sampleIdx] = bitVal * amplitude * Math.cos(twoPiFc * t[sampleIdx]);
            sampleIdx++;
        }
    }

    const eb = (amplitude * amplitude * tb) / 4.0;
    const chanCfg = { ...channel, eb, seed };
    const { rx, report, clean } = applyChannel(tx, fs, chanCfg, { t });

    const detected = new Uint8Array(nBits);
    let threshold = 0.0;
    const gainFactor = report.gainLinear * Math.pow(10.0, agcErrorDb / 20.0);

    if (detector.toLowerCase().startsWith("env")) {
        const { envelope } = hilbert(rx);
        const win = bitWindows(envelope, nBits, sps, timingOffsetFrac);
        threshold = 0.5 * amplitude * gainFactor;
        const mid = Math.floor(sps / 2);
        for (let b = 0; b < nBits; b++) {
            detected[b] = win[b][mid] > threshold ? 1 : 0;
        }
    } else {
        const ref = new Float64Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) ref[i] = amplitude * Math.cos(twoPiFc * t[i]);
        const refWin = bitWindows(ref, nBits, sps, timingOffsetFrac);
        const rxWin = bitWindows(rx, nBits, sps, timingOffsetFrac);

        let e1Sum = 0;
        for (let b = 0; b < nBits; b++) {
            let rowSq = 0;
            for (let s = 0; s < sps; s++) rowSq += refWin[b][s] * refWin[b][s];
            e1Sum += rowSq / fs;
        }
        const e1 = e1Sum / nBits;
        threshold = 0.5 * e1 * gainFactor;

        for (let b = 0; b < nBits; b++) {
            let corr = 0.0;
            for (let s = 0; s < sps; s++) {
                corr += rxWin[b][s] * refWin[b][s];
            }
            corr /= fs;
            detected[b] = corr > threshold ? 1 : 0;
        }
    }

    let errors = 0;
    for (let b = 0; b < nBits; b++) {
        if (detected[b] !== bits[b]) errors++;
    }
    const ber = errors / Math.max(1, nBits);
    const spec = spectrum(tx, fs);
    const eye = bitWindows(rx, Math.min(nBits, 160), sps, timingOffsetFrac);

    return {
        scheme: "ASK",
        t,
        bits,
        tx,
        rx,
        clean,
        detected,
        ber,
        errors,
        nbits: nBits,
        fs,
        rb,
        sps,
        report,
        ebn0EffDb: report.ebn0EffDb,
        snrEffDb: report.snrEffDb,
        spectrumF: spec.f,
        spectrumDb: spec.mag,
        eye,
        extras: {
            eb,
            fc: realFc,
            cyclesPerBit: fcCycles,
            threshold,
            detector,
            bandwidthHz: 2.0 * rb,
            snrBandDb: bandSnrDb(report.ebn0EffDb, rb, 2.0 * rb),
            efficiencyBpsHz: rb / (2.0 * rb),
        },
    };
}

// ---------------------------------------------------------------------------
// 3. Simulador FSK (Desplazamiento de Frecuencia)
// ---------------------------------------------------------------------------
export function simulateFSK(cfg) {
    const {
        nbits = 200,
        bitMode = "random",
        manualBits = "10110010",
        rb = 1000.0,
        fc = 6000.0,
        amplitude = 1.0,
        sps = 32,
        modulationIndex = 1.0,
        detector = "noncoherent",
        timingOffsetFrac = 0.0,
        seed = 1,
        channel = {},
    } = cfg;

    const bits = makeBits(nbits, bitMode, manualBits, seed);
    const nBits = bits.length;
    const fs = sps * rb;
    const tb = 1.0 / rb;
    const df = 0.5 * modulationIndex * rb;
    const f0 = Math.max(1.0, fc - df);
    const f1 = fc + df;

    const totalSamples = nBits * sps;
    const t = new Float64Array(totalSamples);
    const dt = 1.0 / fs;
    for (let i = 0; i < totalSamples; i++) t[i] = i * dt;

    // Bit tone templates
    const tone0 = new Float64Array(sps);
    const tone1 = new Float64Array(sps);
    for (let s = 0; s < sps; s++) {
        const ts = s * dt;
        tone0[s] = amplitude * Math.cos(2.0 * Math.PI * f0 * ts);
        tone1[s] = amplitude * Math.cos(2.0 * Math.PI * f1 * ts);
    }

    const tx = new Float64Array(totalSamples);
    let sampleIdx = 0;
    for (let b = 0; b < nBits; b++) {
        const tone = bits[b] === 1 ? tone1 : tone0;
        for (let s = 0; s < sps; s++) {
            tx[sampleIdx++] = tone[s];
        }
    }

    const eb = (amplitude * amplitude * tb) / 2.0;
    const chanCfg = { ...channel, eb, seed };
    const { rx, report, clean } = applyChannel(tx, fs, chanCfg, { t });

    const offsetSamples = timingOffsetFrac * sps;
    const c0 = new Float64Array(sps);
    const s0 = new Float64Array(sps);
    const c1 = new Float64Array(sps);
    const s1 = new Float64Array(sps);
    for (let s = 0; s < sps; s++) {
        const tl = (s + offsetSamples) * dt;
        c0[s] = Math.cos(2.0 * Math.PI * f0 * tl);
        s0[s] = Math.sin(2.0 * Math.PI * f0 * tl);
        c1[s] = Math.cos(2.0 * Math.PI * f1 * tl);
        s1[s] = Math.sin(2.0 * Math.PI * f1 * tl);
    }

    const win = bitWindows(rx, nBits, sps, timingOffsetFrac);
    const detected = new Uint8Array(nBits);
    const coherent = detector.toLowerCase().startsWith("coh");

    if (coherent) {
        for (let b = 0; b < nBits; b++) {
            let corr0 = 0, corr1 = 0;
            const row = win[b];
            for (let s = 0; s < sps; s++) {
                corr0 += row[s] * c0[s];
                corr1 += row[s] * c1[s];
            }
            detected[b] = corr1 > corr0 ? 1 : 0;
        }
    } else {
        for (let b = 0; b < nBits; b++) {
            let i0 = 0, q0 = 0, i1 = 0, q1 = 0;
            const row = win[b];
            for (let s = 0; s < sps; s++) {
                i0 += row[s] * c0[s];
                q0 += row[s] * s0[s];
                i1 += row[s] * c1[s];
                q1 += row[s] * s1[s];
            }
            const e0 = i0 * i0 + q0 * q0;
            const e1 = i1 * i1 + q1 * q1;
            detected[b] = e1 > e0 ? 1 : 0;
        }
    }

    let errors = 0;
    for (let b = 0; b < nBits; b++) {
        if (detected[b] !== bits[b]) errors++;
    }
    const ber = errors / Math.max(1, nBits);
    const spec = spectrum(tx, fs);

    // Estimación de frecuencia instantánea por bit
    const { phase } = hilbert(rx);
    const nInst = Math.min(nBits, Math.floor(phase.length / sps));
    const fBit = new Float64Array(nInst);
    const tBit = new Float64Array(nInst);
    for (let b = 0; b < nInst; b++) {
        const start = b * sps;
        const end = start + sps - 1;
        // Desenvolver fase local
        let dPhi = phase[end] - phase[start];
        while (dPhi > Math.PI) dPhi -= 2.0 * Math.PI;
        while (dPhi < -Math.PI) dPhi += 2.0 * Math.PI;
        const dtSpan = (sps - 1) / fs;
        fBit[b] = Math.abs(dPhi / (2.0 * Math.PI * dtSpan));
        tBit[b] = (b + 0.5) * tb;
    }

    const bw = 2.0 * (df + rb);
    return {
        scheme: "FSK",
        t,
        bits,
        tx,
        rx,
        clean,
        detected,
        ber,
        errors,
        nbits: nBits,
        fs,
        rb,
        sps,
        report,
        ebn0EffDb: report.ebn0EffDb,
        snrEffDb: report.snrEffDb,
        spectrumF: spec.f,
        spectrumDb: spec.mag,
        fBit,
        tBit,
        extras: {
            eb,
            f0,
            f1,
            df,
            h: modulationIndex,
            bandwidthHz: bw,
            snrBandDb: bandSnrDb(report.ebn0EffDb, rb, bw),
            orthogonal: Math.abs(modulationIndex - 1.0) < 0.05 || Math.abs(modulationIndex - 0.5) < 0.05,
            detector,
        },
    };
}

// ---------------------------------------------------------------------------
// 4. Simulador BPSK (Portadora Interna para PCM)
// ---------------------------------------------------------------------------
export function simulateBPSK(cfg) {
    const {
        nbits = 200,
        bitMode = "random",
        manualBits = "10110010",
        rb = 1000.0,
        fc = 6000.0,
        amplitude = 1.0,
        sps = 32,
        timingOffsetFrac = 0.0,
        seed = 1,
        channel = {},
    } = cfg;

    const bits = makeBits(nbits, bitMode, manualBits, seed);
    const nBits = bits.length;
    const fs = sps * rb;
    const tb = 1.0 / rb;
    const totalSamples = nBits * sps;
    const t = new Float64Array(totalSamples);
    const dt = 1.0 / fs;
    for (let i = 0; i < totalSamples; i++) t[i] = i * dt;

    const { fc: realFc, cycles: fcCycles } = snapCarrier(fc, rb, fs);
    const tx = new Float64Array(totalSamples);
    const twoPiFc = 2.0 * Math.PI * realFc;

    let sampleIdx = 0;
    for (let b = 0; b < nBits; b++) {
        const pulse = bits[b] === 1 ? 1.0 : -1.0;
        for (let s = 0; s < sps; s++) {
            tx[sampleIdx] = pulse * amplitude * Math.cos(twoPiFc * t[sampleIdx]);
            sampleIdx++;
        }
    }

    const eb = (amplitude * amplitude * tb) / 2.0;
    const chanCfg = { ...channel, eb, seed };
    const { rx, report, clean } = applyChannel(tx, fs, chanCfg, { t });

    const ref = new Float64Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) ref[i] = amplitude * Math.cos(twoPiFc * t[i]);
    const refWin = bitWindows(ref, nBits, sps, timingOffsetFrac);
    const rxWin = bitWindows(rx, nBits, sps, timingOffsetFrac);

    const detected = new Uint8Array(nBits);
    for (let b = 0; b < nBits; b++) {
        let corr = 0.0;
        for (let s = 0; s < sps; s++) {
            corr += rxWin[b][s] * refWin[b][s];
        }
        detected[b] = corr > 0.0 ? 1 : 0;
    }

    let errors = 0;
    for (let b = 0; b < nBits; b++) {
        if (detected[b] !== bits[b]) errors++;
    }
    const ber = errors / Math.max(1, nBits);
    const spec = spectrum(tx, fs);
    const eye = bitWindows(rx, Math.min(nBits, 160), sps, timingOffsetFrac);

    return {
        scheme: "BPSK",
        t,
        bits,
        tx,
        rx,
        clean,
        detected,
        ber,
        errors,
        nbits: nBits,
        fs,
        rb,
        sps,
        report,
        ebn0EffDb: report.ebn0EffDb,
        snrEffDb: report.snrEffDb,
        spectrumF: spec.f,
        spectrumDb: spec.mag,
        eye,
        extras: {
            eb,
            fc: realFc,
            cyclesPerBit: fcCycles,
            detector: "coherent",
            bandwidthHz: 2.0 * rb,
            snrBandDb: bandSnrDb(report.ebn0EffDb, rb, 2.0 * rb),
        },
    };
}

// ---------------------------------------------------------------------------
// 5. Simulador PCM (Muestreo, Cuantificación, Enlace y Reconstrucción)
// ---------------------------------------------------------------------------
export function simulatePCM(cfg) {
    const {
        waveform = "sine",
        fm = 1000.0,
        phaseDeg = 0.0,
        duty = 0.5,
        fEnd = null,
        formula = null,
        csvT = null,
        csvX = null,
        amplitude = 0.8,
        fsSample = 8000.0,
        nBits = 8,
        duration = 0.01,
        fullScale = 1.0,
        antialias = true,
        scheme = "BPSK",
        fc = 20000.0,
        sps = 16,
        ebn0Db = null,
        seed = 1,
        channel = {},
    } = cfg;

    if (nBits < 2 || nBits > 16) throw new Error("nBits debe estar entre 2 y 16");
    if (fsSample <= 0 || duration <= 0 || fc <= 0) throw new Error("Parámetros deben ser positivos");

    const fsAnalog = Math.min(4.0e6, Math.max(40.0 * fm, 12.0 * fsSample, 50000.0));
    const tAnalog = timeVector(fsAnalog, duration);
    const xRaw = generateWaveform(waveform, tAnalog, {
        amplitude: 1.0,
        frequency: fm,
        phaseDeg,
        duty,
        fEnd,
        formula,
        csvT,
        csvX,
        normalize: true,
        removeDC: true,
    });
    const xAnalog = new Float64Array(tAnalog.length);
    for (let i = 0; i < tAnalog.length; i++) xAnalog[i] = amplitude * xRaw[i];

    const xAnalogF = antialias && fsSample < fsAnalog
        ? antiAliasFilter(xAnalog, fsAnalog, fsSample, 6)
        : xAnalog;

    // Muestreo
    const tS = timeVector(fsSample, duration);
    const nSamples = tS.length;
    const xS = new Float64Array(nSamples);
    const dtAnalog = 1.0 / fsAnalog;
    for (let i = 0; i < nSamples; i++) {
        let idx = Math.floor(tS[i] / dtAnalog);
        if (idx < 0) idx = 0;
        else if (idx >= xAnalogF.length) idx = xAnalogF.length - 1;
        xS[i] = xAnalogF[idx];
    }

    const { bits, idx, xq, q, qerr, levels } = pcmEncode(xS, nBits, fullScale);
    const totalBits = bits.length;

    // Enlace Digital de Transmisión
    const rb = fsSample * nBits;
    const fsRf = rb * sps;
    if (fc >= fsRf * 0.5) throw new Error("fc debe ser menor que fsRf/2");

    const { fc: realFc, cycles: fcCycles } = snapCarrier(fc, rb, fsRf);
    const tb = 1.0 / rb;
    const totalRfSamples = totalBits * sps;
    const tRf = new Float64Array(totalRfSamples);
    const dtRf = 1.0 / fsRf;
    for (let i = 0; i < totalRfSamples; i++) tRf[i] = i * dtRf;

    const twoPiFc = 2.0 * Math.PI * realFc;
    const tx = new Float64Array(totalRfSamples);
    let eb = 0.0;
    const sUpper = scheme.toUpperCase();

    if (sUpper === "ASK") {
        eb = tb / 4.0;
        let sIdx = 0;
        for (let b = 0; b < totalBits; b++) {
            const v = bits[b];
            for (let s = 0; s < sps; s++) {
                tx[sIdx] = v * Math.cos(twoPiFc * tRf[sIdx]);
                sIdx++;
            }
        }
    } else if (sUpper === "BPSK") {
        eb = tb / 2.0;
        let sIdx = 0;
        for (let b = 0; b < totalBits; b++) {
            const v = bits[b] === 1 ? 1.0 : -1.0;
            for (let s = 0; s < sps; s++) {
                tx[sIdx] = v * Math.cos(twoPiFc * tRf[sIdx]);
                sIdx++;
            }
        }
    } else {
        // FSK
        eb = tb / 2.0;
        const df = 0.5 * rb;
        const f0 = Math.max(1.0, realFc - df);
        const f1 = realFc + df;
        let sIdx = 0;
        for (let b = 0; b < totalBits; b++) {
            const freq = bits[b] === 1 ? f1 : f0;
            const twoPiF = 2.0 * Math.PI * freq;
            for (let s = 0; s < sps; s++) {
                tx[sIdx] = Math.cos(twoPiF * (s * dtRf));
                sIdx++;
            }
        }
    }

    const chanCfg = { ...channel, eb, seed };
    if (ebn0Db !== null && ebn0Db !== undefined) {
        chanCfg.ebn0Db = ebn0Db;
        chanCfg.snrDb = null;
    }
    const { rx, report, clean } = applyChannel(tx, fsRf, chanCfg, { t: tRf });

    // Demodulación de bits
    const win = bitWindows(rx, totalBits, sps, 0.0);
    const detected = new Uint8Array(totalBits);

    if (sUpper === "ASK") {
        const ref = new Float64Array(totalRfSamples);
        for (let i = 0; i < totalRfSamples; i++) ref[i] = Math.cos(twoPiFc * tRf[i]);
        const refWin = bitWindows(ref, totalBits, sps, 0.0);
        let e1Sum = 0;
        for (let b = 0; b < totalBits; b++) {
            let rowSq = 0;
            for (let s = 0; s < sps; s++) rowSq += refWin[b][s] * refWin[b][s];
            e1Sum += rowSq / fsRf;
        }
        const thr = 0.5 * (e1Sum / totalBits) * report.gainLinear;
        for (let b = 0; b < totalBits; b++) {
            let corr = 0;
            for (let s = 0; s < sps; s++) corr += win[b][s] * refWin[b][s];
            detected[b] = corr / fsRf > thr ? 1 : 0;
        }
    } else if (sUpper === "BPSK") {
        const ref = new Float64Array(totalRfSamples);
        for (let i = 0; i < totalRfSamples; i++) ref[i] = Math.cos(twoPiFc * tRf[i]);
        const refWin = bitWindows(ref, totalBits, sps, 0.0);
        for (let b = 0; b < totalBits; b++) {
            let corr = 0;
            for (let s = 0; s < sps; s++) corr += win[b][s] * refWin[b][s];
            detected[b] = corr > 0.0 ? 1 : 0;
        }
    } else {
        // FSK
        const df = 0.5 * rb;
        const f0 = Math.max(1.0, realFc - df);
        const f1 = realFc + df;
        const c0 = new Float64Array(sps);
        const s0 = new Float64Array(sps);
        const c1 = new Float64Array(sps);
        const s1 = new Float64Array(sps);
        for (let s = 0; s < sps; s++) {
            const tl = s * dtRf;
            c0[s] = Math.cos(2.0 * Math.PI * f0 * tl);
            s0[s] = Math.sin(2.0 * Math.PI * f0 * tl);
            c1[s] = Math.cos(2.0 * Math.PI * f1 * tl);
            s1[s] = Math.sin(2.0 * Math.PI * f1 * tl);
        }
        for (let b = 0; b < totalBits; b++) {
            let i0 = 0, q0 = 0, i1 = 0, q1 = 0;
            for (let s = 0; s < sps; s++) {
                i0 += win[b][s] * c0[s];
                q0 += win[b][s] * s0[s];
                i1 += win[b][s] * c1[s];
                q1 += win[b][s] * s1[s];
            }
            detected[b] = (i1 * i1 + q1 * q1) > (i0 * i0 + q0 * q0) ? 1 : 0;
        }
    }

    let errors = 0;
    for (let b = 0; b < totalBits; b++) {
        if (detected[b] !== bits[b]) errors++;
    }
    const ber = errors / Math.max(1, totalBits);

    // Decodificación y Reconstrucción
    const { xq: xqRx } = pcmDecode(detected, nBits, fullScale);
    const xZoh = zeroOrderHold(xqRx, tS, tAnalog);
    const xRec = sincInterp(xqRx, tS, tAnalog, 24);

    // SQNR de régimen permanente
    const trim = Math.max(5, Math.min(Math.floor(tAnalog.length / 4), Math.round((32.0 * fsAnalog) / fsSample)));
    let pSignal = 0, pErr = 0;
    for (let i = trim; i < tAnalog.length - trim; i++) {
        pSignal += xAnalog[i] * xAnalog[i];
        const diff = xAnalog[i] - xRec[i];
        pErr += diff * diff;
    }
    const sqnrDb = 10.0 * Math.log10(Math.max(pSignal, 1e-30) / Math.max(pErr, 1e-30));

    let pS = 0, pQErr = 0;
    for (let i = 0; i < nSamples; i++) {
        pS += xS[i] * xS[i];
        const diff = xq[i] - xS[i];
        pQErr += diff * diff;
    }
    const sqnrQuantDb = 10.0 * Math.log10(Math.max(pS, 1e-30) / Math.max(pQErr, 1e-30));
    const sqnrTheoryDb = 6.02 * nBits + 1.76 + 20.0 * Math.log10(Math.max(amplitude, 1e-9));

    const specAnalog = spectrum(xAnalogF, fsAnalog);
    const specSampled = spectrum(xS, fsSample);
    const specRf = spectrum(tx, fsRf);

    const nyquistHz = 0.5 * fsSample;
    const alias = fm > nyquistHz * 1.02;

    const metrics = {
        fsSample,
        nyquistHz,
        nBits,
        levels,
        q,
        bitRateBps: rb,
        symbolRateBps: rb,
        fcHz: realFc,
        fcCycles,
        fsRf,
        samples: nSamples,
        ber,
        errors,
        sqnrDb,
        sqnrQuantDb,
        sqnrTheoryDb,
        alias,
        antialias,
        scheme: sUpper,
        ebn0EffDb: report.ebn0EffDb,
        snrEffDb: report.snrEffDb,
        pathLossDb: report.pathLossDb,
        totalAttenDb: report.totalAttenDb,
        bitsPerSample: nBits,
    };

    return {
        tAnalog,
        xAnalog,
        xAnalogF,
        tS,
        xS,
        xq,
        xRec,
        xZoh,
        qerr,
        q,
        idx,
        bits,
        detected,
        ber,
        errors,
        nbitsTotal: totalBits,
        sqnrDb,
        sqnrQuantDb,
        sqnrTheoryDb,
        report,
        ebn0EffDb: report.ebn0EffDb,
        snrEffDb: report.snrEffDb,
        spectrumAnalogF: specAnalog.f,
        spectrumAnalogDb: specAnalog.mag,
        spectrumSampledF: specSampled.f,
        spectrumSampledDb: specSampled.mag,
        tRf,
        tx,
        rx,
        clean,
        fsRf,
        fc: realFc,
        fcCycles,
        spectrumRfF: specRf.f,
        spectrumRfDb: specRf.mag,
        metrics,
    };
}

// ---------------------------------------------------------------------------
// Curvas de Barrido (Fidelidad AM, BER Monte Carlo y SQNR PCM)
// ---------------------------------------------------------------------------
export function amFidelityCurve(cfg, snrValues = null) {
    if (!snrValues) {
        snrValues = [0, 5, 10, 15, 20, 25, 30, 35, 40];
    }
    const mseEnv = [];
    const mseCoh = [];
    for (let snr of snrValues) {
        const c = { ...cfg, channel: { ...cfg.channel, distanceKm: 0, frequencyMHz: 0, snrDb: snr } };
        const res = simulateAM(c);
        mseEnv.push(res.metrics.mseEnv);
        mseCoh.push(res.metrics.mseCoh);
    }
    return { snrDb: snrValues, mseEnv, mseCoh };
}

export function digitalBerCurve(cfg, scheme, ebn0Values = null) {
    if (!ebn0Values) {
        ebn0Values = [0, 2, 4, 6, 8, 10, 12, 14];
    }
    const s = scheme.toUpperCase();
    const simFn = s === "ASK" ? simulateASK : (s === "FSK" ? simulateFSK : simulateBPSK);
    const measured = [];
    const theory = [];
    const curveNbits = Math.min(10000, Math.max(4000, cfg.nbits || 4000));
    const det = cfg.detector || "coherent";

    for (let ebn0 of ebn0Values) {
        const c = {
            ...cfg,
            nbits: curveNbits,
            channel: { ...cfg.channel, distanceKm: 0, frequencyMHz: 0, ebn0Db: ebn0, snrDb: null },
        };
        const res = simFn(c);
        measured.push(res.ber);
        theory.push(berTheory(s, ebn0, det));
    }
    return {
        ebn0Db: ebn0Values,
        berSim: measured,
        berTheory: theory,
        nbits: curveNbits,
    };
}

export function pcmSqnrBitsCurve(cfg, bitsValues = null) {
    if (!bitsValues) {
        bitsValues = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }
    const sqnrRec = [];
    const sqnrQuant = [];
    const sqnrTheory = [];
    for (let nb of bitsValues) {
        const c = { ...cfg, nBits: nb, ebn0Db: null, channel: { ...cfg.channel, distanceKm: 0, frequencyMHz: 0, snrDb: null, ebn0Db: null } };
        const res = simulatePCM(c);
        sqnrRec.push(res.sqnrDb);
        sqnrQuant.push(res.sqnrQuantDb);
        sqnrTheory.push(6.02 * nb + 1.76 + 20.0 * Math.log10(Math.max(cfg.amplitude || 0.8, 1e-9)));
    }
    return { nBits: bitsValues, sqnrRecDb: sqnrRec, sqnrQuantDb: sqnrQuant, sqnrTheoryDb: sqnrTheory };
}

export function pcmSqnrEbn0Curve(cfg, ebn0Values = null) {
    if (!ebn0Values) {
        ebn0Values = [0, 2, 4, 6, 8, 10, 12, 14, 16];
    }
    const sqnr = [];
    const ber = [];
    for (let ebn0 of ebn0Values) {
        const c = { ...cfg, ebn0Db: ebn0, channel: { ...cfg.channel, distanceKm: 0, frequencyMHz: 0, ebn0Db: ebn0, snrDb: null } };
        const res = simulatePCM(c);
        sqnr.push(res.sqnrDb);
        ber.push(res.ber);
    }
    return { ebn0Db: ebn0Values, sqnrDb: sqnr, ber };
}

