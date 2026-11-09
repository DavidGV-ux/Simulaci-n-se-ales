/**
 * signal_generator.js
 * Biblioteca de DSP, generación de señales, filtrado, FFT y matemáticas en ES6.
 */

export function timeVector(fs, duration, start = 0.0) {
    if (fs <= 0 || duration <= 0) {
        throw new Error("fs y duration deben ser positivos");
    }
    const n = Math.max(1, Math.round(fs * duration));
    const t = new Float64Array(n);
    const dt = 1.0 / fs;
    for (let i = 0; i < n; i++) {
        t[i] = start + i * dt;
    }
    return t;
}

export function zeroMean(x) {
    const n = x.length;
    if (n === 0) return new Float64Array(0);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += x[i];
    const mean = sum / n;
    const res = new Float64Array(n);
    for (let i = 0; i < n; i++) res[i] = x[i] - mean;
    return res;
}

export function generateWaveform(kind, t, options = {}) {
    const {
        amplitude = 1.0,
        frequency = 1000.0,
        phaseDeg = 0.0,
        duty = 0.5,
        fEnd = null,
        formula = null,
        csvT = null,
        csvX = null,
        normalize = true,
        removeDC = true,
    } = options;

    const n = t.length;
    if (n < 2) throw new Error("t debe tener al menos dos muestras");
    const phaseRad = (phaseDeg * Math.PI) / 180.0;
    const twoPiF = 2.0 * Math.PI * frequency;
    let x = new Float64Array(n);
    const k = kind.toLowerCase().trim();

    if (k === "sine") {
        for (let i = 0; i < n; i++) {
            x[i] = amplitude * Math.sin(twoPiF * t[i] + phaseRad);
        }
    } else if (k === "square") {
        for (let i = 0; i < n; i++) {
            const frac = ((frequency * t[i] + phaseDeg / 360.0) % 1.0 + 1.0) % 1.0;
            x[i] = frac < duty ? amplitude : -amplitude;
        }
    } else if (k === "triangle") {
        for (let i = 0; i < n; i++) {
            const w = twoPiF * t[i] + phaseRad;
            x[i] = amplitude * (2.0 / Math.PI) * Math.asin(Math.sin(w));
        }
    } else if (k === "sawtooth") {
        for (let i = 0; i < n; i++) {
            const frac = ((frequency * t[i] + phaseDeg / 360.0) % 1.0 + 1.0) % 1.0;
            x[i] = amplitude * (2.0 * frac - 1.0);
        }
    } else if (k === "chirp") {
        const f1 = fEnd !== null && fEnd !== undefined ? fEnd : Math.max(frequency * 2.0, frequency + 1.0);
        const duration = Math.max(t[n - 1] - t[0], 1e-12);
        const chirpRate = (f1 - frequency) / duration;
        for (let i = 0; i < n; i++) {
            const ti = t[i];
            const phase = 2.0 * Math.PI * (frequency * ti + 0.5 * chirpRate * ti * ti) + phaseRad;
            x[i] = amplitude * Math.sin(phase);
        }
    } else if (k === "two_tone") {
        for (let i = 0; i < n; i++) {
            const w1 = twoPiF * t[i] + phaseRad;
            const w2 = 2.0 * Math.PI * 3.0 * frequency * t[i] + phaseRad / 2.0;
            x[i] = amplitude * (0.62 * Math.sin(w1) + 0.38 * Math.sin(w2));
        }
    } else if (k === "formula") {
        if (!formula) throw new Error("Fórmula personalizada vacía");
        const raw = safeEvalSignal(formula, t);
        for (let i = 0; i < n; i++) x[i] = amplitude * raw[i];
    } else if (k === "csv") {
        if (!csvT || !csvX || csvT.length < 2) {
            throw new Error("No hay datos CSV cargados");
        }
        x = interpLinear(t, csvT, csvX);
        for (let i = 0; i < n; i++) x[i] *= amplitude;
    } else {
        throw new Error(`Forma de onda desconocida: ${kind}`);
    }

    if (removeDC) {
        x = zeroMean(x);
    }
    if (normalize) {
        let maxAbs = 0;
        for (let i = 0; i < n; i++) {
            const a = Math.abs(x[i]);
            if (a > maxAbs) maxAbs = a;
        }
        if (maxAbs > 1e-12) {
            const inv = 1.0 / maxAbs;
            for (let i = 0; i < n; i++) x[i] *= inv;
        }
    }
    return x;
}

