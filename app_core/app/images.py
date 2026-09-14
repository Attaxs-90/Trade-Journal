"""Speichert hochgeladene Bilder komprimiert auf der Festplatte (nicht in der DB),
inkl. eines kleinen Thumbnails - damit auch bei hunderten Screenshots wenig Platz verbraucht wird."""
import io
import uuid

from PIL import Image, ImageOps

from .config import IMAGES_DIR

MAX_WIDTH = 2200
MAX_THUMB_WIDTH = 380
WEBP_QUALITY = 90
THUMB_QUALITY = 78


def _resized(img: Image.Image, max_width: int) -> Image.Image:
    if img.width <= max_width:
        return img
    ratio = max_width / img.width
    return img.resize((max_width, round(img.height * ratio)), Image.LANCZOS)


def save_image(raw_bytes: bytes, name_hint: str) -> tuple[str, str]:
    """Verarbeitet Bild-Bytes, speichert Voll- und Thumbnail-Version als WebP
    (kleinere Dateien bei gleicher bzw. besserer Qualitaet als JPEG).

    name_hint traegt den Kontext (Tag/Trade/Notiz, siehe Aufrufer in main.py)
    in den Dateinamen, damit eine Datei in data/images auch ausserhalb der App
    (Explorer, Backup) einem Tag oder Trade zuordenbar bleibt, statt nur eine
    zufaellige ID zu sein - die Zuordnung stand zwar schon immer in der
    images-Tabelle, aber eben nicht in der Datei selbst. Ein kurzes
    Zufalls-Suffix bleibt trotzdem dabei, weil an einem Tag/Trade mehrere
    Bilder liegen koennen. Gibt (filename, thumb_filename) zurueck."""
    img = Image.open(io.BytesIO(raw_bytes))
    img = ImageOps.exif_transpose(img)  # Rotation von Handy-/Screenshot-Fotos korrigieren
    img = img.convert("RGB")  # kein Alpha-Kanal noetig, spart zusaetzlich Platz

    uid = uuid.uuid4().hex[:8]
    filename = f"{name_hint}_{uid}.webp"
    full = _resized(img, MAX_WIDTH)
    full.save(IMAGES_DIR / filename, "WEBP", quality=WEBP_QUALITY)

    thumb_filename = f"{name_hint}_{uid}_thumb.webp"
    thumb = _resized(img, MAX_THUMB_WIDTH)
    thumb.save(IMAGES_DIR / thumb_filename, "WEBP", quality=THUMB_QUALITY)

    return filename, thumb_filename


def delete_image_files(filename: str, thumb_filename: str):
    for name in (filename, thumb_filename):
        path = IMAGES_DIR / name
        if path.exists():
            path.unlink()
