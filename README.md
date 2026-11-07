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

## Entorno

El proyecto usa `.venv` con Python 3.12, NumPy, SciPy, matplotlib, PySide6, pypdf y pytest.

```bash
cd "/Users/davidgalvis/Documents/Comunicaciones/Simulación"
.venv/bin/python -m comms_app
```

## Modelo de canal

- Pérdida de espacio libre: `FSL_dB = 32.45 + 20·log10(d_km) + 20·log10(f_MHz)`.
- Atenuación extra (cables, obstáculos, lluvia, etc.).
- AWGN con semilla reproducible.
- `SNR nominal` (AM) se interpreta en la banda de la señal (`2·fm`). `Eb/N0 nominal` (digital/PCM) es referencia TX.
- La atenuación reduce la relación efectiva en RX porque el ruido no se atenúa con la señal.
- Factores externos opcionales: multitrayecto (eco), interferencia de tono, offset de frecuencia (CFO), ruido de fase, escalón de ganancia/AGC y recorte (clip).
- Botón **Ajustar enlace**: compensa la pérdida estimada para fijar un objetivo en recepción.

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

La página **Marco teórico** resume ecuaciones, modelo de canal, decisiones de implementación y referencias (incluyendo apuntes de Pedro Nel López Castellanos, UNDESCO 2008). El PDF del anexo es escaneado; las ecuaciones se contrastaron con referencias estándar. BPSK aparece solo como portadora interna del enlace PCM.

---

## Guía minuciosa: cómo funciona cada simulación, valores, canal y gráficas

Esta sección explica **qué hace cada módulo**, **cómo se calcula**, **por qué se usan ciertos valores**, **qué representan los factores externos** y **cómo interpretar cada gráfica**. Las unidades importan: tiempo en segundos/milisegundos, frecuencia en Hz/kHz/MHz, amplitud en voltios (escala relativa de simulación), potencia relativa, SNR/Eb/N0 en dB, BER como fracción.

### 1. Convenciones generales (aplican a todo)

- **Tiempo discreto**: todas las señales se simulan con un vector de tiempo uniforme `t = n/fs`. `fs` es la frecuencia de muestreo de simulación (no confundir con la frecuencia de muestreo PCM, que es otro parámetro).
- **Generador de ruido reproducible**: el ruido usa una semilla (`seed`). Con la misma configuración y semilla, el resultado es el mismo; cambiar la semilla cambia la realización del ruido pero no la estadística esperada.
- **Referencia TX vs. recepción RX**: los valores nominales de calidad (`SNR nominal` en AM, `Eb/N0 nominal` en digital/PCM) se definen como referencia asociada al transmisor/condición nominal. El canal atenúa la **señal**, pero **no atenúa el ruido térmico equivalente** agregado en el receptor; por eso la calidad efectiva en RX cae cuando hay pérdida: `SNR/EbN0 efectiva ≈ nominal − atenuación` (en el modelo lineal, sin otras degradaciones).
- **“Ajustar enlace”**: calcula la pérdida total estimada (`pérdida de espacio libre + atenuación extra`) y eleva el valor nominal para que la **calidad objetivo en RX** se cumpla aproximadamente. Sirve para separar el efecto de “falta de potencia/ruido” del efecto de “distancia/frecuencia”.
- **Espectro (FFT)**: se obtiene con transformada rápida de Fourier; las gráficas suelen mostrar magnitud en **dB relativa al pico** de esa traza (`20·log10(|X|/max|X|)`). Esto facilita comparar forma y componentes, aunque dos trazas estén a niveles absolutos distintos.
- **Tooltips**: al pasar el ratón sobre una curva/punto, la interfaz muestra serie, ejes e interpretación breve.

### 2. Canal y factores externos (modelo físico simplificado)

El canal se aplica, según corresponda, en este sentido conceptual: se genera la señal modulada TX, se escala por la ganancia equivalente a la atenuación, se pueden añadir distorsiones deterministas (eco, interferencia, offset, ruido de fase, escalón, recorte) y finalmente se añade AWGN. Se conserva una versión “limpia” (sin ruido) para análisis visual.

