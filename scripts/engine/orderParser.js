/**
 * Broker mail parser
 * @file scripts/engine/orderParser.js
 * @description Turns the text of a player's mail to their broker into a command. Lenient about
 *              case, HTML, thousands separators and filler words. No Foundry globals.
 *
 *   BUY 10 ARA            SELL 5 SAM @ 80       SELL 5 SAM stop 70
 *   SELL ALL ARA          WITHDRAW 5000         STATUS      STATEMENT      CANCEL <ref>      HELP
 */

const STOP_WORDS = new Set(['SHARE', 'SHARES', 'UNIT', 'UNITS', 'OF', 'AT', 'ALL', 'EB']);

function clean(input) {
  return String(input ?? '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
}

/** One line of a mail as a command: `null` if it isn't one, `{ok: false, error}` if it is one that can't be carried out. */
export function parseOrderLine(line) {
  const text = line.trim().replace(/[.!]+$/, '');
  if (!text) return null;

  let m = text.match(/^(buy|sell)\s+all\s+(?:of\s+)?([a-z][a-z0-9.]{0,7})$/i);
  if (m && m[1].toLowerCase() === 'sell' && !STOP_WORDS.has(m[2].toUpperCase())) {
    return { ok: true, cmd: 'sell', qty: 'all', ticker: m[2].toUpperCase(), type: 'market' };
  }

  m = text.match(/^(buy|sell)\s+(\d+)\s+(?:(?:shares?|units?)\s+)?(?:of\s+)?([a-z][a-z0-9.]{0,7})(?:\s*(@|at|limit|stop)\s*(\d+(?:\.\d+)?)\s*(?:eb)?)?$/i);
  if (m) {
    const ticker = m[3].toUpperCase();
    if (STOP_WORDS.has(ticker)) return { ok: false, error: 'bad-ticker' };
    const qty = Number.parseInt(m[2], 10);
    if (qty <= 0) return { ok: false, error: 'bad-quantity', ticker };
    const order = { ok: true, cmd: m[1].toLowerCase(), qty, ticker, type: 'market' };
    if (m[4]) {
      order.type = m[4].toLowerCase() === 'stop' ? 'stop' : 'limit';
      order.limit = Number.parseFloat(m[5]);
    }
    return order;
  }

  m = text.match(/^withdraw(?:al)?\s+(\d+)\s*(?:eb|eddies|eurobucks)?$/i);
  if (m) {
    const amount = Number.parseInt(m[1], 10);
    return amount > 0 ? { ok: true, cmd: 'withdraw', amount } : { ok: false, error: 'bad-amount' };
  }

  m = text.match(/^cancel\s+([a-z0-9_-]+)$/i);
  if (m) return { ok: true, cmd: 'cancel', ref: m[1] };

  if (/^(status|portfolio|balance|positions)$/i.test(text)) return { ok: true, cmd: 'status' };
  if (/^statements?$/i.test(text)) return { ok: true, cmd: 'statement' };
  if (/^help\??$/i.test(text)) return { ok: true, cmd: 'help' };
  return null;
}

/** The lines of a mail body that have anything on them. */
export function mailLines(input) {
  return clean(input).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/**
 * Parse mail text. Subject and body can be passed joined; the first recognised line wins.
 * @returns {{ok: true, cmd: string, ...} | {ok: false, error: string}}
 */
export function parseOrderText(input) {
  const lines = clean(input).split(/\r?\n/);
  let failure = null;
  for (const line of lines) {
    const parsed = parseOrderLine(line);
    if (parsed?.ok) return parsed;
    if (parsed && !failure) failure = parsed;
  }
  return failure ?? { ok: false, error: 'unrecognised' };
}
