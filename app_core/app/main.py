from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
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


def _parse_accounts(accounts: str | None) -> list[str] | None:
    if not accounts:
        return None
    keys = [k for k in accounts.split(",") if k]
    return keys or None


def _parse_tags(tags: str | None) -> list[str] | None:
    if not tags:
        return None
    keys = [k for k in tags.split(",") if k]
    return keys or None


async def _read_upload(file: UploadFile, max_bytes: int) -> bytes:
    """Liest einen Upload mit harter Groessengrenze, statt beliebig grosse
    Dateien komplett in den Speicher zu laden."""
    raw = await file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(413, f"Datei zu gross (Limit: {max_bytes // (1024 * 1024)} MB).")
    return raw


class NotesUpdate(BaseModel):
    notes: str


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
    color: str
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
def api_list_days(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or"):
    return db.list_days(_parse_accounts(accounts), _parse_tags(tags), tag_logic)


@app.get("/api/trades")
def api_list_trades(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                     page: int = 1, page_size: int = 50, sort: str = "day", dir: str = "desc"):
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    trades, total = db.list_trades(
        _parse_accounts(accounts), _parse_tags(tags), tag_logic,
        offset=(page - 1) * page_size, limit=page_size, sort=sort, direction=dir,
    )
    return {"trades": trades, "total": total, "page": page, "page_size": page_size}


@app.get("/api/days/{day}")
def api_day_detail(day: str, accounts: str | None = None, tags: str | None = None, tag_logic: str = "or"):
    trades = db.get_day_trades(day, _parse_accounts(accounts), _parse_tags(tags), tag_logic)
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


@app.delete("/api/trades/{trade_id}")
def api_delete_trade(trade_id: int):
    db.delete_trade(trade_id)
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
                        sort: str = "day", dir: str = "desc"):
    if to not in ("next", "prev"):
        raise HTTPException(400, "to muss 'next' oder 'prev' sein.")
    neighbor_id = db.adjacent_trade_id(
        trade_id, to, _parse_accounts(accounts), _parse_tags(tags), tag_logic, sort, dir
    )
    return {"id": neighbor_id}


@app.get("/api/overview")
def api_overview(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or"):
    keys = _parse_accounts(accounts)
    days = db.list_days(keys, _parse_tags(tags), tag_logic)

    # Startkapital: bei einer Konto-Auswahl nur deren Startkapital summieren
    # (der Magic-Key "csv" fuer nicht zugeordnete Trades hat keins), sonst
    # alle verbundenen Konten - die Kurve/der Kontostand sollen dann bei
    # diesem Basiswert starten statt bei 0.
    start_balance = compute_start_balance(keys)

    days_sorted = sorted(days, key=lambda d: d["day"])
    cum = start_balance
    curve = []
    for d in days_sorted:
        cum += d["net_usd"]
        curve.append({"day": d["day"], "cum_net": round(cum, 2)})
    total_net = round(sum(d["net_usd"] for d in days), 2)
    total_trades = sum(d["trade_count"] for d in days)
    best_day = max(days, key=lambda d: d["net_usd"]) if days else None
    worst_day = min(days, key=lambda d: d["net_usd"]) if days else None
    return {
        "days": days,
        "curve": curve,
        "total_net": total_net,
        "total_trades": total_trades,
        "trading_days": len(days),
        "best_day": best_day,
        "worst_day": worst_day,
        "start_balance": round(start_balance, 2),
        "current_balance": round(start_balance + total_net, 2),
    }


@app.get("/api/analytics/dimensions")
def api_analytics_dimensions():
    return [{"key": k, "label": v["label"]} for k, v in an.DIMENSIONS.items()]


@app.get("/api/analytics/summary")
def api_analytics_summary(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                           start: str | None = None, end: str | None = None):
    trades = db.list_trades_for_analytics(_parse_accounts(accounts), _parse_tags(tags), tag_logic, start, end)
    return an.trade_summary(trades)


@app.get("/api/analytics/equity")
def api_analytics_equity(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                          start: str | None = None, end: str | None = None):
    keys = _parse_accounts(accounts)
    days = db.list_days(keys, _parse_tags(tags), tag_logic)
    if start:
        days = [d for d in days if d["day"] >= start]
    if end:
        days = [d for d in days if d["day"] <= end]
    return an.equity_and_drawdown(days, compute_start_balance(keys))


@app.get("/api/analytics/breakdown")
def api_analytics_breakdown(dimension: str, accounts: str | None = None, tags: str | None = None,
                             tag_logic: str = "or", start: str | None = None, end: str | None = None):
    if dimension not in an.DIMENSIONS:
        raise HTTPException(400, f"Unbekannte Dimension '{dimension}'.")
    trades = db.list_trades_for_analytics(_parse_accounts(accounts), _parse_tags(tags), tag_logic, start, end)
    ctx = an.build_context(trades)
    return {"dimension": dimension, "label": an.DIMENSIONS[dimension]["label"], "rows": an.breakdown(trades, dimension, ctx)}


@app.get("/api/analytics/distribution")
def api_analytics_distribution(accounts: str | None = None, tags: str | None = None, tag_logic: str = "or",
                                start: str | None = None, end: str | None = None, bins: int = 10):
    trades = db.list_trades_for_analytics(_parse_accounts(accounts), _parse_tags(tags), tag_logic, start, end)
    return an.pnl_distribution(trades, min(max(bins, 4), 24))


@app.get("/api/week/{iso_year}/{iso_week}")
def api_week(iso_year: int, iso_week: int, accounts: str | None = None, tags: str | None = None, tag_logic: str = "or"):
    return build_week_payload(iso_year, iso_week, _parse_accounts(accounts), _parse_tags(tags), tag_logic)


@app.get("/api/month/{year}/{month}")
def api_month(year: int, month: int, accounts: str | None = None, tags: str | None = None, tag_logic: str = "or"):
    return build_month_payload(year, month, _parse_accounts(accounts), _parse_tags(tags), tag_logic)


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

    to_date = datetime.utcnow()
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
        try:
            datetime.strptime(ref_key, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "Datum muss im Format JJJJ-MM-TT vorliegen.")
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
    return {"entries": db.list_journal_entries(
        type, start, end, (q or "").strip() or None, _parse_tags(tags), mode
    )}


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


@app.get("/api/news/calendar")
def api_news_calendar():
    result = news.fetch_calendar()
    fetched_at = result["fetched_at"].isoformat() if result["fetched_at"] else None
    return {"events": result["events"], "fetched_at": fetched_at}


app.mount("/media", StaticFiles(directory=str(IMAGES_DIR)), name="media")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
