"""MetaTrader-5-Anbindung. Liest geschlossene Trades direkt aus dem lokalen MT5-Terminal
per Investor-/Read-Only-Login aus. Es werden keine Order- oder Handelsrechte benoetigt."""
import subprocess
import time
from datetime import datetime

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None


class MT5Error(Exception):
    pass


def _ensure_available():
    if mt5 is None:
        raise MT5Error(
            "Das Paket 'MetaTrader5' ist nicht installiert (nur unter Windows, "
            "benoetigt ein installiertes MT5-Terminal)."
        )


def _fetch_deals_stable(from_date: datetime, to_date: datetime, retries: int = 4, delay: float = 1.5) -> list:
    """MT5 laedt Historie fuer aeltere Zeitraeume teils erst im Hintergrund vom
    Broker-Server nach - eine Abfrage direkt nach initialize() kann noch
    unvollstaendige Daten liefern (beobachtet: 22 statt tatsaechlich 62+ Deals
    bei gleichem Zeitfenster). Deshalb mehrfach abfragen und erst zurueckgeben,
    wenn sich die Trefferzahl zwischen zwei Versuchen nicht mehr aendert."""
    deals = mt5.history_deals_get(from_date, to_date) or []
    prev_count = -1
    for _ in range(retries):
        if len(deals) == prev_count:
            break
        prev_count = len(deals)
        time.sleep(delay)
        deals = mt5.history_deals_get(from_date, to_date) or []
    return deals


def _close_terminal():
    """mt5.shutdown() unten trennt nur die IPC-Verbindung zum Terminal, laesst
    das Terminal-Fenster aber offen (startet es sogar automatisch, falls es
    noch nicht lief). Der Nutzer moechte es nach dem Sync nicht dauerhaft
    offen haben, deshalb den Terminal-Prozess gezielt per Name beenden -
    Fehler (z. B. Terminal laeuft gar nicht) werden stillschweigend ignoriert."""
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", "terminal64.exe"],
            capture_output=True, timeout=5,
        )
    except Exception:
        pass


def _fill_incomplete_positions(deals: list) -> list:
    """Die Zeitfenster-Abfrage liefert fuer sehr frisch geschlossene Positionen
    manchmal nur den Entry-Deal, nicht den Exit-Deal - auch nach mehrfachem
    Nachfragen in _fetch_deals_stable (beobachtet: Exit-Deal ueber 1,5 Stunden
    lang nicht im Zeitfenster-Ergebnis, obwohl das Zeitfenster ihn abdeckt).
    Eine gezielte Abfrage per position liefert dieselbe Position dagegen sofort
    vollstaendig. Deshalb jede in der Zeitfenster-Abfrage gefundene Position
    einzeln nachladen und per Ticket dedupliziert mergen."""
    position_ids = {d.position_id for d in deals if d.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)}
    by_ticket = {d.ticket: d for d in deals}
    for position_id in position_ids:
        for d in mt5.history_deals_get(position=position_id) or []:
            by_ticket[d.ticket] = d
    return list(by_ticket.values())


def fetch_closed_trades(login: int, password: str, server: str, from_date: datetime, to_date: datetime) -> dict:
    _ensure_available()

    if not mt5.initialize(login=login, password=password, server=server):
        code, desc = mt5.last_error()
        raise MT5Error(f"MT5-Login fehlgeschlagen ({code}): {desc}")

    try:
        account_info = mt5.account_info()
        balance = account_info.balance if account_info else None

        deals = _fetch_deals_stable(from_date, to_date)
        deals = _fill_incomplete_positions(deals)

        by_position: dict[int, list] = {}
        for d in deals:
            if d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
                continue  # Ein-/Auszahlungen, Kredite etc. ausschliessen
            by_position.setdefault(d.position_id, []).append(d)

        trades = []
        for position_id, group in by_position.items():
            group.sort(key=lambda d: d.time)
            entries = [d for d in group if d.entry == mt5.DEAL_ENTRY_IN]
            exits = [d for d in group if d.entry in
                     (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_INOUT, mt5.DEAL_ENTRY_OUT_BY)]
            if not entries or not exits:
                continue

            entry = entries[0]
            entry_volume = sum(e.volume for e in entries) or entry.volume

            for exit_deal in exits:
                share = (exit_deal.volume / entry_volume) if entry_volume else 1.0
                entry_cost_share = entry.commission * share
                costs = exit_deal.commission + exit_deal.swap + entry_cost_share
                net = exit_deal.profit + costs
                direction = "Long" if entry.type == mt5.DEAL_TYPE_BUY else "Short"
                points = (exit_deal.price - entry.price) if direction == "Long" else (entry.price - exit_deal.price)

                # utcfromtimestamp, NICHT fromtimestamp: MT5 liefert bereits
                # Broker-Zeit. Eine zusaetzliche Umrechnung in die lokale
                # Zeitzone schiebt spaet geschlossene Trades auf den Folgetag.
                trades.append(dict(
                    day=datetime.utcfromtimestamp(exit_deal.time).date().isoformat(),
                    instrument=exit_deal.symbol,
                    direction=direction,
                    entry_time=datetime.utcfromtimestamp(entry.time).isoformat(),
                    exit_time=datetime.utcfromtimestamp(exit_deal.time).isoformat(),
                    entry_price=entry.price,
                    exit_price=exit_deal.price,
                    exit_type=("Teilausstieg" if len(exits) > 1 else "Close"),
                    points=round(points, 5),
                    gross_usd=round(exit_deal.profit, 2),
                    commission_usd=round(-costs, 2),
                    net_usd=round(net, 2),
                    entry_order_id=f"mt5:{position_id}:{entry.ticket}",
                    exit_order_id=f"mt5:{position_id}:{exit_deal.ticket}",
                    source="mt5",
                ))
        return {"trades": trades, "balance": balance}
    finally:
        mt5.shutdown()
        _close_terminal()
