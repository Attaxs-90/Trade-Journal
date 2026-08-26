from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db
from .brokers import sync_account, ERRORS as BROKER_ERRORS, ALL_PLATFORMS, MANUAL_PLATFORMS
from .config import IMAGES_DIR
from .images import save_image, delete_image_files
from .parser import parse_csv, pair_trades
from .stats import day_stats, build_week_payload, build_month_payload

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Trade Journal")
db.init_db()

MAX_CSV_BYTES = 25 * 1024 * 1024   # 25 MB - grosszuegig fuer Tages-/Wochenexporte
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB - deckt auch hochaufgeloeste Screenshots ab


def _parse_accounts(accounts: str | None) -> list[str] | None:
    if not accounts:
        return None
    keys = [k for k in accounts.split(",") if k]
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


class ReassignTrades(BaseModel):
    account_id: int
    source: str | None = None  # z.B. "ninjatrader" - None = alle nicht zugeordneten Trades


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
def api_list_days(accounts: str | None = None):
    return db.list_days(_parse_accounts(accounts))


@app.get("/api/days/{day}")
def api_day_detail(day: str, accounts: str | None = None):
    trades = db.get_day_trades(day, _parse_accounts(accounts))
    if not trades:
        raise HTTPException(404, "Kein Tag mit Trades gefunden.")
    stats = day_stats(trades)
    note = db.get_day_notes(day)
    images = db.get_images_for_day(day)
    return {"trades": trades, "stats": stats, "note": note, "images": images}


@app.put("/api/trades/{trade_id}/notes")
def api_update_trade_notes(trade_id: int, payload: NotesUpdate):
    db.update_trade_notes(trade_id, payload.notes)
    return {"ok": True}


@app.delete("/api/trades/{trade_id}")
def api_delete_trade(trade_id: int):
    db.delete_trade(trade_id)
    return {"ok": True}


@app.put("/api/days/{day}/notes")
def api_update_day_notes(day: str, payload: NotesUpdate):
    db.set_day_notes(day, payload.notes)
    return {"ok": True}


@app.get("/api/overview")
def api_overview(accounts: str | None = None):
    days = db.list_days(_parse_accounts(accounts))
    days_sorted = sorted(days, key=lambda d: d["day"])
    cum = 0.0
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
    }


@app.get("/api/week/{iso_year}/{iso_week}")
def api_week(iso_year: int, iso_week: int, accounts: str | None = None):
    return build_week_payload(iso_year, iso_week, _parse_accounts(accounts))


@app.get("/api/month/{year}/{month}")
def api_month(year: int, month: int, accounts: str | None = None):
    return build_month_payload(year, month, _parse_accounts(accounts))


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
    account_id = db.add_account(payload.name, payload.platform, payload.login, payload.password, payload.server)
    return {"id": account_id}


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
def api_sync_account(account_id: int):
    account = db.get_account(account_id)
    if not account:
        raise HTTPException(404, "Konto nicht gefunden.")

    to_date = datetime.utcnow()
    if account["last_sync"]:
        from_date = datetime.fromisoformat(account["last_sync"]) - timedelta(days=1)
    else:
        from_date = to_date - timedelta(days=365)

    error_cls = BROKER_ERRORS.get(account["platform"], Exception)
    try:
        trades = sync_account(account, from_date, to_date)
    except error_cls as e:
        raise HTTPException(400, str(e))

    inserted = db.insert_trades(trades, source=account["platform"], account_id=account_id)
    db.set_last_sync(account_id, to_date.isoformat())
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


app.mount("/media", StaticFiles(directory=str(IMAGES_DIR)), name="media")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
