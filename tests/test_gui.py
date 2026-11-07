"""Pruebas de la interfaz en modo offscreen."""

from __future__ import annotations

import pytest

pytest.importorskip("PySide6")


@pytest.fixture(scope="module")
def qapp():
    from PySide6.QtWidgets import QApplication

    from comms_app.gui.theme import apply_theme

    app = QApplication.instance() or QApplication([])
    apply_theme(app)
    return app


def test_window_and_pages_simulate(qapp):
    from comms_app.gui.main_window import MainWindow

    w = MainWindow(auto_run=False)
    w.show()
    qapp.processEvents()
    try:
        for i in range(4):
            page = w.pages[i]
            result = page.run_simulation(synchronous=True)
            assert result is not None
            assert page._result is not None
            qapp.processEvents()
        w.show_page(4, simulate=False)
        qapp.processEvents()
    finally:
        w.close()
