"""ForexFactory-Wirtschaftskalender fuer die Newsbar. Nutzt den oeffentlichen,
von ForexFactory selbst fuer Kalender-Widgets bereitgestellten JSON-Feed
(https://nfs.faireconomy.media/) statt die Seite zu scrapen - liefert nur
Termin/Titel/Impact/Prognose/Vorwert, keinen tatsaechlichen Ergebniswert und
erst recht keine redaktionellen Artikeltexte. Fuer "was ist tatsaechlich
passiert" verlinkt die App stattdessen auf die jeweilige ForexFactory-Seite."""
import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone

FEED_URLS = [
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
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

    merged: dict[tuple, dict] = {}
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

    if not fetched_any:
        # Kompletter Fehlschlag: alten Cache-Stand behalten statt ihn zu leeren.
        return _cache

    events = sorted(merged.values(), key=lambda e: e["time"])
    _cache["fetched_at"] = now
    _cache["events"] = events
    return _cache
