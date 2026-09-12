"""ForexFactory-Wirtschaftskalender fuer die Newsbar. Nutzt den oeffentlichen,
von ForexFactory selbst fuer Kalender-Widgets bereitgestellten JSON-Feed
(https://nfs.faireconomy.media/) statt die Seite zu scrapen - liefert nur
Termin/Titel/Impact/Prognose/Vorwert, keinen tatsaechlichen Ergebniswert und
erst recht keine redaktionellen Artikeltexte. Fuer "was ist tatsaechlich
passiert" verlinkt die App stattdessen auf die jeweilige ForexFactory-Seite.

Der Feed bietet inzwischen nur noch "thisweek" an - "ff_calendar_nextweek.json"
liefert dauerhaft 404 (Stand 09/2026, live geprueft, kein Rate-Limit-Fehler).
"Naechste Woche" wird deshalb per Scraping der Kalenderseite selbst
nachgeladen (siehe fetch_week/get_next_week), mit derselben eingebetteten
JSON-Struktur wie der Monats-Verlaufs-Scraper weiter unten."""
import json
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone

FEED_URLS = [
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
]

# Ohne eigenen User-Agent antwortet der Feed bei wiederholten Anfragen mit
# HTTP 429 (live beobachtet) - ein beschreibender UA reicht, um das zu vermeiden.
_HEADERS = {"User-Agent": "TradeJournal/1.0 (lokale Trading-Journal-App)"}
_TIMEOUT = 8

# ForexFactory kategorisiert Termine selbst in diese Event-Types - das steht
# aber nicht im Feed, deshalb hier per Titel-Keyword angenaehert. Nicht so
# praezise wie ForexFactorys eigene Zuordnung, aber nah genug fuer einen Filter.
EVENT_TYPE_KEYWORDS: dict[str, list[str]] = {
    "Central Bank": ["FOMC", "RATE", "MPC", "RBA", "RBNZ", "BOC", "BOE", "BOJ", "ECB", "SNB", "MONETARY POLICY", "CASH RATE", "MINUTES"],
    "Employment": ["EMPLOYMENT", "UNEMPLOYMENT", "PAYROLL", "JOBLESS", "JOB", "NFP", "JOLTS", "CLAIMS"],
    "Inflation": ["CPI", "PPI", "INFLATION", "PCE", "RPI"],
    "Growth": ["GDP", "GROSS DOMESTIC"],
    "Housing": ["HOUS", "HPI", "HOME SALES", "BUILDING PERMITS", "MORTGAGE"],
    "Consumer Surveys": ["CONSUMER CONFIDENCE", "CONSUMER SENTIMENT", "RETAIL SALES", "CB CONSUMER"],
    "Business Surveys": ["PMI", "ISM", "IFO", "ZEW", "BUSINESS CLIMATE", "BUSINESS CONFIDENCE", "TANKAN"],
    "Speeches": ["SPEAKS", "SPEECH", "TESTIMONY", "PRESS CONFERENCE"],
    "Bonds": ["BOND", "AUCTION", "NOTE AUCTION", "TREASURY"],
}

_cache: dict = {"fetched_at": None, "events": []}
_CACHE_TTL = timedelta(minutes=15)

# FTMO erlaubt keinen Trade (auch keine SL/TP-Ausfuehrung) 2 Minuten vor/nach
# diesen Events (https://ftmo.com/en/faq/can-i-trade-news/). FTMO hat dafuer
# keine eigene API - die eigene Kalenderseite (ftmo.com/en/calendar) laedt die
# Restricted-Markierung erst per JavaScript nach und ist per einfachem
# HTTP-Request (wie hier) nicht auslesbar. Die Titel unten sind deshalb per
# Stichprobe aus dem live gerenderten FTMO-Kalender abgeschrieben (mehrere
# Wochen, Stand 08/2026) - exaktes Titel-Matching (nicht Substring), weil z.B.
# "ADP Non-Farm Employment Change" NICHT restricted ist, "Non-Farm Employment
# Change" aber schon. Faellt die FTMO-Kennzeichnung mal weg oder aendert sich
# der Feed-Titel leicht, matcht dieser Eintrag nicht mehr - kein Ersatz fuer
# einen Blick in FTMOs eigenen Kalender vor dem Trade.
FTMO_RESTRICTED_CONFIRMED: dict[str, list[str]] = {
    "USD": ["Non-Farm Employment Change"],
    "CAD": ["BOC Rate Statement", "Overnight Rate", "Employment Change", "Unemployment Rate"],
    "NZD": ["Official Cash Rate", "RBNZ Monetary Policy Statement", "RBNZ Rate Statement",
            "Employment Change q/q", "Unemployment Rate", "Labor Cost Index q/q"],
    "AUD": ["GDP q/q"],
}
FTMO_RESTRICTED_ALWAYS = ["Crude Oil Inventories"]

