"""Modulare Auswertungslogik fuer die "Auswertungen"-Seite.

Kernidee: eine einzige generische Gruppierung (breakdown()) bedient beliebig
viele Dimension x Metrik-Kombinationen, statt fuer jede Auswertung einen
eigenen Endpoint/eine eigene Query zu bauen. Jede Dimension liefert pro Trade
einen oder mehrere Bucket-Schluessel (Tags: ein Trade kann zu mehreren
gehoeren); jede Kennzahl wird aus derselben trade_summary()-Berechnung
gelesen, die auch die Kern-KPI-Kachel speist - eine Berechnung, mehrfach
verwendet, statt Duplikate je Auswertung.
"""

from datetime import date, datetime as dt

from . import db

WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

DURATION_BUCKETS = [
    (0, 5, "< 5 Min"),
    (5, 15, "5-15 Min"),
    (15, 30, "15-30 Min"),
    (30, 60, "30-60 Min"),
    (60, 120, "1-2 Std"),
    (120, 240, "2-4 Std"),
    (240, None, "> 4 Std"),
]

VOLUME_BUCKETS = [
    (0, 1, "< 1"),
    (1, 2, "1-2"),
    (2, 3, "2-3"),
    (3, 5, "3-5"),
    (5, 10, "5-10"),
    (10, None, "10+"),
]


def _duration_minutes(t: dict) -> float:
    e = dt.fromisoformat(t["entry_time"])
    x = dt.fromisoformat(t["exit_time"])
    return (x - e).total_seconds() / 60


