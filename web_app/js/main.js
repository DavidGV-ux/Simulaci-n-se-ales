/**
 * main.js
 * Coordinador principal de la aplicación web: eventos, UI, ejecución de simulaciones y exportación.
 */

import { parseCSV } from "./core/signal_generator.js";
import { fslDb } from "./core/channel.js";
import {
    simulateAM,
    simulateASK,
    simulateFSK,
    simulatePCM,
    amFidelityCurve,
    digitalBerCurve,
    pcmSqnrBitsCurve,
    pcmSqnrEbn0Curve,
} from "./core/modulations.js";
import { ChartManager } from "./components/chart_manager.js";

// Estado Global de la Aplicación
const state = {
    activeModule: "am",
    csvSignals: {
        am: null,
        pcm: null,
    },
    lastResult: null,
};

let chartManager = null;

// ===========================================================================
// Inicialización
// ===========================================================================
document.addEventListener("DOMContentLoaded", () => {
    chartManager = new ChartManager();
    setupNavigation();
    setupControlsSync();
    setupChannelPresets();
    setupCSVUploads();
    setupActionButtons();
    setupKeyboardShortcuts();

    // Simulación inicial
    runSimulation();
});

// ===========================================================================
// Navegación entre Módulos
// ===========================================================================
function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn");
    navButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const mod = btn.dataset.module;
            if (mod === state.activeModule) return;

            navButtons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            switchModule(mod);
        });
    });
}

function switchModule(mod) {
    state.activeModule = mod;
    hideError();

    const simView = document.getElementById("simulation-view");
    const theoryView = document.getElementById("theory-view");
    const pageTitle = document.getElementById("page-title");
    const pageSubtitle = document.getElementById("page-subtitle");

    if (mod === "theory") {
        simView.style.display = "none";
        theoryView.classList.add("active");
        pageTitle.textContent = "Marco Teórico y Verificación";
        pageSubtitle.textContent = "Documentación técnica, ecuaciones de canal, decisiones de diseño y comprobaciones.";
        return;
    }

    simView.style.display = "block";
    theoryView.classList.remove("active");

    // Ocultar todos los paneles de control y plots
    document.querySelectorAll(".module-card").forEach((c) => (c.style.display = "none"));
    document.querySelectorAll(".module-plots").forEach((p) => (p.style.display = "none"));

    // Mostrar el activo
    const ctrlCard = document.getElementById(`ctrl-${mod}`);
    const plotGrid = document.getElementById(`plots-${mod}`);
    if (ctrlCard) ctrlCard.style.display = "block";
    if (plotGrid) plotGrid.style.display = "grid";

    // Cambiar visibilidad de campos de canal (SNR vs Eb/N0)
    const grpSnr = document.getElementById("group-snr");
    const grpEbn0 = document.getElementById("group-ebn0");
    if (mod === "am") {
        grpSnr.style.display = "flex";
        grpEbn0.style.display = "none";
    } else {
        grpSnr.style.display = "none";
        grpEbn0.style.display = "flex";
    }

    // Actualizar títulos
    const titles = {
        am: {
            title: "Modulación de Amplitud · AM",
            sub: "La amplitud de la portadora sigue a la moduladora. Compara el detector de envolvente con el coherente y observa la sobremodulación.",
        },
        ask: {
            title: "Amplitud Conmutada · ASK / OOK",
            sub: "La portadora se enciende y apaga según el bit. Analiza el espectro, diagrama de ojo, sincronización y BER.",
        },
        fsk: {
            title: "Frecuencia Conmutada · FSK",
            sub: "El bit selecciona una de dos frecuencias. Observa la frecuencia instantánea, ortogonalidad de tonos y detección no coherente.",
        },
        pcm: {
            title: "Modulación por Pulsos Codificados · PCM",
            sub: "Muestreo, cuantificación uniforme, codificación binaria y transmisión digital. Observa el umbral del enlace.",
        },
    };

    if (titles[mod]) {
        pageTitle.textContent = titles[mod].title;
        pageSubtitle.textContent = titles[mod].sub;
    }

    runSimulation();
    setTimeout(() => chartManager.resizeAll(), 50);
}

