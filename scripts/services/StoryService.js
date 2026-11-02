/**
 * Media stories and evidence (F1c)
 * @file scripts/services/StoryService.js
 * @description The GM's side of a Media's story: the check, the die, the market, and the evidence items a
 *              story can draw on. Evidence is an ordinary inventory item with this module's flag, made a
 *              Night City Messenger data shard as well when that module is active. The record of stories
 *              is in the GM's hidden journal.
 */

import {
  ABILITIES, SKILLS, STORY_RULES, RUMOUR_LEVELS, percentToAmount, makeImpact, storyCheck, rollStory, rumourLevel, freshRumours, concealedHolders, useKey,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS, HOOKS } from '../utils/constants.js';
import { MarketStore } from '../data/MarketStore.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { L } from '../ui/format.js';
import { BusinessService } from './BusinessService.js';
import { HeatService } from './HeatService.js';
import { MailService } from './MailService.js';
import { MarketClock } from './MarketClockService.js';
import { NewsService } from './NewsService.js';
import { SkillAdapter } from './SkillAdapter.js';
import { TickService } from './TickService.js';

/** What a Media can dig for rumours with. */
export const RUMOUR_USES = Object.freeze([SKILLS.conversation, SKILLS.streetwise, SKILLS.librarySearch]);

const flagOf = (item) => item.getFlag?.(MODULE_ID, FLAGS.EVIDENCE) ?? item.flags?.[MODULE_ID]?.[FLAGS.EVIDENCE] ?? null;

/** An item type this world's system has that suits a shard. */
function itemType() {
  const types = game.system?.documentTypes?.Item;
  const list = Array.isArray(types) ? types : Object.keys(types ?? {});
  return list.includes('gear') ? 'gear' : list[0] ?? 'gear';
}

