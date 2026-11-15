/**
 * app.js - SIMULADOR ONDAS
 * Módulos: AM, ASK, FSK y PCM.
 * Script unificado y autónomo. Funciona tanto en servidor local (http://)
 * como abriendo directamente index.html (file://) sin errores de CORS.
 */

// ===========================================================================
// 1. PALETA DE COLORES (Golden Amber Dark Theme)
// ===========================================================================
const PALETTE = {
    bgPaper: "#1A1400",
    bgPlot: "#120E01",
    grid: "rgba(135, 104, 1, 0.16)",
    zeroline: "#5A4500",
    gold900: "#2D2300",
    gold800: "#5A4500",
    gold700: "#876801",
    gold600: "#B48A01",
    gold500: "#E1AD01", // Ámbar principal
    gold400: "#EAC64D", // Dorado cálido brillante
    gold300: "#F0D680", // Arena dorada suave
    gold200: "#F6E6B3", // Crema claro
    gold100: "#FAF3D9", // Marfil perla de alto contraste
    alert: "#FF5C5C",
    ok: "#50E370"
};

function baseLayout(xTitle, yTitle, extra = {}) {
    return {
        title: false, // El título y la descripción van en el HTML (.plot-card-header)
        paper_bgcolor: PALETTE.bgPaper,
        plot_bgcolor: PALETTE.bgPlot,
        font: { family: "Inter, system-ui, sans-serif", size: 10.5, color: PALETTE.gold200 },
        margin: { l: 48, r: 24, t: 26, b: 36, ...(extra.margin || {}) },
        xaxis: {
            title: { text: xTitle, font: { size: 10.5, color: PALETTE.gold300 } },
            gridcolor: PALETTE.grid,
            zerolinecolor: PALETTE.zeroline,
            tickfont: { size: 9.5, color: PALETTE.gold200 },
            ...(extra.xaxis || {})
        },
        yaxis: {
            title: { text: yTitle, font: { size: 10.5, color: PALETTE.gold300 } },
            gridcolor: PALETTE.grid,
            zerolinecolor: PALETTE.zeroline,
            tickfont: { size: 9.5, color: PALETTE.gold200 },
            ...(extra.yaxis || {})
        },
        legend: {
            orientation: "h",
            x: 0.02,
            y: 1.10,
            xanchor: "left",
            yanchor: "bottom",
            font: { size: 10, color: PALETTE.gold100 },
            bgcolor: "rgba(45, 35, 0, 0.75)",
            bordercolor: PALETTE.gold800,
            borderwidth: 1,
            ...(extra.legend || {})
        },
        hoverlabel: {
            bgcolor: PALETTE.gold900,
            bordercolor: PALETTE.gold500,
            font: { family: "Inter, sans-serif", size: 11, color: PALETTE.gold100 }
        },
        autosize: true,
        ...extra
    };
}

const PLOT_CONFIG = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"]
};

// ===========================================================================
// 2. NÚCLEO MATEMÁTICO (AM, ASK, FSK, PCM)
// ===========================================================================

function simulateAM({ vm = 0.8, fm = 100, vp = 1.0, fp = 1000 }) {
    vm = Math.max(0.01, parseFloat(vm) || 0.8);
    fm = Math.max(1, parseFloat(fm) || 100);
    vp = Math.max(0.1, parseFloat(vp) || 1.0);
    fp = Math.max(fm * 2, parseFloat(fp) || 1000);

    const m = vm / vp;
    const mPct = m * 100;
    const bw = 2 * fm;
    const bli = fp - fm;
    const bls = fp + fm;

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
        const envelope = vp + msg;
        amSig[i] = envelope * Math.sin(omegaP * t);
        envUpper[i] = envelope;
        envLower[i] = -envelope;
    }

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

