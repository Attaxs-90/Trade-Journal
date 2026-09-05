import logging.handlers
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

from app.config import DATA_DIR

HOST = "127.0.0.1"
PORT = 8420
URL = f"http://{HOST}:{PORT}"

LOG_PATH = DATA_DIR / "server.log"


def _setup_logging():
    # Rotierendes File-Log statt unbegrenzt wachsender Konsolen-Umleitung -
    # data/server.log liegt im Nutzerdaten-Verzeichnis (Laufzeitdaten, kein Code-Artefakt).
    # log_config=None bei uvicorn.run() verhindert, dass uvicorn diese Handler
    # beim Start per dictConfig() wieder entfernt.
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_PATH, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler.setFormatter(formatter)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    # Handler nur am Parent-Logger "uvicorn" anhaengen - "uvicorn.error" und
    # "uvicorn.access" sind Kindlogger und propagieren dorthin von selbst.
    # Handler zusaetzlich an den Kindern haette jede Zeile doppelt geloggt.
    root = logging.getLogger("uvicorn")
    root.addHandler(file_handler)
    root.addHandler(console_handler)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).setLevel(logging.INFO)


def _already_running() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, PORT)) == 0


def _open_browser():
    webbrowser.open(URL)


def _wait_and_open_browser():
    # Der Server nimmt den Port erst an, sobald der automatische Start-Sync
    # aller MT5-Konten durchgelaufen ist (siehe app.main._startup_sync_mt5_accounts,
    # laeuft in der FastAPI-Lifespan vor dem eigentlichen Serving) - deshalb ein
    # Poll auf denselben Verbindungstest statt eines festen Timers, sonst zeigt
    # der Browser beim Oeffnen noch die Daten vom letzten Sync.
    while not _already_running():
        time.sleep(0.3)
    _open_browser()


if __name__ == "__main__":
    if _already_running():
        print(f"Trade Journal laeuft bereits unter {URL} - oeffne Browser.")
        _open_browser()
        sys.exit(0)

    _setup_logging()
    threading.Thread(target=_wait_and_open_browser, daemon=True).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False, log_config=None)
