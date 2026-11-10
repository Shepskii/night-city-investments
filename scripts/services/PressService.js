/**
 * Stories in the press about characters (S1b, DESIGN §36.13)
 * @file scripts/services/PressService.js
 * @description The GM's side. Each week a character whose heat has been high lately may draw a story. It waits for
 *              the GM if approval is on; once let run, the character is told by mail and has seven days to answer
 *              on their Pending tab. It prints after three days, and what it does lands on the last day. The
 *              record is in the GM's hidden journal. The character's sheet holds only what they may see.
 */

import {
  BUSINESS_DEFAULTS, STORY_RULES, canRun, handPress, isListed, characterPressChance, characterTruths, concealedHolders, createRng, drawCharacterPress, heatPeak, normalizeBusiness,
  notePeak, percentToAmount, makeImpact, printCharacterPress, answerCharacterPress, settleCharacterPress, spansLimit, useKey,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS, HOOKS } from '../utils/constants.js';
import { MarketStore } from '../data/MarketStore.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FactionRepository } from '../data/FactionRepository.js';
import { L } from '../ui/format.js';
import { BusinessService } from './BusinessService.js';
import { ContactService } from './ContactService.js';
import { HeatService } from './HeatService.js';
import { NewsService } from './NewsService.js';
import { SkillAdapter } from './SkillAdapter.js';
import { TickService } from './TickService.js';

const rules = () => BUSINESS_DEFAULTS.press;
const activeGM = () => game.users.activeGM?.id === game.user.id;
const frequency = () => rules().frequency[game.settings.get(MODULE_ID, SETTINGS.PRESS_FREQUENCY)] ?? 0;
const characters = () => game.actors.filter((a) => a.type === 'character' && a.hasPlayerOwner);
const textOf = (headline) => String(headline ?? '').trim().replace(/\s+/g, ' ').slice(0, STORY_RULES.headlineMax);

/** The open businesses this character runs. */
const runBy = (actorId) => BusinessRepository.all().filter((b) => b.status === 'open' && b.partners.some((x) => x.actorId === actorId && x.status === 'active' && !x.npc && !x.market) && canRun(b, actorId));

