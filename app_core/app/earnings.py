"""Naechste Quartalszahlen (Earnings) der aktuell verfolgten Unternehmen
(Top 10 nach Nasdaq-100-Gewichtung, siehe weights.py) fuer den Earnings-
Ticker.

Nasdaq bietet keinen Endpoint fuer "naechster Termin je Symbol" - nur einen
Tages-Kalender (wer berichtet an Tag X). Der naechste Termin je Firma wird
deshalb Tag fuer Tag vorwaerts gesucht, bis alle gesuchten Symbole gefunden
sind oder das Suchfenster ausgeschoepft ist. Laeuft nur einmal taeglich
(siehe main.py:_maybe_scan_earnings) und nur fuer Symbole, deren zuletzt
bekannter Termin fehlt oder schon verstrichen ist - das Ergebnis wird
dauerhaft in app_settings gespeichert, damit ein Neustart nicht jedes Mal
neu scannen muss."""
import concurrent.futures
import json
import urllib.request
from datetime import date, timedelta

_CALENDAR_URL = "https://api.nasdaq.com/api/calendar/earnings?date={date}"
# Ohne Browser-typischen User-Agent antwortet Nasdaq mit leeren/abgelehnten
# Anfragen (live beobachtet), analog zum Feed in news.py.
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json",
}
_TIMEOUT = 8
# Eine volle Quartalsspanne (~91 Tage) plus Puffer - reicht, um fuer jedes
# Symbol garantiert den naechsten Termin zu finden, auch wenn er noch nicht
# angekuendigt ist und deshalb erst kurz vorher im Kalender auftaucht.
_SCAN_DAYS = 130
# Nasdaq beantwortet mehrere gleichzeitige Anfragen anstandslos (live
# getestet); parallel statt sequentiell gefragt bringt die realistische
# Anfragedauer von ca. 1-3s je Tag auf eine Gesamtlaufzeit herunter, die auch
# beim allerersten (kalten) Scan ueber alle 130 Tage nicht ausufert.
_BATCH_SIZE = 10


def _fetch_day(day: date) -> list[dict]:
    url = _CALENDAR_URL.format(date=day.isoformat())
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    rows = (payload.get("data") or {}).get("rows") or []
    return rows


def _fetch_day_safe(day: date) -> list[dict]:
    try:
        return _fetch_day(day)
    except Exception:
        # Ein einzelner fehlgeschlagener Tag (Timeout, Rate-Limit) wird
        # uebersprungen statt den ganzen Scan abzubrechen.
        return []


def scan_upcoming(pending: set[str], found: dict[str, dict], today: date | None = None) -> None:
    """Sucht ab heute vorwaerts nach dem naechsten Termin fuer jedes Symbol in
    `pending` und traegt Treffer direkt in `found` ein (statt sie erst am Ende
    zurueckzugeben) - laeuft in main.py in einem eigenen Thread, der nicht auf
    den App-Start wartet; ein Abbruch mittendrin darf die bis dahin bereits
    gefundenen Termine trotzdem nicht verwerfen. Fragt mehrere Tage parallel
    ab (siehe _BATCH_SIZE), verarbeitet die Antworten aber in chronologischer
    Reihenfolge - sonst koennte ein spaeterer Tag, dessen Antwort zufaellig
    frueher eintrifft, faelschlich als "naechster" Termin gewertet werden.
    Bricht frueh ab, sobald alle gesuchten Symbole gefunden sind - im
    Regelfall reicht das nach wenigen Wochen, weil die Firmen ueber das
    Quartal verteilt berichten."""
    pending = set(pending)
    start = today or date.today()
    days = [start + timedelta(days=i) for i in range(_SCAN_DAYS)]
    for i in range(0, len(days), _BATCH_SIZE):
        if not pending:
            break
        batch = days[i:i + _BATCH_SIZE]
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(batch)) as pool:
            rows_per_day = list(pool.map(_fetch_day_safe, batch))
        for day, rows in zip(batch, rows_per_day):
            for row in rows:
                symbol = (row.get("symbol") or "").upper()
                if symbol in pending:
                    found[symbol] = {
                        "date": day.isoformat(),
                        "time": row.get("time") or "time-not-supplied",
                        "fiscal_quarter": row.get("fiscalQuarterEnding") or "",
                    }
                    pending.discard(symbol)
