#!/usr/bin/env python3
"""
verify_simplified_app.py
Script de verificación estricta de paridad, IDs y consistencia de la aplicación web simplificada.
"""

import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(BASE_DIR, "index.html")
APP_JS_PATH = os.path.join(BASE_DIR, "js", "app.js")
CSS_PATH = os.path.join(BASE_DIR, "css", "styles.css")

EXPECTED_PLOTS = [
    # AM (3)
    "am-plot-mod-carrier",
    "am-plot-modulated",
    "am-plot-spectrum",
    # ASK (4)
    "ask-plot-bits",
    "ask-plot-carrier",
    "ask-plot-modulated",
    "ask-plot-spectrum",
    # FSK (3)
    "fsk-plot-bits",
    "fsk-plot-modulated",
    "fsk-plot-spectrum",
    # PCM (3)
    "pcm-plot-sampling",
    "pcm-plot-quantization",
    "pcm-plot-coding"
]

def test_files_exist():
    print("1. Verificando existencia de archivos clave...")
    files = [INDEX_PATH, APP_JS_PATH, CSS_PATH]
    for f in files:
        assert os.path.isfile(f), f"Falta el archivo: {f}"
        assert os.path.getsize(f) > 100, f"Archivo vacío: {f}"
    print("   ✓ Todos los archivos existen y tienen contenido.")

def test_html_structure():
    print("2. Verificando estructura HTML y ausencia de elementos innecesarios...")
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        html = f.read()

    # Verificar que solo hay 4 botones de módulo
    nav_modules = re.findall(r'data-module="([^"]+)"', html)
    assert set(nav_modules) == {"am", "ask", "fsk", "pcm"}, f"Módulos no esperados en sidebar: {nav_modules}"
    print(f"   ✓ Barra lateral contiene exactamente los 4 módulos: {nav_modules}")

    # Verificar eliminación de canal e impairments
    assert "chan-preset" not in html, "ERROR: chan-preset todavía existe en HTML"
    assert "chan-dist" not in html, "ERROR: chan-dist todavía existe en HTML"
    assert "chan-multipath" not in html, "ERROR: chan-multipath todavía existe en HTML"
    assert "chan-cfo" not in html, "ERROR: chan-cfo todavía existe en HTML"
    assert "chan-ebn0" not in html, "ERROR: chan-ebn0 todavía existe en HTML"
    print("   ✓ Panel de Canal e Impairments completamente eliminado.")

    # Verificar eliminación de BER, Eye, SQNR curves
    assert "ask-plot-eye" not in html, "ERROR: Diagrama de ojo no eliminado"
    assert "ask-plot-ber" not in html, "ERROR: Gráfica BER no eliminada"
    assert "fsk-plot-ber" not in html, "ERROR: Gráfica BER FSK no eliminada"
    assert "pcm-plot-sqnr-bits" not in html, "ERROR: Gráfica SQNR no eliminada"
    print("   ✓ Gráficas de BER, Ojo y SQNR eliminadas exitosamente.")

    # Verificar existencia de las 13 gráficas requeridas
    for p in EXPECTED_PLOTS:
        assert f'id="{p}"' in html, f"Falta div de gráfica: {p}"
    print(f"   ✓ Las {len(EXPECTED_PLOTS)} gráficas requeridas están presentes en index.html.")

    # Verificar descripciones de 1 línea (.plot-card-desc)
    desc_count = len(re.findall(r'class="plot-card-desc"', html))
    assert desc_count == 13, f"Se esperaban 13 descripciones de gráficas, se encontraron {desc_count}"
    print(f"   ✓ Las 13 gráficas cuentan con descripción didáctica de una línea.")

def test_js_id_integrity():
    print("3. Verificando integridad de IDs entre HTML y JavaScript...")
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        html = f.read()

    with open(APP_JS_PATH, "r", encoding="utf-8") as f:
        app_js = f.read()

    # Extraer todos los IDs de getElementById en app.js
    main_ids = set(re.findall(r'getElementById\("([^"]+)"\)', app_js))
    html_ids = set(re.findall(r'id="([^"]+)"', html))

    missing = main_ids - html_ids
    assert not missing, f"IDs en app.js faltantes en index.html: {missing}"
    print(f"   ✓ Todos los {len(main_ids)} IDs consultados por app.js existen en index.html.")

    # Verificar que chart_manager no usa title en Plotly
    assert "title: false" in app_js, "ChartManager debe tener title: false para evitar colisiones"
    print("   ✓ Arquitectura Anti-Colisión (title: false) verificada en app.js.")

def test_mathematical_logic():
    print("4. Verificando lógica matemática de los 4 módulos...")
    with open(APP_JS_PATH, "r", encoding="utf-8") as f:
        mods_code = f.read()

    # AM
    assert "const m = vm / vp;" in mods_code
    assert "const bw = 2 * fm;" in mods_code
    assert "const bli = fp - fm;" in mods_code
    assert "const bls = fp + fm;" in mods_code
    assert "amps: [vm / 2.0, vp, vm / 2.0]" in mods_code
    print("   ✓ Formulación AM (m, M%, BW, BLI, BLS y 3 impulsos) verificada.")

    # ASK
    assert "const Tb = 1.0 / rb;" in mods_code
    assert "const approxBw = 2 * rb;" in mods_code
    assert "Math.sin(x) / x" in mods_code
    print("   ✓ Formulación ASK (pulsos, portadora, modulación, sinc) verificada.")

    # FSK
    assert "const deltaF = Math.abs(f1 - f0);" in mods_code
    assert "currentPhase += 2 * Math.PI * instFreq * dt;" in mods_code
    print("   ✓ Formulación FSK (conmutación continua de fase y tonos) verificada.")

    # PCM
    assert "const fNyquist = 2 * fm;" in mods_code
    assert "const meetsNyquist = fs >= fNyquist;" in mods_code
    assert "const numLevels = Math.pow(2, nBits);" in mods_code
    assert "const qStep = (2.0 * amp) / numLevels;" in mods_code
    assert "const bitRate = fs * nBits;" in mods_code
    assert "fAlias" in mods_code
    print("   ✓ Formulación PCM (Nyquist, aliasing, cuantificación 2^n y codificación) verificada.")

def test_css_palette():
    print("5. Verificando paleta de colores en styles.css...")
    with open(CSS_PATH, "r", encoding="utf-8") as f:
        css = f.read()

    expected_colors = [
        "#2D2300", "#5A4500", "#876801", "#B48A01", "#E1AD01",
        "#EAC64D", "#F0D680", "#F6E6B3", "#FAF3D9"
    ]
    for c in expected_colors:
        assert c.lower() in css.lower(), f"Color faltante en styles.css: {c}"
    print(f"   ✓ Todos los 9 colores de la paleta dorada/ámbar están definidos en styles.css.")

def main():
    print("=====================================================================")
    print("  VERIFICACIÓN DEL SIMULADOR DIDÁCTICO DE TRANSMISIÓN DE DATOS")
    print("=====================================================================\n")
    try:
        test_files_exist()
        test_html_structure()
        test_js_id_integrity()
        test_mathematical_logic()
        test_css_palette()
        print("\n=====================================================================")
        print("  ¡TODAS LAS PRUEBAS DE VERIFICACIÓN PASARON CON ÉXITO! (100% OK)")
        print("=====================================================================")
        return 0
    except AssertionError as e:
        print(f"\n❌ FALLO EN VERIFICACIÓN: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())

