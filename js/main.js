/**
 * main.js
 * Coordinador principal de la aplicación web: eventos, UI, ejecución de simulaciones y exportación.
 * Las simulaciones se ejecutan en el worker Pyodide ("pyodide-worker.js") que carga el core Python
 * real (comms_app.core) a través del bridge ("py/bridge.py") y devuelven resultados en JSON.
 * Los resultados se adaptan a la forma que espera el ChartManager (Plotly) y se grafican.
 */

import { parseCSV } from "./core/signal_generator.js";
import { fslDb } from "./core/channel.js";
import { ChartManager } from "./components/chart_manager.js";

// Estado Global de la Aplicación
const state = {
    activeModule: "am",
    csvSignals: { am: null, pcm: null },
    lastResult: null,
    worker: null,
    ready: false,
    reqId: 0,
    pending: null,
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
    bootWorker();
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

    document.querySelectorAll(".module-card").forEach((c) => (c.style.display = "none"));
    document.querySelectorAll(".module-plots").forEach((p) => (p.style.display = "none"));

    const ctrlCard = document.getElementById(`ctrl-${mod}`);
    const plotGrid = document.getElementById(`plots-${mod}`);
    if (ctrlCard) ctrlCard.style.display = "block";
    if (plotGrid) plotGrid.style.display = "grid";

    const grpSnr = document.getElementById("group-snr");
    const grpEbn0 = document.getElementById("group-ebn0");
    if (mod === "am") { grpSnr.style.display = "flex"; grpEbn0.style.display = "none"; }
    else { grpSnr.style.display = "none"; grpEbn0.style.display = "flex"; }

    const titles = {
        am: { title: "Modulación de Amplitud · AM", sub: "La amplitud de la portadora sigue a la moduladora. Compara el detector de envolvente con el coherente y observa la sobremodulación." },
        ask: { title: "Amplitud Conmutada · ASK / OOK", sub: "La portadora se enciende y apaga según el bit. Analiza el espectro, diagrama de ojo, sincronización y BER." },
        fsk: { title: "Frecuencia Conmutada · FSK", sub: "El bit selecciona una de dos frecuencias. Observa la frecuencia instantánea, ortogonalidad de tonos y detección no coherente." },
        pcm: { title: "Modulación por Pulsos Codificados · PCM", sub: "Muestreo, cuantificación uniforme, codificación binaria y transmisión digital. Observa el umbral del enlace." },
    };
    if (titles[mod]) { pageTitle.textContent = titles[mod].title; pageSubtitle.textContent = titles[mod].sub; }

    runSimulation();
    setTimeout(() => chartManager.resizeAll(), 50);
}

