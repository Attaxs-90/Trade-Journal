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
    volume REAL,
    UNIQUE(entry_order_id, exit_order_id)
);

-- Alt: Vorgaenger des Journals (Klartext-Notiz je Tag). Inhalte wurden per
-- Migration nach journal_entries uebernommen; die Tabelle bleibt nur bestehen,
-- weil Migrationen append-only sind und auf sie verweisen. Nicht mehr benutzen.
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

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    tag_group TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS trade_tags (
    trade_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (trade_id, tag_id)
);

-- Journal: ein Eintrag pro Bezugszeitraum, unabhaengig davon ob an dem Tag
-- gehandelt wurde. entry_type/ref_key statt nur "day", damit spaeter Wochen-
-- und Monatsreviews ohne Schema-Migration dazukommen koennen ('2026-08-29',
-- '2026-W35', '2026-08'). plain_text ist die Textfassung von content_html und
-- existiert nur fuer die Volltextsuche.
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL DEFAULT 'day',
    ref_key TEXT NOT NULL,
    title TEXT DEFAULT '',
    content_html TEXT DEFAULT '',
    plain_text TEXT DEFAULT '',
    rating INTEGER,
    mood INTEGER,
    followed_plan INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(entry_type, ref_key)
);

CREATE TABLE IF NOT EXISTS journal_tags (
    entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS journal_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content_html TEXT DEFAULT '',
    position INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trades_day ON trades(day);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_images_day ON images(day);
CREATE INDEX IF NOT EXISTS idx_images_trade ON images(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_tags_tag ON trade_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_trade_tags_trade ON trade_tags(trade_id);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(entry_type, ref_key);
CREATE INDEX IF NOT EXISTS idx_journal_tags_entry ON journal_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_tags_tag ON journal_tags(tag_id);
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
    """CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        tag_group TEXT DEFAULT ''
    )""",                                                                     # -> Version 5
    """CREATE TABLE IF NOT EXISTS trade_tags (
        trade_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (trade_id, tag_id)
    )""",                                                                     # -> Version 6
    "CREATE INDEX IF NOT EXISTS idx_trade_tags_tag ON trade_tags(tag_id)",    # -> Version 7
    "CREATE INDEX IF NOT EXISTS idx_trade_tags_trade ON trade_tags(trade_id)",  # -> Version 8
    "ALTER TABLE trades ADD COLUMN volume REAL",                               # -> Version 9
    """CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_type TEXT NOT NULL DEFAULT 'day',
        ref_key TEXT NOT NULL,
        title TEXT DEFAULT '',
        content_html TEXT DEFAULT '',
        plain_text TEXT DEFAULT '',
        rating INTEGER,
        mood INTEGER,
        followed_plan INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(entry_type, ref_key)
    )""",                                                                      # -> Version 10
    """CREATE TABLE IF NOT EXISTS journal_tags (
        entry_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (entry_id, tag_id)
    )""",                                                                      # -> Version 11
    """CREATE TABLE IF NOT EXISTS journal_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        content_html TEXT DEFAULT '',
        position INTEGER DEFAULT 0
    )""",                                                                      # -> Version 12
    "CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(entry_type, ref_key)",  # -> Version 13
    "CREATE INDEX IF NOT EXISTS idx_journal_tags_entry ON journal_tags(entry_id)",         # -> Version 14
    "CREATE INDEX IF NOT EXISTS idx_journal_tags_tag ON journal_tags(tag_id)",             # -> Version 15
    # Bestehende Tages-Notizen (Klartext) einmalig ins Journal uebernehmen: HTML
    # escapen, CR entfernen, LF zu Absaetzen. day_notes bleibt danach unveraendert
    # stehen (Migrationen sind append-only), wird aber nicht mehr gelesen.
    """INSERT OR IGNORE INTO journal_entries
       (entry_type, ref_key, content_html, plain_text, created_at, updated_at)
       SELECT 'day', day,
              '<p>' || replace(replace(replace(replace(replace(
                  notes, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                  char(13), ''), char(10), '</p><p>') || '</p>',
              notes, datetime('now'), datetime('now')
       FROM day_notes WHERE trim(notes) <> ''""",                              # -> Version 16
    """INSERT INTO journal_templates (name, content_html, position) VALUES
       ('Pre-Session',
        '<h3>Bias</h3><p><br></p><h3>Key Levels</h3><ul><li><br></li></ul>'
        || '<h3>News heute</h3><ul><li><br></li></ul>'
        || '<h3>Geplante Setups</h3><ul><li><br></li></ul>'
        || '<h3>Risiko / Maximalverlust</h3><p><br></p>', 1),
       ('Post-Session',
        '<h3>Was lief gut</h3><ul><li><br></li></ul>'
        || '<h3>Was lief schlecht</h3><ul><li><br></li></ul>'
        || '<h3>Fehler</h3><ul><li><br></li></ul>'
        || '<h3>Lektion</h3><p><br></p><h3>Morgen konkret anders</h3><p><br></p>', 2),
       ('Wochenreview',
        '<h3>Zahlen der Woche</h3><p><br></p>'
        || '<h3>Wiederkehrende Muster</h3><ul><li><br></li></ul>'
        || '<h3>Disziplin</h3><p><br></p><h3>Fokus naechste Woche</h3><p><br></p>', 3)""",  # -> Version 17
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


def _backup_db(conn: sqlite3.Connection) -> Path:
    # Im WAL-Modus koennen zuletzt geschriebene Transaktionen noch in der
    # trades.db-wal-Datei stehen statt in trades.db selbst. Ein reines
    # shutil.copy2(DB_PATH) wuerde diese Datei nicht mitnehmen und so ein
    # Backup erzeugen, dem die juengsten Trades fehlen. TRUNCATE-Checkpoint
    # schreibt alles Ausstehende in die Hauptdatei und leert die WAL-Datei,
    # damit die Kopie danach wirklich vollstaendig und in sich konsistent ist.
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
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
                _backup_db(conn)
            for stmt in MIGRATIONS[current_version:]:
                try:
                    conn.execute(stmt)
                except sqlite3.OperationalError as e:
                    # Erwartet nur, wenn Spalte/Tabelle schon existiert (z.B. frische
                    # DB via SCHEMA, die diese Migration inhaltlich vorwegnimmt).
                    # Jeder andere Fehler (z.B. Tippfehler in einer neuen Migration)
                    # soll den Start hart abbrechen statt user_version trotzdem
                    # hochzuzaehlen - sonst laeuft die betroffene Migration nie wieder,
                    # obwohl sie nie ausgefuehrt wurde, und die DB bleibt inkonsistent.
                    msg = str(e).lower()
                    if "already exists" not in msg and "duplicate column" not in msg:
                        raise
            conn.execute(f"PRAGMA user_version = {target_version}")


def insert_trades(trades: list[dict], source: str = "import", account_id: int | None = None) -> int:
    """INSERT OR IGNORE ueber (entry_order_id, exit_order_id) - bereits vorhandene
    Trades werden beim erneuten Sync/Import nicht neu angelegt. Wurde ein Trade
    dabei ignoriert, aber die eingehenden Daten liefern eine volume, die in der
    DB noch fehlt (z. B. Trades von vor Einfuehrung des volume-Felds), wird sie
    per UPDATE nachgetragen - so heilt ein erneuter Sync/Import fehlende Lots/
    Kontrakte, ohne bestehende Zeilen zu duplizieren oder sonst zu veraendern."""
    inserted = 0
    with get_conn() as conn:
        for t in trades:
            row = dict(t)
            row.setdefault("source", source)
            row.setdefault("account_id", account_id)
            row.setdefault("volume", None)
            cur = conn.execute(
                """INSERT OR IGNORE INTO trades
                (day, instrument, direction, entry_time, exit_time, entry_price, exit_price,
                 exit_type, points, gross_usd, commission_usd, net_usd, entry_order_id, exit_order_id,
                 source, account_id, volume)
                VALUES (:day, :instrument, :direction, :entry_time, :exit_time, :entry_price, :exit_price,
                 :exit_type, :points, :gross_usd, :commission_usd, :net_usd, :entry_order_id, :exit_order_id,
                 :source, :account_id, :volume)""",
                row,
            )
            if cur.rowcount:
                inserted += 1
            elif row["volume"] is not None:
                conn.execute(
                    """UPDATE trades SET volume = :volume
                       WHERE entry_order_id = :entry_order_id AND exit_order_id = :exit_order_id
                       AND volume IS NULL""",
                    row,
                )
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


def rename_account(account_id: int, name: str):
    with get_conn() as conn:
        conn.execute("UPDATE broker_accounts SET name = ? WHERE id = ?", (name, account_id))


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
        conn.execute("DELETE FROM trade_tags WHERE trade_id = ?", (trade_id,))
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
    # Ungueltige Schluessel (z.B. veraltete/manipulierte Werte aus dem
    # localStorage-Filterzustand) werden ignoriert statt die Anfrage mit
    # einem unbehandelten ValueError abstuerzen zu lassen.
    ids = [int(k) for k in account_keys if k != "csv" and k.lstrip("-").isdigit()]
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


def _tag_filter(tag_keys: list[str] | None, tag_logic: str = "or") -> tuple[str, list]:
    """Baut eine WHERE-Teilklausel fuer eine Auswahl an Tag-IDs, analog zu
    _account_filter(). Da Tags in einer separaten Verknuepfungstabelle liegen,
    ueber eine Subquery auf trade_tags statt einem direkten Spaltenvergleich.
    ODER: Trade hat mindestens einen der gewaehlten Tags. UND: Trade hat alle."""
    if not tag_keys:
        return "", []
    ids = [int(k) for k in tag_keys if k.lstrip("-").isdigit()]
    if not ids:
        return "1=0", []
    placeholders = ",".join("?" for _ in ids)
    if tag_logic == "and":
        clause = (
            f"trades.id IN (SELECT trade_id FROM trade_tags WHERE tag_id IN ({placeholders}) "
            f"GROUP BY trade_id HAVING COUNT(DISTINCT tag_id) = ?)"
        )
        return clause, ids + [len(ids)]
    clause = f"trades.id IN (SELECT trade_id FROM trade_tags WHERE tag_id IN ({placeholders}))"
    return clause, ids


def _combine_filters(*clauses_and_params: tuple[str, list]) -> tuple[str, list]:
    """Verknuepft mehrere unabhaengige WHERE-Fragmente (Konten-/Tag-Filter) per AND."""
    parts, params = [], []
    for clause, p in clauses_and_params:
        if clause:
            parts.append(clause)
            params.extend(p)
    return " AND ".join(parts), params


def _attach_tags(trades: list[dict]) -> list[dict]:
    """Reichert eine Liste Trades mit ihren zugewiesenen Tags an - eine
    zusaetzliche Query statt einer pro Trade (kein N+1)."""
    if not trades:
        return trades
    ids = [t["id"] for t in trades]
    placeholders = ",".join("?" for _ in ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT trade_tags.trade_id as trade_id, tags.id, tags.name, tags.color, tags.tag_group
               FROM trade_tags JOIN tags ON tags.id = trade_tags.tag_id
               WHERE trade_tags.trade_id IN ({placeholders})
               ORDER BY tags.tag_group, tags.name""",
            ids,
        ).fetchall()
    by_trade: dict[int, list[dict]] = {}
    for r in rows:
        by_trade.setdefault(r["trade_id"], []).append(
            dict(id=r["id"], name=r["name"], color=r["color"], tag_group=r["tag_group"])
        )
    for t in trades:
        t["tags"] = by_trade.get(t["id"], [])
    return trades


def add_tag(name: str, color: str, tag_group: str = "") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO tags (name, color, tag_group) VALUES (?, ?, ?)", (name, color, tag_group)
        )
        return cur.lastrowid


def update_tag(tag_id: int, name: str, color: str, tag_group: str = ""):
    with get_conn() as conn:
        conn.execute(
            "UPDATE tags SET name = ?, color = ?, tag_group = ? WHERE id = ?",
            (name, color, tag_group, tag_id),
        )


def delete_tag(tag_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM trade_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM journal_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))


def list_tags() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM tags ORDER BY tag_group, name").fetchall()
    return [dict(r) for r in rows]


def set_trade_tags(trade_id: int, tag_ids: list[int]):
    with get_conn() as conn:
        conn.execute("DELETE FROM trade_tags WHERE trade_id = ?", (trade_id,))
        conn.executemany(
            "INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)",
            [(trade_id, tid) for tid in tag_ids],
        )


def bulk_add_tag(trade_ids: list[int], tag_id: int):
    with get_conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)",
            [(tid, tag_id) for tid in trade_ids],
        )


def tag_stats() -> list[dict]:
    """Netto-P&L und Winrate je Tag - eine Query, kein Query pro Tag."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT tags.id, tags.name, tags.color, tags.tag_group,
                      COUNT(trades.id) as trade_count,
                      ROUND(COALESCE(SUM(trades.net_usd), 0), 2) as net_usd,
                      SUM(CASE WHEN trades.net_usd > 0 THEN 1 ELSE 0 END) as wins
               FROM tags
               LEFT JOIN trade_tags ON trade_tags.tag_id = tags.id
               LEFT JOIN trades ON trades.id = trade_tags.trade_id
               GROUP BY tags.id
               ORDER BY tags.tag_group, tags.name"""
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["winrate"] = round(100 * d["wins"] / d["trade_count"], 1) if d["trade_count"] else 0.0
        del d["wins"]
        result.append(d)
    return result


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


def list_days(account_keys: list[str] | None = None, tag_keys: list[str] | None = None, tag_logic: str = "or") -> list[dict]:
    clause, params = _combine_filters(_account_filter(account_keys), _tag_filter(tag_keys, tag_logic))
    where = f"WHERE {clause}" if clause else ""
    # Groesse (Lots/Kontrakte) haengt an der Herkunft (source) - deshalb separat
    # je Tag UND source aufsummiert, nicht in der Haupt-Query mitgezogen (dort
    # waere je Tag nur eine einzelne Zahl moeglich, auch bei gemischten Quellen).
    vol_clause = f"{clause} AND volume IS NOT NULL" if clause else "volume IS NOT NULL"
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT day, COUNT(*) as trade_count,
                      ROUND(SUM(points), 2) as points,
                      ROUND(SUM(net_usd), 2) as net_usd,
                      GROUP_CONCAT(DISTINCT account_id) as account_ids_raw,
                      SUM(CASE WHEN account_id IS NULL THEN 1 ELSE 0 END) as unassigned_count
               FROM trades {where} GROUP BY day ORDER BY day DESC""",
            params,
        ).fetchall()
        vol_rows = conn.execute(
            f"""SELECT day, source, ROUND(SUM(volume), 2) as total
               FROM trades WHERE {vol_clause} GROUP BY day, source""",
            params,
        ).fetchall()
    volumes_by_day: dict[str, list[dict]] = {}
    for r in vol_rows:
        volumes_by_day.setdefault(r["day"], []).append({"source": r["source"], "total": r["total"]})
    journal = journal_map("day")  # eine Query fuer alle Tage, nicht eine je Tag
    result = []
    for r in rows:
        d = dict(r)
        raw = d.pop("account_ids_raw")
        d["account_ids"] = [int(x) for x in raw.split(",")] if raw else []
        d["has_unassigned"] = d.pop("unassigned_count") > 0
        d["volumes"] = volumes_by_day.get(d["day"], [])
        entry = journal.get(d["day"])
        d["has_journal"] = entry is not None
        d["journal_rating"] = entry["rating"] if entry else None
        result.append(d)
    return result


TRADE_SORT_COLUMNS = {"day": "day", "entry_time": "entry_time", "points": "points", "net_usd": "net_usd"}


def _attach_image_flags(trades: list[dict]) -> list[dict]:
    """Setzt has_image je Trade - eine zusaetzliche Query statt einer pro Trade
    (kein N+1), analog zu _attach_tags()."""
    if not trades:
        return trades
    ids = [t["id"] for t in trades]
    placeholders = ",".join("?" for _ in ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT trade_id FROM images WHERE trade_id IN ({placeholders})", ids
        ).fetchall()
    with_image = {r["trade_id"] for r in rows}
    for t in trades:
        t["has_image"] = t["id"] in with_image
    return trades


def _attach_journal_flags(trades: list[dict]) -> list[dict]:
    """Setzt has_journal je Trade (entry_type="trade", ref_key=Trade-Id als String) -
    eine zusaetzliche Query statt einer pro Trade (kein N+1), analog zu _attach_tags()."""
    if not trades:
        return trades
    ids = [str(t["id"]) for t in trades]
    placeholders = ",".join("?" for _ in ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT ref_key FROM journal_entries WHERE entry_type = 'trade' AND ref_key IN ({placeholders})", ids
        ).fetchall()
    with_journal = {r["ref_key"] for r in rows}
    for t in trades:
        t["has_journal"] = str(t["id"]) in with_journal
    return trades


def list_trades(account_keys: list[str] | None = None, tag_keys: list[str] | None = None, tag_logic: str = "or",
                 offset: int = 0, limit: int = 50, sort: str = "day", direction: str = "desc") -> tuple[list[dict], int]:
    """Paginierte Liste aller Trades ueber alle Tage hinweg, fuer die Trades-Uebersicht."""
    clause, params = _combine_filters(_account_filter(account_keys), _tag_filter(tag_keys, tag_logic))
    where = f"WHERE {clause}" if clause else ""
    sort_col = TRADE_SORT_COLUMNS.get(sort, "day")
    sort_dir = "ASC" if direction == "asc" else "DESC"
    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) as n FROM trades {where}", params).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT * FROM trades {where}
               ORDER BY {sort_col} {sort_dir}, entry_time {sort_dir} LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
    trades = _attach_tags([dict(r) for r in rows])
    return _attach_journal_flags(_attach_image_flags(trades)), total


def get_trade(trade_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM trades WHERE id = ?", (trade_id,)).fetchone()
    if not row:
        return None
    trades = _attach_image_flags(_attach_tags([dict(row)]))
    return trades[0]


def get_images_for_trade(trade_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM images WHERE trade_id = ? ORDER BY created_at ASC", (trade_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def adjacent_trade_id(trade_id: int, to: str, account_keys: list[str] | None = None,
                       tag_keys: list[str] | None = None, tag_logic: str = "or",
                       sort: str = "day", direction: str = "desc") -> int | None:
    """Naechster/vorheriger Trade in genau der Reihenfolge, die list_trades() fuer
    dieselben Filter/Sortierung liefern wuerde - per Tupel-Vergleich (Sortierspalte,
    entry_time) statt Offset, damit der Sprung auch ueber Seitengrenzen der
    paginierten Trades-Uebersicht hinweg korrekt bleibt."""
    current = get_trade(trade_id)
    if not current:
        return None
    clause, params = _combine_filters(_account_filter(account_keys), _tag_filter(tag_keys, tag_logic))
    where = f"AND {clause}" if clause else ""
    sort_col = TRADE_SORT_COLUMNS.get(sort, "day")
    sort_dir = "ASC" if direction == "asc" else "DESC"
    # "naechster" folgt der Anzeige-Reihenfolge (sort_dir); "vorheriger" ist deren
    # Umkehrung - beides zusammen mit dem passenden Tupel-Vergleich, damit
    # Eintraege mit gleichem Sortierwert (z.B. gleicher Tag) ueber entry_time
    # als Tie-Breaker korrekt und ohne Dopplung/Ueberspringen durchlaufen werden.
    forward = (to == "next") == (sort_dir == "ASC")
    op = ">" if forward else "<"
    query_dir = "ASC" if forward else "DESC"
    with get_conn() as conn:
        row = conn.execute(
            f"""SELECT id FROM trades
               WHERE ({sort_col}, entry_time) {op} (?, ?) {where}
               ORDER BY {sort_col} {query_dir}, entry_time {query_dir} LIMIT 1""",
            [current[sort_col], current["entry_time"]] + params,
        ).fetchone()
    return row["id"] if row else None


def get_day_trades(day: str, account_keys: list[str] | None = None, tag_keys: list[str] | None = None, tag_logic: str = "or") -> list[dict]:
    clause, params = _combine_filters(_account_filter(account_keys), _tag_filter(tag_keys, tag_logic))
    where = f"AND {clause}" if clause else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM trades WHERE day = ? {where} ORDER BY entry_time ASC",
            [day] + params,
        ).fetchall()
    return _attach_tags([dict(r) for r in rows])


def get_trades_in_range(start_day: str, end_day: str, account_keys: list[str] | None = None, tag_keys: list[str] | None = None, tag_logic: str = "or") -> list[dict]:
    """Ein einzelner Query fuer einen ganzen Zeitraum (Woche/Monat) statt eines
    Queries pro Tag - vermeidet bis zu 31 einzelne Connections pro Monatsansicht."""
    clause, params = _combine_filters(_account_filter(account_keys), _tag_filter(tag_keys, tag_logic))
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


def days_with_images(start: str, end: str) -> set[str]:
    """Tage im Zeitraum, die mindestens ein Bild haben - Tages- UND Trade-Bilder
    zusammen (images.day ist bei beiden gesetzt), eine Query fuer den ganzen
    Zeitraum statt einer pro Tag."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT day FROM images WHERE day BETWEEN ? AND ?", (start, end)
        ).fetchall()
    return {r["day"] for r in rows}


def get_image(image_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
    return dict(row) if row else None


def delete_image(image_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM images WHERE id = ?", (image_id,))


# --- Journal ---------------------------------------------------------------
# Eintraege haengen am Datum (bzw. spaeter an Woche/Monat), nicht am Trade:
# ein Handelstag kann einen Eintrag haben, ein Eintrag braucht keinen Trade.

JOURNAL_TYPES = {"day", "week", "month", "trade"}


def _attach_journal_tags(entries: list[dict]) -> list[dict]:
    """Reichert Journal-Eintraege mit ihren Tags an - eine zusaetzliche Query
    statt einer pro Eintrag (kein N+1), analog zu _attach_tags() fuer Trades.
    Journal und Trades teilen sich bewusst dieselbe tags-Tabelle."""
    for e in entries:
        e["tags"] = []
    ids = [e["id"] for e in entries if e.get("id")]
    if not ids:
        return entries
    placeholders = ",".join("?" for _ in ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT journal_tags.entry_id as entry_id, tags.id, tags.name, tags.color, tags.tag_group
               FROM journal_tags JOIN tags ON tags.id = journal_tags.tag_id
               WHERE journal_tags.entry_id IN ({placeholders})
               ORDER BY tags.tag_group, tags.name""",
            ids,
        ).fetchall()
    by_entry: dict[int, list[dict]] = {}
    for r in rows:
        by_entry.setdefault(r["entry_id"], []).append(
            dict(id=r["id"], name=r["name"], color=r["color"], tag_group=r["tag_group"])
        )
    for e in entries:
        e["tags"] = by_entry.get(e.get("id"), [])
    return entries


