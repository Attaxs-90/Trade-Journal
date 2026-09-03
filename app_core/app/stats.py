import calendar
from collections import defaultdict
from datetime import date, timedelta, datetime as dt

from . import db

WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def _group_by_day(trades: list[dict]) -> dict[str, list[dict]]:
    grouped = defaultdict(list)
    for t in trades:
        grouped[t["day"]].append(t)
    return grouped


def day_stats(trades: list[dict]) -> dict:
    """Alle Tageskennzahlen in einem einzigen Durchlauf. Trades kommen nach
    entry_time sortiert herein (siehe db.get_day_trades), was der Gap-Berechnung
    zwischen aufeinanderfolgenden Trades zugrunde liegt. Jeder Zeitstempel wird
    genau einmal geparst - fromisoformat() lief vorher zweimal je Trade, in
    getrennten Schleifen fuer Dauer und Gap."""
    cum = peak = max_dd = lowest = highest = 0.0
    total_points = total_net = duration_sum = 0.0
    # None statt 0.0: bei ueberlappenden Trades ist der Abstand negativ, und
    # der groesste Abstand darf dann auch negativ bleiben statt auf 0 zu springen.
    max_gap = None
    long_count = short_count = 0
    price_low = price_high = None
    prev_exit = None
    series = []

    for t in trades:
        cum += t["net_usd"]
        series.append(round(cum, 2))
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd
        if cum < lowest:
            lowest = cum
        if cum > highest:
            highest = cum

        total_points += t["points"]
        total_net += t["net_usd"]
        if t["direction"] == "Long":
            long_count += 1
        elif t["direction"] == "Short":
            short_count += 1

        entry = dt.fromisoformat(t["entry_time"])
        exit_ = dt.fromisoformat(t["exit_time"])
        duration_sum += (exit_ - entry).total_seconds()
        if prev_exit is not None:
            gap = (entry - prev_exit).total_seconds()
            if max_gap is None or gap > max_gap:
                max_gap = gap
        prev_exit = exit_

        for price in (t["entry_price"], t["exit_price"]):
            if price_low is None or price < price_low:
                price_low = price
            if price_high is None or price > price_high:
                price_high = price

    n = len(trades)
    return dict(
        cumulative_series=series,
        total_points=round(total_points, 2),
        total_net=round(total_net, 2),
        trade_count=n,
        lowest_cum=round(lowest, 2),
        highest_cum=round(highest, 2),
        max_drawdown=round(max_dd, 2),
        avg_duration_sec=round(duration_sum / n, 1) if n else 0,
        max_gap_sec=round(max_gap, 1) if max_gap is not None else 0,
        long_count=long_count,
        short_count=short_count,
        price_low=price_low if price_low is not None else 0,
        price_high=price_high if price_high is not None else 0,
    )


def compute_start_balance(account_keys: list[str] | None) -> float:
    """Startkapital fuer eine Konten-Auswahl: bevorzugt der zuletzt von MT5
    gemeldete Kontostand (synced_balance), zurueckgerechnet um die Netto-Summe
    der Trades, damit Kurve/Kontostand deckungsgleich mit dem echten Broker-
    Konto bleiben. Nur ohne Sync zaehlt das manuell eingetragene starting_balance.
    Gemeinsam genutzt von der Uebersicht und den Auswertungen (kein Duplikat)."""
    with db.get_conn():  # beide Abfragen ueber eine Verbindung
        all_accounts = db.list_accounts()
        net_totals = db.account_net_totals()
    if account_keys is None:
        included = all_accounts
    else:
        account_ids = {k for k in account_keys if k != "csv"}
        included = [a for a in all_accounts if str(a["id"]) in account_ids]
    start_balance = 0.0
    for a in included:
        if a["synced_balance"] is not None:
            start_balance += a["synced_balance"] - (net_totals.get(a["id"]) or 0)
        else:
            start_balance += a["starting_balance"] or 0
    return start_balance


def _fmt_num(n: float) -> str:
    s = f"{n:,.2f}"
    s = s.replace(",", "_").replace(".", ",").replace("_", ".")
    return s


