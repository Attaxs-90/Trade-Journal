"""Einlesen von NinjaTrader-Grid-CSV-Exporten und Pairing von Entry/Exit-Fills zu Trades."""
import csv
import io
from collections import deque, defaultdict
from datetime import datetime

from .config import point_value_for


def _to_float(s: str) -> float:
    s = s.strip().replace("$", "").strip()
    if not s:
        return 0.0
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def parse_csv(content: str) -> list[dict]:
    """Liest den rohen CSV-Text ein und gibt eine Liste einzelner Fills zurueck."""
    reader = csv.DictReader(io.StringIO(content), delimiter=";")
    fills = []
    for row in reader:
        instrument = (row.get("Instrument") or "").strip()
        if not instrument:
            continue
        root = instrument.split()[0]
        action = (row.get("Action") or "").strip()
        qty = int((row.get("Quantity") or "0").strip())
        price = _to_float(row.get("Price") or "0")
        time_raw = (row.get("Time") or "").strip()
        time = datetime.strptime(time_raw, "%d%m%Y %H:%M:%S")
        ex = (row.get("E/X") or "").strip()
        order_id = (row.get("Order ID") or "").strip()
        name = (row.get("Name") or "").strip()
        commission = _to_float(row.get("Commission") or "0")
        fills.append(dict(
            instrument=root, action=action, qty=qty, price=price,
            time=time, ex=ex, order_id=order_id, name=name, commission=commission,
        ))
    return fills


def pair_trades(fills: list[dict]) -> list[dict]:
    """Paart Entry- und Exit-Fills chronologisch (FIFO, je Tag und Instrument) zu Trades."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for f in fills:
        key = (f["time"].date(), f["instrument"])
        groups[key].append(f)

    trades = []
    for (day, instrument), group_fills in groups.items():
        group_fills.sort(key=lambda f: f["time"])
        open_entries: deque = deque()
        pv = point_value_for(instrument)  # einmal pro Instrument, nicht pro Trade

        for f in group_fills:
            per_unit_commission = f["commission"] / f["qty"] if f["qty"] else 0.0

            if f["ex"] == "Entry":
                for _ in range(f["qty"]):
                    open_entries.append(dict(
                        time=f["time"], price=f["price"], action=f["action"],
                        commission=per_unit_commission, order_id=f["order_id"],
                    ))
            elif f["ex"] == "Exit":
                for _ in range(f["qty"]):
                    if not open_entries:
                        continue
                    entry = open_entries.popleft()
                    direction = "Long" if entry["action"] == "Buy" else "Short"
                    points = (f["price"] - entry["price"]) if direction == "Long" else (entry["price"] - f["price"])
                    gross = points * pv
                    commission_total = entry["commission"] + per_unit_commission
                    net = gross - commission_total
                    trades.append(dict(
                        day=str(day),
                        instrument=instrument,
                        direction=direction,
                        entry_time=entry["time"].isoformat(),
                        exit_time=f["time"].isoformat(),
                        entry_price=entry["price"],
                        exit_price=f["price"],
                        exit_type=f["name"],
                        points=round(points, 4),
                        gross_usd=round(gross, 2),
                        commission_usd=round(commission_total, 2),
                        net_usd=round(net, 2),
                        entry_order_id=entry["order_id"],
                        exit_order_id=f["order_id"],
                        source="ninjatrader",
                        volume=1,  # Fills werden oben je Kontrakt einzeln aufgeteilt (siehe open_entries)
                    ))

    trades.sort(key=lambda t: t["entry_time"])
    return trades
