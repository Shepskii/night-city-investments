/**
 * SVG charts
 * @file scripts/ui/components/chart.js
 * @description Small inline SVG charts returned as strings. Pure; no Foundry globals.
 */

const UP = '#3ddc84';
const DOWN = '#ff6a4d';
const FLAT = '#888888';

/** Colour for a move: green up, red down, grey flat. */
export const trendColor = (change) => (change > 0 ? UP : change < 0 ? DOWN : FLAT);

function scale(values, width, height, pad) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1e-9);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [
    Math.round((pad + i * step) * 10) / 10,
    Math.round((pad + (height - pad * 2) * (1 - (v - min) / range)) * 10) / 10,
  ]);
}

/** Compact line for a table row. Colour follows the first-to-last move. */
export function sparkline(values, { width = 90, height = 24 } = {}) {
  if (!values || values.length < 2) return `<svg width="${width}" height="${height}" class="nci-spark"></svg>`;
  const color = trendColor(values[values.length - 1] - values[0]);
  const points = scale(values, width, height, 2).map((p) => p.join(',')).join(' ');
  return `<svg width="${width}" height="${height}" class="nci-spark" viewBox="0 0 ${width} ${height}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points}"/></svg>`;
}

/**
 * Preview chart: the range (10th to 90th percentile) and median for doing nothing (grey) and for
 * the planned change (green). Both are drawn on one scale.
 */
export function coneChart(baseline, scenario, { width = 560, height = 200 } = {}) {
  const n = baseline.p50.length;
  if (n < 2) return `<svg width="${width}" height="${height}" class="nci-chart"></svg>`;
  const all = [...baseline.p10, ...baseline.p90, ...scenario.p10, ...scenario.p90];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = 8;
  const range = Math.max(max - min, 1e-9);
  const x = (i) => Math.round((pad + (i * (width - pad * 2)) / (n - 1)) * 10) / 10;
  const y = (v) => Math.round((pad + (height - pad * 2) * (1 - (v - min) / range)) * 10) / 10;
  const line = (arr) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const band = (c) => `${line(c.p90)} ${c.p10.map((v, i) => `${x(n - 1 - i)},${y(c.p10[n - 1 - i])}`).join(' ')}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="nci-chart">`
    + `<polygon points="${band(baseline)}" fill="${FLAT}" fill-opacity="0.2"/>`
    + `<polygon points="${band(scenario)}" fill="${UP}" fill-opacity="0.2"/>`
    + `<polyline fill="none" stroke="${FLAT}" stroke-width="1.5" stroke-dasharray="4 3" points="${line(baseline.p50)}"/>`
    + `<polyline fill="none" stroke="${UP}" stroke-width="2" points="${line(scenario.p50)}"/>`
    + `<text x="${width - pad}" y="12" text-anchor="end" fill="#888" font-size="10">${max.toFixed(2)}</text>`
    + `<text x="${width - pad}" y="${height - 4}" text-anchor="end" fill="#888" font-size="10">${min.toFixed(2)}</text>`
    + `</svg>`;
}

