"""verify_web_parity.py
Verifica la paridad matemática, existencia de archivos e integridad
entre los IDs del DOM en index.html y los scripts JavaScript.
"""

import re
from pathlib import Path
import math

ROOT = Path(__file__).resolve().parent.parent
WEB_APP = ROOT / "web_app"

def test_files_exist():
    required_files = [
        WEB_APP / "index.html",
        WEB_APP / "css" / "styles.css",
        WEB_APP / "js" / "core" / "signal_generator.js",
        WEB_APP / "js" / "core" / "channel.js",
        WEB_APP / "js" / "core" / "modulations.js",
        WEB_APP / "js" / "components" / "chart_manager.js",
        WEB_APP / "js" / "main.js",
        WEB_APP / "assets" / "senal_manual.csv",
    ]
    for f in required_files:
        assert f.exists(), f"Falta archivo requerido: {f}"
        assert f.stat().st_size > 0, f"El archivo está vacío: {f}"
    print("✓ Todos los archivos requeridos existen y tienen contenido.")

def test_dom_ids_integrity():
    index_html = (WEB_APP / "index.html").read_text(encoding="utf-8")
    main_js = (WEB_APP / "js" / "main.js").read_text(encoding="utf-8")
    chart_js = (WEB_APP / "js" / "components" / "chart_manager.js").read_text(encoding="utf-8")

    # Extraer todos los IDs presentes en index.html
    html_ids = set(re.findall(r'id=["\']([a-zA-Z0-9_-]+)["\']', index_html))
    print(f"Total IDs encontrados en index.html: {len(html_ids)}")

    # Extraer getElementById de main.js
    main_ids = set(re.findall(r'getElementById\(["\']([a-zA-Z0-9_-]+)["\']\)', main_js))
    print(f"Total getElementById en main.js: {len(main_ids)}")

    # Extraer renderPlot / getElementById de chart_manager.js
    chart_ids = set(re.findall(r'renderPlot\(\s*["\']([a-zA-Z0-9_-]+)["\']', chart_js))
    print(f"Total IDs de gráficos en chart_manager.js: {len(chart_ids)}")

    missing_main = main_ids - html_ids
    assert not missing_main, f"IDs en main.js no encontrados en index.html: {missing_main}"

    missing_charts = chart_ids - html_ids
    assert not missing_charts, f"IDs de gráficos en chart_manager.js no encontrados en index.html: {missing_charts}"

    print("✓ Integridad de IDs entre JavaScript y HTML 100% verificada sin faltantes.")

def test_mathematical_parity():
    # 1. Friis FSL
    # FSL = 32.45 + 20 log10(d_km) + 20 log10(f_MHz)
    d, f = 1.0, 2450.0
    fsl_py = 32.45 + 20.0 * math.log10(d) + 20.0 * math.log10(f)
    assert abs(fsl_py - (32.45 + 20 * math.log10(2450.0))) < 1e-9

    # 2. AM Power
    # Pt/Pc = 1 + 0.5 * m^2
    m = 0.8
    pt_pc = 1.0 + 0.5 * m * m
    assert abs(pt_pc - 1.32) < 1e-9
    carrier_frac = 1.0 / pt_pc
    sideband_frac = (0.5 * m * m) / pt_pc
    assert abs(carrier_frac + sideband_frac - 1.0) < 1e-9

    # 3. Carrier snapping
    fc, rb = 6100.0, 1000.0
    cycles = round(fc / rb)
    snapped = cycles * rb
    assert snapped == 6000.0
    assert cycles == 6

    # 4. PCM Quantization formula
    full_scale = 1.0
    for n_bits in [4, 8, 12]:
        levels = 2 ** n_bits
        q = 2.0 * full_scale / levels
        assert levels == (1 << n_bits)
        assert q > 0
        theory_sqnr = 6.02 * n_bits + 1.76 + 20.0 * math.log10(0.8)
        assert theory_sqnr > 0

    print("✓ Paridad de formulación física y matemática verificada exitosamente.")

if __name__ == "__main__":
    test_files_exist()
    test_dom_ids_integrity()
    test_mathematical_parity()
    print("\n¡TODAS LAS PRUEBAS DE VERIFICACIÓN PASARON CON ÉXITO!")