| Factor | Qué modela | Parámetros típicos / por qué | Efecto observable |
|---|---|---|---|
| **Distancia** `d` (km) | Separación TX–RX | 0 km = enlace ideal de laboratorio; >0 introduce pérdida geométrica | Baja la amplitud útil en RX, reduce SNR/EbN0 efectiva, empeora BER/MSE |
| **Frecuencia de portadora/enlace** `f` (MHz) | Frecuencia usada para FSL | Mayor `f` → mayor pérdida en espacio libre (antenas/isotropía idealizada) | Misma distancia, más MHz ⇒ peor enlace si no se compensa |
| **Pérdida de espacio libre (FSL)** | Propagación en línea de vista ideal | `FSL_dB = 32.45 + 20·log10(d_km) + 20·log10(f_MHz)` | Atenuación determinista base; no incluye obstáculos, lluvia real compleja, ni patrones de antena |
| **Atenuación extra** (dB) | Cables, conectores, desvanecimiento plano adicional, lluvia, obstáculos, desapuntamiento | 0 dB = sin extras; valores de decenas de dB representan pérdidas fuertes | Se suma a FSL: `atenuación total = FSL + extra` |
| **AWGN** | Ruido térmico/electrónico agregado, blanco y gaussiano | `SNR nominal` (AM) o `Eb/N0 nominal` (digital/PCM) | Dispersa muestras, ensancha espectro de ruido, causa errores de decisión y distorsión de recuperación |
| **SNR nominal (AM)** | Relación señal/ruido de referencia en la banda útil | Se interpreta en banda `2·fm` (ancho de AM de doble banda lateral alrededor de la información). Valores altos (p. ej. 20–30 dB) = canal limpio; bajos (0–10 dB) = muy ruidoso | A menor SNR, peor MSE/correlación en detectores; la curva de fidelidad lo muestra |
| **Eb/N0 nominal (digital/PCM)** | Energía por bit sobre densidad espectral de ruido | Métrica natural para comparar modulaciones digitales. ASK/FSK/BPSK tienen BER teóricas distintas para el mismo Eb/N0 | A menor Eb/N0, más errores (BER sube); en PCM, al cruzar el umbral la reconstrucción colapsa |
| **Multitrayecto (eco)** | Reflexión: señal directa + copia retardada | `retardo` (µs), `ganancia` (dB), `fase` (°). Retardos del orden de un símbolo/bit o de la portadora producen interferencia; fase 180° puede cancelar | Distorsiona forma de onda, genera interferencia intersimbólica (ISI) en digital, altera envolvente/espectro |
| **Interferencia (tono)** | Señal interferente estrecha (otra emisora, armónico, espurio) | Frecuencia cercana a componentes útiles y amplitud relativa alta son más dañinas | Picos espurios en espectro, errores de bit, error de demodulación AM |
| **Offset de frecuencia / CFO** (Hz) | Diferencia entre osciladores TX/RX | Valores pequeños (decenas–cientos de Hz) ya afectan detección coherente/estimaciones de fase | Rotación de fase/deriva: degrada coherente BPSK/FSK coherente y estimaciones; puede desplazar energía aparente |
| **Ruido de fase** (rad RMS) | Inestabilidad de fase del oscilador local | Pequeño (p. ej. 0.01–0.1 rad) ensancha componentes; mayor daña sincronía | Empeora constelación equivalente/fase, eleva piso o distorsiona detección sensible a fase |
| **Escalón de ganancia** (dB) y tiempo | Cambio abrupto de nivel (AGC lento, desvanecimiento, conmutación) | Ocurre en una fracción del tiempo de simulación | El receptor ve un salto de amplitud; si la decisión depende de umbral/ganancia, pueden aparecer errores o distorsión |
| **Recorte / clip** (nivel) | Saturación del amplificador o ADC/DAC | Nivel bajo respecto a la amplitud ⇒ recorte fuerte | Distorsión no lineal: genera armónicos/intermodulación, aplana picos, aumenta BER/MSE |

**Interpretación clave**: si subes distancia/frecuencia o atenuación extra y no ajustas el enlace, la degradación es esperada (menos señal útil, mismo ruido). Si activas interferencia, CFO, multitrayecto o clip, la degradación puede ocurrir incluso con Eb/N0/SNR nominal “bueno”, porque son distorsiones/factores distintos del AWGN puro.

### 3. Módulo AM (modulación de amplitud)

#### Qué simula
Una señal moduladora `m(t)` (normalizada a amplitud relativa) varía la amplitud de una portadora senoidal:

`v_AM(t) = Vp · [1 + m_ind · m(t)] · sin(2π·fc·t)`,

