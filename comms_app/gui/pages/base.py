"""Página base para los módulos de simulación."""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from PySide6.QtCore import QThreadPool, Qt
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from ...core.channel import ChannelReport
from ..theme import AMBER, BORDER, CYAN, FAINT, GREEN, MAGENTA, MUTED, RED, TEXT, VIOLET
from ..widgets import MetricCard, PlotCanvas, SimulationWorker, section_label


class SimulationPage(QWidget):
    """Estructura común: encabezado, métricas, controles y gráficas."""

    accent = CYAN

    def __init__(
        self,
        title: str,
        subtitle: str,
        *,
        plot_rows: int = 2,
        plot_cols: int = 2,
        figsize: tuple[float, float] = (10.0, 6.8),
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.page_title = title
        self.page_subtitle = subtitle
        self._result: Any = None
        self._busy = False
        self._run_token = 0
        self._active_worker = None
        self._threadpool = QThreadPool.globalInstance()

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 14)
        root.setSpacing(11)

        # Encabezado ---------------------------------------------------------
        header = QHBoxLayout()
        header.setSpacing(14)
        title_box = QVBoxLayout()
        title_box.setSpacing(2)
        self.title_label = QLabel(title)
        self.title_label.setObjectName("PageTitle")
        self.subtitle_label = QLabel(subtitle)
        self.subtitle_label.setObjectName("PageSubtitle")
        self.subtitle_label.setWordWrap(True)
        title_box.addWidget(self.title_label)
        title_box.addWidget(self.subtitle_label)
        header.addLayout(title_box, 1)

        self.sim_btn = QPushButton("Simular")
        self.sim_btn.setObjectName("Primary")
        self.sim_btn.setToolTip("Ejecuta la simulación (Ctrl+Enter)")
        self.sim_btn.clicked.connect(lambda: self.run_simulation())
        self.reset_btn = QPushButton("Reiniciar")
        self.reset_btn.setObjectName("Ghost")
        self.reset_btn.setToolTip("Restaura los valores iniciales (Ctrl+R)")
        self.reset_btn.clicked.connect(self.reset)
        self.csv_btn = QPushButton("Exportar CSV")
        self.csv_btn.setObjectName("Ghost")
        self.csv_btn.clicked.connect(self._choose_csv)
        self.png_btn = QPushButton("Guardar figura")
        self.png_btn.setObjectName("Ghost")
        self.png_btn.clicked.connect(self._choose_png)
        for b in (self.sim_btn, self.reset_btn, self.csv_btn, self.png_btn):
            header.addWidget(b, 0, Qt.AlignBottom)
        root.addLayout(header)

        # Aviso de error -----------------------------------------------------
        self.error_banner = QLabel()
        self.error_banner.setWordWrap(True)
        self.error_banner.setVisible(False)
        self.error_banner.setStyleSheet(
            f"background:rgba(251,113,133,0.10); color:{RED}; border:1px solid rgba(251,113,133,0.45);"
            "border-radius:8px; padding:7px 10px; font-size:11px;"
        )
        root.addWidget(self.error_banner)

        # Métricas -----------------------------------------------------------
        self.metrics_layout = QHBoxLayout()
        self.metrics_layout.setSpacing(8)
        self.metrics: dict[str, MetricCard] = {}
        root.addLayout(self.metrics_layout)

        # Controles + gráficas ----------------------------------------------
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.setHandleWidth(8)

        control_panel = QFrame()
        control_panel.setObjectName("ControlPanel")
        control_panel.setMinimumWidth(300)
        control_panel.setMaximumWidth(380)
        cp = QVBoxLayout(control_panel)
        cp.setContentsMargins(10, 10, 8, 10)
        cp.setSpacing(6)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        controls_host = QWidget()
        self.controls_layout = QVBoxLayout(controls_host)
        self.controls_layout.setContentsMargins(2, 2, 6, 2)
        self.controls_layout.setSpacing(9)
        self.controls_layout.addStretch(1)
        scroll.setWidget(controls_host)
        cp.addWidget(scroll, 1)
        self.control_footer = QLabel("Pulsa <b>Simular</b> para aplicar los cambios.")
        self.control_footer.setObjectName("Caption")
        self.control_footer.setWordWrap(True)
        cp.addWidget(self.control_footer)
        splitter.addWidget(control_panel)

        plot_panel = QFrame()
        plot_panel.setObjectName("PlotPanel")
        pp = QVBoxLayout(plot_panel)
        pp.setContentsMargins(7, 7, 7, 4)
        pp.setSpacing(0)
        self.plot = PlotCanvas(plot_rows, plot_cols, figsize=figsize)
        pp.addWidget(self.plot, 1)
        status_row = QHBoxLayout()
        status_row.setContentsMargins(8, 1, 8, 3)
        self.status_label = QLabel("Listo")
        self.status_label.setObjectName("Caption")
        self.status_label.setStyleSheet(f"color:{FAINT}; font-size:9px;")
        self.source_label = QLabel("")
        self.source_label.setObjectName("Caption")
        self.source_label.setStyleSheet(f"color:{FAINT}; font-size:9px;")
        status_row.addWidget(self.status_label, 1)
        status_row.addWidget(self.source_label, 0)
        pp.addLayout(status_row)
        splitter.addWidget(plot_panel)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([340, 1000])
        root.addWidget(splitter, 1)

        QShortcut(QKeySequence("Ctrl+Return"), self, activated=self.run_simulation)
        QShortcut(QKeySequence("Ctrl+R"), self, activated=self.reset)

        self.build_metrics()
        self.build_controls()
        self.build_plots()

    # -- Construcción --------------------------------------------------------
    def add_metric(self, key: str, title: str, accent: str = CYAN, hint: str = "") -> MetricCard:
        card = MetricCard(title, hint=hint, accent=accent)
        self.metrics[key] = card
        self.metrics_layout.addWidget(card, 1)
        return card

    def add_control(self, widget: QWidget) -> None:
        self.controls_layout.insertWidget(self.controls_layout.count() - 1, widget)

    def build_metrics(self) -> None:  # pragma: no cover - interfaz
        pass

    def build_controls(self) -> None:  # pragma: no cover - interfaz
        pass

    def build_plots(self) -> None:  # pragma: no cover - interfaz
        pass

    # -- Simulación ----------------------------------------------------------
    def make_config(self) -> Any:  # pragma: no cover - interfaz
        raise NotImplementedError

    def compute(self, cfg: Any) -> Any:  # pragma: no cover - interfaz
        raise NotImplementedError

    def present(self, result: Any) -> None:  # pragma: no cover - interfaz
        raise NotImplementedError

    def export_rows(self) -> tuple[list[str], list[list[float]]]:  # pragma: no cover
        raise NotImplementedError

    def defaults(self) -> None:  # pragma: no cover - interfaz
        pass

    def source_text(self, cfg: Any) -> str:
        return ""

    def run_simulation(self, *, synchronous: bool = False) -> Any:
        if self._busy:
            return None
        self.error_banner.setVisible(False)
        try:
            cfg = self.make_config()
        except Exception as exc:  # noqa: BLE001
            self.show_error(str(exc))
            return None

        self._run_token += 1
        token = self._run_token
        self._busy = True
        self.sim_btn.setEnabled(False)
        self.sim_btn.setText("Calculando…")
        self.status_label.setText("Simulando…")
        t0 = time.perf_counter()

        if synchronous:
            try:
                result = self.compute(cfg)
            except Exception as exc:  # noqa: BLE001
                self._busy = False
                self.sim_btn.setEnabled(True)
                self.sim_btn.setText("Simular")
                self.show_error(str(exc))
                return None
            self._finish(token, result, cfg, time.perf_counter() - t0)
            return result

        def work():
            return self.compute(cfg)

        worker = SimulationWorker(work)
        worker.setAutoDelete(False)
        self._active_worker = (token, worker)
        worker.signals.finished.connect(
            lambda result, tok=token, c=cfg, start=t0: self._finish(tok, result, c, time.perf_counter() - start)
        )
        worker.signals.failed.connect(lambda msg, tok=token: self._fail(tok, msg))
        self._threadpool.start(worker)
        return None

    def _finish(self, token: int, result: Any, cfg: Any, elapsed: float) -> None:
        if token != self._run_token:
            return
        self._active_worker = None
        self._busy = False
        self.sim_btn.setEnabled(True)
        self.sim_btn.setText("Simular")
        self._result = result
        try:
            self.present(result)
        except Exception as exc:  # noqa: BLE001
            self.show_error(f"No se pudo dibujar el resultado: {exc}")
            return
        report: ChannelReport | None = getattr(result, "report", None)
        extra = ""
        if report is not None:
            extra = f" · pérdida {report.total_atten_db:.1f} dB"
        self.status_label.setText(f"Listo · {elapsed * 1000:.0f} ms{extra}")
        self.source_label.setText(self.source_text(cfg))

    def _fail(self, token: int, message: str) -> None:
        if token != self._run_token:
            return
        self._active_worker = None
        self._busy = False
        self.sim_btn.setEnabled(True)
        self.sim_btn.setText("Simular")
        self.status_label.setText("Error de simulación")
        self.show_error(message)

    def show_error(self, message: str) -> None:
        self.error_banner.setText(f"No se pudo simular: {message}")
        self.error_banner.setVisible(True)
        self.status_label.setText("Error de simulación")

    def reset(self) -> None:
        self.error_banner.setVisible(False)
        self.defaults()
        self.run_simulation()

    # -- Exportación ---------------------------------------------------------
    def _choose_csv(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Guardar datos de la simulación", f"{self.page_title.lower()}_datos.csv", "CSV (*.csv)"
        )
        if path:
            try:
                self.export_to(path)
            except Exception as exc:  # noqa: BLE001
                self.show_error(str(exc))

    def _choose_png(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Guardar figura", f"{self.page_title.lower()}_figura.png", "PNG (*.png);;PDF (*.pdf)"
        )
        if path:
            try:
                self.plot.save(path)
            except Exception as exc:  # noqa: BLE001
                self.show_error(f"No se pudo guardar la figura: {exc}")

    def export_to(self, path: str) -> None:
        """Exporta las series principales a CSV (dos columnas por serie)."""
        headers, columns = self.export_rows()
        n = max(len(c) for c in columns) if columns else 0
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(",".join(headers) + "\n")
            for i in range(n):
                vals = []
                for col in columns:
                    vals.append(f"{col[i]:.10g}" if i < len(col) else "")
                fh.write(",".join(vals) + "\n")

    def metrics_json(self) -> str:
        res = self._result
        if res is None:
            return "{}"
        metrics = getattr(res, "metrics", None)
        if metrics is None:
            metrics = {
                "ber": getattr(res, "ber", None),
                "ebn0_eff_db": getattr(res, "ebn0_eff_db", None),
            }
        return json.dumps(metrics, indent=2, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# Utilidades de formato
# ---------------------------------------------------------------------------


def fmt(value: float, unit: str = "", digits: int = 1) -> str:
    if value is None:
        return "—"
    if value == float("inf"):
        return "∞"
    unit = unit.strip()
    sep = f" {unit}" if unit else ""
    if abs(value) >= 1e6:
        return f"{value / 1e6:.{digits}f} M{sep}".replace(" M ", " M") if not unit else f"{value / 1e6:.{digits}f} M{unit}"
    if abs(value) >= 1e3:
        return f"{value / 1e3:.{digits}f} k{unit}" if unit else f"{value / 1e3:.{digits}f} k"
    if unit:
        return f"{value:.{digits}f} {unit}"
    return f"{value:.{digits}f}"


def db_text(value: float, digits: int = 1) -> str:
    return "∞" if value == float("inf") else f"{value:.{digits}f} dB"


def pct(value: float, digits: int = 1) -> str:
    return f"{100.0 * value:.{digits}f} %"


def bits_text(bits) -> str:
    return "".join(str(int(b)) for b in bits)
