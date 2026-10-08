"""Tagebuch im OneNote-Aufbau: Abschnitte (Monate) und Seitenbaum Monat -> KW -> Tag.

Eine KW gehoert zu dem Monat, in dem ihr Donnerstag liegt (ISO-Regel) - genau
so ist das OneNote-Tagebuch des Nutzers aufgebaut (KW 40/2026 mit 28.09.-02.10.
steht unter Oktober, KW 36 mit 31.08. unter September). Damit liegt jede KW in
genau einem Monat und kein Tag erscheint doppelt.

Ergebnisse werden je Tag in einem Durchlauf in $, Punkten und R gerechnet; R nur
aus Trades mit hinterlegtem Risiko (r_complete sagt, ob das fuer alle galt)."""
import json
from datetime import date, timedelta

from . import db

WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

# Kurzlabels fuer die Seitenliste (OneNote-Titel wie "02.10 - kein Trade - NFP").
# Erste passende Regel gewinnt; nur USD-High-Impact und Feiertage USA/UK, weil
# nur die in den Titeln des Nutzers auftauchen.
NEWS_SHORT = [
    ("adp", "ADP"), ("non-farm", "NFP"), ("cpi", "CPI"), ("ppi", "PPI"), ("fomc", "FOMC"),
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


# Abschnitte (Monate) der Sidebar: Grundbereich vom ersten Trade/Eintrag bis
# zum laufenden Monat, dazu im Voraus angelegte Monate ("+ Monat"/"+ Jahr")
# und abzueglich geloeschter. Beide Listen liegen als JSON in app_settings -
# geloeschte Monate muessen gemerkt werden, weil der Grundbereich sie sonst
# beim naechsten Laden wieder anzeigen wuerde (Trades bleiben ja erhalten).
DIARY_UNTIL_KEY = "diary_until"          # Altbestand: "+ Monat" bis Version ecc2e68
DIARY_EXTRA_KEY = "diary_months_extra"
DIARY_HIDDEN_KEY = "diary_months_hidden"


def _month_key(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"


def _next_month(key: str) -> str:
    y, m = int(key[:4]), int(key[5:7]) + 1
    return _month_key(y + 1, 1) if m > 12 else _month_key(y, m)


def _month_range(first: str, last: str) -> list[str]:
    out, k = [], first
    while k <= last:
        out.append(k)
        k = _next_month(k)
    return out


def _load_set(key: str) -> set[str]:
    try:
        return set(json.loads(db.get_app_setting(key) or "[]"))
    except (ValueError, TypeError):
        return set()


def _save_set(key: str, values: set[str]):
    db.set_app_setting(key, json.dumps(sorted(values)))


def _visible_months(totals: dict) -> list[str]:
    today = date.today()
    current = _month_key(today.year, today.month)
    keys = sorted(k for k in totals if k and len(k) == 7)
    first = min(keys[0], current) if keys else current
    base = set(_month_range(first, max([current] + keys[-1:])))
    extra = _load_set(DIARY_EXTRA_KEY)
    until = db.get_app_setting(DIARY_UNTIL_KEY)
    if until and until > current:
        extra |= set(_month_range(_next_month(current), until))
    return sorted((base | extra) - _load_set(DIARY_HIDDEN_KEY))


def _show(months: list[str]):
    extra = _load_set(DIARY_EXTRA_KEY) | set(months)
    hidden = _load_set(DIARY_HIDDEN_KEY) - set(months)
    _save_set(DIARY_EXTRA_KEY, extra)
    _save_set(DIARY_HIDDEN_KEY, hidden)


def add_month() -> str:
    """Haengt den Monat nach dem letzten angezeigten an und gibt ihn zurueck."""
    visible = _visible_months(db.diary_month_totals())
    new = _next_month(visible[-1])
    _show([new])
    return new


def add_year(year: int | None = None) -> int:
    """Legt alle zwoelf Monate eines Jahres an (ohne Angabe: das Jahr nach dem
    letzten angezeigten). KWs und Tage ergeben sich daraus von selbst."""
    if year is None:
        visible = _visible_months(db.diary_month_totals())
        year = int(visible[-1][:4]) + 1
    _show([_month_key(year, m) for m in range(1, 13)])
    return year


def _month_refs(month: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Tagesbereich und KW-/Monats-/Review-Schluessel, die zu einem Monat gehoeren."""
    weeks = _month_weeks(int(month[:4]), int(month[5:7]))
    start, end = weeks[0][2], weeks[-1][2] + timedelta(days=6)
    refs = [("week", f"{iy:04d}-W{iw:02d}") for iy, iw, _ in weeks] + [("month", month), ("review", month)]
    return str(start), str(end), refs


def delete_months(months: list[str], dry_run: bool = False) -> int:
    """Entfernt Monate aus dem Tagebuch samt ihren Journal-Eintraegen (Tage,
    KWs, Monatsziel, Review). Trades bleiben unangetastet - sie kommen ohnehin
    per Sync und sind unter Werkzeuge -> Trades weiter da. Liefert die Zahl der
    (zu) loeschenden Eintraege."""
    count = 0
    for month in months:
        start, end, refs = _month_refs(month)
        count += db.delete_journal_in(start, end, refs, dry_run=dry_run)
    if not dry_run:
        extra = _load_set(DIARY_EXTRA_KEY) - set(months)
        hidden = _load_set(DIARY_HIDDEN_KEY) | set(months)
        _save_set(DIARY_EXTRA_KEY, extra)
        _save_set(DIARY_HIDDEN_KEY, hidden)
    return count


def build_sections(account_keys=None, tag_keys=None, tag_logic="or", strategy_keys=None) -> dict:
    """Alle sichtbaren Monate mit Kennzahlen - auch Monate ohne Daten, damit
    die Abschnittsleiste wie in OneNote vollstaendig ist."""
    totals = db.diary_month_totals(account_keys, tag_keys, tag_logic, strategy_keys)
    today = date.today()
    months = []
    for key in _visible_months(totals):
        t = totals.get(key, {})
        r_sum = t.get("r_sum")
        months.append(dict(
            month=key, trades=t.get("trades", 0), net=round(t.get("net") or 0.0, 2),
            points=round(t.get("points") or 0.0, 2),
            r=round(r_sum, 2) if r_sum is not None and t.get("r_trades") else None,
            r_complete=bool(t.get("trades")) and t.get("r_trades") == t.get("trades"),
            entries=t.get("entries", 0),
        ))
    return {"months": months, "current": _month_key(today.year, today.month)}


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