function simulateASK({ bits = "10110100", rb = 100, fp = 400, v0 = 0.0, vp = 1.0 }) {
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
        carrierSig[i] = vp * Math.cos(omegaP * t);
        
        const amp = bitVal === 1 ? vp : v0;
        askSig[i] = amp * Math.cos(omegaP * t);
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

function simulateFSK({ bits = "10110100", rb = 100, f0 = 200, f1 = 600, vp = 1.0 }) {
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

function simulatePCM({ fm = 10, fs = 60, nBits = 3, amp = 1.0 }) {
    fm = Math.max(1, parseFloat(fm) || 10);
    fs = Math.max(5, parseFloat(fs) || 60);
    nBits = Math.min(4, Math.max(2, parseInt(nBits, 10) || 3));
    amp = Math.max(0.1, parseFloat(amp) || 1.0);

    const fNyquist = 2 * fm;
    const meetsNyquist = fs >= fNyquist;
    const numLevels = Math.pow(2, nBits);
    const qStep = (2.0 * amp) / numLevels;
    const bitRate = fs * nBits;

    const Tm = 1.0 / fm;
    const duration = 1.5 * Tm;

    const numContPoints = 1200;
    const dtCont = duration / (numContPoints - 1);
    const timeCont = new Float64Array(numContPoints);
    const analogCont = new Float64Array(numContPoints);

    for (let i = 0; i < numContPoints; i++) {
        const t = i * dtCont;
        timeCont[i] = t;
        analogCont[i] = amp * Math.sin(2 * Math.PI * fm * t);
    }

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

        let idx = Math.floor((val + amp) / qStep);
        if (idx < 0) idx = 0;
        if (idx >= numLevels) idx = numLevels - 1;
        sampleIndices[k] = idx;

        const qVal = -amp + (idx + 0.5) * qStep;
        quantVals[k] = qVal;

        const binCode = idx.toString(2).padStart(nBits, "0");
        sampleBinWords.push(binCode);
    }

    let aliasSignal = null;
    let fAlias = 0;
    if (!meetsNyquist) {
        fAlias = Math.abs(fm - Math.round(fm / fs) * fs);
        if (fAlias === 0) fAlias = fs / 2;
        
        aliasSignal = new Float64Array(numContPoints);
        for (let i = 0; i < numContPoints; i++) {
            const t = timeCont[i];
            aliasSignal[i] = amp * Math.sin(2 * Math.PI * fAlias * t);
        }
    }

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

// ===========================================================================
// 3. CHART MANAGER (Renderizado Plotly)
// ===========================================================================

class ChartManager {
    constructor() {
        this.plotDivs = new Set();
        window.addEventListener("resize", () => this.resizeAll());
    }

    register(divId) {
        const el = typeof divId === "string" ? document.getElementById(divId) : divId;
        if (el) this.plotDivs.add(el);
        return el;
    }

    resizeAll() {
        if (!window.Plotly) return;
        this.plotDivs.forEach((el) => {
            if (el && el.offsetParent !== null) {
                window.Plotly.Plots.resize(el);
            }
        });
    }

    // AM
    renderAMModAndCarrier(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const traceMod = {
            x: tMs,
            y: Array.from(data.vmSig),
            name: `Moduladora vm(t) [${data.kpis.fm} Hz, ${data.kpis.vm} V]`,
            mode: "lines",
            line: { color: PALETTE.gold100, width: 2.2 }
        };
        const traceCarrier = {
            x: tMs,
            y: Array.from(data.vpSig),
            name: `Portadora vp(t) [${data.kpis.fp} Hz, ${data.kpis.vp} V]`,
            mode: "lines",
            line: { color: PALETTE.gold500, width: 1.0 }
        };
        const layout = baseLayout("Tiempo (ms)", "Amplitud (V)", {
            yaxis: { range: [-data.kpis.vp * 1.35, data.kpis.vp * 1.35] }
        });
        window.Plotly.react(el, [traceMod, traceCarrier], layout, PLOT_CONFIG);
    }

    renderAMModulated(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const traceAM = {
            x: tMs,
            y: Array.from(data.amSig),
            name: `Señal AM v(t) (m=${data.kpis.m})`,
            mode: "lines",
            line: { color: PALETTE.gold400, width: 1.3 }
        };
        const traceUpper = {
            x: tMs,
            y: Array.from(data.envUpper),
            name: "Envolvente Superior",
            mode: "lines",
            line: { color: data.kpis.isOvermodulated ? PALETTE.alert : PALETTE.gold200, width: 1.6, dash: "dash" }
        };
        const traceLower = {
            x: tMs,
            y: Array.from(data.envLower),
            name: "Envolvente Inferior",
            mode: "lines",
            line: { color: data.kpis.isOvermodulated ? PALETTE.alert : PALETTE.gold200, width: 1.6, dash: "dash" }
        };
        const maxAmp = (parseFloat(data.kpis.vp) + parseFloat(data.kpis.vm)) * 1.25;
        const layout = baseLayout("Tiempo (ms)", "Amplitud (V)", {
            yaxis: { range: [-maxAmp, maxAmp] }
        });
        window.Plotly.react(el, [traceAM, traceUpper, traceLower], layout, PLOT_CONFIG);
    }

    renderAMSpectrum(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const spec = data.spectrum;
        const freqs = spec.freqs;
        const amps = spec.amps;

        const stemX = [];
        const stemY = [];
        for (let i = 0; i < freqs.length; i++) {
            stemX.push(freqs[i], freqs[i], null);
            stemY.push(0, amps[i], null);
        }

        const traceStems = {
            x: stemX,
            y: stemY,
            mode: "lines",
            name: "Impulsos Espectrales",
            line: { color: PALETTE.gold500, width: 3.5 },
            hoverinfo: "skip"
        };
        const traceHeads = {
            x: freqs,
            y: amps,
            mode: "markers+text",
            name: "Amplitud de Tonos",
            text: spec.labels.map((l, i) => `${amps[i].toFixed(2)} V`),
            textposition: "top center",
            textfont: { color: PALETTE.gold100, size: 10 },
            marker: { color: PALETTE.gold400, size: 11, symbol: "circle", line: { color: PALETTE.gold900, width: 2 } },
            hovertemplate: "%{text}<br>f = %{x:.0f} Hz<extra></extra>"
        };

        const fMin = Math.max(0, freqs[0] - 250);
        const fMax = freqs[2] + 250;
        const yMax = Math.max(...amps) * 1.35;

        const layout = baseLayout("Frecuencia (Hz)", "Amplitud (V)", {
            xaxis: { range: [fMin, fMax] },
            yaxis: { range: [0, yMax] }
        });
        window.Plotly.react(el, [traceStems, traceHeads], layout, PLOT_CONFIG);
    }

    // Helper para ASK/FSK
    _getBitShapesAndAnnotations(bitBoundaries, bitLabels, yTop = 1.3) {
        const shapes = bitBoundaries.map(t => ({
            type: "line",
            x0: t * 1000,
            x1: t * 1000,
            y0: -2.0,
            y1: 2.0,
            line: { color: PALETTE.gold800, width: 1.2, dash: "dot" }
        }));

        const annotations = bitLabels.map(b => ({
            x: b.tCenter * 1000,
            y: yTop,
            xref: "x",
            yref: "y",
            text: `<b>${b.val}</b>`,
            showarrow: false,
            font: { size: 12, color: PALETTE.gold100 }
        }));

        return { shapes, annotations };
    }

    // ASK
    renderASKBits(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const { shapes, annotations } = this._getBitShapesAndAnnotations(data.bitBoundaries, data.bitLabels, 1.2);
        const trace = {
            x: tMs,
            y: Array.from(data.bitsSig),
            name: "Tren de Bits d(t)",
            mode: "lines",
            line: { color: PALETTE.gold500, width: 2.5, shape: "hv" }
        };
        const layout = baseLayout("Tiempo (ms)", "Nivel Lógico", {
            yaxis: { range: [-0.25, 1.45], dtick: 1 },
            xaxis: { range: [0, tMs[tMs.length - 1]] },
            shapes,
            annotations
        });
        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    renderASKCarrier(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const { shapes } = this._getBitShapesAndAnnotations(data.bitBoundaries, data.bitLabels);
        const trace = {
            x: tMs,
            y: Array.from(data.carrierSig),
            name: "Portadora vp(t)",
            mode: "lines",
            line: { color: PALETTE.gold300, width: 1.2 }
        };
        const layout = baseLayout("Tiempo (ms)", "Amplitud (V)", {
            yaxis: { range: [-1.3, 1.3] },
            xaxis: { range: [0, tMs[tMs.length - 1]] },
            shapes
        });
        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    renderASKModulated(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const { shapes, annotations } = this._getBitShapesAndAnnotations(data.bitBoundaries, data.bitLabels, 1.25);
        const trace = {
            x: tMs,
            y: Array.from(data.askSig),
            name: "Señal Modulada ASK",
            mode: "lines",
            line: { color: PALETTE.gold400, width: 1.4 }
        };
        const layout = baseLayout("Tiempo (ms)", "Amplitud (V)", {
            yaxis: { range: [-1.35, 1.45] },
            xaxis: { range: [0, tMs[tMs.length - 1]] },
            shapes,
            annotations
        });
        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    renderASKSpectrum(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const spec = data.spectrum;
        const traceSinc = {
            x: Array.from(spec.freqs),
            y: Array.from(spec.amps),
            name: "|sinc(f - fp)|",
            mode: "lines",
            fill: "tozeroy",
            fillcolor: "rgba(225, 173, 1, 0.12)",
            line: { color: PALETTE.gold500, width: 2.2 }
        };
        const layout = baseLayout("Frecuencia (Hz)", "Magnitud Normalizada", {
            yaxis: { range: [0, 1.2] },
            shapes: [
                {
                    type: "line",
                    x0: spec.fp,
                    x1: spec.fp,
                    y0: 0,
                    y1: 1.05,
                    line: { color: PALETTE.gold100, width: 1.5, dash: "dash" }
                }
            ],
            annotations: [
                {
                    x: spec.fp,
                    y: 1.1,
                    text: `fp = ${spec.fp} Hz`,
                    showarrow: false,
                    font: { size: 10, color: PALETTE.gold100 }
                }
            ]
        });
        window.Plotly.react(el, [traceSinc], layout, PLOT_CONFIG);
    }

    // FSK
    renderFSKBits(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const { shapes, annotations } = this._getBitShapesAndAnnotations(data.bitBoundaries, data.bitLabels, 1.2);
        const trace = {
            x: tMs,
            y: Array.from(data.bitsSig),
            name: "Tren de Bits d(t)",
            mode: "lines",
            line: { color: PALETTE.gold500, width: 2.5, shape: "hv" }
        };
        const layout = baseLayout("Tiempo (ms)", "Nivel Lógico", {
            yaxis: { range: [-0.25, 1.45], dtick: 1 },
            xaxis: { range: [0, tMs[tMs.length - 1]] },
            shapes,
            annotations
        });
        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    renderFSKModulated(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.time).map(t => t * 1000);
        const { shapes, annotations } = this._getBitShapesAndAnnotations(data.bitBoundaries, data.bitLabels, 1.25);
        const trace = {
            x: tMs,
            y: Array.from(data.fskSig),
            name: `FSK (f0=${data.kpis.f0}, f1=${data.kpis.f1})`,
            mode: "lines",
            line: { color: PALETTE.gold400, width: 1.4 }
        };
        const layout = baseLayout("Tiempo (ms)", "Amplitud (V)", {
            yaxis: { range: [-1.35, 1.45] },
            xaxis: { range: [0, tMs[tMs.length - 1]] },
            shapes,
            annotations
        });
        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    renderFSKSpectrum(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const spec = data.spectrum;
        const trace = {
            x: Array.from(spec.freqs),
            y: Array.from(spec.amps),
            name: "Espectro FSK de 2 Tonos",
            mode: "lines",
            fill: "tozeroy",
            fillcolor: "rgba(225, 173, 1, 0.12)",
            line: { color: PALETTE.gold500, width: 2.2 }
        };
        const layout = baseLayout("Frecuencia (Hz)", "Magnitud Normalizada", {
            yaxis: { range: [0, 1.15] },
            shapes: [
                {
                    type: "line",
                    x0: spec.f0,
                    x1: spec.f0,
                    y0: 0,
                    y1: 0.65,
                    line: { color: PALETTE.gold300, width: 1.5, dash: "dash" }
                },
                {
                    type: "line",
                    x0: spec.f1,
                    x1: spec.f1,
                    y0: 0,
                    y1: 0.65,
                    line: { color: PALETTE.gold300, width: 1.5, dash: "dash" }
                }
            ],
            annotations: [
                {
                    x: spec.f0,
                    y: 0.72,
                    text: `f0 = ${spec.f0} Hz`,
                    showarrow: false,
                    font: { size: 10, color: PALETTE.gold200 }
                },
                {
                    x: spec.f1,
                    y: 0.72,
                    text: `f1 = ${spec.f1} Hz`,
                    showarrow: false,
                    font: { size: 10, color: PALETTE.gold200 }
                }
            ]
        });
        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    // PCM
    renderPCMSampling(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tContMs = Array.from(data.timeCont).map(t => t * 1000);
        const tSampleMs = Array.from(data.sampleTimes).map(t => t * 1000);

        const traceAnalog = {
            x: tContMs,
            y: Array.from(data.analogCont),
            name: `Señal Original X(t) [${data.kpis.fm}]`,
            mode: "lines",
            line: { color: PALETTE.gold100, width: 2.0 }
        };

        const stemX = [];
        const stemY = [];
        for (let i = 0; i < data.sampleTimes.length; i++) {
            stemX.push(tSampleMs[i], tSampleMs[i], null);
            stemY.push(0, data.sampleVals[i], null);
        }

        const tracePAMStems = {
            x: stemX,
            y: stemY,
            mode: "lines",
            name: `Muestras PAM (fs=${data.kpis.fs})`,
            line: { color: PALETTE.gold500, width: 2.5 },
            hoverinfo: "skip"
        };
        const tracePAMMarkers = {
            x: tSampleMs,
            y: Array.from(data.sampleVals),
            mode: "markers",
            name: "Muestras",
            marker: { color: PALETTE.gold400, size: 8, symbol: "circle" },
            hovertemplate: "t: %{x:.1f} ms<br>V: %{y:.2f} V<extra></extra>"
        };

        const traces = [traceAnalog, tracePAMStems, tracePAMMarkers];

        if (!data.kpis.meetsNyquist && data.aliasSignal) {
            traces.push({
                x: tContMs,
                y: Array.from(data.aliasSignal),
                name: `Aliasing (f_alias=${data.fAlias.toFixed(1)} Hz)`,
                mode: "lines",
                line: { color: PALETTE.alert, width: 2.2, dash: "dot" }
            });
        }

        const layout = baseLayout("Tiempo (ms)", "Amplitud (V)", {
            yaxis: { range: [-1.35, 1.35] }
        });
        window.Plotly.react(el, traces, layout, PLOT_CONFIG);
    }

    renderPCMQuantization(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tContMs = Array.from(data.timeCont).map(t => t * 1000);
        const tSampleMs = Array.from(data.sampleTimes).map(t => t * 1000);

        const traceRef = {
            x: tContMs,
            y: Array.from(data.analogCont),
            name: "Señal de Entrada",
            mode: "lines",
            line: { color: PALETTE.gold700, width: 1.2 }
        };
        const traceSamples = {
            x: tSampleMs,
            y: Array.from(data.sampleVals),
            mode: "markers",
            name: "Muestra Original",
            marker: { color: PALETTE.gold300, size: 7, symbol: "circle-open" }
        };
        const traceQuant = {
            x: tSampleMs,
            y: Array.from(data.quantVals),
            mode: "markers+lines",
            name: `Nivel Cuantificado (q=${data.kpis.qStep})`,
            marker: { color: PALETTE.gold500, size: 8, symbol: "square" },
            line: { color: PALETTE.gold600, width: 1.5, shape: "hv" },
            text: data.sampleBinWords,
            hovertemplate: "t: %{x:.1f} ms<br>Nivel: %{y:.3f} V<br>Bin: %{text}<extra></extra>"
        };

        const shapes = [];
        const annotations = [];

        data.levels.forEach(lvl => {
            shapes.push({
                type: "line",
                x0: 0,
                x1: tContMs[tContMs.length - 1],
                y0: lvl.val,
                y1: lvl.val,
                line: { color: PALETTE.gold800, width: 0.8, dash: "dot" }
            });
            annotations.push({
                x: tContMs[tContMs.length - 1],
                y: lvl.val,
                xref: "x",
                yref: "y",
                text: `<b>${lvl.code}</b>`,
                showarrow: false,
                xanchor: "left",
                font: { size: 9, color: PALETTE.gold200 }
            });
        });

        const layout = baseLayout("Tiempo (ms)", "Niveles Cuantificados", {
            margin: { r: 60 },
            yaxis: { range: [-1.25, 1.25] },
            shapes,
            annotations
        });
        window.Plotly.react(el, [traceRef, traceSamples, traceQuant], layout, PLOT_CONFIG);
    }

    renderPCMCoding(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        const tMs = Array.from(data.timeCoding).map(t => t * 1000);
        const tracePulse = {
            x: tMs,
            y: Array.from(data.codeSig),
            name: `Trama PCM (${data.kpis.nBits} bits/muestra)`,
            mode: "lines",
            line: { color: PALETTE.gold400, width: 2.2, shape: "hv" }
        };

        const shapes = [];
        const annotations = [];

        data.sampleWordGroups.forEach(grp => {
            shapes.push({
                type: "line",
                x0: grp.tEnd * 1000,
                x1: grp.tEnd * 1000,
                y0: -0.2,
                y1: 1.35,
                line: { color: PALETTE.gold700, width: 1.2, dash: "dash" }
            });

            annotations.push({
                x: grp.tCenter * 1000,
                y: 1.22,
                text: `<b>${grp.word}</b>`,
                showarrow: false,
                font: { size: 11, color: PALETTE.gold100 }
            });
        });

        const layout = baseLayout("Tiempo Relativo de Transmisión (ms)", "Nivel Lógico", {
            yaxis: { range: [-0.2, 1.4], dtick: 1 },
            xaxis: { range: [0, tMs[tMs.length - 1]] },
            shapes,
            annotations
        });
        window.Plotly.react(el, [tracePulse], layout, PLOT_CONFIG);
    }
}

// ===========================================================================
// 4. COORDINADOR Y EVENTOS DE LA APLICACIÓN
// ===========================================================================

const state = {
    activeModule: "am",
    chartManager: null
};

const DEFAULTS = {
    am: { vm: "0.8", fm: "100", vp: "1.0", fp: "1000" },
    ask: { bits: "10110100", rb: "100", fp: "400", v0: "0.0" },
    fsk: { bits: "10110100", rb: "100", f0: "200", f1: "600" },
    pcm: { fm: "10", fs: "60", nbits: "3" }
};

const MODULE_TITLES = {
    am: {
        title: "Modulación de Amplitud (AM)",
        subtitle: "La amplitud de la portadora sigue linealmente a la señal moduladora. Observa la envolvente y la sobremodulación (M > 100%)."
    },
    ask: {
        title: "Modulación ASK (Desplazamiento de Amplitud)",
        subtitle: "Conmutación de la amplitud de la portadora según el bit digital. Observa el tren de pulsos y la portadora alineados con el espectro sinc."
    },
    fsk: {
        title: "Modulación FSK (Desplazamiento de Frecuencia)",
        subtitle: "Transmisión de datos mediante conmutación de frecuencias f0 (bit 0) y f1 (bit 1) con fase continua y espectro de 2 tonos."
    },
    pcm: {
        title: "Modulación por Pulsos Codificados (PCM)",
        subtitle: "Las 3 etapas de digitalización analógica: Muestreo (Nyquist y aliasing), Cuantificación uniforme (2^n niveles) y Codificación binaria."
    }
};

function parseNum(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const str = String(el.value).trim().replace(",", ".");
    const val = parseFloat(str);
    return isNaN(val) ? fallback : val;
}

function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn");
    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const mod = btn.dataset.module;
            if (!mod || mod === state.activeModule) return;
            navButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            switchModule(mod);
        });
    });
}

function switchModule(mod) {
    state.activeModule = mod;
    hideAlert();

    const info = MODULE_TITLES[mod];
    if (info) {
        const titleEl = document.getElementById("page-title");
        const subEl = document.getElementById("page-subtitle");
        if (titleEl) titleEl.textContent = info.title;
        if (subEl) subEl.textContent = info.subtitle;
    }

    document.querySelectorAll(".module-card").forEach(c => (c.style.display = "none"));
    document.querySelectorAll(".module-plots").forEach(p => (p.style.display = "none"));

    const ctrlCard = document.getElementById(`ctrl-${mod}`);
    const plotGrid = document.getElementById(`plots-${mod}`);
    if (ctrlCard) ctrlCard.style.display = "block";
    if (plotGrid) plotGrid.style.display = "grid";

    runSimulation();
    setTimeout(() => {
        if (state.chartManager) state.chartManager.resizeAll();
    }, 60);
}

let debounceTimer = null;
function setupInputs() {
    const allInputs = document.querySelectorAll(".control-sidebar input, .control-sidebar select");
    allInputs.forEach(input => {
        const handler = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => runSimulation(), 100);
        };
        input.addEventListener("input", handler);
        input.addEventListener("change", handler);
    });
}