donde `Vp` es la amplitud pico de portadora, `fc` la frecuencia de portadora, `m_ind` el índice de modulación (`Vm/Vp` equivalente) y `m(t)` la información normalizada.

#### Valores/parámetros y por qué
- **fm (Hz)**: frecuencia dominante de la moduladora. Define el ancho útil aproximado de la información; en AM DSB, el espectro ocupa en torno a `fc ± fm` (y más si hay armónicos/contenido). Debe cumplirse `fc > fm`.
- **fc (Hz)**: traslada la señal a una banda de RF. Se elige mucho mayor que `fm` para separar claramente portadora/bandas laterales y facilitar filtrado/detección.
- **fs (Hz)**: muestreo de simulación. Debe ser **> 2·fc** (Nyquist para representar la portadora) y suficientemente alto para ver la forma de onda sin aliasing en la simulación.
- **m (índice)**: controla profundidad. `0 ≤ m ≤ 1` evita inversión de envolvente en AM convencional; `m = 1` da 100% de modulación; `m > 1` produce **sobremodulación** (distorsión con detector de envolvente). Valores iniciales típicos: `m ≈ 0.8`.
- **Vp**: escala la amplitud; afecta potencia absoluta relativa (`Pc = Vp²/2` en senoidal).
- **Duración**: ventana de observación. Debe contener varios periodos de `fm` para que filtros y métricas (MSE/correlación) sean representativas; se descartan transitorios en los bordes.
- **SNR nominal (banda 2·fm)**: el receptor AM aplica un **filtro de RF** alrededor de `fc` (ancho suficiente para las bandas laterales) antes de detectar, de modo que el ruido considerado sea el que realmente entra al detector. Por eso la métrica útil es SNR en banda.

#### Potencia (modelo clásico)
- Potencia de portadora: `Pc = Vp²/2`.
- Potencia total: `Pt = Pc · (1 + m_ind²/2)`.
- Fracción en portadora: `Pc/Pt = 1/(1 + m_ind²/2)`. A mayor `m_ind`, más potencia relativa va a bandas laterales (información), pero `m_ind>1` distorsiona.

#### Detección
- **Envolvente**: obtiene `|analítica|` (Hilbert) y filtra pasabajos. Es simple y adecuado cuando `m_ind ≤ 1` y la SNR es razonable; falla con sobremodulación o condiciones severas.
- **Coherente (producto)**: multiplica por portadora sincronizada y filtra pasabajos. Recupera la componente de banda base con mejor linealidad teórica; es sensible a errores de sincronía/fase en escenarios reales (aquí se usa referencia ideal salvo factores modelados).

#### Interpretación de cada gráfica (AM)
1. **Recuperación de la señal** (`tiempo ms` vs `amplitud normalizada`): compara `m(t)` original con envolvente y coherente. Coincidencia alta = buena demodulación. Diferencias grandes: ruido, sobremodulación (afecta más a envolvente), filtrado insuficiente o canal severo.
2. **Señal AM transmitida y recibida** (RF): muestra TX y RX (compensada por atenuación para comparar forma). Sirve para ver modulación, efecto del ruido y distorsiones; si hay mucha atenuación sin compensación visual, RX parecería pequeña.
3. **Espectro (TX/RX)**: picos en `fc` y bandas laterales en `fc ± fm` (aprox. para tono). El ruido eleva el piso; interferencias crean picos extra. Las trazas se normalizan a su pico para comparar forma.
4. **Error de recuperación**: `recuperada − original` en el tiempo (tras recortar bordes). Idealmente ~0. Sesgo, oscilación o gran amplitud indican distorsión/ruido.
5. **Fidelidad frente a SNR (AWGN)**: MSE (escala log) vs SNR nominal; curva para envolvente y coherente. Punto “actual” marca la condición configurada. A mayor SNR, MSE tiende a bajar.
6. **Reparto de potencia AM**: porcentaje en portadora y bandas laterales según `m`. Aclara que gran parte de la potencia puede estar en la portadora (no informativa).

### 4. Módulo ASK / OOK (modulación digital por amplitud)

#### Qué simula
Secuencia binaria `b_k ∈ {0,1}`. En **OOK** (caso usado): bit `1` transmite una ráfaga de portadora `A·cos(2π·fc·t)` durante el intervalo de bit; bit `0` transmite (idealmente) ausencia de portadora. La señal es una portadora conmutada por un tren de pulsos.

