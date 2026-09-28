"""MetaTrader-5-Anbindung. Liest geschlossene Trades direkt aus dem lokalen MT5-Terminal
per Investor-/Read-Only-Login aus. Es werden keine Order- oder Handelsrechte benoetigt."""
import subprocess
import time
from datetime import UTC, datetime

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None


class MT5Error(Exception):
    pass


def _broker_time(epoch_seconds: int) -> datetime:
    """MT5-Zeitstempel in ein naives datetime in Broker-Zeit umrechnen. Der
    Zeitstempel ist bereits Broker-Zeit, wird von MT5 aber wie ein UTC-Epoch
    geliefert - deshalb in UTC interpretieren und die Zeitzone danach wieder
    abstreifen, statt in die lokale Zone umzurechnen (siehe Aufrufstelle).
    Ersetzt datetime.utcfromtimestamp(), das seit Python 3.12 deprecated und
    zur Entfernung vorgemerkt ist, bei identischem Ergebnis."""
    return datetime.fromtimestamp(epoch_seconds, UTC).replace(tzinfo=None)


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


def _entry_risk_usd(entry, points: float, gross_usd: float, orders: dict) -> float | None:
    """Naeherung des Risikos in $ aus dem Stop-Loss des Eroeffnungs-Orders -
    Basis fuer die R-Multiple auf der Trade-Detailseite/Share-Karte. Nutzt
    das $-pro-Punkt-Verhaeltnis dieses Trades (gross_usd/points) statt
    Symbol-Kontraktspezifikationen abzufragen, analog zur bereits
    vorhandenen "points"-Naeherung. None wenn kein SL gesetzt war oder
    points 0 ist (Breakeven-Exit) - dann muss der Nutzer das Risiko manuell
    eintragen (siehe update_trade_risk in db.py)."""
    order = orders.get(entry.order)
    if order is None:
        try:
            found = mt5.history_orders_get(ticket=entry.order)
        except Exception:
            found = None
        if not found:
            return None
        order = orders[entry.order] = found[0]
    sl = order.sl
    if not sl or not points:
        return None
    risk_points = abs(entry.price - sl)
    if not risk_points:
        return None
    return round(risk_points * abs(gross_usd / points), 2)


def _terminal_pids() -> set[int]:
    """PIDs aller laufenden MT5-Terminals (terminal64.exe). Leere Menge, wenn
    keins laeuft oder tasklist nicht verfuegbar ist."""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq terminal64.exe", "/FO", "CSV", "/NH"],
            capture_output=True, timeout=5,
        ).stdout.decode("ascii", errors="replace")  # deutsche Meldung "keine Aufgaben" ist OEM-kodiert
    except Exception:
        return set()
    pids = set()
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) > 1 and parts[0].lower() == "terminal64.exe" and parts[1].isdigit():
            pids.add(int(parts[1]))
    return pids


def _close_started_terminals(pids_before: set[int]):
    """mt5.shutdown() trennt nur die IPC-Verbindung, laesst ein von
    initialize() gestartetes Terminal aber offen. Der Nutzer moechte es nach
    dem Sync nicht dauerhaft offen haben - beendet werden aber nur Terminals,
    die WAEHREND des Syncs neu gestartet wurden. Frueher lief hier
    taskkill /IM terminal64.exe und schoss damit auch ein Terminal ab, in dem
    der Nutzer gerade handelte (EAs, vom Terminal verwaltete Stops)."""
    for pid in _terminal_pids() - pids_before:
        try:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=5)
        except Exception:
            pass


def _fill_incomplete_positions(deals: list) -> list:
    """Die Zeitfenster-Abfrage liefert fuer sehr frisch geschlossene Positionen
    manchmal nur den Entry-Deal, nicht den Exit-Deal - auch nach mehrfachem
    Nachfragen in _fetch_deals_stable (beobachtet: Exit-Deal ueber 1,5 Stunden
    lang nicht im Zeitfenster-Ergebnis, obwohl das Zeitfenster ihn abdeckt).
    Eine gezielte Abfrage per position liefert dieselbe Position dagegen sofort
    vollstaendig. Deshalb Positionen einzeln nachladen und per Ticket
    dedupliziert mergen - aber nur die unvollstaendigen (Entry fehlt, weil er
    vor dem Fenster lag, oder das Exit-Volumen deckt das Entry-Volumen nicht):
    eine Einzelabfrage je Position machte einen 365-Tage-Resync zu Hunderten
    IPC-Aufrufen, obwohl fast alle Positionen schon vollstaendig vorlagen."""
    volumes: dict[int, list[float]] = {}  # position_id -> [entry_volume, exit_volume]
    for d in deals:
        if d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            continue
        v = volumes.setdefault(d.position_id, [0.0, 0.0])
        if d.entry == mt5.DEAL_ENTRY_IN:
            v[0] += d.volume
        else:
            v[1] += d.volume
    incomplete = [pid for pid, (vin, vout) in volumes.items() if not vin or vout + 1e-9 < vin]
    by_ticket = {d.ticket: d for d in deals}
    for position_id in incomplete:
        for d in mt5.history_deals_get(position=position_id) or []:
            by_ticket[d.ticket] = d
    return list(by_ticket.values())


