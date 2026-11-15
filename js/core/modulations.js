/**
 * modulations.js
 * Núcleo matemático didáctico para los 4 módulos: AM, ASK, FSK y PCM.
 * Diseñado específicamente para un curso de Transmisión de Datos.
 * 100% JavaScript estándar sin dependencias externas.
 */

// ===========================================================================
// MÓDULO 1: Modulación de Amplitud (AM)
// ===========================================================================
export function simulateAM({ vm = 0.8, fm = 100, vp = 1.0, fp = 1000 }) {
    vm = Math.max(0.01, parseFloat(vm) || 0.8);
    fm = Math.max(1, parseFloat(fm) || 100);
    vp = Math.max(0.1, parseFloat(vp) || 1.0);
    fp = Math.max(fm * 2, parseFloat(fp) || 1000);

    const m = vm / vp;
    const mPct = m * 100;
    const bw = 2 * fm;
    const bli = fp - fm;
    const bls = fp + fm;

    // Ventana temporal: 3 ciclos completos de la señal moduladora (fm)
    const Tm = 1.0 / fm;
    const duration = 3.0 * Tm;
    const numPoints = 2000;
    const dt = duration / (numPoints - 1);

    const time = new Float64Array(numPoints);
    const vmSig = new Float64Array(numPoints);
    const vpSig = new Float64Array(numPoints);
    const amSig = new Float64Array(numPoints);
    const envUpper = new Float64Array(numPoints);
    const envLower = new Float64Array(numPoints);

    const omegaM = 2 * Math.PI * fm;
    const omegaP = 2 * Math.PI * fp;

    for (let i = 0; i < numPoints; i++) {
        const t = i * dt;
        time[i] = t;
        const msg = vm * Math.sin(omegaM * t);
        const carrier = vp * Math.sin(omegaP * t);
        
        vmSig[i] = msg;
        vpSig[i] = carrier;
        // Ecuación estándar: v(t) = [Vp + vm(t)] * sin(2*pi*fp*t)
        const envelope = vp + msg;
        amSig[i] = envelope * Math.sin(omegaP * t);
        envUpper[i] = envelope;
        envLower[i] = -envelope;
    }

    // Espectro de 3 impulsos teóricos limpios (sin ruido FFT)
    const spectrum = {
        freqs: [bli, fp, bls],
        amps: [vm / 2.0, vp, vm / 2.0],
        labels: [
            `BLI: ${bli.toFixed(0)} Hz (${(vm / 2).toFixed(2)} V)`,
            `Portadora: ${fp.toFixed(0)} Hz (${vp.toFixed(2)} V)`,
            `BLS: ${bls.toFixed(0)} Hz (${(vm / 2).toFixed(2)} V)`
        ]
    };

    return {
        time,
        vmSig,
        vpSig,
        amSig,
        envUpper,
        envLower,
        spectrum,
        kpis: {
            m: m.toFixed(2),
            mPct: mPct.toFixed(1),
            isOvermodulated: m > 1.0,
            statusText: m <= 1.0 ? "Sin distorsión (M ≤ 100%)" : "Distorsión por sobremodulación (M > 100%)",
            bw: `${bw.toFixed(0)} Hz`,
            bli: `${bli.toFixed(0)} Hz`,
            bls: `${bls.toFixed(0)} Hz`,
            vm: vm.toFixed(2),
            vp: vp.toFixed(2),
            fm: fm.toFixed(0),
            fp: fp.toFixed(0)
        }
    };
}

