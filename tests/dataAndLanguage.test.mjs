import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, textToHtml, htmlToText } from '../scripts/utils/text.js';
import { STARTER_COMPANIES } from '../scripts/data/starter-companies.js';
import { STARTER_FUNDS } from '../scripts/data/starter-funds.js';
import {
  sanitizeCompany, sanitizeFund, SECTORS, REGIMES, MOODS, DIVIDEND_POLICIES, DIVIDEND_FREQUENCIES, COMPANY_STATUSES,
  BROKER_TUNING, FUND_KINDS, NOTIFY_CATEGORIES, NOTIFY_CHANNELS, GLIDE_NOISE, ALERT_KINDS, FUND_REBALANCE,
  FUND_DISTRIBUTION, GIG_OUTCOMES, VOICE_PERSONALITIES, GIG_HEADLINE_VARIANTS, GIG_TIP_VARIANTS, HEAT_TIERS,
  HEAT_MAIL_VARIANTS, HEAT_ACTIONS, PENALTY_KINDS, PENALTY_STATUSES, VERIFY_CHECKS, VERIFY_LEVELS,
} from '../scripts/engine/index.js';

const GRADES = BROKER_TUNING.grades.map((g) => g.key);

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const decode = (p) => decodeURIComponent(p);

test('text helpers escape and round-trip', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(textToHtml('One\nline\n\nTwo'), '<p>One<br>line</p><p>Two</p>');
  assert.equal(textToHtml('  \n\n '), '');
  assert.equal(htmlToText(textToHtml('A & B\n\nC <tag>')), 'A & B\n\nC <tag>');
});

test('starter companies are valid and have unique tickers', () => {
  const tickers = new Set();
  for (const { lore, ...config } of STARTER_COMPANIES) {
    const r = sanitizeCompany(config);
    assert.equal(r.ok, true, `${config.ticker}: ${r.errors}`);
    assert.ok(lore.length > 20, `${config.ticker} needs lore`);
    assert.ok(!tickers.has(r.company.ticker), `duplicate ${r.company.ticker}`);
    tickers.add(r.company.ticker);
  }
  assert.ok(tickers.size >= 10);
});

test('starter funds only hold starter companies, and NC12 is the twelve largest by market cap', () => {
  const cap = Object.fromEntries(STARTER_COMPANIES.map((c) => [c.ticker, c.initialPrice * c.sharesOutstanding]));
  const known = Object.keys(cap);
  const seen = new Set(known);
  for (const f of STARTER_FUNDS) {
    const r = sanitizeFund(f, { knownIds: known });
    assert.equal(r.ok, true, `${f.ticker}: ${r.errors} ${r.unknown}`);
    assert.ok(!seen.has(f.ticker), `${f.ticker} clashes with a company or fund ticker`);
    seen.add(f.ticker);
  }

  const members = (ticker) => sanitizeFund(STARTER_FUNDS.find((f) => f.ticker === ticker), { knownIds: known }).fund.components.map((c) => c.companyId);
  const largest = [...known].sort((a, b) => cap[b] - cap[a]).slice(0, 12);
  assert.deepEqual(members('NC12').sort(), largest.sort(), 'NC12 is the largest twelve');
  assert.deepEqual(members('NC20').sort(), [...known].sort(), 'NC20 holds everything');
  for (const t of known) assert.ok(STARTER_FUNDS.some((f) => f.ticker !== 'NC12' && members(f.ticker).includes(t)), `${t} is in no fund besides NC12`);
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|hbs)$/.test(name)) out.push(p);
  }
  return out;
}

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