// ===========================================================================
// Sincronización Reactiva de Controles
// ===========================================================================
function setupControlsSync() {
    // AM Waveform
    const amWf = document.getElementById("am-waveform");
    amWf.addEventListener("change", () => {
        document.getElementById("group-am-formula").style.display = amWf.value === "formula" ? "flex" : "none";
        document.getElementById("group-am-csv").style.display = amWf.value === "csv" ? "flex" : "none";
    });

    // ASK Bitmode
    const askBm = document.getElementById("ask-bitmode");
    askBm.addEventListener("change", () => {
        document.getElementById("group-ask-manual").style.display = askBm.value === "manual" ? "flex" : "none";
    });

    // FSK Bitmode
    const fskBm = document.getElementById("fsk-bitmode");
    fskBm.addEventListener("change", () => {
        document.getElementById("group-fsk-manual").style.display = fskBm.value === "manual" ? "flex" : "none";
    });

    // PCM Waveform
    const pcmWf = document.getElementById("pcm-waveform");
    pcmWf.addEventListener("change", () => {
        document.getElementById("group-pcm-formula").style.display = pcmWf.value === "formula" ? "flex" : "none";
        document.getElementById("group-pcm-csv").style.display = pcmWf.value === "csv" ? "flex" : "none";
    });

    // Sincronizar frecuencia de interferencia según portadora
    const updateIntFreq = () => {
        const intFreqInput = document.getElementById("chan-int-freq");
        if (state.activeModule === "am") {
            const fc = parseFloat(document.getElementById("am-fc").value) || 20000;
            const fm = parseFloat(document.getElementById("am-fm").value) || 1000;
            intFreqInput.value = fc + 2 * fm;
        } else if (state.activeModule === "ask") {
            const fc = parseFloat(document.getElementById("ask-fc").value) || 6000;
            const rb = parseFloat(document.getElementById("ask-rb").value) || 1000;
            intFreqInput.value = fc + 1.5 * rb;
        } else if (state.activeModule === "fsk") {
            const fc = parseFloat(document.getElementById("fsk-fc").value) || 6000;
            const rb = parseFloat(document.getElementById("fsk-rb").value) || 1000;
            intFreqInput.value = fc + 2.5 * rb;
        }
    };

    document.getElementById("am-fc")?.addEventListener("input", updateIntFreq);
    document.getElementById("ask-fc")?.addEventListener("input", updateIntFreq);
    document.getElementById("fsk-fc")?.addEventListener("input", updateIntFreq);
}

// ===========================================================================
// Presets de Canal y Botón Ajustar Enlace
// ===========================================================================
function setupChannelPresets() {
    const presetSelect = document.getElementById("chan-preset");
    presetSelect.addEventListener("change", () => {
        const val = presetSelect.value;
        const dist = document.getElementById("chan-dist");
        const extra = document.getElementById("chan-extra");
        const mp = document.getElementById("chan-multipath");
        const intf = document.getElementById("chan-interference");
        const cfo = document.getElementById("chan-cfo");
        const pnoise = document.getElementById("chan-pnoise");

        // Defaults
        dist.value = "0";
        extra.value = "0";
        mp.checked = false;
        intf.checked = false;
        cfo.value = "0";
        pnoise.value = "0";

        if (val === "loss") {
            dist.value = "2.0";
            extra.value = "5";
        } else if (val === "multipath") {
            mp.checked = true;
            document.getElementById("chan-mp-delay").value = "1.5";
        } else if (val === "interference") {
            intf.checked = true;
        } else if (val === "cfo") {
            cfo.value = "150";
        }
        runSimulation();
    });

    // Botón Ajustar Enlace: Eleva el nivel nominal para compensar FSL + extra
    document.getElementById("btn-adjust-link").addEventListener("click", () => {
        const dist = parseFloat(document.getElementById("chan-dist").value) || 0;
        const freq = parseFloat(document.getElementById("chan-freq").value) || 2450;
        const extra = parseFloat(document.getElementById("chan-extra").value) || 0;
        const pathLoss = fslDb(dist, freq);
        const totalLoss = pathLoss + extra;

        if (state.activeModule === "am") {
            const snrEl = document.getElementById("chan-snr");
            const targetSnr = 25.0;
            snrEl.value = (targetSnr + totalLoss).toFixed(1);
        } else {
            const ebn0El = document.getElementById("chan-ebn0");
            const targetEbn0 = 12.0;
            ebn0El.value = (targetEbn0 + totalLoss).toFixed(1);
        }
        runSimulation();
    });
}