// ===========================================================================
// Sincronización Reactiva de Controles
// ===========================================================================
function setupControlsSync() {
    const amWf = document.getElementById("am-waveform");
    amWf.addEventListener("change", () => {
        document.getElementById("group-am-formula").style.display = amWf.value === "formula" ? "flex" : "none";
        document.getElementById("group-am-csv").style.display = amWf.value === "csv" ? "flex" : "none";
    });
    const askBm = document.getElementById("ask-bitmode");
    askBm.addEventListener("change", () => {
        document.getElementById("group-ask-manual").style.display = askBm.value === "manual" ? "flex" : "none";
    });
    const fskBm = document.getElementById("fsk-bitmode");
    fskBm.addEventListener("change", () => {
        document.getElementById("group-fsk-manual").style.display = fskBm.value === "manual" ? "flex" : "none";
    });
    const pcmWf = document.getElementById("pcm-waveform");
    pcmWf.addEventListener("change", () => {
        document.getElementById("group-pcm-formula").style.display = pcmWf.value === "formula" ? "flex" : "none";
        document.getElementById("group-pcm-csv").style.display = pcmWf.value === "csv" ? "flex" : "none";
    });
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
        dist.value = "0";
        extra.value = "0";
        mp.checked = false;
        intf.checked = false;
        cfo.value = "0";
        pnoise.value = "0";
        if (val === "loss") { dist.value = "2.0"; extra.value = "5"; }
        else if (val === "multipath") { mp.checked = true; document.getElementById("chan-mp-delay").value = "1.5"; }
        else if (val === "interference") { intf.checked = true; }
        else if (val === "cfo") { cfo.value = "150"; }
        runSimulation();
    });
    document.getElementById("btn-adjust-link").addEventListener("click", () => {
        const dist = parseFloat(document.getElementById("chan-dist").value) || 0;
        const freq = parseFloat(document.getElementById("chan-freq").value) || 2450;
        const extra = parseFloat(document.getElementById("chan-extra").value) || 0;
        const pathLoss = fslDb(dist, freq);
        const totalLoss = pathLoss + extra;
        if (state.activeModule === "am") {
            document.getElementById("chan-snr").value = (25.0 + totalLoss).toFixed(1);
        } else {
            document.getElementById("chan-ebn0").value = (12.0 + totalLoss).toFixed(1);
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
    amFileInput.addEventListener("change", () => { handleFile(amFileInput, document.getElementById("am-csv-status"), "am"); });
    const pcmFileInput = document.getElementById("pcm-csv-file");
    pcmFileInput.addEventListener("change", () => { handleFile(pcmFileInput, document.getElementById("pcm-csv-status"), "pcm"); });
}

// ===========================================================================
// Botones de Acción (Simular, Reiniciar, Exportar)
// ===========================================================================
function setupActionButtons() {
    document.getElementById("btn-simulate").addEventListener("click", () => {
        if (!state.ready) { showError("El motor aún no está listo. Intente de nuevo."); return; }
        runSimulation();
    });
    document.getElementById("btn-reset").addEventListener("click", () => resetParameters());
    document.getElementById("btn-export-csv").addEventListener("click", () => exportCSV());
    document.getElementById("btn-export-png").addEventListener("click", () => exportPNG());
}

function setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (state.ready) runSimulation();
        }
    });
}

// ===========================================================================
// Boot del Worker Pyodide (motor Python real)
// ===========================================================================
function bootWorker() {
    try {
        state.worker = new Worker("pyodide-worker.js");
    } catch (e) {
        showError(`No se pudo iniciar el motor: ${e.message || e}`);
        return;
    }
    const baseUrl = new URL("./", window.location.href).href;
    state.worker.onmessage = (ev) => {
        const d = ev.data || {};
        if (d.type === "status") {
            // El worker reporta progreso; sin barra de boot en esta UI se ignora el detalle.
        } else if (d.type === "ready") {
            state.ready = true;
            setSimEnabled(true);
            runSimulation();
        } else if (d.type === "error") {
            showError(`Error cargando el motor: ${d.msg || "Error desconocido"}`);
        } else if (d.type === "result") {
            const p = state.pending;
            if (p && p.id === d.id) { state.pending = null; p.resolve(d.result); }
        }
    };
    state.worker.onerror = (e) => { showError(`Error en el motor: ${e.message || "Error desconocido"}`); };
    state.worker.postMessage({ type: "init", baseUrl });
}

function setSimEnabled(on) {
    const simBtn = document.getElementById("btn-simulate");
    if (simBtn) simBtn.disabled = !on;
}

// ===========================================================================
// Ejecución asíncrona vía worker -> bridge -> core Python
// ===========================================================================
function runEngine(module, params) {
    return new Promise((resolve, reject) => {
        if (!state.worker) { reject(new Error("El motor no está disponible")); return; }
        const id = ++state.reqId;
        state.pending = { id, module, resolve, reject };
        state.worker.postMessage({ type: "run", id, module, params });
    });
}

function chanToBridge(ch) {
    return {
        distance_km: ch.distanceKm ?? 0,
        frequency_mhz: ch.frequencyMHz ?? 2450,
        extra_atten_db: ch.extraAttenDb ?? 0,
        nominal_db: ch.snrDb ?? ch.ebn0Db ?? null,
        multipath: !!ch.multipath,
        mp_delay_us: ch.mpDelayUs ?? 1,
        mp_gain_db: ch.mpGainDb ?? -6,
        mp_phase_deg: ch.mpPhaseDeg ?? 180,
        interference: !!ch.interference,
        int_freq_hz: ch.intFreqHz ?? 0,
        int_amp_db: ch.intAmpDb ?? -20,
        freq_offset_hz: ch.freqOffsetHz ?? 0,
        phase_noise_rms: ch.phaseNoiseRms ?? 0,
        gain_step_db: ch.gainStepDb ?? 0,
        gain_step_at: ch.gainStepAt ?? 0.5,
        clip_on: false,
        clip_level: null,
        seed: ch.seed ?? 1,
    };
}

