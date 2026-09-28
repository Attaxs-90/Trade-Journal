"""Endpunkte und Hilfsfunktionen aus main.py. temp_db() laeuft vor dem Import
von app.main, damit dessen db.init_db() die Temp-Datenbank trifft."""
import unittest

from .helpers import call, insert, make_trade, temp_db

TMP = temp_db()

from app import backup, db, main  # noqa: E402


class LocalOnlyTest(unittest.TestCase):
    def test_lokaler_zugriff_erlaubt(self):
        self.assertEqual(call(main.app, "GET", "/api/accounts")[0], 200)

    def test_fremder_host_abgelehnt(self):
        self.assertEqual(call(main.app, "GET", "/api/accounts", {"host": "evil.example:8420"})[0], 403)

    def test_schreiben_von_fremder_seite_abgelehnt(self):
        tag = {"name": "x", "color": "#ffffff"}
        self.assertEqual(call(main.app, "POST", "/api/tags", {"origin": "https://evil.example"}, tag)[0], 403)
        self.assertEqual(call(main.app, "POST", "/api/tags", {"sec-fetch-site": "cross-site"}, tag)[0], 403)

    def test_schreiben_aus_der_app_erlaubt(self):
        tag = {"name": "ok", "color": "#ffffff"}
        self.assertEqual(call(main.app, "POST", "/api/tags", {"origin": "http://localhost:8420"}, tag)[0], 200)


class EquityRangeTest(unittest.TestCase):
    def test_zeitraum_startet_beim_echten_kontostand(self):
        temp_db()
        account_id = db.add_account("A", "ninjatrader", "", "", "", starting_balance=1000)
        insert([make_trade(1, day="2026-08-01", net=500), make_trade(2, day="2026-09-01", net=100),
                make_trade(3, day="2026-09-02", net=-50)], account_id=account_id)
        status, data = call(main.app, "GET", "/api/analytics/equity?start=2026-09-01")
        self.assertEqual(status, 200)
        self.assertEqual(data["start_balance"], 1500)
        self.assertEqual(data["curve"][0]["cum_net"], 1600)
        self.assertEqual(data["trading_days"], 2)


class FollowedPlanTest(unittest.TestCase):
    def test_ableitung(self):
        strategy = {"ungrouped_rules": [{"id": 1}], "groups": [{"rules": [{"id": 2}]}]}
        self.assertIsNone(main._derive_followed_plan(None, {}))
        self.assertIsNone(main._derive_followed_plan(strategy, {}))
        self.assertTrue(main._derive_followed_plan(strategy, {"1": 1}))
        self.assertFalse(main._derive_followed_plan(strategy, {"1": 1, "2": 0}))
        self.assertTrue(main._derive_followed_plan(strategy, {"1": 1, "99": 0}))  # fremde Regel zaehlt nicht


class BackupTest(unittest.TestCase):
    def test_backup_mit_passwort_leeren_im_eigenen_ordner(self):
        import sqlite3

        tmp = temp_db()
        images = tmp / "images"
        images.mkdir()
        (images / "a.webp").write_bytes(b"x")
        backup.DB_PATH = db.DB_PATH
        backup.IMAGES_DIR = images
        db.add_account("A", "mt5", "1", "geheim", "srv")
        target = tmp / "extern"
        db.set_app_setting("backup_dir", str(target))

        result = backup.run_backup()
        self.assertEqual(result["images_copied"], 1)
        self.assertTrue((target / "images" / "a.webp").exists())
        conn = sqlite3.connect(result["file"])
        try:
            self.assertEqual(conn.execute("SELECT password FROM broker_accounts").fetchone()[0], "")
        finally:
            conn.close()
        self.assertEqual(backup.run_backup()["images_copied"], 0)  # inkrementell
        self.assertIsNone(backup.maybe_run_daily())  # heute schon gesichert


if __name__ == "__main__":
    unittest.main()