function setupButtons() {
    const btnSim = document.getElementById("btn-simulate");
    if (btnSim) btnSim.addEventListener("click", () => runSimulation());

    const btnReset = document.getElementById("btn-reset");
    if (btnReset) btnReset.addEventListener("click", () => resetDefaults());

    window.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            runSimulation();
        }
    });
}

function resetDefaults() {
    const def = DEFAULTS[state.activeModule];
    if (!def) return;

    if (state.activeModule === "am") {
        document.getElementById("am-vm").value = def.vm;
        document.getElementById("am-fm").value = def.fm;
        document.getElementById("am-vp").value = def.vp;
        document.getElementById("am-fp").value = def.fp;
    } else if (state.activeModule === "ask") {
        document.getElementById("ask-bits").value = def.bits;
        document.getElementById("ask-rb").value = def.rb;
        document.getElementById("ask-fp").value = def.fp;
        document.getElementById("ask-v0").value = def.v0;
    } else if (state.activeModule === "fsk") {
        document.getElementById("fsk-bits").value = def.bits;
        document.getElementById("fsk-rb").value = def.rb;
        document.getElementById("fsk-f0").value = def.f0;
        document.getElementById("fsk-f1").value = def.f1;
    } else if (state.activeModule === "pcm") {
        document.getElementById("pcm-fm").value = def.fm;
        document.getElementById("pcm-fs").value = def.fs;
        document.getElementById("pcm-nbits").value = def.nbits;
    }

    runSimulation();
}

