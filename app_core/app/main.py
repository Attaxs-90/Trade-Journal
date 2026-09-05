from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from . import db, news
from .brokers import sync_account, ERRORS as BROKER_ERRORS, ALL_PLATFORMS, MANUAL_PLATFORMS
from .config import IMAGES_DIR
from .images import save_image, delete_image_files
from .parser import parse_csv, pair_trades
from .stats import day_stats, build_week_payload, build_month_payload, compute_start_balance
from . import analytics as an

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Trade Journal")
db.init_db()


# HTML/CSS/JS aendern sich bei jedem Update, haben aber keine versionierte
# URL (bewusst kein Build-Schritt, siehe CLAUDE.md) - ohne Cache-Control
# entscheidet der Browser per Heuristik selbst, wie lange er sie ungefragt
# aus dem Cache statt vom Server serviert, und ein einfaches Neuladen zeigt
# dann trotz geaenderter Datei auf der Platte noch den alten Stand (wiederholt
# in dieser Session aufgetreten, u.a. beim Lightbox-Fix). no-cache erzwingt
# eine Revalidierung (If-Modified-Since) bei jedem Laden - der Server
# antwortet bei unveraendertem Inhalt weiterhin schnell mit 304, es wird also
# nicht bei jedem Laden neu heruntergeladen, nur immer geprueft. Bilder unter
# /media sind davon bewusst ausgenommen (Dateiname enthaelt bereits eine neue
# UUID pro Upload, aggressives Caching ist dort unproblematisch).
class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith("/media"):
            response.headers["Cache-Control"] = "no-cache"
        return response


app.add_middleware(NoCacheStaticMiddleware)

MAX_CSV_BYTES = 25 * 1024 * 1024   # 25 MB - grosszuegig fuer Tages-/Wochenexporte
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB - deckt auch hochaufgeloeste Screenshots ab


def _parse_keys(raw: str | None) -> list[str] | None:
    """Zerlegt einen kommaseparierten Filter-Parameter (?accounts=2,5,csv,
    ?tags=1,4, ?strategies=3,none) in seine Schluessel. None/leer = keine
    Einschraenkung. Alle drei Filter teilen sich dieselbe Zerlegung - die
    Bedeutung der Schluessel unterscheiden erst db._account_filter(),
    db._tag_filter() und db._strategy_filter()."""
    if not raw:
        return None
    keys = [k for k in raw.split(",") if k]
    return keys or None


def _check_day(day: str) -> str:
    """Validiert einen Tages-Parameter als ISO-Datum. Ohne das landen ueber die
    URL beliebige Zeichenketten als images.day/journal ref_key in der Datenbank
    und tauchen danach in keiner Kalender- oder Tagesansicht mehr auf."""
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Datum muss im Format JJJJ-MM-TT vorliegen.")
    return day


async def _read_upload(file: UploadFile, max_bytes: int) -> bytes:
    """Liest einen Upload mit harter Groessengrenze, statt beliebig grosse
    Dateien komplett in den Speicher zu laden."""
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(413, f"Datei zu gross (Limit: {max_bytes // (1024 * 1024)} MB).")
    return raw


class NotesUpdate(BaseModel):
    notes: str


class RiskUpdate(BaseModel):
    risk_usd: float | None = None


class AccountCreate(BaseModel):
    name: str
    platform: str  # "mt5" (Auto-Sync) oder eine manuelle Plattform wie "ninjatrader"
    login: str = ""
    password: str = ""
    server: str = ""
    starting_balance: float = 0


class StartingBalanceUpdate(BaseModel):
    starting_balance: float


class AccountRename(BaseModel):
    name: str


class ReassignTrades(BaseModel):
    account_id: int
    source: str | None = None  # z.B. "ninjatrader" - None = alle nicht zugeordneten Trades