def _bucket_weekday(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    idx = date.fromisoformat(t["day"]).weekday()
    return [(str(idx), WEEKDAY_LABELS[idx], idx)]


def _bucket_hour(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    h = dt.fromisoformat(t["entry_time"]).hour
    return [(f"{h:02d}", f"{h:02d}:00", h)]


def _bucket_month(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    m = t["day"][:7]
    return [(m, m, m)]


def _bucket_instrument(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    i = t["instrument"]
    return [(i, i, i)]


def _bucket_direction(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    d = t["direction"]
    return [(d, d, 0 if d == "Long" else 1)]


def _bucket_account(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    aid = t.get("account_id")
    if aid is None:
        return [("csv", "Nicht zugeordnet", 9999)]
    name = ctx["accounts"].get(aid, f"Konto {aid}")
    return [(str(aid), name, aid)]


def _bucket_tag(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    tags = t.get("tags") or []
    if not tags:
        return [("none", "Ohne Tag", 9999)]
    return [(str(tag["id"]), tag["name"], tag["id"]) for tag in tags]


def _bucket_duration(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    minutes = _duration_minutes(t)
    for i, (lo, hi, label) in enumerate(DURATION_BUCKETS):
        if minutes >= lo and (hi is None or minutes < hi):
            return [(str(i), label, i)]
    last = len(DURATION_BUCKETS) - 1
    return [(str(last), DURATION_BUCKETS[-1][2], last)]


def _bucket_volume(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    v = t.get("volume")
    if v is None:
        return [("none", "Ohne Angabe", 9999)]
    for i, (lo, hi, label) in enumerate(VOLUME_BUCKETS):
        if v >= lo and (hi is None or v < hi):
            return [(str(i), label, i)]
    last = len(VOLUME_BUCKETS) - 1
    return [(str(last), VOLUME_BUCKETS[-1][2], last)]


def _bucket_rating(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    j = ctx["journal"].get(t["day"])
    r = j["rating"] if j else None
    if r is None:
        return [("none", "Kein Eintrag", 9999)]
    return [(str(r), f"{r} / 5", r)]


def _bucket_mood(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    j = ctx["journal"].get(t["day"])
    m = j["mood"] if j else None
    if m is None:
        return [("none", "Kein Eintrag", 9999)]
    return [(str(m), f"{m} / 5", m)]


def _bucket_followed_plan(t: dict, ctx: dict) -> list[tuple[str, str, object]]:
    j = ctx["journal"].get(t["day"])
    fp = j["followed_plan"] if j else None
    if fp is None:
        return [("none", "Kein Eintrag", 9999)]
    return [("yes", "Ja", 0)] if fp else [("no", "Nein", 1)]


# sort: "sort_key" ordnet nach dem dritten Tupel-Element (natuerliche Ordnung,
# z.B. Wochentag/Uhrzeit/Bewertung), "net_desc" nach bestem Netto-Ergebnis
# zuerst (z.B. Instrument/Konto/Tag, wo es keine natuerliche Reihenfolge gibt).
DIMENSIONS: dict[str, dict] = {
    "weekday": {"label": "Wochentag", "bucket": _bucket_weekday, "sort": "sort_key"},
    "hour": {"label": "Uhrzeit (Entry)", "bucket": _bucket_hour, "sort": "sort_key"},
    "month": {"label": "Monat", "bucket": _bucket_month, "sort": "sort_key"},
    "instrument": {"label": "Instrument", "bucket": _bucket_instrument, "sort": "net_desc"},
    "direction": {"label": "Richtung (Long/Short)", "bucket": _bucket_direction, "sort": "sort_key"},
    "account": {"label": "Konto", "bucket": _bucket_account, "sort": "net_desc"},
    "tag": {"label": "Tag", "bucket": _bucket_tag, "sort": "net_desc"},
    "duration": {"label": "Haltedauer", "bucket": _bucket_duration, "sort": "sort_key"},
    "volume": {"label": "Positionsgroesse", "bucket": _bucket_volume, "sort": "sort_key"},
    "rating": {"label": "Tagesbewertung", "bucket": _bucket_rating, "sort": "sort_key"},
    "mood": {"label": "Verfassung", "bucket": _bucket_mood, "sort": "sort_key"},
    "followed_plan": {"label": "Plan befolgt", "bucket": _bucket_followed_plan, "sort": "sort_key"},
}

# Kennzeichnet Dimensionen, die Journal-Tagesdaten brauchen - baut build_context()
# den Journal-Anteil nur dann, wenn eine Auswertung ihn tatsaechlich benutzt.
JOURNAL_DIMENSIONS = {"rating", "mood", "followed_plan"}


def build_context(trades: list[dict]) -> dict:
    """Gemeinsamer Kontext fuer breakdown(): Konto-Namen + Journal-Tagesdaten,
    je einmal geladen statt pro Dimension/Trade neu."""
    with db.get_conn():  # beide Abfragen ueber eine Verbindung
        accounts = {a["id"]: a["name"] for a in db.list_accounts()}
        if not trades:
            return {"accounts": accounts, "journal": {}}
        days = [t["day"] for t in trades]
        journal = db.journal_day_details(min(days), max(days))
        return {"accounts": accounts, "journal": journal}


def trade_summary(trades: list[dict]) -> dict:
    """Kern-Kennzahlen einer Trade-Menge - Basis sowohl der KPI-Kachel-Auswertung
    als auch jeder Zeile eines breakdown()-Ergebnisses."""
    n = len(trades)
    if not n:
        return dict(
            trade_count=0, total_net=0.0, total_points=0.0, win_rate=0.0,
            profit_factor=None, avg_win=0.0, avg_loss=0.0, expectancy=0.0,
            best_trade=0.0, worst_trade=0.0, gross_profit=0.0, gross_loss=0.0,
            avg_duration_sec=0.0, long_count=0, short_count=0,
        )
    nets = [t["net_usd"] for t in trades]
    wins = [v for v in nets if v > 0]
    losses = [v for v in nets if v < 0]
    total_net = sum(nets)
    gross_profit = sum(wins)
    gross_loss = -sum(losses)
    profit_factor = (gross_profit / gross_loss) if gross_loss else None
    durations = [_duration_minutes(t) * 60 for t in trades]
    return dict(
        trade_count=n,
        total_net=round(total_net, 2),
        total_points=round(sum(t["points"] for t in trades), 2),
        win_rate=round(100 * len(wins) / n, 1),
        profit_factor=round(profit_factor, 2) if profit_factor is not None else None,
        avg_win=round(gross_profit / len(wins), 2) if wins else 0.0,
        avg_loss=round(gross_loss / len(losses), 2) if losses else 0.0,
        expectancy=round(total_net / n, 2),
        best_trade=round(max(nets), 2),
        worst_trade=round(min(nets), 2),
        gross_profit=round(gross_profit, 2),
        gross_loss=round(gross_loss, 2),
        avg_duration_sec=round(sum(durations) / n, 1),
        long_count=sum(1 for t in trades if t["direction"] == "Long"),
        short_count=sum(1 for t in trades if t["direction"] == "Short"),
    )


def breakdown(trades: list[dict], dimension: str, ctx: dict) -> list[dict]:
    """Gruppiert trades nach einer Dimension und haengt an jede Gruppe ihre
    trade_summary() an. Ein Trade kann in mehrere Buckets fallen (Tags)."""
    spec = DIMENSIONS[dimension]
    bucket_fn = spec["bucket"]
    buckets: dict[str, dict] = {}
    order: dict[str, object] = {}
    for t in trades:
        for key, label, sort_key in bucket_fn(t, ctx):
            b = buckets.setdefault(key, {"label": label, "trades": []})
            b["trades"].append(t)
            order[key] = sort_key
    rows = []
    for key, b in buckets.items():
        rows.append({"key": key, "label": b["label"], "_sort": order[key], **trade_summary(b["trades"])})
    if spec["sort"] == "sort_key":
        rows.sort(key=lambda r: r["_sort"])
    else:
        rows.sort(key=lambda r: r["total_net"], reverse=True)
    for r in rows:
        del r["_sort"]
    return rows


def pnl_distribution(trades: list[dict], bins: int = 10) -> dict:
    """Histogramm der Netto-Ergebnisse je Trade - macht sichtbar, ob Gewinne/
    Verluste eher gleichmaessig oder von wenigen Ausreissern getragen sind."""
    nets = [t["net_usd"] for t in trades]
    if not nets:
        return {"bins": [], "avg_win": 0.0, "avg_loss": 0.0, "largest_win": 0.0, "largest_loss": 0.0, "trade_count": 0}
    lo, hi = min(nets), max(nets)
    if lo == hi:
        lo, hi = lo - 1, hi + 1
    width = (hi - lo) / bins
    counts = [0] * bins
    for v in nets:
        idx = min(bins - 1, int((v - lo) / width))
        counts[idx] += 1
    bucket_rows = []
    for i in range(bins):
        b_lo = lo + i * width
        b_hi = b_lo + width
        bucket_rows.append({
            "label": f"{b_lo:,.0f} … {b_hi:,.0f}".replace(",", "."),
            "range_lo": round(b_lo, 2), "range_hi": round(b_hi, 2), "count": counts[i],
        })
    wins = [v for v in nets if v > 0]
    losses = [v for v in nets if v < 0]
    return {
        "bins": bucket_rows,
        "trade_count": len(nets),
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "largest_win": round(max(nets), 2),
        "largest_loss": round(min(nets), 2),
    }


def equity_and_drawdown(days: list[dict], start_balance: float) -> dict:
    """Kumulierte Equity-Kurve, Drawdown-Verlauf, maximaler Drawdown sowie
    Gewinn-/Verlust-Serien (Streaks) auf Tagesbasis - days wie von
    db.list_days() geliefert (bereits nach Konten-/Tag-Filter eingeschraenkt)."""
    days_sorted = sorted(days, key=lambda d: d["day"])
    cum = start_balance
    peak = start_balance
    max_dd = 0.0
    max_dd_day = None
    curve, drawdown_series = [], []
    win_days = loss_days = 0
    cur_streak = 0
    cur_streak_type = None
    longest_win_streak = longest_loss_streak = 0

    for d in days_sorted:
        cum += d["net_usd"]
        if cum > peak:
            peak = cum
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd
            max_dd_day = d["day"]
        curve.append({"day": d["day"], "cum_net": round(cum, 2)})
        drawdown_series.append({"day": d["day"], "drawdown": round(-dd, 2)})

        if d["net_usd"] > 0:
            cur_streak = cur_streak + 1 if cur_streak_type == "win" else 1
            cur_streak_type = "win"
            win_days += 1
            longest_win_streak = max(longest_win_streak, cur_streak)
        elif d["net_usd"] < 0:
            cur_streak = cur_streak + 1 if cur_streak_type == "loss" else 1
            cur_streak_type = "loss"
            loss_days += 1
            longest_loss_streak = max(longest_loss_streak, cur_streak)
        else:
            cur_streak, cur_streak_type = 0, None

    trading_days = len(days_sorted)
    return dict(
        curve=curve,
        drawdown_series=drawdown_series,
        max_drawdown=round(max_dd, 2),
        max_drawdown_day=max_dd_day,
        trading_days=trading_days,
        win_days=win_days,
        loss_days=loss_days,
        win_days_pct=round(100 * win_days / trading_days, 1) if trading_days else 0.0,
        longest_win_streak=longest_win_streak,
        longest_loss_streak=longest_loss_streak,
        current_streak=cur_streak,
        current_streak_type=cur_streak_type,
        start_balance=round(start_balance, 2),
        end_balance=round(cum, 2),
    )