function runSimulation() {
    try {
        if (state.activeModule === "am") {
            runAM();
        } else if (state.activeModule === "ask") {
            runASK();
        } else if (state.activeModule === "fsk") {
            runFSK();
        } else if (state.activeModule === "pcm") {
            runPCM();
        }
        hideAlert();
    } catch (err) {
        showAlert(`Error en simulación: ${err.message}`);
        console.error(err);
    }
}

function runAM() {
    const vm = parseNum("am-vm", 0.8);
    const fm = parseNum("am-fm", 100);
    const vp = parseNum("am-vp", 1.0);
    const fp = parseNum("am-fp", 1000);

    const data = simulateAM({ vm, fm, vp, fp });

    setKPI("m1", "Índice de Modulación", `m = ${data.kpis.m}`, `Porcentaje M = ${data.kpis.mPct}%`);
    setKPI("m2", "Estado de la Modulación", data.kpis.isOvermodulated ? "SOBREMODULACIÓN" : "MODULACIÓN LINEAL",
        `<span class="${data.kpis.isOvermodulated ? 'badge-alert' : 'badge-ok'}">${data.kpis.statusText}</span>`);
    setKPI("m3", "Ancho de Banda Requerido", data.kpis.bw, `BW = 2 · fm (2 × ${data.kpis.fm} Hz)`);
    setKPI("m4", "Bandas Laterales", `BLI: ${data.kpis.bli}`, `BLS: ${data.kpis.bls}`);

    state.chartManager.renderAMModAndCarrier("am-plot-mod-carrier", data);
    state.chartManager.renderAMModulated("am-plot-modulated", data);
    state.chartManager.renderAMSpectrum("am-plot-spectrum", data);
}

