"""Tema visual minimalista, suave y legible."""

from __future__ import annotations

import matplotlib as mpl
from PySide6.QtGui import QColor, QFont, QPalette
from PySide6.QtWidgets import QApplication

# Paleta base (suave, alto contraste funcional) ------------------------------
INK = "#f4f6f8"         # fondo principal
SURFACE = "#ffffff"      # paneles y gráficas
SURFACE_2 = "#fbfcfe"    # tarjetas
SURFACE_3 = "#eef2f6"    # controles suaves
BORDER = "#d7e0ea"
BORDER_SOFT = "#e6edf4"
TEXT = "#1f2937"
MUTED = "#526277"
FAINT = "#7b8b9c"

# Acentos legibles sobre fondo claro
CYAN = "#0f766e"         # teal
BLUE = "#2563eb"
AMBER = "#b45309"
MAGENTA = "#9333ea"
GREEN = "#15803d"
RED = "#dc2626"
VIOLET = "#6d28d9"

CHART_COLORS = {
    "message": "#334155",
    "tx": "#0f766e",
    "rx": "#c2410c",
    "clean": "#2563eb",
    "env": "#15803d",
    "coh": "#2563eb",
    "error": "#dc2626",
    "theory": "#94a3b8",
    "measured": "#0f766e",
    "grid": "#e7edf3",
    "noise": "#94a3b8",
    "accent": "#7c3aed",
}

APP_QSS = f"""
* {{
    font-family: "Inter", "Avenir Next", "Helvetica Neue", "Segoe UI", sans-serif;
    outline: none;
}}
QMainWindow, QWidget#Root {{
    background: {INK};
    color: {TEXT};
}}
QWidget {{
    color: {TEXT};
    font-size: 12px;
}}
QFrame#Sidebar {{
    background: {SURFACE};
    border-right: 1px solid {BORDER_SOFT};
}}
QFrame#Header {{
    background: transparent;
}}
QFrame#Card, QFrame#MetricCard, QFrame#ControlPanel, QFrame#PlotPanel {{
    background: {SURFACE};
    border: 1px solid {BORDER_SOFT};
    border-radius: 12px;
}}
QFrame#MetricCard {{
    background: {SURFACE_2};
    border-radius: 10px;
}}
QLabel#Brand {{
    color: {TEXT};
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.2px;
}}
QLabel#BrandSub {{
    color: {FAINT};
    font-size: 10px;
    letter-spacing: 1.2px;
}}
QLabel#PageTitle {{
    color: {TEXT};
    font-size: 23px;
    font-weight: 700;
}}
QLabel#PageSubtitle {{
    color: {MUTED};
    font-size: 12px;
}}
QLabel#SectionTitle {{
    color: {FAINT};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
}}
QLabel#FieldLabel {{
    color: {MUTED};
    font-size: 11px;
}}
QLabel#MetricTitle {{
    color: {FAINT};
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
}}
QLabel#MetricValue {{
    color: {TEXT};
    font-size: 19px;
    font-weight: 700;
}}
QLabel#MetricHint {{
    color: {FAINT};
    font-size: 10px;
}}
QLabel#Caption {{
    color: {FAINT};
    font-size: 10px;
}}

QPushButton {{
    background: {SURFACE};
    color: {TEXT};
    border: 1px solid {BORDER};
    border-radius: 8px;
    padding: 7px 12px;
    font-weight: 600;
}}
QPushButton:hover {{
    background: {SURFACE_3};
    border-color: #c5d2de;
}}
QPushButton:pressed {{
    background: #e6edf4;
}}
QPushButton:disabled {{
    color: #a3b1bf;
    background: #f8fafc;
    border-color: {BORDER_SOFT};
}}
QPushButton#Primary {{
    background: {CYAN};
    color: #ffffff;
    border: 1px solid {CYAN};
    font-weight: 700;
}}
QPushButton#Primary:hover {{
    background: #115e59;
    border-color: #115e59;
}}
QPushButton#Primary:pressed {{
    background: #134e4a;
}}
QPushButton#Ghost {{
    background: transparent;
    border: 1px solid {BORDER};
    color: {MUTED};
}}
QPushButton#Ghost:hover {{
    color: {TEXT};
    background: {SURFACE_2};
}}
QPushButton#Nav {{
    background: transparent;
    color: {MUTED};
    border: 0;
    border-radius: 9px;
    padding: 9px 11px;
    text-align: left;
    font-size: 13px;
    font-weight: 600;
}}
QPushButton#Nav:hover {{
    background: #f1f5f9;
    color: {TEXT};
}}
QPushButton#Nav:checked {{
    background: #ecfeff;
    color: {CYAN};
    border-left: 3px solid {CYAN};
    padding-left: 8px;
}}
QPushButton#Mini {{
    background: transparent;
    border: 1px solid {BORDER};
    border-radius: 6px;
    padding: 3px 8px;
    color: {MUTED};
    font-size: 10px;
}}
QPushButton#Mini:hover {{
    color: {TEXT};
    background: {SURFACE_3};
}}

QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox {{
    background: {SURFACE};
    color: {TEXT};
    border: 1px solid {BORDER};
    border-radius: 7px;
    padding: 6px 8px;
    min-height: 18px;
    selection-background-color: #ccfbf1;
    selection-color: {TEXT};
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDoubleSpinBox:focus {{
    border: 1px solid {CYAN};
    background: #ffffff;
}}
QLineEdit:disabled, QComboBox:disabled, QSpinBox:disabled, QDoubleSpinBox:disabled {{
    color: #a3b1bf;
    background: #f8fafc;
    border-color: {BORDER_SOFT};
}}
QComboBox::drop-down {{
    border: 0;
    width: 20px;
}}
QComboBox QAbstractItemView {{
    background: {SURFACE};
    color: {TEXT};
    border: 1px solid {BORDER};
    selection-background-color: #ecfeff;
    selection-color: {TEXT};
    padding: 3px;
}}
QSpinBox::up-button, QDoubleSpinBox::up-button,
QSpinBox::down-button, QDoubleSpinBox::down-button {{
    background: {SURFACE_3};
    border: 0;
    width: 16px;
}}
QCheckBox {{
    color: {MUTED};
    spacing: 8px;
}}
QCheckBox::indicator {{
    width: 15px;
    height: 15px;
    border: 1px solid {BORDER};
    border-radius: 4px;
    background: {SURFACE};
}}
QCheckBox::indicator:checked {{
    background: {CYAN};
    border-color: {CYAN};
}}
QCheckBox::indicator:hover {{
    border-color: #99b6cb;
}}

QGroupBox {{
    border: 1px solid {BORDER_SOFT};
    border-radius: 10px;
    margin-top: 10px;
    padding: 12px 10px 10px 10px;
    background: {SURFACE_2};
    font-weight: 600;
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 5px;
    color: {FAINT};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
}}
QScrollArea {{
    background: transparent;
    border: 0;
}}
QScrollArea > QWidget > QWidget {{
    background: transparent;
}}
QScrollBar:vertical {{
    background: transparent;
    width: 9px;
    margin: 2px;
}}
QScrollBar::handle:vertical {{
    background: #c8d4df;
    border-radius: 4px;
    min-height: 24px;
}}
QScrollBar::handle:vertical:hover {{
    background: #aebfce;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0;
}}
QScrollBar:horizontal {{
    background: transparent;
    height: 9px;
    margin: 2px;
}}
QScrollBar::handle:horizontal {{
    background: #c8d4df;
    border-radius: 4px;
    min-width: 24px;
}}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    width: 0;
}}

QSplitter::handle {{
    background: transparent;
    width: 8px;
}}
QStatusBar {{
    background: {SURFACE};
    color: {MUTED};
    border-top: 1px solid {BORDER_SOFT};
    font-size: 10px;
}}
QToolTip {{
    background: {SURFACE};
    color: {TEXT};
    border: 1px solid {BORDER};
    padding: 5px 7px;
    border-radius: 6px;
}}
QTextBrowser {{
    background: {SURFACE};
    color: {TEXT};
    border: 1px solid {BORDER_SOFT};
    border-radius: 12px;
    padding: 22px;
    selection-background-color: #ccfbf1;
}}
QTextBrowser a {{
    color: {CYAN};
}}
QTabWidget::pane {{
    border: 1px solid {BORDER_SOFT};
    border-radius: 10px;
    background: {SURFACE};
}}
QTabBar::tab {{
    background: transparent;
    color: {MUTED};
    padding: 7px 14px;
    border: 0;
    font-weight: 600;
}}
QTabBar::tab:selected {{
    color: {CYAN};
    border-bottom: 2px solid {CYAN};
}}
QToolBar {{
    background: transparent;
    border: 0;
    spacing: 2px;
}}
QToolButton {{
    background: transparent;
    color: {MUTED};
    border: 0;
    border-radius: 5px;
    padding: 3px;
}}
QToolButton:hover {{
    background: {SURFACE_3};
    color: {TEXT};
}}
"""