function toF64(a) { const out = new Float64Array(a == null ? 0 : a.length); for (let i = 0; i < out.length; i++) out[i] = a[i]; return out; }
function toArr(a) { if (a == null) return []; return Array.from(a); }
function f64FromMs(a) { const arr = Array.isArray(a) ? a : []; const out = new Float64Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = arr[i] / 1000; return out; }

// ---------------------------------------------------------------------------
// Adaptadores: resultado del bridge (JSON / snake_case) -> forma del ChartManager
// ---------------------------------------------------------------------------
function adaptAM(res) {
    const m = res.metrics || {};
    const rep = res.report || {};
    const rec = res.recovery || {};
    const rf = res.rf || {};
    const err = res.error || {};
    const tSec = f64FromMs(rec.t_ms);
    const tRfSec = f64FromMs(rf.t_ms);
    const tErrSec = f64FromMs(err.t_ms);
    void tRfSec; void tErrSec;
    return {
        t: tSec,
        message: toF64(rec.msg),
        env: toF64(rec.env),
        coh: toF64(rec.coh),
        tx: toF64(rf.tx),
        rx: toF64(rf.rx),
        envErr: toF64(err.env),
        cohErr: toF64(err.coh),
        spectrumTxF: toArr(res.spec_tx ? res.spec_tx.f_khz : null).map((v) => v * 1000),
        spectrumTxDb: toArr(res.spec_tx ? res.spec_tx.db : null),
        spectrumRxF: toArr(res.spec_rx ? res.spec_rx.f_khz : null).map((v) => v * 1000),
        spectrumRxDb: toArr(res.spec_rx ? res.spec_rx.db : null),
        report: { gainLinear: rep.gain_linear },
        metrics: {
            m: m.m, mPercent: m.m_percent, overmodulation: m.overmodulation, ptPc: m.pt_pc,
            carrierFraction: m.carrier_fraction, sidebandFraction: m.sideband_fraction,
            mseEnv: m.mse_env, mseCoh: m.mse_coh, corrEnv: m.corr_env, corrCoh: m.corr_coh,
            snrEffDb: m.snr_eff_db, snrTotalDb: m.snr_total_db, noiseBandwidthHz: m.noise_bandwidth_hz,
            ifBandwidthHz: m.if_bandwidth_hz, pathLossDb: m.path_loss_db, totalAttenDb: m.total_atten_db,
            bwTxHz: m.bw_tx_hz, bwRxHz: m.bw_rx_hz, vm: m.vm, ptDbm: m.pt_dbm,
        },
    };
}

function adaptAsk(res) {
    const rep = res.report || {};
    const wave = res.wave || {};
    const gain = Math.max(rep.gain_linear ?? 1, 1e-30);
    const tSec = f64FromMs(wave.t_ms);
    return {
        t: tSec,
        tx: toF64(wave.tx),
        rx: toF64(wave.rx),
        report: { gainLinear: rep.gain_linear },
        nbits: res.nbits,
        rb: res.rb,
        fs: res.fs,
        detected: wave.det || [],
        extras: {
            eb: res.extras ? res.extras.eb : null,
            fc: res.extras ? res.extras.fc : null,
            cyclesPerBit: res.extras ? res.extras.cycles_per_bit : null,
            threshold: res.extras ? res.extras.threshold : null,
            detector: res.extras ? res.extras.detector : null,
            bandwidthHz: res.extras ? res.extras.bandwidth_hz : null,
            snrBandDb: res.extras ? res.extras.snr_band_db : null,
            efficiencyBpsHz: res.extras ? res.extras.efficiency_bps_hz : null,
        },
        ebn0EffDb: res.ebn0_eff_db,
        ber: res.ber,
        eye: res.eye && res.eye.traces ? res.eye.traces : [],
        spectrumF: toArr(res.spec ? res.spec.f_khz : null).map((v) => v * 1000),
        spectrumDb: toArr(res.spec ? res.spec.db : null),
        fs: res.fs,
        sps: res.sps,
    };
}