// ===========================================================================
// Carga de Archivos CSV Externos
// ===========================================================================
function setupCSVUploads() {
    const handleFile = (fileInput, statusEl, moduleKey) => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = parseCSV(e.target.result);
                state.csvSignals[moduleKey] = parsed;
                statusEl.textContent = `${file.name} · ${parsed.count} muestras`;
                statusEl.style.color = "var(--cyan)";
                runSimulation();
            } catch (err) {
                showError(`Error al leer CSV: ${err.message}`);
                statusEl.textContent = "Error de formato CSV";
                statusEl.style.color = "var(--rose)";
            }
        };
        reader.readAsText(file);
    };

    const amFileInput = document.getElementById("am-csv-file");
    amFileInput.addEventListener("change", () => {
        handleFile(amFileInput, document.getElementById("am-csv-status"), "am");
    });

    const pcmFileInput = document.getElementById("pcm-csv-file");
    pcmFileInput.addEventListener("change", () => {
        handleFile(pcmFileInput, document.getElementById("pcm-csv-status"), "pcm");
    });
}

// ===========================================================================
// Botones de Acción (Simular, Reiniciar, Exportar)
// ===========================================================================
function setupActionButtons() {
    document.getElementById("btn-simulate").addEventListener("click", () => runSimulation());
    document.getElementById("btn-reset").addEventListener("click", () => resetParameters());
    document.getElementById("btn-export-csv").addEventListener("click", () => exportCSV());
    document.getElementById("btn-export-png").addEventListener("click", () => exportPNG());
}

function setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            runSimulation();
        }
    });
}

function resetParameters() {
    hideError();
    const mod = state.activeModule;
    if (mod === "am") {
        document.getElementById("am-waveform").value = "sine";
        document.getElementById("am-fm").value = "1000";
        document.getElementById("am-m").value = "0.8";
        document.getElementById("am-vp").value = "1.0";
        document.getElementById("am-fc").value = "20000";
        document.getElementById("am-fs").value = "400000";
        document.getElementById("am-duration").value = "10";
        document.getElementById("chan-snr").value = "25";
    } else if (mod === "ask") {
        document.getElementById("ask-nbits").value = "4000";
        document.getElementById("ask-bitmode").value = "random";
        document.getElementById("ask-rb").value = "1000";
        document.getElementById("ask-fc").value = "6000";
        document.getElementById("ask-amplitude").value = "1.0";
        document.getElementById("ask-sps").value = "32";
        document.getElementById("ask-detector").value = "coherent";
        document.getElementById("ask-timing").value = "0.0";
        document.getElementById("chan-ebn0").value = "10";
    } else if (mod === "fsk") {
        document.getElementById("fsk-nbits").value = "4000";
        document.getElementById("fsk-bitmode").value = "random";
        document.getElementById("fsk-rb").value = "1000";
        document.getElementById("fsk-fc").value = "6000";
        document.getElementById("fsk-h").value = "1.0";
        document.getElementById("fsk-sps").value = "32";
        document.getElementById("fsk-detector").value = "noncoherent";
        document.getElementById("chan-ebn0").value = "10";
    } else if (mod === "pcm") {
        document.getElementById("pcm-waveform").value = "sine";
        document.getElementById("pcm-fm").value = "1000";
        document.getElementById("pcm-fs").value = "8000";
        document.getElementById("pcm-nbits").value = "8";
        document.getElementById("pcm-scheme").value = "BPSK";
        document.getElementById("pcm-antialias").checked = true;
        document.getElementById("chan-ebn0").value = "12";
    }

    document.getElementById("chan-dist").value = "0";
    document.getElementById("chan-extra").value = "0";
    document.getElementById("chan-preset").value = "ideal";
    document.getElementById("chan-multipath").checked = false;
    document.getElementById("chan-interference").checked = false;
    document.getElementById("chan-cfo").value = "0";
    document.getElementById("chan-pnoise").value = "0";

    runSimulation();
}