class TagCreate(BaseModel):
    name: str
    # Die Farbe wird im Frontend direkt in ein style="background:..."-Attribut
    # geschrieben. Ohne feste Form koennte hier beliebiger Text stehen und aus
    # dem Attribut ausbrechen - deshalb nur echte Hex-Farben zulassen (der
    # Farbwaehler der Tag-Verwaltung liefert ohnehin genau dieses Format).
    color: str = Field(pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
    tag_group: str = ""


class TradeTagsUpdate(BaseModel):
    tag_ids: list[int]


class BulkTagAssign(BaseModel):
    trade_ids: list[int]
    tag_id: int


class JournalEntryUpdate(BaseModel):
    title: str = ""
    content_html: str = ""
    plain_text: str = ""      # Textfassung von content_html, nur fuer die Volltextsuche
    rating: int | None = None
    mood: int | None = None
    followed_plan: int | None = None
    tag_ids: list[int] = []


class JournalBulkDelete(BaseModel):
    ref_keys: list[str]


class JournalTemplateUpdate(BaseModel):
    name: str
    content_html: str = ""
    position: int = 0


class NotebookNodeCreate(BaseModel):
    parent_id: int | None = None
    node_type: str  # "folder" oder "note"
    name: str


class NotebookNodeUpdate(BaseModel):
    name: str | None = None
    content_html: str | None = None
    plain_text: str | None = None


class NotebookNodeMove(BaseModel):
    parent_id: int | None = None


class TodoListCreate(BaseModel):
    name: str


class TodoListUpdate(BaseModel):
    name: str | None = None
    visible: bool | None = None


class TodoItemCreate(BaseModel):
    text: str


class TodoItemUpdate(BaseModel):
    text: str | None = None
    done: bool | None = None


class StrategyCreate(BaseModel):
    name: str


class StrategyUpdate(BaseModel):
    name: str | None = None
    archived: bool | None = None
    is_default: bool | None = None


class OrderUpdate(BaseModel):
    order: list[int]


class RuleGroupCreate(BaseModel):
    name: str


class RuleCreate(BaseModel):
    text: str
    group_id: int | None = None


class RuleUpdate(BaseModel):
    text: str | None = None
    group_id: int | None = None
    clear_group: bool = False   # None allein hiesse "nicht aendern", siehe db.update_rule
    archived: bool | None = None


class RuleReplace(BaseModel):
    text: str


class TradeStrategyUpdate(BaseModel):
    strategy_id: int | None = None


class TradeRuleStatusUpdate(BaseModel):
    rule_id: int
    followed: bool | None = None   # None = Bewertung zuruecknehmen (unbeantwortet)


class BulkStrategyAssign(BaseModel):
    trade_ids: list[int]
    strategy_id: int | None = None


class BulkRuleStatus(BaseModel):
    trade_ids: list[int]
    rule_id: int
    followed: bool | None = None


@app.post("/api/import")
async def import_csv(file: UploadFile = File(...), account_id: int | None = Form(None)):
    raw = await _read_upload(file, MAX_CSV_BYTES)
    content = raw.decode("utf-8-sig", errors="replace")
    try:
        fills = parse_csv(content)
        trades = pair_trades(fills)
    except Exception as e:
        raise HTTPException(400, f"Fehler beim Parsen der CSV: {e}")
    if not trades:
        raise HTTPException(400, "Keine gepaarten Trades in der CSV gefunden.")
    if account_id is not None and not db.get_account(account_id):
        raise HTTPException(400, "Ausgewaehltes Konto existiert nicht.")
    inserted = db.insert_trades(trades, account_id=account_id)
    days_touched = sorted(set(t["day"] for t in trades))
    return {"parsed": len(trades), "inserted": inserted, "skipped": len(trades) - inserted, "days": days_touched}


@app.get("/api/days")
def api_list_days(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                   strategies: str | None = None):
    return db.list_days(_parse_keys(accounts), _parse_keys(tags), tag_logic, _parse_keys(strategies))


@app.get("/api/trades")
def api_list_trades(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                     page: int = 1, page_size: int = 50, sort: str = "day", dir: str = "desc",
                     strategies: str | None = None):
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    trades, total = db.list_trades(
        _parse_keys(accounts), _parse_keys(tags), tag_logic,
        offset=(page - 1) * page_size, limit=page_size, sort=sort, direction=dir,
        strategy_keys=_parse_keys(strategies),
    )
    return {"trades": trades, "total": total, "page": page, "page_size": page_size}


@app.get("/api/days/{day}")
def api_day_detail(day: str, accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                    strategies: str | None = None):
    trades = db.get_day_trades(day, _parse_keys(accounts), _parse_keys(tags), tag_logic,
                               _parse_keys(strategies))
    images = db.get_images_for_day(day)
    # Auch ohne Trades erreichbar, wenn es an dem Tag ein Bild oder einen
    # Journal-Eintrag gibt (z.B. ueber den Quill-Editor eingebettetes Bild an
    # einem Tag ohne Handel) - sonst liesse sich das von nirgendwo oeffnen.
    if not trades and not images and not db.get_journal_entry("day", day):
        raise HTTPException(404, "Kein Tag mit Trades, Bildern oder Journal-Eintrag gefunden.")
    stats = day_stats(trades)
    return {"trades": trades, "stats": stats, "images": images}


@app.put("/api/trades/{trade_id}/notes")
def api_update_trade_notes(trade_id: int, payload: NotesUpdate):
    db.update_trade_notes(trade_id, payload.notes)
    return {"ok": True}


@app.put("/api/trades/{trade_id}/risk")
def api_update_trade_risk(trade_id: int, payload: RiskUpdate):
    if not db.get_trade(trade_id):
        raise HTTPException(404, "Trade nicht gefunden.")
    db.update_trade_risk(trade_id, payload.risk_usd)
    return {"ok": True}


@app.delete("/api/trades/{trade_id}")
def api_delete_trade(trade_id: int):
    if not db.get_trade(trade_id):
        raise HTTPException(404, "Trade nicht gefunden.")
    for image in db.delete_trade(trade_id):
        delete_image_files(image["filename"], image["thumb_filename"])
    return {"ok": True}


@app.get("/api/trades/{trade_id}")
def api_get_trade(trade_id: int):
    trade = db.get_trade(trade_id)
    if not trade:
        raise HTTPException(404, "Trade nicht gefunden.")
    return trade


@app.get("/api/trades/{trade_id}/images")
def api_trade_images(trade_id: int):
    return db.get_images_for_trade(trade_id)


@app.get("/api/trades/{trade_id}/neighbor")
def api_trade_neighbor(trade_id: int, to: str = "next", accounts: str | None = None,
                        tags: str | None = None, tag_logic: str = "or",
                        sort: str = "day", dir: str = "desc", strategies: str | None = None):
    if to not in ("next", "prev"):
        raise HTTPException(400, "to muss 'next' oder 'prev' sein.")
    neighbor_id = db.adjacent_trade_id(
        trade_id, to, _parse_keys(accounts), _parse_keys(tags), tag_logic, sort, dir,
        _parse_keys(strategies)
    )
    return {"id": neighbor_id}


@app.get("/api/overview")
def api_overview(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                  strategies: str | None = None):
    keys = _parse_keys(accounts)
    strategy_keys = _parse_keys(strategies)
    days = db.list_days(keys, _parse_keys(tags), tag_logic, strategy_keys)

    # Startkapital: bei einer Konto-Auswahl nur deren Startkapital summieren
    # (der Magic-Key "csv" fuer nicht zugeordnete Trades hat keins), sonst
    # alle verbundenen Konten - die Kurve/der Kontostand sollen dann bei
    # diesem Basiswert starten statt bei 0.
    start_balance = compute_start_balance(keys)

    # equity_and_drawdown() sortiert die Tage und baut daraus bereits die
    # kumulierte Kurve - die wird hier uebernommen statt ein zweites Mal
    # aufgebaut. Alles Uebrige (Summen, bester/schwaechster Tag) faellt in
    # einem einzigen Durchlauf ueber dieselbe Liste mit ab.
    equity = an.equity_and_drawdown(days, start_balance)
    total_net = 0.0
    total_trades = 0
    best_day = worst_day = None
    for d in days:
        total_net += d["net_usd"]
        total_trades += d["trade_count"]
        if best_day is None or d["net_usd"] > best_day["net_usd"]:
            best_day = d
        if worst_day is None or d["net_usd"] < worst_day["net_usd"]:
            worst_day = d
    total_net = round(total_net, 2)

    trades = db.list_trades_for_analytics(keys, _parse_keys(tags), tag_logic,
                                          strategy_keys=strategy_keys)
    summary = an.trade_summary(trades)
    win_loss_ratio = round(summary["avg_win"] / summary["avg_loss"], 2) if summary["avg_loss"] else None
    return {
        "days": days,
        "curve": equity["curve"],
        "total_net": total_net,
        "total_trades": total_trades,
        "trading_days": len(days),
        "best_day": best_day,
        "worst_day": worst_day,
        "win_rate": summary["win_rate"],
        "profit_factor": summary["profit_factor"],
        "win_days_pct": equity["win_days_pct"],
        "win_loss_ratio": win_loss_ratio,
        "avg_win": summary["avg_win"],
        "avg_loss": summary["avg_loss"],
        "expectancy": summary["expectancy"],
        "start_balance": round(start_balance, 2),
        "current_balance": round(start_balance + total_net, 2),
    }


@app.get("/api/analytics/dimensions")
def api_analytics_dimensions():
    return [{"key": k, "label": v["label"]} for k, v in an.DIMENSIONS.items()]


@app.get("/api/analytics/summary")
def api_analytics_summary(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                           start: str | None = None, end: str | None = None,
                           strategies: str | None = None):
    trades = db.list_trades_for_analytics(_parse_keys(accounts), _parse_keys(tags), tag_logic, start, end,
                                          _parse_keys(strategies))
    return an.trade_summary(trades)


@app.get("/api/analytics/equity")
def api_analytics_equity(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                          start: str | None = None, end: str | None = None,
                          strategies: str | None = None):
    keys = _parse_keys(accounts)
    days = db.list_days(keys, _parse_keys(tags), tag_logic, _parse_keys(strategies))
    if start:
        days = [d for d in days if d["day"] >= start]
    if end:
        days = [d for d in days if d["day"] <= end]
    return an.equity_and_drawdown(days, compute_start_balance(keys))


@app.get("/api/analytics/breakdown")
def api_analytics_breakdown(dimension: str, accounts: str | None = None, tags: str | None = None,
                             tag_logic: str = "or", start: str | None = None, end: str | None = None,
                             strategies: str | None = None):
    if dimension not in an.DIMENSIONS:
        raise HTTPException(400, f"Unbekannte Dimension '{dimension}'.")
    trades = db.list_trades_for_analytics(_parse_keys(accounts), _parse_keys(tags), tag_logic, start, end,
                                          _parse_keys(strategies))
    ctx = an.build_context(trades)
    return {"dimension": dimension, "label": an.DIMENSIONS[dimension]["label"], "rows": an.breakdown(trades, dimension, ctx)}


@app.get("/api/analytics/distribution")
def api_analytics_distribution(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                                start: str | None = None, end: str | None = None, bins: int = 10,
                                strategies: str | None = None):
    trades = db.list_trades_for_analytics(_parse_keys(accounts), _parse_keys(tags), tag_logic, start, end,
                                          _parse_keys(strategies))
    return an.pnl_distribution(trades, min(max(bins, 4), 24))


@app.get("/api/week/{iso_year}/{iso_week}")
def api_week(iso_year: int, iso_week: int, accounts: str | None = None, tags: str | None = None,
              tag_logic: str = "or", strategies: str | None = None):
    return build_week_payload(iso_year, iso_week, _parse_keys(accounts), _parse_keys(tags), tag_logic,
                              _parse_keys(strategies))


@app.get("/api/month/{year}/{month}")
def api_month(year: int, month: int, accounts: str | None = None, tags: str | None = None,
               tag_logic: str = "or", strategies: str | None = None):
    return build_month_payload(year, month, _parse_keys(accounts), _parse_keys(tags), tag_logic,
                               _parse_keys(strategies))


@app.get("/api/accounts")
def api_list_accounts():
    return db.list_accounts()


@app.get("/api/account-options")
def api_account_options():
    return db.list_account_options()


@app.get("/api/platforms")
def api_platforms():
    return [{"key": k, "name": v, "manual": k in MANUAL_PLATFORMS} for k, v in ALL_PLATFORMS.items()]


@app.post("/api/accounts")
def api_add_account(payload: AccountCreate):
    if payload.platform not in ALL_PLATFORMS:
        raise HTTPException(400, f"Unbekannte Plattform '{payload.platform}'.")
    account_id = db.add_account(
        payload.name, payload.platform, payload.login, payload.password, payload.server, payload.starting_balance
    )
    return {"id": account_id}


@app.put("/api/accounts/{account_id}/starting-balance")
def api_update_starting_balance(account_id: int, payload: StartingBalanceUpdate):
    if not db.get_account(account_id):
        raise HTTPException(404, "Konto nicht gefunden.")
    db.set_starting_balance(account_id, payload.starting_balance)
    return {"ok": True}


@app.put("/api/accounts/{account_id}/name")
def api_rename_account(account_id: int, payload: AccountRename):
    if not db.get_account(account_id):
        raise HTTPException(404, "Konto nicht gefunden.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein.")
    db.rename_account(account_id, name)
    return {"ok": True}


@app.post("/api/trades/reassign")
def api_reassign_trades(payload: ReassignTrades):
    if not db.get_account(payload.account_id):
        raise HTTPException(404, "Konto nicht gefunden.")
    updated = db.reassign_unassigned_trades(payload.account_id, payload.source)
    return {"updated": updated}


@app.delete("/api/accounts/{account_id}")
def api_delete_account(account_id: int):
    db.delete_account(account_id)
    return {"ok": True}


@app.post("/api/accounts/{account_id}/sync")
def api_sync_account(account_id: int, full: bool = False):
    account = db.get_account(account_id)
    if not account:
        raise HTTPException(404, "Konto nicht gefunden.")

    # Bewusst naiv (tzinfo entfernt): MT5 erwartet naive Zeitstempel, und
    # last_sync wird als naives ISO-Datum gespeichert - ein aware datetime hier
    # wuerde beim naechsten Sync in fromisoformat(last_sync) - timedelta auf
    # einen Vergleich aware/naiv laufen. datetime.utcnow() lieferte genau das
    # (naives UTC), ist aber seit Python 3.12 deprecated und zur Entfernung
    # vorgemerkt - now(UTC) plus explizites Abstreifen ist der Ersatz.
    to_date = datetime.now(UTC).replace(tzinfo=None)
    if account["last_sync"] and not full:
        from_date = datetime.fromisoformat(account["last_sync"]) - timedelta(days=1)
    else:
        from_date = to_date - timedelta(days=365)

    error_cls = BROKER_ERRORS.get(account["platform"], Exception)
    try:
        result = sync_account(account, from_date, to_date)
    except error_cls as e:
        raise HTTPException(400, str(e))
    trades = result["trades"]

    inserted = db.insert_trades(trades, source=account["platform"], account_id=account_id)
    db.set_last_sync(account_id, to_date.isoformat())
    if result.get("balance") is not None:
        db.set_synced_balance(account_id, result["balance"])
    days_touched = sorted(set(t["day"] for t in trades))
    return {"parsed": len(trades), "inserted": inserted, "skipped": len(trades) - inserted, "days": days_touched}


@app.post("/api/days/{day}/images")
async def api_upload_image(day: str, file: UploadFile = File(...), trade_id: int | None = Form(None)):
    _check_day(day)
    if trade_id is not None and not db.get_trade(trade_id):
        raise HTTPException(404, "Trade nicht gefunden.")
    raw = await _read_upload(file, MAX_IMAGE_BYTES)
    try:
        filename, thumb_filename = save_image(raw)
    except Exception:
        raise HTTPException(400, "Datei konnte nicht als Bild verarbeitet werden.")
    image_id = db.add_image(day, trade_id, filename, thumb_filename)
    return {"id": image_id, "filename": filename, "thumb_filename": thumb_filename, "trade_id": trade_id}


@app.delete("/api/images/{image_id}")
def api_delete_image(image_id: int):
    image = db.get_image(image_id)
    if not image:
        raise HTTPException(404, "Bild nicht gefunden.")
    db.delete_image(image_id)
    delete_image_files(image["filename"], image["thumb_filename"])
    return {"ok": True}


@app.get("/api/tags")
def api_list_tags():
    return db.list_tags()


@app.get("/api/tag-stats")
def api_tag_stats():
    return db.tag_stats()


@app.post("/api/tags")
def api_add_tag(payload: TagCreate):
    try:
        tag_id = db.add_tag(payload.name, payload.color, payload.tag_group)
    except Exception:
        raise HTTPException(400, f"Tag '{payload.name}' existiert bereits.")
    return {"id": tag_id}


@app.put("/api/tags/{tag_id}")
def api_update_tag(tag_id: int, payload: TagCreate):
    db.update_tag(tag_id, payload.name, payload.color, payload.tag_group)
    return {"ok": True}


@app.delete("/api/tags/{tag_id}")
def api_delete_tag(tag_id: int):
    db.delete_tag(tag_id)
    return {"ok": True}


@app.put("/api/trades/{trade_id}/tags")
def api_update_trade_tags(trade_id: int, payload: TradeTagsUpdate):
    db.set_trade_tags(trade_id, payload.tag_ids)
    return {"ok": True}


@app.post("/api/trades/bulk-tag")
def api_bulk_tag(payload: BulkTagAssign):
    db.bulk_add_tag(payload.trade_ids, payload.tag_id)
    return {"ok": True}


def _check_journal_ref(entry_type: str, ref_key: str) -> tuple[str, str]:
    """Validiert Typ und Schluessel eines Journal-Eintrags. Beim Tagestyp muss
    der Schluessel ein ISO-Datum sein - sonst landen ueber die URL beliebige
    Schluessel in der Tabelle und tauchen nie wieder in einer Ansicht auf."""
    if entry_type not in db.JOURNAL_TYPES:
        raise HTTPException(400, "Unbekannter Journal-Typ.")
    if entry_type == "day":
        _check_day(ref_key)
    elif entry_type == "trade" and not ref_key.isdigit():
        raise HTTPException(400, "Trade-Bewertung braucht eine numerische Trade-ID.")
    return entry_type, ref_key


def _clamp_score(value: int | None) -> int | None:
    """Bewertung/Verfassung sind 1-5 - alles andere wird als 'nicht gesetzt' gewertet."""
    if value is None:
        return None
    return value if 1 <= value <= 5 else None


@app.get("/api/journal")
def api_list_journal(type: str = "day", start: str | None = None, end: str | None = None,
                      q: str | None = None, tags: str | None = None, mode: str = "all"):
    entries, truncated = db.list_journal_entries(
        type, start, end, (q or "").strip() or None, _parse_keys(tags), mode
    )
    return {"entries": entries, "truncated": truncated}


@app.get("/api/journal/months")
def api_journal_months():
    return {"months": db.journal_month_summary()}


@app.get("/api/journal/{entry_type}/{ref_key}")
def api_get_journal(entry_type: str, ref_key: str):
    entry_type, ref_key = _check_journal_ref(entry_type, ref_key)
    return {"entry": db.get_journal_entry(entry_type, ref_key)}


@app.put("/api/journal/{entry_type}/{ref_key}")
def api_save_journal(entry_type: str, ref_key: str, payload: JournalEntryUpdate):
    entry_type, ref_key = _check_journal_ref(entry_type, ref_key)
    entry = db.upsert_journal_entry(
        entry_type, ref_key, payload.title, payload.content_html, payload.plain_text,
        _clamp_score(payload.rating), _clamp_score(payload.mood),
        payload.followed_plan, payload.tag_ids,
    )
    return {"entry": entry}


@app.delete("/api/journal/{entry_type}/{ref_key}")
def api_delete_journal(entry_type: str, ref_key: str):
    entry_type, ref_key = _check_journal_ref(entry_type, ref_key)
    db.delete_journal_entry(entry_type, ref_key)
    return {"ok": True}


@app.post("/api/journal/{entry_type}/bulk-delete")
def api_bulk_delete_journal(entry_type: str, payload: JournalBulkDelete):
    ref_keys = [k for k in payload.ref_keys if k]
    for k in ref_keys:
        _check_journal_ref(entry_type, k)
    deleted = db.bulk_delete_journal_entries(entry_type, ref_keys)
    return {"deleted": deleted}


@app.get("/api/journal-templates")
def api_list_journal_templates():
    return db.list_journal_templates()


@app.post("/api/journal-templates")
def api_add_journal_template(payload: JournalTemplateUpdate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein.")
    return {"id": db.add_journal_template(name, payload.content_html, payload.position)}


@app.put("/api/journal-templates/{template_id}")
def api_update_journal_template(template_id: int, payload: JournalTemplateUpdate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein.")
    db.update_journal_template(template_id, name, payload.content_html, payload.position)
    return {"ok": True}


@app.delete("/api/journal-templates/{template_id}")
def api_delete_journal_template(template_id: int):
    db.delete_journal_template(template_id)
    return {"ok": True}


@app.get("/api/notebooks")
def api_list_notebooks():
    return {"nodes": db.list_notebook_nodes()}


@app.get("/api/notebooks/search")
def api_search_notebooks(q: str = ""):
    query = q.strip()
    if not query:
        return {"notes": []}
    return {"notes": db.search_notebook_notes(query)}


@app.get("/api/notebooks/{node_id}")
def api_get_notebook(node_id: int):
    node = db.get_notebook_node(node_id)
    if not node:
        raise HTTPException(404, "Notiz/Ordner nicht gefunden.")
    return {"node": node}


@app.post("/api/notebooks")
def api_create_notebook(payload: NotebookNodeCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein.")
    if payload.node_type not in ("folder", "note"):
        raise HTTPException(400, "node_type muss 'folder' oder 'note' sein.")
    if payload.parent_id is not None:
        parent = db.get_notebook_node(payload.parent_id)
        if not parent:
            raise HTTPException(404, "Übergeordneter Ordner nicht gefunden.")
        if parent["node_type"] != "folder":
            raise HTTPException(400, "Nur Ordner können weitere Einträge enthalten.")
    return {"node": db.create_notebook_node(payload.parent_id, payload.node_type, name)}


@app.put("/api/notebooks/{node_id}")
def api_update_notebook(node_id: int, payload: NotebookNodeUpdate):
    if not db.get_notebook_node(node_id):
        raise HTTPException(404, "Notiz/Ordner nicht gefunden.")
    name = payload.name.strip() if payload.name is not None else None
    if name == "":
        raise HTTPException(400, "Name darf nicht leer sein.")
    node = db.update_notebook_node(node_id, name, payload.content_html, payload.plain_text)
    return {"node": node}


@app.post("/api/notebooks/{node_id}/move")
def api_move_notebook(node_id: int, payload: NotebookNodeMove):
    if not db.get_notebook_node(node_id):
        raise HTTPException(404, "Notiz/Ordner nicht gefunden.")
    if payload.parent_id is not None:
        parent = db.get_notebook_node(payload.parent_id)
        if not parent:
            raise HTTPException(404, "Übergeordneter Ordner nicht gefunden.")
        if parent["node_type"] != "folder":
            raise HTTPException(400, "Nur Ordner können weitere Einträge enthalten.")
    try:
        node = db.move_notebook_node(node_id, payload.parent_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"node": node}


@app.delete("/api/notebooks/{node_id}")
def api_delete_notebook(node_id: int):
    db.delete_notebook_node(node_id)
    return {"ok": True}


@app.post("/api/notebooks/{node_id}/images")
async def api_upload_notebook_image(node_id: int, file: UploadFile = File(...)):
    """Bilder in Notizbuch-Notizen haengen (anders als Tages-/Trade-Bilder) an
    keinem Kalendertag - kein images-Zeilen-Eintrag noetig, das Bild lebt
    ausschliesslich als <img>-Tag im content_html der Notiz (Quill haelt die
    Referenz), die Datei selbst liegt wie alle anderen Bilder unter IMAGES_DIR."""
    if not db.get_notebook_node(node_id):
        raise HTTPException(404, "Notiz nicht gefunden.")
    raw = await _read_upload(file, MAX_IMAGE_BYTES)
    try:
        filename, thumb_filename = save_image(raw)
    except Exception:
        raise HTTPException(400, "Datei konnte nicht als Bild verarbeitet werden.")
    return {"filename": filename, "thumb_filename": thumb_filename}


@app.get("/api/todo-lists")
def api_list_todo_lists():
    return {"lists": db.list_todo_lists()}


@app.post("/api/todo-lists")
def api_create_todo_list(payload: TodoListCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein.")
    return {"list": db.create_todo_list(name)}


@app.put("/api/todo-lists/{list_id}")
def api_update_todo_list(list_id: int, payload: TodoListUpdate):
    if not db.get_todo_list(list_id):
        raise HTTPException(404, "To-Do-Liste nicht gefunden.")
    name = payload.name.strip() if payload.name is not None else None
    if name == "":
        raise HTTPException(400, "Name darf nicht leer sein.")
    return {"list": db.update_todo_list(list_id, name, payload.visible)}


@app.delete("/api/todo-lists/{list_id}")
def api_delete_todo_list(list_id: int):
    db.delete_todo_list(list_id)
    return {"ok": True}


@app.post("/api/todo-lists/{list_id}/items")
def api_create_todo_item(list_id: int, payload: TodoItemCreate):
    if not db.get_todo_list(list_id):
        raise HTTPException(404, "To-Do-Liste nicht gefunden.")
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, "Text darf nicht leer sein.")
    return {"item": db.create_todo_item(list_id, text)}


@app.put("/api/todo-items/{item_id}")
def api_update_todo_item(item_id: int, payload: TodoItemUpdate):
    text = payload.text.strip() if payload.text is not None else None
    if text == "":
        raise HTTPException(400, "Text darf nicht leer sein.")
    item = db.update_todo_item(item_id, text, payload.done)
    if not item:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    return {"item": item}


@app.delete("/api/todo-items/{item_id}")
def api_delete_todo_item(item_id: int):
    db.delete_todo_item(item_id)
    return {"ok": True}


# ---------- Strategien ----------
# Eine Strategie buendelt Regeln (optional gruppiert); ein Trade hat hoechstens
# eine. Loeschen ist bewusst zweigleisig: archived=1 ueber PUT ist der
# Normalfall (Trades und Auswertung bleiben), DELETE entkoppelt die Trades und
# wirft Regeln samt Bewertungen weg.

def _require_strategy(strategy_id: int) -> dict:
    strategy = db.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, "Strategie nicht gefunden.")
    return strategy


def _derive_followed_plan(strategy: dict | None, status: dict[str, int]) -> bool | None:
    """"Plan befolgt" wird am Trade nicht mehr eingegeben, sondern aus den
    Regeln abgeleitet: Ja, wenn jede beantwortete Regel auf Ja steht. None
    heisst "keine Aussage" - kein Trade ohne Strategie und keiner, bei dem noch
    keine Regel beantwortet ist, soll als "Plan gebrochen" gelten.
    Unbeantwortete Regeln zaehlen bewusst nicht als Verstoss (sie decken auch
    den Fall "Regel hier nicht anwendbar" ab, siehe SCHEMA in db.py)."""
    if not strategy:
        return None
    rule_ids = {str(r["id"]) for r in strategy["ungrouped_rules"]}
    for group in strategy["groups"]:
        rule_ids.update(str(r["id"]) for r in group["rules"])
    answered = [v for rid, v in status.items() if rid in rule_ids]
    if not answered:
        return None
    return all(v == 1 for v in answered)


def _require_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise HTTPException(400, "Name darf nicht leer sein.")
    return cleaned


@app.get("/api/strategies")
def api_list_strategies(include_archived: bool = False):
    return {"strategies": db.list_strategies(include_archived)}


@app.post("/api/strategies")
def api_create_strategy(payload: StrategyCreate):
    return {"strategy": db.create_strategy(_require_name(payload.name))}


@app.get("/api/strategies/{strategy_id}")
def api_get_strategy(strategy_id: int, include_archived: bool = False):
    """Liefert Strategie, Regelbaum, Kopfzahlen und Regel-Statistik in einer
    Antwort - die Strategie-Seite braucht ohnehin alles zusammen."""
    _require_strategy(strategy_id)
    return {
        "strategy": db.get_strategy_tree(strategy_id, include_archived),
        "summary": db.strategy_summary(strategy_id),
        "rule_stats": db.strategy_rule_stats(strategy_id, include_archived=True),
    }


@app.put("/api/strategies/{strategy_id}")
def api_update_strategy(strategy_id: int, payload: StrategyUpdate):
    _require_strategy(strategy_id)
    name = _require_name(payload.name) if payload.name is not None else None
    return {"strategy": db.update_strategy(strategy_id, name, payload.archived, payload.is_default)}


@app.delete("/api/strategies/{strategy_id}")
def api_delete_strategy(strategy_id: int):
    _require_strategy(strategy_id)
    db.delete_strategy(strategy_id)
    return {"ok": True}


@app.post("/api/strategies/order")
def api_set_strategy_order(payload: OrderUpdate):
    db.set_strategy_order(payload.order)
    return {"ok": True}


@app.post("/api/strategies/{strategy_id}/groups")
def api_create_rule_group(strategy_id: int, payload: RuleGroupCreate):
    _require_strategy(strategy_id)
    return {"group": db.create_rule_group(strategy_id, _require_name(payload.name))}


@app.put("/api/rule-groups/{group_id}")
def api_rename_rule_group(group_id: int, payload: RuleGroupCreate):
    if not db.get_rule_group(group_id):
        raise HTTPException(404, "Gruppe nicht gefunden.")
    db.rename_rule_group(group_id, _require_name(payload.name))
    return {"ok": True}


@app.delete("/api/rule-groups/{group_id}")
def api_delete_rule_group(group_id: int):
    if not db.get_rule_group(group_id):
        raise HTTPException(404, "Gruppe nicht gefunden.")
    db.delete_rule_group(group_id)   # Regeln bleiben, siehe db.delete_rule_group
    return {"ok": True}


@app.post("/api/strategies/{strategy_id}/groups/order")
def api_set_rule_group_order(strategy_id: int, payload: OrderUpdate):
    _require_strategy(strategy_id)
    db.set_rule_group_order(strategy_id, payload.order)
    return {"ok": True}


@app.post("/api/strategies/{strategy_id}/rules")
def api_create_rule(strategy_id: int, payload: RuleCreate):
    _require_strategy(strategy_id)
    if payload.group_id is not None:
        group = db.get_rule_group(payload.group_id)
        if not group or group["strategy_id"] != strategy_id:
            raise HTTPException(400, "Gruppe gehoert nicht zu dieser Strategie.")
    return {"rule": db.create_rule(strategy_id, _require_name(payload.text), payload.group_id)}


@app.put("/api/rules/{rule_id}")
def api_update_rule(rule_id: int, payload: RuleUpdate):
    rule = db.get_rule(rule_id)
    if not rule:
        raise HTTPException(404, "Regel nicht gefunden.")
    if payload.group_id is not None:
        group = db.get_rule_group(payload.group_id)
        if not group or group["strategy_id"] != rule["strategy_id"]:
            raise HTTPException(400, "Gruppe gehoert nicht zu dieser Strategie.")
    text = _require_name(payload.text) if payload.text is not None else None
    return {"rule": db.update_rule(rule_id, text, payload.group_id, payload.clear_group, payload.archived)}


@app.post("/api/rules/{rule_id}/replace")
def api_replace_rule(rule_id: int, payload: RuleReplace):
    if not db.get_rule(rule_id):
        raise HTTPException(404, "Regel nicht gefunden.")
    return {"rule": db.replace_rule(rule_id, _require_name(payload.text))}


@app.delete("/api/rules/{rule_id}")
def api_delete_rule(rule_id: int):
    if not db.get_rule(rule_id):
        raise HTTPException(404, "Regel nicht gefunden.")
    db.delete_rule(rule_id)
    return {"ok": True}


@app.post("/api/strategies/{strategy_id}/rules/order")
def api_set_rule_order(strategy_id: int, payload: OrderUpdate):
    _require_strategy(strategy_id)
    db.set_rule_order(strategy_id, payload.order)
    return {"ok": True}


# ---------- Strategie am Trade ----------

@app.put("/api/trades/{trade_id}/strategy")
def api_set_trade_strategy(trade_id: int, payload: TradeStrategyUpdate):
    if not db.get_trade(trade_id):
        raise HTTPException(404, "Trade nicht gefunden.")
    if payload.strategy_id is not None:
        _require_strategy(payload.strategy_id)
    db.set_trade_strategy(trade_id, payload.strategy_id)
    return {"ok": True}


@app.get("/api/trades/{trade_id}/rule-status")
def api_get_trade_rule_status(trade_id: int):
    trade = db.get_trade(trade_id)
    if not trade:
        raise HTTPException(404, "Trade nicht gefunden.")
    status = db.get_trade_rule_status(trade_id)
    strategy = db.get_strategy_tree(trade["strategy_id"]) if trade["strategy_id"] else None
    return {"strategy": strategy, "status": status, "followed_plan": _derive_followed_plan(strategy, status)}


@app.put("/api/trades/{trade_id}/rule-status")
def api_set_trade_rule_status(trade_id: int, payload: TradeRuleStatusUpdate):
    trade = db.get_trade(trade_id)
    if not trade:
        raise HTTPException(404, "Trade nicht gefunden.")
    rule = db.get_rule(payload.rule_id)
    if not rule:
        raise HTTPException(404, "Regel nicht gefunden.")
    if rule["strategy_id"] != trade["strategy_id"]:
        raise HTTPException(400, "Regel gehoert nicht zur Strategie dieses Trades.")
    db.set_trade_rule_status(trade_id, payload.rule_id, payload.followed)
    status = db.get_trade_rule_status(trade_id)
    strategy = db.get_strategy_tree(trade["strategy_id"]) if trade["strategy_id"] else None
    return {"status": status, "followed_plan": _derive_followed_plan(strategy, status)}


@app.post("/api/trades/bulk-strategy")
def api_bulk_set_trade_strategy(payload: BulkStrategyAssign):
    if payload.strategy_id is not None:
        _require_strategy(payload.strategy_id)
    return {"updated": db.bulk_set_trade_strategy(payload.trade_ids, payload.strategy_id)}


@app.post("/api/trades/bulk-rule-status")
def api_bulk_set_trade_rule_status(payload: BulkRuleStatus):
    if not db.get_rule(payload.rule_id):
        raise HTTPException(404, "Regel nicht gefunden.")
    return {"updated": db.bulk_set_trade_rule_status(payload.trade_ids, payload.rule_id, payload.followed)}


@app.get("/api/news/calendar")
def api_news_calendar():
    result = news.fetch_calendar()
    fetched_at = result["fetched_at"].isoformat() if result["fetched_at"] else None
    return {"events": result["events"], "fetched_at": fetched_at}


app.mount("/media", StaticFiles(directory=str(IMAGES_DIR)), name="media")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