def _day_totals(days: list[str]) -> dict[str, dict]:
    """Trade-Kennzahlen fuer eine Menge Tage in einer einzigen Query."""
    if not days:
        return {}
    placeholders = ",".join("?" for _ in days)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT day, COUNT(*) as trade_count,
                      ROUND(SUM(net_usd), 2) as net_usd, ROUND(SUM(points), 2) as points
               FROM trades WHERE day IN ({placeholders}) GROUP BY day""",
            list(days),
        ).fetchall()
    return {r["day"]: dict(r) for r in rows}


def get_journal_entry(entry_type: str, ref_key: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM journal_entries WHERE entry_type = ? AND ref_key = ?",
            (entry_type, ref_key),
        ).fetchone()
    if not row:
        return None
    entry = _attach_journal_tags([dict(row)])[0]
    if entry_type == "day":
        entry["day_stats"] = _day_totals([ref_key]).get(ref_key)
    return entry


def delete_journal_entry(entry_type: str, ref_key: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM journal_entries WHERE entry_type = ? AND ref_key = ?",
            (entry_type, ref_key),
        ).fetchone()
        if not row:
            return
        conn.execute("DELETE FROM journal_tags WHERE entry_id = ?", (row["id"],))
        conn.execute("DELETE FROM journal_entries WHERE id = ?", (row["id"],))


def bulk_delete_journal_entries(entry_type: str, ref_keys: list[str]) -> int:
    """Loescht mehrere Eintraege in einem Rutsch (Mehrfachauswahl in der
    Journal-Liste) - ein Query statt einer Schleife aus Einzel-Deletes."""
    if not ref_keys:
        return 0
    placeholders = ",".join("?" for _ in ref_keys)
    with get_conn() as conn:
        ids = [r["id"] for r in conn.execute(
            f"SELECT id FROM journal_entries WHERE entry_type = ? AND ref_key IN ({placeholders})",
            [entry_type] + list(ref_keys),
        ).fetchall()]
        if not ids:
            return 0
        id_placeholders = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM journal_tags WHERE entry_id IN ({id_placeholders})", ids)
        conn.execute(f"DELETE FROM journal_entries WHERE id IN ({id_placeholders})", ids)
    return len(ids)


def upsert_journal_entry(entry_type: str, ref_key: str, title: str = "", content_html: str = "",
                          plain_text: str = "", rating: int | None = None, mood: int | None = None,
                          followed_plan: int | None = None, tag_ids: list[int] | None = None) -> dict | None:
    """Legt einen Eintrag an oder aktualisiert ihn. Ein komplett leerer Eintrag
    (kein Text, keine Kennzahl, kein Tag) wird geloescht statt als Karteileiche
    stehen zu bleiben - sonst fuellt sich die Liste mit leeren Tagen, sobald man
    den Editor nur einmal geoeffnet hat."""
    tag_ids = tag_ids or []
    if (not plain_text.strip() and not title.strip() and not tag_ids
            and rating is None and mood is None and followed_plan is None):
        delete_journal_entry(entry_type, ref_key)
        return None
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO journal_entries
                 (entry_type, ref_key, title, content_html, plain_text, rating, mood,
                  followed_plan, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
               ON CONFLICT(entry_type, ref_key) DO UPDATE SET
                 title = excluded.title, content_html = excluded.content_html,
                 plain_text = excluded.plain_text, rating = excluded.rating,
                 mood = excluded.mood, followed_plan = excluded.followed_plan,
                 updated_at = excluded.updated_at""",
            (entry_type, ref_key, title, content_html, plain_text, rating, mood, followed_plan),
        )
        entry_id = conn.execute(
            "SELECT id FROM journal_entries WHERE entry_type = ? AND ref_key = ?",
            (entry_type, ref_key),
        ).fetchone()["id"]
        conn.execute("DELETE FROM journal_tags WHERE entry_id = ?", (entry_id,))
        conn.executemany(
            "INSERT OR IGNORE INTO journal_tags (entry_id, tag_id) VALUES (?, ?)",
            [(entry_id, tid) for tid in tag_ids],
        )
    return get_journal_entry(entry_type, ref_key)