function adaptFsk(res) {
    const rep = res.report || {};
    const wave = res.wave || {};
    const fbit = res.fbit || {};
    const tSec = f64FromMs(wave.t_ms);
    const tBitSec = f64FromMs(fbit.t_ms);
    const fBitHz = toArr(fbit.f_khz).map((v) => v * 1000);
    return {
        t: tSec,
        tx: toF64(wave.tx),
        rx: toF64(wave.rx),
        report: { gainLinear: rep.gain_linear },
        nbits: res.nbits,
        rb: res.rb,
        fs: res.fs,
        detected: wave.det || [],
        tBit: tBitSec,
        fBit: fBitHz,
        extras: {
            eb: res.extras ? res.extras.eb : null,
            f0: res.extras ? res.extras.f0 : null,
            f1: res.extras ? res.extras.f1 : null,
            df: res.extras ? res.extras.df : null,
            h: res.extras ? res.extras.h : null,
            bandwidthHz: res.extras ? res.extras.bandwidth_hz : null,
            snrBandDb: res.extras ? res.extras.snr_band_db : null,
            orthogonal: res.extras ? res.extras.orthogonal : null,
            detector: res.extras ? res.extras.detector : null,
        },
        ebn0EffDb: res.ebn0_eff_db,
        ber: res.ber,
        spectrumF: toArr(res.spec ? res.spec.f_khz : null).map((v) => v * 1000),
        spectrumDb: toArr(res.spec ? res.spec.db : null),
        fs: res.fs,
    };
}

function adaptPcm(res) {
    const met = res.metrics || {};
    return {
        tAnalog: f64FromMs(res.t_analog),
        xAnalog: toF64(res.x_analog),
        xZoh: toF64(res.x_zoh),
        xRec: toF64(res.x_rec),
        tS: f64FromMs(res.t_s),
        xS: toF64(res.x_s),
        xq: toF64(res.xq),
        qerr: toF64(res.qerr),
        q: res.q,
        spectrumAnalogF: toArr(res.spec_a ? res.spec_a.f_khz : null).map((v) => v * 1000),
        spectrumAnalogDb: toArr(res.spec_a ? res.spec_a.db : null),
        spectrumSampledF: toArr(res.spec_s ? res.spec_s.f_khz : null).map((v) => v * 1000),
        spectrumSampledDb: toArr(res.spec_s ? res.spec_s.db : null),
        metrics: {
            nyquistHz: met.nyquist_hz,
            sqnrTheoryDb: res.sqnr_theory_db,
            levels: met.levels,
            bitRateBps: met.bit_rate_bps,
            samples: met.samples,
            scheme: met.scheme,
            totalAttenDb: met.total_atten_db,
        },
        sqnrDb: res.sqnr_db,
        sqnrQuantDb: res.sqnr_quant_db,
        ber: res.ber,
        errors: res.errors,
        nbitsTotal: res.nbits_total,
        q: res.q,
        ebn0EffDb: res.ebn0_eff_db,
    };
}

