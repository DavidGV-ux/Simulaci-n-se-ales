"""Ventana principal y navegación de la aplicación."""

from __future__ import annotations

from PySide6.QtCore import QSettings, QSize, Qt, QTimer
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)

from .pages.am import AMPage
from .pages.ask import ASKPage
from .pages.fsk import FSKPage
from .pages.pcm import PCMPage
from .pages.theory import TheoryPage
from .theme import BORDER_SOFT, CYAN, FAINT, MAGENTA, MUTED, SURFACE, TEXT


class MainWindow(QMainWindow):
    def __init__(self, *, auto_run: bool = True, parent: QWidget | None = None):
        super().__init__(parent)
        self.setWindowTitle("Señales · Laboratorio de Comunicaciones")
        self.resize(1500, 950)
        self.setMinimumSize(1180, 780)
        self._settings = QSettings("SenalesLab", "CommsSim")
        self._auto_run = auto_run

        root = QWidget()
        root.setObjectName("Root")
        layout = QHBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.setCentralWidget(root)

        # Barra lateral ------------------------------------------------------
        sidebar = QFrame()
        sidebar.setObjectName("Sidebar")
        sidebar.setFixedWidth(236)
        sl = QVBoxLayout(sidebar)
        sl.setContentsMargins(16, 22, 16, 16)
        sl.setSpacing(6)

        brand_row = QHBoxLayout()
        brand_row.setSpacing(9)
        logo = QLabel("∿")
        logo.setStyleSheet(
            f"color:{CYAN}; font-size:28px; font-weight:700; background:#ecfeff;"
            f"border:1px solid #99f6e4; border-radius:10px; padding:0 7px;"
        )
        logo.setFixedSize(42, 42)
        logo.setAlignment(Qt.AlignCenter)
        brand_col = QVBoxLayout()
        brand_col.setSpacing(0)
        brand = QLabel("SEÑALES")
        brand.setObjectName("Brand")
        brand_sub = QLabel("LABORATORIO")
        brand_sub.setObjectName("BrandSub")
        brand_col.addWidget(brand)
        brand_col.addWidget(brand_sub)
        brand_row.addWidget(logo)
        brand_row.addLayout(brand_col, 1)
        sl.addLayout(brand_row)
        sl.addSpacing(22)

        nav_label = QLabel("MÓDULOS")
        nav_label.setObjectName("SectionTitle")
        sl.addWidget(nav_label)
        sl.addSpacing(2)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons: list[QPushButton] = []
        navs = [
            ("AM", "Amplitud · AM", "Portadora analógica y detectores"),
            ("ASK", "Amplitud · ASK", "OOK, ojo y BER"),
            ("FSK", "Frecuencia · FSK", "Tonos, fase y BER"),
            ("PCM", "Pulsos · PCM", "Muestreo, cuantización y enlace"),
        ]
        accent_by_index = [CYAN, "#2dd4bf", "#fbbf24", "#a78bfa"]
        for i, (key, label, tip) in enumerate(navs):
            btn = QPushButton(f"  {label}")
            btn.setObjectName("Nav")
            btn.setCheckable(True)
            btn.setToolTip(tip)
            btn.setCursor(Qt.PointingHandCursor)
            self.nav_group.addButton(btn, i)
            self.nav_buttons.append(btn)
            sl.addWidget(btn)
        self.nav_buttons[0].setChecked(True)

        sl.addSpacing(18)
        theory_label = QLabel("DOCUMENTACIÓN")
        theory_label.setObjectName("SectionTitle")
        sl.addWidget(theory_label)
        self.theory_btn = QPushButton("  Marco teórico")
        self.theory_btn.setObjectName("Nav")
        self.theory_btn.setCheckable(True)
        self.theory_btn.setCursor(Qt.PointingHandCursor)
        self.nav_group.addButton(self.theory_btn, 4)
        sl.addWidget(self.theory_btn)

        sl.addStretch(1)
        sep = QFrame()
        sep.setFixedHeight(1)
        sep.setStyleSheet(f"background:{BORDER_SOFT};")
        sl.addWidget(sep)
        sl.addSpacing(8)
        info = QLabel(
            "Modelo de canal<br>"
            "<span style='color:#93a4bf'>AWGN · multitrayecto · interferencia<br>"
            "CFO · ruido de fase · AGC · clip</span>"
        )
        info.setObjectName("Caption")
        info.setWordWrap(True)
        sl.addWidget(info)
        sl.addSpacing(8)
        source = QLabel("Basado en López Castellanos (UNDESCO, 2008)")
        source.setObjectName("Caption")
        source.setWordWrap(True)
        sl.addWidget(source)
        version = QLabel("v1.0 · Python · NumPy · PySide6")
        version.setObjectName("Caption")
        version.setStyleSheet(f"color:{FAINT};")
        sl.addWidget(version)
        layout.addWidget(sidebar)

        # Contenido ----------------------------------------------------------
        self.stack = QStackedWidget()
        self.pages = [
            AMPage(),
            ASKPage(),
            FSKPage(),
            PCMPage(),
            TheoryPage(),
        ]
        for page in self.pages:
            self.stack.addWidget(page)
        layout.addWidget(self.stack, 1)

        self.nav_group.idClicked.connect(self.show_page)

        for i in range(5):
            sc = QShortcut(QKeySequence(f"Ctrl+{i+1}"), self)
            sc.activated.connect(lambda idx=i: self.show_page(idx))

        status = QStatusBar()
        self.setStatusBar(status)
        self.status_left = QLabel("Listo · simulaciones deterministas por semilla")
        self.status_left.setStyleSheet(f"color:{MUTED}; font-size:10px;")
        self.status_right = QLabel("Ctrl+Enter: simular · Ctrl+R: reiniciar · Ctrl+1…5: módulos")
        self.status_right.setStyleSheet(f"color:{FAINT}; font-size:10px;")
        status.addWidget(self.status_left, 1)
        status.addPermanentWidget(self.status_right)

        self.show_page(0, simulate=False)

        geometry = self._settings.value("geometry")
        if geometry is not None:
            self.restoreGeometry(geometry)
        last = int(self._settings.value("page", 0) or 0)
        if 0 <= last < len(self.pages):
            QTimer.singleShot(0, lambda: self.show_page(last, simulate=False))

        if auto_run:
            QTimer.singleShot(180, self._auto_simulate)

    # -- Navegación ----------------------------------------------------------
    def show_page(self, index: int, *, simulate: bool = True) -> None:
        if not 0 <= index < len(self.pages):
            return
        self.stack.setCurrentIndex(index)
        for i, btn in enumerate(self.nav_buttons):
            btn.setChecked(i == index)
        self.theory_btn.setChecked(index == 4)
        page = self.pages[index]
        if index == 4:
            self.status_left.setText("Marco teórico · ecuaciones, canal, implementación y referencias")
            return
        self.status_left.setText(
            f"{page.page_title} · ajusta los controles y pulsa Simular"
        )
        if simulate and self._auto_run and page._result is None and not page._busy:
            QTimer.singleShot(30, page.run_simulation)

    def _auto_simulate(self) -> None:
        index = self.stack.currentIndex()
        if index != 4:
            page = self.pages[index]
            if page._result is None and not page._busy:
                page.run_simulation()

    def closeEvent(self, event) -> None:  # noqa: N802 - API Qt
        self._settings.setValue("geometry", self.saveGeometry())
        self._settings.setValue("page", self.stack.currentIndex())
        super().closeEvent(event)