def _journal_gaps(start: str | None, end: str | None, limit: int) -> list[dict]:
    """Handelstage ohne Journal-Eintrag, als virtuelle Eintraege (id=None).
    Macht Luecken in der Journal-Disziplin sichtbar, statt sie zu verstecken."""
    parts = ["day NOT IN (SELECT ref_key FROM journal_entries WHERE entry_type = 'day')"]
    params: list = []
    if start:
        parts.append("day >= ?")
        params.append(start)
    if end:
        parts.append("day <= ?")
        params.append(end)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT day, COUNT(*) as trade_count,
                      ROUND(SUM(net_usd), 2) as net_usd, ROUND(SUM(points), 2) as points
               FROM trades WHERE {' AND '.join(parts)}
               GROUP BY day ORDER BY day DESC LIMIT ?""",
            params + [limit],
        ).fetchall()
    return [
        dict(id=None, entry_type="day", ref_key=r["day"], title="", content_html="", plain_text="",
             rating=None, mood=None, followed_plan=None, created_at=None, updated_at=None,
             tags=[], day_stats=dict(r))
        for r in rows
    ]


def list_journal_entries(entry_type: str = "day", start: str | None = None, end: str | None = None,
                          query: str | None = None, tag_keys: list[str] | None = None,
                          mode: str = "all", limit: int = 300) -> list[dict]:
    """Journal-Liste mit Zeitraum-, Volltext- und Tag-Filter. mode steuert den
    Bezug zu den Trades: 'with_trades'/'without_trades' filtern die Eintraege,
    'gaps' zeigt umgekehrt Handelstage, zu denen noch kein Eintrag existiert.
    Der globale Konten-/Tag-Filter der Auswertungsseiten greift hier bewusst
    nicht - ein Journal-Eintrag gehoert zum Kalendertag, nicht zu einem Konto."""
    if entry_type not in JOURNAL_TYPES:
        entry_type = "day"
    if mode == "gaps" and entry_type == "day":
        return _journal_gaps(start, end, limit)

    parts = ["entry_type = ?"]
    params: list = [entry_type]
    if start:
        parts.append("ref_key >= ?")
        params.append(start)
    if end:
        parts.append("ref_key <= ?")
        params.append(end)
    if query:
        parts.append("(plain_text LIKE ? OR title LIKE ?)")
        params += [f"%{query}%", f"%{query}%"]
    if tag_keys:
        ids = [int(k) for k in tag_keys if k.lstrip("-").isdigit()]
        if ids:
            placeholders = ",".join("?" for _ in ids)
            parts.append(f"id IN (SELECT entry_id FROM journal_tags WHERE tag_id IN ({placeholders}))")
            params += ids
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT * FROM journal_entries WHERE {' AND '.join(parts)}
               ORDER BY ref_key DESC LIMIT ?""",
            params + [limit],
        ).fetchall()
    entries = [dict(r) for r in rows]
    if entry_type == "day":
        totals = _day_totals([e["ref_key"] for e in entries])
        for e in entries:
            e["day_stats"] = totals.get(e["ref_key"])
        if mode == "with_trades":
            entries = [e for e in entries if e["day_stats"]]
        elif mode == "without_trades":
            entries = [e for e in entries if not e["day_stats"]]
    return _attach_journal_tags(entries)