// ===========================================================================
// LECTURA DE CANAL
// ===========================================================================
function getChannelConfig() {
    const isAM = state.activeModule === "am";
    return {
        distanceKm: parseFloat(document.getElementById("chan-dist").value) || 0.0,
        frequencyMHz: parseFloat(document.getElementById("chan-freq").value) || 2450.0,
        extraAttenDb: parseFloat(document.getElementById("chan-extra").value) || 0.0,
        snrDb: isAM ? parseFloat(document.getElementById("chan-snr").value) : null,
        ebn0Db: !isAM ? parseFloat(document.getElementById("chan-ebn0").value) : null,
        multipath: document.getElementById("chan-multipath").checked,
        mpDelayUs: parseFloat(document.getElementById("chan-mp-delay").value) || 1.0,
        mpGainDb: -6.0,
        mpPhaseDeg: 180.0,
        interference: document.getElementById("chan-interference").checked,
        intFreqHz: parseFloat(document.getElementById("chan-int-freq").value) || 0.0,
        intAmpDb: -20.0,
        freqOffsetHz: parseFloat(document.getElementById("chan-cfo").value) || 0.0,
        phaseNoiseRms: parseFloat(document.getElementById("chan-pnoise").value) || 0.0,
        seed: parseInt(document.getElementById("chan-seed").value) || 1,
    };
}

// ===========================================================================
// EJECUCIÓN PRINCIPAL DE LA SIMULACIÓN
// ===========================================================================
function runSimulation() {
    hideError();
    const mod = state.activeModule;
    if (mod === "theory") return;

    try {
        const chanCfg = getChannelConfig();

        if (mod === "am") {
            runAM(chanCfg);
        } else if (mod === "ask") {
            runASK(chanCfg);
        } else if (mod === "fsk") {
            runFSK(chanCfg);
        } else if (mod === "pcm") {
            runPCM(chanCfg);
        }
    } catch (err) {
        showError(err.message || String(err));
        console.error(err);
    }
}

