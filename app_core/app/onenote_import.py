"""Einmaliger, rein lesender Import aus dem installierten OneNote (Desktop, Office).

OneNote wird ausschliesslich ueber die COM-Lesemethoden GetHierarchy und
GetPageContent angesprochen (per PowerShell, damit kein pywin32 noetig ist) -
es wird nie etwas nach OneNote zurueckgeschrieben.

Zuordnung (passend zum Tagebuch-Aufbau des Nutzers Jahr -> Quartal -> Monat ->
KW -> Tag):
- Seiten in einem Monats-Abschnitt eines Jahres-Abschnittsgruppe
  ("3. 2026" / "27. Oktober") werden Tagebuch-Eintraege: "22.09 -1R" -> Tag,
  "KW 40" -> Woche, "Oktober" / "Ziele November" -> Monat, "Review" -> Review.
  Der Rest des OneNote-Titels ("-1R (0R)", "Kein Trade - NFP") wird der
  Seitentitel.
- Alles andere wird als Notizbuch mit derselben Ordnerstruktur, Reihenfolge
  und Abschnittsfarbe angelegt.

Wiederholbar: jede importierte Seite traegt ihre OneNote-Seiten-ID in
source_key und wird beim naechsten Lauf uebersprungen."""
import base64
import html
import logging
import re
import shutil
import subprocess
import tempfile
import threading
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

from . import backup, db
from .images import save_image

log = logging.getLogger(__name__)

NS = {"one": "http://schemas.microsoft.com/office/onenote/2013/onenote"}
Q = "{http://schemas.microsoft.com/office/onenote/2013/onenote}"

MONTHS = {
    "januar": 1, "jänner": 1, "februar": 2, "märz": 3, "maerz": 3, "april": 4, "mai": 5, "juni": 6,
    "juli": 7, "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12,
}
# Abschnittsgruppen/Abschnitte mit diesen Namensteilen sind standardmaessig
# abgewaehlt (Zugangsdaten, 2FA, Geschaeftsunterlagen).
SENSITIVE_HINTS = ("account", "gewerbe", "privat", "login", "2fa", "passw", "daten")
# Leitfragen der leeren OneNote-Vorlagenseiten - eine Seite, die ausser diesen
# nichts enthaelt, ist eine unbenutzte Vorlage und wird nicht importiert.
TEMPLATE_LINES = {
    "mein ziel:", "was mache ich um mein ziel zu erreichen?", "was mache ich, um mein ziel zu erreichen?",
    "wie war der tag bisher?", "was hätte ich besser machen können?", "was habe ich richtig gut gemacht?",
    "was möchte ich näcshte woche erreichen?", "was möchte ich nächste woche erreichen?",
    "positiv:", "negativ:", "verbesserungen:", "dies waren meine besten setups:", "review",
}

RE_DAY = re.compile(r"^\s*(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2}(?!\d))?")
RE_DAY_TAIL = re.compile(r"[-–\s]*(\d{1,2})\.(\d{1,2})\.?\s*$")
RE_WEEK = re.compile(r"^\s*KW\s*(\d{1,2})\b", re.I)
RE_YEAR_GROUP = re.compile(r"^(?:\d+\.\s*)?(20\d{2})$")
RE_LEADING_NUM = re.compile(r"^\d+\.\s*")

PS_SCRIPT = r"""
param([string]$OutDir, [string]$Mode)
$ErrorActionPreference = 'Stop'
$on = New-Object -ComObject OneNote.Application
if ($Mode -eq 'hierarchy') {
  $h = ''
  $on.GetHierarchy('', 4, [ref]$h)
  [IO.File]::WriteAllText((Join-Path $OutDir 'hierarchy.xml'), $h)
  exit 0
}
$ids = [IO.File]::ReadAllLines((Join-Path $OutDir 'pages.txt'))
$i = 0
foreach ($id in $ids) {
  $i++
  $c = ''
  try {
    $on.GetPageContent($id, [ref]$c, 1)
    [IO.File]::WriteAllText((Join-Path $OutDir "p$i.xml"), $c)
    [Console]::Out.WriteLine("OK $i")
  } catch {
    [Console]::Out.WriteLine("ERR $i")
  }
}
"""

_lock = threading.Lock()
_status: dict = {"running": False, "phase": "idle", "done": 0, "total": 0, "result": None, "error": None}


def status() -> dict:
    with _lock:
        return dict(_status)


