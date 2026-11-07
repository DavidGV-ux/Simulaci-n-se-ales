"""Marco teórico, trazabilidad con el anexo y notas de implementación."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

from ..theme import BORDER_SOFT, CYAN, FAINT, MAGENTA, MUTED, SURFACE, TEXT

THEORY_HTML = f"""
<html>
<head>
<style>
body {{ color: {TEXT}; font-family: "Avenir Next", "Helvetica Neue", sans-serif; font-size: 12.5px; line-height: 1.55; }}
h1 {{ color: {TEXT}; font-size: 21px; margin: 0 0 4px 0; }}
h2 {{ color: {CYAN}; font-size: 16px; margin: 26px 0 8px 0; border-bottom: 1px solid {BORDER_SOFT}; padding-bottom: 5px; }}
h3 {{ color: {TEXT}; font-size: 13px; margin: 18px 0 5px 0; }}
p {{ margin: 7px 0; color: #d7e2f3; }}
ul, ol {{ margin: 6px 0 8px 22px; color: #d7e2f3; }}
li {{ margin: 3px 0; }}
table {{ border-collapse: collapse; margin: 10px 0; width: 100%; }}
th {{ background: #142238; color: {MUTED}; font-size: 10.5px; text-align: left; padding: 6px 8px; border: 1px solid {BORDER_SOFT}; }}
td {{ padding: 6px 8px; border: 1px solid {BORDER_SOFT}; color: #d7e2f3; font-size: 11.5px; }}
.eq {{ font-family: "Georgia", "Times New Roman", serif; font-size: 15px; color: #f3f7ff; text-align: center; margin: 12px 0; }}
.note {{ background: #101d31; border-left: 3px solid {CYAN}; padding: 9px 12px; margin: 12px 0; color: #cfe0f5; }}
.warn {{ background: #221626; border-left: 3px solid {MAGENTA}; padding: 9px 12px; margin: 12px 0; color: #efd8f6; }}
.small {{ color: {FAINT}; font-size: 10.5px; }}
code {{ background: #0e192b; color: #a5f3fc; font-family: "Menlo", monospace; font-size: 10.5px; padding: 1px 4px; }}
a {{ color: {CYAN}; }}
</style>
</head>
<body>

<h1>Marco teórico y verificación</h1>
<p class="small">Laboratorio de comunicaciones · AM, ASK, FSK y PCM · Basado en los apuntes de Pedro Nel López Castellanos (UNDESCO, 2008) y referencias estándar de comunicaciones digitales.</p>

<div class="note">
<b>Alcance.</b> La aplicación implementa estrictamente cuatro módulos: modulación de amplitud (AM),
modulación por desplazamiento de amplitud (ASK/OOK), modulación por desplazamiento de frecuencia (FSK)
y modulación por pulsos codificados (PCM). BPSK se usa únicamente como portadora digital interna del enlace PCM,
no como un módulo adicional de la interfaz.
</div>

<h2><a name="conceptos"></a>1. Conceptos, unidades y notación</h2>
<p>Modular es trasladar la información de una señal de baja frecuencia (banda base) a una portadora de alta frecuencia.
La portadora modifica uno de sus parámetros —amplitud, frecuencia o fase— de forma proporcional a la señal moduladora.
Así se comparte el medio, se aprovechan las antenas y se evita que todas las señales ocupen la misma banda.</p>
<p>La relación señal/ruido se expresa en decibelios:</p>
<p class="eq">SNR<sub>dB</sub> = 10 log<sub>10</sub>(P<sub>s</sub> / P<sub>n</sub>) &nbsp;&nbsp;·&nbsp;&nbsp; P<sub>dBm</sub> = 10 log<sub>10</sub>(P / 1 mW)</p>
<p>En digital, la energía por bit se relaciona con la potencia media mediante <i>E<sub>b</sub> = P<sub>s</sub> T<sub>b</sub></i> y
la densidad espectral de ruido es <i>N<sub>0</sub></i>. Para un ruido blanco de banda <i>B</i>, <i>N = N<sub>0</sub>B</i>.
La figura de mérito es <i>E<sub>b</sub>/N<sub>0</sub></i>, no la SNR a secas: dos sistemas con la misma SNR pueden tener
BER distinta si sus tasas o sus anchos de banda difieren.</p>
<table>
<tr><th>Concepto</th><th>Expresión</th><th>Uso en la aplicación</th></tr>
<tr><td>Potencia media</td><td>P = lim (1/T) ∫ |x(t)|² dt</td><td>Se estima con la media de x²</td></tr>
<tr><td>RMS</td><td>x<sub>rms</sub> = √(P)</td><td>Amplitud eficaz de señales</td></tr>
<tr><td>dB relativo</td><td>20 log<sub>10</sub>(A/A<sub>ref</sub>)</td><td>Atenuación, ganancias, espectros</td></tr>
<tr><td>Energía por bit</td><td>E<sub>b</sub> = P<sub>s</sub>/R<sub>b</sub></td><td>Curvas BER de ASK, FSK y BPSK</td></tr>
<tr><td>Nyquist</td><td>f<sub>s</sub> ≥ 2W</td><td>Muestreo PCM sin aliasing</td></tr>
</table>

<h2><a name="am"></a>2. Modulación de amplitud (AM)</h2>
<p>El anexo define la señal AM con portadora senoidal y moduladora de baja frecuencia:</p>
<p class="eq">v(t) = V<sub>p</sub> [1 + m sen(2π f<sub>m</sub> t)] sen(2π f<sub>p</sub> t)</p>
<p>donde <i>V<sub>p</sub></i> es el valor pico de la portadora, <i>f<sub>p</sub></i> su frecuencia, <i>f<sub>m</sub></i> la frecuencia
moduladora y <i>m = V<sub>m</sub>/V<sub>p</sub></i> el índice de modulación. La envolvente es
<i>V<sub>p</sub>[1 + m·m(t)]</i>; para <i>m ≤ 1</i> nunca cambia de signo y un detector de envolvente puede recuperar la información.</p>
<h3>Potencia y rendimiento</h3>
<p class="eq">P<sub>t</sub> = P<sub>c</sub> (1 + m²/2), &nbsp;&nbsp; P<sub>c</sub> = V<sub>p</sub>²/2</p>
<p class="eq">η = (m²/2) / (1 + m²/2) = m² / (2 + m²)</p>
<p>Para <i>m = 1</i>: <i>P<sub>t</sub>/P<sub>c</sub> = 1.5</i>, la portadora concentra 2/3 de la potencia y las dos bandas
laterales 1/3. El rendimiento máximo de AM convencional es 33.3 %; el resto se invierte en la portadora, que no lleva información.
El ancho de banda es <i>B<sub>AM</sub> = 2f<sub>m</sub></i>.</p>
<h3>Recepción</h3>
<ul>
<li><b>Detector de envolvente:</b> rectifica y filtra pasa-bajos. Es simple y barato, pero exige <i>m ≤ 1</i>,
<i>f<sub>c</sub> ≫ f<sub>m</sub></i> y una constante de tiempo bien elegida. La sobremodulación invierte la envolvente y distorsiona.</li>
<li><b>Detector coherente:</b> multiplica por una portadora local <i>sen(2πf<sub>c</sub>t)</i> y filtra. Es lineal incluso con
sobremodulación, pero necesita recuperar la fase; un error de fase <i>φ</i> atenúa la salida en <i>cos φ</i>.</li>
</ul>
<p>En la aplicación se grafican ambos detectores, el error <i>recuperada − original</i>, el espectro con las líneas
<i>f<sub>c</sub></i> y <i>f<sub>c</sub> ± f<sub>m</sub></i>, el reparto de potencia y una curva de MSE frente a SNR.</p>
<div class="warn"><b>Verificación:</b> con <i>m=1</i> la aplicación obtiene <i>P<sub>t</sub>/P<sub>c</sub>=1.5</i> y fracción de portadora 0.667,
coincidiendo con las ecuaciones del anexo (páginas 210–218). Con <i>m=1.5</i> el detector de envolvente presenta un MSE
grande mientras el coherente conserva un error pequeño.</div>

<h2><a name="ask"></a>3. Amplitud conmutada (ASK/OOK)</h2>
<p>En ASK la amplitud de la portadora toma un conjunto discreto de valores. La variante binaria OOK (on-off keying)
envía un 1 como ráfaga de portadora y un 0 como ausencia de señal:</p>
<p class="eq">s(t) = A · b(t) · cos(2π f<sub>c</sub> t), &nbsp;&nbsp; b(t) ∈ {{0, 1}}</p>
<p>Si los bits son equiprobables, la potencia media es <i>P = A²/4</i> y la energía media por bit es
<i>E<sub>b</sub> = A²T<sub>b</sub>/4</i>. El espectro es el de un tren de pulsos multiplicado por la portadora:
lóbulos laterales tipo <i>sinc</i> separados por <i>R<sub>b</sub></i>. El lóbulo principal ocupa aproximadamente
<i>2R<sub>b</sub></i>, por lo que la eficiencia espectral es 0.5 bit/s/Hz.</p>
<h3>Detección y BER</h3>
<p>Con detección coherente y ruido blanco gaussiano, el umbral óptimo está a mitad de la distancia entre los dos niveles:</p>
<p class="eq">P<sub>b</sub> = Q(√(E<sub>b</sub>/N<sub>0</sub>))</p>
<p>Con detección de envolvente (no coherente) y umbral óptimo, para OOK:</p>
<p class="eq">P<sub>b</sub> ≈ ½ exp(−E<sub>b</sub>/(2N<sub>0</sub>))</p>
<p>La aplicación incluye ambos detectores, error de AGC, error de temporización, diagrama de ojo y curva BER.
La portadora se ajusta a un número entero de ciclos por bit para que la fase de cada bit sea reproducible; en la
práctica los transmisores también eligen <i>f<sub>c</sub></i> como múltiplo de <i>R<sub>b</sub></i>.</p>

<h2><a name="fsk"></a>4. Frecuencia conmutada (FSK)</h2>
<p>FSK asigna una frecuencia distinta a cada símbolo. Para BFSK:</p>
<p class="eq">s(t) = A cos(2π f<sub>i</sub> t), &nbsp;&nbsp; f<sub>i</sub> = f<sub>0</sub> si b=0, &nbsp; f<sub>i</sub> = f<sub>1</sub> si b=1</p>
<p>La separación entre tonos es <i>Δf = |f<sub>1</sub>−f<sub>0</sub>|</i> y el índice de modulación se define como
<i>h = 2Δf T<sub>b</sub> = 2Δf/R<sub>b</sub></i>. Con <i>h = 1</i> los tonos están separados <i>1/T<sub>b</sub></i> y son
ortogonales en cada intervalo de bit; es la elección por defecto. Para detección coherente basta una separación de
<i>1/(2T<sub>b</sub>)</i>; para no coherente se recomienda al menos <i>1/T<sub>b</sub></i>.</p>
<h3>Detección y BER</h3>
<p>El receptor no coherente correlaciona la señal con las ramas I/Q de cada tono y compara energías; no necesita
recuperar la fase. El receptor coherente correlaciona con la fase conocida de cada tono.</p>
<p class="eq">Coherente: P<sub>b</sub> = Q(√(E<sub>b</sub>/N<sub>0</sub>)) &nbsp;&nbsp;·&nbsp;&nbsp;
No coherente: P<sub>b</sub> = ½ exp(−E<sub>b</sub>/(2N<sub>0</sub>))</p>
<p>El ancho de banda se estima con la regla de Carson: <i>B ≈ 2(Δf + R<sub>b</sub>)</i>. La aplicación muestra la
frecuencia instantánea (derivada de la fase analítica), el espectro con <i>f<sub>0</sub></i> y <i>f<sub>1</sub></i>,
la forma de onda y las curvas BER teórica y Monte Carlo.</p>
<div class="note"><b>Nota:</b> FSK necesita más ancho de banda que ASK o BPSK, pero su detección no coherente es robusta
frente a errores de fase y es muy usada en enlaces de bajo costo. La aplicación permite comparar ambos detectores.</div>

<h2><a name="pcm"></a>5. Modulación por pulsos codificados (PCM)</h2>
<p>PCM convierte una señal analógica en una secuencia de bits en tres etapas:</p>
<ol>
<li><b>Muestreo:</b> <i>x[n] = x(nT<sub>s</sub>)</i>, con <i>f<sub>s</sub> = 1/T<sub>s</sub> ≥ 2W</i> (Nyquist).
Si <i>f<sub>s</sub> < 2W</i> aparece aliasing: las componentes de alta frecuencia se pliegan sobre la banda base.</li>
<li><b>Cuantificación uniforme:</b> se divide el fondo de escala <i>[−FS, +FS]</i> en <i>L = 2<sup>n</sup></i> niveles.
El paso es <i>q = 2FS/2<sup>n</sup></i> y el error de cuantización, para señales que no recortan, está aproximadamente
uniforme en <i>[−q/2, q/2]</i>.</li>
<li><b>Codificación:</b> cada nivel se representa con <i>n</i> bits, típicamente MSB primero. La tasa binaria es
<i>R<sub>b</sub> = f<sub>s</sub> · n</i>.</li>
</ol>
<h3>Relación señal a ruido de cuantización</h3>
<p>Para una senoide de amplitud <i>A</i> y cuantización uniforme de <i>n</i> bits:</p>
<p class="eq">SQNR<sub>dB</sub> = 6.02 n + 1.76 + 20 log<sub>10</sub>(A/FS)</p>
<p>Cada bit adicional mejora aproximadamente 6 dB. Si la señal supera el fondo de escala, el recorte (clipping) genera
distorsión armónica que no se recupera aumentando la tasa. La aplicación detecta esta situación y también permite
desactivar el filtro antialias para visualizar el aliasing.</p>
<h3>Reconstrucción</h3>
<p>El convertidor D/A real mantiene cada muestra (ZOH), lo que introduce una respuesta <i>sinc</i> y un desfase de medio
periodo de muestra. El filtro reconstructor ideal interpola con <i>sinc</i>:</p>
<p class="eq">x<sub>r</sub>(t) = Σ x[n] · sinc((t − nT<sub>s</sub>)/T<sub>s</sub>)</p>
<p>La aplicación calcula la reconstrucción con una sinc ventaneada de 24 muestras a cada lado y descarta los transitorios
de borde en las métricas. El error total incluye cuantización, ruido del enlace y errores de bit.</p>
<h3>Transmisión digital</h3>
<p>Los bits PCM se transmiten con ASK, FSK o BPSK. La elección cambia el ancho de banda y la BER, pero no la
cuantificación. La curva <i>SQNR</i> frente a <i>E<sub>b</sub>/N<sub>0</sub></i> muestra un comportamiento de umbral:
mientras el enlace digital es fiable, la calidad la fija la cuantificación; al acercarse al umbral, un solo error de bit
produce un salto grande en la muestra reconstruida.</p>
<div class="warn"><b>Decisión de alcance:</b> no se implementan PAM, PDM, PPM ni modulación delta. Son técnicas de pulsos
distintas de PCM y no forman parte del trabajo solicitado. La compansión μ-law se menciona como posible extensión,
pero no se incluye para mantener el alcance estricto.</div>

<h2><a name="canal"></a>6. Canal, ruido y factores externos</h2>
<h3>Pérdida de espacio libre</h3>
<p>La pérdida de trayecto en espacio libre se calcula con la fórmula de Friis en forma logarítmica:</p>
<p class="eq">FSL<sub>dB</sub> = 32.45 + 20 log<sub>10</sub>(d<sub>km</sub>) + 20 log<sub>10</sub>(f<sub>MHz</sub>)</p>
<p>El valor 32.45 agrupa la velocidad de la luz y la conversión de unidades. Es válida en la zona de campo lejano
y para visión directa; no incluye obstáculos, difracción ni lluvia. En la aplicación se suma la atenuación extra.</p>
<h3>Ruido</h3>
<p>Se añade ruido blanco gaussiano complejo equivalente, muestreado a la frecuencia de simulación. Para AM se especifica
una SNR nominal; para los módulos digitales se especifica <i>E<sub>b</sub>/N<sub>0</sub></i>. La convención es importante:
el valor nominal se refiere al transmisor, y la atenuación del canal reduce la relación efectiva en recepción porque el
ruido no se atenúa con la señal. Por eso la interfaz muestra siempre <b>valor nominal</b> y <b>valor efectivo</b>, y ofrece
el botón <b>Ajustar enlace</b> para compensar la pérdida y fijar un objetivo en recepción.</p>
<h3>Otros factores</h3>
<ul>
<li><b>Multitrayecto:</b> se suma un eco con retardo, ganancia y fase. Un eco cercano a medio bit produce interferencia
intersimbólica (ISI); un eco de fase opuesta puede crear un nulo espectral.</li>
<li><b>Interferencia:</b> tono senoidal a otra frecuencia, con amplitud relativa a la señal. Cerca de la portadora es
especialmente dañino para AM, ASK y BPSK.</li>
<li><b>Offset de frecuencia:</b> error de portadora entre transmisor y receptor; degrada la detección coherente y
desplaza el espectro.</li>
<li><b>Ruido de fase:</b> ensancha las líneas espectrales y rota la constelación.</li>
<li><b>Escalón de ganancia:</b> desvanecimiento lento o cambio de AGC; si el receptor no lo sigue, aparecen errores.</li>
<li><b>Recorte (clip):</b> saturación del amplificador; genera armónicos e intermodulación.</li>
</ul>
<p>La semilla de ruido permite reproducir exactamente una simulación y comparar configuraciones.</p>

<h2><a name="implementacion"></a>7. Implementación, pruebas y límites</h2>
<p>El código está separado en dos capas. <code>comms_app/core</code> contiene la física y la matemática: generación de
señales, canal, modulaciones, PCM y curvas de barrido. No importa PySide6, por lo que puede probarse con pytest.
<code>comms_app/gui</code> contiene la interfaz, los controles y las gráficas. Las simulaciones se ejecutan en un hilo
de trabajo para que la ventana no se congele.</p>
<table>
<tr><th>Archivo</th><th>Responsabilidad</th></tr>
<tr><td><code>core/signals.py</code></td><td>Formas de onda, evaluador seguro de fórmulas, CSV, espectros, cuantificación, sinc</td></tr>
<tr><td><code>core/channel.py</code></td><td>FSL, AWGN, multitrayecto, interferencia, CFO, ruido de fase, AGC y clip</td></tr>
<tr><td><code>core/analog.py</code></td><td>AM, detectores de envolvente y coherente, métricas</td></tr>
<tr><td><code>core/digital.py</code></td><td>ASK, FSK, BPSK, detectores y BER teórica</td></tr>
<tr><td><code>core/pcm.py</code></td><td>Muestreo, cuantificación, codificación, enlace digital y reconstrucción</td></tr>
<tr><td><code>core/analysis.py</code></td><td>Curvas Monte Carlo y barridos para las gráficas</td></tr>
<tr><td><code>gui/</code></td><td>Ventana, páginas, controles, tema y validación visual</td></tr>
</table>
<h3>Controles manuales</h3>
<p>AM y PCM permiten elegir seno, cuadrada, triangular, diente de sierra, chirp, dos tonos, una fórmula personalizada
o un archivo CSV de dos columnas. Las fórmulas se evalúan con una lista blanca de funciones y un recorrido del AST;
no se usa <code>eval</code> directamente, de modo que no pueden ejecutar código arbitrario. Los módulos digitales permiten
escribir la secuencia de bits, usar una secuencia alternada o un generador PRBS-7.</p>
<h3>Validación</h3>
<p>Las pruebas cubren la pérdida de espacio libre, la potencia AM, la recuperación con y sin sobremodulación, la BER
de ASK/FSK/BPSK frente a la teoría, el efecto de la atenuación, la interferencia, el offset, el multitrayecto, el clip,
la cuantificación PCM, el aliasing y la reconstrucción sinc. También se abre la interfaz en modo offscreen y se captura
cada página para verificar que las gráficas se generan sin excepciones.</p>
<div class="note"><b>Reproducibilidad:</b> todas las señales aleatorias usan generadores de NumPy con semilla explícita.
La misma configuración y la misma semilla producen exactamente el mismo resultado.</div>

<h2><a name="referencias"></a>8. Referencias y trazabilidad</h2>
<ul>
<li>López Castellanos, P. N. (2008). <i>Apuntes de clase para el módulo de Transmisión de Datos</i>. UNDESCO.
Capítulo de modulación y demodulación, pp. 208–218 (AM), 226–228 (ASK), 229–230 (FSK), 230–232 (PSK) y 236–246 (PCM).</li>
<li>Proakis, J. G. y Salehi, M. (2008). <i>Digital Communications</i> (5.ª ed.). McGraw-Hill. Capítulos 3–4: modulaciones
digitales, detección y probabilidad de error.</li>
<li>Haykin, S. (2001). <i>Communication Systems</i> (4.ª ed.). Wiley. Modulación de amplitud, ruido y receptores.</li>
<li>Sklar, B. (2001). <i>Digital Communications: Fundamentals and Applications</i> (2.ª ed.). Prentice Hall.
ASK, FSK, PCM y curvas BER.</li>
<li>ITU-R P.525-4 (2019). <i>Calculation of free-space attenuation</i>. Unión Internacional de Telecomunicaciones.</li>
</ul>
<p class="small">El PDF del anexo es un documento escaneado; se verificó mediante OCR y lectura visual. Las ecuaciones
principales se contrastaron con las referencias anteriores. El anexo contiene una inconsistencia en la descripción de
V.22bis (2400 bit/s, M=4 → 1200 baudios frente a 600 baudios y 4 bits/baudio); V.22bis no forma parte de los módulos
solicitados y no se implementa. Esta nota se incluye para dejar constancia de la verificación, no para ampliar el alcance.</p>
<p class="small">Limitaciones: el canal es un modelo didáctico de banda ancha, no un canal 5G completo; no modela
desvanecimiento Rayleigh selectivo en frecuencia ni codificación de canal. El ruido es blanco y gaussiano. La
reconstrucción PCM es ideal (sinc ventaneada); un DAC real tendría cuantificación temporal y filtros analógicos.</p>

</body>
</html>
"""


class TheoryPage(QWidget):
    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 14)
        root.setSpacing(11)

        header = QVBoxLayout()
        title = QLabel("Marco teórico y verificación")
        title.setObjectName("PageTitle")
        subtitle = QLabel(
            "Ecuaciones, decisiones de diseño, modelo de canal, pruebas y referencias. "
            "Todo el contenido está enlazado con los cuatro módulos de la aplicación."
        )
        subtitle.setObjectName("PageSubtitle")
        subtitle.setWordWrap(True)
        header.addWidget(title)
        header.addWidget(subtitle)
        root.addLayout(header)

        body = QHBoxLayout()
        body.setSpacing(12)

        toc = QFrame()
        toc.setObjectName("ControlPanel")
        toc.setFixedWidth(230)
        tl = QVBoxLayout(toc)
        tl.setContentsMargins(12, 14, 12, 12)
        tl.setSpacing(5)
        lab = QLabel("CONTENIDO")
        lab.setObjectName("SectionTitle")
        tl.addWidget(lab)
        self.browser = QTextBrowser()
        self.browser.setOpenExternalLinks(True)
        self.browser.setHtml(THEORY_HTML)
        for text, anchor in [
            ("1 · Conceptos y unidades", "conceptos"),
            ("2 · AM", "am"),
            ("3 · ASK / OOK", "ask"),
            ("4 · FSK", "fsk"),
            ("5 · PCM", "pcm"),
            ("6 · Canal y factores", "canal"),
            ("7 · Implementación", "implementacion"),
            ("8 · Referencias", "referencias"),
        ]:
            btn = QPushButton(text)
            btn.setObjectName("Nav")
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(lambda _=False, a=anchor: self.browser.scrollToAnchor(a))
            tl.addWidget(btn)
        tl.addStretch(1)
        note = QLabel("Anexo: López Castellanos (UNDESCO, 2008)")
        note.setObjectName("Caption")
        note.setWordWrap(True)
        tl.addWidget(note)
        body.addWidget(toc)
        body.addWidget(self.browser, 1)
        root.addLayout(body, 1)
