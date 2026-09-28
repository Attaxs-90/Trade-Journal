"""Reine Rechenlogik der Auswertungen - ohne Datenbank."""
import unittest

from app import analytics as an

from .helpers import make_trade


class TradeSummaryTest(unittest.TestCase):
    def test_kennzahlen(self):
        trades = [make_trade(1, net=200), make_trade(2, net=-100), make_trade(3, net=100)]
        s = an.trade_summary(trades)
        self.assertEqual(s["trade_count"], 3)
        self.assertEqual(s["total_net"], 200)
        self.assertEqual(s["win_rate"], 66.7)
        self.assertEqual(s["profit_factor"], 3.0)
        self.assertEqual(s["avg_win"], 150)
        self.assertEqual(s["avg_loss"], 100)

    def test_r_nur_ueber_trades_mit_risiko(self):
        trades = [make_trade(1, net=200, risk=100), make_trade(2, net=-100, risk=100), make_trade(3, net=500)]
        s = an.trade_summary(trades)
        self.assertEqual(s["r_trade_count"], 2)
        self.assertEqual(s["avg_r"], 0.5)
        self.assertEqual(s["total_r"], 1.0)

    def test_ohne_risiko_kein_r(self):
        s = an.trade_summary([make_trade(1, net=50)])
        self.assertIsNone(s["avg_r"])
        self.assertEqual(an.trade_summary([])["r_trade_count"], 0)


class EquityTest(unittest.TestCase):
    def test_drawdown_und_serien(self):
        days = [
            {"day": "2026-09-01", "net_usd": 100},
            {"day": "2026-09-02", "net_usd": -300},
            {"day": "2026-09-03", "net_usd": 50},
            {"day": "2026-09-04", "net_usd": 400},
        ]
        e = an.equity_and_drawdown(days, 1000)
        self.assertEqual(e["curve"][0]["cum_net"], 1100)
        self.assertEqual(e["max_drawdown"], 300)
        self.assertEqual(e["max_drawdown_day"], "2026-09-02")
        self.assertEqual(e["longest_win_streak"], 2)
        self.assertEqual(e["end_balance"], 1250)


class DistributionTest(unittest.TestCase):
    def test_r_verteilung(self):
        trades = [make_trade(1, net=200, risk=100), make_trade(2, net=-100, risk=100), make_trade(3, net=500)]
        d = an.pnl_distribution(trades, bins=4, metric="r")
        self.assertEqual(d["metric"], "r")
        self.assertEqual(d["trade_count"], 2)
        self.assertEqual(sum(b["count"] for b in d["bins"]), 2)
        self.assertEqual(d["largest_win"], 2.0)


if __name__ == "__main__":
    unittest.main()
