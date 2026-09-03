/* Inline-SVG-Diagramme (Linien-Chart mit Tooltip), ohne externe Bibliothek. */

import { fmtDate, fmtNum } from './core.js';
import { currentZoom } from './images.js';

/* ---------- Chart (inline SVG, keine externe Lib) ---------- */

export function lineChartSvg(values, labels, baseline = 0) {
  const w = 1000, h = 260, padL = 62, padR = 16, padT = 14, padB = 28;

  // Wertebereich mit Puffer statt fest bei 0 zu starten - sonst quetscht ein
  // Kontostand (z.B. 9.800-10.500) sich auf ein paar Pixel am oberen Rand
  // zusammen, waehrend der riesige ungenutzte Bereich bis 0 leer bleibt.
  // Das Startkapital fliesst mit in die Spanne ein, damit die Referenzlinie
  // immer sichtbar bleibt, auch wenn die Kurve nie in ihre Naehe kommt.
  const rawMin = Math.min(...values, baseline), rawMax = Math.max(...values, baseline);
  const span = (rawMax - rawMin) || Math.abs(rawMax) || 1;
  const pad = span * 0.15;
  const min = rawMin - pad, max = rawMax + pad;
  const range = (max - min) || 1;
  const stepX = (w - padL - padR) / (values.length - 1 || 1);

  const x = i => padL + i * stepX;
  const y = v => padT + (h - padT - padB) * (1 - (v - min) / range);

  const last = values[values.length - 1];
  const cs = getComputedStyle(document.documentElement);
  const green = cs.getPropertyValue("--green").trim();
  const red = cs.getPropertyValue("--red").trim();
  const border = cs.getPropertyValue("--border").trim();
  const faint = cs.getPropertyValue("--text-faint").trim();
  const text = cs.getPropertyValue("--text").trim();

  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const baselineY = y(baseline);
  // Flaeche zwischen Kurve und Startkapital-Linie (nicht bis zum Kartenrand) -
  // so entsteht optisch ein Gewinn-/Verlust-Band relativ zum Startkapital.
  const areaPoints = `${x(0)},${baselineY} ${points} ${x(values.length - 1)},${baselineY}`;

  // Horizontale Gitterlinien mit Werten - macht den ungefaehren Stand an
  // jeder Stelle der Kurve ablesbar, ohne jeden Punkt einzeln pruefen zu muessen.
  const GRID_LINES = 4;
  let gridSvg = "";
  for (let i = 0; i <= GRID_LINES; i++) {
    const v = min + (range * i / GRID_LINES);
    const gy = y(v);
    gridSvg += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="${border}" stroke-width="1" opacity="0.6" />`;
    gridSvg += `<text x="${padL - 8}" y="${gy + 3}" fill="${faint}" font-size="10" text-anchor="end">${fmtNum(v, 0)}</text>`;
  }

  // X-Achse: mehrere Datums-Labels statt nur Anfang/Ende, damit man den
  // Zeitpunkt eines Kurvenabschnitts grob zuordnen kann.
  const maxLabels = Math.min(6, values.length);
  let xLabelsSvg = "";
  if (values.length === 1) {
    xLabelsSvg = `<text x="${x(0)}" y="${h - 8}" fill="${faint}" font-size="10" text-anchor="middle">${labels[0]}</text>`;
  } else {
    for (let i = 0; i < maxLabels; i++) {
      const idx = Math.round(i * (values.length - 1) / (maxLabels - 1));
      const anchor = idx === 0 ? "start" : idx === values.length - 1 ? "end" : "middle";
      xLabelsSvg += `<text x="${x(idx)}" y="${h - 8}" fill="${faint}" font-size="10" text-anchor="${anchor}">${labels[idx]}</text>`;
    }
  }

  // Sichtbare Punkte, Farbe je nachdem ob ueber oder unter dem Startkapital.
  const dots = values.map((v, i) =>
    `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${v >= baseline ? green : red}" />`
  ).join("");

  // Grosse unsichtbare Trefferflaechen statt des nativen (verzoegerten,
  // winzigen) SVG-<title>-Tooltips - macht Hover sofort und leichter zu
  // treffen. Werte liegen als data-Attribute fuer attachChartTooltip() bereit.
  const hitAreas = values.map((v, i) =>
    `<circle class="chart-dot-hit" cx="${x(i)}" cy="${y(v)}" r="14" fill="transparent" data-day="${labels[i]}" data-value="${v}" data-color="${v >= baseline ? green : red}" />`
  ).join("");

  const uid = "chart" + Math.random().toString(36).slice(2, 8);

  // Kurve + Flaeche je zweimal (gruen/rot) zeichnen und per clipPath auf den
  // Bereich ueber bzw. unter der Startkapital-Linie beschraenken - so wechselt
  // die Farbe automatisch genau an der Stelle, wo die Kurve die Linie kreuzt.
  return `
  <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <clipPath id="${uid}-above"><rect x="0" y="0" width="${w}" height="${Math.max(baselineY, 0)}" /></clipPath>
      <clipPath id="${uid}-below"><rect x="0" y="${baselineY}" width="${w}" height="${Math.max(h - baselineY, 0)}" /></clipPath>
      <linearGradient id="${uid}-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${green}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${green}" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="${uid}-r" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${red}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${red}" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${gridSvg}
    <g clip-path="url(#${uid}-above)">
      <polygon points="${areaPoints}" fill="url(#${uid}-g)" />
      <polyline points="${points}" fill="none" stroke="${green}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    </g>
    <g clip-path="url(#${uid}-below)">
      <polygon points="${areaPoints}" fill="url(#${uid}-r)" />
      <polyline points="${points}" fill="none" stroke="${red}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    </g>
    <line x1="${padL}" y1="${baselineY}" x2="${w - padR}" y2="${baselineY}" stroke="${text}" stroke-width="1" stroke-dasharray="5 4" opacity="0.7" />
    <text x="${w - padR}" y="${baselineY - 6}" fill="${text}" font-size="11" text-anchor="end">Startkapital</text>
    ${dots}
    <circle cx="${x(values.length - 1)}" cy="${y(last)}" r="4.5" fill="${last >= baseline ? green : red}" stroke="${text}" stroke-width="1.5" />
    ${xLabelsSvg}
    <circle class="chart-hover-ring" r="7" fill="none" stroke-width="2" opacity="0" />
    ${hitAreas}
  </svg>`;
}

