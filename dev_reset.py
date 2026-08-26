"""Entwickler-Werkzeug: versetzt den Projektordner in den Zustand einer
Neuinstallation, um das Verhalten fuer neue Nutzer zu testen. Loescht nichts
endgueltig - data/ und config.json werden zeitgestempelt beiseite verschoben,
init_db() bzw. load_config() legen beim naechsten Start automatisch frische
Versionen an (siehe app/config.py, app/db.py)."""
import shutil
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = BASE_DIR / "config.json"


def main():
    print("=" * 50)
    print("  Trade Journal - Entwickler-Reset")
    print("=" * 50)
    print()
    print("Das verschiebt data\\ und config.json in einen zeitgestempelten")
    print("Backup-Ordner (nichts wird endgueltig geloescht). Die App startet")
    print("danach wie bei einer Neuinstallation - alle Trades, Konten, Bilder")
    print("und Einstellungen sind im laufenden Programm weg.")
    print()

    if not DATA_DIR.exists() and not CONFIG_PATH.exists():
        print("Es gibt aktuell keine data\\ und keine config.json - nichts zu tun.")
        return

    confirm = input("Zum Bestaetigen 'RESET' eintippen: ")
    if confirm != "RESET":
        print("Abgebrochen.")
        return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    if DATA_DIR.exists():
        dest = BASE_DIR / f"data_reset_backup_{ts}"
        shutil.move(str(DATA_DIR), str(dest))
        print(f"data\\ -> {dest.name}\\")

    if CONFIG_PATH.exists():
        dest = BASE_DIR / f"config_reset_backup_{ts}.json"
        shutil.move(str(CONFIG_PATH), str(dest))
        print(f"config.json -> {dest.name}")

    print()
    print("Fertig. Naechster Start (start.bat / python run.py) erzeugt eine")
    print("frische, leere Datenbank und eine Standard-config.json.")


if __name__ == "__main__":
    main()
