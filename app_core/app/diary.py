"""Tagebuch im OneNote-Aufbau: Abschnitte (Monate) und Seitenbaum Monat -> KW -> Tag.

Eine KW gehoert zu dem Monat, in dem ihr Donnerstag liegt (ISO-Regel) - genau
so ist das OneNote-Tagebuch des Nutzers aufgebaut (KW 40/2026 mit 28.09.-02.10.
steht unter Oktober, KW 36 mit 31.08. unter September). Damit liegt jede KW in
genau einem Monat und kein Tag erscheint doppelt.

Ergebnisse werden je Tag in einem Durchlauf in $, Punkten und R gerechnet; R nur
aus Trades mit hinterlegtem Risiko (r_complete sagt, ob das fuer alle galt)."""
from datetime import date, timedelta

from . import db

WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

# Kurzlabels fuer die Seitenliste (OneNote-Titel wie "02.10 - kein Trade - NFP").
# Erste passende Regel gewinnt; nur USD-High-Impact und Feiertage USA/UK, weil
# nur die in den Titeln des Nutzers auftauchen.
NEWS_SHORT = [
    ("non-farm", "NFP"), ("cpi", "CPI"), ("ppi", "PPI"), ("fomc", "FOMC"),
    ("federal funds", "Zins"), ("pce", "PCE"), ("gdp", "GDP"), ("retail sales", "Retail"),
    ("unemployment claims", "Claims"), ("ism", "ISM"), ("powell", "Powell"),
]
NEWS_CURRENCIES = {"USD"}
HOLIDAY_CURRENCIES = {"USD": "US", "GBP": "UK"}


def _news_label(ev: dict) -> str | None:
    if ev["impact"] == "Holiday":
        country = HOLIDAY_CURRENCIES.get(ev["currency"])
        return f"Feiertag {country}" if country and "holiday" in ev["title"].lower() else None
    if ev["currency"] not in NEWS_CURRENCIES:
        return None
    low = ev["title"].lower()
    for needle, label in NEWS_SHORT:
        if needle in low:
            return label
    return None


def _month_weeks(year: int, month: int) -> list[tuple[int, int, date]]:
    """(iso_year, iso_week, montag) aller KWs, deren Donnerstag im Monat liegt."""
    d = date(year, month, 1)
    while d.isoweekday() != 4:
        d += timedelta(days=1)
    weeks = []
    while d.month == month:
        iso_year, iso_week, _ = d.isocalendar()
        weeks.append((iso_year, iso_week, d - timedelta(days=3)))
        d += timedelta(days=7)
    return weeks


def _empty_stats() -> dict:
    return dict(trades=0, net=0.0, points=0.0, r=0.0, r_trades=0)


def _add(stats: dict, t: dict):
    stats["trades"] += 1
    stats["net"] += t["net_usd"] or 0.0
    stats["points"] += t["points"] or 0.0
    risk = t.get("risk_usd")
    if risk and risk > 0:
        stats["r"] += t["net_usd"] / risk
        stats["r_trades"] += 1


def _merge(target: dict, src: dict):
    for k in ("trades", "net", "points", "r", "r_trades"):
        target[k] += src[k]


def _final(stats: dict) -> dict:
    return dict(
        trades=stats["trades"], net=round(stats["net"], 2), points=round(stats["points"], 2),
        r=round(stats["r"], 2) if stats["r_trades"] else None,
        r_complete=stats["trades"] > 0 and stats["r_trades"] == stats["trades"],
    )


def build_sections(account_keys=None, tag_keys=None, tag_logic="or", strategy_keys=None) -> dict:
    """Alle Monate vom ersten Trade/Eintrag bis zum laufenden Monat - auch
    Monate ohne Daten, damit die Abschnittsleiste lueckenlos wie in OneNote ist."""
    totals = db.diary_month_totals(account_keys, tag_keys, tag_logic, strategy_keys)
    today = date.today()
    current = f"{today.year:04d}-{today.month:02d}"
    keys = sorted(k for k in totals if k and len(k) == 7)
    first = keys[0] if keys else current
    if first > current:
        first = current
    months = []
    y, m = int(first[:4]), int(first[5:7])
    while f"{y:04d}-{m:02d}" <= max(current, keys[-1] if keys else current):
        key = f"{y:04d}-{m:02d}"
        t = totals.get(key, {})
        r_sum = t.get("r_sum")
        months.append(dict(
            month=key, trades=t.get("trades", 0), net=round(t.get("net") or 0.0, 2),
            points=round(t.get("points") or 0.0, 2),
            r=round(r_sum, 2) if r_sum is not None and t.get("r_trades") else None,
            r_complete=bool(t.get("trades")) and t.get("r_trades") == t.get("trades"),
            entries=t.get("entries", 0),
        ))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return {"months": months, "current": current}


def build_month(year: int, month: int, account_keys=None, tag_keys=None, tag_logic="or",
                strategy_keys=None) -> dict:
    weeks = _month_weeks(year, month)
    start = weeks[0][2]
    end = weeks[-1][2] + timedelta(days=6)
    month_ref = f"{year:04d}-{month:02d}"
    week_refs = [f"{iy:04d}-W{iw:02d}" for iy, iw, _ in weeks]

    trades = db.get_trades_in_range(str(start), str(end), account_keys, tag_keys, tag_logic, strategy_keys)
    by_day: dict[str, dict] = {}
    for t in trades:
        _add(by_day.setdefault(t["day"], _empty_stats()), t)

    meta = db.journal_meta(str(start), str(end),
                           [("week", r) for r in week_refs] + [("month", month_ref), ("review", month_ref)])
    news: dict[str, list[dict]] = {}
    for ev in db.list_news_history(str(start), str(end)):
        label = _news_label(ev)
        if label:
            labels = news.setdefault(ev["day"], [])
            if not any(n["label"] == label for n in labels):
                labels.append(dict(label=label, title=ev["title"]))

    today = str(date.today())
    month_stats = _empty_stats()
    cum = _empty_stats()
    out_weeks = []
    for (iy, iw, monday), ref in zip(weeks, week_refs):
        week_stats = _empty_stats()
        days = []
        for i in range(7):
            d = monday + timedelta(days=i)
            key = str(d)
            st = by_day.get(key)
            entry = meta.get(("day", key))
            if i >= 5 and not st and not entry:
                continue  # Wochenende nur mit Inhalt
            if st:
                _merge(week_stats, st)
                _merge(cum, st)
            days.append(dict(
                date=key, weekday=WEEKDAYS[i], stats=_final(st or _empty_stats()),
                cum=_final(cum) if st else None,
                title=entry["title"] if entry else "", has_entry=bool(entry and entry["has_content"]),
                rating=entry["rating"] if entry else None,
                news=news.get(key, []), is_today=key == today, is_future=key > today,
            ))
        _merge(month_stats, week_stats)
        w_entry = meta.get(("week", ref))
        out_weeks.append(dict(
            ref=ref, iso_year=iy, iso_week=iw, monday=str(monday), sunday=str(monday + timedelta(days=6)),
            stats=_final(week_stats), title=w_entry["title"] if w_entry else "",
            has_entry=bool(w_entry and w_entry["has_content"]), days=days,
            is_current=str(monday) <= today <= str(monday + timedelta(days=6)),
        ))

    def page(kind):
        e = meta.get((kind, month_ref))
        return dict(ref=month_ref, title=e["title"] if e else "", has_entry=bool(e and e["has_content"]))

    return dict(
        month=month_ref, start=str(start), end=str(end), stats=_final(month_stats),
        month_page=page("month"), review_page=page("review"), weeks=out_weeks,
    )