#### Valores/parámetros y por qué
- **Rb (bit/s)**: tasa de bits. Define duración de bit `Tb = 1/Rb`. A mayor Rb, más ancho de banda y más sensible al ruido para el mismo Eb/N0 si la implementación/escala lo exige; aquí se usa como parámetro de diseño.
- **fc (Hz)**: portadora. Se **ajusta (snap)** al múltiplo entero de `Rb` más cercano compatible con `fs` (entero de ciclos por bit). Por qué: la correlación coherente integra sobre un número entero de ciclos, evitando sesgos por fase inicial del bit.
- **sps (muestras por bit)**: `fs_RF = Rb·sps`. Debe ser suficiente para representar la portadora (`fc < fs_RF/2`) y para el muestreo del detector/diagrama de ojo. Más sps = simulación más fina pero más costosa.
- **Amplitud A**: escala de la señal; la energía por bit de OOK equiprobable es `Eb = A²·Tb/4` (porque solo se transmite energía en los “1” la mitad del tiempo, en promedio).
- **nbits**: cantidad de bits simulados. BER = errores/nbits; pocos bits dan BER muy ruidosa (cuantización Monte Carlo). Valores grandes mejoran estimación pero tardan más.
- **Detector**:
  - *Coherente*: correlaciona con portadora de referencia y compara con umbral (derivado de energía/ganancia). Óptimo en AWGN ideal con sincronía.
  - *Envolvente*: usa la envolvente; más simple, pero generalmente peor en ruido y sensible a umbral/AGC.
- **Timing offset / AGC error**: modelan errores prácticos de muestreo y de umbral/ganancia.
- **Eb/N0 nominal**: fija el nivel de ruido relativo a la energía por bit. Curvas típicas: ASK/OOK coherente ~ `Q(√(Eb/N0))`; envolvente/no coherente tiene peor desempeño (aprox. exponencial en condiciones ideales).

#### Interpretación de cada gráfica (ASK)
1. **Secuencia y forma de onda**: TX y RX (normalizada por ganancia) en una ventana de bits; puntos/marcadores indican bits detectados. Permite ver cuándo un bit se confunde por ruido, atenuación o distorsión.
2. **Espectro ASK**: lóbulos tipo *sinc* alrededor de `fc` separados por múltiplos de `Rb` (huella del tren de pulsos). El ancho principal suele aproximarse a `2·Rb` (OOK). Ruido/interferencia modifican el piso/picos.
3. **Diagrama de ojo**: superposición de segmentos de un bit (normalizados a un intervalo de símbolo). Ojo “abierto” (separación clara entre niveles, cruce definido) = buen margen ante ruido/timing. Ojo cerrado = alta BER probable.
4. **BER (teoría vs Monte Carlo)**: escala log en BER vs `Eb/N0`. La teoría es referencia ideal (AWGN, detector indicado); la simulada incluye canal/factores configurados y variabilidad estadística. El punto actual muestra la operación configurada. Si hay atenuación, la Eb/N0 efectiva baja.

**Métrica “SNR en banda”**: se deriva de Eb/N0 y el ancho de banda ocupado (p. ej. ~`2·Rb`): relaciona `Ps/N ≈ (Eb/N0)·(Rb/B)` para ruido blanco, útil para interpretación en RF.

### 5. Módulo FSK (modulación digital por frecuencia)

#### Qué simula
BFSK binaria: bit `0` usa tono `f0 = fc − Δf`, bit `1` usa tono `f1 = fc + Δf`. La información está en la frecuencia instantánea, no en la amplitud (idealmente).

#### Valores/parámetros y por qué
- **Rb, sps, fc**: igual lógica que ASK. Se verifica que los tonos estén dentro de Nyquist (`f1 < fs_RF/2`).
- **Índice de modulación `h = 2·Δf/Rb`** (equivalente `Δf = h·Rb/2`): controla separación entre tonos. `h = 1` da `Δf = Rb/2`? (según definición usada: `Δf = 0.5·h·Rb`) y produce separación `Rb` entre `f1-f0` cuando `h=1` → ortogonalidad útil en detección no coherente sobre un bit; `h=0.5` se asocia a separación mínima en esquemas coherentes (MSK-like conceptualmente). Valores típicos 0.5–1.0.
- **Ortogonalidad**: si los tonos son ortogonales en `Tb`, el detector puede separarlos mejor (menos correlación cruzada). La métrica lo indica según `h`.
- **Detector**:
  - *No coherente (energía I/Q)*: compara energía en cada tono sin conocer fase exacta; robusto a fase desconocida.
  - *Coherente*: correlaciona con referencias en fase; puede rendir mejor en AWGN ideal, pero sufre con CFO/ruido de fase.
