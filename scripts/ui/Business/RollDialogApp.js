/**
 * Roll dialog: the levers a player picks before a business roll, and what is at stake (DESIGN §26).
 * @file scripts/ui/Business/RollDialogApp.js
 * @description Shows who rolls with what, the approach, Luck and any complementary bonus, and a
 *              preview of the DV and of each outcome band's chance, updated as the choices change.
 *              Nothing is rolled until the player presses Roll.
 */

import { rollSpec, previewRoll, normalizeLevers, hireFee, HIRE_TIERS, APPROACHES, MAX_LUCK_PER_ROLL, useKey } from '../../engine/index.js';
import { MODULE_ID } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient, operatorRankOf } from '../../services/BusinessClient.js';
import { SkillAdapter } from '../../services/SkillAdapter.js';
import { BaseApplication } from '../BaseApplication.js';
import { L, whole } from '../format.js';

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

  /** Open the dialog for one roll. */
  static ask({ actorId, businessId, request, title }) {
    const app = new RollDialogApp({ id: `nci-roll-${actorId}-${businessId}`, actorId, businessId, request, rollTitle: title });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
    this.businessId = options.businessId;
    this.request = options.request;
    this.rollTitle = options.rollTitle;
    /** What the player has chosen so far: `use` is a use key, or `hire:<tier>`. */
    this.choice = { use: null, approach: 'standard', luck: 0, bonus: true };
  }

  get actor() {
    return game.actors.get(this.actorId) ?? null;
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
      return { key: useKey(use), use, base, label: `${useLabel(use)} (${kind})` };
    })
      // A role ability the character does not have is not offered; a skill at 0 still rolls on its stat.
      .filter((o) => o.use.kind !== 'ability' || o.base > 0)
      .sort((a, b) => b.base - a.base);
    const hires = spec.allowHire
      ? Object.entries(HIRE_TIERS).map(([tier, base]) => ({
        key: `hire:${tier}`, use: { kind: 'hire', hire: tier }, base, label: L('NCI.Roll.HireOption', { who: L(`NCI.Roll.Hire.${tier}`), base, fee: whole(hireFee(tier, rank)) }),
      }))
      : [];
    return [...own, ...hires];
  }

  static async _onSubmit() {
    const actor = this.actor;
    const business = this.business;
    const spec = actor && business ? this._spec() : null;
    const option = spec?.ok ? this._options(spec).find((o) => o.key === this.choice.use) ?? this._options(spec)[0] : null;
    if (!option) return ui.notifications.warn(L('NCI.Roll.NothingToRoll'));
    await BusinessClient.roll(actor, business, { ...this.request, use: option.use }, {
      title: this.rollTitle,
      levers: { approach: this.choice.approach, luck: this.choice.luck, bonus: this.choice.bonus ? 1 : 0 },
    });
    await this.close();
  }

  /** Whether the roll can be made now, and the ways it may be made (no use named yet). */
  _spec() {
    return rollSpec(this.business, { ...this.request, use: null }, this.actorId, { day: BusinessClient.day(), operatorRank: operatorRankOf(this.business) });
  }

  async _prepareContext() {
    const actor = this.actor;
    const business = this.business;
    if (!actor || !business) return { title: this.rollTitle, blocked: L('NCI.Business.Reason.no-business') };
    const full = this._spec();
    if (!full.ok) return { title: this.rollTitle, blocked: L(`NCI.Business.Reason.${full.reason}`) };

    const options = this._options(full);
    const chosen = options.find((o) => o.key === this.choice.use) ?? options[0];
    const isHire = chosen?.use.kind === 'hire';
    const luckMax = isHire ? 0 : Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
    const levers = normalizeLevers({
      approach: this.choice.approach, luck: Math.min(this.choice.luck, luckMax), bonus: full.bonusAvailable && this.choice.bonus ? 1 : 0, hire: isHire ? chosen.use.hire : null,
    });
    const preview = previewRoll({ base: chosen?.base ?? 0, dv: full.dv, levers });
    const pct = (x) => `${Math.round(x * 100)}%`;
    const meaning = this.request.type === 'action' ? this.request.action : this.request.type;

    return {
      title: this.rollTitle,
      actorName: actor.name,
      uses: options.map((o) => ({ key: o.key, label: o.label, selected: o.key === chosen?.key })),
      approaches: Object.keys(APPROACHES).map((id) => ({ id, label: L(`NCI.Roll.Approach.${id}`), hint: L(`NCI.Roll.ApproachHint.${id}`), checked: id === levers.approach })),
      luck: levers.luck,
      luckMax,
      noLuck: isHire,
      bonusAvailable: full.bonusAvailable,
      bonus: !!levers.bonus,
      dv: preview.dv,
      chance: pct(preview.chance),
      // A 1 is a fumble roll and a 10 adds a die, so "or more" only reads true between them.
      needed: preview.needed <= 2 ? L('NCI.Roll.NeededAny') : preview.needed > 10 ? L('NCI.Roll.NeededCrit') : L('NCI.Roll.Needed', { n: preview.needed }),
      bands: preview.bands.filter((b) => b.chance > 0).reverse().map((b) => ({
        label: L(`NCI.Roll.Band.${b.band}`), chance: pct(b.chance), meaning: L(`NCI.Roll.Meaning.${meaning}.${b.band}`),
      })),
      hireNote: isHire ? L('NCI.Roll.HireNote') : '',
    };
  }
}
