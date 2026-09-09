"""Broker-Adapter: jeder Anbieter implementiert fetch_closed_trades(..., from_date, to_date).

NinjaTrader hat kein Broker-Login wie MT5 - Auto-Sync laeuft dort stattdessen ueber
eine lokale Datei, die die NinjaScript-AddOn TradeJournalSync schreibt (siehe
ninjatrader_adapter.py). Ohne hinterlegten sync_path bleibt ein NinjaTrader-Konto
wie bisher rein manuell: Trades werden ihm nur per CSV-Import zugeordnet."""
from .mt5_adapter import fetch_closed_trades as mt5_fetch_closed_trades, MT5Error
from .ninjatrader_adapter import fetch_closed_trades as nt_fetch_closed_trades, NinjaTraderError

ADAPTERS = {
    "mt5": mt5_fetch_closed_trades,
    "ninjatrader": nt_fetch_closed_trades,
}

ERRORS = {
    "mt5": MT5Error,
    "ninjatrader": NinjaTraderError,
}

# Plattformen ohne Broker-Login (mt5-artig): Konto-Formular zeigt Login/Passwort/
# Server nicht an. NinjaTrader synct trotzdem automatisch, sobald ein Konto einen
# sync_path hinterlegt hat - das entscheidet sync_account() unten je Konto, nicht
# diese Liste (die steuert nur die Formularfelder im Frontend).
MANUAL_PLATFORMS = {
    "ninjatrader": "NinjaTrader",
}

ALL_PLATFORMS = {"mt5": "MetaTrader 5", **MANUAL_PLATFORMS}


def sync_account(account: dict, from_date, to_date) -> dict:
    """Gibt {"trades": [...], "balance": float|None} zurueck - balance ist der vom
    Broker gemeldete Kontostand zum Sync-Zeitpunkt (fuer die Equity-Kurve)."""
    platform = account["platform"]
    if platform not in ADAPTERS:
        raise ValueError(
            f"Fuer '{ALL_PLATFORMS.get(platform, platform)}' ist kein automatischer Sync moeglich - "
            f"bitte Trades per CSV-Import diesem Konto zuweisen."
        )
    if platform == "ninjatrader":
        return ADAPTERS[platform](
            login=account["login"],
            sync_path=account.get("sync_path") or "",
            from_date=from_date,
            to_date=to_date,
        )
    return ADAPTERS[platform](
        login=int(account["login"]),
        password=account["password"],
        server=account["server"],
        from_date=from_date,
        to_date=to_date,
    )