// ===========================================================================
// MÓDULO 2: Modulación ASK (Desplazamiento de Amplitud)
// ===========================================================================
export function simulateASK({ bits = "10110100", rb = 100, fp = 400, v0 = 0.0, vp = 1.0 }) {
    // Sanitizar bits: solo '0' y '1', longitud entre 4 y 16 (por defecto 8 a 12)
    let cleanBits = String(bits).replace(/[^01]/g, "");
    if (cleanBits.length < 4) cleanBits = "10110100";
    if (cleanBits.length > 16) cleanBits = cleanBits.slice(0, 16);

    rb = Math.max(10, parseFloat(rb) || 100);
    fp = Math.max(rb, parseFloat(fp) || 400);
    v0 = Math.max(0.0, parseFloat(v0) || 0.0);
    vp = Math.max(0.5, parseFloat(vp) || 1.0);

    const nBits = cleanBits.length;
    const Tb = 1.0 / rb;
    const totalTime = nBits * Tb;
    const samplesPerBit = 200;
    const numPoints = nBits * samplesPerBit;
    const dt = totalTime / (numPoints - 1);

    const time = new Float64Array(numPoints);
    const bitsSig = new Float64Array(numPoints);
    const carrierSig = new Float64Array(numPoints);
    const askSig = new Float64Array(numPoints);

    const omegaP = 2 * Math.PI * fp;

    for (let i = 0; i < numPoints; i++) {
        const t = i * dt;
        time[i] = t;
        const bitIdx = Math.min(Math.floor(t / Tb), nBits - 1);
        const bitVal = cleanBits[bitIdx] === "1" ? 1 : 0;
        
        bitsSig[i] = bitVal;
        const cVal = vp * Math.cos(omegaP * t);
        carrierSig[i] = cVal;
        
        const amp = bitVal === 1 ? vp : v0;
        askSig[i] = amp * Math.cos(omegaP * t);
    }

    // Líneas delimitadoras de bit y etiquetas de tiempo
    const bitBoundaries = [];
    const bitLabels = [];
    for (let k = 0; k < nBits; k++) {
        bitBoundaries.push(k * Tb);
        bitLabels.push({
            tCenter: (k + 0.5) * Tb,
            val: cleanBits[k]
        });
    }
    bitBoundaries.push(totalTime);

    // Espectro analítico sinc: S(f) = |sinc((f - fp)/rb)|
    const fSpan = 3.5 * rb;
    const fMin = Math.max(0, fp - fSpan);
    const fMax = fp + fSpan;
    const numFreqs = 600;
    const fStep = (fMax - fMin) / (numFreqs - 1);

    const freqs = new Float64Array(numFreqs);
    const spectrumAmp = new Float64Array(numFreqs);

    for (let i = 0; i < numFreqs; i++) {
        const f = fMin + i * fStep;
        freqs[i] = f;
        const x = Math.PI * (f - fp) / rb;
        const sinc = x === 0 ? 1.0 : Math.sin(x) / x;
        // Espectro de potencia / magnitud normalizada
        spectrumAmp[i] = Math.abs(sinc);
    }

    const cyclesPerBit = fp / rb;
    const approxBw = 2 * rb;

    return {
        time,
        bitsSig,
        carrierSig,
        askSig,
        bitBoundaries,
        bitLabels,
        cleanBits,
        spectrum: {
            freqs,
            amps: spectrumAmp,
            fp,
            rb
        },
        kpis: {
            activeSeq: cleanBits.split("").join(" "),
            fp: `${fp.toFixed(0)} Hz`,
            cyclesPerBit: cyclesPerBit.toFixed(1),
            approxBw: `${approxBw.toFixed(0)} Hz`,
            rb: `${rb.toFixed(0)} bps`,
            v0: `${v0.toFixed(1)} V`,
            modeText: v0 === 0.0 ? "OOK (0 V para '0')" : `2 Niveles (${v0.toFixed(1)} V para '0')`
        }
    };
}

