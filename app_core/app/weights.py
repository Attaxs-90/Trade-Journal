"""Nasdaq-100-Gewichtung ueber die oeffentlichen Holdings des Invesco-QQQ-ETF.

QQQ bildet den Nasdaq-100 1:1 nach; Nasdaq selbst veroeffentlicht die exakten
Indexgewichte nicht kostenlos, Invesco dagegen taeglich und oeffentlich ueber
diesen von der eigenen Fonds-Seite genutzten JSON-Endpoint (kein offizielles
API, aber ein einfacher, stabiler REST-Aufruf ohne Auth). Liefert die zehn am
staerksten gewichteten Unternehmen - sie bilden die Standardauswahl fuer den
Earnings-Ticker (siehe main.py:_maybe_sync_weights)."""
import json
import urllib.request

_HOLDINGS_URL = (
    "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund"
    "?idType=ticker&interval=monthly&productType=ETF"
)
# Ohne Browser-typischen User-Agent antwortet die API mit leeren/abgelehnten
# Anfragen (live beobachtet), analog zum Feed in news.py.
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json",
}
_TIMEOUT = 10
_TOP_N = 10


def fetch_top10() -> dict:
    """Liefert {effective_date, companies: [{ticker, name, weight_pct}, ...]}
    absteigend nach Gewichtung. Filtert Nicht-Aktien-Positionen raus (der Fonds
    fuehrt z.B. "USD Pending Dividends" als Cash-Zeile ohne Gewichtungswert -
    securityTypeCode "COM" grenzt zuverlaessig auf echte Aktien ein)."""
    req = urllib.request.Request(_HOLDINGS_URL, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    holdings = [
        h for h in payload.get("holdings", [])
        if h.get("percentageOfTotalNetAssets") is not None and h.get("securityTypeCode") == "COM"
    ]
    holdings.sort(key=lambda h: -h["percentageOfTotalNetAssets"])
    top10 = holdings[:_TOP_N]

    return {
        "effective_date": payload.get("effectiveDate"),
        "companies": [
            {
                "ticker": h["ticker"],
                "name": h["issuerName"],
                "weight_pct": round(h["percentageOfTotalNetAssets"], 2),
            }
            for h in top10
        ],
    }