// ===========================================================================
// EJECUCIÓN PRINCIPAL DE LA SIMULACIÓN
// ===========================================================================
async function runAM(chanCfg) {
    try {
        hideError();
        const wf = document.getElementById("am-waveform").value;
        const fm = parseFloat(document.getElementById("am-fm").value) || 1000;
        const m = parseFloat(document.getElementById("am-m").value) || 0.8;
        const vp = parseFloat(document.getElementById("am-vp").value) || 1;
        const fc = parseFloat(document.getElementById("am-fc").value) || 20000;
        const fs = parseFloat(document.getElementById("am-fs").value) || 400000;
        const durationMs = parseFloat(document.getElementById("am-duration").value) || 10;
        const formula = document.getElementById("am-formula").value || null;

        const params = {
            waveform: wf, fm, phase_deg: 0, duty: 0.5, f_end: null, formula,
            Vp: vp, fc, m, fs, duration_ms: durationMs, channel: chanToBridge(chanCfg),
            csv_t: wf === "csv" ? Array.from(state.csvSignals.am ? state.csvSignals.am.t : []) : null,
            csv_x: wf === "csv" ? Array.from(state.csvSignals.am ? state.csvSignals.am.x : []) : null,
        };
        const res = await runEngine("am", params);
        const adapted = adaptAM(res);
        state.lastResult = { module: "am", res: adapted, cfg: { waveform: wf, fm, phase_deg: 0, duty: 0.5, f_end: null, formula, Vp: vp, fc, m, fs, duration: durationMs / 1000, channel: chanCfg } };

        const met = adapted.metrics;
        setMetricCard(1, "Índice m", met.m.toFixed(2), met.overmodulation ? "Sobremodulación (m > 1)" : `${met.mPercent.toFixed(0)}% Lineal`, met.overmodulation ? "red" : "gold");
        setMetricCard(2, "Potencia Total", `${met.ptPc.toFixed(2)} × Pc`, `Portadora ${(met.carrierFraction * 100).toFixed(1)}%`, "amber");
        setMetricCard(3, "Error Envolvente", met.mseEnv.toExponential(2), `Corr: ${met.corrEnv.toFixed(4)}`, "cream");
        setMetricCard(4, "Error Coherente", met.mseCoh.toExponential(2), `Corr: ${met.corrCoh.toFixed(4)}`, "bright");
        setMetricCard(5, "SNR Efectiva", isFinite(met.snrEffDb) ? `${met.snrEffDb.toFixed(1)} dB` : "∞", `Atenuación: ${met.totalAttenDb.toFixed(1)} dB`, "gold");

        chartManager.renderAM(adapted, { snrDb: res.curve.snr_db, mseEnv: res.curve.mse_env, mseCoh: res.curve.mse_coh }, { fm, fc, fs });
    } catch (err) {
        showError(err.message || String(err));
        console.error(err);
    }
}

async function runASK(chanCfg) {
    try {
        hideError();
        const nbits = parseInt(document.getElementById("ask-nbits").value) || 4000;
        const bitMode = document.getElementById("ask-bitmode").value;
        const manualBits = document.getElementById("ask-manual").value;
        const rb = parseFloat(document.getElementById("ask-rb").value) || 1000;
        const fc = parseFloat(document.getElementById("ask-fc").value) || 6000;
        const amplitude = parseFloat(document.getElementById("ask-amplitude").value) || 1;
        const sps = parseInt(document.getElementById("ask-sps").value) || 32;
        const detector = document.getElementById("ask-detector").value;
        const timing = parseFloat(document.getElementById("ask-timing").value) || 0;

        const params = {
            nbits, bit_mode: bitMode, manual_bits: manualBits, rb, fc, amplitude, sps,
            detector, agc_error_db: 0, timing_offset_frac: timing, seed: chanCfg.seed, channel: chanToBridge(chanCfg),
        };
        const res = await runEngine("ask", params);
        const adapted = adaptAsk(res);
        state.lastResult = { module: "ask", res: adapted, cfg: { nbits, bitMode, manualBits, rb, fc, amplitude, sps, detector, timing, channel: chanCfg } };

        const berColor = res.ber === 0 ? "bright" : res.ber < 0.01 ? "amber" : "red";
        setMetricCard(1, "BER Medida", res.ber.toExponential(2), `${res.errors} errores / ${res.nbits} bits`, berColor);
        setMetricCard(2, "Eb/N0 Efectiva", isFinite(adapted.ebn0EffDb) ? `${adapted.ebn0EffDb.toFixed(1)} dB` : "∞", `Nominal: ${chanCfg.ebn0Db.toFixed(1)} dB`, "gold");
        setMetricCard(3, "SNR en Banda", isFinite(adapted.extras.snrBandDb) ? `${adapted.extras.snrBandDb.toFixed(1)} dB` : "∞", "Banda: 2·Rb", "cream");
        setMetricCard(4, "Ancho de Banda", `${(adapted.extras.bandwidthHz / 1000).toFixed(1)} kHz`, `Eficiencia: ${adapted.extras.efficiencyBpsHz.toFixed(2)} b/s/Hz`, "amber");
        setMetricCard(5, "Portadora Snapped", `${(adapted.extras.fc / 1000).toFixed(1)} kHz`, `${adapted.extras.cyclesPerBit} ciclos/bit · ${adapted.extras.detector}`, "bright");

        chartManager.renderASK(adapted, { ebn0Db: res.curve.ebn0_db, berTheory: res.curve.ber_theory, berSim: res.curve.ber_sim, nbits: res.curve.nbits }, { amplitude });
    } catch (err) {
        showError(err.message || String(err));
        console.error(err);
    }
}

