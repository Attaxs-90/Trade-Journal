"""Speichert hochgeladene Bilder komprimiert auf der Festplatte (nicht in der DB),
inkl. eines kleinen Thumbnails - damit auch bei hunderten Screenshots wenig Platz verbraucht wird."""
import io
import uuid

from PIL import Image, ImageOps

from .config import IMAGES_DIR

MAX_WIDTH = 2200
MAX_THUMB_WIDTH = 380
JPEG_QUALITY = 90
THUMB_QUALITY = 78


def _resized(img: Image.Image, max_width: int) -> Image.Image:
    if img.width <= max_width:
        return img
    ratio = max_width / img.width
    return img.resize((max_width, round(img.height * ratio)), Image.LANCZOS)


def save_image(raw_bytes: bytes) -> tuple[str, str]:
    """Verarbeitet Bild-Bytes, speichert Voll- und Thumbnail-Version als JPEG.
    Gibt (filename, thumb_filename) zurueck."""
    img = Image.open(io.BytesIO(raw_bytes))
    img = ImageOps.exif_transpose(img)  # Rotation von Handy-/Screenshot-Fotos korrigieren
    img = img.convert("RGB")  # kein Alpha-Kanal noetig, spart zusaetzlich Platz

    uid = uuid.uuid4().hex
    filename = f"{uid}.jpg"
    full = _resized(img, MAX_WIDTH)
    full.save(IMAGES_DIR / filename, "JPEG", quality=JPEG_QUALITY, optimize=True)

    thumb_filename = f"{uid}_thumb.jpg"
    thumb = _resized(img, MAX_THUMB_WIDTH)
    thumb.save(IMAGES_DIR / thumb_filename, "JPEG", quality=THUMB_QUALITY, optimize=True)

    return filename, thumb_filename


def delete_image_files(filename: str, thumb_filename: str):
    for name in (filename, thumb_filename):
        path = IMAGES_DIR / name
        if path.exists():
            path.unlink()
