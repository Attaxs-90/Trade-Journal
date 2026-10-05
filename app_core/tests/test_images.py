"""Bildverarbeitung aus images.py - laeuft gegen einen Temp-Ordner statt data/images."""
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from app import images


def _png(mode: str, color) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, (40, 20), color).save(buf, "PNG")
    return buf.getvalue()


class SaveImageTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        patcher = mock.patch.object(images, "IMAGES_DIR", self.dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def test_transparenz_wird_weiss_statt_schwarz(self):
        filename, _ = images.save_image(_png("RGBA", (0, 0, 0, 0)), "t")
        with Image.open(self.dir / filename) as img:
            r, g, b = img.convert("RGB").getpixel((5, 5))
        self.assertGreater(min(r, g, b), 240)

    def test_deckende_farbe_bleibt(self):
        filename, _ = images.save_image(_png("RGB", (200, 0, 0)), "t")
        with Image.open(self.dir / filename) as img:
            r, g, b = img.convert("RGB").getpixel((5, 5))
        self.assertGreater(r, 180)
        self.assertLess(g, 30)

    def test_fehler_beim_thumbnail_laesst_keine_datei_zurueck(self):
        real_save = Image.Image.save

        def failing_save(img, fp, *args, **kwargs):
            if str(fp).endswith("_thumb.webp"):
                raise OSError("Platte voll")
            return real_save(img, fp, *args, **kwargs)

        with mock.patch.object(Image.Image, "save", failing_save):
            with self.assertRaises(OSError):
                images.save_image(_png("RGB", (1, 2, 3)), "t")
        self.assertEqual(list(self.dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