async function runFSK(chanCfg) {
    try {
        hideError();
        const nbits = parseInt(document.getElementById("fsk-nbits").value) || 4000;
        const bitMode = document.getElementById("fsk-bitmode").value;
        const manualBits = document.getElementById("fsk-manual").value;
        const rb = parseFloat(document.getElementById("fsk-rb").value) || 1000;
        const fc = parseFloat(document.getElementById("fsk-fc").value) || 6000;
        const h = parseFloat(document.getElementById("fsk-h").value) || 1.0;
        const sps = parseInt(document.getElementById("fsk-sps").value) || 32;
        const detector = document.getElementById("fsk-detector").value;

        const params = {
            nbits, bit_mode: bitMode, manual_bits: manualBits, rb, fc, amplitude: 1.0, sps,
            h, detector, timing_offset_frac: 0, seed: chanCfg.seed, channel: chanToBridge(chanCfg),
        };
        const res = await runEngine("fsk", params);
        const adapted = adaptFsk(res);
        state.lastResult = { module: "fsk", res: adapted, cfg: { nbits, bitMode, manualBits, rb, fc, amplitude: 1.0, sps, h, detector, channel: chanCfg } };

        const berColor = res.ber === 0 ? "bright" : res.ber < 0.01 ? "amber" : "red";
        setMetricCard(1, "BER Medida", res.ber.toExponential(2), `${res.errors} errores / ${res.nbits} bits`, berColor);
        setMetricCard(2, "Eb/N0 Efectiva", isFinite(adapted.ebn0EffDb) ? `${adapted.ebn0EffDb.toFixed(1)} dB` : "∞", `Nominal: ${chanCfg.ebn0Db.toFixed(1)} dB`, "gold");
        setMetricCard(3, "Índice h", h.toFixed(2), adapted.extras.orthogonal ? "Ortogonal" : "No ortogonal", "cream");
        setMetricCard(4, "Ancho de Banda", `${(adapted.extras.bandwidthHz / 1000).toFixed(1)} kHz`, `Carson: 2(Δf+Rb)`, "amber");
        setMetricCard(5, "Tonos f0 / f1", `${(adapted.extras.f0 / 1000).toFixed(2)} / ${(adapted.extras.f1 / 1000).toFixed(2)} kHz`, `Δf=${(adapted.extras.df / 1000).toFixed(2)} kHz`, "bright");

        chartManager.renderFSK(adapted, { ebn0Db: res.curve.ebn0_db, berTheory: res.curve.ber_theory, berSim: res.curve.ber_sim, nbits: res.curve.nbits }, { rb, fc, amplitude: 1.0 });
    } catch (err) {
        showError(err.message || String(err));
        console.error(err);
    }
}

