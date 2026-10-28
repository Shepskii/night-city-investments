/**
 * GM Console market tab: the clock, sentiment, regime, volatility, halt and undo.
 * @file scripts/ui/GMConsole/tabs/market.js
 * @description Action handlers run with `this` set to the console window.
 */

import { REGIMES, timeOf } from '../../../engine/index.js';
import { MODULE_ID, SETTINGS } from '../../../utils/constants.js';
import { L, daysLeft } from '../../format.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { MarketClock } from '../../../services/MarketClockService.js';
import { TickService } from '../../../services/TickService.js';
import { UndoService } from '../../../services/UndoService.js';
import { MarketControlService } from '../../../services/MarketControlService.js';
import { field, confirm, report, targetLabel, companiesById } from '../shared.js';

async function onAdvance(event, target) {
  await TickService.advance(Number(target.dataset.days) || 1);
}

async function onAdvanceDay(event, target) {
  await TickService.advanceDays(Number(target.dataset.days) || 1);
}

async function onAdvanceCustom(event, target) {
  const days = Math.floor(Number(field(target, 'customDays')));
  if (!(days >= 1)) return ui.notifications.warn(L('NCI.GMConsole.InvalidDays'));
  await TickService.advance(days);
}

async function onReset() {
  if (!(await confirm(L('NCI.GMConsole.Reset'), L('NCI.GMConsole.ResetConfirm')))) return;
  await TickService.reset();
}

async function onAddBias(event, target) {
  report(await MarketControlService.addBias({
    target: field(target, 'biasTarget'),
    value: Number(field(target, 'biasValue')),
    days: Number(field(target, 'biasDays')),
    decay: field(target, 'biasDecay'),
  }));
}

async function onRemoveBias(event, target) {
  await MarketControlService.removeBias(target.dataset.id);
}

async function onForceRegime(event, target) {
  report(await MarketControlService.forceRegime(field(target, 'regime'), Number(field(target, 'regimeDays'))));
}

async function onClearRegime() {
  await MarketControlService.clearRegime();
}

async function onSetVolatility(event, target) {
  report(await MarketControlService.setVolatility(Number(field(target, 'volMult'))));
}

async function onToggleHalt(event, target) {
  await MarketControlService.setHalt(target.dataset.halted !== 'true');
}

async function onUndo() {
  const out = await UndoService.undo();
  if (out.ok) ui.notifications.info(L('NCI.GMConsole.UndoDone', { tick: out.tickIndex }));
  else ui.notifications.warn(L(`NCI.GMConsole.Undo.${out.reason}`));
}

function onPreviewBias(event, target) {
  this._togglePreview('bias', () => {
    const days = Number(field(target, 'biasDays'));
    const scenario = {
      kind: 'bias', target: field(target, 'biasTarget'), value: Number(field(target, 'biasValue')), days, decay: field(target, 'biasDecay'),
    };
    this._showPreview(scenario, Math.min(120, Math.max(30, days + 10)), L('NCI.Controls.Sentiment'));
  });
}

export const actions = {
  advance: onAdvance,
  advanceDay: onAdvanceDay,
  advanceCustom: onAdvanceCustom,
  resetMarket: onReset,
  addBias: onAddBias,
  removeBias: onRemoveBias,
  forceRegime: onForceRegime,
  clearRegime: onClearRegime,
  setVolatility: onSetVolatility,
  toggleHalt: onToggleHalt,
  undoTick: onUndo,
  previewBias: onPreviewBias,
};

export function context(app) {
  const pub = MarketStore.getPublic();
  const hidden = MarketStore.getHidden();
  const controls = MarketStore.getControls();
  const byId = companiesById();
  // Every duration below is on the market clock, in game days.
  const time = timeOf(pub);
  const tickMode = game.settings.get(MODULE_ID, SETTINGS.TICK_MODE);
  return {
    previewBias: app.preview?.kind === 'bias' ? app.preview : null,
    canUndo: UndoService.available(),
    mode: L(`NCI.Settings.TickMode.${{ worldTime: 'WorldTime', realTime: 'RealTime', manual: 'Manual' }[tickMode]}`),
    date: MarketClock.dateString(),
    tick: pub.tickIndex ?? 0,
    gameDay: Math.floor(time + 1e-6),
    mood: pub.mood ? L(`NCI.Mood.${pub.mood}`) : '—',
    regime: hidden?.regime ? L(`NCI.Regime.${hidden.regime}`) : '—',
    forcedRegime: controls.forceRegime
      ? L('NCI.Controls.ForcedRegime', { regime: L(`NCI.Regime.${controls.forceRegime.regime}`), n: daysLeft(controls.forceRegime.untilTick, time) })
      : '',
    volMult: controls.volMult,
    haltAll: controls.haltAll,
    biases: controls.biases.map((b) => ({
      id: b.id,
      label: `${targetLabel(b.target, byId)}: ${b.value > 0 ? '+' : ''}${b.value}σ`,
      left: daysLeft(b.startTick + b.duration, time),
      decay: L(`NCI.Controls.Decay.${b.decay}`),
      pending: b.startTick > time + 1e-6,
    })),
    targets: MarketControlService.targetOptions(),
    regimes: REGIMES.map((r) => ({ value: r, label: L(`NCI.Regime.${r}`) })),
  };
}
