"""OneNote-Aufbau: Seitenbaum des Tagebuchs, Standardvorlagen, Import-Zuordnung."""
import unittest
import xml.etree.ElementTree as ET

from app import db, diary
from app import onenote_import as oi

from .helpers import insert, make_trade, temp_db


class DiaryMonthTest(unittest.TestCase):
    def setUp(self):
        temp_db()
        insert([
            make_trade(1, day="2026-09-28", net=-100, risk=50),   # KW 40 -> Oktober
            make_trade(2, day="2026-09-28", net=50),               # ohne Risiko
            make_trade(3, day="2026-10-05", net=200, risk=100),
            make_trade(4, day="2026-09-21", net=10, risk=10),      # KW 39 -> September
        ])

    def test_kw_gehoert_zum_monat_ihres_donnerstags(self):
        m = diary.build_month(2026, 10)
        self.assertEqual(m["weeks"][0]["ref"], "2026-W40")
        self.assertEqual(m["weeks"][0]["days"][0]["date"], "2026-09-28")
        self.assertNotIn("2026-W39", [w["ref"] for w in m["weeks"]])

    def test_ergebnisse_in_dollar_und_r(self):
        m = diary.build_month(2026, 10)
        day = m["weeks"][0]["days"][0]
        self.assertEqual(day["stats"]["net"], -50.0)
        self.assertEqual(day["stats"]["r"], -2.0)            # nur der Trade mit Risiko
        self.assertFalse(day["stats"]["r_complete"])
        self.assertEqual(m["stats"]["trades"], 3)
        self.assertEqual(m["weeks"][1]["days"][0]["cum"]["net"], 150.0)

    def test_wochenende_nur_mit_inhalt(self):
        m = diary.build_month(2026, 10)
        self.assertEqual([d["weekday"] for d in m["weeks"][0]["days"]], ["Mo", "Di", "Mi", "Do", "Fr"])
        db.upsert_journal_entry("day", "2026-10-03", title="Wochenende", content_html="<p>x</p>", plain_text="x")
        m = diary.build_month(2026, 10)
        self.assertIn("Sa", [d["weekday"] for d in m["weeks"][0]["days"]])

    def test_abschnitte_rechnen_wie_seitenliste(self):
        sections = {s["month"]: s for s in diary.build_sections()["months"]}
        self.assertEqual(sections["2026-10"]["net"], diary.build_month(2026, 10)["stats"]["net"])
        self.assertEqual(sections["2026-09"]["net"], 10.0)

    def test_seitentitel_und_eintrag_in_der_liste(self):
        db.upsert_journal_entry("week", "2026-W40", title="RETRACEMENT", content_html="<p>Woche</p>", plain_text="Woche")
        m = diary.build_month(2026, 10)
        self.assertEqual(m["weeks"][0]["title"], "RETRACEMENT")
        self.assertTrue(m["weeks"][0]["has_entry"])


class TemplateDefaultTest(unittest.TestCase):
    def setUp(self):
        temp_db()

    def test_leitfragen_sind_standard(self):
        defaults = {t["default_for"]: t for t in db.list_journal_templates() if t["default_for"]}
        self.assertEqual(set(defaults), {"day", "week", "month", "review"})
        self.assertIn("Mein Ziel:", defaults["day"]["content_html"])

    def test_nur_eine_standardvorlage_je_seitenart(self):
        new_id = db.add_journal_template("Neu", "<p>x</p>", default_for="day")
        days = [t["id"] for t in db.list_journal_templates() if t["default_for"] == "day"]
        self.assertEqual(days, [new_id])


NS = 'xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote"'