// ---------------------------------------------------------------------------
// Evaluador Seguro de Fórmulas Matemáticas
// ---------------------------------------------------------------------------
export function safeEvalSignal(expr, t) {
    if (typeof expr !== "string" || expr.length > 600) {
        throw new Error("Fórmula inválida o demasiado larga (máx. 600 caracteres)");
    }
    const sanitized = expr.replace(/\s+/g, "");
    if (!sanitized) throw new Error("Fórmula vacía");

    // Tokens parser
    const tokens = tokenize(sanitized);
    let pos = 0;

    function peek() {
        return tokens[pos] || null;
    }
    function consume(expected) {
        const tok = tokens[pos];
        if (!tok || (expected && tok.value !== expected)) {
            throw new Error(`Error de sintaxis: se esperaba '${expected || "token"}' cerca de '${tok ? tok.value : "fin"}'`);
        }
        pos++;
        return tok;
    }

    // Grammar:
    // expr   -> term (( '+' | '-' ) term)*
    // term   -> power (( '*' | '/' | '%' ) power)*
    // power  -> unary ( '^' unary )*
    // unary  -> ('+' | '-')* primary
    // primary-> NUMBER | 't' | 'pi' | 'e' | 'tau' | FUNC '(' args ')' | '(' expr ')'

    function parseExpr() {
        let node = parseTerm();
        while (peek() && (peek().value === "+" || peek().value === "-")) {
            const op = consume().value;
            const right = parseTerm();
            node = { type: "Binary", op, left: node, right };
        }
        return node;
    }

    function parseTerm() {
        let node = parsePower();
        while (peek() && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
            const op = consume().value;
            const right = parsePower();
            node = { type: "Binary", op, left: node, right };
        }
        return node;
    }

    function parsePower() {
        let node = parseUnary();
        if (peek() && peek().value === "^") {
            consume("^");
            const right = parsePower(); // right-associative
            node = { type: "Binary", op: "^", left: node, right };
        }
        return node;
    }

    function parseUnary() {
        if (peek() && (peek().value === "+" || peek().value === "-")) {
            const op = consume().value;
            const arg = parseUnary();
            return { type: "Unary", op, arg };
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const tok = peek();
        if (!tok) throw new Error("Expresión incompleta");

        if (tok.type === "NUMBER") {
            consume();
            return { type: "Number", val: parseFloat(tok.value) };
        }
        if (tok.type === "IDENT") {
            consume();
            const id = tok.value.toLowerCase();
            if (id === "t") return { type: "Var", name: "t" };
            if (id === "pi") return { type: "Number", val: Math.PI };
            if (id === "e") return { type: "Number", val: Math.E };
            if (id === "tau") return { type: "Number", val: 2.0 * Math.PI };

            // Function call
            if (peek() && peek().value === "(") {
                consume("(");
                const args = [];
                if (peek() && peek().value !== ")") {
                    args.push(parseExpr());
                    while (peek() && peek().value === ",") {
                        consume(",");
                        args.push(parseExpr());
                    }
                }
                consume(")");
                return { type: "Call", func: id, args };
            }
            throw new Error(`Identificador desconocido: '${id}'`);
        }
        if (tok.value === "(") {
            consume("(");
            const inside = parseExpr();
            consume(")");
            return inside;
        }
        throw new Error(`Token inesperado: '${tok.value}'`);
    }

    const ast = parseExpr();
    if (pos < tokens.length) {
        throw new Error(`Tokens adicionales no reconocidos: '${tokens[pos].value}'`);
    }

    const n = t.length;
    const res = new Float64Array(n);

    // Vectorized evaluator for speed
    function evalNode(node, i, ti) {
        switch (node.type) {
            case "Number": return node.val;
            case "Var": return ti;
            case "Unary": {
                const v = evalNode(node.arg, i, ti);
                return node.op === "-" ? -v : v;
            }
            case "Binary": {
                const left = evalNode(node.left, i, ti);
                const right = evalNode(node.right, i, ti);
                switch (node.op) {
                    case "+": return left + right;
                    case "-": return left - right;
                    case "*": return left * right;
                    case "/": return right === 0 ? 0 : left / right;
                    case "%": return right === 0 ? 0 : left % right;
                    case "^": return Math.pow(left, right);
                    default: return 0;
                }
            }
            case "Call": {
                const fn = node.func;
                const evaluatedArgs = node.args.map(a => evalNode(a, i, ti));
                switch (fn) {
                    case "sin": return Math.sin(evaluatedArgs[0]);
                    case "cos": return Math.cos(evaluatedArgs[0]);
                    case "tan": return Math.tan(evaluatedArgs[0]);
                    case "arcsin":
                    case "asin": return Math.asin(Math.max(-1, Math.min(1, evaluatedArgs[0])));
                    case "arccos":
                    case "acos": return Math.acos(Math.max(-1, Math.min(1, evaluatedArgs[0])));
                    case "arctan":
                    case "atan": return Math.atan(evaluatedArgs[0]);
                    case "exp": return Math.exp(evaluatedArgs[0]);
                    case "log":
                    case "ln": return Math.log(Math.max(1e-30, evaluatedArgs[0]));
                    case "log10": return Math.log10(Math.max(1e-30, evaluatedArgs[0]));
                    case "sqrt": return Math.sqrt(Math.max(0, evaluatedArgs[0]));
                    case "abs": return Math.abs(evaluatedArgs[0]);
                    case "sign": return Math.sign(evaluatedArgs[0]);
                    case "floor": return Math.floor(evaluatedArgs[0]);
                    case "ceil": return Math.ceil(evaluatedArgs[0]);
                    case "round": return Math.round(evaluatedArgs[0]);
                    case "heaviside": return evaluatedArgs[0] >= 0 ? 1 : 0;
                    case "where": return evaluatedArgs[0] > 0 ? evaluatedArgs[1] : evaluatedArgs[2];
                    case "min":
                    case "minimum": return Math.min(evaluatedArgs[0], evaluatedArgs[1]);
                    case "max":
                    case "maximum": return Math.max(evaluatedArgs[0], evaluatedArgs[1]);
                    case "clip": return Math.min(evaluatedArgs[2], Math.max(evaluatedArgs[1], evaluatedArgs[0]));
                    default: throw new Error(`Función desconocida: '${fn}'`);
                }
            }
            default: return 0;
        }
    }

    for (let i = 0; i < n; i++) {
        const val = evalNode(ast, i, t[i]);
        res[i] = isFinite(val) ? val : 0.0;
    }
    return res;
}

function tokenize(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        const ch = str[i];
        if (/[0-9.]/.test(ch)) {
            let numStr = "";
            let dotCount = 0;
            while (i < str.length && /[0-9.]/.test(str[i])) {
                if (str[i] === ".") {
                    dotCount++;
                    if (dotCount > 1) break;
                }
                numStr += str[i];
                i++;
            }
            tokens.push({ type: "NUMBER", value: numStr });
            continue;
        }
        if (/[a-zA-Z_]/.test(ch)) {
            let idStr = "";
            while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
                idStr += str[i];
                i++;
            }
            tokens.push({ type: "IDENT", value: idStr });
            continue;
        }
        if ("+-*/%^(),".includes(ch)) {
            tokens.push({ type: "OP", value: ch });
            i++;
            continue;
        }
        i++;
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// CSV Parsing & Interpolación Lineal
// ---------------------------------------------------------------------------
export function parseCSV(rawText) {
    const lines = rawText.split(/\r?\n/);
    const rows = [];
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;
        line = line.replace(/;/g, ",");
        let parts = line.split(",").map(p => p.trim()).filter(Boolean);
        if (parts.length === 1) {
            parts = line.split(/\s+/).filter(Boolean);
        }
        const vals = parts.map(v => parseFloat(v.replace(",", "."))).filter(v => !isNaN(v));
        if (vals.length >= 2) {
            rows.push([vals[0], vals[1]]);
        } else if (vals.length === 1) {
            rows.push([rows.length, vals[0]]);
        }
    }
    if (rows.length < 3) throw new Error("El archivo CSV debe tener al menos 3 filas numéricas");

    rows.sort((a, b) => a[0] - b[0]);
    // Eliminar tiempos duplicados
    const cleanT = [rows[0][0]];
    const cleanX = [rows[0][1]];
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] > cleanT[cleanT.length - 1]) {
            cleanT.push(rows[i][0]);
            cleanX.push(rows[i][1]);
        }
    }
    return {
        t: new Float64Array(cleanT),
        x: new Float64Array(cleanX),
        count: cleanT.length,
    };
}