// ---------------------------------------------------------------------------
// AM Runner
// ---------------------------------------------------------------------------
function runAM(chanCfg) {
    const wf = document.getElementById("am-waveform").value;
    const fm = parseFloat(document.getElementById("am-fm").value) || 1000;
    const m = parseFloat(document.getElementById("am-m").value) || 0.8;
    const vp = parseFloat(document.getElementById("am-vp").value) || 1.0;
    const fc = parseFloat(document.getElementById("am-fc").value) || 20000;
    const fs = parseFloat(document.getElementById("am-fs").value) || 400000;
    const duration = (parseFloat(document.getElementById("am-duration").value) || 10) / 1000.0;

    const csvData = state.csvSignals.am;
    const cfg = {
        waveform: wf,
        fm,
        m,
        Vp: vp,
        fc,
        fs,
        duration,
        formula: document.getElementById("am-formula").value,
        csvT: csvData ? csvData.t : null,
        csvX: csvData ? csvData.x : null,
        channel: chanCfg,
    };

    const res = simulateAM(cfg);
    const curve = amFidelityCurve(cfg);
    state.lastResult = { module: "am", res, cfg };

    // Actualizar Ribbon de Métricas
    const met = res.metrics;
    setMetricCard(1, "Índice m", met.m.toFixed(2), met.overmodulation ? "Sobremodulación (m > 1)" : `${met.mPercent.toFixed(0)}% Lineal`, met.overmodulation ? "red" : "gold");
    setMetricCard(2, "Potencia Total", `${met.ptPc.toFixed(2)} × Pc`, `Portadora ${(met.carrierFraction * 100).toFixed(1)}%`, "amber");
    setMetricCard(3, "Error Envolvente", met.mseEnv.toExponential(2), `Corr: ${met.corrEnv.toFixed(4)}`, "cream");
    setMetricCard(4, "Error Coherente", met.mseCoh.toExponential(2), `Corr: ${met.corrCoh.toFixed(4)}`, "bright");
    setMetricCard(5, "SNR Efectiva", isFinite(met.snrEffDb) ? `${met.snrEffDb.toFixed(1)} dB` : "∞", `Atenuación: ${met.totalAttenDb.toFixed(1)} dB`, "gold");

    chartManager.renderAM(res, curve, cfg);
}

// ---------------------------------------------------------------------------
// ASK Runner
// ---------------------------------------------------------------------------
function runASK(chanCfg) {
    const nbits = parseInt(document.getElementById("ask-nbits").value) || 4000;
    const bitMode = document.getElementById("ask-bitmode").value;
    const manualBits = document.getElementById("ask-manual").value;
    const rb = parseFloat(document.getElementById("ask-rb").value) || 1000;
    const fc = parseFloat(document.getElementById("ask-fc").value) || 6000;
    const amplitude = parseFloat(document.getElementById("ask-amplitude").value) || 1.0;
    const sps = parseInt(document.getElementById("ask-sps").value) || 32;
    const detector = document.getElementById("ask-detector").value;
    const timing = parseFloat(document.getElementById("ask-timing").value) || 0.0;

    const cfg = {
        nbits,
        bitMode,
        manualBits,
        rb,
        fc,
        amplitude,
        sps,
        detector,
        timingOffsetFrac: timing,
        seed: chanCfg.seed,
        channel: chanCfg,
    };

    const res = simulateASK(cfg);
    const curve = digitalBerCurve(cfg, "ASK");
    state.lastResult = { module: "ask", res, cfg };

    const berColor = res.ber === 0 ? "bright" : (res.ber < 0.01 ? "amber" : "red");
    setMetricCard(1, "BER Medida", res.ber.toExponential(2), `${res.errors} errores / ${res.nbits} bits`, berColor);
    setMetricCard(2, "Eb/N0 Efectiva", isFinite(res.ebn0EffDb) ? `${res.ebn0EffDb.toFixed(1)} dB` : "∞", `Nominal: ${chanCfg.ebn0Db.toFixed(1)} dB`, "gold");
    setMetricCard(3, "SNR en Banda", isFinite(res.extras.snrBandDb) ? `${res.extras.snrBandDb.toFixed(1)} dB` : "∞", "Banda: 2·Rb", "cream");
    setMetricCard(4, "Ancho de Banda", `${(res.extras.bandwidthHz / 1000).toFixed(1)} kHz`, `Eficiencia: ${res.extras.efficiencyBpsHz.toFixed(2)} b/s/Hz`, "amber");
    setMetricCard(5, "Portadora Snapped", `${(res.extras.fc / 1000).toFixed(1)} kHz`, `${res.extras.cyclesPerBit} ciclos/bit · ${res.extras.detector}`, "bright");

    chartManager.renderASK(res, curve, cfg);
}