// Sofortiges, gut lesbares Tooltip statt des traegen nativen SVG-<title> -
// wird nach dem Einfuegen des lineChartSvg()-Markups auf den chart-wrap
// aufgerufen (braucht die tatsaechlichen DOM-Positionen der Trefferkreise).
export function attachChartTooltip(chartWrap, renderContent) {
  const tooltip = chartWrap.querySelector(".chart-tooltip");
  const ring = chartWrap.querySelector(".chart-hover-ring");
  if (!tooltip) return;
  // Default: Datum + $-Wert (Equity-Kurve). Balkendiagramme der Auswertungen
  // uebergeben einen eigenen Renderer (andere Achsen/Einheiten) statt diese
  // Funktion zu duplizieren.
  renderContent = renderContent || ((hit) => `<div class="chart-tooltip-date">${fmtDate(hit.dataset.day)}</div>`
    + `<div class="chart-tooltip-value">${fmtNum(parseFloat(hit.dataset.value))} $</div>`);

  const position = (e) => {
    const wrapRect = chartWrap.getBoundingClientRect();
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left = e.clientX - wrapRect.left + 14;
    let top = e.clientY - wrapRect.top - th - 10;
    if (left + tw > wrapRect.width) left = e.clientX - wrapRect.left - tw - 14;
    if (top < 0) top = e.clientY - wrapRect.top + 14;
    const zoom = currentZoom();
    tooltip.style.left = `${left / zoom}px`;
    tooltip.style.top = `${top / zoom}px`;
  };

  chartWrap.querySelectorAll(".chart-dot-hit").forEach(hit => {
    hit.addEventListener("mouseenter", (e) => {
      tooltip.innerHTML = renderContent(hit);
      tooltip.style.display = "block";
      if (ring) {
        ring.setAttribute("cx", hit.getAttribute("cx"));
        ring.setAttribute("cy", hit.getAttribute("cy"));
        ring.setAttribute("stroke", hit.dataset.color);
        ring.style.opacity = "1";
      }
      position(e);
    });
    hit.addEventListener("mousemove", position);
    hit.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
      if (ring) ring.style.opacity = "0";
    });
  });
}
