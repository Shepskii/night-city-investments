/**
 * GM Console events tab: shocks, glides, news, price changes and the GM action log.
 * @file scripts/ui/GMConsole/tabs/events.js
 * @description Action handlers run with `this` set to the console window.
 */

import { parseTarget, SHOCK_PERSISTENCE, GLIDE_NOISE } from '../../../engine/index.js';
import { L, money, daysLeft } from '../../format.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { MarketControlService } from '../../../services/MarketControlService.js';
import { CorporateActionService } from '../../../services/CorporateActionService.js';
import { NewsService } from '../../../services/NewsService.js';
import { field, report, targetLabel, companyOptions, companiesById } from '../shared.js';

async function onAddShock(event, target) {
  report(await MarketControlService.addShock({
    target: field(target, 'shockTarget'),
    percent: Number(field(target, 'shockPercent')),
    delayDays: Number(field(target, 'shockDelay')),
    persistence: field(target, 'shockPersistence'),
    headline: field(target, 'shockHeadline') ?? '',
  }));
}

async function onRemoveImpact(event, target) {
  await MarketControlService.removeImpact(target.dataset.id);
}

async function onPostNews(event, target) {
  const company = field(target, 'newsCompany');
  const item = await NewsService.post({
    headline: field(target, 'newsHeadline') ?? '',
    tone: field(target, 'newsTone'),
    companyIds: company ? [company] : [],
  });
  report(!!item);
}

async function onSetPrice(event, target) {
  report(await CorporateActionService.setPrice(field(target, 'priceCompany'), Number(field(target, 'priceValue')), {
    alsoFair: !!field(target, 'priceFair'),
  }));
}

function onPreviewShock(event, target) {
  this._togglePreview('shock', () => {
    const delayDays = Number(field(target, 'shockDelay'));
    const scenario = {
      kind: 'shock', target: field(target, 'shockTarget'), percent: Number(field(target, 'shockPercent')), delayDays, persistence: field(target, 'shockPersistence'),
    };
    this._showPreview(scenario, Math.min(120, 30 + delayDays), L('NCI.Controls.ShockTitle'));
  });
}

function onPreviewGlide(event, target) {
  this._togglePreview('glide', () => {
    const days = Math.floor(Number(field(target, 'glideDays')));
    const scenario = {
      kind: 'glide',
      companyId: field(target, 'glideCompany'),
      target: Number(field(target, 'glideTarget')),
      days,
      noise: GLIDE_NOISE[field(target, 'glideNoise')] ?? GLIDE_NOISE.medium,
    };
    this._showPreview(scenario, Math.min(120, Math.max(14, days + 5)), L('NCI.Glide.Title'));
  });
}

async function onAddGlide(event, target) {
  report(await MarketControlService.addGlide({
    companyId: field(target, 'glideCompany'),
    target: Number(field(target, 'glideTarget')),
    days: Number(field(target, 'glideDays')),
    noise: field(target, 'glideNoise'),
  }), 'NCI.Glide.Started');
}

async function onRemoveGlide(event, target) {
  await MarketControlService.removeGlide(target.dataset.id);
}

export const actions = {
  addShock: onAddShock,
  removeImpact: onRemoveImpact,
  postNews: onPostNews,
  setPrice: onSetPrice,
  previewShock: onPreviewShock,
  previewGlide: onPreviewGlide,
  addGlide: onAddGlide,
  removeGlide: onRemoveGlide,
};

export function context(app) {
  const controls = MarketStore.getControls();
  const byId = companiesById();
  const time = MarketStore.time();
  return {
    previewShock: app.preview?.kind === 'shock' ? app.preview : null,
    previewGlide: app.preview?.kind === 'glide' ? app.preview : null,
    impacts: controls.impacts.map((i) => ({
      id: i.id,
      label: `${targetLabel(i.target, byId)}: ${i.meta?.percent > 0 ? '+' : ''}${i.meta?.percent ?? '?'}%`,
      persistence: i.source === 'gig' ? L('NCI.Gig.Source') : i.meta?.persistence ? L(`NCI.Controls.Persistence.${i.meta.persistence}`) : '',
      starts: i.onsetTick > time + 1e-6 ? L('NCI.Controls.StartsIn', { n: daysLeft(i.onsetTick, time) }) : L('NCI.Controls.Active'),
    })),
    log: controls.log.slice(-10).reverse().map((e) => ({
      tick: Math.floor(e.tick + 1e-6),
      text: L(`NCI.Log.${e.kind}`, {
        target: e.target ? (parseTarget(e.target) ? targetLabel(parseTarget(e.target), byId) : e.target) : '',
        company: byId.get(e.companyId)?.ticker ?? e.companyId ?? '',
        value: e.value ?? '', days: e.days ?? '', percent: e.percent ?? '', regime: e.regime ?? '',
        from: e.from ?? '', to: e.to ?? '', halted: e.halted ? L('NCI.Controls.Halted') : L('NCI.Controls.Resumed'),
      }),
    })),
    glides: controls.glides.map((g) => ({
      id: g.id,
      label: L('NCI.Glide.Line', { company: byId.get(g.companyId)?.ticker ?? g.companyId, target: money(g.target) }),
      status: g.startTick > time + 1e-6
        ? L('NCI.Glide.StartsIn', { n: daysLeft(g.startTick, time), days: g.duration })
        : L('NCI.Glide.Left', { n: daysLeft(g.startTick + g.duration, time) }),
    })),
    glideNoises: Object.keys(GLIDE_NOISE).map((k) => ({ value: k, label: L(`NCI.Glide.NoiseLevel.${k}`), selected: k === 'medium' })),
    targets: MarketControlService.targetOptions(),
    persistences: Object.keys(SHOCK_PERSISTENCE).map((p) => ({ value: p, label: L(`NCI.Controls.Persistence.${p}`), selected: p === 'standard' })),
    companyOptions: companyOptions(),
  };
}