// ===========================================================================
// MÓDULO 3: Modulación FSK (Desplazamiento de Frecuencia)
// ===========================================================================
export function simulateFSK({ bits = "10110100", rb = 100, f0 = 200, f1 = 600, vp = 1.0 }) {
    let cleanBits = String(bits).replace(/[^01]/g, "");
    if (cleanBits.length < 4) cleanBits = "10110100";
    if (cleanBits.length > 16) cleanBits = cleanBits.slice(0, 16);

    rb = Math.max(10, parseFloat(rb) || 100);
    f0 = Math.max(10, parseFloat(f0) || 200);
    f1 = Math.max(10, parseFloat(f1) || 600);
    vp = Math.max(0.5, parseFloat(vp) || 1.0);

    const nBits = cleanBits.length;
    const Tb = 1.0 / rb;
    const totalTime = nBits * Tb;
    const samplesPerBit = 200;
    const numPoints = nBits * samplesPerBit;
    const dt = totalTime / (numPoints - 1);

    const time = new Float64Array(numPoints);
    const bitsSig = new Float64Array(numPoints);
    const fskSig = new Float64Array(numPoints);

    // Generación de fase continua (CP-FSK) para evitar saltos abruptos irreales
    let currentPhase = 0;
    for (let i = 0; i < numPoints; i++) {
        const t = i * dt;
        time[i] = t;
        const bitIdx = Math.min(Math.floor(t / Tb), nBits - 1);
        const bitVal = cleanBits[bitIdx] === "1" ? 1 : 0;
        
        bitsSig[i] = bitVal;
        const instFreq = bitVal === 1 ? f1 : f0;
        
        currentPhase += 2 * Math.PI * instFreq * dt;
        fskSig[i] = vp * Math.cos(currentPhase);
    }

    const bitBoundaries = [];
    const bitLabels = [];
    for (let k = 0; k < nBits; k++) {
        bitBoundaries.push(k * Tb);
        bitLabels.push({
            tCenter: (k + 0.5) * Tb,
            val: cleanBits[k]
        });
    }
    bitBoundaries.push(totalTime);

    // Espectro analítico de 2 lóbulos sinc limpios
    const fMin = Math.max(0, Math.min(f0, f1) - 2.5 * rb);
    const fMax = Math.max(f0, f1) + 2.5 * rb;
    const numFreqs = 700;
    const fStep = (fMax - fMin) / (numFreqs - 1);

    const freqs = new Float64Array(numFreqs);
    const spectrumAmp = new Float64Array(numFreqs);

    for (let i = 0; i < numFreqs; i++) {
        const f = fMin + i * fStep;
        freqs[i] = f;
        const x0 = Math.PI * (f - f0) / rb;
        const x1 = Math.PI * (f - f1) / rb;
        const sinc0 = x0 === 0 ? 1.0 : Math.sin(x0) / x0;
        const sinc1 = x1 === 0 ? 1.0 : Math.sin(x1) / x1;
        spectrumAmp[i] = 0.5 * (Math.abs(sinc0) + Math.abs(sinc1));
    }

    const deltaF = Math.abs(f1 - f0);
    const isWideband = deltaF >= rb;

    return {
        time,
        bitsSig,
        fskSig,
        bitBoundaries,
        bitLabels,
        cleanBits,
        spectrum: {
            freqs,
            amps: spectrumAmp,
            f0,
            f1,
            rb
        },
        kpis: {
            f1: `${f1.toFixed(0)} Hz`,
            f0: `${f0.toFixed(0)} Hz`,
            deltaF: `${deltaF.toFixed(0)} Hz`,
            fskType: isWideband ? "Banda Ancha (Tonos separados)" : "Banda Angosta (NFSK)",
            isWideband,
            rb: `${rb.toFixed(0)} bps`
        }
    };
}

