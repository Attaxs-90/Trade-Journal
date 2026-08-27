import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from .config import DB_PATH, DATA_DIR

BACKUP_DIR = DATA_DIR / "backups"
BACKUP_DIR.mkdir(exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    instrument TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_time TEXT NOT NULL,
    exit_time TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    exit_type TEXT,
    points REAL NOT NULL,
    gross_usd REAL NOT NULL,
    commission_usd REAL NOT NULL,
    net_usd REAL NOT NULL,
    entry_order_id TEXT NOT NULL,
    exit_order_id TEXT NOT NULL,
    notes TEXT DEFAULT '',
    source TEXT DEFAULT 'import',
    account_id INTEGER,
    UNIQUE(entry_order_id, exit_order_id)
);

CREATE TABLE IF NOT EXISTS day_notes (
    day TEXT PRIMARY KEY,
    notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS broker_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    login TEXT NOT NULL,
    password TEXT NOT NULL,
    server TEXT NOT NULL,
    last_sync TEXT,
    starting_balance REAL DEFAULT 0,
    synced_balance REAL
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    trade_id INTEGER,
    filename TEXT NOT NULL,
    thumb_filename TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_day ON trades(day);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_images_day ON images(day);
CREATE INDEX IF NOT EXISTS idx_images_trade ON images(trade_id);
"""

# Versionierte Migrationen fuer bestehende Nutzer-Datenbanken (per PRAGMA user_version
# getrackt). NIE bestehende Eintraege aendern oder entfernen, NUR neue anhaengen -
# sonst verlieren bereits aktualisierte Nutzer ihren Fortschritt oder Migrationen
# laufen doppelt. Neue Installationen bekommen den Zielzustand direkt ueber SCHEMA
# oben und ueberspringen diese Liste effektiv (siehe init_db).
MIGRATIONS: list[str] = [
    "ALTER TABLE trades ADD COLUMN source TEXT DEFAULT 'import'",   # -> Version 1
    "ALTER TABLE trades ADD COLUMN account_id INTEGER",             # -> Version 2
    "ALTER TABLE broker_accounts ADD COLUMN starting_balance REAL DEFAULT 0",  # -> Version 3
    "ALTER TABLE broker_accounts ADD COLUMN synced_balance REAL",              # -> Version 4
]


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL: nebenlaeufige Lesezugriffe blockieren keine Schreiboperation (und umgekehrt);
    # NORMAL synchronous ist bei WAL sicher und deutlich schneller als FULL.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


BACKUP_KEEP = 10  # aelteste Backups jenseits dieser Anzahl werden geloescht


def _backup_db() -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"trades_pre_update_{ts}.db"
    shutil.copy2(DB_PATH, dest)

    # Zeitstempel im Dateinamen ist lexikographisch sortierbar -> aelteste zuerst.
    backups = sorted(BACKUP_DIR.glob("trades_pre_update_*.db"))
    for old in backups[:-BACKUP_KEEP]:
        old.unlink()

    return dest


def init_db():
    """Legt bei einer neuen Installation das komplette aktuelle Schema an.
    Bei einer bestehenden Datenbank wird zuerst ein Backup geschrieben und dann
    nur die noch fehlenden Migrationen nachgefahren - so ueberlebt ein Update
    (neue app/-Dateien druebergespielt) garantiert die vorhandenen Trades,
    Konten, Notizen und Bilder."""
    is_new_db = not DB_PATH.exists()

    with get_conn() as conn:
        conn.executescript(SCHEMA)

        current_version = conn.execute("PRAGMA user_version").fetchone()[0]
        target_version = len(MIGRATIONS)

        if current_version < target_version:
            if not is_new_db:
                _backup_db()
            for stmt in MIGRATIONS[current_version:]:
                try:
                    conn.execute(stmt)
                except sqlite3.OperationalError:
                    pass  # Spalte/Tabelle existiert bereits (z.B. frische DB via SCHEMA)
            conn.execute(f"PRAGMA user_version = {target_version}")


def insert_trades(trades: list[dict], source: str = "import", account_id: int | None = None) -> int:
    inserted = 0
    with get_conn() as conn:
        for t in trades:
            row = dict(t)
            row.setdefault("source", source)
            row.setdefault("account_id", account_id)
            cur = conn.execute(
                """INSERT OR IGNORE INTO trades
                (day, instrument, direction, entry_time, exit_time, entry_price, exit_price,
                 exit_type, points, gross_usd, commission_usd, net_usd, entry_order_id, exit_order_id,
                 source, account_id)
                VALUES (:day, :instrument, :direction, :entry_time, :exit_time, :entry_price, :exit_price,
                 :exit_type, :points, :gross_usd, :commission_usd, :net_usd, :entry_order_id, :exit_order_id,
                 :source, :account_id)""",
                row,
            )
            if cur.rowcount:
                inserted += 1
    return inserted


def list_accounts() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, platform, login, server, last_sync, starting_balance, synced_balance "
            "FROM broker_accounts ORDER BY name"
        ).fetchall()
    return [dict(r) for r in rows]


def get_account(account_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM broker_accounts WHERE id = ?", (account_id,)).fetchone()
    return dict(row) if row else None


def add_account(name: str, platform: str, login: str, password: str, server: str, starting_balance: float = 0) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO broker_accounts (name, platform, login, password, server, starting_balance) VALUES (?, ?, ?, ?, ?, ?)",
            (name, platform, login, password, server, starting_balance),
        )
        return cur.lastrowid


def set_starting_balance(account_id: int, starting_balance: float):
    with get_conn() as conn:
        conn.execute("UPDATE broker_accounts SET starting_balance = ? WHERE id = ?", (starting_balance, account_id))


def set_synced_balance(account_id: int, balance: float):
    with get_conn() as conn:
        conn.execute("UPDATE broker_accounts SET synced_balance = ? WHERE id = ?", (balance, account_id))


def delete_account(account_id: int):
    with get_conn() as conn:
        # Trades vor dem Loeschen des Kontos entkoppeln, sonst zeigen sie auf
        # eine nicht mehr existente account_id und tauchen in keinem Filter
        # mehr auf (weder Konto noch "Nicht zugeordnet").
        conn.execute("UPDATE trades SET account_id = NULL WHERE account_id = ?", (account_id,))
        conn.execute("DELETE FROM broker_accounts WHERE id = ?", (account_id,))


def delete_trade(trade_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM trades WHERE id = ?", (trade_id,))


def set_last_sync(account_id: int, ts: str):
    with get_conn() as conn:
        conn.execute("UPDATE broker_accounts SET last_sync = ? WHERE id = ?", (ts, account_id))


def _account_filter(account_keys: list[str] | None) -> tuple[str, list]:
    """Baut eine WHERE-Teilklausel fuer eine Auswahl an Konten-Schluesseln.
    Schluessel sind entweder eine Konto-ID (str(int)) oder 'csv' fuer manuelle
    CSV-Importe ohne verknuepftes Konto (account_id IS NULL). None/leer = keine Einschraenkung."""
    if not account_keys:
        return "", []
    ids = [int(k) for k in account_keys if k != "csv"]
    include_csv = "csv" in account_keys
    parts, params = [], []
    if ids:
        parts.append(f"account_id IN ({','.join('?' for _ in ids)})")
        params.extend(ids)
    if include_csv:
        parts.append("account_id IS NULL")
    if not parts:
        return "1=0", []
    return "(" + " OR ".join(parts) + ")", params


def account_net_totals() -> dict[int, float]:
    """Netto-Summe je Konto ueber die komplette Handelshistorie (nicht nach
    Filter-Zeitraum begrenzt) - Basis, um aus dem zuletzt gesyncten MT5-Kontostand
    (synced_balance) das implizite Startkapital zu berechnen."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT account_id, SUM(net_usd) as total FROM trades WHERE account_id IS NOT NULL GROUP BY account_id"
        ).fetchall()
    return {r["account_id"]: r["total"] for r in rows}