# Laut FTMO-FAQ ebenfalls restricted, aber in den geprueften Wochen kam keine
# passende Sitzung/Veroeffentlichung vor (Notenbanksitzungen sind selten) -
# deshalb nicht live bestaetigt. Vorsicht: die FAQ war an anderer Stelle nicht
# wortwoertlich zutreffend (z.B. AUD CPI und USD "Unemployment Rate & Wages"
# sind laut Live-Kalender NICHT restricted, obwohl die FAQ das nahelegt) -
# diese Liste kann also zu weit gefasst sein.
FTMO_RESTRICTED_UNVERIFIED: dict[str, list[str]] = {
    "USD": ["Federal Funds Rate", "FOMC Statement", "CPI y/y", "Advance GDP q/q", "FOMC Meeting Minutes"],
    "EUR": ["Main Refinancing Rate"],
    "GBP": ["Official Bank Rate", "MPC Votes", "CPI y/y"],
    "CHF": ["SNB Policy Rate"],
}


def _ftmo_status(currency: str, title: str) -> str | None:
    """None = kein restricted Event. 'confirmed' = live im FTMO-Kalender
    beobachtet. 'unverified' = nur laut FTMO-FAQ, nicht live bestaetigt."""
    if title in FTMO_RESTRICTED_ALWAYS:
        return "confirmed"
    if title in FTMO_RESTRICTED_CONFIRMED.get(currency, ()):
        return "confirmed"
    if title in FTMO_RESTRICTED_UNVERIFIED.get(currency, ()):
        return "unverified"
    return None


def _categorize(title: str) -> str:
    # Wortgrenzen-Suche statt reinem Substring-Check - sonst matcht z.B. das
    # Central-Bank-Keyword "RATE" auch in "CORPORATE Profits" (beobachtet).
    upper = title.upper()
    for category, keywords in EVENT_TYPE_KEYWORDS.items():
        if any(re.search(rf"\b{re.escape(kw)}\b", upper) for kw in keywords):
            return category
    return "Misc"


def _ff_day_url(dt_local: datetime) -> str:
    month = dt_local.strftime("%b").lower()
    return f"https://www.forexfactory.com/calendar?day={month}{dt_local.day}.{dt_local.year}"


def _parse_event(raw: dict) -> dict | None:
    title = (raw.get("title") or "").strip()
    date_str = raw.get("date")
    if not title or not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt_local = dt.astimezone()

    currency = raw.get("country") or ""
    return dict(
        title=title,
        currency=currency,
        time=dt.isoformat(),
        impact=raw.get("impact") or "Low",
        forecast=raw.get("forecast") or "",
        previous=raw.get("previous") or "",
        event_type=_categorize(title),
        ff_url=_ff_day_url(dt_local),
        ftmo_status=_ftmo_status(currency, title),
    )


def _download(url: str) -> list[dict]:
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_calendar(force: bool = False) -> dict:
    """Liefert {fetched_at, events}. Nutzt den In-Memory-Cache innerhalb der
    TTL; schlaegt der Download fehl (offline, Rate-Limit, Timeout), wird der
    letzte gute Stand weiterverwendet - die App darf dadurch nie abstuerzen
    oder blockieren, analog zum Offline-Verhalten von update_check.ps1."""
    now = datetime.now(timezone.utc)
    if not force and _cache["fetched_at"] and now - _cache["fetched_at"] < _CACHE_TTL:
        return _cache

    # Mit dem letzten guten Stand vorbefuellen statt leer zu starten: schlaegt
    # z.B. nur der Live-Feed fehl (Rate-Limit), waeren sonst alle "diese
    # Woche"-Termine fuer diesen Zyklus verschwunden, obwohl der Scrape fuer
    # "naechste Woche" parallel erfolgreich war - frische Treffer ueberschreiben
    # den alten Stand pro Schluessel ganz normal weiter unten.
    merged: dict[tuple, dict] = {
        (e["title"], e["currency"], e["time"]): e for e in _cache["events"]
    }
    fetched_any = False
    for url in FEED_URLS:
        try:
            raw_events = _download(url)
        except Exception:
            continue
        fetched_any = True
        for raw in raw_events:
            parsed = _parse_event(raw)
            if not parsed:
                continue
            key = (parsed["title"], parsed["currency"], parsed["time"])
            merged[key] = parsed

    # Naechste Woche kommt nicht mehr aus dem Live-Feed (siehe Modul-Docstring),
    # sondern aus einem gecachten Scrape der Kalenderseite - get_next_week()
    # fragt automatisch neu ab, sobald sich die Zielwoche aendert (Montag 00:00).
    for parsed in get_next_week(next_week_monday(now.astimezone().date())):
        fetched_any = True
        key = (parsed["title"], parsed["currency"], parsed["time"])
        merged[key] = parsed

    if not fetched_any:
        # Kompletter Fehlschlag: alten Cache-Stand behalten statt ihn zu leeren.
        return _cache

    events = sorted(merged.values(), key=lambda e: e["time"])
    _cache["fetched_at"] = now
    _cache["events"] = events
    return _cache


