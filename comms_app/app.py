"""Punto de entrada de la aplicación de escritorio."""

from __future__ import annotations

import sys

import matplotlib

matplotlib.use("QtAgg")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from .gui.main_window import MainWindow
from .gui.theme import apply_theme


def create_app(argv: list[str] | None = None) -> tuple[QApplication, MainWindow]:
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(argv if argv is not None else sys.argv)
    app.setApplicationName("Señales · Laboratorio de Comunicaciones")
    app.setOrganizationName("SenalesLab")
    apply_theme(app)
    window = MainWindow()
    return app, window


def main() -> int:
    app, window = create_app()
    window.show()
    return app.exec()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
