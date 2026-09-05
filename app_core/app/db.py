import shutil
import sqlite3
import threading
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
    risk_usd REAL,
    strategy_id INTEGER,
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

-- Notizbuecher: frei verschachtelbare Ordner/Notizen ohne Kalenderbezug (Edge,
-- Strategie, Beobachtungen, Unterlagen, Logins, ...) - getrennt vom
-- Tages-Journal, weil sich "Ordner in Ordner" nicht sinnvoll ueber
-- entry_type/ref_key abbilden laesst. Kaskaden-Delete/Zyklus-Pruefung laufen
-- manuell in Python (siehe delete_notebook_node/move_notebook_node), keine
-- FK-Constraint, gleiche Handhabung wie bei trades/trade_tags in dieser Datei.
CREATE TABLE IF NOT EXISTS notebook_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    node_type TEXT NOT NULL CHECK(node_type IN ('folder', 'note')),
    name TEXT NOT NULL,
    content_html TEXT DEFAULT '',
    plain_text TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- To-Do-Listen: werden im Journal verwaltet (anlegen, Eintraege hinzufuegen,
-- explizit loeschen), "visible" steuert ob eine Liste im rechten Menue
-- (Newsbar) angezeigt wird. Erledigte Eintraege werden nur markiert (done/
-- done_at), nicht geloescht - das passiert ausschliesslich explizit ueber
-- delete_todo_item, damit Erledigtes als Historie erhalten bleibt.
CREATE TABLE IF NOT EXISTS todo_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    created_at TEXT NOT NULL
);

-- Strategien: eine Handelsstrategie mit eigenen Regeln. Ein Trade hat hoechstens
-- eine Strategie (trades.strategy_id). Geloescht wird bevorzugt per archived=1 -
-- eine gehandelte Strategie samt ihrer Auswertung wirft man nicht weg, sie soll
-- nur nicht mehr zur Auswahl stehen. is_default markiert hoechstens eine
-- Strategie, die auf der Trade-Seite vorausgewaehlt wird (nur als Vorschlag,
-- Import und Sync ordnen NICHTS automatisch zu - sonst bekaemen Bestandstrades
-- still eine Strategie, die nicht stimmt).
CREATE TABLE IF NOT EXISTS strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Regelgruppen ("Entry", "Lot", ...) als eigene Tabelle statt als Textfeld an
-- der Regel (anders als tags.tag_group): die Gruppen brauchen eine eigene
-- Reihenfolge, und Umbenennen soll eine Zeile aendern statt n Regeln.
CREATE TABLE IF NOT EXISTS strategy_rule_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

-- Regeln einer Strategie. group_id NULL = Regel ohne Gruppe. archived=1 wenn
-- die Regel inhaltlich ersetzt wurde: sie verschwindet aus der Checkliste
-- neuer Trades, ihre bisherigen Bewertungen bleiben aber gueltig und
-- auswertbar. Ein blosses Umbenennen (Tippfehler) aendert text direkt.
CREATE TABLE IF NOT EXISTS strategy_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    group_id INTEGER,
    text TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Regel-Einhaltung je Trade. followed: 1 = befolgt, 0 = nicht befolgt.
