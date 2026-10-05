"""Taegliche Datensicherung: trades.db plus data/images.

Frueher entstand ein Backup nur vor Datenbank-Migrationen (db._backup_db) -
Journal, Notizen und Screenshots lagen sonst ungesichert auf einer einzigen
Platte. Jetzt einmal pro Kalendertag beim Start (siehe main._startup_tasks)
bzw. auf Knopfdruck in den Einstellungen.

Ziel ist standardmaessig data/backups/daily; in den Einstellungen kann ein
eigener Ordner hinterlegt werden (externe Platte, OneDrive ...). Dort werden
die Broker-Passwoerter in der Kopie geleert, weil trades.db sie im Klartext
enthaelt und ein Cloud-Ordner sie sonst mit hochladen wuerde - nach einer
Wiederherstellung aus so einer Sicherung muessen sie neu eingetragen werden.
"""
import os
import shutil
import sqlite3
import tempfile
from datetime import date, datetime
from pathlib import Path

from . import db
from .config import DATA_DIR, DB_PATH, IMAGES_DIR

DEFAULT_BACKUP_DIR = DATA_DIR / "backups" / "daily"
KEEP_DAILY = 14
_PREFIX = "trades_daily_"


def backup_target() -> tuple[Path, bool]:
    """(Zielordner, ist_extern). Ein leerer Eintrag heisst Standardordner."""
    custom = (db.get_app_setting("backup_dir") or "").strip()
    if custom:
        return Path(custom), True
    return DEFAULT_BACKUP_DIR, False


def status() -> dict:
    target, external = backup_target()
    return {
        "backup_dir": db.get_app_setting("backup_dir") or "",
        "target": str(target),
        "external": external,
        "default_dir": str(DEFAULT_BACKUP_DIR),
        "last_at": db.get_app_setting("backup_last_at"),
        "last_file": db.get_app_setting("backup_last_file"),
        "last_error": db.get_app_setting("backup_last_error") or None,
        "keep": KEEP_DAILY,
    }


def _copy_db(dest: Path, scrub_passwords: bool):
    """sqlite3-Backup-API statt Dateikopie: liefert auch bei laufendem Server
    und offener WAL-Datei einen in sich konsistenten Stand.

    Mit scrub_passwords entsteht die Zwischenkopie im lokalen Temp-Ordner,
    nicht im Ziel: dort laege sie sonst mit Klartext-Passwoertern, bis UPDATE
    und VACUUM durch sind - ein Cloud-Client (OneDrive) koennte sie in dem
    Moment hochladen, und bei einem Fehler bliebe sie dauerhaft liegen. Ins
    Ziel kommt nur die fertig geleerte Datei."""
    if scrub_passwords:
        fd, name = tempfile.mkstemp(suffix=".db", prefix="trade_journal_backup_")
        os.close(fd)
        tmp = Path(name)
    else:
        tmp = dest.with_suffix(".tmp")
    try:
        src = sqlite3.connect(DB_PATH, timeout=10)
        out = sqlite3.connect(tmp)
        try:
            src.backup(out)
            if scrub_passwords:
                out.execute("UPDATE broker_accounts SET password = ''")
                out.commit()
                out.execute("VACUUM")  # geleerte Passwoerter nicht in freien Seiten stehen lassen
        finally:
            out.close()
            src.close()
        # move statt replace: Temp-Ordner und Ziel liegen oft auf
        # verschiedenen Laufwerken, replace() kann das nicht
        shutil.move(str(tmp), str(dest))
    finally:
        tmp.unlink(missing_ok=True)


def _sync_images(dest_dir: Path) -> int:
    """Inkrementell: nur Bilder kopieren, die im Ziel noch fehlen. Bilder sind
    unveraenderlich (neuer Dateiname je Upload), ein Groessenvergleich ist
    deshalb unnoetig. Im Ziel wird bewusst nichts geloescht - ein versehentlich
    in der App geloeschtes Bild bleibt so in der Sicherung erhalten."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    existing = {p.name for p in dest_dir.iterdir()}
    copied = 0
    for p in IMAGES_DIR.iterdir():
        if p.is_file() and p.name not in existing:
            shutil.copy2(p, dest_dir / p.name)
            copied += 1
    return copied


def run_backup() -> dict:
    """Schreibt eine Sicherung und haelt die letzten KEEP_DAILY Datenbank-
    Staende. Fehler werden in app_settings vermerkt (Einstellungen zeigen sie
    an) und weitergereicht."""
    target, external = backup_target()
    try:
        target.mkdir(parents=True, exist_ok=True)
        dest = target / f"{_PREFIX}{datetime.now():%Y%m%d_%H%M%S}.db"
        _copy_db(dest, scrub_passwords=external)
        images_copied = _sync_images(target / "images")
        for old in sorted(target.glob(f"{_PREFIX}*.db"))[:-KEEP_DAILY]:
            old.unlink()
    except Exception as e:
        db.set_app_setting("backup_last_error", f"{datetime.now():%d.%m.%Y %H:%M}: {e}")
        raise
    db.set_app_setting("backup_last_at", datetime.now().isoformat(timespec="seconds"))
    db.set_app_setting("backup_last_date", date.today().isoformat())
    db.set_app_setting("backup_last_file", str(dest))
    db.set_app_setting("backup_last_error", "")
    return {"file": str(dest), "images_copied": images_copied}


def maybe_run_daily() -> dict | None:
    """Einmal pro Kalendertag - weitere Starts am selben Tag kosten nichts."""
    if db.get_app_setting("backup_last_date") == date.today().isoformat():
        return None
    return run_backup()