function runASK() {
    const bitsInput = document.getElementById("ask-bits");
    let bits = bitsInput ? bitsInput.value.trim().replace(/[^01]/g, "") : "10110100";
    if (!bits) bits = "10110100";
    if (bitsInput && bitsInput.value !== bits) bitsInput.value = bits;

    const rb = parseNum("ask-rb", 100);
    const fp = parseNum("ask-fp", 400);
    const v0 = parseNum("ask-v0", 0.0);

    const data = simulateASK({ bits, rb, fp, v0, vp: 1.0 });

    setKPI("m1", "Secuencia Activa", data.kpis.activeSeq, `${data.cleanBits.length} bits en transmisión`);
    setKPI("m2", "Frecuencia Portadora", data.kpis.fp, `Tasa de señalización: ${data.kpis.rb}`);
    setKPI("m3", "Ciclos por Bit", `${data.kpis.cyclesPerBit} ciclos/bit`, `fp / Rb = ${data.kpis.cyclesPerBit}`);
    setKPI("m4", "Ancho de Banda Aprox.", data.kpis.approxBw, `Lóbulo principal sinc: 2 · Rb`);

    state.chartManager.renderASKBits("ask-plot-bits", data);
    state.chartManager.renderASKCarrier("ask-plot-carrier", data);
    state.chartManager.renderASKModulated("ask-plot-modulated", data);
    state.chartManager.renderASKSpectrum("ask-plot-spectrum", data);
}