async function runPCM(chanCfg) {
    try {
        hideError();
        const wf = document.getElementById("pcm-waveform").value;
        const fm = parseFloat(document.getElementById("pcm-fm").value) || 1000;
        const fsSample = parseFloat(document.getElementById("pcm-fs").value) || 8000;
        const nBits = parseInt(document.getElementById("pcm-nbits").value) || 8;
        const scheme = document.getElementById("pcm-scheme").value;
        const antialias = document.getElementById("pcm-antialias").checked;
        const durationMs = 10;

        const params = {
            waveform: wf, fm, phase_deg: 0, duty: 0.5, f_end: null, formula: document.getElementById("pcm-formula").value || null,
            amplitude: 0.8, fs_sample: fsSample, n_bits: nBits, duration_ms: durationMs, full_scale: 1.0, antialias, scheme,
            fc: 20000, sps: 16, detector: "noncoherent", channel: chanToBridge(chanCfg),
            csv_t: wf === "csv" ? Array.from(state.csvSignals.pcm ? state.csvSignals.pcm.t : []) : null,
            csv_x: wf === "csv" ? Array.from(state.csvSignals.pcm ? state.csvSignals.pcm.x : []) : null,
        };
        const res = await runEngine("pcm", params);
        const adapted = adaptPcm(res);
        state.lastResult = { module: "pcm", res: adapted, cfg: { waveform: wf, fm, phase_deg: 0, duty: 0.5, f_end: null, formula: document.getElementById("pcm-formula").value || null, amplitude: 0.8, fsSample, nBits, duration: durationMs / 1000, fullScale: 1.0, antialias, scheme, fc: 20000, sps: 16, detector: "noncoherent", channel: chanCfg } };

        const sqnrColor = adapted.sqnrDb >= adapted.metrics.sqnrTheoryDb - 3 ? "bright" : adapted.sqnrDb > 15 ? "amber" : "red";
        setMetricCard(1, "SQNR Reconstrucción", `${adapted.sqnrDb.toFixed(1)} dB`, `Teoría: ${adapted.metrics.sqnrTheoryDb.toFixed(1)} dB`, sqnrColor);
        setMetricCard(2, "SQNR Cuantificación", `${adapted.sqnrQuantDb.toFixed(1)} dB`, `q=${(adapted.q * 1000).toFixed(2)} mV · ${adapted.metrics.levels} niv.`, "gold");
        setMetricCard(3, "BER del Enlace", adapted.ber.toExponential(2), `${adapted.errors} / ${adapted.nbitsTotal} bits`, adapted.ber === 0 ? "bright" : "red");
        setMetricCard(4, "Tasa de Bits", `${(adapted.metrics.bitRateBps / 1000).toFixed(1)} kbps`, `${adapted.metrics.samples} muestras · ${adapted.metrics.scheme}`, "amber");
        setMetricCard(5, "Eb/N0 Efectiva", isFinite(adapted.ebn0EffDb) ? `${adapted.ebn0EffDb.toFixed(1)} dB` : "∞", `Atenuación: ${adapted.metrics.totalAttenDb.toFixed(1)} dB`, "cream");

        chartManager.renderPCM(
            adapted,
            { nBits: res.bits_curve.n_bits, sqnrTheoryDb: res.bits_curve.sqnr_theory_db, sqnrQuantDb: res.bits_curve.sqnr_quant_db, sqnrRecDb: res.bits_curve.sqnr_rec_db },
            { ebn0Db: res.link_curve.ebn0_db, sqnrDb: res.link_curve.sqnr_db },
            { duration: durationMs / 1000, fsSample, fm, nBits },
        );
    } catch (err) {
        showError(err.message || String(err));
        console.error(err);
    }
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
        gainStepDb: 0.0,
        gainStepAt: 0.5,
        seed: parseInt(document.getElementById("chan-seed").value) || 1,
    };
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
    const targetMap = { am: "am-plot-recovery", ask: "ask-plot-waveform", fsk: "fsk-plot-waveform", pcm: "pcm-plot-reconstruction" };
    const targetId = targetMap[mod];
    if (targetId && chartManager) {
        chartManager.downloadPNG(targetId, `grafica_${mod}.png`);
    }
}

// ===========================================================================
// LECTURA DE SIMULACIÓN (orquestación)
// ===========================================================================
function runSimulation() {
    hideError();
    const mod = state.activeModule;
    if (mod === "theory") return;
    try {
        const chanCfg = getChannelConfig();
        if (mod === "am") runAM(chanCfg);
        else if (mod === "ask") runASK(chanCfg);
        else if (mod === "fsk") runFSK(chanCfg);
        else if (mod === "pcm") runPCM(chanCfg);
    } catch (err) {
        showError(err.message || String(err));
        console.error(err);
    }
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
