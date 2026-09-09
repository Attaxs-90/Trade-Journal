// TradeJournalSync - NinjaScript-AddOn fuer Trade Journal (automatischer Sync).
//
// EINRICHTUNG (einmalig):
//   1. NinjaTrader 8 -> Werkzeuge -> NinjaScript-Editor -> Rechtsklick auf "AddOns" ->
//      Neu -> "AddOn" -> Namen vergeben (z.B. "TradeJournalSync") -> den Inhalt dieser
//      Datei komplett in den generierten Code einfuegen (die ersten Zeilen mit den
//      using-Anweisungen und der Klasse bleiben, nur den Koerper ersetzen/anpassen).
//   2. Compile (F5 oder das Hammer-Symbol). Bei Fehlern: NinjaTrader-Versionen koennen
//      an einzelnen Stellen (Property-/Enum-Namen) leicht abweichen - im
//      NinjaScript-Editor zeigt die Fehlermeldung die betroffene Zeile, im
//      Autovervollstaendigen (Strg+Leertaste) findet sich meist der aktuelle Name.
//   3. NinjaTrader neu starten, damit die AddOn aktiv wird.
//   4. Den Pfad aus SyncFilePath (siehe unten, Standard:
//      Dokumente\NinjaTrader 8\trade-journal-sync\executions.csv) im Trade-Journal
//      unter Konten -> "Pfad zur Sync-Datei" beim NinjaTrader-Konto eintragen.
//
// WAS DIE ADDON TUT:
//   Haengt bei jeder Order-Ausfuehrung (Fill) eine Zeile im selben Spaltenformat wie
//   NinjaTraders manueller Executions-Export an eine feste CSV-Datei an. Das Trade
//   Journal liest diese Datei beim Sync ein (app/brokers/ninjatrader_adapter.py) und
//   nutzt dafuer denselben Parser wie fuer den manuellen CSV-Import (app/parser.py) -
//   deshalb exakt dieses Spaltenformat, nicht eigenes.
//
// GRENZEN (siehe auch CLAUDE.md-Erklaerung im Chat):
//   - Nur Konten, die beim NinjaTrader-Start schon verbunden sind, werden erfasst.
//     Ein Konto, das erst danach neu verbunden wird, braucht einen NinjaTrader-Neustart.
//   - Die Zuordnung Entry/Exit (Spalte E/X) wird hier selbst aus der Positionsgroesse
//     vor/nach dem Fill hergeleitet (siehe UpdatePositionAndClassify) statt einer
//     NinjaScript-eigenen Entry/Exit-Kennung - bei einem einzelnen Fill, der eine
//     Position gleichzeitig schliesst UND in die Gegenrichtung neu eroeffnet
//     (Ein-Klick-Reversal mit groesserer Menge als offen), wird nur eine Seite davon
//     korrekt erkannt. Bei ATM-Strategien (Entry/Stop1/Target1 je eigener Order) tritt
//     das nicht auf.

#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class TradeJournalSync : AddOnBase
    {
        // Anpassen, falls die Sync-Datei an einem anderen Ort liegen soll - derselbe
        // Pfad muss dann im Trade Journal beim Konto hinterlegt werden.
        private static readonly string SyncFilePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "NinjaTrader 8", "trade-journal-sync", "executions.csv");

        private const string Header =
            "Instrument;Action;Quantity;Price;Time;ID;E/X;Position;Order ID;Name;Commission;Rate;Account display name;Connection;";

        // Laufende Positionsgroesse je Konto+Instrument (vorzeichenbehaftet: long positiv,
        // short negativ) - Grundlage fuer die Entry/Exit-Klassifizierung, siehe oben.
        private readonly Dictionary<string, int> _positions = new Dictionary<string, int>();
        private readonly object _fileLock = new object();

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "TradeJournalSync";
            }
            else if (State == State.Active)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(SyncFilePath));
                if (!File.Exists(SyncFilePath))
                    File.WriteAllText(SyncFilePath, Header + Environment.NewLine, new UTF8Encoding(true));

                foreach (Account account in Account.All)
                    account.ExecutionUpdate += OnExecutionUpdate;
            }
            else if (State == State.Terminated)
            {
                foreach (Account account in Account.All)
                    account.ExecutionUpdate -= OnExecutionUpdate;
            }
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            Execution execution = e.Execution;
            if (execution == null || execution.Order == null)
                return;

            try
            {
                AppendRow(execution);
            }
            catch (Exception ex)
            {
                NinjaTrader.NinjaScript.NinjaScript.Log(
                    "TradeJournalSync: Fehler beim Schreiben der Sync-Datei: " + ex.Message,
                    NinjaTrader.Cbi.LogLevel.Error);
            }
        }

        private void AppendRow(Execution execution)
        {
            string instrument = execution.Instrument.FullName;
            string accountName = execution.Account.Name;
            string action = execution.Order.OrderAction.ToString();  // Buy/Sell/SellShort/BuyToCover
            int qty = execution.Quantity;
            double price = execution.Price;

            int delta = (action == "Buy" || action == "BuyToCover") ? qty : -qty;
            string entryExit = ClassifyEntryExit(accountName, instrument, delta);

            string row = string.Join(";", new[]
            {
                instrument,
                action,
                qty.ToString(CultureInfo.InvariantCulture),
                price.ToString(CultureInfo.InvariantCulture),
                execution.Time.ToString("ddMMyyyy HH:mm:ss", CultureInfo.InvariantCulture),
                execution.ExecutionId,
                entryExit,
                "-",  // "Position"-Spalte wird vom Trade-Journal-Parser nicht gelesen
                execution.Order.Id.ToString(CultureInfo.InvariantCulture),
                execution.Order.Name ?? "",
                execution.Commission.ToString("F2", CultureInfo.InvariantCulture) + " $",
                "1",
                accountName,
                "Sync",
            }) + ";";

            lock (_fileLock)
            {
                File.AppendAllText(SyncFilePath, row + Environment.NewLine, new UTF8Encoding(true));
            }
        }

        // Entry, wenn die Position dem Betrag nach waechst (0 -> N oder N -> N+delta in
        // dieselbe Richtung), sonst Exit. Siehe Klassenkommentar oben fuer die Grenze bei
        // einem Reversal in einem einzelnen Fill.
        private string ClassifyEntryExit(string accountName, string instrument, int delta)
        {
            string key = accountName + "|" + instrument;
            int before = _positions.TryGetValue(key, out int p) ? p : 0;
            int after = before + delta;
            _positions[key] = after;
            return Math.Abs(after) > Math.Abs(before) ? "Entry" : "Exit";
        }
    }
}