def apply_theme(app: QApplication) -> None:
    """Aplica el tema a Qt y a matplotlib."""
    app.setStyle("Fusion")
    app.setStyleSheet(APP_QSS)
    font = QFont("Avenir Next", 12)
    font.setStyleStrategy(QFont.PreferAntialias)
    app.setFont(font)

    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(INK))
    palette.setColor(QPalette.WindowText, QColor(TEXT))
    palette.setColor(QPalette.Base, QColor(SURFACE))
    palette.setColor(QPalette.AlternateBase, QColor(SURFACE_2))
    palette.setColor(QPalette.Text, QColor(TEXT))
    palette.setColor(QPalette.Button, QColor(SURFACE_3))
    palette.setColor(QPalette.ButtonText, QColor(TEXT))
    palette.setColor(QPalette.Highlight, QColor("#99f6e4"))
    palette.setColor(QPalette.HighlightedText, QColor(TEXT))
    palette.setColor(QPalette.ToolTipBase, QColor(SURFACE))
    palette.setColor(QPalette.ToolTipText, QColor(TEXT))
    palette.setColor(QPalette.PlaceholderText, QColor(FAINT))
    app.setPalette(palette)

    mpl.rcParams.update(
        {
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "savefig.facecolor": SURFACE,
            "axes.edgecolor": BORDER,
            "axes.labelcolor": MUTED,
            "axes.titlecolor": TEXT,
            "axes.titlesize": 10.5,
            "axes.titleweight": "bold",
            "axes.labelsize": 9.5,
            "axes.grid": True,
            "grid.color": CHART_COLORS["grid"],
            "grid.alpha": 0.9,
            "grid.linewidth": 0.7,
            "xtick.color": FAINT,
            "ytick.color": FAINT,
            "xtick.labelsize": 8.5,
            "ytick.labelsize": 8.5,
            "text.color": TEXT,
            "legend.facecolor": SURFACE,
            "legend.edgecolor": BORDER_SOFT,
            "legend.labelcolor": TEXT,
            "legend.fontsize": 8.2,
            "legend.framealpha": 0.95,
            "lines.linewidth": 1.5,
            "font.family": "sans-serif",
            "font.sans-serif": ["Avenir Next", "Helvetica Neue", "DejaVu Sans"],
        }
    )