export const PressService = {
  /** Stories waiting for the GM. */
  held() {
    return MarketStore.getStories().press.stories.filter((s) => s.status === 'held');
  },

  /** The most recent story day for anyone who runs this business, so a crew shares one limit. */
  sharedLastDay(business) {
    const { lastDay } = MarketStore.getStories().press;
    const days = business.partners.map((x) => lastDay[x.actorId]).filter((d) => d != null);
    return days.length ? Math.max(...days) : null;
  },

  async _save(press) {
    await MarketStore.setStories({ ...MarketStore.getStories(), press });
  },

  /** What a character could be drawn for this week, from the businesses they run. */
  _background(actor) {
    const hidden = MarketStore.getBusinessesHidden();
    const corps = FactionRepository.list().filter((f) => f.kind === 'corp');
    const runs = runBy(actor.id);
    let worst = null;
    for (const b of runs) {
      for (const f of corps) {
        const value = hidden[b.id]?.standing?.[f.id]?.value ?? 0;
        if (!worst || value < worst.value) worst = { id: f.id, name: f.name, value, businessId: b.id };
      }
    }
    const stake = BusinessRepository.all().filter((b) => b.status === 'open').flatMap((b) => concealedHolders(b).filter((h) => h.holderId === actor.id).map(() => ({ ticker: b.company.ticker, name: b.name })))[0] ?? null;
    const media = CompanyRepository.all().filter((c) => c.sector === 'media').map((c) => ({ name: c.name, ticker: c.ticker }));
    return { worst: worst && worst.value < 0 ? worst : null, businessId: worst?.businessId ?? runs[0]?.id ?? null, stake, media, lastDays: runs.map((b) => b.press?.lastDay).filter((d) => d != null) };
  },

  /** The week's check for each character. Returns the new stories. */
  _draw(press, day) {
    const week = Math.floor(day / 7);
    const seed = BusinessService.seed();
    const made = [];
    for (const actor of characters()) {
      const peak = heatPeak(press.peaks[actor.id], week);
      const rng = createRng(String(seed), 'press-character', actor.id, week);
      if (!rng.chance(characterPressChance(peak, frequency()))) continue;
      const background = this._background(actor);
      if (spansLimit(day, [press.lastDay[actor.id], ...background.lastDays])) continue;
      const story = drawCharacterPress({ id: foundry.utils.randomID(12), actorId: actor.id, name: actor.name, day, truths: characterTruths(peak, background.stake), ...background, rng });
      if (story) made.push(story);
    }
    return made;
  },

  /** The character is told, and their Pending tab offers an answer. */
  async _open(story) {
    const actor = game.actors.get(story.actorId);
    if (!actor) return;
    const notice = { id: story.id, story: story.story, outlet: story.outlet, deadline: story.deadline };
    await actor.setFlag(MODULE_ID, FLAGS.PRESS_NOTICE, notice);
    // The paper writes for their side of it (M3).
    const from = await ContactService.outlet(story.outlet).catch(() => null);
    await BusinessService._mailAccount(story.actorId, L('NCI.Press.Char.Subject', { name: story.name }), [L(`NCI.Press.Char.Asks.${story.story}`), L('NCI.Press.Char.Told', { outlet: story.outlet, days: rules().character.answerDays })], { from, footer: L('NCI.Press.Char.Footer') });
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, {});
  },

  async _print(story) {
    const die = (await SkillAdapter.rollOne()).value;
    printCharacterPress(story, die);
    const name = story.story === 'hidden' ? story.stake.name : story.name;
    await NewsService.post({ headline: story.headline ?? L(`NCI.Press.Headline.${story.story}`, { name, outlet: story.outlet }), tone: 'down', companyIds: story.story === 'hidden' ? [story.stake.ticker] : [] });
  },

  /** The week is up: what it did lands, and the character hears how it went. */
  async _settle(story) {
    const out = settleCharacterPress(story);
    const actor = game.actors.get(story.actorId);
    if (out.heat) await HeatService.setHeat(story.actorId, HeatService.heatOf(story.actorId) + out.heat);
    if (out.reputation && story.businessId) {
      const stored = BusinessRepository.get(story.businessId);
      if (stored) {
        const b = normalizeBusiness(structuredClone(stored));
        b.state.reputation = Math.max(0, Math.min(100, b.state.reputation + out.reputation));
        await BusinessRepository.save(b);
      }
    }
    if (out.percent && story.stake) {
      const key = `press:${story.id}`;
      await TickService.updateControls((controls, { tick: now }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
        ...controls,
        impacts: [...controls.impacts, makeImpact({
          id: `imp_press_${story.id}`, target: { type: 'company', id: story.stake.ticker }, amount: percentToAmount(out.percent), onsetTick: now + BUSINESS_DEFAULTS.ownership.scandal.delayDays,
          permanent: 1, sourceKey: key, source: 'press', meta: { percent: out.percent },
        })],
      }));
    }
    const result = !story.believed ? 'Ignored' : out.scale === 0 ? 'Answered' : out.scale < 1 ? 'Halved' : 'Full';
    await BusinessService._mailAccount(story.actorId, L('NCI.Press.Char.ResultSubject'), [L(`NCI.Press.Char.${result}`, { outlet: story.outlet })], { from: await ContactService.outlet(story.outlet).catch(() => null), footer: L(`NCI.Press.Char.${result}Footer`) });
    await actor?.unsetFlag(MODULE_ID, FLAGS.PRESS_NOTICE);
  },

  /** Each tick: note heat at its height, make the week's check, and move every open story on. */
  onTick() {
    if (!activeGM()) return Promise.resolve();
    return BusinessService._queue.run(async () => {
      const day = BusinessService.day();
      const week = Math.floor(day / 7);
      const press = structuredClone(MarketStore.getStories().press);
      const before = JSON.stringify(press);
      const heatOn = HeatService.enabled();
      if (heatOn) {
        for (const actor of characters()) {
          const heat = HeatService.heatOf(actor.id);
          if (heat > 0 || press.peaks[actor.id]) press.peaks[actor.id] = notePeak(press.peaks[actor.id], week, heat);
          if (!Object.keys(press.peaks[actor.id] ?? {}).length) delete press.peaks[actor.id];
        }
      }
      if (press.lastCheck == null || day < press.lastCheck) press.lastCheck = day;
      else if (day - press.lastCheck >= 7) {
        press.lastCheck = day;
        if (heatOn && frequency()) {
          const approval = game.settings.get(MODULE_ID, SETTINGS.PRESS_APPROVAL) !== false;
          for (const story of this._draw(press, day)) {
            press.lastDay[story.actorId] = day;
            press.stories.push(approval ? story : this._started(story, day));
            if (!approval) await this._open(press.stories.at(-1));
          }
        }
      }
      const keep = [];
      for (const story of press.stories) {
        if (story.status === 'held' && day - story.day > rules().character.answerDays) continue;
        if (story.status === 'open' && !story.printed && day >= story.printDay) await this._print(story);
        if (story.status === 'open' && day >= story.deadline) {
          if (!story.printed) await this._print(story);
          await this._settle(story);
          continue;
        }
        keep.push(story);
      }
      press.stories = keep;
      if (JSON.stringify(press) !== before) await this._save(press);
    });
  },

  _started(story, day, headline = null) {
    const words = textOf(headline);
    return { ...story, status: 'open', printDay: day + rules().printDays, deadline: day + rules().character.answerDays, ...(words ? { headline: words } : {}) };
  },

  _decide(id, fn) {
    if (!activeGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return BusinessService._queue.run(async () => {
      const press = structuredClone(MarketStore.getStories().press);
      const at = press.stories.findIndex((s) => s.id === id && s.status === 'held');
      if (at < 0) return { ok: false, reason: 'no-story' };
      await fn(press, at);
      await this._save(press);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, {});
      return { ok: true };
    });
  },

  /** The GM lets a waiting story run, under the headline they want. */
  approve(id, headline) {
    return this._decide(id, async (press, at) => {
      press.stories[at] = this._started(press.stories[at], BusinessService.day(), headline);
      await this._open(press.stories[at]);
    });
  },

  /** What Run a story offers on Market > Events (S1c). */
  runOptions() {
    const name = (group, kinds) => kinds.map((k) => ({ value: k, label: L(`NCI.Press.Story.${k}`), group }));
    return {
      businesses: BusinessRepository.all().filter((b) => b.status === 'open').map((b) => ({ value: `b:${b.id}`, label: b.name })),
      characters: characters().map((a) => ({ value: `a:${a.id}`, label: a.name })),
      businessKinds: name('business', Object.keys(rules().kinds)),
      characterKinds: name('character', Object.keys(rules().character.kinds)),
      corps: FactionRepository.list().filter((f) => f.kind === 'corp').map((f) => ({ value: `f:${f.id}`, label: f.name })),
      media: CompanyRepository.all().filter((c) => c.sector === 'media').map((c) => ({ value: `m:${c.ticker}`, label: c.name })),
    };
  },

  /** Who prints it, from the form's value. A market media company carries more weight than a corporation's own press. */
  _outlet(value) {
    const [type, id] = String(value ?? '').split(':');
    if (type === 'f') {
      const faction = FactionRepository.list().find((f) => f.id === id && f.kind === 'corp');
      return faction ? { name: faction.name, rank: rules().rank.own, factionId: faction.id } : null;
    }
    const company = type === 'm' ? CompanyRepository.all().find((c) => c.ticker === id && c.sector === 'media') : null;
    return company ? { name: company.name, rank: rules().rank.media } : null;
  },

  /**
   * The GM runs a story by hand, whatever the chance and with no approval to wait for.
   * @param {{target: string, story: string, outlet: string, headline?: string, believed?: string}} o - `believed` is '', 'yes' or 'no'
   * @returns {Promise<{ok: boolean, when?: 'now'|'next', reason?: string}>}
   */
  async run({ target, story, outlet, headline = '', believed = '' }) {
    if (!activeGM()) return { ok: false, reason: 'not-gm' };
    const [type, id] = String(target ?? '').split(':');
    const paper = this._outlet(outlet);
    if (!paper) return { ok: false, reason: 'press-no-outlet' };
    const force = believed === 'yes' ? true : believed === 'no' ? false : null;
    if (type === 'b') {
      if (!rules().kinds[story]) return { ok: false, reason: 'press-bad-kind' };
      if (story === 'crime' && !BusinessService.underworldOn()) return { ok: false, reason: 'press-no-underworld' };
      const done = await BusinessService.runPress(id, handPress({ story, outlet: paper, headline: textOf(headline), believed: force }));
      if (!done.ok) return done;
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: id });
      return { ok: true, when: done.business.press?.queued ? 'next' : 'now' };
    }
    return type === 'a' ? this._runCharacter(id, { story, paper, headline, force }) : { ok: false, reason: 'no-target' };
  },

  _runCharacter(actorId, { story, paper, headline, force }) {
    return BusinessService._queue.run(async () => {
      const actor = game.actors.get(actorId);
      if (!actor) return { ok: false, reason: 'no-target' };
      if (!rules().character.kinds[story]) return { ok: false, reason: 'press-bad-kind' };
      if (!HeatService.enabled()) return { ok: false, reason: 'press-no-heat' };
      const press = structuredClone(MarketStore.getStories().press);
      if (press.stories.some((s) => s.actorId === actorId && s.status === 'open')) return { ok: false, reason: 'press-busy' };
      const background = this._background(actor);
      if (story === 'hidden' && !background.stake) return { ok: false, reason: 'press-no-stake' };
      const day = BusinessService.day();
      const started = this._started({
        id: foundry.utils.randomID(12), actorId, name: actor.name, day, status: 'held', story, outlet: paper.name, grudge: null, rank: paper.rank, businessId: background.businessId,
        ...(story === 'hidden' ? { stake: background.stake } : {}), ...(force == null ? {} : { force }),
      }, day, headline);
      // The GM's own story takes the place of one still waiting for them.
      press.stories = [...press.stories.filter((s) => s.actorId !== actorId), started];
      press.lastDay[actorId] = day;
      await this._open(started);
      await this._save(press);
      return { ok: true, when: 'now' };
    });
  },

  /** Stories let run and not yet printed, which a Media may hear of. A held one may yet be spiked, so it is not news. */
  rumourSources() {
    const day = BusinessService.day();
    const lag = BUSINESS_DEFAULTS.ownership.scandal.delayDays;
    const aboutCharacters = MarketStore.getStories().press.stories.filter((s) => s.status === 'open' && !s.printed).map((s) => {
      const hidden = s.story === 'hidden';
      return { sourceKey: `press:${s.id}`, kind: 'press', ticker: hidden ? s.stake.ticker : null, name: hidden ? s.stake.name : s.name, by: s.actorId, outlet: s.outlet, story: s.story, days: Math.max(1, s.printDay - day), closeIn: s.deadline - day + lag };
    });
    const aboutBusinesses = BusinessRepository.all().filter((b) => b.status === 'open' && b.period?.event?.kind === 'press' && !b.period.event.printed).map((b) => ({
      sourceKey: `press:${b.id}:${b.period.index}`, kind: 'press', ticker: isListed(b) ? b.company.ticker : null, name: b.name, outlet: b.period.event.factionName, story: b.period.event.story, days: Math.max(1, b.period.event.printDay - day), closeIn: b.period.endDay - day + lag,
    }));
    return [...aboutCharacters, ...aboutBusinesses];
  },

  /** The GM spikes it. The 28 days still run from when it was drawn. */
  spike(id) {
    return this._decide(id, (press, at) => { press.stories.splice(at, 1); });
  },

  /** A character answers a story. Runs in the GM's request queue. */
  async answer(actor, request) {
    const press = structuredClone(MarketStore.getStories().press);
    const story = press.stories.find((s) => s.id === request.storyId && s.actorId === actor.id && s.status === 'open');
    if (!story) return { ok: false, reason: 'no-press' };
    if (story.answer) return { ok: false, reason: 'press-answered' };
    const use = rules().character.uses.find((u) => useKey(u) === useKey(request.use ?? {})) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: rules().character.answerDv, use });
    if (!check.ok) return check;
    answerCharacterPress(story, check.result.band);
    await this._save(press);
    await actor.setFlag(MODULE_ID, FLAGS.PRESS_NOTICE, { ...actor.getFlag(MODULE_ID, FLAGS.PRESS_NOTICE), answered: true });
    return { ok: true, press: { band: check.result.band } };
  },
};
