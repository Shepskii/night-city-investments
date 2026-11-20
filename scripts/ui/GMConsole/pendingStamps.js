/**
 * When each decision on Pending first waited, on the game's clock.
 * @file scripts/ui/GMConsole/pendingStamps.js
 * @description Most decisions don't record when they came, so the active GM's client stamps each row the first
 *              time it sees it: its tab, its business, its kind and its own id name it. The stamps live in a hidden
 *              world setting, and go when their row does. Every GM reads them; only the active GM writes.
 */

import { MODULE_ID, SETTINGS } from '../../utils/constants.js';
import { isActiveGM } from '../../utils/helpers.js';
import { MarketClock } from '../../services/MarketClockService.js';

/** A row's name for its stamp. */
export const rowKey = (r) => [r.tab ?? '', r.businessId ?? '', r.kind ?? r.type ?? '', r.id ?? r.item ?? ''].join('|');

/** A stamp as the GM's date format shows it, with the time of day. */
export function stampText(ms) {
  const d = new Date(ms);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${MarketClock.displayDate(ms)} ${time}`;
}

// What this client has stamped and not yet seen saved, so a redraw before the save shows it.
let unsaved = null;
let saving = null;

function stored() {
  if (unsaved) return unsaved;
  try {
    return game.settings.get(MODULE_ID, SETTINGS.PENDING_SEEN) ?? {};
  } catch {
    return {};
  }
}

function save(seen) {
  unsaved = seen;
  if (saving) return;
  saving = (async () => {
    // Stamps made while a save runs go in the next.
    while (unsaved) {
      const next = unsaved;
      try {
        await game.settings.set(MODULE_ID, SETTINGS.PENDING_SEEN, next);
      } catch {
        // Not saved: the next change tries again.
      }
      if (unsaved === next) unsaved = null;
    }
    saving = null;
  })();
}

/**
 * Give each row its `seenText`, stamping (as the active GM) any row not seen before. `prune`, with every row there is,
 * drops the stamps of rows that have gone.
 * @returns {object[]} the rows
 */
export function stampRows(rows, { prune = false } = {}) {
  const seen = { ...stored() };
  const writer = isActiveGM();
  let now = null;
  let changed = false;
  const live = new Set();
  for (const r of rows) {
    const key = rowKey(r);
    live.add(key);
    if (seen[key] == null && writer) {
      now ??= MarketClock.nowMs();
      seen[key] = now;
      changed = true;
    }
    r.seenText = seen[key] != null ? stampText(seen[key]) : '';
  }
  if (prune && writer) {
    for (const key of Object.keys(seen)) {
      if (!live.has(key)) {
        delete seen[key];
        changed = true;
      }
    }
  }
  if (changed) save(seen);
  return rows;
}
