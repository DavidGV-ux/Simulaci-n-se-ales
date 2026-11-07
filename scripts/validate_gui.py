"""Validación visual offscreen de la interfaz.

Genera capturas de cada módulo y algunos escenarios de canal para revisión.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("MPLBACKEND", "Agg")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from PySide6.QtWidgets import QApplication

from comms_app.gui.main_window import MainWindow
from comms_app.gui.theme import apply_theme


def save(window, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    window.grab().save(str(path))
    print(f"saved {path}")


def main() -> int:
    app = QApplication.instance() or QApplication([])
    apply_theme(app)
    w = MainWindow(auto_run=False)
    w.resize(1500, 950)
    w.show()
    app.processEvents()

    out = ROOT / "validation"
    for i, page in enumerate(w.pages[:4]):
        page.run_simulation(synchronous=True)
        app.processEvents()
        w.show_page(i, simulate=False)
        app.processEvents()
        save(w, out / f"page_{i}.png")

    w.show_page(4, simulate=False)
    app.processEvents()
    save(w, out / "page_4.png")

    # Escenarios representativos
    am = w.pages[0]
    am.m.setValue(1.5)
    am.channel.preset.setCurrentText("Interferencia")
    am.channel._apply_preset()
    am.run_simulation(synchronous=True)
    w.show_page(0, simulate=False)
    app.processEvents()
    save(w, out / "am_overmodulation_interference.png")

    ask = w.pages[1]
    ask.channel.nominal.setValue(6.0)
    ask.channel._update_link_label()
    ask.run_simulation(synchronous=True)
    w.show_page(1, simulate=False)
    app.processEvents()
    save(w, out / "ask_low_ebn0.png")

    fsk = w.pages[2]
    fsk.channel.preset.setCurrentText("Multitrayecto")
    fsk.channel._apply_preset()
    fsk.run_simulation(synchronous=True)
    w.show_page(2, simulate=False)
    app.processEvents()
    save(w, out / "fsk_multipath.png")

    pcm = w.pages[3]
    pcm.fm.setValue(5000.0)
    pcm.fs_sample.setValue(8000.0)
    pcm.antialias.setChecked(False)
    pcm.channel.nominal.setValue(4.0)
    pcm.channel._update_link_label()
    pcm._sync_carrier()
    pcm.run_simulation(synchronous=True)
    w.show_page(3, simulate=False)
    app.processEvents()
    save(w, out / "pcm_alias_threshold.png")

    w.close()
    print("validation complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