// ===========================================================================
// MÓDULO 4: Modulación por Pulsos Codificados (PCM)
// ===========================================================================
export function simulatePCM({ fm = 10, fs = 60, nBits = 3, amp = 1.0 }) {
    fm = Math.max(1, parseFloat(fm) || 10);
    fs = Math.max(5, parseFloat(fs) || 60);
    nBits = Math.min(4, Math.max(2, parseInt(nBits, 10) || 3));
    amp = Math.max(0.1, parseFloat(amp) || 1.0);

    const fNyquist = 2 * fm;
    const meetsNyquist = fs >= fNyquist;
    const numLevels = Math.pow(2, nBits); // 4, 8 o 16 niveles
    const qStep = (2.0 * amp) / numLevels;
    const bitRate = fs * nBits;

    // Ventana temporal: 1.5 ciclos de la señal fm para ver detalle
    const Tm = 1.0 / fm;
    const duration = 1.5 * Tm;

    // Señal continua de alta resolución
    const numContPoints = 1200;
    const dtCont = duration / (numContPoints - 1);
    const timeCont = new Float64Array(numContPoints);
    const analogCont = new Float64Array(numContPoints);

    for (let i = 0; i < numContPoints; i++) {
        const t = i * dtCont;
        timeCont[i] = t;
        analogCont[i] = amp * Math.sin(2 * Math.PI * fm * t);
    }

    // Muestreo: t_k = k / fs
    const Ts = 1.0 / fs;
    const numSamples = Math.floor(duration / Ts) + 1;
    const sampleTimes = new Float64Array(numSamples);
    const sampleVals = new Float64Array(numSamples);
    const quantVals = new Float64Array(numSamples);
    const sampleBinWords = [];
    const sampleIndices = new Int32Array(numSamples);

    for (let k = 0; k < numSamples; k++) {
        const tk = k * Ts;
        sampleTimes[k] = tk;
        const val = amp * Math.sin(2 * Math.PI * fm * tk);
        sampleVals[k] = val;

        // Cuantificación mid-rise uniforme en [-amp, +amp]
        let idx = Math.floor((val + amp) / qStep);
        if (idx < 0) idx = 0;
        if (idx >= numLevels) idx = numLevels - 1;
        sampleIndices[k] = idx;

        // Nivel central del escalón
        const qVal = -amp + (idx + 0.5) * qStep;
        quantVals[k] = qVal;

        // Código binario MSB-first de nBits
        const binCode = idx.toString(2).padStart(nBits, "0");
        sampleBinWords.push(binCode);
    }

    // Señal aparente reconstruida por aliasing si fs < 2*fm
    let aliasSignal = null;
    let fAlias = 0;
    if (!meetsNyquist) {
        // Frecuencia aparente en banda base
        fAlias = Math.abs(fm - Math.round(fm / fs) * fs);
        if (fAlias === 0) fAlias = fs / 2;
        
        aliasSignal = new Float64Array(numContPoints);
        for (let i = 0; i < numContPoints; i++) {
            const t = timeCont[i];
            aliasSignal[i] = amp * Math.sin(2 * Math.PI * fAlias * t);
        }
    }

    // Niveles de cuantificación discretos para el eje Y
    const levels = [];
    for (let i = 0; i < numLevels; i++) {
        const levelVal = -amp + (i + 0.5) * qStep;
        const code = i.toString(2).padStart(nBits, "0");
        levels.push({
            index: i,
            val: levelVal,
            boundary: -amp + i * qStep,
            code
        });
    }

    // Etapa 3: Trama digital codificada completa
    // Concatenamos las palabras binarias de cada muestra
    const allBits = sampleBinWords.join("");
    const totalBits = allBits.length;
    const bitDuration = duration / totalBits;
    const samplesPerCodeBit = 20;
    const totalCodePoints = totalBits * samplesPerCodeBit;

    const timeCoding = new Float64Array(totalCodePoints);
    const codeSig = new Float64Array(totalCodePoints);

    for (let b = 0; b < totalBits; b++) {
        const bitVal = allBits[b] === "1" ? 1.0 : 0.0;
        for (let p = 0; p < samplesPerCodeBit; p++) {
            const idx = b * samplesPerCodeBit + p;
            timeCoding[idx] = (b + p / samplesPerCodeBit) * bitDuration;
            codeSig[idx] = bitVal;
        }
    }

    // Grupos de palabras de muestra para etiquetas de la gráfica de codificación
    const sampleWordGroups = [];
    for (let k = 0; k < numSamples; k++) {
        sampleWordGroups.push({
            sampleIndex: k,
            word: sampleBinWords[k],
            tStart: k * nBits * bitDuration,
            tEnd: (k + 1) * nBits * bitDuration,
            tCenter: (k + 0.5) * nBits * bitDuration
        });
    }

    return {
        timeCont,
        analogCont,
        sampleTimes,
        sampleVals,
        quantVals,
        sampleBinWords,
        aliasSignal,
        fAlias,
        levels,
        qStep,
        timeCoding,
        codeSig,
        sampleWordGroups,
        allBits,
        kpis: {
            meetsNyquist,
            nyqText: meetsNyquist ? `Cumple Nyquist (fs ≥ 2fm)` : `Aliasing detectado (fs < 2fm)`,
            fNyquist: `${fNyquist.toFixed(0)} Hz`,
            fs: `${fs.toFixed(0)} Hz`,
            fm: `${fm.toFixed(0)} Hz`,
            levels: `${numLevels} niveles (2^${nBits})`,
            nBits,
            rb: `${bitRate.toFixed(0)} bps`,
            qStep: `${qStep.toFixed(3)} V`
        }
    };
}
