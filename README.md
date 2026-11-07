# Simulador de comunicaciones (AM, ASK, FSK, PCM)

Aplicación de escritorio en Python para simular y validar visualmente cuatro módulos de comunicaciones, estrictamente los requeridos:

- **AM**: modulación de amplitud con detectores de envolvente y coherente.
- **ASK/OOK**: modulación digital por amplitud con detección coherente/envolvente y BER.
- **FSK**: modulación digital por frecuencia con detección coherente/no coherente y BER.
- **PCM**: muestreo, cuantificación uniforme, codificación, transmisión digital (ASK/FSK/BPSK interno) y reconstrucción.

No incluye PAM, PDM, PPM ni modulación delta.

## Estructura

- `comms_app/core/`: física/matemática sin dependencias de GUI (`signals.py`, `channel.py`, `analog.py`, `digital.py`, `pcm.py`, `analysis.py`).
- `comms_app/gui/`: interfaz PySide6/matplotlib (`main_window.py`, `widgets.py`, `theme.py`, `pages/`).
- `tests/`: pruebas del núcleo y prueba GUI offscreen.
- `scripts/validate_gui.py`: validación visual (capturas).
- `examples/senal_manual.csv`: ejemplo de entrada CSV.
- `docs/guia_simulaciones.md`: guía minuciosa de simulaciones, canal, valores y gráficas.

## Entorno

El proyecto usa `.venv` con Python 3.12, NumPy, SciPy, matplotlib, PySide6, pypdf y pytest.

```bash
cd "/Users/davidgalvis/Documents/Comunicaciones/Simulación"
.venv/bin/python -m comms_app
```

## Modelo de canal (resumen)

- Pérdida de espacio libre: `FSL_dB = 32.45 + 20·log10(d_km) + 20·log10(f_MHz)`.
- Atenuación extra (cables, obstáculos, lluvia, etc.).
- AWGN con semilla reproducible (ruido referido al receptor, inyectado después de la atenuación).
- `SNR nominal` (AM) se interpreta en la banda RF de la señal (`2·B_m`; para senoide pura `2·fm`). `Eb/N0 nominal` (digital/PCM) es referencia TX.
- La atenuación reduce la relación efectiva en RX porque el ruido no se atenúa con la señal.
- Factores externos opcionales: multitrayecto (eco), interferencia de tono, offset de frecuencia (CFO), ruido de fase, escalón de ganancia/AGC y recorte (clip).
- Botón **Ajustar enlace**: compensa la pérdida estimada para fijar un objetivo en recepción.

Ver detalle completo en `docs/guia_simulaciones.md`.

## Señales manuales

- AM/PCM: seno, cuadrada, triangular, diente de sierra, chirp, dos tonos, **fórmula segura** en función de `t`, o **CSV** (2 columnas tiempo/amplitud).
- ASK/FSK: secuencia aleatoria, manual, alternada o PRBS-7.
- Las fórmulas se evalúan con AST y lista blanca de funciones (no `eval` directo).

## Pruebas

```bash
.venv/bin/python -m pytest -q
```

## Validación visual

```bash
QT_QPA_PLATFORM=offscreen .venv/bin/python scripts/validate_gui.py
```

Genera capturas en `validation/` para AM, ASK, FSK, PCM, teoría y escenarios de impairments.

## Notas de teoría

La página **Marco teórico** (en la app) resume ecuaciones, modelo de canal, decisiones de implementación y referencias (incluyendo apuntes de Pedro Nel López Castellanos, UNDESCO 2008). El PDF del anexo es escaneado; las ecuaciones se contrastaron con referencias estándar. BPSK aparece solo como portadora interna del enlace PCM.

Para la guía minuciosa de cada simulación, valores, canal y gráficas, ver `docs/guia_simulaciones.md`.

## Referencias

- López Castellanos, P. N. (2008). *Comunicaciones: fundamentos y aplicaciones*. UNDESCO.
- Proakis, J. G. & Salehi, M. (2008). *Digital Communications*. McGraw-Hill.
- Haykin, S. (2001). *Communication Systems*. Wiley.