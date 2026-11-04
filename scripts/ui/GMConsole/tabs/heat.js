/**
 * GM Console heat tab: insider-trading heat, penalties, open windows and audits.
 * @file scripts/ui/GMConsole/tabs/heat.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L, daysInclusive } from '../../format.js';
import { MarketClock } from '../../../services/MarketClockService.js';
import { exposureBand } from '../../../engine/index.js';
import { HeatService } from '../../../services/HeatService.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { companyOptions, report } from '../shared.js';
import { actorLink } from '../../actorLink.js';

/** A penalty in words. */
export const penaltyText = (p) => L(`NCI.Heat.Penalty.${p.kind}`, { amount: Number(p.params.amount ?? 0).toLocaleString(), days: p.params.days ?? p.params.banDays ?? 0 });

async function onHeatApprove(event, target) {
  const card = target.closest('.nci-gig, tr');
  const read = (name) => card?.querySelector(`[name="${name}"]`)?.value;
  const out = await HeatService.approvePenalty(target.dataset.id, { amount: read('penaltyAmount'), days: read('penaltyDays') });
  ui.notifications[out?.ok ? 'info' : 'warn'](L(`NCI.Heat.Result.${out?.ok ? 'ok' : (out?.status ?? 'invalid')}`));
}

async function onHeatDismiss(event, target) {
  await HeatService.dismissPenalty(target.dataset.id);
}

async function onHeatSet(event, target) {
  const value = target.closest('tr')?.querySelector('[name="heatValue"]')?.value;
  const out = await HeatService.setHeat(target.dataset.id, value);
  if (!out?.ok) ui.notifications.warn(L(`NCI.Heat.Result.${out?.status ?? 'invalid'}`));
}

async function onHeatClear(event, target) {
  await HeatService.setHeat(target.dataset.id, 0);
}

/** A business's Exposure, by hand (a raid played out at the table, a favour called in). */
async function onExposureSet(event, target) {
  report(await BusinessService.setExposure(target.dataset.id, target.closest('tr')?.querySelector('[name="exposureValue"]')?.value));
}

export const actions = {
  exposureSet: onExposureSet,
  heatApprove: onHeatApprove,
  heatDismiss: onHeatDismiss,
  heatSet: onHeatSet,
  heatClear: onHeatClear,
};

export function context() {
  return {
    heat: {
      ...build(companyOptions()),
      exposure: BusinessService.snapshot().filter(({ business: b }) => b.status === 'open').map(({ business: b, hidden }) => {
        const value = hidden.exposure ?? 0;
        return { id: b.id, name: b.name, value, band: L(`NCI.Company.Exposure.${exposureBand(value)}`) };
      }),
    },
  };
}

function build(companyOptions) {
  const snap = HeatService.snapshot();
  const label = new Map(companyOptions.map((o) => [o.value, o.label]));
  const company = (id) => label.get(id) ?? id;
  const dir = (d) => L(`NCI.Heat.Direction.${d}`);
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const lastOf = (c) => {
    const e = c.log.at(-1);
    if (!e) return '';
    if (e.action) return L('NCI.Heat.LastAction', { gain: signed(e.gain), what: L(`NCI.Heat.ActionName.${e.action}`), date: MarketClock.showDate(e.date) });
    return L('NCI.Heat.LastGain', { gain: signed(e.gain), company: company(e.companyId), date: MarketClock.showDate(e.date) });
  };
  const doneText = (p) => {
    if (p.status !== 'applied' || !p.result) return '';
    if (p.kind === 'fine') return L('NCI.Heat.PenaltyDone.fine', { paid: Number(p.result.paid).toLocaleString(), short: p.result.shortfall > 0 ? L('NCI.Heat.ShortBy', { amount: Number(p.result.shortfall).toLocaleString() }) : '' });
    if (p.kind === 'freeze') return L('NCI.Heat.PenaltyDone.freeze', { until: Math.ceil(p.result.untilTick - 1e-6) });
    return L(p.result.dropped ? 'NCI.Heat.PenaltyDone.dropBroker' : 'NCI.Heat.PenaltyDone.dropBrokerNone');
  };
  const penalty = (p) => ({
    id: p.id,
    name: p.name,
    who: actorLink(p.actorId, p.name),
    kind: p.kind,
    isFine: p.kind === 'fine',
    amount: p.params.amount,
    days: p.params.days ?? p.params.banDays,
    daysLabel: L(p.kind === 'freeze' ? 'NCI.Heat.FreezeDays' : 'NCI.Heat.BanDays'),
    text: penaltyText(p),
    line: L('NCI.Heat.PenaltyLine', { kind: L(`NCI.Heat.Status.${p.status}`), heat: p.heat, date: MarketClock.showDate(p.date) }),
    status: L(`NCI.Heat.Status.${p.status}`),
    done: doneText(p),
  });

  return {
    enabled: HeatService.enabled(),
    consequences: HeatService.consequencesOn(),
    approval: HeatService.approvalRequired(),
    tiers: ['quiet', 'noticed', 'flagged', 'investigated'].map((t) => ({ id: t, label: L(`NCI.Heat.Tier.${t}`), hint: L(`NCI.Heat.TierHint.${t}`) })),
    characters: snap.characters.map((c) => ({
      actorId: c.actorId,
      name: c.name,
      who: actorLink(c.actorId, c.name),
      heat: c.heat,
      width: Math.min(100, Math.round(c.heat)),
      tier: c.tier,
      tierLabel: L(`NCI.Heat.Tier.${c.tier}`),
      updated: c.tick,
      last: lastOf(c),
      cover: c.cover ? L('NCI.Heat.Covered', { n: daysInclusive(c.cover.until, snap.tick) }) : '',
    })),
    pendingPenalties: snap.penalties.filter((p) => p.status === 'pending').map(penalty),
    penaltyHistory: snap.penalties.filter((p) => p.status !== 'pending').slice(-8).reverse().map(penalty),
    open: snap.windows.filter((w) => w.status === 'open').map((w) => ({
      company: company(w.companyId),
      direction: dir(w.direction),
      up: w.direction === 'up',
      closes: w.closeTick >= snap.tick - 1e-6 ? L('NCI.Heat.ClosesIn', { n: daysInclusive(w.closeTick, snap.tick) }) : L('NCI.Heat.AwaitingFills'),
      tipped: w.tipped.length,
      opened: MarketClock.showDate(w.openDate),
    })),
    audits: snap.audits.slice(-8).reverse().map((a) => ({
      date: MarketClock.showDate(a.date),
      company: company(a.companyId),
      direction: dir(a.direction),
      up: a.direction === 'up',
      quiet: !a.results.length,
      results: a.results.map((r) => ({
        name: r.name,
        who: actorLink(r.actorId, r.name),
        gain: r.applied ?? r.gain,
        covered: r.covered ? L('NCI.Heat.CoverHalved', { gain: r.gain }) : '',
        trades: r.trades.map((t) => L('NCI.Heat.Trade', {
          side: L(`NCI.Side.${t.side}`), gross: Number(t.gross).toLocaleString(), route: L(`NCI.Route.${t.route}`), knowledge: L(`NCI.Heat.Knowledge.${t.knowledge}`), gain: t.gain,
        })),
      })),
    })),
  };
}
