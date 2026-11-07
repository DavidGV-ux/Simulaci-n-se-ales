/* Pyodide worker: runs the real comms_app.core simulations off the main thread. */
importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');

const CORE_FILES = ['__init__.py', 'analog.py', 'analysis.py', 'channel.py', 'digital.py', 'pcm.py', 'signals.py'];

async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`No se pudo cargar ${url}: ${r.status}`);
  return await r.text();
}

function post(type, payload) { self.postMessage(Object.assign({ type }, payload || {})); }

async function init(baseUrl) {
  post('status', { msg: 'Cargando Pyodide…', pct: 5 });
  const pyodide = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'
  });
  post('status', { msg: 'Cargando NumPy y SciPy… (puede tardar la primera vez)', pct: 20 });
  await pyodide.loadPackage(['numpy', 'scipy']);
  post('status', { msg: 'Cargando núcleo comms_app.core…', pct: 75 });
  const fs = pyodide.FS;
  const mk = (p) => { try { fs.mkdir(p); } catch (_) {} };
  mk('/sim'); mk('/sim/comms_app'); mk('/sim/comms_app/core');
  fs.writeFile('/sim/comms_app/__init__.py', await fetchText(baseUrl + 'py/comms_app/__init__.py'));
  for (const f of CORE_FILES) {
    fs.writeFile('/sim/comms_app/core/' + f, await fetchText(baseUrl + 'py/comms_app/core/' + f));
  }
  fs.writeFile('/sim/bridge.py', await fetchText(baseUrl + 'py/bridge.py'));
  post('status', { msg: 'Inicializando módulos Python…', pct: 92 });
  await pyodide.runPythonAsync(`
import sys
if '/sim' not in sys.path:
    sys.path.insert(0, '/sim')
import bridge
`);
  post('ready', { msg: 'Motor listo.', pct: 100 });
  self._pyodide = pyodide;
}

self.onmessage = async (ev) => {
  const d = ev.data || {};
  try {
    if (d.type === 'init') {
      await init(d.baseUrl || './');
    } else if (d.type === 'run') {
      if (!self._pyodide) throw new Error('Motor no inicializado');
      post('run-status', { id: d.id, msg: 'Ejecutando simulación y curvas…' });
      const mod = JSON.stringify(d.module || '');
      const params = JSON.stringify(d.params || {});
      // Use runPythonAsync in case; bridge.run is sync but keeps worker message loop sane.
      const code = `bridge.run(${mod}, ${JSON.stringify(d.params || {})})`;
      // Avoid quoting issues: pass via globals
      self._pyodide.globals.set('_req_mod', d.module || '');
      self._pyodide.globals.set('_req_params', JSON.stringify(d.params || {}));
      const out = await self._pyodide.runPythonAsync('bridge.run(_req_mod, _req_params)');
      const result = JSON.parse(out);
      post('result', { id: d.id, module: d.module, result });
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (d.type === 'init') post('error', { msg });
    else post('result', { id: d.id, module: d.module, result: { ok: false, error: msg } });
  }
};