- **Ancho de banda (Carson)**: aproximado `B ≈ 2(Δf + Rb)`. Mayor `h` o `Rb` → más BW.

#### Interpretación de cada gráfica (FSK)
1. **Forma de onda FSK**: TX/RX; pueden verse cambios de “densidad” de ciclos al cambiar el bit (distintas frecuencias). Marcadores muestran bits detectados.
2. **Frecuencia estimada por bit**: se estima la frecuencia a partir de la **pendiente de fase** (fase desenvuelta/Hilbert) por intervalo de bit. Idealmente salta entre `f0` y `f1`. Dispersión indica ruido; desplazamiento sistemático sugiere CFO; confusión entre niveles implica errores.
3. **Espectro FSK**: dos concentraciones principales cerca de `f0` y `f1` (más lóbulos laterales según pulsos). La separación visual refleja `Δf`. Con buen SNR se distinguen claramente.
4. **BER (teoría vs Monte Carlo)**: teoría depende del detector (no coherente ≈ `0.5·exp(-Eb/(2N0))` en BFSK ortogonal ideal; coherente ≈ `Q(√(Eb/N0))` en caso equivalente). El punto actual refleja canal/factores.

### 6. Módulo PCM (muestreo, cuantificación, codificación y reconstrucción)

#### Qué simula
Cadena digital de una señal analógica: (1) filtro antialias opcional, (2) muestreo a `fs`, (3) cuantificación uniforme de `n` bits sobre fondo de escala `±FS`, (4) codificación binaria (MSB primero), (5) transmisión de los bits por un enlace digital **ASK, FSK o BPSK** (seleccionable) a tasa `Rb = fs·n`, (6) demodulación/decisión de bits, (7) decodificación a niveles y (8) reconstrucción por **interpolación sinc/FFT** (ideal de banda limitada) más una referencia **ZOH** (retenedor de orden cero).

#### Valores/parámetros y por qué
- **fm**: frecuencia de la señal analógica. Para representarla sin aliasing se requiere `fs > 2·fm` (Nyquist). Margen práctico mayor es recomendable.
- **fs (muestreo PCM)**: cuántas muestras por segundo se toman. Mayor `fs` reduce aliasing (si la señal está limitada) pero aumenta `Rb = fs·n`.
- **n (bits por muestra)**: niveles `L = 2^n`, paso `q = 2·FS/L`. Más bits → menor error de cuantificación → mayor SQNR (~+6.02 dB por bit para senoide a plena escala), pero más bits a transmitir.
- **Fondo de escala (FS) y amplitud**: la señal debe caber en `±FS`. Si la amplitud excede FS, hay **recorte** en cuantificación (distorsión). Se recomienda amplitud ≤ FS.
- **Filtro antialias**: pasabajos antes de muestrear (corte cercano a `fs/2`) para limitar componentes > `fs/2`. Si se desactiva y `fm` es alto respecto a `fs/2`, aparece **aliasing**.
- **Reconstrucción**: ZOH muestra escalones (realista para DAC simple); sinc/FFT aproxima el filtro reconstructor ideal (banda limitada). Los bordes se recortan en métricas por transitorios.
- **Enlace digital PCM (ASK/FSK/BPSK, fc, sps, Eb/N0)**: transporta bits. La calidad total depende de dos cosas: *cuantificación* (limitada por `n, FS, amplitud`) y *errores de bit* (limitados por Eb/N0, modulación, canal). A Eb/N0 alto, domina cuantificación (SQNR se acerca al teórico). A Eb/N0 bajo, los errores de bit provocan saltos grandes en muestras reconstruidas → SQNR cae abruptamente (**efecto umbral**).
- **Tasa de bits**: `Rb = fs·n` (bps). Aumentar `fs` o `n` mejora fidelidad potencial pero exige más ancho de banda/energía de enlace.