def build_week_payload(iso_year: int, iso_week: int, account_keys: list[str] | None = None, tag_keys: list[str] | None = None, tag_logic: str = "or") -> dict:
    monday = date.fromisocalendar(iso_year, iso_week, 1)
    sunday = date.fromisocalendar(iso_year, iso_week, 7)
    all_days = [monday + timedelta(days=i) for i in range(7)]

    trades_by_day = _group_by_day(db.get_trades_in_range(str(monday), str(sunday), account_keys, tag_keys, tag_logic))

    day_rows = []
    for d, wd in zip(all_days, WEEKDAY_NAMES):
        trades = trades_by_day.get(str(d), [])
        if trades:
            st = day_stats(trades)
            day_rows.append(dict(
                date=d, weekday=wd, points=st["total_points"], net=st["total_net"],
                trades=st["trade_count"], lowest_cum=st["lowest_cum"],
            ))
        else:
            day_rows.append(dict(date=d, weekday=wd, points=0.0, net=0.0, trades=0, lowest_cum=0.0))

    months = sorted(set(d["date"].month for d in day_rows))
    blocks = []
    for m in months:
        block_days = [d for d in day_rows if d["date"].month == m]
        if any(d["trades"] for d in block_days):
            blocks.append(block_days)

    text_lines = []
    block_summaries = []
    for block in blocks:
        traded_days = [d for d in block if d["trades"] > 0]
        text_lines.append(f"KW {iso_week}")
        for d in block:
            text_lines.append(f"  {d['weekday']}: {_fmt_num(d['points'])} Pkt / {d['trades']} Trades / {_fmt_num(d['net'])} $")

        week_points = round(sum(d["points"] for d in traded_days), 2)
        week_net = round(sum(d["net"] for d in traded_days), 2)
        week_trades = sum(d["trades"] for d in traded_days)
        best = max(traded_days, key=lambda d: d["net"])
        worst = min(traded_days, key=lambda d: d["net"])
        lowest = min(traded_days, key=lambda d: d["lowest_cum"])

        text_lines.append(f"  Woche: {_fmt_num(week_points)} Pkt / {week_trades} Trades / {_fmt_num(week_net)} $ netto")
        text_lines.append(f"  Bester Tag: {best['weekday']} | Schwaechster Tag: {worst['weekday']}")
        text_lines.append(f"  Tiefstes Tagestief der Woche: {_fmt_num(lowest['lowest_cum'])} $ ({lowest['weekday']})")
        text_lines.append("")

        block_summaries.append(dict(
            month=block[0]["date"].month,
            week_points=week_points, week_net=week_net, week_trades=week_trades,
            best_day=best["weekday"], worst_day=worst["weekday"],
            lowest_day_low=lowest["lowest_cum"], lowest_day=lowest["weekday"],
        ))

    return dict(
        iso_year=iso_year,
        iso_week=iso_week,
        monday=str(monday),
        sunday=str(sunday),
        days=[dict(date=str(d["date"]), weekday=d["weekday"], points=d["points"],
                    net=d["net"], trades=d["trades"]) for d in day_rows],
        blocks=block_summaries,
        text_block="\n".join(text_lines).strip(),
    )


def build_month_payload(year: int, month: int, account_keys: list[str] | None = None, tag_keys: list[str] | None = None, tag_logic: str = "or") -> dict:
    days_in_month = calendar.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, days_in_month)
    trades_by_day = _group_by_day(db.get_trades_in_range(str(start), str(end), account_keys, tag_keys, tag_logic))

    # Journal-Marker und Bild-Tage fuer den ganzen Monat in je einer Query,
    # nicht je Tag.
    journal = db.journal_map("day", str(start), str(end))
    image_days = db.days_with_images(str(start), str(end))

    day_rows = []
    for day_num in range(1, days_in_month + 1):
        d = date(year, month, day_num)
        trades = trades_by_day.get(str(d), [])
        if trades:
            st = day_stats(trades)
            row = dict(date=str(d), points=st["total_points"], net=st["total_net"], trades=st["trade_count"])
        else:
            row = dict(date=str(d), points=0.0, net=0.0, trades=0)
        entry = journal.get(str(d))
        row["has_journal"] = entry is not None
        row["journal_rating"] = entry["rating"] if entry else None
        row["has_image"] = str(d) in image_days
        day_rows.append(row)

    traded = [d for d in day_rows if d["trades"] > 0]
    return dict(
        year=year,
        month=month,
        days_in_month=days_in_month,
        first_weekday=date(year, month, 1).isoweekday(),  # 1=Mo .. 7=So
        days=day_rows,
        total_net=round(sum(d["net"] for d in traded), 2),
        total_points=round(sum(d["points"] for d in traded), 2),
        total_trades=sum(d["trades"] for d in traded),
        trading_days=len(traded),
    )