def _set(**kw):
    with _lock:
        _status.update(kw)


# ---------- OneNote lesen (PowerShell/COM) ----------

def _run_ps(work: Path, mode: str, on_line=None):
    script = work / "export.ps1"
    script.write_text(PS_SCRIPT, encoding="utf-8-sig")
    proc = subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(script), "-OutDir", str(work), "-Mode", mode],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    for line in proc.stdout:
        if on_line:
            on_line(line.strip())
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise RuntimeError("OneNote konnte nicht gelesen werden. Ist OneNote (Desktop) installiert? "
                           + err.strip()[:300])


def read_hierarchy(work: Path) -> ET.Element:
    _run_ps(work, "hierarchy")
    return ET.fromstring((work / "hierarchy.xml").read_text(encoding="utf-8"))


def walk_pages(root: ET.Element):
    """Liefert (pfad, page) fuer jede Seite ausserhalb des Papierkorbs.
    pfad = Liste von dicts {id, name, kind, color} vom Notizbuch-Kind bis zum Abschnitt."""
    def rec(node, path):
        for child in node:
            tag = child.tag.replace(Q, "")
            if tag == "SectionGroup":
                if child.get("isRecycleBin") == "true":
                    continue
                yield from rec(child, path + [dict(id=child.get("ID"), name=child.get("name", ""),
                                                   kind="group", color=None)])
            elif tag == "Section":
                if child.get("isInRecycleBin") == "true":
                    continue
                sec = dict(id=child.get("ID"), name=child.get("name", ""), kind="section",
                           color=child.get("color") if child.get("color", "none") != "none" else None)
                for page in child.findall("one:Page", NS):
                    if page.get("isInRecycleBin") == "true":
                        continue
                    yield path + [sec], page
    for nb in root.findall("one:Notebook", NS):
        yield from rec(nb, [])


def is_sensitive(name: str) -> bool:
    low = name.lower()
    return any(h in low for h in SENSITIVE_HINTS)


def structure() -> dict:
    """Oberste Ebene des Notizbuchs mit Seitenzahlen - fuer die Auswahl im
    Einstellungsdialog. Sensible Bereiche sind vorab abgewaehlt."""
    work = Path(tempfile.mkdtemp(prefix="onenote_"))
    try:
        root = read_hierarchy(work)
        counts: dict[str, dict] = {}
        for path, _page in walk_pages(root):
            top = path[0]
            c = counts.setdefault(top["name"], dict(name=top["name"], pages=0, selected=not is_sensitive(top["name"])))
            c["pages"] += 1
        return {"groups": list(counts.values())}
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------- Zuordnung ----------

def _strip_title_rest(rest: str) -> str:
    rest = rest.strip()
    # "- Kein Trade" -> "Kein Trade"; ein "-1R" (negatives Ergebnis) bleibt stehen.
    rest = re.sub(r"^[-–]\s+", "", rest)
    return rest.strip()


def diary_context(path: list[dict]) -> tuple[int, int] | None:
    """(jahr, monat) wenn die Seite in einem Monats-Abschnitt eines Jahres liegt."""
    year = None
    for p in path[:-1]:
        m = RE_YEAR_GROUP.match(p["name"].strip())
        if m:
            year = int(m.group(1))
    if year is None:
        return None
    sec = RE_LEADING_NUM.sub("", path[-1]["name"].strip())
    word = re.match(r"([A-Za-zÄÖÜäöüß]+)", sec)
    if not word or word.group(1).lower() not in MONTHS:
        return None
    return year, MONTHS[word.group(1).lower()]


def classify(title: str, ctx: tuple[int, int] | None) -> tuple[str, str, str] | None:
    """(entry_type, ref_key, seitentitel) oder None (-> Notizbuch)."""
    if not ctx:
        return None
    year, month = ctx
    t = title.strip()
    m = RE_DAY.match(t)
    tail = None if m else RE_DAY_TAIL.search(t)
    if m or tail:
        if tail:
            d, mo = int(tail.group(1)), int(tail.group(2))
            rest = t[:tail.start()]
        else:
            d, mo = int(m.group(1)), int(m.group(2))
            rest = t[m.end():]
        if m and m.group(3):
            y = int(m.group(3))
            y = y + 2000 if y < 100 else y
        else:
            y = year - 1 if (month == 1 and mo == 12) else year + 1 if (month == 12 and mo == 1) else year
        try:
            day = date(y, mo, d)
        except ValueError:
            return None
        return "day", str(day), _strip_title_rest(rest)
    m = RE_WEEK.match(t)
    if m:
        w = int(m.group(1))
        y = year - 1 if (month == 1 and w >= 52) else year + 1 if (month == 12 and w == 1) else year
        try:
            date.fromisocalendar(y, w, 1)
        except ValueError:
            return None
        return "week", f"{y:04d}-W{w:02d}", _strip_title_rest(t[m.end():])
    low = t.lower()
    if low.startswith("review") or low.startswith("zusammenfassung"):
        return "review", f"{year:04d}-{month:02d}", ""
    word = re.match(r"(?:ziele?\s+)?([A-Za-zÄÖÜäöüß]+)", t, re.I)
    if word and MONTHS.get(word.group(1).lower()) == month:
        return "month", f"{year:04d}-{month:02d}", _strip_title_rest(t[word.end():])
    return None