def list_account_options() -> list[dict]:
    """Alle waehlbaren Filter-Optionen: echte Konten + ggf. 'csv' fuer nicht zugeordnete Importe."""
    options = [dict(key=str(a["id"]), name=a["name"]) for a in list_accounts()]
    with get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) as n FROM trades WHERE account_id IS NULL").fetchone()
    if row["n"]:
        options.append(dict(key="csv", name="Nicht zugeordnet"))
    return options


def count_unassigned_trades(source: str | None = None) -> int:
    with get_conn() as conn:
        if source:
            row = conn.execute(
                "SELECT COUNT(*) as n FROM trades WHERE account_id IS NULL AND source = ?", (source,)
            ).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) as n FROM trades WHERE account_id IS NULL").fetchone()
    return row["n"]


def reassign_unassigned_trades(account_id: int, source: str | None = None) -> int:
    """Weist bereits importierte, noch keinem Konto zugeordnete Trades nachtraeglich
    einem Konto zu - z.B. um schon vorhandene NinjaTrader-CSV-Importe einem konkret
    benannten Konto wie 'Lucid Trading' zuzuordnen."""
    with get_conn() as conn:
        if source:
            cur = conn.execute(
                "UPDATE trades SET account_id = ? WHERE account_id IS NULL AND source = ?",
                (account_id, source),
            )
        else:
            cur = conn.execute("UPDATE trades SET account_id = ? WHERE account_id IS NULL", (account_id,))
        return cur.rowcount