// ---------------------------------------------------------------------------
// FSK Runner
// ---------------------------------------------------------------------------
function runFSK(chanCfg) {
    const nbits = parseInt(document.getElementById("fsk-nbits").value) || 4000;
    const bitMode = document.getElementById("fsk-bitmode").value;
    const manualBits = document.getElementById("fsk-manual").value;
    const rb = parseFloat(document.getElementById("fsk-rb").value) || 1000;
    const fc = parseFloat(document.getElementById("fsk-fc").value) || 6000;
    const h = parseFloat(document.getElementById("fsk-h").value) || 1.0;
    const sps = parseInt(document.getElementById("fsk-sps").value) || 32;
    const detector = document.getElementById("fsk-detector").value;

    const cfg = {
        nbits,
        bitMode,
        manualBits,
        rb,
        fc,
        amplitude: 1.0,
        sps,
        modulationIndex: h,
        detector,
        seed: chanCfg.seed,
        channel: chanCfg,
    };

    const res = simulateFSK(cfg);
    const curve = digitalBerCurve(cfg, "FSK");
    state.lastResult = { module: "fsk", res, cfg };

    const berColor = res.ber === 0 ? "bright" : (res.ber < 0.01 ? "amber" : "red");
    setMetricCard(1, "BER Medida", res.ber.toExponential(2), `${res.errors} errores / ${res.nbits} bits`, berColor);
    setMetricCard(2, "Eb/N0 Efectiva", isFinite(res.ebn0EffDb) ? `${res.ebn0EffDb.toFixed(1)} dB` : "∞", `Nominal: ${chanCfg.ebn0Db.toFixed(1)} dB`, "gold");
    setMetricCard(3, "Índice h", h.toFixed(2), res.extras.orthogonal ? "Ortogonal" : "No ortogonal", "cream");
    setMetricCard(4, "Ancho de Banda", `${(res.extras.bandwidthHz / 1000).toFixed(1)} kHz`, `Carson: 2(Δf+Rb)`, "amber");
    setMetricCard(5, "Tonos f0 / f1", `${(res.extras.f0 / 1000).toFixed(2)} / ${(res.extras.f1 / 1000).toFixed(2)} kHz`, `Δf=${(res.extras.df / 1000).toFixed(2)} kHz`, "bright");

    chartManager.renderFSK(res, curve, cfg);
}

// ---------------------------------------------------------------------------
// PCM Runner
// ---------------------------------------------------------------------------
function runPCM(chanCfg) {
    const wf = document.getElementById("pcm-waveform").value;
    const fm = parseFloat(document.getElementById("pcm-fm").value) || 1000;
    const fsSample = parseFloat(document.getElementById("pcm-fs").value) || 8000;
    const nBits = parseInt(document.getElementById("pcm-nbits").value) || 8;
    const scheme = document.getElementById("pcm-scheme").value;
    const antialias = document.getElementById("pcm-antialias").checked;

    const csvData = state.csvSignals.pcm;
    const cfg = {
        waveform: wf,
        fm,
        fsSample,
        nBits,
        duration: 0.01,
        amplitude: 0.8,
        fullScale: 1.0,
        antialias,
        scheme,
        fc: 20000.0,
        sps: 16,
        formula: document.getElementById("pcm-formula").value,
        csvT: csvData ? csvData.t : null,
        csvX: csvData ? csvData.x : null,
        channel: chanCfg,
    };

    const res = simulatePCM(cfg);
    const bitsCurve = pcmSqnrBitsCurve(cfg);
    const linkCurve = pcmSqnrEbn0Curve(cfg);
    state.lastResult = { module: "pcm", res, cfg };

    const sqnrColor = res.sqnrDb >= res.sqnrQuantDb - 3 ? "bright" : (res.sqnrDb > 15 ? "amber" : "red");
    setMetricCard(1, "SQNR Reconstrucción", `${res.sqnrDb.toFixed(1)} dB`, `Teoría: ${res.metrics.sqnrTheoryDb.toFixed(1)} dB`, sqnrColor);
    setMetricCard(2, "SQNR Cuantificación", `${res.sqnrQuantDb.toFixed(1)} dB`, `q=${(res.q * 1000).toFixed(2)} mV · ${res.metrics.levels} niv.`, "gold");
    setMetricCard(3, "BER del Enlace", res.ber.toExponential(2), `${res.errors} / ${res.nbitsTotal} bits`, res.ber === 0 ? "bright" : "red");
    setMetricCard(4, "Tasa de Bits", `${(res.metrics.bitRateBps / 1000).toFixed(1)} kbps`, `${res.metrics.samples} muestras · ${res.metrics.scheme}`, "amber");
    setMetricCard(5, "Eb/N0 Efectiva", isFinite(res.ebn0EffDb) ? `${res.ebn0EffDb.toFixed(1)} dB` : "∞", `Atenuación: ${res.metrics.totalAttenDb.toFixed(1)} dB`, "cream");

    chartManager.renderPCM(res, bitsCurve, linkCurve, cfg);
}

