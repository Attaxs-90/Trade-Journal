"""Datenbanklogik gegen eine frische Temp-Datenbank (siehe helpers.temp_db)."""
import unittest

from app import db

from .helpers import insert, make_trade, temp_db


class RuleStatusTest(unittest.TestCase):
    def setUp(self):
        temp_db()
        self.t1, self.t2 = insert([make_trade(1, net=100), make_trade(2, net=-50)])
        self.strategy = db.create_strategy("Test")
        self.rule = db.create_rule(self.strategy["id"], "Nur mit Trend")
        for t in (self.t1, self.t2):
            db.set_trade_strategy(t, self.strategy["id"])
        db.set_trade_rule_status(self.t1, self.rule["id"], True)
        db.set_trade_rule_status(self.t2, self.rule["id"], False)

    def test_loeschen_entfernt_bewertungen(self):
        db.delete_trade(self.t2)
        stats = db.strategy_rule_stats(self.strategy["id"])[0]
        self.assertEqual(stats["answered"], 1)
        self.assertEqual(stats["compliance_pct"], 100)

    def test_regel_einhaltung_je_trade(self):
        self.assertEqual(db.trade_rule_compliance(), {self.t1: True, self.t2: False})

    def test_archivierte_regel_zaehlt_nicht(self):
        db.update_rule(self.rule["id"], archived=True)
        self.assertEqual(db.trade_rule_compliance(), {})


class Mt5KeyTest(unittest.TestCase):
    def setUp(self):
        temp_db()

    def test_alt_geloeschter_trade_kommt_nicht_zurueck(self):
        # Vor dem Login im Schluessel geloescht -> Fingerprint im alten Format
        with db.get_conn() as conn:
            conn.execute("INSERT INTO deleted_trade_keys VALUES ('mt5:11:22', 'mt5:11:33')")
        trade = make_trade(1, entry_order_id="mt5:999:11:22", exit_order_id="mt5:999:11:33", source="mt5")
        self.assertEqual(db.insert_trades([trade], skip_deleted=True), 0)
        self.assertEqual(db.insert_trades([trade], skip_deleted=False), 1)

    def test_migration_schreibt_bestandsschluessel_um(self):
        account_id = db.add_account("FTMO", "mt5", "999", "pw", "srv")
        insert([make_trade(1, entry_order_id="mt5:11:22", exit_order_id="mt5:11:33", source="mt5")],
               account_id=account_id)
        with db.get_conn() as conn:
            conn.execute(db.MIGRATIONS[39])
            conn.execute(db.MIGRATIONS[39])  # zweimal ausgefuehrt darf nichts doppelt umschreiben
            row = conn.execute("SELECT entry_order_id, exit_order_id FROM trades").fetchone()
        self.assertEqual(tuple(row), ("mt5:999:11:22", "mt5:999:11:33"))
        # Neuer Sync liefert denselben Trade im neuen Format -> keine Dublette
        again = make_trade(1, entry_order_id="mt5:999:11:22", exit_order_id="mt5:999:11:33", source="mt5")
        self.assertEqual(db.insert_trades([again], account_id=account_id), 0)


class PropLimitTest(unittest.TestCase):
    def setUp(self):
        temp_db()

    def test_auslastung(self):
        from datetime import date
        from app.stats import prop_limit_status

        account_id = db.add_account("FTMO 10k", "mt5", "1", "pw", "srv", starting_balance=10000)
        db.set_account_limits(account_id, 500, 1000)
        today = date.today().isoformat()
        insert([make_trade(1, day="2026-01-05", net=-600), make_trade(2, day=today, net=-400)], account_id=account_id)
        status = prop_limit_status(None)[0]
        self.assertEqual(status["daily"]["used"], 400)
        self.assertEqual(status["daily"]["pct"], 80)
        self.assertEqual(status["max"]["used"], 1000)
        self.assertEqual(status["max"]["remaining"], 0)
        self.assertEqual(prop_limit_status(["999"]), [])


if __name__ == "__main__":
    unittest.main()