def journal_map(entry_type: str = "day", start: str | None = None, end: str | None = None) -> dict[str, dict]:
    """ref_key -> {rating} fuer vorhandene Eintraege. Eine Query, damit Uebersicht
    und Monatsgrid ihre Journal-Marker ohne Zusatzabfrage pro Tag setzen koennen."""
    parts = ["entry_type = ?"]
    params: list = [entry_type]
    if start:
        parts.append("ref_key >= ?")
        params.append(start)
    if end:
        parts.append("ref_key <= ?")
        params.append(end)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT ref_key, rating FROM journal_entries WHERE {' AND '.join(parts)}", params
        ).fetchall()
    return {r["ref_key"]: {"rating": r["rating"]} for r in rows}


def list_journal_templates() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM journal_templates ORDER BY position, id"
        ).fetchall()
    return [dict(r) for r in rows]


def add_journal_template(name: str, content_html: str = "", position: int = 0) -> int:
    """Ohne explizite Position landet die Vorlage hinten - sonst draengt sich
    jede neue Vorlage mit position 0 vor die vorhandenen."""
    with get_conn() as conn:
        if not position:
            row = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 as next FROM journal_templates").fetchone()
            position = row["next"]
        cur = conn.execute(
            "INSERT INTO journal_templates (name, content_html, position) VALUES (?, ?, ?)",
            (name, content_html, position),
        )
        return cur.lastrowid


def update_journal_template(template_id: int, name: str, content_html: str, position: int = 0):
    with get_conn() as conn:
        conn.execute(
            "UPDATE journal_templates SET name = ?, content_html = ?, position = ? WHERE id = ?",
            (name, content_html, position, template_id),
        )


def delete_journal_template(template_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM journal_templates WHERE id = ?", (template_id,))
