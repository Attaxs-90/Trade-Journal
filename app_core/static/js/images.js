/* Bild-Upload, Miniaturen und Lightbox. */

import { api, attachOutsideClose, state } from './core.js';
import { populateDay } from './share.js';
import { populateTrade } from './trades.js';

/* ---------- Bilder & Lightbox ---------- */

/* onDeleted (optional): Callback zum Neuladen der jeweiligen Ansicht nach dem
   Loeschen - direkter Loeschen-Button auf der Miniatur selbst, damit man
   dafuer nicht erst durch die Lightbox (Klick zum Vergroessern) muss. */
export function imageThumbEl(img, sizeClass, onDeleted) {
  const div = document.createElement("div");
  div.className = sizeClass;
  div.innerHTML = `<img src="/media/${img.thumb_filename}" alt="" loading="lazy">`;
  div.addEventListener("click", () => openLightbox(img));
  if (onDeleted) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "image-thumb-delete";
    delBtn.title = "Bild löschen";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Bild wirklich löschen?")) return;
      await api(`/api/images/${img.id}`, { method: "DELETE" });
      await onDeleted();
    });
    div.appendChild(delBtn);
  }
  return div;
}

export async function uploadImage(day, file, tradeId) {
  const fd = new FormData();
  fd.append("file", file);
  if (tradeId !== null && tradeId !== undefined) fd.append("trade_id", tradeId);
  await api(`/api/days/${day}/images`, { method: "POST", body: fd });
}

export function renderDayImages(container, day, images) {
  const strip = container.querySelector(".day-images");
  strip.innerHTML = "";
  images.filter(im => im.trade_id === null).forEach(img => {
    strip.appendChild(imageThumbEl(img, "image-thumb", () => populateDay(container, day)));
  });

  const input = container.querySelector(".day-image-input");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    await uploadImage(day, file, null);
    await populateDay(container, day);
  };
}

const LIGHTBOX_DEFAULT_SIZE = { width: 720, height: 520 };
let lightboxCurrentImage = null;
let lightboxOpenDay = null;

function getLightboxSize() {
  try {
    const saved = JSON.parse(localStorage.getItem("lightboxSize") || "null");
    if (saved && saved.width && saved.height) return saved;
  } catch (e) { /* ignore */ }
  return { ...LIGHTBOX_DEFAULT_SIZE };
}
function saveLightboxSize(size) {
  localStorage.setItem("lightboxSize", JSON.stringify(size));
}

/* Ab 2200px/3200px Fensterbreite skaliert die App per CSS-Zoom hoch (siehe
   style.css) - Chromium rendert dabei JEDEN in px geschriebenen Wert eines
   Nachfahren-Elements zusaetzlich mal diesem Zoom-Faktor (bestaetigt: 720px
   geschriebene Breite kommt bei zoom:1.15 als 828px = 720*1.15 gerendert
   zurueck). window.innerWidth/innerHeight sind davon nicht betroffen und
   zeigen weiterhin die echte Fenstergroesse. Jeder Code, der eine Zielgroesse
   in echten Bildschirm-Pixeln berechnet und dann per style.width/height/left/
   top setzt, muss deshalb durch den Zoom-Faktor teilen. */
export function currentZoom() {
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

function positionLightboxBox(size) {
  const box = document.getElementById("lightbox-box");
  // Eine gespeicherte Groesse kann von einem groesseren Monitor stammen -
  // hier immer auf das aktuelle Fenster begrenzen (gleiche Grenzen wie beim
  // manuellen Ziehen am Handle), sonst ragt die Box ueber den Bildschirm
  // hinaus und die Toolbar (Groesse speichern/Standardgroesse/Loeschen) am
  // unteren Rand wird unerreichbar. Die gespeicherte Praeferenz selbst bleibt
  // dabei unangetastet - zurueck auf dem grossen Monitor gilt sie wieder voll.
  const maxWidth = window.innerWidth * 0.96;
  const maxHeight = window.innerHeight * 0.9;
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  // top/left einmalig fest setzen (nicht ueber Flexbox zentrieren) - sonst
  // verschiebt sich der Anker waehrend des Resize-Drags mit dem Mauszeiger mit.
  const left = Math.max(10, Math.round((window.innerWidth - width) / 2));
  const top = Math.max(10, Math.round((window.innerHeight - height) / 2));
  const zoom = currentZoom();
  box.style.left = (left / zoom) + "px";
  box.style.top = (top / zoom) + "px";
  box.style.width = (width / zoom) + "px";
  box.style.height = (height / zoom) + "px";
}

function openLightbox(img) {
  lightboxCurrentImage = img;
  lightboxOpenDay = img.day || state.currentDay;

  const overlay = document.getElementById("lightbox-overlay");
  const imgEl = document.getElementById("lightbox-img");
  imgEl.src = `/media/${img.filename}`;

  positionLightboxBox(getLightboxSize());
  overlay.classList.add("visible");
}

export function closeLightbox() {
  document.getElementById("lightbox-overlay").classList.remove("visible");
  lightboxCurrentImage = null;
}

/* Eigener Resize-Griff statt natives CSS resize: waechst symmetrisch um den
   Mittelpunkt der Box, statt nur von der oben-links-Ecke aus - die gezogene
   Ecke folgt dabei exakt dem Mauszeiger, da centerX/centerY beim Start fix
   eingefroren werden und Breite/Hoehe direkt aus dem Abstand zum Zeiger
   berechnet werden (kein Nachlaufen, kein Drift). */
(function setupLightboxResize() {
  const handle = document.getElementById("lightbox-handle");
  const box = document.getElementById("lightbox-box");
  let centerX = 0, centerY = 0;

  const minWidth = 280, minHeight = 220;

  function onMove(e) {
    const maxWidth = window.innerWidth * 0.96;
    const maxHeight = window.innerHeight * 0.9;
    const width = Math.min(maxWidth, Math.max(minWidth, Math.abs(e.clientX - centerX) * 2));
    const height = Math.min(maxHeight, Math.max(minHeight, Math.abs(e.clientY - centerY) * 2));
    const zoom = currentZoom();
    box.style.width = (width / zoom) + "px";
    box.style.height = (height / zoom) + "px";
    box.style.left = ((centerX - width / 2) / zoom) + "px";
    box.style.top = ((centerY - height / 2) / zoom) + "px";
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
  }

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
attachOutsideClose(document.getElementById("lightbox-overlay"), closeLightbox);
document.getElementById("lightbox-reset").addEventListener("click", () => {
  positionLightboxBox(LIGHTBOX_DEFAULT_SIZE);
  saveLightboxSize({ ...LIGHTBOX_DEFAULT_SIZE });
});
document.getElementById("lightbox-save").addEventListener("click", (e) => {
  const box = document.getElementById("lightbox-box");
  const rect = box.getBoundingClientRect();
  saveLightboxSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.textContent = "✓ Gespeichert";
  setTimeout(() => { btn.textContent = original; }, 1200);
});
document.getElementById("lightbox-delete").addEventListener("click", async () => {
  if (!lightboxCurrentImage) return;
  if (!confirm("Bild wirklich löschen?")) return;
  await api(`/api/images/${lightboxCurrentImage.id}`, { method: "DELETE" });
  closeLightbox();
  if (document.getElementById("modal-overlay").classList.contains("visible")) {
    await populateDay(document.getElementById("modal-body"), lightboxOpenDay);
  } else if (state.view === "day" && state.currentDay) {
    await populateDay(document.getElementById("content"), state.currentDay);
  } else if (state.view === "trade" && state.currentTradeId) {
    await populateTrade(document.getElementById("content"), state.currentTradeId);
  }
});