def list_days(account_keys: list[str] | None = None) -> list[dict]:
    clause, params = _account_filter(account_keys)
    where = f"WHERE {clause}" if clause else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT day, COUNT(*) as trade_count,
                      ROUND(SUM(points), 2) as points,
                      ROUND(SUM(net_usd), 2) as net_usd
               FROM trades {where} GROUP BY day ORDER BY day DESC""",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def get_day_trades(day: str, account_keys: list[str] | None = None) -> list[dict]:
    clause, params = _account_filter(account_keys)
    where = f"AND {clause}" if clause else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM trades WHERE day = ? {where} ORDER BY entry_time ASC",
            [day] + params,
        ).fetchall()
    return [dict(r) for r in rows]


def get_trades_in_range(start_day: str, end_day: str, account_keys: list[str] | None = None) -> list[dict]:
    """Ein einzelner Query fuer einen ganzen Zeitraum (Woche/Monat) statt eines
    Queries pro Tag - vermeidet bis zu 31 einzelne Connections pro Monatsansicht."""
    clause, params = _account_filter(account_keys)
    where = f"AND {clause}" if clause else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM trades WHERE day BETWEEN ? AND ? {where} ORDER BY entry_time ASC",
            [start_day, end_day] + params,
        ).fetchall()
    return [dict(r) for r in rows]


def update_trade_notes(trade_id: int, notes: str):
    with get_conn() as conn:
        conn.execute("UPDATE trades SET notes = ? WHERE id = ?", (notes, trade_id))


def get_day_notes(day: str) -> str:
    with get_conn() as conn:
        row = conn.execute("SELECT notes FROM day_notes WHERE day = ?", (day,)).fetchone()
    return row["notes"] if row else ""


def set_day_notes(day: str, notes: str):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO day_notes (day, notes) VALUES (?, ?)
               ON CONFLICT(day) DO UPDATE SET notes = excluded.notes""",
            (day, notes),
        )


def add_image(day: str, trade_id: int | None, filename: str, thumb_filename: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO images (day, trade_id, filename, thumb_filename, created_at)
               VALUES (?, ?, ?, ?, datetime('now'))""",
            (day, trade_id, filename, thumb_filename),
        )
        return cur.lastrowid


def get_images_for_day(day: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM images WHERE day = ? ORDER BY created_at ASC", (day,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_image(image_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
    return dict(row) if row else None


def delete_image(image_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM images WHERE id = ?", (image_id,))