export function interpLinear(tTarget, tSource, xSource) {
    const n = tTarget.length;
    const m = tSource.length;
    const out = new Float64Array(n);
    let srcIdx = 0;
    const tMin = tSource[0];
    const tMax = tSource[m - 1];

    for (let i = 0; i < n; i++) {
        const ti = tTarget[i];
        if (ti <= tMin) {
            out[i] = xSource[0];
            continue;
        }
        if (ti >= tMax) {
            out[i] = xSource[m - 1];
            continue;
        }
        while (srcIdx < m - 2 && tSource[srcIdx + 1] < ti) {
            srcIdx++;
        }
        const t0 = tSource[srcIdx];
        const t1 = tSource[srcIdx + 1];
        const x0 = xSource[srcIdx];
        const x1 = xSource[srcIdx + 1];
        const frac = (ti - t0) / (t1 - t0);
        out[i] = x0 + frac * (x1 - x0);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Cuantificación y Codificación PCM
// ---------------------------------------------------------------------------
export function quantizeUniform(x, nBits, fullScale = 1.0) {
    if (nBits < 2 || nBits > 16) throw new Error("nBits debe estar entre 2 y 16");
    if (fullScale <= 0) throw new Error("fullScale debe ser positivo");
    const n = x.length;
    const levels = 1 << nBits;
    const q = (2.0 * fullScale) / levels;
    const xq = new Float64Array(n);
    const idx = new Int32Array(n);
    const qerr = new Float64Array(n);

    for (let i = 0; i < n; i++) {
        let code = Math.floor((x[i] + fullScale) / q);
        if (code < 0) code = 0;
        else if (code >= levels) code = levels - 1;
        idx[i] = code;
        const quantized = -fullScale + (code + 0.5) * q;
        xq[i] = quantized;
        qerr[i] = quantized - x[i];
    }
    return { xq, idx, q, qerr, levels };
}

export function pcmEncode(x, nBits, fullScale = 1.0) {
    const { xq, idx, q, qerr, levels } = quantizeUniform(x, nBits, fullScale);
    const nSamples = idx.length;
    const totalBits = nSamples * nBits;
    const bits = new Uint8Array(totalBits);

    let bitIdx = 0;
    for (let i = 0; i < nSamples; i++) {
        const val = idx[i];
        for (let shift = nBits - 1; shift >= 0; shift--) {
            bits[bitIdx++] = (val >> shift) & 1;
        }
    }
    return { bits, idx, xq, q, qerr, levels, nSamples };
}

export function pcmDecode(bits, nBits, fullScale = 1.0) {
    const totalBits = bits.length;
    const nSamples = Math.floor(totalBits / nBits);
    const levels = 1 << nBits;
    const q = (2.0 * fullScale) / levels;
    const idx = new Int32Array(nSamples);
    const xq = new Float64Array(nSamples);

    let bitIdx = 0;
    for (let i = 0; i < nSamples; i++) {
        let code = 0;
        for (let shift = nBits - 1; shift >= 0; shift--) {
            code = (code << 1) | (bits[bitIdx++] & 1);
        }
        idx[i] = code;
        xq[i] = -fullScale + (code + 0.5) * q;
    }
    return { xq, idx, q, levels };
}

export function zeroOrderHold(xs, ts, tOut) {
    const nOut = tOut.length;
    const nIn = xs.length;
    if (nIn === 0) return new Float64Array(nOut);
    const dt = ts[1] - ts[0];
    const t0 = ts[0];
    const out = new Float64Array(nOut);
    for (let i = 0; i < nOut; i++) {
        let idx = Math.floor((tOut[i] - t0) / dt);
        if (idx < 0) idx = 0;
        else if (idx >= nIn) idx = nIn - 1;
        out[i] = xs[idx];
    }
    return out;
}

export function sincInterp(x, tIn, tOut, half = 24) {
    const nIn = x.length;
    const nOut = tOut.length;
    if (nIn < 2) {
        const out = new Float64Array(nOut);
        out.fill(nIn > 0 ? x[0] : 0.0);
        return out;
    }
    const dt = tIn[1] - tIn[0];
    const t0 = tIn[0];
    const out = new Float64Array(nOut);

    // Windowed sinc with Blackman window
    const halfWin = Math.max(4, Math.floor(half));
    for (let i = 0; i < nOut; i++) {
        const u = (tOut[i] - t0) / dt;
        const i0 = Math.floor(u);
        let sum = 0.0;
        let wsum = 0.0;
        for (let k = -halfWin + 1; k <= halfWin; k++) {
            const idx = i0 + k;
            let val;
            if (idx < 0) val = x[Math.min(nIn - 1, -idx)];
            else if (idx >= nIn) val = x[Math.max(0, 2 * nIn - 2 - idx)];
            else val = x[idx];

            const arg = u - idx;
            const piArg = Math.PI * arg;
            const sincVal = Math.abs(arg) < 1e-9 ? 1.0 : Math.sin(piArg) / piArg;
            // Blackman-like window
            const win = 0.54 - 0.46 * Math.cos((Math.PI * (arg + halfWin)) / halfWin);
            const kernel = sincVal * win;
            sum += val * kernel;
            wsum += kernel;
        }
        out[i] = Math.abs(wsum) > 1e-12 ? sum / wsum : sum;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Filtros Digitales (Butterworth IIR Fase Cero / filtfilt)
// ---------------------------------------------------------------------------
export function butterworthLowpassFilter(x, fs, cutoff, order = 4) {
    const n = x.length;
    if (n <= 8) return new Float64Array(x);
    const nyq = fs * 0.5;
    const normCutoff = Math.max(1e-5, Math.min(0.49, cutoff / nyq));

    // Descomposición en biquads (secciones de segundo orden)
    // Para orden 4, son 2 biquads.
    const biquads = getButterworthBiquads(order, normCutoff);
    let y = new Float64Array(x);

    // Forward pass
    for (let bq of biquads) {
        y = filterBiquad(bq, y);
    }
    // Reverse
    y.reverse();
    // Backward pass
    for (let bq of biquads) {
        y = filterBiquad(bq, y);
    }
    // Reverse back
    y.reverse();
    return y;
}

function getButterworthBiquads(order, normCutoff) {
    const biquads = [];
    const nPairs = Math.floor(order / 2);
    const omega = Math.tan((Math.PI * normCutoff) / 2.0);
    const omega2 = omega * omega;

    for (let k = 0; k < nPairs; k++) {
        const theta = (Math.PI * (2 * k + 1)) / (2 * order);
        const alpha = 2.0 * Math.cos(theta);
        const a0 = 1.0 + alpha * omega + omega2;
        const b0 = omega2 / a0;
        const b1 = (2.0 * omega2) / a0;
        const b2 = omega2 / a0;
        const a1 = (2.0 * (omega2 - 1.0)) / a0;
        const a2 = (1.0 - alpha * omega + omega2) / a0;
        biquads.push({ b0, b1, b2, a1, a2 });
    }
    return biquads;
}

function filterBiquad(bq, x) {
    const n = x.length;
    const y = new Float64Array(n);
    let w1 = 0.0;
    let w2 = 0.0;
    for (let i = 0; i < n; i++) {
        const xi = x[i];
        const w0 = xi - bq.a1 * w1 - bq.a2 * w2;
        y[i] = bq.b0 * w0 + bq.b1 * w1 + bq.b2 * w2;
        w2 = w1;
        w1 = w0;
    }
    return y;
}

export function antiAliasFilter(x, fsAnalog, fsSample, order = 6) {
    return butterworthLowpassFilter(x, fsAnalog, 0.45 * fsSample, order);
}

// ---------------------------------------------------------------------------
// FFT y Espectro en dB
// ---------------------------------------------------------------------------
function nextPowerOf2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

export function rfft(x, nfft = null) {
    const n = x.length;
    const N = nfft ? Math.max(nextPowerOf2(n), nfft) : nextPowerOf2(n);
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    real.set(x);

    // Cooley-Tukey Radix-2 In-place FFT
    bitReverse(real, imag, N);
    for (let len = 2; len <= N; len <<= 1) {
        const halfLen = len >> 1;
        const angle = (-2.0 * Math.PI) / len;
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
    const outLen = (N >> 1) + 1;
    return {
        real: real.subarray(0, outLen),
        imag: imag.subarray(0, outLen),
        N,
    };
}

function bitReverse(real, imag, N) {
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

export function spectrum(x, fs, options = {}) {
    const { nfft = null, window = "hann", dB = true, normalize = true } = options;
    const n = x.length;
    if (n < 4) throw new Error("La señal es demasiado corta para calcular el espectro");

    // Aplicar ventana
    const xw = zeroMean(x);
    if (window === "hann") {
        const factor = (2.0 * Math.PI) / (n - 1);
        for (let i = 0; i < n; i++) {
            xw[i] *= 0.5 * (1.0 - Math.cos(i * factor));
        }
    }

    const { real, imag, N } = rfft(xw, nfft);
    const nBins = real.length;
    const mag = new Float64Array(nBins);
    const f = new Float64Array(nBins);
    const df = fs / N;

    let peak = 0.0;
    for (let i = 0; i < nBins; i++) {
        f[i] = i * df;
        const m = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        mag[i] = m;
        if (m > peak) peak = m;
    }

    if (normalize && peak > 0) {
        const invPeak = 1.0 / peak;
        for (let i = 0; i < nBins; i++) mag[i] *= invPeak;
    }

    if (dB) {
        for (let i = 0; i < nBins; i++) {
            const val = Math.max(mag[i], 1e-12);
            mag[i] = 20.0 * Math.log10(val);
        }
    }
    return { f, mag };
}

// ---------------------------------------------------------------------------
// Transformada de Hilbert y Señal Analítica
// ---------------------------------------------------------------------------
export function hilbert(x) {
    const n = x.length;
    const N = nextPowerOf2(n);
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    real.set(x);

    // Forward FFT
    bitReverse(real, imag, N);
    fftCore(real, imag, N, -1);

    // Multiplicar por H(f): 1 en DC y Nyquist, 2 en positivas, 0 en negativas
    const half = N >> 1;
    for (let i = 1; i < half; i++) {
        real[i] *= 2.0;
        imag[i] *= 2.0;
    }
    for (let i = half + 1; i < N; i++) {
        real[i] = 0.0;
        imag[i] = 0.0;
    }

    // Inverse FFT
    bitReverse(real, imag, N);
    fftCore(real, imag, N, 1);
    const invN = 1.0 / N;
    for (let i = 0; i < N; i++) {
        real[i] *= invN;
        imag[i] *= invN;
    }

    const outReal = real.subarray(0, n);
    const outImag = imag.subarray(0, n);
    const envelope = new Float64Array(n);
    const phase = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const r = outReal[i];
        const im = outImag[i];
        envelope[i] = Math.sqrt(r * r + im * im);
        phase[i] = Math.atan2(im, r);
    }
    return { real: outReal, imag: outImag, envelope, phase };
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
// Métricas Estadísticas
// ---------------------------------------------------------------------------
export function rms(x) {
    const n = x.length;
    if (n === 0) return 0.0;
    let sumSq = 0.0;
    for (let i = 0; i < n; i++) sumSq += x[i] * x[i];
    return Math.sqrt(sumSq / n);
}

export function powerDb(x) {
    const r = rms(x);
    const p = r * r;
    return 10.0 * Math.log10(Math.max(p, 1e-30));
}

export function mse(ref, test, trim = 0) {
    const n = ref.length;
    const start = Math.min(trim, Math.floor(n / 4));
    const end = n - start;
    if (end <= start) return 0.0;
    let sum = 0.0;
    let count = 0;
    for (let i = start; i < end; i++) {
        const diff = ref[i] - test[i];
        sum += diff * diff;
        count++;
    }
    return count > 0 ? sum / count : 0.0;
}

export function correlation(ref, test, trim = 0) {
    const n = ref.length;
    const start = Math.min(trim, Math.floor(n / 4));
    const end = n - start;
    const len = end - start;
    if (len < 2) return 0.0;

    let sumA = 0, sumB = 0;
    for (let i = start; i < end; i++) {
        sumA += ref[i];
        sumB += test[i];
    }
    const meanA = sumA / len;
    const meanB = sumB / len;

    let num = 0, denA = 0, denB = 0;
    for (let i = start; i < end; i++) {
        const da = ref[i] - meanA;
        const db = test[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    return den < 1e-15 ? 0.0 : num / den;
}

export function signalBandwidth(x, fs, thresholdDb = -20.0, maxFraction = 0.5) {
    const { f, mag } = spectrum(x, fs, { dB: true, normalize: true });
    let lastIdx = 0;
    for (let i = 0; i < mag.length; i++) {
        if (mag[i] >= thresholdDb) lastIdx = i;
    }
    return Math.min(f[lastIdx], maxFraction * fs);
}

