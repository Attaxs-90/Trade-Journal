import json
from functools import lru_cache
from pathlib import Path

# app/config.py -> app/ -> app_core/ -> Projekt-Root (wo data/ und config.json
# liegen, bewusst ausserhalb von app_core/, damit Updates sie nie anfassen).
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "trades.db"
CONFIG_PATH = BASE_DIR / "config.json"
IMAGES_DIR = DATA_DIR / "images"
IMAGES_DIR.mkdir(exist_ok=True)

DEFAULT_CONFIG = {
    "point_value": {
        "NQ": 20.0, "MNQ": 2.0,
        "ES": 50.0, "MES": 5.0,
        "YM": 5.0, "MYM": 0.5,
        "RTY": 50.0, "M2K": 5.0,
        "CL": 1000.0, "MCL": 100.0,
        "GC": 100.0, "MGC": 10.0
    }
}


@lru_cache(maxsize=1)
def load_config() -> dict:
    """Ergebnis wird fuer die Prozesslaufzeit gecacht - config.json wird beim CSV-Import
    sonst pro Trade neu von der Platte gelesen und geparst. Aenderungen an config.json
    greifen nach einem Neustart der App."""
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2, ensure_ascii=False), encoding="utf-8")
        return DEFAULT_CONFIG
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def point_value_for(instrument_root: str) -> float:
    cfg = load_config()
    values = cfg.get("point_value", {})
    if instrument_root in values:
        return values[instrument_root]
    raise ValueError(
        f"Kein Punktwert fuer Instrument '{instrument_root}' in config.json hinterlegt. "
        f"Bitte in config.json unter 'point_value' ergaenzen."
    )
