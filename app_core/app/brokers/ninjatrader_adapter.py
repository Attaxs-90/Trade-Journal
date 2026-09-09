"""NinjaTrader-Auto-Sync: liest Fills aus der Datei, in die die NinjaScript-AddOn
'TradeJournalSync' (siehe ninjascript/TradeJournalSync.cs) bei jeder Ausfuehrung
fortlaufend eine Zeile anhaengt - im selben Spaltenformat wie der manuelle
Executions-Export, deshalb Wiederverwendung von parser.parse_csv()/pair_trades()
statt einer eigenen Parsing-Logik.

Kein Broker-Login noetig: die Zuordnung zu diesem Journal-Konto laeuft ueber den
NinjaTrader-Kontonamen (Feld 'Account display name' in der Sync-Datei), der beim
Anlegen des Kontos als 'login' hinterlegt wird - dieselbe Datei kann so mehrere
NinjaTrader-Konten gleichzeitig bedienen."""
from datetime import datetime
from pathlib import Path

from ..parser import parse_csv, pair_trades


class NinjaTraderError(Exception):
    pass


def fetch_closed_trades(login: str, sync_path: str, from_date: datetime, to_date: datetime, **_ignored) -> dict:
    if not sync_path:
        raise NinjaTraderError(
            "Kein Sync-Ordner hinterlegt - Pfad zur von TradeJournalSync.cs "
            "geschriebenen Datei in den Kontoeinstellungen eintragen."
        )
    path = Path(sync_path)
    if path.is_dir():
        # Haeufigste Fehlbedienung: der Ordner statt der Datei von
        # TradeJournalSync.cs wird eingetragen - Path.open() auf einen Ordner
        # wirft unter Windows PermissionError statt eines klaren Fehlers.
        path = path / "executions.csv"
    if not path.exists():
        raise NinjaTraderError(
            f"Sync-Datei nicht gefunden: {path} - Pfad zur Datei (nicht zum Ordner) "
            "eintragen, die TradeJournalSync.cs schreibt."
        )

    content = path.read_text(encoding="utf-8-sig", errors="replace")
    fills = [f for f in parse_csv(content) if not login or f["account"] == login]

    # Komplette Datei paaren, from_date/to_date bewusst NICHT zum Filtern nutzen:
    # TradeJournalSync.cs schreibt NinjaTraders lokale Zeit ohne Zeitzone, waehrend
    # from_date/to_date UTC sind (siehe _run_account_sync) - ein Vergleich beider
    # wuerde bei Sommerzeit ganz reale, bereits geschlossene Trades als "in der
    # Zukunft" verwerfen (beobachtet: 19:02 Uhr lokal lag nach UTC+2 spaeter als
    # das UTC-"jetzt"). Die Datei waechst nur um Fills seit dem letzten Sync,
    # bleibt also klein genug fuer ein komplettes Neu-Paaren bei jedem Sync -
    # insert_trades() dedupliziert ohnehin ueber (entry_order_id, exit_order_id).
    trades = pair_trades(fills)
    return {"trades": trades, "balance": None}
