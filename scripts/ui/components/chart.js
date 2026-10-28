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
