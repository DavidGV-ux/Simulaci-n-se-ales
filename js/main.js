/**
 * main.js
 * Coordinador de la aplicación web: eventos, UI y actualización de gráficas.
 * 100% Client-Side en JavaScript ES6 puro, sin dependencias de backend ni Pyodide.
 */

import {
    simulateAM,
    simulateASK,
    simulateFSK,
    simulatePCM
} from "./core/modulations.js";

import { ChartManager } from "./components/chart_manager.js";

// Estado de la Aplicación
const state = {
    activeModule: "am",
    chartManager: null
};

// Valores por defecto para cada módulo (para el botón Reiniciar)
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

// ===========================================================================
// Inicialización al Cargar el DOM
// ===========================================================================
document.addEventListener("DOMContentLoaded", () => {
    state.chartManager = new ChartManager();
    setupNavigation();
    setupInputs();
    setupButtons();
    switchModule("am");
});

// ===========================================================================
// Navegación entre Módulos
// ===========================================================================
function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn");
    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const mod = btn.dataset.module;
            if (mod === state.activeModule) return;
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
        document.getElementById("page-title").textContent = info.title;
        document.getElementById("page-subtitle").textContent = info.subtitle;
    }

    // Ocultar todos los controles y gráficas
    document.querySelectorAll(".module-card").forEach(c => (c.style.display = "none"));
    document.querySelectorAll(".module-plots").forEach(p => (p.style.display = "none"));

    // Mostrar los del módulo activo
    const ctrlCard = document.getElementById(`ctrl-${mod}`);
    const plotGrid = document.getElementById(`plots-${mod}`);
    if (ctrlCard) ctrlCard.style.display = "block";
    if (plotGrid) plotGrid.style.display = "grid";

    runSimulation();
    setTimeout(() => state.chartManager.resizeAll(), 50);
}

// ===========================================================================
// Eventos de Entradas (Inputs Reactivos)
// ===========================================================================
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
    document.getElementById("btn-simulate").addEventListener("click", () => runSimulation());
    document.getElementById("btn-reset").addEventListener("click", () => resetDefaults());

    // Atajo de teclado: Ctrl + Enter para simular
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

// ===========================================================================
// Ejecución de Simulación y Actualización de KPIs y Gráficas
// ===========================================================================
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

// ---------------------------------------------------------------------------
// Simulación AM
// ---------------------------------------------------------------------------
function runAM() {
    const vm = parseFloat(document.getElementById("am-vm").value) || 0.8;
    const fm = parseFloat(document.getElementById("am-fm").value) || 100;
    const vp = parseFloat(document.getElementById("am-vp").value) || 1.0;
    const fp = parseFloat(document.getElementById("am-fp").value) || 1000;

    const data = simulateAM({ vm, fm, vp, fp });

    // Actualizar 4 KPIs
    setKPI("m1", "Índice de Modulación", `m = ${data.kpis.m}`, `Porcentaje M = ${data.kpis.mPct}%`);
    setKPI("m2", "Estado de la Modulación", data.kpis.isOvermodulated ? "SOBREMODULACIÓN" : "MODULACIÓN LINEAL",
        `<span class="${data.kpis.isOvermodulated ? 'badge-alert' : 'badge-ok'}">${data.kpis.statusText}</span>`);
    setKPI("m3", "Ancho de Banda Requerido", data.kpis.bw, `BW = 2 · fm (2 × ${data.kpis.fm} Hz)`);
    setKPI("m4", "Bandas Laterales", `BLI: ${data.kpis.bli}`, `BLS: ${data.kpis.bls}`);

    // Renderizar las 3 gráficas
    state.chartManager.renderAMModAndCarrier("am-plot-mod-carrier", data);
    state.chartManager.renderAMModulated("am-plot-modulated", data);
    state.chartManager.renderAMSpectrum("am-plot-spectrum", data);
}