// ===========================================================================
// Helpers de UI
// ===========================================================================
function setMetricCard(idx, title, val, caption, colorClass = "cyan") {
    const card = document.getElementById(`card-m${idx}`);
    card.className = `metric-card color-${colorClass}`;
    document.getElementById(`m${idx}-title`).textContent = title;
    document.getElementById(`m${idx}-value`).textContent = val;
    document.getElementById(`m${idx}-caption`).textContent = caption;
}

function showError(msg) {
    const banner = document.getElementById("alert-banner");
    document.getElementById("alert-msg").textContent = msg;
    banner.classList.add("active");
}

function hideError() {
    const banner = document.getElementById("alert-banner");
    banner.classList.remove("active");
}

// ===========================================================================
// Exportar a CSV y PNG
// ===========================================================================
function exportCSV() {
    if (!state.lastResult || !state.lastResult.res) {
        showError("No hay datos de simulación disponibles para exportar");
        return;
    }
    const { module, res } = state.lastResult;
    let csvContent = "";

    if (module === "am") {
        csvContent = "tiempo_s,mensaje,tx,rx,envolvente,coherente\n";
        const n = res.t.length;
        for (let i = 0; i < n; i++) {
            csvContent += `${res.t[i].toFixed(7)},${res.message[i].toFixed(5)},${res.tx[i].toFixed(5)},${res.rx[i].toFixed(5)},${res.env[i].toFixed(5)},${res.coh[i].toFixed(5)}\n`;
        }
    } else if (module === "ask" || module === "fsk") {
        csvContent = "tiempo_s,tx,rx\n";
        const n = res.t.length;
        for (let i = 0; i < n; i++) {
            csvContent += `${res.t[i].toFixed(7)},${res.tx[i].toFixed(5)},${res.rx[i].toFixed(5)}\n`;
        }
    } else if (module === "pcm") {
        csvContent = "tiempo_s,x_analogica,x_reconstruida,x_zoh\n";
        const n = res.tAnalog.length;
        for (let i = 0; i < n; i++) {
            csvContent += `${res.tAnalog[i].toFixed(7)},${res.xAnalog[i].toFixed(5)},${res.xRec[i].toFixed(5)},${res.xZoh[i].toFixed(5)}\n`;
        }
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `simulacion_${module}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportPNG() {
    const mod = state.activeModule;
    const targetMap = {
        am: "am-plot-recovery",
        ask: "ask-plot-waveform",
        fsk: "fsk-plot-waveform",
        pcm: "pcm-plot-reconstruction",
    };
    const targetId = targetMap[mod];
    if (targetId && chartManager) {
        chartManager.downloadPNG(targetId, `grafica_${mod}.png`);
    }
}