function runFSK() {
    const bitsInput = document.getElementById("fsk-bits");
    let bits = bitsInput ? bitsInput.value.trim().replace(/[^01]/g, "") : "10110100";
    if (!bits) bits = "10110100";
    if (bitsInput && bitsInput.value !== bits) bitsInput.value = bits;

    const rb = parseNum("fsk-rb", 100);
    const f0 = parseNum("fsk-f0", 200);
    const f1 = parseNum("fsk-f1", 600);

    const data = simulateFSK({ bits, rb, f0, f1, vp: 1.0 });

    setKPI("m1", "Frecuencia Bit '1'", data.kpis.f1, `Tono para nivel binario alto`);
    setKPI("m2", "Frecuencia Bit '0'", data.kpis.f0, `Tono para nivel binario bajo`);
    setKPI("m3", "Separación de Tonos", `Δf = ${data.kpis.deltaF}`, `Diferencia |f1 - f0|`);
    setKPI("m4", "Tipo de FSK", data.kpis.isWideband ? "Banda Ancha" : "Banda Angosta",
        `<span class="badge-ok">${data.kpis.fskType}</span>`);

    state.chartManager.renderFSKBits("fsk-plot-bits", data);
    state.chartManager.renderFSKModulated("fsk-plot-modulated", data);
    state.chartManager.renderFSKSpectrum("fsk-plot-spectrum", data);
}