// ---------------------------------------------------------------------------
// Simulación ASK
// ---------------------------------------------------------------------------
function runASK() {
    const bitsInput = document.getElementById("ask-bits");
    let bits = bitsInput.value.trim().replace(/[^01]/g, "");
    if (!bits) bits = "10110100";
    if (bitsInput.value !== bits) bitsInput.value = bits;

    const rb = parseFloat(document.getElementById("ask-rb").value) || 100;
    const fp = parseFloat(document.getElementById("ask-fp").value) || 400;
    const v0 = parseFloat(document.getElementById("ask-v0").value) || 0.0;

    const data = simulateASK({ bits, rb, fp, v0, vp: 1.0 });

    setKPI("m1", "Secuencia Activa", data.kpis.activeSeq, `${data.cleanBits.length} bits en transmisión`);
    setKPI("m2", "Frecuencia Portadora", data.kpis.fp, `Tasa de señalización: ${data.kpis.rb}`);
    setKPI("m3", "Ciclos por Bit", `${data.kpis.cyclesPerBit} ciclos/bit`, `fp / Rb = ${data.kpis.cyclesPerBit}`);
    setKPI("m4", "Ancho de Banda Aprox.", data.kpis.approxBw, `Lóbulo principal sinc: 2 · Rb`);

    // Renderizar las 4 gráficas (las 3 primeras alineadas en tiempo)
    state.chartManager.renderASKBits("ask-plot-bits", data);
    state.chartManager.renderASKCarrier("ask-plot-carrier", data);
    state.chartManager.renderASKModulated("ask-plot-modulated", data);
    state.chartManager.renderASKSpectrum("ask-plot-spectrum", data);
}

// ---------------------------------------------------------------------------
// Simulación FSK
// ---------------------------------------------------------------------------
function runFSK() {
    const bitsInput = document.getElementById("fsk-bits");
    let bits = bitsInput.value.trim().replace(/[^01]/g, "");
    if (!bits) bits = "10110100";
    if (bitsInput.value !== bits) bitsInput.value = bits;

    const rb = parseFloat(document.getElementById("fsk-rb").value) || 100;
    const f0 = parseFloat(document.getElementById("fsk-f0").value) || 200;
    const f1 = parseFloat(document.getElementById("fsk-f1").value) || 600;

    const data = simulateFSK({ bits, rb, f0, f1, vp: 1.0 });

    setKPI("m1", "Frecuencia Bit '1'", data.kpis.f1, `Tono para nivel binario alto`);
    setKPI("m2", "Frecuencia Bit '0'", data.kpis.f0, `Tono para nivel binario bajo`);
    setKPI("m3", "Separación de Tonos", `Δf = ${data.kpis.deltaF}`, `Diferencia |f1 - f0|`);
    setKPI("m4", "Tipo de FSK", data.kpis.isWideband ? "Banda Ancha" : "Banda Angosta",
        `<span class="badge-ok">${data.kpis.fskType}</span>`);

    // Renderizar las 3 gráficas
    state.chartManager.renderFSKBits("fsk-plot-bits", data);
    state.chartManager.renderFSKModulated("fsk-plot-modulated", data);
    state.chartManager.renderFSKSpectrum("fsk-plot-spectrum", data);
}

// ---------------------------------------------------------------------------
// Simulación PCM
// ---------------------------------------------------------------------------
function runPCM() {
    const fm = parseFloat(document.getElementById("pcm-fm").value) || 10;
    const fs = parseFloat(document.getElementById("pcm-fs").value) || 60;
    const nBits = parseInt(document.getElementById("pcm-nbits").value, 10) || 3;

    const data = simulatePCM({ fm, fs, nBits, amp: 1.0 });

    const meets = data.kpis.meetsNyquist;
    setKPI("m1", "Criterio de Nyquist", meets ? "CUMPLE NYQUIST" : "¡ALIASING DETECTADO!",
        `<span class="${meets ? 'badge-ok' : 'badge-alert'}">${data.kpis.nyqText}</span>`);
    setKPI("m2", "Frecuencia de Nyquist", `fs_min = ${data.kpis.fNyquist}`, `fs actual = ${data.kpis.fs} (fm = ${data.kpis.fm})`);
    setKPI("m3", "Niveles de Cuantificación", data.kpis.levels, `Resolución paso q = ${data.kpis.qStep}`);
    setKPI("m4", "Tasa de Bits Resultante", data.kpis.rb, `Rb = fs × n (${data.kpis.fs} × ${data.kpis.nBits} bits)`);

    // Renderizar las 3 gráficas paso a paso
    state.chartManager.renderPCMSampling("pcm-plot-sampling", data);
    state.chartManager.renderPCMQuantization("pcm-plot-quantization", data);
    state.chartManager.renderPCMCoding("pcm-plot-coding", data);
}

// ===========================================================================
// Utilidades de UI
// ===========================================================================
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
