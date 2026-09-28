"""MT5-Adapter mit einem nachgebauten MetaTrader5-Modul - kein Terminal noetig."""
import unittest
from types import SimpleNamespace

from app.brokers import mt5_adapter


class FakeMt5:
    DEAL_TYPE_BUY, DEAL_TYPE_SELL = 0, 1
    DEAL_ENTRY_IN, DEAL_ENTRY_OUT = 0, 1

    def __init__(self, by_position):
        self.by_position = by_position
        self.position_queries = []

    def history_deals_get(self, position):
        self.position_queries.append(position)
        return self.by_position.get(position, [])


def deal(ticket, position, entry, volume=1.0):
    return SimpleNamespace(ticket=ticket, position_id=position, type=0, entry=entry, volume=volume)


class FillIncompleteTest(unittest.TestCase):
    def test_nur_unvollstaendige_positionen_nachladen(self):
        fake = FakeMt5({2: [deal(21, 2, 0), deal(22, 2, 1)], 3: [deal(30, 3, 0), deal(31, 3, 1)]})
        original = mt5_adapter.mt5
        mt5_adapter.mt5 = fake
        try:
            deals = [
                deal(11, 1, 0), deal(12, 1, 1),   # vollstaendig
                deal(21, 2, 0),                   # Exit fehlt
                deal(31, 3, 1),                   # Entry lag vor dem Fenster
                deal(41, 4, 0, 2.0), deal(42, 4, 1, 1.0),  # nur teilweise geschlossen
            ]
            result = mt5_adapter._fill_incomplete_positions(deals)
        finally:
            mt5_adapter.mt5 = original
        self.assertEqual(sorted(fake.position_queries), [2, 3, 4])
        self.assertEqual({d.ticket for d in result}, {11, 12, 21, 22, 30, 31, 41, 42})


if __name__ == "__main__":
    unittest.main()