test('every literal NCI.* language key used in code or templates exists in lang/en.json', () => {
  const base = decode(root);
  const lang = JSON.parse(readFileSync(join(base, 'lang', 'en.json'), 'utf8'));
  const keys = flatten(lang);
  const missing = [];
  for (const file of [...walk(join(base, 'scripts')), ...walk(join(base, 'templates'))]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/NCI\.[A-Za-z][A-Za-z0-9.\-]*[A-Za-z0-9]/g)) {
      const end = m.index + m[0].length;
      if (src[end] === '$' || src.slice(end, end + 2) === '${') continue;
      if (src[end] === '.' ) continue;
      // Bare group names (e.g. 'NCI.Sector') are prefixes for dynamically built keys, checked below.
      if ([...keys].some((k) => k.startsWith(`${m[0]}.`))) continue;
      if (!keys.has(m[0]) && !keys.has(`${m[0]}.Name`)) missing.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('dynamically built language keys exist', () => {
  const lang = JSON.parse(readFileSync(join(decode(root), 'lang', 'en.json'), 'utf8')).NCI;
  const need = [
    ...SECTORS.map((s) => lang.Sector[s]),
    ...[1, 2, 3, 4, 5].map((n) => lang.Vol[n]),
    ...COMPANY_STATUSES.map((s) => lang.Status[s]),
    ...Object.values(MOODS).map((m) => lang.Mood[m]),
    ...REGIMES.map((r) => lang.Regime[r]),
    ...DIVIDEND_FREQUENCIES.map((f) => lang.Frequency[f]),
    ...DIVIDEND_POLICIES.map((p) => lang.DividendPolicy[p]),
    ...['name-required', 'ticker-invalid', 'price-invalid', 'ticker-taken', 'gm-only'].map((e) => lang.Errors[e]),
    ...['WorldTime', 'RealTime', 'Manual'].map((m) => lang.Settings.TickMode[m]),
    ...['buy', 'sell'].map((s) => lang.Side[s]),
    ...['market', 'limit', 'stop'].map((t) => lang.OrderType[t]),
    ...['day', 'gtc'].map((e) => lang.Expiry[e]),
    ...['open', 'filled', 'rejected', 'cancelled', 'expired'].map((s) => lang.OrderStatus[s]),
    ...['deposit', 'withdraw', 'buy', 'sell', 'fee', 'dividend'].map((k) => lang.Ledger[k]),
    ...[
      'invalid-amount', 'insufficient-wealth', 'below-fee', 'insufficient-balance', 'invalid-side', 'invalid-order',
      'invalid-qty', 'invalid-limit', 'unknown-asset', 'halted', 'insufficient-funds', 'insufficient-shares',
      'not-found', 'unknown-request', 'below-minimum',
    ].map((r) => lang.Reasons[r]),
    ...['Deposited', 'Withdrawn', 'OrderPlaced', 'OrderCancelled', 'DripOn', 'DripOff'].map((k) => lang.Notify[k]),
    ...['drip', 'split', 'buyout', 'delist', 'writeoff'].map((k) => lang.Ledger[k]),
    ...['buyout', 'delist', 'bankrupt'].map((r) => lang.Reasons[r]),
    ...['flat', 'linear'].map((d) => lang.Controls.Decay[d]),
    ...['temporary', 'standard', 'lasting'].map((p) => lang.Controls.Persistence[p]),
    ...['bias', 'regime', 'volatility', 'halt', 'shock', 'setPrice'].map((k) => lang.Log[k]),
    ...['market', 'events', 'actions', 'companies', 'funds', 'brokers'].map((t) => lang.GMConsole.Tab[t]),
    ...GRADES.map((g) => lang.Grade[g]),
    ...GRADES.map((g) => lang.Mail.Sign[g]),
    ...FUND_KINDS.map((k) => lang.FundKind[k]),
    ...NOTIFY_CATEGORIES.map((c) => lang.Notify.Category[c]),
    ...NOTIFY_CHANNELS.map((c) => lang.Notify.Channel[c]),
    ...['direct', 'broker'].map((r) => lang.Route[r]),
    ...['order', 'withdrawal'].map((k) => lang.Mail.Cancelled[k]),
    ...['success', 'fumble'].map((c) => lang.Check.Crit[c]),
    lang.Ledger['withdraw-refund'],
    lang.Status.closed,
    ...[
      'invalid-route', 'no-terminal-session', 'no-broker', 'unknown-broker', 'fund-needs-broker', 'fund-market-only',
      'locked-out', 'no-terminal', 'no-network', 'not-authenticated', 'not-required', 'unrecognised',
    ].map((r) => lang.Reasons[r]),
    ...['components-invalid', 'components-unknown', 'not-active-gm'].map((e) => lang.Errors[e]),
    ...Object.keys(GLIDE_NOISE).map((k) => lang.Glide.NoiseLevel[k]),
    ...['not-active-gm', 'nothing-to-undo', 'settled'].map((r) => lang.GMConsole.Undo[r]),
    ...['not-active-gm', 'no-market', 'no-targets', 'glide-too-steep'].map((r) => lang.Preview.Reason[r]),
    ...['ipo-closed', 'ipo-already', 'ipo-no-allocation'].map((r) => lang.Reasons[r]),
    ...['glide', 'undo'].map((k) => lang.Log[k]),
    ...ALERT_KINDS.flatMap((k) => [lang.Alerts.Kind[k], lang.Alerts.Line[k], lang.Alerts.Fired[k]]),
    ...FUND_REBALANCE.map((r) => lang.FundRebalance[r]),
    ...FUND_DISTRIBUTION.flatMap((d) => [lang.FundDistribution[d], lang.FundDistribution.Option[d]]),
    ...GIG_OUTCOMES.flatMap((o) => [lang.Gig.Outcome[o], ...['mild', 'strong'].flatMap((size) => Array.from({ length: GIG_HEADLINE_VARIANTS }, (_, n) => lang.Gig.Headline[o][size][n + 1]))]),
    ...Object.entries(GIG_TIP_VARIANTS).flatMap(([group, n]) => Array.from({ length: n }, (_, i) => lang.Mail.Tip[group][i + 1])),
    ...['applied', 'discarded', 'ignored'].map((s) => lang.Gig.Status[s]),
    ...['approval', 'fuzzy', 'mention', 'ambiguous', 'unmatched', 'mapping', 'tag', 'not-tradable'].map((r) => lang.Gig.Reason[r]),
    ...['tag', 'mapping', 'exact', 'contains', 'fuzzy', 'mention'].map((h) => lang.Gig.How[h]),
    ...['applied', 'pending', 'unmatched', 'ignored', 'duplicate', 'disabled', 'invalid', 'not-gm', 'failed'].map((r) => lang.Gig.Result[r]),
    ...['Review', 'Mapping'].map((k) => lang.Gig.Notice[k]),
    lang.GMConsole.Tab.gigs,
    lang.GMConsole.Tab.heat,
    ...HEAT_TIERS.flatMap((t) => [lang.Heat.Tier[t], lang.Heat.TierHint[t]]),
    ...['up', 'down'].map((d) => lang.Heat.Direction[d]),
    ...['general', 'tipped', 'runner'].map((k) => lang.Heat.Knowledge[k]),
    ...Object.entries(HEAT_MAIL_VARIANTS).flatMap(([group, n]) => Array.from({ length: n }, (_, i) => lang.Mail.Heat[group][i + 1])),
    ...['Subject', 'Line1', 'Short', 'Line2'].map((k) => lang.Mail.Heat.Fine[k]),
    ...['Subject', 'Line1', 'Line2'].map((k) => lang.Mail.Heat.Freeze[k]),
    ...PENALTY_KINDS.flatMap((k) => [lang.Heat.Penalty[k], lang.Heat.PenaltyDone[k]]),
    ...PENALTY_STATUSES.map((s) => lang.Heat.Status[s]),
    ...Object.keys(HEAT_ACTIONS).flatMap((a) => [lang.Heat.Action[a].Name, lang.Heat.Action[a].Desc, lang.Heat.ActionName[a]]),
    ...['critical', 'success', 'failure', 'fumble'].map((k) => lang.Heat.Action.Result[k]),
    ...['Title', 'Intro', 'Skill', 'Cost', 'Ready', 'ReadyIn', 'Try', 'TooPoor', 'Frozen', 'BrokerBan'].map((k) => lang.Heat.Panel[k]),
    lang.Settings.HeatConsequences.Name, lang.Settings.HeatConsequences.Hint,
    lang.Settings.HeatPenaltyApproval.Name, lang.Settings.HeatPenaltyApproval.Hint,
    ...['account-frozen', 'broker-refuses', 'on-cooldown', 'heat-off', 'unknown-action', 'no-check'].map((r) => lang.Reasons[r]),
    ...VERIFY_CHECKS.map((c) => lang.Verify.Check[c]),
    ...VERIFY_LEVELS.map((l) => lang.Verify.Level[l]),
    ...['SummaryOk', 'SummaryWarn', 'SummaryFail'].map((k) => lang.Verify[k]),
    lang.Migration.Failed,
    ...['RolledBack', 'RolledBackAhead', 'Ahead'].map((k) => lang.Clock[k]),
    lang.Terminal.Day, lang.GMConsole.GameDay, lang.GMConsole.AdvanceDay, lang.GMConsole.AdvanceDayHint,
    ...['RemoveBroker', 'RemoveBrokerHint', 'RemoveBrokerConfirm', 'BrokerRemoved', 'BrokerInUse'].map((k) => lang.GMConsole[k]),
    ...['assigned', 'busy', 'unknown', 'gm-only'].map((k) => lang.GMConsole.RemoveBrokerRefused[k]),
    lang.Terminal.BackPortfolio, lang.Terminal.OpenAsset,
    ...['terminal', 'console', 'advance', 'check'].map((k) => lang.Macros[k]),
    ...['OpenTerminal', 'OpenTerminalHint', 'OpenConsole', 'OpenConsoleHint'].map((k) => lang.Keybindings[k]),
    lang.GMConsole.Tab.tools,
    ...['Title', 'Schema', 'CheckTitle', 'CheckHint', 'RunCheck', 'NoReport', 'MacrosTitle', 'MacrosHint', 'CreateMacros', 'MacrosDone',
      'SuggestTitle', 'SuggestHint', 'NoSuggestions', 'Seen', 'Create', 'Ignore', 'TradeLogTitle', 'TradeLogHint', 'NoTrades',
      'Who', 'Day', 'Side', 'Qty', 'Gross', 'Fees'].map((k) => lang.Tools[k]),
    ...['contact', 'gig'].map((k) => lang.Tools.From[k]),
    lang.Voice.Label, lang.Voice.Hint, lang.Voice.standard,
    ...VOICE_PERSONALITIES.map((p) => lang.Voice[p]),
    lang.Log.gig,
    ...['Settling', 'SettlingLine', 'SettlesIn'].map((k) => lang.Portfolio[k]),
    ...['Income', 'Redemption', 'RedeemNone', 'RedeemDays'].map((k) => lang.Fund[k]),
    ...['invalid-alert', 'alert-duplicate', 'alert-already-met', 'too-many-alerts'].map((r) => lang.Reasons[r]),
  ];
  assert.ok(need.every((v) => typeof v === 'string' && v.length), 'a dynamic language key is missing');
});

test('every font the stylesheet names is bundled, with its licence, and the tabs need nothing from another module', () => {
  const css = readFileSync(new URL('../styles/night-city-investments.css', import.meta.url), 'utf8');
  const urls = [...css.matchAll(/url\('\.\.\/(assets\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 5);
  for (const file of urls) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  for (const folder of ['Rajdhani', 'ShareTechMono']) assert.ok(existsSync(new URL(`../assets/fonts/${folder}/OFL.txt`, import.meta.url)), folder);
  assert.doesNotMatch(css, /modules\/night-city-messenger/);
});
