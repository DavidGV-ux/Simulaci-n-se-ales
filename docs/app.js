/* Simulador web: UI HTML/CSS/JS + motor Python real (comms_app.core) vía Pyodide worker. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  module: 'am',
  worker: null,
  ready: false,
  reqId: 0,
  charts: [],
  last: null,
};

const INFO = {
  am: { title: 'AM — Modulación de amplitud', desc: 'Portadora modulada en amplitud. Compara detector de envolvente y coherente; incluye canal, espectro, error, fidelidad y potencia.' },
  ask: { title: 'ASK / OOK — Amplitud conmutada', desc: 'Bits como presencia/ausencia de portadora. Incluye forma de onda, espectro, diagrama de ojo y BER teórica/Monte Carlo.' },
  fsk: { title: 'FSK — Frecuencia conmutada', desc: 'Bits como tonos f0/f1 (índice h). Incluye frecuencia estimada por bit, espectro y BER teórica/Monte Carlo.' },
  pcm: { title: 'PCM — Pulsos codificados', desc: 'Muestreo, cuantificación, codificación, enlace digital y reconstrucción. Incluye error ±q/2, aliasing, SQNR vs bits y umbral.' },
};

function fmt(v, d = 3) {
  if (v == null || !isFinite(v)) return '—';
  if (v === Infinity) return '∞';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(2) + 'k';
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toPrecision(d);
  if (a >= 1e-3) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return v.toExponential(2);
}
function db(v) { return (v == null || !isFinite(v)) ? '—' : `${Number(v).toFixed(1)} dB`; }
function el(id) { return document.getElementById(id); }
function v(id) {
  const e = el(id); if (!e) return undefined;
  if (e.type === 'checkbox') return e.checked;
  if (e.type === 'number') return e.value === '' ? undefined : Number(e.value);
  return e.value;
}

function setStatus(msg, kind = '') {
  const b = $('#statusBar');
  b.textContent = msg;
  b.className = 'status-bar' + (kind ? ' ' + kind : '');
}

function bootProgress(msg, pct) {
  $('#bootMsg').textContent = msg || '';
  if (pct != null) $('#bootBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
}

// ---------- Controls schema ----------
function f(id, label, type, opts = {}) {
  const attrs = [
    opts.step != null ? `step="${opts.step}"` : '',
    opts.min != null ? `min="${opts.min}"` : '',
    opts.max != null ? `max="${opts.max}"` : '',
    opts.placeholder ? `placeholder="${opts.placeholder.replace(/"/g, '&quot;')}"` : '',
  ].join(' ');
  if (type === 'select') {
    const options = (opts.options || []).map(o => `<option value="${o.value}" ${String(o.value) === String(opts.value) ? 'selected' : ''}>${o.label}</option>`).join('');
    return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options}</select></div>`;
  }
  if (type === 'check') {
    return `<div class="check-row"><label for="${id}">${label}</label><input id="${id}" type="checkbox" ${opts.value ? 'checked' : ''}/></div>`;
  }
  if (type === 'textarea') {
    return `<div class="field full"><label for="${id}">${label}</label><textarea id="${id}" ${attrs}>${opts.value ?? ''}</textarea></div>`;
  }
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${opts.value ?? ''}" ${attrs}/></div>`;
}
function g(title, inner) { return `<div class="group"><h4>${title}</h4>${inner}</div>`; }

function channelControls(metric) {
  const nomLabel = metric === 'ebn0' ? 'Eb/N0 nominal TX (dB)' : 'SNR nominal TX (dB)';
  const nomVal = metric === 'ebn0' ? 12 : 30;
  return g('Canal', `
    ${f('ch_preset', 'Preset', 'select', { value: 'AWGN ideal', options: [
      { value: 'Personalizado', label: 'Personalizado' }, { value: 'AWGN ideal', label: 'AWGN ideal' },
      { value: 'Enlace a 1 km', label: 'Enlace a 1 km' }, { value: 'Atenuación fuerte', label: 'Atenuación fuerte' },
      { value: 'Multitrayecto', label: 'Multitrayecto' }, { value: 'Interferencia', label: 'Interferencia' },
      { value: 'Deriva y fase', label: 'Deriva y fase' }, { value: 'No lineal (AGC/clip)', label: 'No lineal (AGC/clip)' },
    ] })}
    ${f('ch_dist', 'Distancia (km)', 'number', { value: 0, step: 0.01, min: 0 })}
    ${f('ch_freq', 'Frecuencia enlace (MHz)', 'number', { value: 2450, step: 50, min: 1 })}
    ${f('ch_att', 'Atenuación extra (dB)', 'number', { value: 0, step: 1, min: 0 })}
    ${f('ch_nom', nomLabel, 'number', { value: nomVal, step: 1 })}
    <div class="field"><label for="ch_tgt">Objetivo RX (dB)</label><div class="row" style="gap:6px"><input id="ch_tgt" type="number" value="${metric === 'ebn0' ? 10 : 20}" step="1" style="flex:1"/><button class="btn small-btn" id="ch_adj" type="button">Ajustar</button></div></div>
    <div class="note" id="ch_link" style="margin:6px 0 0;padding:8px;font-size:11px">—</div>
    <details class="ctrl"><summary>Multitrayecto / interferencia / hardware</summary><div class="details-body">
      ${f('ch_mp', 'Multitrayecto (eco)', 'check', { value: false })}
      ${f('ch_mpd', 'Retardo (µs)', 'number', { value: 100, step: 10 })}
      ${f('ch_mpg', 'Ganancia eco (dB)', 'number', { value: -6, step: 1 })}
      ${f('ch_mpp', 'Fase eco (°)', 'number', { value: 180, step: 15 })}
      ${f('ch_int', 'Interferencia (tono)', 'check', { value: false })}
      ${f('ch_intf', 'Freq. interferencia (Hz)', 'number', { value: 0, step: 100 })}
      ${f('ch_inta', 'Amp. interferencia (dB)', 'number', { value: -12, step: 1 })}
      ${f('ch_cfo', 'CFO (Hz)', 'number', { value: 0, step: 10 })}
      ${f('ch_phi', 'Ruido fase RMS (rad)', 'number', { value: 0, step: 0.01, min: 0 })}
      ${f('ch_gdb', 'Escalón ganancia (dB)', 'number', { value: 0, step: 1 })}
      ${f('ch_gat', 'Instante escalón (0-1)', 'number', { value: 0.5, step: 0.05, min: 0, max: 1 })}
      ${f('ch_clip', 'Limitar amplitud (clip)', 'check', { value: false })}
      ${f('ch_clv', 'Nivel clip', 'number', { value: 1.2, step: 0.1, min: 0.05 })}
      ${f('ch_seed', 'Semilla', 'number', { value: 1, step: 1, min: 1 })}
    </div></details>
  `);
}

const SCHEMAS = {
  am: () => [
    g('Señal moduladora', `
      ${f('waveform', 'Forma de onda', 'select', { value: 'sine', options: [
        { value: 'sine', label: 'Senoidal' }, { value: 'square', label: 'Cuadrada' }, { value: 'triangle', label: 'Triangular' },
        { value: 'sawtooth', label: 'Diente de sierra' }, { value: 'chirp', label: 'Chirp (barrido)' }, { value: 'two_tone', label: 'Dos tonos' },
        { value: 'formula', label: 'Fórmula personalizada' },
      ] })}
      ${f('fm', 'Frecuencia fm (Hz)', 'number', { value: 1000, step: 50 })}
      ${f('phase_deg', 'Fase (°)', 'number', { value: 0, step: 15 })}
      ${f('duty', 'Ciclo de trabajo', 'number', { value: 0.5, step: 0.05, min: 0.05, max: 0.95 })}
      ${f('f_end', 'Chirp f final (Hz)', 'number', { value: 3000, step: 100 })}
      ${f('formula', 'Fórmula (en t)', 'textarea', { value: '0.8*sin(2*pi*1000*t) + 0.2*sin(2*pi*3000*t)' })}
      ${f('duration_ms', 'Duración (ms)', 'number', { value: 10, step: 1, min: 1, max: 100 })}
    `),
    g('Parámetros AM', `
      ${f('m', 'Índice m', 'number', { value: 0.8, step: 0.05, min: 0, max: 2 })}
      ${f('Vp', 'Portadora Vp (V)', 'number', { value: 1.0, step: 0.1, min: 0.05 })}
      ${f('fc', 'Frecuencia fc (Hz)', 'number', { value: 20000, step: 1000 })}
      ${f('fs', 'Muestreo fs (Hz)', 'number', { value: 400000, step: 10000 })}
    `),
    channelControls('snr'),
  ].join(''),
  ask: () => [
    g('Secuencia de bits', `
      ${f('nbits', 'Número de bits', 'number', { value: 4000, step: 500, min: 16, max: 120000 })}
      ${f('bit_mode', 'Fuente', 'select', { value: 'random', options: [
        { value: 'random', label: 'Aleatoria' }, { value: 'manual', label: 'Manual' }, { value: 'alternating', label: 'Alternada 0101…' }, { value: 'prbs7', label: 'PRBS-7' },
      ] })}
      ${f('manual_bits', 'Bits manuales', 'text', { value: '1011001011100101' })}
      ${f('seed', 'Semilla bits', 'number', { value: 1, step: 1, min: 1 })}
    `),
    g('Modulación y receptor', `
      ${f('rb', 'Tasa Rb (bit/s)', 'number', { value: 1000, step: 100 })}
      ${f('fc', 'Portadora fc (Hz)', 'number', { value: 6000, step: 500 })}
      ${f('amplitude', 'Amplitud (V)', 'number', { value: 1.0, step: 0.1 })}
      ${f('sps', 'Muestras/bit', 'number', { value: 32, step: 4, min: 8, max: 128 })}
      ${f('detector', 'Detector', 'select', { value: 'coherent', options: [{ value: 'coherent', label: 'Coherente' }, { value: 'envelope', label: 'Envolvente' }] })}
      ${f('timing_offset_frac', 'Error timing (frac. bit)', 'number', { value: 0, step: 0.05, min: -0.45, max: 0.45 })}
      ${f('agc_error_db', 'Error AGC (dB)', 'number', { value: 0, step: 1 })}
    `),
    channelControls('ebn0'),
  ].join(''),
  fsk: () => [
    g('Secuencia de bits', `
      ${f('nbits', 'Número de bits', 'number', { value: 4000, step: 500, min: 16, max: 120000 })}
      ${f('bit_mode', 'Fuente', 'select', { value: 'random', options: [
        { value: 'random', label: 'Aleatoria' }, { value: 'manual', label: 'Manual' }, { value: 'alternating', label: 'Alternada 0101…' }, { value: 'prbs7', label: 'PRBS-7' },
      ] })}
      ${f('manual_bits', 'Bits manuales', 'text', { value: '1011001011100101' })}
      ${f('seed', 'Semilla bits', 'number', { value: 1, step: 1, min: 1 })}
    `),
    g('Modulación y receptor', `
      ${f('rb', 'Tasa Rb (bit/s)', 'number', { value: 1000, step: 100 })}
      ${f('fc', 'Portadora central (Hz)', 'number', { value: 6000, step: 500 })}
      ${f('amplitude', 'Amplitud (V)', 'number', { value: 1.0, step: 0.1 })}
      ${f('sps', 'Muestras/bit', 'number', { value: 32, step: 4, min: 8, max: 128 })}
      ${f('h', 'Índice h', 'number', { value: 1.0, step: 0.1, min: 0.1, max: 4 })}
      ${f('detector', 'Detector', 'select', { value: 'noncoherent', options: [{ value: 'noncoherent', label: 'No coherente (I/Q)' }, { value: 'coherent', label: 'Coherente' }] })}
      ${f('timing_offset_frac', 'Error timing (frac. bit)', 'number', { value: 0, step: 0.05, min: -0.45, max: 0.45 })}
    `),
    channelControls('ebn0'),
  ].join(''),
  pcm: () => [
    g('Señal analógica', `
      ${f('waveform', 'Forma de onda', 'select', { value: 'sine', options: [
        { value: 'sine', label: 'Senoidal' }, { value: 'square', label: 'Cuadrada' }, { value: 'triangle', label: 'Triangular' },
        { value: 'sawtooth', label: 'Diente de sierra' }, { value: 'chirp', label: 'Chirp' }, { value: 'two_tone', label: 'Dos tonos' }, { value: 'formula', label: 'Fórmula' },
      ] })}
      ${f('fm', 'Frecuencia fm (Hz)', 'number', { value: 1000, step: 50 })}
      ${f('phase_deg', 'Fase (°)', 'number', { value: 0, step: 15 })}
      ${f('duty', 'Ciclo de trabajo', 'number', { value: 0.5, step: 0.05, min: 0.05, max: 0.95 })}
      ${f('f_end', 'Chirp f final (Hz)', 'number', { value: 3000, step: 100 })}
      ${f('formula', 'Fórmula (en t)', 'textarea', { value: '0.8*sin(2*pi*1000*t)' })}
      ${f('amplitude', 'Amplitud pico (V)', 'number', { value: 0.8, step: 0.05, min: 0.05 })}
    `),
    g('Muestreo y cuantificación', `
      ${f('fs_sample', 'Muestreo fs (Hz)', 'number', { value: 8000, step: 500 })}
      ${f('n_bits', 'Bits por muestra', 'number', { value: 8, step: 1, min: 2, max: 16 })}
      ${f('duration_ms', 'Duración (ms)', 'number', { value: 20, step: 1, min: 2, max: 100 })}
      ${f('full_scale', 'Fondo de escala (V)', 'number', { value: 1.0, step: 0.1 })}
      ${f('antialias', 'Filtro antialias', 'check', { value: true })}
    `),
    g('Enlace digital PCM', `
      ${f('scheme', 'Esquema', 'select', { value: 'BPSK', options: [{ value: 'BPSK', label: 'BPSK' }, { value: 'ASK', label: 'ASK / OOK' }, { value: 'FSK', label: 'FSK' }] })}
      ${f('fc', 'Portadora fc (Hz)', 'number', { value: 20000, step: 1000 })}
      ${f('sps', 'Muestras/bit', 'number', { value: 16, step: 4, min: 8, max: 64 })}
      <div class="note" id="pcm_info" style="margin:6px 0 0;padding:8px;font-size:11px">—</div>
    `),
    channelControls('ebn0'),
  ].join(''),
};

function fslDb(dKm, fMhz) { if (dKm <= 0 || fMhz <= 0) return 0; return 32.45 + 20 * Math.log10(dKm) + 20 * Math.log10(fMhz); }
function updateLinkLabel() {
  const d = Number(v('ch_dist') || 0), fmhz = Number(v('ch_freq') || 0), att = Number(v('ch_att') || 0);
  const total = fslDb(d, fmhz) + att;
  const nom = Number(v('ch_nom') || 0);
  const eff = nom - total;
  const isEb = state.module !== 'am';
  const lbl = $('#ch_link');
  if (lbl) lbl.innerHTML = `Pérdida total estimada: <b>${total.toFixed(1)} dB</b><br>${isEb ? 'Eb/N0' : 'SNR'} efectiva aprox.: <b>${eff.toFixed(1)} dB</b>`;
  // PCM carrier info
  const pi = $('#pcm_info');
  if (pi && state.module === 'pcm') {
    const fsS = Number(v('fs_sample') || 8000), nb = Number(v('n_bits') || 8), sps = Number(v('sps') || 16);
    const rb = fsS * nb, fsrf = rb * sps;
    let fc = Math.max(rb, Math.round((Number(v('fc')) || 0) / Math.max(rb, 1)) * rb);
    const maxfc = fsrf / 2; if (fc >= maxfc) fc = rb * Math.max(1, Math.floor((maxfc - 1e-9) / Math.max(rb, 1)));
    const cyc = rb > 0 ? Math.round(fc / rb) : 0;
    pi.innerHTML = `Rb = ${(rb / 1e3).toFixed(1)} kbit/s · fs RF = ${(fsrf / 1e6).toFixed(2)} MHz<br>fc real = ${(fc / 1e3).toFixed(2)} kHz · ${cyc} ciclo(s)/bit`;
  }
}

function applyPreset(name) {
  if (name === 'Personalizado') return;
  const set = (id, val) => { const e = el(id); if (e) { if (e.type === 'checkbox') e.checked = !!val; else e.value = val; } };
  set('ch_dist', 0); set('ch_freq', 2450); set('ch_att', 0);
  set('ch_mp', false); set('ch_mpd', 100); set('ch_mpg', -6); set('ch_mpp', 180);
  set('ch_int', false); set('ch_intf', state.module === 'am' ? 24000 : (state.module === 'pcm' ? 70000 : 8000)); set('ch_inta', -12);
  set('ch_cfo', 0); set('ch_phi', 0); set('ch_gdb', 0); set('ch_gat', 0.5); set('ch_clip', false); set('ch_clv', 1.2);
  const nominal = state.module === 'am' ? 30 : 12;
  set('ch_nom', nominal);
  if (name === 'Enlace a 1 km') { set('ch_dist', 1); set('ch_freq', 2450); const t = fslDb(1, 2450); set('ch_nom', Math.min(180, (state.module === 'am' ? 20 : 10) + t)); }
  else if (name === 'Atenuación fuerte') { set('ch_att', 40); set('ch_nom', Math.min(180, (state.module === 'am' ? 20 : 10) + 40)); }
  else if (name === 'Multitrayecto') { set('ch_mp', true); set('ch_mpd', 250); set('ch_mpg', -3); set('ch_mpp', 180); }
  else if (name === 'Interferencia') { set('ch_int', true); set('ch_inta', -6); }
  else if (name === 'Deriva y fase') { set('ch_cfo', 120); set('ch_phi', 0.06); }
  else if (name === 'No lineal (AGC/clip)') { set('ch_gdb', 9); set('ch_gat', 0.45); set('ch_clip', true); set('ch_clv', 0.75); }
  updateLinkLabel();
}

function bindChannel() {
  const p = el('ch_preset'); if (p) p.addEventListener('change', () => applyPreset(p.value));
  const adj = el('ch_adj'); if (adj) adj.addEventListener('click', () => {
    const d = Number(v('ch_dist') || 0), fmhz = Number(v('ch_freq') || 0), att = Number(v('ch_att') || 0);
    const total = fslDb(d, fmhz) + att; const tgt = Number(v('ch_tgt') || 0);
    const e = el('ch_nom'); if (e) e.value = Math.min(180, tgt + total); updateLinkLabel();
  });
  ['ch_dist','ch_freq','ch_att','ch_nom','ch_tgt','ch_mp','ch_int','ch_clip','fs_sample','n_bits','sps','fc'].forEach(id => {
    const e = el(id); if (e) e.addEventListener(e.type === 'checkbox' ? 'change' : 'input', updateLinkLabel);
  });
  // default interference freq
  const intf = el('ch_intf'); if (intf && (Number(intf.value) === 0 || !intf.value)) {
    if (state.module === 'am') intf.value = Number(v('fc') || 20000) + 4000;
    else if (state.module === 'pcm') intf.value = 70000;
    else intf.value = Number(v('fc') || 6000) + 2000;
  }
  updateLinkLabel();
}

function collectParams() {
  const ch = {
    distance_km: v('ch_dist'), frequency_mhz: v('ch_freq'), extra_atten_db: v('ch_att'),
    nominal_db: v('ch_nom'),
    multipath: v('ch_mp'), mp_delay_us: v('ch_mpd'), mp_gain_db: v('ch_mpg'), mp_phase_deg: v('ch_mpp'),
    interference: v('ch_int'), int_freq_hz: v('ch_intf'), int_amp_db: v('ch_inta'),
    freq_offset_hz: v('ch_cfo'), phase_noise_rms: v('ch_phi'), gain_step_db: v('ch_gdb'), gain_step_at: v('ch_gat'),
    clip_on: v('ch_clip'), clip_level: v('ch_clv'), seed: v('ch_seed'),
  };
  const m = state.module;
  if (m === 'am') return {
    waveform: v('waveform'), fm: v('fm'), phase_deg: v('phase_deg'), duty: v('duty'), f_end: v('f_end'),
    formula: v('waveform') === 'formula' ? v('formula') : null,
    Vp: v('Vp'), fc: v('fc'), m: v('m'), fs: v('fs'), duration_ms: v('duration_ms'), channel: ch,
  };
  if (m === 'ask') return {
    nbits: v('nbits'), bit_mode: v('bit_mode'), manual_bits: v('manual_bits'), seed: v('seed'),
    rb: v('rb'), fc: v('fc'), amplitude: v('amplitude'), sps: v('sps'), detector: v('detector'),
    agc_error_db: v('agc_error_db'), timing_offset_frac: v('timing_offset_frac'), channel: ch,
  };
  if (m === 'fsk') return {
    nbits: v('nbits'), bit_mode: v('bit_mode'), manual_bits: v('manual_bits'), seed: v('seed'),
    rb: v('rb'), fc: v('fc'), amplitude: v('amplitude'), sps: v('sps'), h: v('h'), detector: v('detector'),
    timing_offset_frac: v('timing_offset_frac'), channel: ch,
  };
  if (m === 'pcm') return {
    waveform: v('waveform'), fm: v('fm'), phase_deg: v('phase_deg'), duty: v('duty'), f_end: v('f_end'),
    formula: v('waveform') === 'formula' ? v('formula') : null,
    amplitude: v('amplitude'), fs_sample: v('fs_sample'), n_bits: v('n_bits'), duration_ms: v('duration_ms'),
    full_scale: v('full_scale'), antialias: v('antialias'), scheme: v('scheme'), fc: v('fc'), sps: v('sps'),
    seed: v('ch_seed'), channel: ch,
  };
  return { channel: ch };
}

// ---------- Charts ----------
function destroyCharts() { state.charts.forEach(c => { try { c.destroy(); } catch (_) {} }); state.charts = []; }

function interpText(title, series, x, y, xl, yl) {
  const t = (title || '').toLowerCase(), s = (series || '').toLowerCase(), xlw = (xl || '').toLowerCase();
  const hints = [];
  if (t.includes('recuperación') || t.includes('reconstrucción')) hints.push('Compara original vs recuperado; idealmente coinciden.');
  if (t.includes('espectro')) hints.push('Energía por frecuencia (dB relativo al pico): picos = componentes dominantes.');
  if (t.includes('error') && !t.includes('cuant')) hints.push('Error = recuperada − original; cerca de 0 indica buena fidelidad.');
  if (t.includes('cuantificación') && t.includes('error')) hints.push('Error de redondeo al nivel discreto; idealmente acotado cerca de ±q/2.');
  if (t.includes('ber')) hints.push('BER: fracción de bits erróneos. Mayor Eb/N0 suele reducirla; teoría = referencia AWGN.');
  if (t.includes('fidelidad') || (yl || '').toLowerCase().includes('mse')) hints.push('MSE: error cuadrático medio; menor es mejor.');
  if (t.includes('ojo')) hints.push('Apertura grande = mejor margen ante ruido y error de muestreo.');
  if (t.includes('potencia') && t.includes('am')) hints.push('La portadora no lleva información; las bandas laterales sí.');
  if (t.includes('frecuencia estimada')) hints.push('En FSK cada bit debe acercarse a f0 o f1; desviaciones = ruido/offset/ISI.');
  if (t.includes('umbral') || t.includes('enlace pcm')) hints.push('Bajo el umbral, errores de bit degradan más que la cuantización.');
  if (t.includes('sqnr') && xlw.includes('bit')) hints.push('Cada bit añade ~6 dB de SQNR ideal (cuantificación uniforme).');
  if (s.includes('envolvente')) hints.push('Detector de envolvente: simple, mejor con m≤1 y buena SNR.');
  if (s.includes('coherente')) hints.push('Detector coherente: requiere sincronía; suele ser más robusto.');
  if (s.includes('rx')) hints.push('RX incluye atenuación/ruido/factores del canal.');
  if (s.includes('teoría')) hints.push('Referencia ideal; diferencias por Monte Carlo/canal/parámetros.');
  if (s.includes('actual')) hints.push('Punto de operación con la configuración actual.');
  if (t.includes('alias')) hints.push('Si fm > fs/2 o falta antialias, aparecen componentes plegadas.');
  return hints.slice(0, 2).join(' ') || 'Relaciona serie y ejes; cambia un parámetro y observa el efecto.';
}

function baseOpts(title, xl, yl, extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', intersect: false },
    scales: Object.assign({ x: { type: 'linear', title: { display: !!xl, text: xl }, ticks: { maxTicksLimit: 8 } }, y: { title: { display: !!yl, text: yl }, ticks: { maxTicksLimit: 7 } } }, extra.scales || {}),
    plugins: {
      legend: { labels: { boxWidth: 10, color: '#526277', font: { size: 11 } } },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,.97)', titleColor: '#182230', bodyColor: '#526277', borderColor: '#dce4ec', borderWidth: 1,
        callbacks: { afterBody: (items) => { const it = items[0]; if (!it) return ''; const sx = fmt(it.parsed.x, 4), sy = fmt(it.parsed.y, 4); return `\n${interpText(title, it.dataset.label, it.parsed.x, it.parsed.y, xl, yl)}`; } }
      },
      ...(extra.plugins || {}),
    },
  };
}

function mkChart(container, title, type, data, options, interpretation) {
  const box = document.createElement('div');
  box.className = 'chart-box';
  box.innerHTML = `<div class="chart-title">${title}</div><canvas></canvas><div class="chart-interp"><b>Interpretación:</b> ${interpretation}</div>`;
  container.appendChild(box);
  const c = new Chart(box.querySelector('canvas').getContext('2d'), { type, data, options });
  state.charts.push(c);
  return c;
}

function pts(x, y) { const o = []; const n = Math.min((x||[]).length,(y||[]).length); for (let i=0;i<n;i++) o.push({x:x[i],y:y[i]}); return o; }
function setMetrics(items) {
  $('#metrics').innerHTML = items.map(m => `<div class="metric"><div class="k">${m.k}</div><div class="v" style="color:${m.c || 'var(--ink)'}">${m.v}</div><div class="h">${m.h || ''}</div></div>`).join('');
}

// ---------- Renderers ----------
function renderAM(r) {
  const met = r.metrics || {}, rep = r.report || {};
  const over = !!met.overmodulation;
  setMetrics([
    { k: 'Índice m', v: fmt(met.m, 3), h: over ? 'm > 1: sobremodulación' : `${fmt(met.m_percent, 2)} % · lineal`, c: over ? 'var(--red)' : '#0891b2' },
    { k: 'Potencia total', v: `${fmt(met.pt_pc, 3)} × Pc`, h: `portadora ${fmt((met.carrier_fraction||0)*100,3)} %`, c: '#b45309' },
    { k: 'Error envolvente', v: fmt(met.mse_env, 3), h: `corr ${fmt(met.corr_env,4)}`, c: '#7c3aed' },
    { k: 'Error coherente', v: fmt(met.mse_coh, 3), h: `corr ${fmt(met.corr_coh,4)}`, c: '#15803d' },
    { k: 'SNR efectiva', v: db(met.snr_eff_db), h: `pérdida ${fmt(met.total_atten_db,3)} dB`, c: '#db2777' },
  ]);
  const C = $('#charts'); destroyCharts(); C.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'chart-grid g32'; C.appendChild(grid);
  mkChart(grid, 'Recuperación de la señal', 'line', { datasets: [
    { label: 'm(t) original', data: pts(r.recovery.t_ms, r.recovery.msg), borderColor: '#334155', borderWidth: 2, pointRadius: 0 },
    { label: 'detector envolvente', data: pts(r.recovery.t_ms, r.recovery.env), borderColor: '#15803d', borderWidth: 1.2, pointRadius: 0 },
    { label: 'detector coherente', data: pts(r.recovery.t_ms, r.recovery.coh), borderColor: '#2563eb', borderWidth: 1.1, borderDash: [4,3], pointRadius: 0 },
  ]}, baseOpts('Recuperación de la señal', 'tiempo (ms)', 'amplitud normalizada', { scales: { y: { min: -1.8, max: 1.8, title: {display:true,text:'amplitud normalizada'} } } }),
    'Compara original con envolvente/coherente. m>1 distorsiona envolvente; ruido aleja ambas.');
  mkChart(grid, 'Señal AM transmitida y recibida', 'line', { datasets: [
    { label: 'tx', data: pts(r.rf.t_ms, r.rf.tx), borderColor: '#0891b2', borderWidth: 0.9, pointRadius: 0 },
    { label: 'rx (compensada)', data: pts(r.rf.t_ms, r.rf.rx), borderColor: '#c2410c', borderWidth: 0.75, pointRadius: 0 },
  ]}, baseOpts('Señal AM transmitida y recibida', 'tiempo (ms)', 'amplitud'),
    'TX vs RX compensada por atenuación. RX refleja canal/ruido; la envolvente de la portadora sigue la moduladora.');
  mkChart(grid, 'Espectro (cada traza normalizada a su pico)', 'line', { datasets: [
    { label: 'tx', data: pts(r.spec_tx.f_khz, r.spec_tx.db), borderColor: '#0891b2', borderWidth: 1.1, pointRadius: 0 },
    { label: 'rx', data: pts(r.spec_rx.f_khz, r.spec_rx.db), borderColor: '#c2410c', borderWidth: 0.8, pointRadius: 0 },
  ]}, baseOpts('Espectro', 'frecuencia (kHz)', 'magnitud (dB)', { scales: { x: { type:'linear', max: r.xmax_khz, title:{display:true,text:'frecuencia (kHz)'} }, y: { min:-90,max:3, title:{display:true,text:'magnitud (dB)'} } } }),
    `Portadora y bandas laterales (fc, fc±fm: ${r.markers.map(x=>fmt(x,3)).join(', ')} kHz). Ruido eleva piso; interferencia crea picos.`);
  mkChart(grid, 'Error de recuperación', 'line', { datasets: [
    { label: 'envolvente', data: pts(r.error.t_ms, r.error.env), borderColor: '#15803d', borderWidth: 0.9, pointRadius: 0 },
    { label: 'coherente', data: pts(r.error.t_ms, r.error.coh), borderColor: '#2563eb', borderWidth: 0.9, pointRadius: 0 },
  ]}, baseOpts('Error de recuperación', 'tiempo (ms)', 'recuperada − original'),
    'Diferencia respecto a la original en régimen permanente. Menor amplitud = mejor fidelidad.');
  mkChart(grid, 'Fidelidad frente a SNR (AWGN)', 'line', { datasets: [
    { label: 'envolvente', data: pts(r.curve.snr_db, r.curve.mse_env), borderColor: '#15803d', borderWidth: 1.2, pointRadius: 2 },
    { label: 'coherente', data: pts(r.curve.snr_db, r.curve.mse_coh), borderColor: '#2563eb', borderWidth: 1.2, pointRadius: 2 },
    ...(isFinite(met.snr_eff_db) ? [{ label: 'actual', data: [{x:met.snr_eff_db,y:Math.max(met.mse_coh||1e-12,1e-12)}], backgroundColor:'#db2777', borderColor:'#db2777', pointRadius:5, showLine:false, type:'scatter' }] : []),
  ]}, baseOpts('Fidelidad frente a SNR (AWGN)', 'SNR nominal (dB)', 'MSE', { scales: { y: { type:'logarithmic', title:{display:true,text:'MSE'} } } }),
    'MSE vs SNR nominal en AWGN limpio. El punto actual refleja la configuración (incluye pérdidas/factores).');
  // power bar
  const p = r.power || {};
  const pw = document.createElement('div'); pw.className = 'chart-box'; pw.innerHTML = `<div class="chart-title">Reparto de potencia AM · m=${fmt(p.m,3)} · Pt/Pc=${fmt(p.pt_pc,3)}</div><canvas></canvas><div class="chart-interp"><b>Interpretación:</b> La portadora consume potencia pero no lleva información; las bandas laterales (BLI/BLS) transportan el mensaje.</div>`;
  grid.appendChild(pw);
  const pc = new Chart(pw.querySelector('canvas').getContext('2d'), { type:'bar', data:{ labels:['Potencia'], datasets:[
    { label:'portadora', data:[(p.carrier||0)*100], backgroundColor:'#f59e0b' },
    { label:'BLI', data:[(p.sideband_half||0)*100], backgroundColor:'#0891b2' },
    { label:'BLS', data:[(p.sideband_half||0)*100], backgroundColor:'#7c3aed' },
  ]}, options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:false, plugins:{ legend:{labels:{boxWidth:10}}, tooltip:{callbacks:{afterBody:()=>'\nReparto porcentual: portadora vs bandas laterales.'}} }, scales:{ x:{ stacked:true, min:0, max:100, title:{display:true,text:'% potencia total'} }, y:{ stacked:true } } } });
  state.charts.push(pc);
  $('#globalInterp').innerHTML = `<b>Lectura AM:</b> m=${fmt(met.m,3)} (${over?'sobremodulación':'lineal'}), Pt/Pc=${fmt(met.pt_pc,3)}. SNR efectiva (banda) ≈ ${db(met.snr_eff_db)}, atenuación total ${fmt(met.total_atten_db,3)} dB. IF ≈ ${fmt(met.if_bandwidth_hz,4)} Hz.`;
}

function renderASK(r) { renderDigital(r, 'ASK'); }
function renderFSK(r) { renderDigital(r, 'FSK'); }

function renderDigital(r, scheme) {
  const ex = r.extras || {}, rep = r.report || {};
  const ber = r.ber || 0;
  const bcol = ber === 0 ? 'var(--green)' : ber < 1e-2 ? 'var(--amber)' : 'var(--red)';
  if (scheme === 'ASK') {
    setMetrics([
      { k: 'BER medida', v: Number(ber).toExponential(2), h: `${r.errors} errores / ${r.nbits} bits`, c: bcol },
      { k: 'Eb/N0 efectiva', v: db(r.ebn0_eff_db), h: `efectiva en RX`, c: '#0891b2' },
      { k: 'SNR efectiva (banda)', v: db(ex.snr_band_db ?? rep.snr_band_db), h: 'SNR en banda (2·Rb)', c: '#7c3aed' },
      { k: 'Ancho de banda', v: `${fmt((ex.bandwidth_hz||2*r.rb)/1e3,3)} kHz`, h: `2·Rb`, c: '#b45309' },
      { k: 'Portadora real', v: `${fmt((ex.fc||0)/1e3,4)} kHz`, h: `${ex.cycles_per_bit||0} ciclos/bit · ${ex.detector||''}`, c: '#db2777' },
    ]);
  } else {
    const ortho = ex.orthogonal ? 'ortogonal' : 'no ortogonal';
    setMetrics([
      { k: 'BER medida', v: Number(ber).toExponential(2), h: `${r.errors} errores / ${r.nbits} bits`, c: bcol },
      { k: 'Eb/N0 efectiva', v: db(r.ebn0_eff_db), h: 'nominal − atenuación', c: '#b45309' },
      { k: 'Índice h', v: fmt(ex.h,3), h: ortho, c: '#0891b2' },
      { k: 'Ancho de banda', v: `${fmt((ex.bandwidth_hz||0)/1e3,3)} kHz`, h: `Carson · ef. ${fmt((ex.spectral_efficiency||0),2)}`, c: '#7c3aed' },
      { k: 'Tonos f0 / f1', v: `${fmt((ex.f0||0)/1e3,3)} / ${fmt((ex.f1||0)/1e3,3)} kHz`, h: `Δf=${fmt((ex.df||0)/1e3,3)} kHz · ${ex.detector||''}`, c: '#db2777' },
    ]);
  }
  const C = $('#charts'); destroyCharts(); C.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'chart-grid g22'; C.appendChild(grid);
  // waveform
  const w = r.wave;
  const amp = Math.max(...(w.tx||[]).map(Math.abs), 1) * 1.15;
  const detY = (w.det || []).map(b => (scheme === 'ASK' ? b * amp * 0.92 : (b ? 1 : -1) * amp * 0.92));
  mkChart(grid, `${scheme==='ASK'?'Secuencia y forma de onda':'Forma de onda FSK'} · ${r.bits_show||''}`, 'line', { datasets: [
    { label: 'tx', data: pts(w.t_ms, w.tx), borderColor: '#0891b2', borderWidth: 1.0, pointRadius: 0 },
    { label: 'rx / ganancia', data: pts(w.t_ms, w.rx), borderColor: '#c2410c', borderWidth: 0.75, pointRadius: 0 },
    { label: 'bits detectados', data: pts(w.centers_ms, detY), type:'scatter', backgroundColor:'#db2777', pointRadius:3, showLine:false },
  ]}, baseOpts('Forma de onda', 'tiempo (ms)', 'amplitud'),
    scheme==='ASK' ? 'OOK: 1=portadora, 0=silencio. Errores cuando el ruido cruza el umbral de decisión.' : 'Cada bit usa f0 o f1. Ruido/canal pueden causar decisiones erróneas.');
  // 2nd: ASK eye, FSK per-bit freq
  if (scheme === 'ASK' && r.eye) {
    const eye = r.eye;
    const ds = eye.traces.slice(0, 160).map((tr, i) => ({ label: i===0?'trazas ojo':`_t${i}`, data: pts(eye.ui, tr), borderColor: 'rgba(194,65,12,0.22)', borderWidth: 0.6, pointRadius: 0 }));
    ds.push({ label: 'umbral', data: [{x:0,y:eye.threshold},{x:1,y:eye.threshold}], borderColor:'#db2777', borderWidth:1.2, borderDash:[5,4], pointRadius:0 });
    mkChart(grid, 'Diagrama de ojo (160 bits)', 'line', { datasets: ds }, baseOpts('Diagrama de ojo', 'tiempo normalizado (UI)', 'amplitud', { plugins:{ legend:{ labels:{ filter:(it)=>!String(it.text||'').startsWith('_') } } } }),
      'Apertura vertical/horizontal indica margen ante ruido y jitter de muestreo. Umbral = decisión.');
  } else if (scheme === 'FSK' && r.fbit) {
    const fb = r.fbit;
    mkChart(grid, 'Frecuencia estimada por bit', 'line', { datasets: [
      { label: 'f estimada por bit', data: pts(fb.t_ms, fb.f_khz), borderColor:'#c2410c', borderWidth:1.2, pointRadius:0, stepped:'middle' },
      { label: `f0=${fmt((ex.f0||0)/1e3,3)} kHz`, data: fb.t_ms.length?[{x:fb.t_ms[0],y:(ex.f0||0)/1e3},{x:fb.t_ms[fb.t_ms.length-1],y:(ex.f0||0)/1e3}]:[], borderColor:'#0891b2', borderWidth:1, borderDash:[5,4], pointRadius:0 },
      { label: `f1=${fmt((ex.f1||0)/1e3,3)} kHz`, data: fb.t_ms.length?[{x:fb.t_ms[0],y:(ex.f1||0)/1e3},{x:fb.t_ms[fb.t_ms.length-1],y:(ex.f1||0)/1e3}]:[], borderColor:'#b45309', borderWidth:1, borderDash:[5,4], pointRadius:0 },
    ]}, baseOpts('Frecuencia estimada por bit', 'tiempo (ms)', 'frecuencia (kHz)'),
      'Estimación por pendiente de fase (Hilbert). Debe saltar entre f0 y f1 según el bit.');
  } else {
    mkChart(grid, 'Diagrama / frecuencia', 'line', { datasets: [] }, baseOpts('Info', '', ''), 'Sin datos adicionales.');
  }
  // spectrum
  mkChart(grid, `Espectro ${scheme}${scheme==='FSK'?` · h=${fmt(ex.h,2)}`:' · lóbulos sinc'}`, 'line', { datasets: [
    { label: 'tx', data: pts(r.spec.f_khz, r.spec.db), borderColor: '#0891b2', borderWidth: 1.0, pointRadius: 0 },
  ]}, baseOpts('Espectro', 'frecuencia (kHz)', 'magnitud (dB)', { scales:{ x:{ type:'linear', max:r.xmax_khz, title:{display:true,text:'frecuencia (kHz)'} }, y:{ min:-85,max:3, title:{display:true,text:'magnitud (dB)'} } } }),
    scheme==='ASK' ? 'Lóbulos sinc alrededor de fc, separados por Rb; ancho principal ~2Rb.' : 'Energía cerca de f0/f1. Separación = h·Rb/2; CFO desplaza los tonos.');
  // BER curve
  const cur = r.curve || {};
  const floor = 0.5 / Math.max(cur.nbits || r.nbits || 1, 1);
  const simPts = pts(cur.ebn0_db, (cur.ber_sim||[]).map(v => Math.max(v, 1e-7)));
  const thPts = pts(cur.ebn0_db, (cur.ber_theory||[]).map(v => Math.max(v, 1e-8)));
  const curX = r.ebn0_eff_db;
  const curY = ber > 0 ? ber : floor;
  const bds = [
    { label: 'teoría', data: thPts, borderColor: '#64748b', borderWidth: 1.4, pointRadius: 0 },
    { label: 'Monte Carlo', data: simPts, borderColor: '#0891b2', borderWidth: 1.1, pointRadius: 3 },
  ];
  if (isFinite(curX)) bds.push({ label: 'actual', data: [{x:curX,y:Math.max(curY,1e-7)}], type:'scatter', backgroundColor:'#db2777', pointRadius:5, showLine:false });
  mkChart(grid, `BER · ${cur.nbits||''} bits por punto`, 'line', { datasets: bds },
    baseOpts('BER', 'Eb/N0 (dB)', 'BER', { scales:{ y:{ type:'logarithmic', min:1e-6, max:1, title:{display:true,text:'BER'} } } }),
    'BER simulada (Monte Carlo, AWGN limpio) vs teoría. Punto actual = configuración vigente (pérdidas/factores).');
  $('#globalInterp').innerHTML = `<b>Lectura ${scheme}:</b> BER=${Number(ber).toExponential(2)} (Eb/N0 ef. ${db(r.ebn0_eff_db)}). ${scheme==='FSK'?`h=${fmt(ex.h,3)}, Δf=${fmt((ex.df||0)/1e3,3)} kHz, BW≈${fmt((ex.bandwidth_hz||0)/1e3,3)} kHz.`:`Detector ${ex.detector||''}, portadora ${fmt((ex.fc||0)/1e3,4)} kHz.`} Atenuación total ${fmt(rep.total_atten_db,3)} dB.`;
}

function renderPCM(r) {
  const met = r.metrics || {};
  const ber = r.ber || 0;
  const qcol = r.sqnr_db >= (r.sqnr_quant_db - 3) ? 'var(--green)' : r.sqnr_db > 15 ? 'var(--amber)' : 'var(--red)';
  const bcol = ber === 0 ? 'var(--green)' : ber < 1e-2 ? 'var(--amber)' : 'var(--red)';
  setMetrics([
    { k: 'SQNR reconstrucción', v: `${fmt(r.sqnr_db,3)} dB`, h: `teoría ${fmt(r.sqnr_theory_db,3)} dB`, c: qcol },
    { k: 'SQNR cuantificación', v: `${fmt(r.sqnr_quant_db,3)} dB`, h: `q=${fmt((r.q||0)*1e3,3)} mV · ${met.levels||''} niveles`, c: '#0891b2' },
    { k: 'BER del enlace', v: Number(ber).toExponential(2), h: `${r.errors} / ${r.nbits_total} bits`, c: bcol },
    { k: 'Tasa de bits', v: `${fmt((met.bit_rate_bps||0)/1e3,3)} kbit/s`, h: `${met.samples||''} muestras · ${met.scheme||''}`, c: '#b45309' },
    { k: 'Eb/N0 efectiva', v: db(r.ebn0_eff_db), h: `pérdida ${fmt(met.total_atten_db,3)} dB`, c: '#db2777' },
  ]);
  const C = $('#charts'); destroyCharts(); C.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'chart-grid g32'; C.appendChild(grid);
  const sa = r.sample || {};
  mkChart(grid, 'Muestreo y cuantificación', 'line', { datasets: [
    { label: 'analógica', data: pts(sa.t_ms, sa.x), borderColor:'#334155', borderWidth:1.2, pointRadius:0 },
    { label: 'muestras cuantizadas', data: pts(sa.ts_ms, sa.xq), type:'scatter', backgroundColor:'#0891b2', pointRadius:2.5, showLine:false },
  ]}, baseOpts('Muestreo y cuantificación', 'tiempo (ms)', 'amplitud (V)'),
    'Señal muestreada a fs y redondeada a 2^n niveles. fs baja ⇒ aliasing; n bajo ⇒ escalón grande.');
  const qe = r.qerr || {};
  mkChart(grid, `Error de cuantificación · q=${fmt((r.q||0)*1e3,3)} mV`, 'line', { datasets: [
    { label: 'xq − x', data: pts(qe.ts_ms, qe.err_mv), borderColor:'#15803d', borderWidth:0.9, pointRadius:0 },
    { label: '+q/2', data: qe.ts_ms?.length?[{x:qe.ts_ms[0],y:qe.qhalf_mv},{x:qe.ts_ms[qe.ts_ms.length-1],y:qe.qhalf_mv}]:[], borderColor:'#94a3b8', borderWidth:0.8, borderDash:[4,3], pointRadius:0 },
    { label: '−q/2', data: qe.ts_ms?.length?[{x:qe.ts_ms[0],y:-qe.qhalf_mv},{x:qe.ts_ms[qe.ts_ms.length-1],y:-qe.qhalf_mv}]:[], borderColor:'#94a3b8', borderWidth:0.8, borderDash:[4,3], pointRadius:0 },
  ]}, baseOpts('Error de cuantificación', 'tiempo (ms)', 'error (mV)'),
    'Diferencia entre nivel cuantificado y muestra; idealmente acotada cerca de ±q/2.');
  const rec = r.rec || {};
  mkChart(grid, 'Reconstrucción', 'line', { datasets: [
    { label: 'original', data: pts(rec.t_ms, rec.x), borderColor:'#334155', borderWidth:1.4, pointRadius:0 },
    { label: 'ZOH', data: pts(rec.t_ms, rec.zoh), borderColor:'#94a3b8', borderWidth:1.0, pointRadius:0 },
    { label: 'reconstruida (sinc)', data: pts(rec.t_ms, rec.xrec), borderColor:'#c2410c', borderWidth:1.3, pointRadius:0 },
    { label: 'niveles', data: pts(rec.ts_ms, rec.xq), type:'scatter', backgroundColor:'#0891b2', pointRadius:2.2, showLine:false },
  ]}, baseOpts('Reconstrucción', 'tiempo (ms)', 'amplitud (V)'),
    'Original, ZOH (escalones, D/A real) y sinc (banda limitada). Saltos grandes sugieren errores de bit.');
  mkChart(grid, 'Espectro · muestreo y aliasing', 'line', { datasets: [
    { label: 'analógica', data: pts((r.spec_a||{}).f_khz,(r.spec_a||{}).db), borderColor:'#334155', borderWidth:1.0, pointRadius:0 },
    { label: 'muestreada', data: pts((r.spec_s||{}).f_khz,(r.spec_s||{}).db), borderColor:'#0891b2', borderWidth:1.0, pointRadius:0 },
  ]}, baseOpts('Espectro · muestreo y aliasing', 'frecuencia (kHz)', 'magnitud (dB)', { scales:{ x:{ type:'linear', max:r.xmax_khz, title:{display:true,text:'frecuencia (kHz)'} }, y:{ min:-90,max:3, title:{display:true,text:'magnitud (dB)'} } } }),
    `Nyquist = fs/2 = ${fmt(r.nyquist_khz,4)} kHz, fm = ${fmt(r.fm_khz,4)} kHz. ${r.alias?'¡Hay aliasing!':'Sin aliasing evidente.'}`);
  const bc = r.bits_curve || {};
  mkChart(grid, 'SQNR frente al número de bits', 'line', { datasets: [
    { label: 'teoría 6.02n+1.76', data: pts(bc.n_bits, bc.sqnr_theory_db), borderColor:'#64748b', borderWidth:1.3, pointRadius:0 },
    { label: 'cuantificación', data: pts(bc.n_bits, bc.sqnr_quant_db), borderColor:'#0891b2', borderWidth:1.1, pointRadius:3 },
    { label: 'reconstrucción', data: pts(bc.n_bits, bc.sqnr_rec_db), borderColor:'#15803d', borderWidth:1.0, pointRadius:3 },
    { label: 'actual', data: [{x:bc.current_n,y:bc.current_sqnr}], type:'scatter', backgroundColor:'#db2777', pointRadius:5, showLine:false },
  ]}, baseOpts('SQNR frente al número de bits', 'bits por muestra', 'SQNR (dB)'),
    'Más bits ⇒ menor q ⇒ mayor SQNR (~6 dB/bit). Reconstrucción puede diferir por canal/enlace.');
  const lc = r.link_curve || {};
  const lds = [
    { label: 'reconstrucción', data: pts(lc.ebn0_db, lc.sqnr_db), borderColor:'#15803d', borderWidth:1.2, pointRadius:3 },
  ];
  if (lc.ebn0_db?.length) lds.push({ label: 'límite de cuantificación', data: [{x:lc.ebn0_db[0],y:lc.quant_limit_db},{x:lc.ebn0_db[lc.ebn0_db.length-1],y:lc.quant_limit_db}], borderColor:'#0891b2', borderWidth:0.9, borderDash:[5,4], pointRadius:0 });
  if (isFinite(lc.current_ebn0)) lds.push({ label:'actual', data:[{x:lc.current_ebn0,y:lc.current_sqnr}], type:'scatter', backgroundColor:'#db2777', pointRadius:5, showLine:false });
  mkChart(grid, `Umbral del enlace PCM · ${met.scheme||''}`, 'line', { datasets: lds },
    baseOpts('Umbral del enlace PCM', 'Eb/N0 (dB)', 'SQNR reconstrucción (dB)'),
    'Efecto umbral: con Eb/N0 suficiente manda cuantificación; al caer, errores de bit dominan.');
  $('#globalInterp').innerHTML = `<b>Lectura PCM:</b> ${met.n_bits||''} bits, fs=${fmt(met.fs_sample,4)} Hz, Nyquist ${fmt(met.nyquist_hz,4)} Hz, Rb=${fmt((met.bit_rate_bps||0)/1e3,3)} kbit/s (${met.scheme||''}). SQNR cuant. ${fmt(r.sqnr_quant_db,2)} dB, rec. ${fmt(r.sqnr_db,2)} dB (teoría ${fmt(r.sqnr_theory_db,2)} dB). BER=${Number(ber).toExponential(2)}. ${r.sqnr_db < r.sqnr_quant_db - 8 ? 'Predominan errores de bit (umbral).' : 'Predomina cuantización/muestreo.'}`;
}

function render(module, r) {
  if (!r || !r.ok) {
    destroyCharts(); $('#charts').innerHTML = ''; $('#metrics').innerHTML = '';
    setStatus(`Error: ${r?.error || 'resultado inválido'}`, 'err');
    $('#globalInterp').innerHTML = `<b style="color:var(--red)">Error:</b> ${r?.error || '—'}`;
    return;
  }
  if (module === 'am') renderAM(r);
  else if (module === 'ask') renderASK(r);
  else if (module === 'fsk') renderFSK(r);
  else if (module === 'pcm') renderPCM(r);
  setStatus('Simulación completada (motor Python/NumPy/SciPy).', '');
}

// ---------- Module/UI wiring ----------
function renderModule(name) {
  state.module = name;
  const info = INFO[name];
  $('#simTitle').textContent = info.title; $('#simDesc').textContent = info.desc; $('#moduleSelect').value = name;
  $('#controls').innerHTML = SCHEMAS[name]();
  bindChannel();
  $('#globalInterp').innerHTML = 'Pulsa <b>Simular</b> para ejecutar el motor Python y generar todas las gráficas.';
  destroyCharts(); $('#charts').innerHTML = ''; $('#metrics').innerHTML = '';
  if (state.ready) setStatus('Listo. Ajusta parámetros y pulsa Simular.');
}

function setEnabled(on) {
  $('#moduleSelect').disabled = !on; $('#runBtn').disabled = !on; $('#resetBtn').disabled = !on;
}

function requestRun() {
  if (!state.ready || !state.worker) { setStatus('El motor aún no está listo.', 'busy'); return; }
  const id = ++state.reqId;
  const params = collectParams();
  setStatus('Calculando simulación y curvas (Monte Carlo) con el motor Python…', 'busy');
  $('#runBtn').disabled = true;
  state.worker.postMessage({ type: 'run', id, module: state.module, params });
}

// ---------- Boot worker ----------
function startWorker() {
  try {
    state.worker = new Worker('pyodide-worker.js');
  } catch (e) {
    $('#bootTitle').textContent = 'No se pudo iniciar el worker';
    $('#bootMsg').textContent = e.message; $('#bootSpin').style.display = 'none'; $('#bootRetry').style.display = ''; return;
  }
  const baseUrl = new URL('./', window.location.href).href;
  state.worker.onmessage = (ev) => {
    const d = ev.data || {};
    if (d.type === 'status') bootProgress(d.msg, d.pct);
    else if (d.type === 'ready') {
      state.ready = true;
      bootProgress('Motor listo.', 100);
      setTimeout(() => $('#bootCard').classList.add('hidden'), 400);
      setEnabled(true); setStatus('Motor Python listo. Ajusta parámetros y pulsa Simular.');
      // auto-run first view
      requestRun();
    } else if (d.type === 'error') {
      $('#bootTitle').textContent = 'Error cargando el motor';
      $('#bootMsg').textContent = d.msg || 'Error desconocido';
      $('#bootSpin').style.display = 'none'; $('#bootRetry').style.display = '';
      setStatus('Error al cargar el motor de simulación.', 'err');
    } else if (d.type === 'run-status') {
      setStatus(d.msg || 'Calculando…', 'busy');
    } else if (d.type === 'result') {
      $('#runBtn').disabled = false;
      if (d.id !== state.reqId) return; // stale
      state.last = d.result;
      render(d.module || state.module, d.result);
    }
  };
  state.worker.onerror = (e) => {
    $('#bootTitle').textContent = 'Error en worker';
    $('#bootMsg').textContent = e.message || String(e);
    $('#bootSpin').style.display = 'none'; $('#bootRetry').style.display = '';
  };
  state.worker.postMessage({ type: 'init', baseUrl });
}

$('#moduleSelect').addEventListener('change', e => renderModule(e.target.value));
$('#runBtn').addEventListener('click', requestRun);
$('#resetBtn').addEventListener('click', () => renderModule(state.module));
$('#bootRetry').addEventListener('click', () => { $('#bootRetry').style.display='none'; $('#bootSpin').style.display=''; $('#bootTitle').textContent='Cargando motor de simulación…'; startWorker(); });
$$('.module-card').forEach(c => c.addEventListener('click', () => { renderModule(c.dataset.target); location.hash = '#simulador'; }));

renderModule('am');
startWorker();
