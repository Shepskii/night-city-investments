/**
 * Media stories and evidence (F1c)
 * @file scripts/services/StoryService.js
 * @description The GM's side of a Media's story: the check, the die, the market, and the evidence items a
 *              story can draw on. Evidence is an ordinary inventory item with this module's flag, made a
 *              Night City Messenger data shard as well when that module is active. The record of stories
 *              is in the GM's hidden journal.
 */

import {
  ABILITIES, STORY_RULES, percentToAmount, makeImpact, storyCheck, rollStory,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS, HOOKS } from '../utils/constants.js';
import { MarketStore } from '../data/MarketStore.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { L } from '../ui/format.js';
import { BusinessService } from './BusinessService.js';
import { HeatService } from './HeatService.js';
import { MarketClock } from './MarketClockService.js';
import { NewsService } from './NewsService.js';
import { SkillAdapter } from './SkillAdapter.js';
import { TickService } from './TickService.js';

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
    await MarketStore.setStories({ pending: wait ? [...record.pending, story] : record.pending, recent });
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

