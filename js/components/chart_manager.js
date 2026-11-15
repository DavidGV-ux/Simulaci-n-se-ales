/**
 * chart_manager.js
 * Visualización interactiva con Plotly.js para los 4 módulos didácticos.
 * Aplica rigurosamente la paleta Golden Amber (#2D2300 a #FAF3D9) y
 * la arquitectura anti-colisión (title: false en Plotly).
 */

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
    alertBg: "rgba(255, 92, 92, 0.15)",
    ok: "#50E370"
};

function baseLayout(xTitle, yTitle, extra = {}) {
    return {
        title: false, // El título y la descripción van en el HTML (.plot-card-header)
        paper_bgcolor: PALETTE.bgPaper,
        plot_bgcolor: PALETTE.bgPlot,
        font: { family: "Inter, system-ui, sans-serif", size: 10.5, color: PALETTE.gold200 },
        margin: { l: 48, r: 24, t: 26, b: 36, ...extra.margin },
        xaxis: {
            title: { text: xTitle, font: { size: 10.5, color: PALETTE.gold300 } },
            gridcolor: PALETTE.grid,
            zerolinecolor: PALETTE.zeroline,
            tickfont: { size: 9.5, color: PALETTE.gold200 },
            ...extra.xaxis
        },
        yaxis: {
            title: { text: yTitle, font: { size: 10.5, color: PALETTE.gold300 } },
            gridcolor: PALETTE.grid,
            zerolinecolor: PALETTE.zeroline,
            tickfont: { size: 9.5, color: PALETTE.gold200 },
            ...extra.yaxis
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
            ...extra.legend
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

    // =======================================================================
    // MÓDULO 1: Gráficas AM
    // =======================================================================

    renderAMModAndCarrier(divId, data) {
        const el = this.register(divId);
        if (!el || !window.Plotly) return;

        // Convertir tiempo a milisegundos para visualización clara
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

        // Construir líneas verticales (stems) para los 3 impulsos
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

    // =======================================================================
    // MÓDULO 2: Gráficas ASK
    // =======================================================================

    _getBitShapesAndAnnotations(bitBoundaries, bitLabels, yTop = 1.3) {
        const shapes = [];
        for (let t of bitBoundaries) {
            shapes.push({
                type: "line",
                x0: t * 1000,
                x1: t * 1000,
                y0: -2.0,
                y1: 2.0,
                line: { color: PALETTE.gold800, width: 1.2, dash: "dot" }
            });
        }

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

    // =======================================================================
    // MÓDULO 3: Gráficas FSK
    // =======================================================================

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
                    text: `f0 = ${spec.f0} Hz (bit '0')`,
                    showarrow: false,
                    font: { size: 10, color: PALETTE.gold200 }
                },
                {
                    x: spec.f1,
                    y: 0.72,
                    text: `f1 = ${spec.f1} Hz (bit '1')`,
                    showarrow: false,
                    font: { size: 10, color: PALETTE.gold200 }
                }
            ]
        });

        window.Plotly.react(el, [trace], layout, PLOT_CONFIG);
    }

    // =======================================================================
    // MÓDULO 4: Gráficas PCM (Paso a Paso Didáctico)
    // =======================================================================

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

        // Pulsos PAM de muestreo (stems verticales)
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
            name: "Instantes de Muestra",
            marker: { color: PALETTE.gold400, size: 8, symbol: "circle" },
            hovertemplate: "t: %{x:.1f} ms<br>V: %{y:.2f} V<extra></extra>"
        };

        const traces = [traceAnalog, tracePAMStems, tracePAMMarkers];

        // Si hay aliasing, graficar en línea punteada roja la onda aparente
        if (!data.kpis.meetsNyquist && data.aliasSignal) {
            traces.push({
                x: tContMs,
                y: Array.from(data.aliasSignal),
                name: `Reconstrucción con Aliasing (f_alias=${data.fAlias.toFixed(1)} Hz)`,
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

        // Curva analógica continua tenue de referencia
        const traceRef = {
            x: tContMs,
            y: Array.from(data.analogCont),
            name: "Señal de Entrada",
            mode: "lines",
            line: { color: PALETTE.gold700, width: 1.2 }
        };

        // Muestras analógicas
        const traceSamples = {
            x: tSampleMs,
            y: Array.from(data.sampleVals),
            mode: "markers",
            name: "Muestra Original",
            marker: { color: PALETTE.gold300, size: 7, symbol: "circle-open" }
        };

        // Muestras cuantificadas redondeadas al escalón
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

        // Niveles horizontales de cuantificación con código binario a la derecha
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
                text: `<b>${lvl.code}</b> (${lvl.val.toFixed(2)}V)`,
                showarrow: false,
                xanchor: "left",
                font: { size: 9, color: PALETTE.gold200 }
            });
        });

        const layout = baseLayout("Tiempo (ms)", "Niveles Cuantificados", {
            margin: { r: 75 }, // Margen extra a la derecha para etiquetas binarias
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

        // Divisiones entre cada palabra de muestra y texto del código binario encima
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
