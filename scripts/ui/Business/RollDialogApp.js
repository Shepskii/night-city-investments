/**
 * Roll dialog: the levers a player picks before a business roll, and what is at stake (DESIGN §26).
 * @file scripts/ui/Business/RollDialogApp.js
 * @description Shows who rolls with what, the approach, Luck and any complementary bonus, and a
 *              preview of the DV and of each outcome band's chance, updated as the choices change.
 *              Nothing is rolled until the player presses Roll.
 */

import { rollSpec, previewRoll, normalizeLevers, hireFee, HIRE_TIERS, APPROACHES, MAX_LUCK_PER_ROLL, useKey, EVENTS, activeStaff } from '../../engine/index.js';
import { MODULE_ID } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { accountFor } from '../accounts.js';
import { BusinessClient, operatorRankOf } from '../../services/BusinessClient.js';
import { SkillAdapter } from '../../services/SkillAdapter.js';
import { BaseApplication } from '../BaseApplication.js';
import { L, whole } from '../format.js';
import { actorLink } from '../actorLink.js';
import { escapeHtml } from '../../utils/text.js';

const useLabel = (use) => (use.kind === 'ability' ? use.ability : use.skill);

export class RollDialogApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    tag: 'form',
    window: { title: 'NCI.Roll.Title', icon: 'fas fa-dice-d10', resizable: false },
    position: { width: 460, height: 'auto' },
    form: { handler: RollDialogApp._onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { cancel: RollDialogApp._onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/dialogs/roll.hbs` },
  };

  /** Open the dialog for one roll. `afterRoll` runs once the roll has been made and sent (not on Cancel). */
  static ask({ actorId, businessId, request, title, afterRoll = null }) {
    const app = new RollDialogApp({ id: `nci-roll-${String(actorId).replace(/[^\w-]/g, '_')}-${businessId}`, actorId, businessId, request, rollTitle: title, afterRoll });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
    this.businessId = options.businessId;
    this.request = options.request;
    this.rollTitle = options.rollTitle;
    this.afterRoll = options.afterRoll ?? null;
    /** What the player has chosen so far: `use` is a use key, or `hire:<tier>`. */
    this.choice = { use: null, approach: 'standard', luck: 0, bonus: true, extra: false };
  }

  /** The account the roll is for: a character, or a syndicate picked as one of its officers. */
  get account() {
    return accountFor(this.actorId);
  }

  /** Who rolls: the character, or the officer acting for the syndicate. */
  get actor() {
    const account = this.account;
    return account?.isSyndicate ? account.as : account;
  }

  /** The business partner the roll counts for. */
  get partnerId() {
    return this.account?.id ?? null;
  }

  get business() {
    return BusinessRepository.get(this.businessId);
  }

  static _onCancel() {
    return this.close();
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // The window's own element stays across renders, so one listener re-draws the preview on each change.
    this.element.addEventListener('change', () => {
      const data = new FormData(this.element);
      this.choice = {
        use: data.get('use'),
        approach: data.get('approach') ?? 'standard',
        luck: Math.floor(Number(data.get('luck')) || 0),
        bonus: data.get('bonus') === 'on',
        extra: data.get('extra') === 'on',
      };
      this.render();
    });
  }

  /** The ways this roll may be made, as this character would make them. */
  _options(spec) {
    const actor = this.actor;
    const rank = operatorRankOf(this.business);
    const own = spec.uses.map((use) => {
      const { base } = SkillAdapter.baseFor(actor, use);
      const kind = use.kind === 'ability' ? L('NCI.Roll.AbilityRank', { rank: base }) : L('NCI.Roll.SkillBase', { base });
      const harder = use.dvAdd ? `, ${L('NCI.Roll.DvAdd', { n: use.dvAdd })}` : '';
      return { key: useKey(use), use, base, label: `${useLabel(use)} (${kind}${harder})` };
    })
      // A role ability the character does not have is not offered; a skill at 0 still rolls on its stat.
      .filter((o) => o.use.kind !== 'ability' || o.base > 0)
      .sort((a, b) => b.base - a.base);
    // Only the hires the business can pay for (a registration also needs its fee left in the till).
    const affordable = (tier) => rollSpec(this.business, { ...this.request, use: { kind: 'hire', hire: tier } }, this.partnerId, { day: BusinessClient.day(), operatorRank: rank }).ok;
    const hires = spec.allowHire
      ? Object.entries(HIRE_TIERS).filter(([tier]) => affordable(tier)).map(([tier, base]) => ({
        key: `hire:${tier}`, use: { kind: 'hire', hire: tier }, base, label: L('NCI.Roll.HireOption', { who: L(`NCI.Roll.Hire.${tier}`), base, fee: whole(hireFee(tier, rank)) }),
      }))
      : [];
    // Employees who can be called in for this roll, each with their best for it and the overtime (DESIGN §33).
    const staff = activeStaff(this.business).map((s) => {
      const call = rollSpec(this.business, { ...this.request, use: { kind: 'staff', staffId: s.id } }, this.partnerId, { day: BusinessClient.day(), operatorRank: rank });
      if (!call.ok) return null;
      const via = call.use.via.replace(/^(skill|ability):/, '');
      return {
        key: `staff:${s.id}`, use: { kind: 'staff', staffId: s.id }, base: call.use.base, dvAdd: call.dv - spec.dv, overtime: call.overtime,
        label: L('NCI.Roll.StaffOption', { name: s.name, via, base: call.use.base, pay: whole(call.overtime) }),
      };
    }).filter(Boolean);
    return [...own, ...hires, ...staff];
  }

  static async _onSubmit() {
    const actor = this.actor;
    const business = this.business;
    const spec = actor && business ? this._spec() : null;
    const option = spec?.ok ? this._options(spec).find((o) => o.key === this.choice.use) ?? this._options(spec)[0] : null;
    if (!option) return ui.notifications.warn(L('NCI.Roll.NothingToRoll'));
    const key = await BusinessClient.roll(this.account, business, { ...this.request, use: option.use }, {
      title: this.rollTitle,
      levers: { approach: this.choice.approach, luck: this.choice.luck, bonus: this.choice.bonus ? 1 : 0, extra: this.choice.extra ? 1 : 0 },
    });
    await this.close();
    if (key) await this.afterRoll?.();
  }

  /** Whether the roll can be made now, and the ways it may be made (no use named yet). */
  _spec() {
    return rollSpec(this.business, { ...this.request, use: null }, this.partnerId, { day: BusinessClient.day(), operatorRank: operatorRankOf(this.business) });
  }

  async _prepareContext() {
    const actor = this.actor;
    const business = this.business;
    if (!actor || !business) return { title: this.rollTitle, blocked: L('NCI.Business.Reason.no-business') };
    const full = this._spec();
    if (!full.ok) return { title: this.rollTitle, blocked: L(`NCI.Business.Reason.${full.reason}`) };

    const options = this._options(full);
    const chosen = options.find((o) => o.key === this.choice.use) ?? options[0];
    const isStaff = chosen?.use.kind === 'staff';
    // Neither a hired professional nor an employee uses the character's Luck or business days.
    const isHire = chosen?.use.kind === 'hire' || isStaff;
    const luckMax = isHire ? 0 : Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
    const extraAvailable = full.extraAvailable && !isHire;
    const levers = normalizeLevers({
      approach: this.choice.approach,
      luck: Math.min(this.choice.luck, luckMax),
      bonus: full.bonusAvailable && this.choice.bonus ? 1 : 0,
      extra: extraAvailable && this.choice.extra ? 1 : 0,
      hire: chosen?.use.kind === 'hire' ? chosen.use.hire : null,
    });
    // Some uses roll at a higher DV (an alternative skill).
    const preview = previewRoll({ base: chosen?.base ?? 0, dv: full.dv + (chosen?.dvAdd ?? chosen?.use.dvAdd ?? 0), levers });
    const pct = (x) => `${Math.round(x * 100)}%`;
    const good = this.request.type === 'respond' && EVENTS[business.period?.event?.kind]?.good;
    const meaning = this.request.type === 'action' ? this.request.action
      : this.request.type === 'charterRoll' ? `charter.${this.request.part}`
        : ['auditRoll', 'diligenceRoll', 'recruitRoll', 'vetRoll'].includes(this.request.type) ? this.request.type
        : good ? 'respondGood' : this.request.type;

    return {
      title: this.rollTitle,
      // HTML: the character rolling links to their sheet.
      actorName: this.account?.isSyndicate
        ? escapeHtml(L('NCI.Syndicate.PickerLabel', { name: this.account.name, as: '\u0000' })).replace('\u0000', actorLink(actor.id, actor.name))
        : actorLink(actor.id, actor.name),
      uses: options.map((o) => ({ key: o.key, label: o.label, selected: o.key === chosen?.key })),
      approaches: Object.keys(APPROACHES).map((id) => ({ id, label: L(`NCI.Roll.Approach.${id}`), hint: L(`NCI.Roll.ApproachHint.${id}`), checked: id === levers.approach })),
      luck: levers.luck,
      luckMax,
      noLuck: isHire,
      bonusAvailable: full.bonusAvailable,
      bonus: !!levers.bonus,
      extraAvailable,
      extra: !!levers.extra,
      dv: preview.dv,
      chance: pct(preview.chance),
      // A 1 is a fumble roll and a 10 adds a die, so "or more" only reads true between them.
      needed: preview.needed <= 2 ? L('NCI.Roll.NeededAny') : preview.needed > 10 ? L('NCI.Roll.NeededCrit') : L('NCI.Roll.Needed', { n: preview.needed }),
      bands: preview.bands.filter((b) => b.chance > 0).reverse().map((b) => ({
        label: L(`NCI.Roll.Band.${b.band}`), chance: pct(b.chance), meaning: L(`NCI.Roll.Meaning.${meaning}.${b.band}`),
      })),
      hireNote: isStaff ? L('NCI.Roll.StaffNote', { pay: whole(chosen.overtime) }) : isHire ? L('NCI.Roll.HireNote') : '',
    };
  }
}