#### SQNR de cuantificación (senoide, cuantificador uniforme, sin recorte)
Aproximación: `SQNR_dB ≈ 6.02·n + 1.76 + 20·log10(A/FS)`. Con `A = FS` (plena escala) queda `≈ 6.02·n + 1.76`. Si `A < FS`, se pierden dB; si `A > FS`, domina la distorsión por recorte.

#### Interpretación de cada gráfica (PCM)
1. **Muestreo y cuantificación**: señal analógica continua, muestras tomadas a `fs` y niveles cuantizados; líneas verticales muestran diferencia `xq − x` (error de cuantificación). Permite ver si `fs` sigue bien la forma y cuánto “redondea” el cuantificador.
2. **Error de cuantificación** (en mV o unidades): `xq − x` en muestras, con referencias `±q/2`. Dentro de rango y sin recorte, el error se mantiene acotado; si hay recorte, aparecen errores grandes.
3. **Reconstrucción**: original vs ZOH vs reconstruida (sinc). Buena coincidencia (especialmente lejos de bordes) indica cuantificación/enlace adecuados. ZOH se ve escalonada; sinc es más suave.
4. **Espectro / muestreo y aliasing**: espectro analógico y de la señal muestreada, con líneas de `fm` y Nyquist (`fs/2`). Si hay componentes plegadas o `fm ≥ fs/2`, se observa aliasing. Activar antialias debe reducir contenido indebido.
5. **SQNR frente al número de bits**: teoría (`6.02n+1.76` ajustada por amplitud/escala), SQNR de cuantificación y SQNR de reconstrucción vs `n`; punto actual. Valida la ganancia de ~6 dB/bit cuando el muestreo/filtro son adecuados.
6. **Umbral del enlace PCM (SQNR reconstrucción vs Eb/N0)**: muestra meseta limitada por cuantificación a Eb/N0 alto y caída fuerte al bajar Eb/N0 (errores de bit). Línea de referencia al límite de cuantificación ayuda a distinguir la causa dominante.

### 7. Entradas manuales y reproducibilidad

- **Formas de onda (AM/PCM)**: senoidal, cuadrada, triangular, diente de sierra, chirp, dos tonos, fórmula, CSV. La forma afecta armónicos/espectro y, por tanto, requisitos de `fs`/antialias en PCM o contenido de banda en AM.
- **Fórmula segura**: expresión en variable `t` (segundos), evaluada con AST y lista blanca (`sin, cos, tan, exp, log, sqrt, abs, clip, where, pi`, etc.). Evita ejecución arbitraria. Si produce valores no finitos o dimensiones incompatibles, se rechaza.
- **CSV**: dos columnas (tiempo, amplitud) o una; se interpola sobre el eje de simulación. Útil para señales reales o diseñadas externamente.
- **Secuencias digitales (ASK/FSK)**: aleatoria (semilla), manual, alternada `0101…`, PRBS-7. Permiten pruebas deterministas o realistas.

### 8. Limitaciones del modelo (importante)

- Canal **didáctico**: AWGN + efectos seleccionados; no modela desvanecimiento selectivo en frecuencia completo (Rayleigh/Rician amplio), MIMO, codificación de canal, ecualización adaptativa real, ni impairments de RF completos.
- FSL es **ideal** (espacio libre/línea de vista simplificada).
- Detectores/ sincronía parcialmente idealizados (p. ej. portadora conocida en varios casos), salvo los errores que se activan explícitamente.
- Las curvas Monte Carlo en la UI usan números de puntos/bits acotados para interactividad; para estimaciones de BER muy bajas se requieren más bits.
- La FFT como reconstructor PCM asume condiciones periódicas/ventana; por eso se recortan bordes en métricas.

### 9. Cómo usar esta guía para “entender todo”

1. Elige un módulo y fija un **caso base** (preset AWGN ideal, valores por defecto).
2. Cambia **un parámetro a la vez** (m, Eb/N0, fs, n, h, distancia, interferencia, etc.).
3. Observa la **gráfica relevante**: espectro (frecuencia), tiempo (forma), BER/MSE/SQNR (calidad), y el tooltip.
4. Verifica la coherencia: más ruido/atenuación/distorsión ⇒ peor métrica; más bits (PCM) ⇒ mejor SQNR si el enlace es bueno; `m>1` ⇒ envolvente AM se degrada.
5. Usa **Ajustar enlace** cuando quieras estudiar un factor distinto a la simple pérdida de potencia.