function runPCM() {
    const fm = parseNum("pcm-fm", 10);
    const fs = parseNum("pcm-fs", 60);
    const nBits = parseInt(document.getElementById("pcm-nbits") ? document.getElementById("pcm-nbits").value : "3", 10) || 3;

    const data = simulatePCM({ fm, fs, nBits, amp: 1.0 });

    const meets = data.kpis.meetsNyquist;
    setKPI("m1", "Criterio de Nyquist", meets ? "CUMPLE NYQUIST" : "¡ALIASING DETECTADO!",
        `<span class="${meets ? 'badge-ok' : 'badge-alert'}">${data.kpis.nyqText}</span>`);
    setKPI("m2", "Frecuencia de Nyquist", `fs_min = ${data.kpis.fNyquist}`, `fs actual = ${data.kpis.fs} (fm = ${data.kpis.fm})`);
    setKPI("m3", "Niveles de Cuantificación", data.kpis.levels, `Resolución paso q = ${data.kpis.qStep}`);
    setKPI("m4", "Tasa de Bits Resultante", data.kpis.rb, `Rb = fs × n (${data.kpis.fs} × ${data.kpis.nBits} bits)`);

    state.chartManager.renderPCMSampling("pcm-plot-sampling", data);
    state.chartManager.renderPCMQuantization("pcm-plot-quantization", data);
    state.chartManager.renderPCMCoding("pcm-plot-coding", data);
}

