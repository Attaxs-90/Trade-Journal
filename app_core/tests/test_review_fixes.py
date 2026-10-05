"""Faelle aus dem Code-Review: Trade-Navigation, Startkapital archivierter
Konten, Notizbuch-Bilder, Backup-Passwoerter, Broker-Logins, Eingabepruefung.
temp_db() laeuft vor dem Import von app.main (siehe test_main.py)."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from .helpers import call, insert, make_trade, temp_db

TMP = temp_db()

from app import backup, brokers, db, main, stats  # noqa: E402
from app.brokers import ninjatrader_adapter  # noqa: E402
from app.brokers.mt5_adapter import MT5Error  # noqa: E402


class NeighborTieBreakTest(unittest.TestCase):
    def setUp(self):
        temp_db()
        # Copy-Trades: gleicher Tag, gleiche entry_time, verschiedene Konten
        self.ids = insert([make_trade(1), make_trade(2), make_trade(3)])

    def test_gleiche_entry_time_wird_nicht_uebersprungen(self):
        seen = [self.ids[0]]
        while True:
            nxt = db.adjacent_trade_id(seen[-1], "next", sort="day", direction="asc")
            if nxt is None:
                break
            seen.append(nxt)
        self.assertEqual(seen, self.ids)

    def test_null_volumen_ist_erreichbar(self):
        temp_db()
        a, b = insert([make_trade(1, volume=None), make_trade(2, volume=2.0)])
        self.assertEqual(db.adjacent_trade_id(a, "next", sort="volume", direction="asc"), b)
        self.assertEqual(db.adjacent_trade_id(b, "prev", sort="volume", direction="asc"), a)


class ArchivedStartBalanceTest(unittest.TestCase):
    def setUp(self):
        temp_db()
        self.acc = db.add_account("Alt", "ninjatrader", "", "", "", starting_balance=100000)
        insert([make_trade(1, net=500)], account_id=self.acc)
        db.delete_account(self.acc)

    def test_startkapital_bleibt_nach_archivieren(self):
        self.assertEqual(stats.compute_start_balance([str(self.acc)]), 100000)
        self.assertEqual(stats.compute_start_balance(None), 100000)

    def test_limits_nur_bei_expliziter_auswahl(self):
        db.set_account_limits(self.acc, 1000, 5000)
        self.assertEqual(stats.prop_limit_status(None), [])
        self.assertEqual(len(stats.prop_limit_status([str(self.acc)])), 1)


class NotebookImageCleanupTest(unittest.TestCase):
    def setUp(self):
        temp_db()

    def _note(self, name, html):
        node = db.create_notebook_node(None, "note", name)
        db.update_notebook_node(node["id"], content_html=html)
        return node["id"]

    def test_nur_unreferenzierte_bilder_werden_gemeldet(self):
        gone = self._note("a", '<p><img src="/media/notiz_1_aaa.webp"><img src="/media/notiz_1_bbb.webp"></p>')
        self._note("b", '<p><img src="/media/notiz_1_bbb.webp"></p>')  # per Copy&Paste geteilt
        count, orphans = db.delete_notebook_node(gone)
        self.assertEqual(count, 1)
        self.assertEqual(orphans, ["notiz_1_aaa.webp"])

    def test_punktpfade_werden_ignoriert(self):
        node = self._note("c", '<img src="/media/../trades.db">')
        self.assertEqual(db.delete_notebook_node(node)[1], [])


class BackupScrubTest(unittest.TestCase):
    def test_externes_ziel_bekommt_nur_geleerte_kopie(self):
        temp_db()
        db.add_account("MT5", "mt5", "123", "geheim", "srv")
        target = Path(tempfile.mkdtemp(prefix="tj_backup_"))
        images = Path(tempfile.mkdtemp(prefix="tj_images_"))
        db.set_app_setting("backup_dir", str(target))
        with mock.patch.object(backup, "DB_PATH", db.DB_PATH), mock.patch.object(backup, "IMAGES_DIR", images):
            result = backup.run_backup()
        files = sorted(p.name for p in target.iterdir())
        self.assertEqual(len([f for f in files if f.endswith(".db")]), 1)
        self.assertFalse([f for f in files if f.endswith(".tmp")])
        conn = sqlite3.connect(result["file"])
        try:
            self.assertEqual(conn.execute("SELECT password FROM broker_accounts").fetchone()[0], "")
        finally:
            conn.close()


class BrokerLoginTest(unittest.TestCase):
    def test_mt5_login_keine_zahl_gibt_mt5error(self):
        account = {"platform": "mt5", "login": "abc", "password": "", "server": ""}
        with self.assertRaises(MT5Error):
            brokers.sync_account(account, None, None)

    def test_ninjatrader_ohne_login_bei_mehreren_konten(self):
        fills = [{"account": "Sim101"}, {"account": "Live1"}]
        path = Path(tempfile.mkdtemp()) / "executions.csv"
        path.write_text("x", encoding="utf-8")
        with mock.patch.object(ninjatrader_adapter, "parse_csv", return_value=fills):
            with self.assertRaises(ninjatrader_adapter.NinjaTraderError):
                ninjatrader_adapter.fetch_closed_trades("", str(path), None, None)


class EndpointValidationTest(unittest.TestCase):
    def setUp(self):
        temp_db()

    def test_tag_umbenennen_auf_vorhandenen_namen(self):
        db.add_tag("Range", "#ffffff")
        other = db.add_tag("Trend", "#000000")
        status, _ = call(main.app, "PUT", f"/api/tags/{other}", json_body={"name": "Range", "color": "#000000"})
        self.assertEqual(status, 400)

    def test_ungueltige_woche_und_monat(self):
        self.assertEqual(call(main.app, "GET", "/api/week/2026/54")[0], 400)
        self.assertEqual(call(main.app, "GET", "/api/month/2026/13")[0], 400)
        self.assertEqual(call(main.app, "GET", "/api/month/2026/10")[0], 200)


if __name__ == "__main__":
    unittest.main()