export const StoryService = {
  /** The character's unused evidence about this company. Works on any client. */
  evidenceOf(actor, ticker) {
    return [...(actor?.items ?? [])].filter((item) => {
      const flag = flagOf(item);
      return flag && !flag.used && flag.ticker === ticker;
    });
  },

  /** A character's Credibility rank. */
  rankOf(actor) {
    return actor && !actor.isSyndicate ? SkillAdapter.baseFor(actor, ABILITIES.credibility).base : 0;
  },

  /** GM only: put a piece of evidence about a company in a character's inventory. */
  async grantEvidence(actor, { ticker, name, note, source = 'gm' }) {
    if (!game.user.isGM || !actor) return { ok: false, reason: 'not-gm' };
    let item;
    try {
      [item] = await actor.createEmbeddedDocuments('Item', [{
        name: L('NCI.Story.ShardName', { name }),
        type: itemType(),
        img: 'icons/commodities/tech/circuit-board-green.webp',
        system: { description: { value: note } },
        flags: { [MODULE_ID]: { [FLAGS.EVIDENCE]: { ticker, name, note, source, used: false, day: BusinessService.day() } } },
      }]);
    } catch (error) {
      // Whatever found it (an investigation, say) still stands.
      console.warn('night-city-investments | could not create evidence', error);
      return { ok: false, reason: 'no-evidence-item' };
    }
    // Readable through Night City Messenger, where that is active; it works without.
    const messenger = game.nightcity?.messenger;
    if (item && messenger?.convertToDataShard) {
      try {
        const done = await messenger.convertToDataShard(item);
        if (done?.success !== false) await messenger.addShardMessage?.(item, { from: L('NCI.Story.ShardFrom'), to: actor.name, subject: L('NCI.Story.ShardName', { name }), body: note });
      } catch (error) {
        console.warn('night-city-investments | could not make a Messenger shard of evidence', error);
      }
    }
    return { ok: true, item };
  },

  /** What there is to hear now, on one company or all: queued price moves not yet showing, and hidden holdings. */
  rumourSources(ticker = null) {
    const now = MarketStore.time();
    const companies = CompanyRepository.all();
    const nameOf = (id) => companies.find((c) => c.ticker === id || c.id === id);
    const moves = MarketStore.getControls().impacts
      .filter((i) => i.target?.type === 'company' && i.onsetTick > now && ['gig', 'report', 'campaign', 'story'].includes(i.source) && nameOf(i.target.id))
      .map((i) => ({
        sourceKey: i.sourceKey, kind: 'move', ticker: nameOf(i.target.id).ticker, name: nameOf(i.target.id).name, by: i.meta?.actorId,
        why: i.source, up: i.amount > 0, percent: Math.abs(Math.round((Math.exp(i.amount) - 1) * 1000) / 10), days: Math.max(1, Math.ceil(i.onsetTick - now)),
      }));
    const holdings = BusinessRepository.all().filter((b) => b.status === 'open').flatMap((b) => concealedHolders(b).map((h) => ({
      sourceKey: `hidden:${b.id}:${h.holderId}`, kind: 'hidden', ticker: b.company.ticker, name: b.name, by: h.holderId, percent: Math.round(h.share * 100), layer: b.masks[h.holderId]?.at(-1)?.name ?? '',
    })));
    return [...moves, ...holdings].filter((s) => !ticker || s.ticker === ticker);
  },

  /** A rumour in words, saying more at each level. */
  _rumourText(source, level) {
    const word = RUMOUR_LEVELS[level];
    return L(`NCI.Rumour.${source.kind}.${word}`, {
      name: source.name, ticker: source.ticker, percent: source.percent, days: source.days, layer: source.layer,
      way: source.kind === 'move' ? L(source.up ? 'NCI.Rumour.Up' : 'NCI.Rumour.Down') : '',
      why: source.kind === 'move' ? L(`NCI.Rumour.Why.${source.why}`) : '',
    });
  },

  /** Tell a Media the best they have not heard; returns whether there was anything. */
  async _tell(actor, sources, level, rumours) {
    const mine = rumours[actor.id] ?? {};
    const [source] = freshRumours(sources, mine.told, level, actor.id);
    if (!source) return false;
    await MailService.fromWire(actor, { subject: L('NCI.Rumour.Subject', { name: source.name }), lines: [this._rumourText(source, level)] });
    rumours[actor.id] = { ...mine, told: { ...(mine.told ?? {}), [source.sourceKey]: level } };
    // They heard it: trading on it now is following a rumour.
    if (source.kind === 'move') await HeatService.noteTipped(source.sourceKey, actor.id);
    return true;
  },

  /** Each Media hears what is going round, every few days: Credibility rank + 1d10 against the passive DVs. */
  async onTick() {
    if (game.users.activeGM?.id !== game.user.id) return;
    const medias = game.actors.filter((a) => a.type === 'character' && a.hasPlayerOwner && this.rankOf(a) > 0);
    if (!medias.length) return;
    const day = BusinessService.day();
    const record = MarketStore.getStories();
    const rumours = { ...record.rumours };
    const sources = this.rumourSources();
    let changed = false;
    for (const actor of medias) {
      const last = rumours[actor.id]?.heard;
      if (last != null && day - last < STORY_RULES.rumour.passiveDays) continue;
      rumours[actor.id] = { ...rumours[actor.id], heard: day };
      changed = true;
      const die = (await SkillAdapter.rollOne()).value;
      const level = rumourLevel(this.rankOf(actor) + die, STORY_RULES.rumour.passive);
      if (level >= 0) await this._tell(actor, sources, level, rumours);
    }
    if (changed) await MarketStore.setStories({ ...MarketStore.getStories(), rumours });
  },

  /** A Media digs for what is being said about one company, once a week. Runs in the GM's request queue. */
  async digRumours(actor, request) {
    if (this.rankOf(actor) < 1) return { ok: false, reason: 'not-media' };
    const ticker = String(request.ticker ?? '').trim().toUpperCase();
    if (!CompanyRepository.all().some((c) => c.ticker === ticker)) return { ok: false, reason: 'no-target' };
    const use = (request.use && RUMOUR_USES.find((u) => useKey(u) === useKey(request.use))) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const day = BusinessService.day();
    const record = MarketStore.getStories();
    const last = record.rumours[actor.id]?.dug;
    if (last != null && day - last < STORY_RULES.rumour.activeDays) return { ok: false, reason: 'rumour-wait' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: STORY_RULES.rumour.active[0], use });
    if (!check.ok) return check;
    const rumours = { ...record.rumours, [actor.id]: { ...record.rumours[actor.id], dug: day } };
    const level = rumourLevel(check.result.total, STORY_RULES.rumour.active);
    const found = level >= 0 && await this._tell(actor, this.rumourSources(ticker), level, rumours);
    await MarketStore.setStories({ ...record, rumours });
    return { ok: true, rumour: { found } };
  },

  /** Waiting for the GM. */
  pending() {
    return MarketStore.getStories().pending;
  },

  /** A Media's request to publish. Runs in the GM's request queue. */
  async publish(actor, request) {
    const ticker = String(request.ticker ?? '').trim().toUpperCase();
    const company = CompanyRepository.all().find((c) => c.ticker === ticker);
    if (!company) return { ok: false, reason: 'no-target' };
    const items = (Array.isArray(request.evidence) ? request.evidence : []).map((id) => actor.items?.get?.(id)).filter(Boolean)
      .filter((item) => { const f = flagOf(item); return f && !f.used && f.ticker === ticker; });
    const rank = this.rankOf(actor);
    const angle = request.angle;
    const day = BusinessService.day();
    const record = MarketStore.getStories();
    const check = storyCheck({ rank, angle, ticker, day, actorId: actor.id, pieces: items.length, recent: record.recent });
    if (!check.ok) return check;

    // Luck cannot be spent on this, so the GM's service rolls it.
    const die = (await SkillAdapter.rollOne()).value;
    const { target, believed, percent } = rollStory({ rank, pieces: items.length, die, angle });
    for (const item of items) await item.setFlag(MODULE_ID, FLAGS.EVIDENCE, { ...flagOf(item), used: true });
    const headline = String(request.headline ?? '').trim().replace(/\s+/g, ' ').slice(0, STORY_RULES.headlineMax);
    const story = {
      id: foundry.utils.randomID(12), actorId: actor.id, media: actor.name, ticker, name: company.name, angle, percent, day, rank, headline,
    };
    const recent = [...record.recent, { actorId: actor.id, ticker, day }];
    const wait = believed && game.settings.get(MODULE_ID, SETTINGS.CAMPAIGN_APPROVAL) !== false;
    await MarketStore.setStories({ ...record, pending: wait ? [...record.pending, story] : record.pending, recent });
    if (believed && !wait) await this._land(story);
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, {});
    return { ok: true, story: { believed, die, target, waiting: wait } };
  },

  /** A believed story reaches the market: a headline under the Media's name, the price, and the heat. */
  async _land(story) {
    const { actorId, media, ticker, name, angle, percent, day, rank, headline, id } = story;
    const key = `story:${id}`;
    const up = angle === 'puff';
    await NewsService.post({
      headline: headline ? L('NCI.News.StoryBy', { media, headline }) : L(up ? 'NCI.News.StoryPuff' : 'NCI.News.StoryExpose', { media, name, ticker }),
      tone: up ? 'up' : 'down',
      companyIds: [ticker],
    });
    await TickService.updateControls((controls, { tick: now }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
      ...controls,
      impacts: [...controls.impacts, makeImpact({
        id: `imp_story_${id}`, target: { type: 'company', id: ticker }, amount: percentToAmount(percent), onsetTick: now + STORY_RULES.delayDays,
        permanent: 1, sourceKey: key, source: 'story', meta: { percent, actorId, day },
      })],
    }));
    await HeatService.openWindow(
      { sourceKey: key, companyId: ticker, outcome: up ? 'success' : 'failed', date: MarketClock.dateString(), delayDays: STORY_RULES.delayDays },
      { runners: [actorId] },
    );
    // Writing about what you hold is market manipulation.
    const actor = game.actors.get(actorId);
    const company = CompanyRepository.all().find((c) => c.ticker === ticker);
    const held = actor ? PortfolioRepository.get(actor)?.lots?.some((lot) => lot.assetId === company?.id && lot.qty > 0) : false;
    if (held && HeatService.enabled()) await HeatService.setHeat(actorId, HeatService.heatOf(actorId) + STORY_RULES.holdingHeat);
    // A big enough exposé brings the regulators to a player's company.
    if (!up && rank >= STORY_RULES.caseRank) {
      const business = BusinessRepository.all().find((b) => b.status === 'open' && b.company?.ticker === ticker);
      if (business) await BusinessService.openCaseForStory(business.id);
    }
  },

  _decide(id, fn) {
    if (game.users.activeGM?.id !== game.user.id) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return BusinessService._queue.run(async () => {
      const record = MarketStore.getStories();
      const story = record.pending.find((s) => s.id === id);
      if (!story) return { ok: false, reason: 'no-story' };
      await MarketStore.setStories({ ...record, pending: record.pending.filter((s) => s !== story) });
      await fn(story);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, {});
      return { ok: true };
    });
  },

  /** The GM lets a believed story run. */
  approve(id) {
    return this._decide(id, (story) => this._land(story));
  },

  /** The GM spikes it: its evidence stays used, and the Media is told. */
  reject(id) {
    return this._decide(id, (story) => BusinessService._mailAccount(story.actorId, L('NCI.Story.SpikedSubject', { name: story.name }), [L('NCI.Story.Spiked', { name: story.name })]));
  },
};