function setKPI(cardPrefix, title, value, caption) {
    const elTitle = document.getElementById(`${cardPrefix}-title`);
    const elValue = document.getElementById(`${cardPrefix}-value`);
    const elCaption = document.getElementById(`${cardPrefix}-caption`);

    if (elTitle) elTitle.textContent = title;
    if (elValue) elValue.textContent = value;
    if (elCaption) elCaption.innerHTML = caption;
}

function showAlert(msg) {
    const banner = document.getElementById("alert-banner");
    const msgEl = document.getElementById("alert-msg");
    if (banner && msgEl) {
        msgEl.textContent = msg;
        banner.style.display = "block";
    }
}

function hideAlert() {
    const banner = document.getElementById("alert-banner");
    if (banner) banner.style.display = "none";
}

// ===========================================================================
// 5. INICIALIZACIÓN ROBUSTA (A PRUEBA DE DOMContentLoaded TARDÍO O PLOTLY CDN)
// ===========================================================================
function startApp() {
    state.chartManager = new ChartManager();
    setupNavigation();
    setupInputs();
    setupButtons();

    // Si Plotly ya está listo, simular de inmediato; si no, reintentar brevemente
    if (window.Plotly) {
        switchModule("am");
    } else {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (window.Plotly) {
                clearInterval(interval);
                switchModule("am");
            } else if (attempts >= 40) {
                clearInterval(interval);
                // Si Plotly no cargó, igual actualizar KPIs y alertar
                switchModule("am");
                showAlert("Aviso: No se pudo cargar la librería Plotly.js para las gráficas.");
            }
        }, 50);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp);
} else {
    // Si el DOM ya cargó (típico en ejecución diferida o scripts al final)
    startApp();
}