# ---------- Seiteninhalt -> HTML ----------

def _text(el) -> str:
    return el.text or ""


def _clean_inline(raw: str) -> str:
    """OneNote liefert Text als HTML-Fragment (spans mit style). lang-Attribute
    und leere Spans stoeren nicht; nur Skript-artiges wird entfernt."""
    raw = re.sub(r"<\s*/?\s*(script|style|iframe)[^>]*>", "", raw, flags=re.I)
    raw = re.sub(r"\son\w+\s*=\s*(['\"]).*?\1", "", raw, flags=re.I)
    return raw


def _plain(raw: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", raw)).replace("\xa0", " ").strip()


class PageConverter:
    def __init__(self, image_hint: str, save_images: bool = True):
        self.image_hint = image_hint
        self.save_images = save_images
        self.images = 0
        self.lines: list[str] = []      # Klartext fuer Suche/Leer-Pruefung
        self.todo_tags: set[str] = set()

    def image_html(self, img: ET.Element) -> str:
        data = img.find("one:Data", NS)
        if data is None or not (data.text or "").strip():
            return ""
        if not self.save_images:
            self.images += 1
            return '<p><img src="/media/test.webp"></p>'
        try:
            raw = base64.b64decode(data.text)
            filename, _thumb = save_image(raw, self.image_hint)
        except Exception:
            log.warning("OneNote-Bild konnte nicht gespeichert werden", exc_info=True)
            return ""
        self.images += 1
        size = img.find("one:Size", NS)
        width = ""
        if size is not None and size.get("width"):
            try:
                width = f' width="{min(int(float(size.get("width")) * 4 / 3), 1100)}"'
            except ValueError:
                pass
        return f'<p><img src="/media/{filename}"{width}></p>'

    def oe(self, oe: ET.Element, depth: int, out: list[str]):
        parts = []
        prefix = ""
        for tag in oe.findall("one:Tag", NS):
            if tag.get("index") in self.todo_tags or tag.get("completed") is not None:
                prefix = "☑ " if tag.get("completed") == "true" else "☐ "
        texts = [_clean_inline(_text(t)) for t in oe.findall("one:T", NS)]
        body = "".join(texts).strip()
        plain = _plain(body)
        if plain:
            self.lines.append(plain)
        lst = oe.find("one:List", NS)
        indent = f' class="ql-indent-{min(depth, 8)}"' if depth else ""
        if body:
            if lst is not None:
                kind = "ordered" if lst.find("one:Number", NS) is not None else "bullet"
                parts.append(("li", kind, f"<li data-list=\"{kind}\"{indent}>{prefix}{body}</li>"))
            else:
                parts.append(("p", None, f"<p{indent}>{prefix}{body}</p>"))
        for img in oe.findall("one:Image", NS):
            h = self.image_html(img)
            if h:
                parts.append(("p", None, h))
        table = oe.find("one:Table", NS)
        if table is not None:
            for ri, row in enumerate(table.findall("one:Row", NS)):
                cells = []
                for cell in row.findall("one:Cell", NS):
                    cell_txt = " ".join(_plain(_text(t)) for t in cell.iter(Q + "T")).strip()
                    cells.append(html.escape(cell_txt))
                line = " | ".join(cells)
                if line.strip(" |"):
                    self.lines.append(line)
                    parts.append(("p", None, f"<p><strong>{line}</strong></p>" if ri == 0 else f"<p>{line}</p>"))
        for p in parts:
            out.append(p)
        children = oe.find("one:OEChildren", NS)
        if children is not None:
            for child in children.findall("one:OE", NS):
                self.oe(child, depth + 1, out)

    def convert(self, page: ET.Element) -> str:
        for td in page.findall("one:TagDef", NS):
            # type 0..: Aufgaben-Kontrollkaestchen haben ein Symbol < 30 im
            # Standardsatz; zusaetzlich zaehlt jedes Tag mit completed-Attribut.
            if "aufgabe" in td.get("name", "").lower() or "to do" in td.get("name", "").lower():
                self.todo_tags.add(td.get("index"))
        blocks = []
        for child in page:
            tag = child.tag.replace(Q, "")
            pos = child.find("one:Position", NS)
            y = float(pos.get("y", 0)) if pos is not None else 0.0
            x = float(pos.get("x", 0)) if pos is not None else 0.0
            if tag == "Outline":
                out: list = []
                for oe in child.findall("one:OEChildren/one:OE", NS):
                    self.oe(oe, 0, out)
                blocks.append((y, x, out))
            elif tag == "Image":
                h = self.image_html(child)
                if h:
                    blocks.append((y, x, [("p", None, h)]))
        blocks.sort(key=lambda b: (b[0], b[1]))
        html_parts = []
        for _y, _x, items in blocks:
            open_list = False
            for kind, _sub, frag in items:
                if kind == "li":
                    if not open_list:
                        html_parts.append("<ol>")
                        open_list = True
                    html_parts.append(frag)
                else:
                    if open_list:
                        html_parts.append("</ol>")
                        open_list = False
                    html_parts.append(frag)
            if open_list:
                html_parts.append("</ol>")
        return "".join(html_parts)

    def plain_text(self) -> str:
        return "\n".join(self.lines)

    def is_empty(self, title: str) -> bool:
        if self.images:
            return False
        rest = [ln for ln in self.lines if ln.strip().lower() not in TEMPLATE_LINES and ln.strip() != title.strip()]
        return not any(ln.strip() for ln in rest)


# ---------- Schreiben in die Datenbank ----------

def _already(conn, table: str, page_id: str) -> bool:
    return conn.execute(f"SELECT 1 FROM {table} WHERE instr(source_key, ?) > 0 LIMIT 1", (page_id,)).fetchone() is not None


def _folder(conn, path: list[dict], cache: dict, positions: dict) -> int | None:
    parent = None
    for p in path:
        key = "onenote:" + p["id"]
        if key in cache:
            parent = cache[key]
            continue
        row = conn.execute("SELECT id FROM notebook_nodes WHERE source_key = ?", (key,)).fetchone()
        if row:
            node_id = row["id"]
        else:
            now = datetime.now().isoformat(timespec="seconds")
            pos = positions.get(parent, 0) + 1
            positions[parent] = pos
            node_id = conn.execute(
                """INSERT INTO notebook_nodes (parent_id, node_type, name, created_at, updated_at, position, color, source_key)
                   VALUES (?, 'folder', ?, ?, ?, ?, ?, ?)""",
                (parent, p["name"], now, now, pos, p["color"], key),
            ).lastrowid
        cache[key] = node_id
        parent = node_id
    return parent


def _save_journal(conn, entry_type, ref_key, title, content, plain, page_id) -> str:
    row = conn.execute(
        "SELECT id, title, content_html, plain_text, source_key FROM journal_entries WHERE entry_type = ? AND ref_key = ?",
        (entry_type, ref_key),
    ).fetchone()
    now = datetime.now().isoformat(timespec="seconds")
    if row is None:
        conn.execute(
            """INSERT INTO journal_entries (entry_type, ref_key, title, content_html, plain_text, created_at, updated_at, source_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (entry_type, ref_key, title, content, plain, now, now, page_id),
        )
        return "created"
    # Vorhandenen Eintrag nie ueberschreiben - OneNote-Inhalt unten anhaengen.
    sep = '<p><br></p><p><em>Aus OneNote importiert:</em></p>' if (row["content_html"] or "").strip() else ""
    conn.execute(
        """UPDATE journal_entries SET title = ?, content_html = ?, plain_text = ?, updated_at = ?, source_key = ?
           WHERE id = ?""",
        (row["title"] or title, (row["content_html"] or "") + sep + content,
         ((row["plain_text"] or "") + "\n" + plain).strip(), now,
         ((row["source_key"] or "") + " " + page_id).strip(), row["id"]),
    )
    return "merged"


def run_import(selected_groups: list[str] | None = None) -> dict:
    """Kompletter Lauf: Hierarchie lesen, Seiten exportieren, zuordnen, speichern."""
    work = Path(tempfile.mkdtemp(prefix="onenote_"))
    result = dict(days=0, weeks=0, months=0, reviews=0, notes=0, merged=0, skipped_empty=0,
                  skipped_existing=0, skipped_excluded=0, images=0, errors=0)
    try:
        _set(phase="Struktur lesen", done=0, total=0)
        root = read_hierarchy(work)
        pages = []
        for path, page in walk_pages(root):
            top = path[0]["name"]
            if selected_groups is not None:
                if top not in selected_groups:
                    result["skipped_excluded"] += 1
                    continue
            elif is_sensitive(top):
                result["skipped_excluded"] += 1
                continue
            if any(is_sensitive(p["name"]) for p in path[1:]) or is_sensitive(page.get("name", "")):
                result["skipped_excluded"] += 1
                continue
            pages.append((path, page))

        with db.get_conn() as conn:
            todo = [(path, page) for path, page in pages
                    if not _already(conn, "journal_entries", page.get("ID"))
                    and not _already(conn, "notebook_nodes", page.get("ID"))]
        result["skipped_existing"] = len(pages) - len(todo)

        (work / "pages.txt").write_text("\n".join(p.get("ID") for _, p in todo), encoding="utf-8")
        _set(phase="Seiten aus OneNote lesen", done=0, total=len(todo))
        if todo:
            def progress(line):
                if line.startswith(("OK ", "ERR ")):
                    _set(done=int(line.split()[1]))
            _run_ps(work, "pages", progress)

        _set(phase="Seiten übernehmen", done=0, total=len(todo))
        folder_cache: dict = {}
        positions: dict = {}
        with db.get_conn() as conn:
            for row in conn.execute("SELECT parent_id, MAX(position) AS p FROM notebook_nodes GROUP BY parent_id"):
                positions[row["parent_id"]] = row["p"] or 0
        for i, (path, page) in enumerate(todo, start=1):
            _set(done=i)
            f = work / f"p{i}.xml"
            if not f.exists():
                result["errors"] += 1
                continue
            try:
                page_xml = ET.fromstring(f.read_text(encoding="utf-8"))
            except ET.ParseError:
                result["errors"] += 1
                continue
            title = page.get("name", "").strip() or "Ohne Titel"
            target = classify(title, diary_context(path))
            hint = f"onenote_{target[0]}_{target[1]}" if target else "onenote_notiz"
            conv = PageConverter(re.sub(r"[^\w-]", "_", hint))
            content = conv.convert(page_xml)
            if conv.is_empty(title):
                result["skipped_empty"] += 1
                continue
            result["images"] += conv.images
            with db.get_conn() as conn:
                if target:
                    entry_type, ref_key, page_title = target
                    outcome = _save_journal(conn, entry_type, ref_key, page_title, content,
                                            conv.plain_text(), page.get("ID"))
                    if outcome == "merged":
                        result["merged"] += 1
                    result[{"day": "days", "week": "weeks", "month": "months", "review": "reviews"}[entry_type]] += 1
                else:
                    parent = _folder(conn, path, folder_cache, positions)
                    pos = positions.get(parent, 0) + 1
                    positions[parent] = pos
                    now = datetime.now().isoformat(timespec="seconds")
                    conn.execute(
                        """INSERT INTO notebook_nodes (parent_id, node_type, name, content_html, plain_text,
                                                       created_at, updated_at, position, source_key)
                           VALUES (?, 'note', ?, ?, ?, ?, ?, ?, ?)""",
                        (parent, title, content, conv.plain_text(), now, now, pos, page.get("ID")),
                    )
                    result["notes"] += 1
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def start_import(selected_groups: list[str] | None = None) -> bool:
    with _lock:
        if _status["running"]:
            return False
        _status.update(running=True, phase="Sicherung", done=0, total=0, result=None, error=None)

    def worker():
        try:
            backup.run_backup()  # vorher sichern - der Import schreibt viele Eintraege
            res = run_import(selected_groups)
            _set(result=res, phase="fertig")
        except Exception as e:  # Fehler fuer die Oberflaeche festhalten
            log.exception("OneNote-Import fehlgeschlagen")
            _set(error=str(e), phase="Fehler")
        finally:
            _set(running=False)

    threading.Thread(target=worker, daemon=True, name="onenote-import").start()
    return True