/** Larger chart with a filled area and min/max labels. */
export function lineChart(values, { width = 560, height = 180 } = {}) {
  if (!values || values.length < 2) {
    return `<svg width="${width}" height="${height}" class="nci-chart"></svg>`;
  }
  const color = trendColor(values[values.length - 1] - values[0]);
  const pad = 6;
  const pts = scale(values, width, height, pad);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${height - pad} ${line} ${pts[pts.length - 1][0]},${height - pad}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="nci-chart">`
    + `<polygon points="${area}" fill="${color}" fill-opacity="0.12"/>`
    + `<polyline fill="none" stroke="${color}" stroke-width="2" points="${line}"/>`
    + `<text x="${width - pad}" y="12" text-anchor="end" fill="#888" font-size="10">${max.toFixed(2)}</text>`
    + `<text x="${width - pad}" y="${height - 4}" text-anchor="end" fill="#888" font-size="10">${min.toFixed(2)}</text>`
    + `</svg>`;
}

const round1 = (v) => Math.round(v * 10) / 10;
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A business's weeks: takings (green) and upkeep (red) as bars side by side, profit as a line of
 * dots, on one scale with a zero line. `weeks` is `[{takings, upkeep, profit, tip}]`; `tip` is the
 * hover text for that week. `labels` are the first and last weeks' captions.
 */
export function weeklyBars(weeks, { width = 1040, height = 190, format = String, labels = ['', ''] } = {}) {
  const n = weeks.length;
  if (!n) return `<svg width="${width}" height="${height}" class="nci-chart"></svg>`;
  const gutter = 72;
  const padX = 8;
  const padTop = 10;
  const padBottom = 20;
  const values = weeks.flatMap((w) => [w.takings, w.upkeep, w.profit]);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = Math.max(max - min, 1);
  const y = (v) => round1(padTop + ((height - padTop - padBottom) * (max - v)) / range);
  const slot = (width - gutter - padX) / n;
  const bar = Math.min(22, slot * 0.3);
  const centre = (i) => gutter + slot * (i + 0.5);
  const scaleText = (v) => `<text x="${gutter - 8}" y="${y(v) + 3}" text-anchor="end" fill="#888" font-size="10">${escapeXml(format(v))}</text>`;
  const column = (x, v, color) => `<rect x="${round1(x)}" y="${Math.min(y(v), y(0))}" width="${round1(bar)}" height="${Math.max(round1(Math.abs(y(v) - y(0))), 0.5)}" fill="${color}" fill-opacity="0.75"/>`;
  const groups = weeks.map((w, i) => {
    const c = centre(i);
    return `<g><title>${escapeXml(w.tip ?? '')}</title>`
      + `<rect x="${round1(c - slot / 2)}" y="0" width="${round1(slot)}" height="${height}" fill="transparent"/>`
      + column(c - bar - 1, w.takings, UP)
      + column(c + 1, w.upkeep, DOWN)
      + `</g>`;
  }).join('');
  const profit = weeks.map((w, i) => `${round1(centre(i))},${y(w.profit)}`).join(' ');
  const dots = weeks.map((w, i) => `<circle cx="${round1(centre(i))}" cy="${y(w.profit)}" r="2.5" fill="${w.profit < 0 ? DOWN : '#f2f2f2'}"><title>${escapeXml(w.tip ?? '')}</title></circle>`).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="nci-chart">`
    + `<line x1="${gutter}" x2="${width - padX}" y1="${y(0)}" y2="${y(0)}" stroke="#555" stroke-width="1"/>`
    + groups
    + (n > 1 ? `<polyline fill="none" stroke="#f2f2f2" stroke-opacity="0.6" stroke-width="1.5" points="${profit}"/>` : '')
    + dots
    // The zero mark always shows; the top and bottom only when they are clear of it.
    + (max > 0 && y(0) - y(max) >= 12 ? scaleText(max) : '')
    + scaleText(0)
    + (min < 0 && y(min) - y(0) >= 12 ? scaleText(min) : '')
    + `<text x="${gutter}" y="${height - 3}" fill="#888" font-size="10">${escapeXml(labels[0] ?? '')}</text>`
    + (n > 1 ? `<text x="${width - padX}" y="${height - 3}" text-anchor="end" fill="#888" font-size="10">${escapeXml(labels[1] ?? '')}</text>` : '')
    + `</svg>`;
}

/** A balance over time (a business's cash at each week's close), with a zero line when it crosses zero. */
export function balanceLine(values, { width = 1040, height = 120, format = String, tips = [] } = {}) {
  if (!values || values.length < 2) return `<svg width="${width}" height="${height}" class="nci-chart"></svg>`;
  const gutter = 72;
  const pad = 8;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(max - min, 1);
  const x = (i) => round1(gutter + (i * (width - gutter - pad)) / (values.length - 1));
  const y = (v) => round1(pad + 4 + ((height - pad * 2 - 4) * (max - v)) / range);
  const color = trendColor(values[values.length - 1] - values[0]);
  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const base = min < 0 && max > 0 ? y(0) : height - pad;
  const area = `${x(0)},${base} ${line} ${x(values.length - 1)},${base}`;
  const dots = values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${v < 0 ? DOWN : color}"><title>${escapeXml(tips[i] ?? format(v))}</title></circle>`).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="nci-chart">`
    + (min < 0 && max > 0 ? `<line x1="${gutter}" x2="${width - pad}" y1="${y(0)}" y2="${y(0)}" stroke="#555" stroke-width="1"/>` : '')
    + `<polygon points="${area}" fill="${color}" fill-opacity="0.12"/>`
    + `<polyline fill="none" stroke="${color}" stroke-width="2" points="${line}"/>`
    + dots
    + `<text x="${gutter - 8}" y="${y(max) + 3}" text-anchor="end" fill="#888" font-size="10">${escapeXml(format(max))}</text>`
    + `<text x="${gutter - 8}" y="${y(min) + 3}" text-anchor="end" fill="#888" font-size="10">${escapeXml(format(min))}</text>`
    + `</svg>`;
}