def _orders_by_ticket(from_date: datetime, to_date: datetime) -> dict:
    """Alle Orders des Zeitfensters in einem Aufruf statt einer Abfrage je Trade
    (siehe _entry_risk_usd) - aeltere Entry-Orders ausserhalb des Fensters
    fragt _entry_risk_usd einzeln nach."""
    try:
        return {o.ticket: o for o in (mt5.history_orders_get(from_date, to_date) or [])}
    except Exception:
        return {}


def fetch_closed_trades(login: int, password: str, server: str, from_date: datetime, to_date: datetime) -> dict:
    _ensure_available()

    # Laeuft schon ein Terminal, haengt sich initialize() daran an - mit
    # Zugangsdaten wuerde es das offene Terminal auf dieses Konto umschalten,
    # mitten in der Handelssitzung des Nutzers. Deshalb dann ohne Login
    # anhaengen und nur synchronisieren, wenn dort ohnehin dieses Konto offen ist.
    pids_before = _terminal_pids()
    if pids_before:
        if not mt5.initialize():
            code, desc = mt5.last_error()
            raise MT5Error(f"Verbindung zum offenen MT5-Terminal fehlgeschlagen ({code}): {desc}")
        info = mt5.account_info()
        if not info or info.login != login:
            mt5.shutdown()
            current = info.login if info else "unbekannt"
            raise MT5Error(
                f"MetaTrader 5 ist gerade mit Konto {current} geöffnet. Der Sync von Konto {login} "
                f"wurde übersprungen, damit dein offenes Terminal nicht umgeschaltet wird. "
                f"MT5 schließen oder dort zu Konto {login} wechseln und erneut synchronisieren."
            )
    elif not mt5.initialize(login=login, password=password, server=server):
        code, desc = mt5.last_error()
        _close_started_terminals(pids_before)
        raise MT5Error(f"MT5-Login fehlgeschlagen ({code}): {desc}")

    try:
        account_info = mt5.account_info()
        balance = account_info.balance if account_info else None

        deals = _fetch_deals_stable(from_date, to_date)
        deals = _fill_incomplete_positions(deals)
        orders = _orders_by_ticket(from_date, to_date)

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
                risk_usd = _entry_risk_usd(entry, points, exit_deal.profit, orders)

                # _broker_time, NICHT fromtimestamp() ohne Zeitzone: MT5 liefert
                # bereits Broker-Zeit. Eine zusaetzliche Umrechnung in die lokale
                # Zeitzone schiebt spaet geschlossene Trades auf den Folgetag.
                trades.append(dict(
                    day=_broker_time(exit_deal.time).date().isoformat(),
                    instrument=exit_deal.symbol,
                    direction=direction,
                    entry_time=_broker_time(entry.time).isoformat(),
                    exit_time=_broker_time(exit_deal.time).isoformat(),
                    entry_price=entry.price,
                    exit_price=exit_deal.price,
                    exit_type=("Teilausstieg" if len(exits) > 1 else "Close"),
                    points=round(points, 5),
                    volume=round(exit_deal.volume, 2),
                    gross_usd=round(exit_deal.profit, 2),
                    commission_usd=round(-costs, 2),
                    net_usd=round(net, 2),
                    # Login im Schluessel: Positions-IDs sind nur je Broker-Server
                    # eindeutig, zwei MT5-Konten bei verschiedenen Brokern koennten
                    # sonst kollidieren und einer der Trades fiele still weg
                    # (Bestandstrades stellt Migration 40 in db.py auf dieses Format um).
                    entry_order_id=f"mt5:{login}:{position_id}:{entry.ticket}",
                    exit_order_id=f"mt5:{login}:{position_id}:{exit_deal.ticket}",
                    source="mt5",
                    risk_usd=risk_usd,
                ))
        return {"trades": trades, "balance": balance}
    finally:
        mt5.shutdown()
        _close_started_terminals(pids_before)
