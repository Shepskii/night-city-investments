/**
 * Organisations' voices (M3 step 2, DESIGN §36.4)
 * @file scripts/engine/orgVoice.js
 * @description How a gang, a corporation, a paper or an official sender words its mail. Each has a style, and each
 *              style has pools of lines by what the mail is about, with a few tones a pool may have: `hostile`
 *              (standing with the business is hostile), `heavy` (a heavy shakedown), `repeat` (the same move by
 *              the same faction within four weeks), and `lines` for the rest. The most specific pool that has lines
 *              wins. Greetings and sign-offs frame the line. The lines live in data/org-voices. Pure.
 */

import { pickLine, fillLine } from './brokerVoice.js';

/** A gang's styles (the user's choice, 2026-11-11). */
export const GANG_STYLES = Object.freeze(['formal', 'street', 'chrome', 'zealot', 'patriot', 'glam', 'cryptic', 'oldMoney']);
/** A corporation's styles; Broadcast and Tabloid are for a corporation that runs a paper. */
export const CORP_STYLES = Object.freeze(['formal', 'militarist', 'wellness', 'legal', 'slick', 'broadcast', 'tabloid']);
/** How a paper writes. */
export const OUTLET_STYLES = Object.freeze(['broadcast', 'tabloid']);

/** The starter gangs' styles, which the GM can change on the Factions tab. */
const STARTER_GANGS = Object.freeze({
  gang_tyger: 'formal', gang_voodoo: 'cryptic', gang_sixth: 'patriot', gang_primetime: 'glam', gang_scavvers: 'street',
  gang_maelstrom: 'chrome', gang_inquisitors: 'zealot', gang_ironsights: 'street', gang_reckoners: 'street',
  gang_piranhas: 'glam', gang_vampyres: 'oldMoney', gang_redchrome: 'chrome', gang_vaqueros: 'street',
});
/** A corporation's style by its sector, unless the GM picks one. */
const SECTOR_STYLES = Object.freeze({ security: 'militarist', arms: 'militarist', biotech: 'wellness', health: 'wellness', consumer: 'slick', media: 'broadcast' });

/** The styles a faction of this kind may have. */
export const stylesFor = (kind) => (kind === 'gang' ? GANG_STYLES : kind === 'corp' ? CORP_STYLES : [...GANG_STYLES]);

/** A faction's style: the GM's pick, or its default. `sector` is its company's, for a corporation. */
export function factionStyle(f, sector = null) {
  if (!f) return null;
  if (f.voice && stylesFor(f.kind).includes(f.voice)) return f.voice;
  if (f.kind === 'corp') return f.ticker === 'ARA' ? 'formal' : SECTOR_STYLES[sector] ?? 'legal';
  return STARTER_GANGS[f.id] ?? 'street';
}

/** A paper's style: a faction's, if it is Broadcast or Tabloid, and Broadcast otherwise. */
export const outletStyle = (f, sector = null) => {
  const style = factionStyle(f, sector);
  return OUTLET_STYLES.includes(style) ? style : 'broadcast';
};

/**
 * Whether a faction made the same move against this business within the last few weeks, from its weekly digests.
 * @param {object} b - the business
 * @param {{kind: string, factionName?: string}} event
 */
export function isRepeat(b, event, weeks = 4) {
  if (!event?.factionName) return false;
  const index = b?.period?.index ?? Infinity;
  return (b?.digests ?? []).some((d) => d.index >= index - weeks && d.index < index && d.event?.kind === event.kind && d.event?.faction === event.factionName);
}

/** The tones that fit an event, most specific first. */
export function eventTones(b, event) {
  const tones = [];
  if (event?.heavy) tones.push('heavy');
  if (isRepeat(b, event)) tones.push('repeat');
  if (event?.factionId && b?.standings?.[event.factionId] === 'hostile') tones.push('hostile');
  return tones;
}

/** A short reference number that stays the same for the same matter. */
export function refNumber(key) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return String((h >>> 0) % 10000).padStart(4, '0');
}

/**
 * A voiced mail's paragraphs, or null when the style has nothing for this kind.
 * @param {object} o
 * @param {object} o.voices - pools by style
 * @param {string} o.style
 * @param {string} [o.fallback] - a style to try when `style` has no pool for the kind
 * @param {string} o.kind
 * @param {string[]} [o.tones] - most specific first; `lines` is always tried last
 * @param {string[]} [o.also] - further kinds whose line follows, before the sign-off
 * @param {object} [o.data] - values for {tokens}
 * @param {() => number} [o.rng]
 * @returns {{paragraphs: string[], ref: string|null}|null}
 */
export function orgMail({ voices, style, fallback = null, kind, tones = [], also = [], data = {}, rng = Math.random }) {
  const styled = [style, fallback].filter(Boolean).find((s) => voices?.[s]?.[kind]);
  if (!styled) return null;
  const v = voices[styled];
  const pools = v[kind];
  const tone = [...tones, 'lines'].find((t) => Array.isArray(pools[t]) && pools[t].length);
  if (!tone) return null;
  const memory = `org:${styled}:${kind}`;
  const line = fillLine(pickLine(pools[tone], `${memory}:${tone}`, rng), data);
  const more = also.map((k) => v[k]?.lines ?? voices[fallback]?.[k]?.lines).filter((pool) => pool?.length).map((pool, i) => fillLine(pickLine(pool, `${memory}:also${i}`, rng), data));
  const greeting = v.greetings?.length ? fillLine(pickLine(v.greetings, `org:${styled}:greet`, rng) ?? '', data) : '';
  const signoff = v.signoffs?.length ? fillLine(pickLine(v.signoffs, `org:${styled}:sign`, rng) ?? '', data) : '';
  const ref = v.ref ? fillLine(v.ref, data) : null;
  return { paragraphs: [greeting, line, ...more, signoff].filter(Boolean), ref };
}
