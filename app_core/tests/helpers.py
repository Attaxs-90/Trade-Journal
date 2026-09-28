"""Gemeinsame Test-Hilfen. Jede Datenbank-Testklasse bekommt eine frische
SQLite-Datei in einem Temp-Ordner - die echte data/trades.db wird nie
angefasst. Wichtig: temp_db() muss vor dem ersten Import von app.main laufen,
weil main beim Import db.init_db() ausfuehrt."""
import tempfile
from pathlib import Path

from app import db

_counter = 0


def temp_db() -> Path:
    global _counter
    _counter += 1
    tmp = Path(tempfile.mkdtemp(prefix="tj_test_"))
    db.DB_PATH = tmp / f"test_{_counter}.db"
    db.BACKUP_DIR = tmp / "backups"
    db.BACKUP_DIR.mkdir()
    db.init_db()
    return tmp


def make_trade(n: int, day: str = "2026-09-01", net: float = 100.0, risk: float | None = None, **extra) -> dict:
    t = dict(
        day=day, instrument="NQ", direction="Long",
        entry_time=f"{day}T15:30:00", exit_time=f"{day}T15:45:00",
        entry_price=100.0, exit_price=101.0, exit_type="Close", points=1.0,
        gross_usd=net, commission_usd=0.0, net_usd=net,
        entry_order_id=f"e{n}", exit_order_id=f"x{n}", risk_usd=risk,
    )
    t.update(extra)
    return t


def insert(trades: list[dict], **kwargs) -> list[int]:
    db.insert_trades(trades, **kwargs)
    with db.get_conn() as conn:
        return [r["id"] for r in conn.execute("SELECT id FROM trades ORDER BY id")]


def call(app, method: str, path: str, headers: dict | None = None, json_body=None) -> tuple[int, object]:
    """Minimaler ASGI-Aufruf ohne Zusatzpaket (starlettes TestClient braucht
    httpx). Liefert (Statuscode, JSON oder Text). Lifespan laeuft bewusst nicht."""
    import asyncio
    import json

    body = json.dumps(json_body).encode() if json_body is not None else b""
    hdrs = {"host": "127.0.0.1:8420"}
    if json_body is not None:
        hdrs["content-type"] = "application/json"
    hdrs.update(headers or {})
    raw_path, _, query = path.partition("?")
    scope = {
        "type": "http", "http_version": "1.1", "method": method, "scheme": "http",
        "path": raw_path, "raw_path": raw_path.encode(), "query_string": query.encode(),
        "root_path": "", "headers": [(k.encode(), v.encode()) for k, v in hdrs.items()],
        "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 8420),
    }
    messages = [{"type": "http.request", "body": body, "more_body": False}]
    sent = []

    async def receive():
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(msg):
        sent.append(msg)

    asyncio.run(app(scope, receive, send))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    data = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    try:
        return status, json.loads(data)
    except ValueError:
        return status, data.decode()
