"""Broker-Adapter: jeder Anbieter implementiert fetch_closed_trades(account, from_date, to_date).

Manche Plattformen (z.B. NinjaTrader) bieten keine automatische Sync-Anbindung -
Konten mit solchen Plattformen dienen nur der Zuordnung von CSV-Importen zu einem
konkreten Konto (z.B. "Lucid Trading" vs. ein anderes Konto, das ebenfalls ueber
NinjaTrader handelt - gleiche Plattform, aber ein eigenstaendiges Konto)."""
from .mt5_adapter import fetch_closed_trades as mt5_fetch_closed_trades, MT5Error

ADAPTERS = {
    "mt5": mt5_fetch_closed_trades,
}

ERRORS = {
    "mt5": MT5Error,
}

# Plattformen ohne Auto-Sync: nur als Konto-Zuordnung fuer CSV-Importe waehlbar.
MANUAL_PLATFORMS = {
    "ninjatrader": "NinjaTrader (CSV-Import)",
}

ALL_PLATFORMS = {"mt5": "MetaTrader 5", **MANUAL_PLATFORMS}


def sync_account(account: dict, from_date, to_date) -> list[dict]:
    platform = account["platform"]
    if platform not in ADAPTERS:
        raise ValueError(
            f"Fuer '{ALL_PLATFORMS.get(platform, platform)}' ist kein automatischer Sync moeglich - "
            f"bitte Trades per CSV-Import diesem Konto zuweisen."
        )
    return ADAPTERS[platform](
        login=int(account["login"]),
        password=account["password"],
        server=account["server"],
        from_date=from_date,
        to_date=to_date,
    )