# ---------- Verlaufs-Scraper (nur High-Impact + Feiertage, siehe api_scrape_news_history) ----------
# Der Feed oben deckt nur die aktuelle+naechste Woche ab. Fuer die Vergangenheit
# gibt es kein offizielles API - ForexFactorys Kalenderseite selbst liefert die
# Termine eines Monats aber serverseitig gerendert als eingebettetes JSON
# (window.calendarComponentStates[1] = {days: [...]}), nicht per JavaScript
# nachgeladen. Bewusst kein HTML-Parsing der <td>-Zellen, sondern dieses fertig
# strukturierte JSON direkt ausgelesen - robuster, so lange ForexFactory diese
# Struktur nicht aendert. Nur auf expliziten Anstoss (Button), nicht automatisch
# beim Start: ca. eine Anfrage pro Monat, kein offizielles API, also bewusst
# sparsam (Pause zwischen Anfragen) und nur so viel wie noetig.
_CALENDAR_PAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
}
_CALENDAR_PAGE_TIMEOUT = 20


class ScrapeError(Exception):
    pass


def _extract_calendar_days(html: str) -> list[dict]:
    """Liest die eingebettete window.calendarComponentStates[1]-Struktur aus
    dem Seiten-HTML. Klammer-Zaehlung statt eines gierigen Regex, weil das
    JSON selbst eckige Klammern enthaelt (Sub-Arrays); bricht mit einer
    klaren Fehlermeldung ab statt stillschweigend falsche/leere Daten zu
    liefern, wenn ForexFactory dieses Format mal aendert."""
    m = re.search(r"window\.calendarComponentStates\[1\]\s*=\s*\{\s*days:\s*(\[)", html)
    if not m:
        raise ScrapeError("ForexFactory-Seitenstruktur nicht erkannt (calendarComponentStates fehlt) - Scraper muss angepasst werden.")
    start = m.start(1)
    depth, i, in_str, esc = 0, start, False, False
    while i < len(html):
        c = html[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
        i += 1
    try:
        return json.loads(html[start:i])
    except json.JSONDecodeError as e:
        raise ScrapeError(f"ForexFactory-Kalenderdaten nicht lesbar: {e}") from e


_IMPACT_NAME_TO_LABEL = {"high": "High", "holiday": "Holiday"}


def scrape_month(year: int, month: int) -> list[dict]:
    """Ein Monat des ForexFactory-Kalenders, nur High-Impact- und
    Feiertagstermine (siehe Nutzer-Entscheidung: kein voller Verlaufsimport
    aller Impact-Stufen wegen Datenmenge/Rauschen). Liefert dieselbe Feldform
    wie marked_news erwartet (siehe db.bulk_add_news_history)."""
    month_str = datetime(year, month, 1).strftime("%b").lower()
    url = f"https://www.forexfactory.com/calendar?month={month_str}.{year}"
    req = urllib.request.Request(url, headers=_CALENDAR_PAGE_HEADERS)
    with urllib.request.urlopen(req, timeout=_CALENDAR_PAGE_TIMEOUT) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    events = []
    for day in _extract_calendar_days(html):
        # date sieht z.B. so aus: "Mon <span>Jan 1</span>" - HTML-Tags raus,
        # dann die Tageszahl am Ende nehmen (robuster als eine feste Anzahl
        # Woerter davor zu erwarten).
        date_text = re.sub(r"<[^>]+>", " ", day.get("date") or "")
        day_match = re.search(r"(\d{1,2})\s*$", date_text.strip())
        if not day_match:
            continue
        day_iso = f"{year:04d}-{month:02d}-{int(day_match.group(1)):02d}"
        for ev in day.get("events", []):
            impact_label = _IMPACT_NAME_TO_LABEL.get(ev.get("impactName"))
            if not impact_label:
                continue
            title = (ev.get("name") or "").strip()
            if not title:
                continue
            events.append(dict(
                day=day_iso,
                title=title,
                currency=ev.get("currency") or ev.get("country") or "",
                impact=impact_label,
                event_type=_categorize(title),
                time=f"{day_iso}T12:00:00",
                ff_url=_ff_day_url(datetime.fromisoformat(day_iso)),
            ))
    return events


# ---------- "Naechste Woche" (Ersatz fuer den 404 gewordenen nextweek-Feed) ----------
# Dieselbe eingebettete JSON-Struktur wie scrape_month, aber mit vollem
# Feld-Umfang (Uhrzeit als Unix-Timestamp, Impact aller Stufen, Prognose/
# Vorwert) - reicht, um dieselbe Form wie _parse_event() (Live-Feed) zu bauen,
# damit beide Quellen im selben Cache landen koennen (siehe fetch_calendar).

_IMPACT_NAME_TO_TITLE = {"high": "High", "medium": "Medium", "low": "Low", "holiday": "Holiday"}


def _parse_scraped_event(raw: dict) -> dict | None:
    title = (raw.get("prefixedName") or raw.get("name") or "").strip()
    dateline = raw.get("dateline")
    if not title or not dateline:
        return None
    dt = datetime.fromtimestamp(dateline, tz=timezone.utc).astimezone()
    currency = raw.get("currency") or ""
    impact_label = _IMPACT_NAME_TO_TITLE.get((raw.get("impactName") or "").lower(), "Low")
    return dict(
        title=title,
        currency=currency,
        time=dt.isoformat(),
        impact=impact_label,
        forecast=raw.get("forecast") or "",
        previous=raw.get("previous") or "",
        event_type=_categorize(title),
        ff_url=_ff_day_url(dt),
        ftmo_status=_ftmo_status(currency, title),
    )


def fetch_week(monday: date) -> list[dict]:
    """Montag bis Freitag einer bestimmten Kalenderwoche, direkt von der
    ForexFactory-Kalenderseite (?week=...) gescrapt. Filtert ueber den eigenen
    Zeitstempel jedes Events (dateline), nicht ueber die Tages-Ueberschriften
    der Seite - die Seite liefert bei einem week-Parameter auch ein paar Tage
    vor/nach der eigentlichen Woche mit, die so zuverlaessig rausfallen."""
    week_str = f"{monday.strftime('%b').lower()}{monday.day}.{monday.year}"
    url = f"https://www.forexfactory.com/calendar?week={week_str}"
    req = urllib.request.Request(url, headers=_CALENDAR_PAGE_HEADERS)
    with urllib.request.urlopen(req, timeout=_CALENDAR_PAGE_TIMEOUT) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    friday = monday + timedelta(days=4)
    events = []
    for day in _extract_calendar_days(html):
        for raw in day.get("events", []):
            parsed = _parse_scraped_event(raw)
            if not parsed:
                continue
            if monday <= datetime.fromisoformat(parsed["time"]).date() <= friday:
                events.append(parsed)
    return events


_next_week_cache: dict = {"monday": None, "fetched_at": None, "events": []}
# Wirtschaftstermine fuer die Folgewoche aendern sich nicht stuendlich - anders
# als der Live-Feed oben ist das hier ein echter Seitenabruf (kein offizielles
# API), deshalb bewusst ein deutlich laengerer Cache als _CACHE_TTL.
_NEXT_WEEK_CACHE_TTL = timedelta(hours=3)


def get_next_week(monday: date) -> list[dict]:
    """Wie fetch_week(), aber gecacht - und fragt automatisch neu ab, sobald
    sich `monday` aendert (z.B. Montag 00:00 Uhr, wenn die bisherige
    "naechste Woche" zur aktuellen wird und die neue Folgewoche geladen werden
    soll). Schlaegt der Abruf fehl, bleibt der letzte gute Stand fuer dieselbe
    Woche stehen; fuer eine andere Woche liefert es dann eine leere Liste,
    statt veraltete Termine der falschen Woche zu zeigen."""
    now = datetime.now(timezone.utc)
    if (_next_week_cache["monday"] == monday and _next_week_cache["fetched_at"]
            and now - _next_week_cache["fetched_at"] < _NEXT_WEEK_CACHE_TTL):
        return _next_week_cache["events"]
    try:
        events = fetch_week(monday)
    except Exception:
        return _next_week_cache["events"] if _next_week_cache["monday"] == monday else []
    _next_week_cache["monday"] = monday
    _next_week_cache["fetched_at"] = now
    _next_week_cache["events"] = events
    return events


def next_week_monday(today: date | None = None) -> date:
    today = today or date.today()
    this_monday = today - timedelta(days=today.weekday())
    return this_monday + timedelta(days=7)
