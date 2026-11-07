/**
 * chart_manager.js
 * Visualización interactiva con Plotly.js usando la paleta solicitada:
 * #2D2300, #5A4500, #876801, #B48A01, #E1AD01, #EAC64D, #F0D680, #F6E6B3, #FAF3D9
 * 
 * Arquitectura Anti-Colisión:
 * Los títulos descriptivos se ubican en el encabezado HTML .plot-card-header.
 * El lienzo de Plotly se reserva exclusivamente para las trazas, leyenda flotante superior
 * sin superposición y botones de interacción.
 */

const PALETTE = {
    bgPaper: "#1A1400",
    bgPlot: "#120E01",
    grid: "rgba(135, 104, 1, 0.18)",
    zeroline: "#5A4500",
    gold900: "#2D2300",
    gold800: "#5A4500",
    gold700: "#876801",
    gold600: "#B48A01",
    gold500: "#E1AD01", // Ámbar dorado radiante principal
    gold400: "#EAC64D", // Dorado cálido brillante
    gold300: "#F0D680", // Arena dorada suave
    gold200: "#F6E6B3", // Crema claro
    gold100: "#FAF3D9", // Marfil perla de alto contraste
    alert: "#FF6B6B",
};

function baseLayout(xTitle, yTitle, extra = {}) {
    return {
        // title en false: el título está en el header HTML (.plot-card-header)
        // evitando cualquier superposición con la leyenda o la barra de herramientas Plotly
        title: false,
        paper_bgcolor: PALETTE.bgPaper,
        plot_bgcolor: PALETTE.bgPlot,
        font: { family: "Inter, system-ui, sans-serif", size: 10.5, color: PALETTE.gold200 },
        margin: { l: 52, r: 24, t: 26, b: 38 },
        xaxis: {
            title: { text: xTitle, font: { size: 10.5, color: PALETTE.gold300 } },
            gridcolor: PALETTE.grid,
            zerolinecolor: PALETTE.zeroline,
            tickfont: { size: 9.5, color: PALETTE.gold200 },
            ...extra.xaxis,
        },
        yaxis: {
            title: { text: yTitle, font: { size: 10.5, color: PALETTE.gold300 } },
            gridcolor: PALETTE.grid,
            zerolinecolor: PALETTE.zeroline,
            tickfont: { size: 9.5, color: PALETTE.gold200 },
            ...extra.yaxis,
        },
        legend: {
            orientation: "h",
            x: 0.02,
            y: 1.09,
            xanchor: "left",
            yanchor: "bottom",
            font: { size: 10, color: PALETTE.gold100 },
            bgcolor: "rgba(45, 35, 0, 0.75)",
            bordercolor: PALETTE.gold800,
            borderwidth: 1,
            ...extra.legend,
        },
        hoverlabel: {
            bgcolor: PALETTE.gold900,
            bordercolor: PALETTE.gold500,
            font: { family: "Inter, sans-serif", size: 11, color: PALETTE.gold100 },
        },
        autosize: true,
        ...extra,
    };
}

const PLOT_CONFIG = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
};

export class ChartManager {
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