-- KEINE Zeile = unbeantwortet; solche Trades fallen aus jeder Quote heraus,
-- statt als "nicht befolgt" zu zaehlen. Das dient zugleich als "nicht
-- anwendbar": greift eine Regel bei einem Trade nicht, bleibt sie einfach
-- unbeantwortet. Eigene Tabelle statt JSON am Trade/Journal-Eintrag, damit
-- die Auswertung in einer Query aggregieren kann - und weil
-- upsert_journal_entry() leere Eintraege loescht und die Daten mitnaehme.
CREATE TABLE IF NOT EXISTS trade_rule_status (
    trade_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    followed INTEGER NOT NULL,
    PRIMARY KEY (trade_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_trades_day ON trades(day);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
-- idx_trades_strategy steht bewusst NICHT hier, sondern nur als Migration:
-- dieses SCHEMA laeuft vor den Migrationen, und bei einer bestehenden Datenbank
-- gibt es trades.strategy_id an dieser Stelle noch gar nicht (die Spalte kommt
-- erst mit Migration 28) - der Index wuerde den Start abbrechen. Bei einer
-- neuen Datenbank legt ihn dieselbe Migration an, deren ALTER TABLE dort
-- folgenlos durchlaeuft. Indizes auf frisch in SCHEMA angelegte Tabellen sind
-- dagegen unproblematisch und duerfen hier stehen.
CREATE INDEX IF NOT EXISTS idx_strategy_rules_strategy ON strategy_rules(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_rule_groups_strategy ON strategy_rule_groups(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trade_rule_status_rule ON trade_rule_status(rule_id);
CREATE INDEX IF NOT EXISTS idx_images_day ON images(day);
CREATE INDEX IF NOT EXISTS idx_images_trade ON images(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_tags_tag ON trade_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_trade_tags_trade ON trade_tags(trade_id);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(entry_type, ref_key);
CREATE INDEX IF NOT EXISTS idx_journal_tags_entry ON journal_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_tags_tag ON journal_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_notebook_nodes_parent ON notebook_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_todo_items_list ON todo_items(list_id);
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
    """CREATE TABLE IF NOT EXISTS notebook_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER,
        node_type TEXT NOT NULL CHECK(node_type IN ('folder', 'note')),
        name TEXT NOT NULL,
        content_html TEXT DEFAULT '',
        plain_text TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",                                                                     # -> Version 18
    "CREATE INDEX IF NOT EXISTS idx_notebook_nodes_parent ON notebook_nodes(parent_id)",  # -> Version 19
    """CREATE TABLE IF NOT EXISTS todo_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        visible INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""",                                                                     # -> Version 20
    """CREATE TABLE IF NOT EXISTS todo_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        done_at TEXT,
        created_at TEXT NOT NULL
    )""",                                                                     # -> Version 21
    "CREATE INDEX IF NOT EXISTS idx_todo_items_list ON todo_items(list_id)",  # -> Version 22
    "ALTER TABLE trades ADD COLUMN risk_usd REAL",                            # -> Version 23
    """CREATE TABLE IF NOT EXISTS strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""",                                                                     # -> Version 24
    """CREATE TABLE IF NOT EXISTS strategy_rule_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
    )""",                                                                     # -> Version 25
    """CREATE TABLE IF NOT EXISTS strategy_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id INTEGER NOT NULL,
        group_id INTEGER,
        text TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""",                                                                     # -> Version 26
    """CREATE TABLE IF NOT EXISTS trade_rule_status (
        trade_id INTEGER NOT NULL,
        rule_id INTEGER NOT NULL,
        followed INTEGER NOT NULL,
        PRIMARY KEY (trade_id, rule_id)
    )""",                                                                     # -> Version 27
    "ALTER TABLE trades ADD COLUMN strategy_id INTEGER",                      # -> Version 28
    "CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id)",  # -> Version 29
    "CREATE INDEX IF NOT EXISTS idx_strategy_rules_strategy ON strategy_rules(strategy_id)",              # -> Version 30
    "CREATE INDEX IF NOT EXISTS idx_strategy_rule_groups_strategy ON strategy_rule_groups(strategy_id)",  # -> Version 31
    "CREATE INDEX IF NOT EXISTS idx_trade_rule_status_rule ON trade_rule_status(rule_id)",                # -> Version 32
]


# Wiederverwendung der Verbindung innerhalb eines Aufrufs: viele Funktionen hier
# sind aus mehreren kleineren zusammengesetzt (get_trade -> _attach_tags +
# _attach_image_flags, list_days -> journal_map, ...). Jede oeffnete frueher ihre
# eigene Verbindung samt PRAGMA-Setup - /api/overview kam so auf rund ein Dutzend.
# Verschachtelte "with get_conn()" liefern jetzt dieselbe Verbindung; nur der
# aeusserste Block committet und schliesst. Der Zustand liegt thread-lokal, weil
# FastAPI synchrone Endpoints in einem Threadpool ausfuehrt - jeder Request hat
# damit garantiert seine eigene Verbindung, sqlite3-Objekte wandern nie zwischen
# Threads.
_local = threading.local()


@contextmanager
def get_conn():
    existing = getattr(_local, "conn", None)
    if existing is not None:
        # Verschachtelter Aufruf: mitbenutzen, aber NICHT committen/schliessen -
        # das bleibt Sache des aeussersten Blocks, damit dessen Transaktion
        # nicht mittendrin halb festgeschrieben wird.
        yield existing
        return

    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL: nebenlaeufige Lesezugriffe blockieren keine Schreiboperation (und umgekehrt);
    # NORMAL synchronous ist bei WAL sicher und deutlich schneller als FULL.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 10000")
    _local.conn = conn
    try:
        yield conn
        conn.commit()
    finally:
        _local.conn = None
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
    dabei ignoriert, aber die eingehenden Daten liefern eine volume/risk_usd, die
    in der DB noch fehlt (z. B. Trades von vor Einfuehrung des jeweiligen Felds),
    wird sie per UPDATE nachgetragen - so heilt ein erneuter Sync/Import
    fehlende Lots/Kontrakte oder Risiko, ohne bestehende Zeilen zu duplizieren
    oder sonst zu veraendern."""
    inserted = 0
    with get_conn() as conn:
        for t in trades:
            row = dict(t)
            row.setdefault("source", source)
            row.setdefault("account_id", account_id)
            row.setdefault("volume", None)
            row.setdefault("risk_usd", None)
            cur = conn.execute(
                """INSERT OR IGNORE INTO trades
                (day, instrument, direction, entry_time, exit_time, entry_price, exit_price,
                 exit_type, points, gross_usd, commission_usd, net_usd, entry_order_id, exit_order_id,
                 source, account_id, volume, risk_usd)
                VALUES (:day, :instrument, :direction, :entry_time, :exit_time, :entry_price, :exit_price,
                 :exit_type, :points, :gross_usd, :commission_usd, :net_usd, :entry_order_id, :exit_order_id,
                 :source, :account_id, :volume, :risk_usd)""",
                row,
            )
            if cur.rowcount:
                inserted += 1
            else:
                if row["volume"] is not None:
                    conn.execute(
                        """UPDATE trades SET volume = :volume
                           WHERE entry_order_id = :entry_order_id AND exit_order_id = :exit_order_id
                           AND volume IS NULL""",
                        row,
                    )
                if row["risk_usd"] is not None:
                    conn.execute(
                        """UPDATE trades SET risk_usd = :risk_usd
                           WHERE entry_order_id = :entry_order_id AND exit_order_id = :exit_order_id
                           AND risk_usd IS NULL""",
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


def delete_trade(trade_id: int) -> list[dict]:
    """Loescht einen Trade samt allem, was ausschliesslich an ihm haengt:
    Tag-Zuordnungen, seine Trade-Bewertung im Journal (entry_type 'trade',
    ref_key = Trade-Id als String) und seine Bild-Zeilen. Ohne das blieben
    verwaiste Journal-Eintraege und Bilder zurueck, die in keiner Ansicht mehr
    erreichbar sind, aber weiter im Tagesview auftauchen bzw. Plattenplatz
    belegen. Gibt die geloeschten Bild-Zeilen zurueck, damit der Aufrufer die
    JPEG-Dateien loeschen kann - die Dateiverwaltung liegt bewusst in
    images.py, nicht hier (gleiche Aufteilung wie bei api_delete_image)."""
    with get_conn() as conn:
        images = [dict(r) for r in conn.execute(
            "SELECT * FROM images WHERE trade_id = ?", (trade_id,)
        ).fetchall()]
        conn.execute("DELETE FROM images WHERE trade_id = ?", (trade_id,))
        conn.execute("DELETE FROM trade_tags WHERE trade_id = ?", (trade_id,))
        conn.execute("DELETE FROM trades WHERE id = ?", (trade_id,))
    delete_journal_entry("trade", str(trade_id))
    return images


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
        return _attach_image_flags(_attach_tags([dict(row)]))[0]


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
        # Nur die beiden Sortierwerte des aktuellen Trades noetig - kein
        # get_trade(), das zusaetzlich Tags und Bild-Flags nachladen wuerde.
        current = conn.execute(
            f"SELECT {sort_col} as sort_value, entry_time FROM trades WHERE id = ?", (trade_id,)
        ).fetchone()
        if not current:
            return None
        row = conn.execute(
            f"""SELECT id FROM trades
               WHERE ({sort_col}, entry_time) {op} (?, ?) {where}
               ORDER BY {sort_col} {query_dir}, entry_time {query_dir} LIMIT 1""",
            [current["sort_value"], current["entry_time"]] + params,
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


def list_trades_for_analytics(account_keys: list[str] | None = None, tag_keys: list[str] | None = None,
                               tag_logic: str = "or", start: str | None = None, end: str | None = None) -> list[dict]:
    """Wie get_trades_in_range(), aber mit optionalen statt Pflicht-Datumsgrenzen -
    Basis fuer die Auswertungsseite, die wahlweise die komplette Historie oder
    einen frei gewaehlten Zeitraum je Widget auswertet. Tags werden direkt
    mitgeladen (eine Zusatzquery, kein N+1), weil die Tag-Dimension der
    Auswertung sie fuer jeden Trade braucht."""
    clause, params = _combine_filters(_account_filter(account_keys), _tag_filter(tag_keys, tag_logic))
    parts = [clause] if clause else []
    if start:
        parts.append("day >= ?")
        params.append(start)
    if end:
        parts.append("day <= ?")
        params.append(end)
    where = f"WHERE {' AND '.join(parts)}" if parts else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM trades {where} ORDER BY day ASC, entry_time ASC", params
        ).fetchall()
        return _attach_tags([dict(r) for r in rows])


def journal_day_details(start: str | None = None, end: str | None = None) -> dict[str, dict]:
    """ref_key -> {rating, mood, followed_plan} fuer Tages-Journal-Eintraege im
    Zeitraum - eine Query, analog zu journal_map(), aber mit den zusaetzlichen
    Feldern, die die Journal-Korrelations-Auswertungen brauchen."""
    parts = ["entry_type = 'day'"]
    params: list = []
    if start:
        parts.append("ref_key >= ?")
        params.append(start)
    if end:
        parts.append("ref_key <= ?")
        params.append(end)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT ref_key, rating, mood, followed_plan FROM journal_entries WHERE {' AND '.join(parts)}",
            params,
        ).fetchall()
    return {r["ref_key"]: dict(rating=r["rating"], mood=r["mood"], followed_plan=r["followed_plan"]) for r in rows}


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


def update_trade_risk(trade_id: int, risk_usd: float | None):
    """Manuelles Ueberschreiben/Nachtragen des Risikos (Basis fuer R-Multiple,
    siehe Share-Karte) - z.B. wenn der MT5-Sync keinen Stop-Loss ermitteln
    konnte oder der Trade per CSV importiert wurde."""
    with get_conn() as conn:
        conn.execute("UPDATE trades SET risk_usd = ? WHERE id = ?", (risk_usd, trade_id))


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
    if (not plain_text.strip() and not content_html.strip() and not title.strip() and not tag_ids
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
                          mode: str = "all", limit: int = 300) -> tuple[list[dict], bool]:
    """Journal-Liste mit Zeitraum-, Volltext- und Tag-Filter. mode steuert den
    Bezug zu den Trades: 'with_trades'/'without_trades' filtern die Eintraege,
    'gaps' zeigt umgekehrt Handelstage, zu denen noch kein Eintrag existiert.
    Der globale Konten-/Tag-Filter der Auswertungsseiten greift hier bewusst
    nicht - ein Journal-Eintrag gehoert zum Kalendertag, nicht zu einem Konto.

    Gibt (entries, truncated) zurueck - analog zu list_trades(), das ebenfalls
    Ergebnis und Gesamtinformation als Tupel liefert. truncated meldet, dass das
    Limit gegriffen hat und aeltere Eintraege fehlen; frueher verschwanden die
    kommentarlos, sodass eine Suche unvollstaendige Treffer als vollstaendig
    ausgab. Erkannt wird das ueber eine Zeile mehr als angefordert (LIMIT+1),
    die danach wieder abgeschnitten wird - kein zusaetzlicher COUNT-Query."""
    if entry_type not in JOURNAL_TYPES:
        entry_type = "day"
    if mode == "gaps" and entry_type == "day":
        gaps = _journal_gaps(start, end, limit + 1)
        return gaps[:limit], len(gaps) > limit

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
            params + [limit + 1],
        ).fetchall()
        truncated = len(rows) > limit
        entries = [dict(r) for r in rows[:limit]]
        if entry_type == "day":
            totals = _day_totals([e["ref_key"] for e in entries])
            for e in entries:
                e["day_stats"] = totals.get(e["ref_key"])
            if mode == "with_trades":
                entries = [e for e in entries if e["day_stats"]]
            elif mode == "without_trades":
                entries = [e for e in entries if not e["day_stats"]]
        return _attach_journal_tags(entries), truncated


def journal_month_summary() -> list[dict]:
    """Monats-Aggregate fuer die Journal-Kachel-Uebersicht (Tages-Eintraege):
    je eine Query ueber journal_entries und trades statt einer Schleife pro
    Monat. trading_days-entry_count ist nur eine Naeherung fuer "Handelstage
    ohne Eintrag" (ein Eintrag koennte an einem handelsfreien Tag liegen),
    daher im Frontend als ungefaehrer Hinweis markiert."""
    with get_conn() as conn:
        journal_rows = conn.execute(
            """SELECT substr(ref_key, 1, 7) as month, COUNT(*) as entry_count,
                      AVG(rating) as avg_rating
               FROM journal_entries WHERE entry_type = 'day'
               GROUP BY month"""
        ).fetchall()
        trade_rows = conn.execute(
            """SELECT substr(day, 1, 7) as month, COUNT(*) as trade_count,
                      COUNT(DISTINCT day) as trading_days,
                      ROUND(SUM(net_usd), 2) as net_usd
               FROM trades GROUP BY month"""
        ).fetchall()
    months: dict[str, dict] = {}
    for r in journal_rows:
        months[r["month"]] = dict(
            month=r["month"], entry_count=r["entry_count"],
            avg_rating=round(r["avg_rating"], 1) if r["avg_rating"] else None,
            trade_count=0, trading_days=0, net_usd=0.0,
        )
    for r in trade_rows:
        m = months.setdefault(r["month"], dict(
            month=r["month"], entry_count=0, avg_rating=None,
            trade_count=0, trading_days=0, net_usd=0.0,
        ))
        m["trade_count"] = r["trade_count"]
        m["trading_days"] = r["trading_days"]
        m["net_usd"] = r["net_usd"] or 0.0
    return sorted(months.values(), key=lambda m: m["month"], reverse=True)


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


# ---------- Notizbuecher (frei verschachtelbare Ordner/Notizen) ----------

def list_notebook_nodes() -> list[dict]:
    """Alle Knoten auf einmal - der Baum wird im Frontend ueber parent_id
    aufgebaut, kein Query pro Ebene. content_html fehlt bewusst (nur beim
    Oeffnen einer einzelnen Notiz noetig, siehe get_notebook_node)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, parent_id, node_type, name, plain_text, created_at, updated_at
               FROM notebook_nodes ORDER BY node_type ASC, name COLLATE NOCASE"""
        ).fetchall()
    return [dict(r) for r in rows]


def get_notebook_node(node_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM notebook_nodes WHERE id = ?", (node_id,)).fetchone()
    return dict(row) if row else None


def search_notebook_notes(query: str, limit: int = 50) -> list[dict]:
    """Volltextsuche ueber Notizen (nicht Ordner) - Titel und Klartext-Inhalt.
    Fuer die Journal-Suche mit Scope 'Notizbücher'/'Beides' (siehe main.py).
    Jeder Treffer bekommt zusaetzlich seinen Ordnerpfad (path) - eine einzige
    Zusatz-Query ueber alle Knoten statt einer Query pro Treffer, der Pfad
    wird danach in Python durch Verfolgen von parent_id aufgebaut."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, parent_id, name, plain_text, updated_at FROM notebook_nodes
               WHERE node_type = 'note' AND (name LIKE ? OR plain_text LIKE ?)
               ORDER BY updated_at DESC LIMIT ?""",
            (f"%{query}%", f"%{query}%", limit),
        ).fetchall()
        notes = [dict(r) for r in rows]
        if not notes:
            return notes
        all_rows = conn.execute("SELECT id, parent_id, name FROM notebook_nodes").fetchall()
    by_id = {r["id"]: r for r in all_rows}
    for note in notes:
        parts = []
        cur = by_id.get(note["parent_id"])
        while cur:
            parts.append(cur["name"])
            cur = by_id.get(cur["parent_id"])
        note["path"] = " / ".join(reversed(parts))
    return notes


def create_notebook_node(parent_id: int | None, node_type: str, name: str) -> dict:
    now = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO notebook_nodes (parent_id, node_type, name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (parent_id, node_type, name, now, now),
        )
        return get_notebook_node(cur.lastrowid)


def update_notebook_node(node_id: int, name: str | None = None, content_html: str | None = None,
                          plain_text: str | None = None) -> dict | None:
    fields, params = [], []
    if name is not None:
        fields.append("name = ?"); params.append(name)
    if content_html is not None:
        fields.append("content_html = ?"); params.append(content_html)
    if plain_text is not None:
        fields.append("plain_text = ?"); params.append(plain_text)
    if not fields:
        return get_notebook_node(node_id)
    fields.append("updated_at = ?"); params.append(datetime.now().isoformat(timespec="seconds"))
    params.append(node_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE notebook_nodes SET {', '.join(fields)} WHERE id = ?", params)
        return get_notebook_node(node_id)


def _notebook_descendant_ids(conn, node_id: int) -> set[int]:
    """Alle Nachfahren eines Knotens - iterativ statt WITH RECURSIVE, die
    Baumtiefe bleibt hier ohnehin klein (von Hand angelegte Ordner)."""
    ids: set[int] = set()
    frontier = [node_id]
    while frontier:
        placeholders = ",".join("?" for _ in frontier)
        rows = conn.execute(
            f"SELECT id FROM notebook_nodes WHERE parent_id IN ({placeholders})", frontier
        ).fetchall()
        frontier = [r["id"] for r in rows if r["id"] not in ids]
        ids.update(frontier)
    return ids


def move_notebook_node(node_id: int, parent_id: int | None) -> dict:
    """Verschiebt einen Knoten unter einen neuen Elternknoten (None = oberste
    Ebene). Verhindert Zyklen: ein Ordner darf nicht in sich selbst oder einen
    eigenen Nachfahren verschoben werden."""
    if parent_id == node_id:
        raise ValueError("Ein Knoten kann nicht in sich selbst verschoben werden.")
    with get_conn() as conn:
        if parent_id is not None and parent_id in _notebook_descendant_ids(conn, node_id):
            raise ValueError("Ein Ordner kann nicht in einen eigenen Unterordner verschoben werden.")
        conn.execute(
            "UPDATE notebook_nodes SET parent_id = ?, updated_at = ? WHERE id = ?",
            (parent_id, datetime.now().isoformat(timespec="seconds"), node_id),
        )
        return get_notebook_node(node_id)


def delete_notebook_node(node_id: int) -> int:
    """Loescht einen Knoten samt aller Nachfahren - manueller Kaskaden-Delete
    statt FK-Constraint, gleiches Vorgehen wie delete_trade()/delete_account()
    in dieser Datei."""
    with get_conn() as conn:
        ids = _notebook_descendant_ids(conn, node_id) | {node_id}
        placeholders = ",".join("?" for _ in ids)
        cur = conn.execute(f"DELETE FROM notebook_nodes WHERE id IN ({placeholders})", list(ids))
        return cur.rowcount


# ---------- To-Do-Listen (verwaltet im Journal, angezeigt im rechten Menue) ----------

def list_todo_lists() -> list[dict]:
    """Alle Listen samt Eintraegen in zwei Queries statt einem Query pro Liste."""
    with get_conn() as conn:
        lists = [dict(r) for r in conn.execute(
            "SELECT * FROM todo_lists ORDER BY position ASC, id ASC"
        ).fetchall()]
        items = conn.execute("SELECT * FROM todo_items ORDER BY id ASC").fetchall()
    by_list: dict[int, list[dict]] = {}
    for row in items:
        by_list.setdefault(row["list_id"], []).append(dict(row))
    for lst in lists:
        lst["items"] = by_list.get(lst["id"], [])
    return lists


def get_todo_list(list_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM todo_lists WHERE id = ?", (list_id,)).fetchone()
        if not row:
            return None
        lst = dict(row)
        items = conn.execute(
            "SELECT * FROM todo_items WHERE list_id = ? ORDER BY id ASC", (list_id,)
        ).fetchall()
        lst["items"] = [dict(i) for i in items]
        return lst


def create_todo_list(name: str) -> dict:
    now = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        position = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM todo_lists").fetchone()[0]
        cur = conn.execute(
            "INSERT INTO todo_lists (name, visible, position, created_at) VALUES (?, 0, ?, ?)",
            (name, position, now),
        )
        return get_todo_list(cur.lastrowid)


def update_todo_list(list_id: int, name: str | None = None, visible: bool | None = None) -> dict | None:
    fields, params = [], []
    if name is not None:
        fields.append("name = ?"); params.append(name)
    if visible is not None:
        fields.append("visible = ?"); params.append(1 if visible else 0)
    if not fields:
        return get_todo_list(list_id)
    params.append(list_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE todo_lists SET {', '.join(fields)} WHERE id = ?", params)
        return get_todo_list(list_id)


def delete_todo_list(list_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM todo_items WHERE list_id = ?", (list_id,))
        conn.execute("DELETE FROM todo_lists WHERE id = ?", (list_id,))


def create_todo_item(list_id: int, text: str) -> dict:
    now = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO todo_items (list_id, text, created_at) VALUES (?, ?, ?)",
            (list_id, text, now),
        )
        row = conn.execute("SELECT * FROM todo_items WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


def update_todo_item(item_id: int, text: str | None = None, done: bool | None = None) -> dict | None:
    fields, params = [], []
    if text is not None:
        fields.append("text = ?"); params.append(text)
    if done is not None:
        fields.append("done = ?"); params.append(1 if done else 0)
        fields.append("done_at = ?")
        params.append(datetime.now().isoformat(timespec="seconds") if done else None)
    with get_conn() as conn:
        if fields:
            conn.execute(f"UPDATE todo_items SET {', '.join(fields)} WHERE id = ?", params + [item_id])
        row = conn.execute("SELECT * FROM todo_items WHERE id = ?", (item_id,)).fetchone()
        return dict(row) if row else None


def delete_todo_item(item_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM todo_items WHERE id = ?", (item_id,))


# ---------- Strategien, Regeln und Regel-Einhaltung ----------
# Eine Strategie buendelt Regeln (optional in Gruppen). Ein Trade hat hoechstens
# eine Strategie; welche seiner Regeln er befolgt hat, steht in
# trade_rule_status - eine Zeile je beantworteter Regel, fehlende Zeile =
# unbeantwortet (siehe SCHEMA oben).

def list_strategies(include_archived: bool = False) -> list[dict]:
    """Alle Strategien samt Trade-Anzahl, Netto und Trefferquote - eine Query
    statt einer Zusatzabfrage je Strategie."""
    where = "" if include_archived else "WHERE s.archived = 0"
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT s.*, COUNT(t.id) as trade_count,
                       ROUND(COALESCE(SUM(t.net_usd), 0), 2) as net_usd,
                       COALESCE(SUM(CASE WHEN t.net_usd > 0 THEN 1 ELSE 0 END), 0) as wins
                FROM strategies s
                LEFT JOIN trades t ON t.strategy_id = s.id
                {where}
                GROUP BY s.id
                ORDER BY s.position, s.id"""
        ).fetchall()
    return [dict(r, winrate=_quote(r["wins"], r["trade_count"])) for r in rows]


def get_strategy(strategy_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM strategies WHERE id = ?", (strategy_id,)).fetchone()
    return dict(row) if row else None


def create_strategy(name: str) -> dict:
    with get_conn() as conn:
        position = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM strategies").fetchone()[0]
        cur = conn.execute(
            "INSERT INTO strategies (name, position, created_at) VALUES (?, ?, ?)",
            (name, position, datetime.now().isoformat(timespec="seconds")),
        )
        return get_strategy(cur.lastrowid)


def update_strategy(strategy_id: int, name: str | None = None, archived: bool | None = None,
                     is_default: bool | None = None) -> dict | None:
    """Setzt Name, Archiv-Status und/oder Standard-Kennzeichen. Standard gilt fuer
    hoechstens eine Strategie - das Setzen loescht es deshalb bei allen anderen."""
    with get_conn() as conn:
        fields, params = [], []
        if name is not None:
            fields.append("name = ?"); params.append(name)
        if archived is not None:
            fields.append("archived = ?"); params.append(1 if archived else 0)
        if is_default is not None:
            if is_default:
                conn.execute("UPDATE strategies SET is_default = 0")
            fields.append("is_default = ?"); params.append(1 if is_default else 0)
        if fields:
            conn.execute(f"UPDATE strategies SET {', '.join(fields)} WHERE id = ?", params + [strategy_id])
        return get_strategy(strategy_id)


def set_strategy_order(order: list[int]) -> None:
    with get_conn() as conn:
        conn.executemany(
            "UPDATE strategies SET position = ? WHERE id = ?",
            [(pos, sid) for pos, sid in enumerate(order)],
        )


def delete_strategy(strategy_id: int) -> None:
    """Endgueltiges Loeschen: Trades werden entkoppelt (wie bei delete_account),
    Regeln, Gruppen und alle Regel-Bewertungen dieser Strategie verschwinden mit.
    Der schonende Weg ist archived=1 ueber update_strategy()."""
    with get_conn() as conn:
        rule_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM strategy_rules WHERE strategy_id = ?", (strategy_id,)
        ).fetchall()]
        if rule_ids:
            placeholders = ",".join("?" for _ in rule_ids)
            conn.execute(f"DELETE FROM trade_rule_status WHERE rule_id IN ({placeholders})", rule_ids)
        conn.execute("UPDATE trades SET strategy_id = NULL WHERE strategy_id = ?", (strategy_id,))
        conn.execute("DELETE FROM strategy_rules WHERE strategy_id = ?", (strategy_id,))
        conn.execute("DELETE FROM strategy_rule_groups WHERE strategy_id = ?", (strategy_id,))
        conn.execute("DELETE FROM strategies WHERE id = ?", (strategy_id,))


def get_strategy_tree(strategy_id: int, include_archived: bool = False) -> dict | None:
    """Strategie samt Gruppen und Regeln in EINER Struktur - zwei Queries statt
    einer je Gruppe. Regeln ohne Gruppe kommen unter group=None ans Ende, damit
    das Frontend sie als eigenen Block "Ohne Gruppe" zeigen kann."""
    with get_conn() as conn:
        strategy = conn.execute("SELECT * FROM strategies WHERE id = ?", (strategy_id,)).fetchone()
        if not strategy:
            return None
        groups = [dict(r) for r in conn.execute(
            "SELECT * FROM strategy_rule_groups WHERE strategy_id = ? ORDER BY position, id",
            (strategy_id,),
        ).fetchall()]
        rule_where = "" if include_archived else "AND archived = 0"
        rules = [dict(r) for r in conn.execute(
            f"SELECT * FROM strategy_rules WHERE strategy_id = ? {rule_where} ORDER BY position, id",
            (strategy_id,),
        ).fetchall()]

    by_group: dict[int | None, list[dict]] = {}
    for rule in rules:
        by_group.setdefault(rule["group_id"], []).append(rule)
    for g in groups:
        g["rules"] = by_group.get(g["id"], [])
    return {
        **dict(strategy),
        "groups": groups,
        "ungrouped_rules": by_group.get(None, []),
    }


def create_rule_group(strategy_id: int, name: str) -> dict:
    with get_conn() as conn:
        position = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM strategy_rule_groups WHERE strategy_id = ?",
            (strategy_id,),
        ).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO strategy_rule_groups (strategy_id, name, position) VALUES (?, ?, ?)",
            (strategy_id, name, position),
        )
        row = conn.execute("SELECT * FROM strategy_rule_groups WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


def get_rule_group(group_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM strategy_rule_groups WHERE id = ?", (group_id,)).fetchone()
    return dict(row) if row else None


def rename_rule_group(group_id: int, name: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE strategy_rule_groups SET name = ? WHERE id = ?", (name, group_id))


def delete_rule_group(group_id: int) -> None:
    """Loescht nur die Gruppe - ihre Regeln bleiben erhalten und rutschen auf
    "ohne Gruppe". Sonst gingen mit einem Gruppen-Klick unbemerkt alle
    Bewertungen der enthaltenen Regeln verloren."""
    with get_conn() as conn:
        conn.execute("UPDATE strategy_rules SET group_id = NULL WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM strategy_rule_groups WHERE id = ?", (group_id,))


def set_rule_group_order(strategy_id: int, order: list[int]) -> None:
    with get_conn() as conn:
        conn.executemany(
            "UPDATE strategy_rule_groups SET position = ? WHERE id = ? AND strategy_id = ?",
            [(pos, gid, strategy_id) for pos, gid in enumerate(order)],
        )


def get_rule(rule_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM strategy_rules WHERE id = ?", (rule_id,)).fetchone()
    return dict(row) if row else None


def create_rule(strategy_id: int, text: str, group_id: int | None = None) -> dict:
    with get_conn() as conn:
        position = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM strategy_rules WHERE strategy_id = ?",
            (strategy_id,),
        ).fetchone()[0]
        cur = conn.execute(
            """INSERT INTO strategy_rules (strategy_id, group_id, text, position, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (strategy_id, group_id, text, position, datetime.now().isoformat(timespec="seconds")),
        )
        return get_rule(cur.lastrowid)


def update_rule(rule_id: int, text: str | None = None, group_id: int | None = None,
                 clear_group: bool = False, archived: bool | None = None) -> dict | None:
    """Bearbeitet eine Regel an Ort und Stelle - fuer Tippfehler und Umgruppieren.
    Eine INHALTLICHE Aenderung gehoert stattdessen ueber replace_rule(), sonst
    behaupten die bisherigen Bewertungen rueckwirkend etwas Falsches.
    clear_group=True setzt die Gruppe auf None (mit group_id=None allein liesse
    sich "nicht aendern" nicht von "Gruppe entfernen" unterscheiden)."""
    fields, params = [], []
    if text is not None:
        fields.append("text = ?"); params.append(text)
    if clear_group:
        fields.append("group_id = NULL")
    elif group_id is not None:
        fields.append("group_id = ?"); params.append(group_id)
    if archived is not None:
        fields.append("archived = ?"); params.append(1 if archived else 0)
    with get_conn() as conn:
        if fields:
            conn.execute(f"UPDATE strategy_rules SET {', '.join(fields)} WHERE id = ?", params + [rule_id])
        return get_rule(rule_id)


def replace_rule(rule_id: int, text: str) -> dict | None:
    """Inhaltlicher Ersatz: die alte Regel wird archiviert (ihre Bewertungen
    bleiben gueltig und weiterhin auswertbar), eine neue Regel mit demselben
    Platz und derselben Gruppe tritt an ihre Stelle."""
    with get_conn() as conn:
        old = conn.execute("SELECT * FROM strategy_rules WHERE id = ?", (rule_id,)).fetchone()
        if not old:
            return None
        conn.execute("UPDATE strategy_rules SET archived = 1 WHERE id = ?", (rule_id,))
        cur = conn.execute(
            """INSERT INTO strategy_rules (strategy_id, group_id, text, position, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (old["strategy_id"], old["group_id"], text, old["position"],
             datetime.now().isoformat(timespec="seconds")),
        )
        return get_rule(cur.lastrowid)


def delete_rule(rule_id: int) -> None:
    """Endgueltig, samt aller Bewertungen. Der schonende Weg ist archived=1."""
    with get_conn() as conn:
        conn.execute("DELETE FROM trade_rule_status WHERE rule_id = ?", (rule_id,))
        conn.execute("DELETE FROM strategy_rules WHERE id = ?", (rule_id,))


def set_rule_order(strategy_id: int, order: list[int]) -> None:
    with get_conn() as conn:
        conn.executemany(
            "UPDATE strategy_rules SET position = ? WHERE id = ? AND strategy_id = ?",
            [(pos, rid, strategy_id) for pos, rid in enumerate(order)],
        )


def set_trade_strategy(trade_id: int, strategy_id: int | None) -> None:
    """Ordnet einem Trade eine Strategie zu (None = keine). Wechselt die
    Strategie, verlieren die bisherigen Regel-Bewertungen ihren Sinn - sie
    gehoeren zu Regeln einer anderen Strategie. Sie werden deshalb entfernt,
    statt als Karteileichen liegen zu bleiben und Quoten zu verfaelschen."""
    with get_conn() as conn:
        current = conn.execute("SELECT strategy_id FROM trades WHERE id = ?", (trade_id,)).fetchone()
        if not current or current["strategy_id"] == strategy_id:
            return
        conn.execute(
            """DELETE FROM trade_rule_status WHERE trade_id = ? AND rule_id IN (
                   SELECT id FROM strategy_rules WHERE strategy_id IS NOT ?)""",
            (trade_id, strategy_id),
        )
        conn.execute("UPDATE trades SET strategy_id = ? WHERE id = ?", (strategy_id, trade_id))


def bulk_set_trade_strategy(trade_ids: list[int], strategy_id: int | None) -> int:
    """Sammelzuweisung aus der Trades-Uebersicht - Gegenstueck zu
    reassign_unassigned_trades() bei den Konten, aber fuer eine konkrete
    Auswahl statt fuer alle nicht zugeordneten."""
    if not trade_ids:
        return 0
    placeholders = ",".join("?" for _ in trade_ids)
    with get_conn() as conn:
        conn.execute(
            f"""DELETE FROM trade_rule_status
                WHERE trade_id IN ({placeholders}) AND rule_id IN (
                    SELECT id FROM strategy_rules WHERE strategy_id IS NOT ?)""",
            list(trade_ids) + [strategy_id],
        )
        cur = conn.execute(
            f"UPDATE trades SET strategy_id = ? WHERE id IN ({placeholders})",
            [strategy_id] + list(trade_ids),
        )
        return cur.rowcount


def get_trade_rule_status(trade_id: int) -> dict[str, int]:
    """rule_id (als String, damit es sauber durch JSON geht) -> 0/1.
    Nicht enthaltene Regeln sind unbeantwortet."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT rule_id, followed FROM trade_rule_status WHERE trade_id = ?", (trade_id,)
        ).fetchall()
    return {str(r["rule_id"]): r["followed"] for r in rows}


def set_trade_rule_status(trade_id: int, rule_id: int, followed: bool | None) -> None:
    """followed None = Bewertung zuruecknehmen (Regel wieder unbeantwortet).
    Genau dieser Zustand dient auch als "nicht anwendbar"."""
    with get_conn() as conn:
        if followed is None:
            conn.execute(
                "DELETE FROM trade_rule_status WHERE trade_id = ? AND rule_id = ?", (trade_id, rule_id)
            )
        else:
            conn.execute(
                """INSERT INTO trade_rule_status (trade_id, rule_id, followed) VALUES (?, ?, ?)
                   ON CONFLICT(trade_id, rule_id) DO UPDATE SET followed = excluded.followed""",
                (trade_id, rule_id, 1 if followed else 0),
            )


def bulk_set_trade_rule_status(trade_ids: list[int], rule_id: int, followed: bool | None) -> int:
    """Setzt eine Regel fuer mehrere Trades auf einmal. Beruecksichtigt nur
    Trades, die tatsaechlich zur Strategie dieser Regel gehoeren - sonst
    entstuenden Bewertungen fuer Regeln, die der Trade gar nicht hat."""
    if not trade_ids:
        return 0
    placeholders = ",".join("?" for _ in trade_ids)
    with get_conn() as conn:
        rule = conn.execute("SELECT strategy_id FROM strategy_rules WHERE id = ?", (rule_id,)).fetchone()
        if not rule:
            return 0
        eligible = [r["id"] for r in conn.execute(
            f"SELECT id FROM trades WHERE id IN ({placeholders}) AND strategy_id = ?",
            list(trade_ids) + [rule["strategy_id"]],
        ).fetchall()]
        if not eligible:
            return 0
        if followed is None:
            eligible_ph = ",".join("?" for _ in eligible)
            conn.execute(
                f"DELETE FROM trade_rule_status WHERE rule_id = ? AND trade_id IN ({eligible_ph})",
                [rule_id] + eligible,
            )
        else:
            conn.executemany(
                """INSERT INTO trade_rule_status (trade_id, rule_id, followed) VALUES (?, ?, ?)
                   ON CONFLICT(trade_id, rule_id) DO UPDATE SET followed = excluded.followed""",
                [(tid, rule_id, 1 if followed else 0) for tid in eligible],
            )
        return len(eligible)


def _quote(n: int | None, total: int | None) -> float | None:
    """Prozentquote oder None, wenn es keine Grundgesamtheit gibt - None
    bedeutet im Frontend "keine Aussage moeglich", 0.0 hiesse "0 %"."""
    return round(100 * n / total, 1) if total else None


def strategy_rule_stats(strategy_id: int, include_archived: bool = True) -> list[dict]:
    """Je Regel: wie oft beantwortet, wie oft befolgt, und wie die befolgten
    bzw. nicht befolgten Trades gelaufen sind - alles in einer Query statt
    einer je Regel.

    Unbeantwortete Regeln erzeugen keine Zeile in trade_rule_status und fallen
    damit automatisch aus jeder Quote heraus, statt als "nicht befolgt" zu
    zaehlen. Die Zahlen zur Gegengruppe (nicht befolgt) fallen hier ohnehin mit
    ab; die Oberflaeche zeigt zunaechst die Einhaltungsquote, kann den
    Vergleich "mit/ohne Regel" damit aber ohne Migration nachruesten."""
    where_archived = "" if include_archived else "AND r.archived = 0"
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT r.id, r.text, r.group_id, r.archived, r.position,
                       COUNT(s.trade_id) as answered,
                       COALESCE(SUM(s.followed), 0) as followed,
                       COALESCE(SUM(CASE WHEN s.followed = 1 AND trades.net_usd > 0 THEN 1 ELSE 0 END), 0) as wins_followed,
                       COALESCE(SUM(CASE WHEN s.followed = 0 AND trades.net_usd > 0 THEN 1 ELSE 0 END), 0) as wins_broken,
                       COALESCE(SUM(CASE WHEN s.followed = 1 THEN trades.net_usd ELSE 0 END), 0) as net_followed,
                       COALESCE(SUM(CASE WHEN s.followed = 0 THEN trades.net_usd ELSE 0 END), 0) as net_broken
                FROM strategy_rules r
                LEFT JOIN trade_rule_status s ON s.rule_id = r.id
                LEFT JOIN trades ON trades.id = s.trade_id
                WHERE r.strategy_id = ? {where_archived}
                GROUP BY r.id
                ORDER BY r.position, r.id""",
            (strategy_id,),
        ).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        broken = d["answered"] - d["followed"]
        result.append({
            **d,
            "broken": broken,
            "compliance_pct": _quote(d["followed"], d["answered"]),
            "winrate_followed": _quote(d["wins_followed"], d["followed"]),
            "winrate_broken": _quote(d["wins_broken"], broken),
            "net_followed": round(d["net_followed"], 2),
            "net_broken": round(d["net_broken"], 2),
        })
    return result


def strategy_summary(strategy_id: int) -> dict:
    """Kopfzahlen einer Strategie: Trades, Trefferquote, Netto und wie viele
    ihrer Trades ueberhaupt schon Regel-Bewertungen tragen (macht sichtbar,
    wenn eine Quote auf duenner Datenbasis steht)."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT COUNT(*) as trade_count,
                      COALESCE(SUM(CASE WHEN net_usd > 0 THEN 1 ELSE 0 END), 0) as wins,
                      ROUND(COALESCE(SUM(net_usd), 0), 2) as net_usd
               FROM trades WHERE strategy_id = ?""",
            (strategy_id,),
        ).fetchone()
        rated = conn.execute(
            """SELECT COUNT(DISTINCT s.trade_id) as n
               FROM trade_rule_status s JOIN trades t ON t.id = s.trade_id
               WHERE t.strategy_id = ?""",
            (strategy_id,),
        ).fetchone()["n"]
    return {
        "trade_count": row["trade_count"],
        "wins": row["wins"],
        "winrate": _quote(row["wins"], row["trade_count"]),
        "net_usd": row["net_usd"],
        "rated_trade_count": rated,
    }