class OneNoteImportTest(unittest.TestCase):
    def test_zuordnung_der_seiten(self):
        ctx = (2026, 10)
        self.assertEqual(oi.classify("22.09 -1R (0R)", (2026, 9)), ("day", "2026-09-22", "-1R (0R)"))
        self.assertEqual(oi.classify("02.10 - kein Trade -NFP", ctx), ("day", "2026-10-02", "kein Trade -NFP"))
        self.assertEqual(oi.classify("Kein Trade - 15.08", (2024, 8)), ("day", "2024-08-15", "Kein Trade"))
        self.assertEqual(oi.classify("29.12 -1R", (2026, 1)), ("day", "2025-12-29", "-1R"))
        self.assertEqual(oi.classify("KW 40", ctx), ("week", "2026-W40", ""))
        self.assertEqual(oi.classify("KW 1", (2026, 1)), ("week", "2026-W01", ""))
        self.assertEqual(oi.classify("Oktober +1R", ctx), ("month", "2026-10", "+1R"))
        self.assertEqual(oi.classify("Review", ctx), ("review", "2026-10", ""))
        self.assertIsNone(oi.classify("FTMO", ctx))
        self.assertIsNone(oi.classify("22.09", None))

    def test_monatsabschnitt_erkennen(self):
        path = [dict(name="2. Tagebuch"), dict(name="3. 2026"), dict(name="Quartal 4"), dict(name="27. Oktober")]
        self.assertEqual(oi.diary_context(path), (2026, 10))
        path = [dict(name="2. Tagebuch"), dict(name="2. 2025"), dict(name="10. Mai ^M $121^J--")]
        self.assertEqual(oi.diary_context(path), (2025, 5))
        self.assertIsNone(oi.diary_context([dict(name="1. Edge"), dict(name="Playbook")]))
        self.assertIsNone(oi.diary_context([dict(name="2. 2025"), dict(name="2025")]))

    def test_sensible_bereiche(self):
        for name in ("4. Accounts", "5. Gewerbe", "7. Privat", "Logins"):
            self.assertTrue(oi.is_sensitive(name), name)
        self.assertFalse(oi.is_sensitive("1. Edge"))

    def test_inhalt_und_leere_vorlagen(self):
        page = ET.fromstring(f"""<one:Page {NS} name="x">
          <one:Outline><one:Position x="36" y="86"/><one:OEChildren>
            <one:OE><one:T><![CDATA[Mein Ziel:]]></one:T>
              <one:OEChildren><one:OE><one:List><one:Bullet bullet="2"/></one:List><one:T><![CDATA[<span style='font-weight:bold'>Nur LOC</span>]]></one:T></one:OE></one:OEChildren>
            </one:OE>
            <one:OE><one:Table><one:Row><one:Cell><one:OEChildren><one:OE><one:T><![CDATA[Datum]]></one:T></one:OE></one:OEChildren></one:Cell>
              <one:Cell><one:OEChildren><one:OE><one:T><![CDATA[W]]></one:T></one:OE></one:OEChildren></one:Cell></one:Row></one:Table></one:OE>
          </one:OEChildren></one:Outline></one:Page>""")
        conv = oi.PageConverter("t", save_images=False)
        out = conv.convert(page)
        self.assertIn('<li data-list="bullet" class="ql-indent-1"><span style=\'font-weight:bold\'>Nur LOC</span></li>', out)
        self.assertIn("<p><strong>Datum | W</strong></p>", out)
        self.assertFalse(conv.is_empty("x"))

        empty = ET.fromstring(f"""<one:Page {NS}><one:Outline><one:OEChildren>
            <one:OE><one:T><![CDATA[Mein Ziel:]]></one:T></one:OE>
            <one:OE><one:T><![CDATA[Wie war der Tag bisher?]]></one:T></one:OE>
          </one:OEChildren></one:Outline></one:Page>""")
        conv = oi.PageConverter("t", save_images=False)
        conv.convert(empty)
        self.assertTrue(conv.is_empty("Mein Ziel:"))

    def test_import_haengt_an_bestehenden_eintrag_an(self):
        temp_db()
        db.upsert_journal_entry("day", "2026-10-01", title="", content_html="<p>App</p>", plain_text="App")
        with db.get_conn() as conn:
            self.assertEqual(oi._save_journal(conn, "day", "2026-10-01", "+1R", "<p>ON</p>", "ON", "{p1}"), "merged")
            self.assertTrue(oi._already(conn, "journal_entries", "{p1}"))
        e = db.get_journal_entry("day", "2026-10-01")
        self.assertIn("<p>App</p>", e["content_html"])
        self.assertIn("<p>ON</p>", e["content_html"])
        self.assertEqual(e["title"], "+1R")


if __name__ == "__main__":
    unittest.main()