    async renderPlot(divId, data, layout) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;
        await window.Plotly.react(el, data, layout, PLOT_CONFIG);
    }

    downloadPNG(divId, filename = "grafica.png") {
        const el = typeof divId === "string" ? document.getElementById(divId) : divId;
        if (!el || !window.Plotly) return;
        window.Plotly.downloadImage(el, { format: "png", filename, width: 1200, height: 700 });
    }

    // -----------------------------------------------------------------------
    // RENDERIZADO MÓDULO AM
    // -----------------------------------------------------------------------
    renderAM(res, curve, cfg) {
        const tMs = Array.from(res.t).map((v) => v * 1000.0);
        const maxMs = tMs[0] + (4.0 / cfg.fm) * 1000.0;
        let zoomLen = 0;
        while (zoomLen < tMs.length && tMs[zoomLen] <= maxMs) zoomLen++;
        zoomLen = Math.max(10, Math.min(zoomLen, tMs.length));

        const tZoom = tMs.slice(0, zoomLen);
        const msgZoom = Array.from(res.message.subarray(0, zoomLen));
        const envZoom = Array.from(res.env.subarray(0, zoomLen));
        const cohZoom = Array.from(res.coh.subarray(0, zoomLen));
        const txZoom = Array.from(res.tx.subarray(0, zoomLen));
        const gain = Math.max(res.report.gainLinear, 1e-30);
        const rxZoom = Array.from(res.rx.subarray(0, zoomLen)).map((v) => v / gain);

        // 1) Recuperación
        this.renderPlot(
            "am-plot-recovery",
            [
                { x: tZoom, y: msgZoom, name: "m(t) Original", mode: "lines", line: { color: PALETTE.gold100, width: 2.2 } },
                { x: tZoom, y: envZoom, name: "Det. Envolvente", mode: "lines", line: { color: PALETTE.gold400, width: 1.4 } },
                { x: tZoom, y: cohZoom, name: "Det. Coherente", mode: "lines", line: { color: PALETTE.gold200, width: 1.3, dash: "dot" } },
            ],
            baseLayout("Tiempo (ms)", "Amplitud normalizada", {
                yaxis: { range: [-1.8, 1.8] },
            })
        );

        // 2) Señal de RF
        this.renderPlot(
            "am-plot-rf",
            [
                { x: tZoom, y: txZoom, name: "TX", mode: "lines", line: { color: PALETTE.gold500, width: 1.1 } },
                { x: tZoom, y: rxZoom, name: "RX / Ganancia", mode: "lines", line: { color: PALETTE.gold300, width: 0.9 }, opacity: 0.85 },
            ],
            baseLayout("Tiempo (ms)", "Amplitud")
        );

        // 3) Espectro
        const fTx = Array.from(res.spectrumTxF).map((v) => v / 1000.0);
        const fRx = Array.from(res.spectrumRxF).map((v) => v / 1000.0);
        const sTx = Array.from(res.spectrumTxDb);
        const sRx = Array.from(res.spectrumRxDb);
        const fMaxKhz = Math.min(cfg.fs / 2000.0, (cfg.fc + 6 * cfg.fm) / 1000.0);

        this.renderPlot(
            "am-plot-spectrum",
            [
                { x: fTx, y: sTx, name: "TX", mode: "lines", line: { color: PALETTE.gold500, width: 1.3 } },
                { x: fRx, y: sRx, name: "RX", mode: "lines", line: { color: PALETTE.gold300, width: 0.9 }, opacity: 0.75 },
            ],
            baseLayout("Frecuencia (kHz)", "Magnitud (dB)", {
                xaxis: { range: [0, fMaxKhz] },
                yaxis: { range: [-90, 5] },
                shapes: [
                    { type: "line", x0: (cfg.fc - cfg.fm) / 1000, x1: (cfg.fc - cfg.fm) / 1000, y0: -90, y1: 5, line: { color: PALETTE.gold700, dash: "dot", width: 1 } },
                    { type: "line", x0: cfg.fc / 1000, x1: cfg.fc / 1000, y0: -90, y1: 5, line: { color: PALETTE.gold600, dash: "dash", width: 1 } },
                    { type: "line", x0: (cfg.fc + cfg.fm) / 1000, x1: (cfg.fc + cfg.fm) / 1000, y0: -90, y1: 5, line: { color: PALETTE.gold700, dash: "dot", width: 1 } },
                ],
            })
        );

        // 4) Error de Demodulación
        const trim = Math.max(5, Math.floor(tMs.length / 20));
        const tTrim = tMs.slice(trim, tMs.length - trim);
        const envErrTrim = Array.from(res.envErr.subarray(trim, res.envErr.length - trim));
        const cohErrTrim = Array.from(res.cohErr.subarray(trim, res.cohErr.length - trim));

        this.renderPlot(
            "am-plot-error",
            [
                { x: tTrim, y: envErrTrim, name: "Error Envolvente", mode: "lines", line: { color: PALETTE.gold400, width: 1.1 } },
                { x: tTrim, y: cohErrTrim, name: "Error Coherente", mode: "lines", line: { color: PALETTE.gold200, width: 1.1 } },
            ],
            baseLayout("Tiempo (ms)", "Recuperada − Original")
        );

        // 5) Curva de Fidelidad (MSE vs SNR)
        const snrVals = Array.from(curve.snrDb);
        const mseEnv = Array.from(curve.mseEnv).map((v) => Math.max(v, 1e-12));
        const mseCoh = Array.from(curve.mseCoh).map((v) => Math.max(v, 1e-12));
        const actualSnr = res.metrics.snrEffDb;

        const fidelityTraces = [
            { x: snrVals, y: mseEnv, name: "Envolvente (AWGN)", mode: "lines+markers", line: { color: PALETTE.gold400, width: 1.4 }, marker: { size: 5 } },
            { x: snrVals, y: mseCoh, name: "Coherente (AWGN)", mode: "lines+markers", line: { color: PALETTE.gold200, width: 1.3 }, marker: { size: 5, symbol: "square" } },
        ];
        if (isFinite(actualSnr)) {
            fidelityTraces.push({
                x: [actualSnr],
                y: [Math.max(res.metrics.mseEnv, 1e-12)],
                name: "Punto Envolvente actual",
                mode: "markers",
                marker: { color: PALETTE.gold100, size: 9, line: { color: PALETTE.gold500, width: 2 } },
            });
            fidelityTraces.push({
                x: [actualSnr],
                y: [Math.max(res.metrics.mseCoh, 1e-12)],
                name: "Punto Coherente actual",
                mode: "markers",
                marker: { color: PALETTE.gold500, size: 9, symbol: "square", line: { color: PALETTE.gold100, width: 1.5 } },
            });
        }

        this.renderPlot(
            "am-plot-fidelity",
            fidelityTraces,
            baseLayout("SNR nominal (dB)", "MSE", {
                yaxis: { type: "log" },
            })
        );

        // 6) Reparto de Potencia
        const car = res.metrics.carrierFraction * 100.0;
        const side = (res.metrics.sidebandFraction * 100.0) / 2.0;
        this.renderPlot(
            "am-plot-power",
            [
                { y: ["Potencia"], x: [car], name: "Portadora", type: "bar", orientation: "h", marker: { color: PALETTE.gold500 } },
                { y: ["Potencia"], x: [side], name: "Banda Inf. (BLI)", type: "bar", orientation: "h", marker: { color: PALETTE.gold600 } },
                { y: ["Potencia"], x: [side], name: "Banda Sup. (BLS)", type: "bar", orientation: "h", marker: { color: PALETTE.gold400 } },
            ],
            baseLayout("% de Potencia Total", "", {
                barmode: "stack",
                xaxis: { range: [0, 100] },
                yaxis: { showticklabels: false },
            })
        );
    }

    // -----------------------------------------------------------------------
    // RENDERIZADO MÓDULO ASK / OOK
    // -----------------------------------------------------------------------
    renderASK(res, curve, cfg) {
        const tMs = Array.from(res.t).map((v) => v * 1000.0);
        const nshow = Math.min(24, res.nbits);
        const maxMs = tMs[0] + (nshow / res.rb) * 1000.0;
        let zoomLen = 0;
        while (zoomLen < tMs.length && tMs[zoomLen] <= maxMs) zoomLen++;
        const tZoom = tMs.slice(0, zoomLen);
        const txZoom = Array.from(res.tx.subarray(0, zoomLen));
        const gain = Math.max(res.report.gainLinear, 1e-30);
        const rxZoom = Array.from(res.rx.subarray(0, zoomLen)).map((v) => v / gain);

        const bitCenters = [];
        const bitMarkers = [];
        for (let b = 0; b < nshow; b++) {
            bitCenters.push((b + 0.5) * (1000.0 / res.rb));
            bitMarkers.push(res.detected[b] * cfg.amplitude * 1.15);
        }

        // 1) Forma de onda
        this.renderPlot(
            "ask-plot-waveform",
            [
                { x: tZoom, y: txZoom, name: "TX", mode: "lines", line: { color: PALETTE.gold500, width: 1.2 } },
                { x: tZoom, y: rxZoom, name: "RX / Ganancia", mode: "lines", line: { color: PALETTE.gold300, width: 0.9 }, opacity: 0.8 },
                { x: bitCenters, y: bitMarkers, name: "Bits detectados", mode: "markers", marker: { color: PALETTE.gold100, size: 7, line: { color: PALETTE.gold500, width: 1.5 } } },
            ],
            baseLayout("Tiempo (ms)", "Amplitud")
        );

        // 2) Espectro
        const fKhz = Array.from(res.spectrumF).map((v) => v / 1000.0);
        const sDb = Array.from(res.spectrumDb);
        const fcKhz = res.extras.fc / 1000.0;
        const rbKhz = res.rb / 1000.0;

        this.renderPlot(
            "ask-plot-spectrum",
            [{ x: fKhz, y: sDb, name: "TX", mode: "lines", line: { color: PALETTE.gold500, width: 1.2 } }],
            baseLayout("Frecuencia (kHz)", "Magnitud (dB)", {
                xaxis: { range: [0, Math.min(res.fs / 2000.0, fcKhz + 6 * rbKhz)] },
                yaxis: { range: [-80, 5] },
                shapes: [
                    { type: "line", x0: fcKhz, x1: fcKhz, y0: -80, y1: 5, line: { color: PALETTE.gold600, dash: "dot", width: 1 } },
                ],
            })
        );

        // 3) Diagrama de Ojo
        const eyeTraces = [];
        if (res.eye && res.eye.length > 0) {
            const nRows = Math.min(res.eye.length, 120);
            const sps = res.sps;
            const ui = Array.from({ length: sps }, (_, i) => i / (sps - 1));
            for (let i = 0; i < nRows; i++) {
                const row = Array.from(res.eye[i]).map((v) => v / gain);
                eyeTraces.push({
                    x: ui,
                    y: row,
                    mode: "lines",
                    line: { color: PALETTE.gold300, width: 0.6 },
                    opacity: 0.22,
                    showlegend: false,
                    hoverinfo: "skip",
                });
            }
            const thr = res.extras.threshold / gain;
            eyeTraces.push({
                x: [0, 1],
                y: [thr, thr],
                name: "Umbral decisión",
                mode: "lines",
                line: { color: PALETTE.gold100, width: 1.5, dash: "dash" },
            });
        }
        this.renderPlot("ask-plot-eye", eyeTraces, baseLayout("Tiempo Normalizado (UI)", "Amplitud"));

        // 4) Curva BER
        const ebn0Vals = Array.from(curve.ebn0Db);
        const berTheoryVals = Array.from(curve.berTheory).map((v) => Math.max(v, 1e-7));
        const berSimVals = Array.from(curve.berSim).map((v) => Math.max(v, 0.5 / curve.nbits));
        const actualEbn0 = res.ebn0EffDb;

        const berTraces = [
            { x: ebn0Vals, y: berTheoryVals, name: "Teoría AWGN", mode: "lines", line: { color: PALETTE.gold700, width: 1.6 } },
            { x: ebn0Vals, y: berSimVals, name: `Monte Carlo (${curve.nbits} b)`, mode: "lines+markers", line: { color: PALETTE.gold500, width: 1.2 }, marker: { size: 5 } },
        ];
        if (isFinite(actualEbn0)) {
            const yAct = res.ber > 0 ? res.ber : 0.5 / res.nbits;
            berTraces.push({
                x: [actualEbn0],
                y: [yAct],
                name: "Punto de Operación Actual",
                mode: "markers",
                marker: { color: PALETTE.gold100, size: 9, line: { color: PALETTE.gold500, width: 2 } },
            });
        }

        this.renderPlot(
            "ask-plot-ber",
            berTraces,
            baseLayout("Eb/N0 (dB)", "BER", {
                yaxis: { type: "log", range: [-6, 0] },
                xaxis: { range: [ebn0Vals[0], ebn0Vals[ebn0Vals.length - 1]] },
            })
        );
    }

    // -----------------------------------------------------------------------
    // RENDERIZADO MÓDULO FSK
    // -----------------------------------------------------------------------
    renderFSK(res, curve, cfg) {
        const tMs = Array.from(res.t).map((v) => v * 1000.0);
        const nshow = Math.min(24, res.nbits);
        const maxMs = tMs[0] + (nshow / res.rb) * 1000.0;
        let zoomLen = 0;
        while (zoomLen < tMs.length && tMs[zoomLen] <= maxMs) zoomLen++;
        const tZoom = tMs.slice(0, zoomLen);
        const txZoom = Array.from(res.tx.subarray(0, zoomLen));
        const gain = Math.max(res.report.gainLinear, 1e-30);
        const rxZoom = Array.from(res.rx.subarray(0, zoomLen)).map((v) => v / gain);

        const bitCenters = [];
        const bitMarkers = [];
        for (let b = 0; b < nshow; b++) {
            bitCenters.push((b + 0.5) * (1000.0 / res.rb));
            bitMarkers.push((res.detected[b] * 2.0 - 1.0) * cfg.amplitude * 1.15);
        }

        // 1) Forma de onda
        this.renderPlot(
            "fsk-plot-waveform",
            [
                { x: tZoom, y: txZoom, name: "TX", mode: "lines", line: { color: PALETTE.gold500, width: 1.2 } },
                { x: tZoom, y: rxZoom, name: "RX / Ganancia", mode: "lines", line: { color: PALETTE.gold300, width: 0.9 }, opacity: 0.8 },
                { x: bitCenters, y: bitMarkers, name: "Bits detectados", mode: "markers", marker: { color: PALETTE.gold100, size: 7, line: { color: PALETTE.gold500, width: 1.5 } } },
            ],
            baseLayout("Tiempo (ms)", "Amplitud")
        );

        // 2) Frecuencia estimada por bit
        const tBitMs = Array.from(res.tBit).map((v) => v * 1000.0);
        const fBitKhz = Array.from(res.fBit).map((v) => v / 1000.0);
        const f0Khz = res.extras.f0 / 1000.0;
        const f1Khz = res.extras.f1 / 1000.0;
        const nInstShow = Math.min(nshow, tBitMs.length);

        this.renderPlot(
            "fsk-plot-freq",
            [
                { x: tBitMs.slice(0, nInstShow), y: fBitKhz.slice(0, nInstShow), name: "f estimada", mode: "lines+markers", line: { shape: "hv", color: PALETTE.gold400, width: 1.5 } },
            ],
            baseLayout("Tiempo (ms)", "Frecuencia (kHz)", {
                shapes: [
                    { type: "line", x0: 0, x1: tBitMs[nInstShow - 1], y0: f0Khz, y1: f0Khz, line: { color: PALETTE.gold600, dash: "dash", width: 1 } },
                    { type: "line", x0: 0, x1: tBitMs[nInstShow - 1], y0: f1Khz, y1: f1Khz, line: { color: PALETTE.gold500, dash: "dash", width: 1 } },
                ],
                yaxis: { range: [Math.min(f0Khz, f1Khz) - 1.5, Math.max(f0Khz, f1Khz) + 1.5] },
            })
        );

        // 3) Espectro
        const fKhz = Array.from(res.spectrumF).map((v) => v / 1000.0);
        const sDb = Array.from(res.spectrumDb);
        this.renderPlot(
            "fsk-plot-spectrum",
            [{ x: fKhz, y: sDb, name: "TX", mode: "lines", line: { color: PALETTE.gold500, width: 1.2 } }],
            baseLayout("Frecuencia (kHz)", "Magnitud (dB)", {
                xaxis: { range: [Math.max(0, f0Khz - 4 * (cfg.rb / 1000.0)), f1Khz + 4 * (cfg.rb / 1000.0)] },
                yaxis: { range: [-80, 5] },
                shapes: [
                    { type: "line", x0: f0Khz, x1: f0Khz, y0: -80, y1: 5, line: { color: PALETTE.gold600, dash: "dash", width: 1 } },
                    { type: "line", x0: f1Khz, x1: f1Khz, y0: -80, y1: 5, line: { color: PALETTE.gold500, dash: "dash", width: 1 } },
                ],
            })
        );

        // 4) Curva BER
        const ebn0Vals = Array.from(curve.ebn0Db);
        const berTheoryVals = Array.from(curve.berTheory).map((v) => Math.max(v, 1e-7));
        const berSimVals = Array.from(curve.berSim).map((v) => Math.max(v, 0.5 / curve.nbits));
        const actualEbn0 = res.ebn0EffDb;

        const berTraces = [
            { x: ebn0Vals, y: berTheoryVals, name: "Teoría AWGN", mode: "lines", line: { color: PALETTE.gold700, width: 1.6 } },
            { x: ebn0Vals, y: berSimVals, name: `Monte Carlo (${curve.nbits} b)`, mode: "lines+markers", line: { color: PALETTE.gold500, width: 1.2 }, marker: { size: 5 } },
        ];
        if (isFinite(actualEbn0)) {
            const yAct = res.ber > 0 ? res.ber : 0.5 / res.nbits;
            berTraces.push({
                x: [actualEbn0],
                y: [yAct],
                name: "Punto de Operación Actual",
                mode: "markers",
                marker: { color: PALETTE.gold100, size: 9, line: { color: PALETTE.gold500, width: 2 } },
            });
        }

        this.renderPlot(
            "fsk-plot-ber",
            berTraces,
            baseLayout("Eb/N0 (dB)", "BER", {
                yaxis: { type: "log", range: [-6, 0] },
                xaxis: { range: [ebn0Vals[0], ebn0Vals[ebn0Vals.length - 1]] },
            })
        );
    }

    // -----------------------------------------------------------------------
    // RENDERIZADO MÓDULO PCM
    // -----------------------------------------------------------------------
    renderPCM(res, bitsCurve, linkCurve, cfg) {
        const tAnalogMs = Array.from(res.tAnalog).map((v) => v * 1000.0);
        const maxMs = Math.min(cfg.duration * 1000.0, 10.0);
        let mLen = 0;
        while (mLen < tAnalogMs.length && tAnalogMs[mLen] <= maxMs) mLen++;

        const tZoom = tAnalogMs.slice(0, mLen);
        const xAnalogZoom = Array.from(res.xAnalog.subarray(0, mLen));
        const xZohZoom = Array.from(res.xZoh.subarray(0, mLen));
        const xRecZoom = Array.from(res.xRec.subarray(0, mLen));

        const tSMs = Array.from(res.tS).map((v) => v * 1000.0);
        let sLen = 0;
        while (sLen < tSMs.length && tSMs[sLen] <= maxMs) sLen++;
        const tSZoom = tSMs.slice(0, sLen);
        const xSZoom = Array.from(res.xS.subarray(0, sLen));
        const xqZoom = Array.from(res.xq.subarray(0, sLen));
        const qerrZoom = Array.from(res.qerr.subarray(0, sLen)).map((v) => v * 1000.0);

        // 1) Muestreo y Cuantificación
        this.renderPlot(
            "pcm-plot-sampling",
            [
                { x: tZoom, y: xAnalogZoom, name: "Analógica", mode: "lines", line: { color: PALETTE.gold100, width: 1.5 } },
                { x: tSZoom, y: xSZoom, name: "Muestras", mode: "markers", marker: { color: PALETTE.gold500, size: 5 } },
                { x: tSZoom, y: xqZoom, name: "Cuantificada", mode: "markers", marker: { color: PALETTE.gold400, size: 4, symbol: "square" } },
            ],
            baseLayout("Tiempo (ms)", "Amplitud (V)")
        );

        // 2) Error de Cuantificación
        const halfQ = (res.q * 0.5) * 1000.0;
        this.renderPlot(
            "pcm-plot-qerr",
            [
                { x: tSZoom, y: qerrZoom, name: "xq − x", mode: "lines+markers", line: { color: PALETTE.gold400, width: 1.0 }, marker: { size: 3 } },
            ],
            baseLayout("Tiempo (ms)", "Error (mV)", {
                shapes: [
                    { type: "line", x0: tSZoom[0], x1: tSZoom[sLen - 1], y0: halfQ, y1: halfQ, line: { color: PALETTE.gold600, dash: "dash", width: 1 } },
                    { type: "line", x0: tSZoom[0], x1: tSZoom[sLen - 1], y0: -halfQ, y1: -halfQ, line: { color: PALETTE.gold600, dash: "dash", width: 1 } },
                ],
            })
        );

        // 3) Reconstrucción
        this.renderPlot(
            "pcm-plot-reconstruction",
            [
                { x: tZoom, y: xAnalogZoom, name: "Original", mode: "lines", line: { color: PALETTE.gold100, width: 1.5 } },
                { x: tZoom, y: xZohZoom, name: "ZOH", mode: "lines", line: { color: PALETTE.gold700, width: 1.0, dash: "dot" }, opacity: 0.7 },
                { x: tZoom, y: xRecZoom, name: "Sinc (Reconstruida)", mode: "lines", line: { color: PALETTE.gold400, width: 1.5 } },
                { x: tSZoom, y: xqZoom, name: "Niveles", mode: "markers", marker: { color: PALETTE.gold500, size: 4 } },
            ],
            baseLayout("Tiempo (ms)", "Amplitud (V)")
        );

        // 4) Espectro y Aliasing
        const fAnalogKhz = Array.from(res.spectrumAnalogF).map((v) => v / 1000.0);
        const sAnalogDb = Array.from(res.spectrumAnalogDb);
        const fSampledKhz = Array.from(res.spectrumSampledF).map((v) => v / 1000.0);
        const sSampledDb = Array.from(res.spectrumSampledDb);
        const nyqKhz = res.metrics.nyquistHz / 1000.0;

        this.renderPlot(
            "pcm-plot-spectrum",
            [
                { x: fAnalogKhz, y: sAnalogDb, name: "Analógica", mode: "lines", line: { color: PALETTE.gold100, width: 1.3 } },
                { x: fSampledKhz, y: sSampledDb, name: "Muestreada", mode: "lines", line: { color: PALETTE.gold500, width: 1.0 }, opacity: 0.8 },
            ],
            baseLayout("Frecuencia (kHz)", "Magnitud (dB)", {
                xaxis: { range: [0, Math.min(cfg.fsSample / 2000.0, Math.max(2.5 * (cfg.fm / 1000.0), 1.5 * nyqKhz))] },
                yaxis: { range: [-90, 5] },
                shapes: [
                    { type: "line", x0: cfg.fm / 1000.0, x1: cfg.fm / 1000.0, y0: -90, y1: 5, line: { color: PALETTE.gold400, dash: "dot", width: 1 } },
                    { type: "line", x0: nyqKhz, x1: nyqKhz, y0: -90, y1: 5, line: { color: PALETTE.alert, dash: "dash", width: 1.5 } },
                ],
            })
        );

        // 5) SQNR vs Bits
        const bitsArr = Array.from(bitsCurve.nBits);
        const sqnrTheory = Array.from(bitsCurve.sqnrTheoryDb);
        const sqnrQuant = Array.from(bitsCurve.sqnrQuantDb);
        const sqnrRec = Array.from(bitsCurve.sqnrRecDb);

        this.renderPlot(
            "pcm-plot-sqnr-bits",
            [
                { x: bitsArr, y: sqnrTheory, name: "Teoría (6.02n+1.76)", mode: "lines", line: { color: PALETTE.gold700, width: 1.5 } },
                { x: bitsArr, y: sqnrQuant, name: "Cuantificación", mode: "lines+markers", line: { color: PALETTE.gold500, width: 1.2 }, marker: { size: 5 } },
                { x: bitsArr, y: sqnrRec, name: "Reconstrucción", mode: "lines+markers", line: { color: PALETTE.gold400, width: 1.2 }, marker: { size: 5, symbol: "square" } },
                { x: [cfg.nBits], y: [res.sqnrDb], name: "Actual", mode: "markers", marker: { color: PALETTE.gold100, size: 9, line: { color: PALETTE.gold500, width: 2 } } },
            ],
            baseLayout("Bits por Muestra", "SQNR (dB)")
        );

        // 6) SQNR vs Eb/N0 (Efecto Umbral)
        const ebn0Arr = Array.from(linkCurve.ebn0Db);
        const sqnrLink = Array.from(linkCurve.sqnrDb);
        const ebn0Eff = res.ebn0EffDb;

        const thresholdTraces = [
            { x: ebn0Arr, y: sqnrLink, name: "SQNR Reconstrucción", mode: "lines+markers", line: { color: PALETTE.gold400, width: 1.3 }, marker: { size: 5 } },
        ];
        if (isFinite(ebn0Eff)) {
            thresholdTraces.push({
                x: [ebn0Eff],
                y: [res.sqnrDb],
                name: "Punto Actual",
                mode: "markers",
                marker: { color: PALETTE.gold100, size: 9, line: { color: PALETTE.gold500, width: 2 } },
            });
        }

        this.renderPlot(
            "pcm-plot-sqnr-ebn0",
            thresholdTraces,
            baseLayout("Eb/N0 (dB)", "SQNR (dB)", {
                shapes: [
                    { type: "line", x0: ebn0Arr[0], x1: ebn0Arr[ebn0Arr.length - 1], y0: res.sqnrQuantDb, y1: res.sqnrQuantDb, line: { color: PALETTE.gold500, dash: "dash", width: 1 } },
                ],
            })
        );
    }
}
