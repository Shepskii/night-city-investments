/**
 * Module settings
 * @file scripts/core/SettingsManager.js
 */

import { DATE_FORMATS, setExtraDistricts } from '../engine/index.js';
import { MODULE_ID, SETTINGS, HOOKS } from '../utils/constants.js';
import { THEMES, applyTheme, visualToolsActive } from './theme.js';

const CREW_TOOLS_ID = 'pneuma-crewtools';

const notifyMarketUpdated = () => Hooks.callAll(HOOKS.MARKET_UPDATED);
const notifyBusinessesChanged = () => Hooks.callAll(HOOKS.BUSINESSES_CHANGED);
const notifySyndicatesChanged = () => Hooks.callAll(HOOKS.SYNDICATES_CHANGED);

export function registerSettings() {
  const s = game.settings;

  s.register(MODULE_ID, SETTINGS.TICK_MODE, {
    name: 'NCI.Settings.TickMode.Name',
    hint: 'NCI.Settings.TickMode.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'realTime',
    choices: {
      realTime: 'NCI.Settings.TickMode.RealTime',
      worldTime: 'NCI.Settings.TickMode.WorldTime',
      manual: 'NCI.Settings.TickMode.Manual',
    },
  });

  s.register(MODULE_ID, SETTINGS.REAL_TIME_MINUTES, {
    name: 'NCI.Settings.RealTimeMinutes.Name',
    hint: 'NCI.Settings.RealTimeMinutes.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 10,
    range: { min: 1, max: 240, step: 1 },
  });

  s.register(MODULE_ID, SETTINGS.GIG_IMPACTS, {
    name: 'NCI.Settings.GigImpacts.Name',
    hint: 'NCI.Settings.GigImpacts.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.GIG_IMPACT_APPROVAL, {
    name: 'NCI.Settings.GigImpactApproval.Name',
    hint: 'NCI.Settings.GigImpactApproval.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.GIG_IMPACT_SCALE, {
    name: 'NCI.Settings.GigImpactScale.Name',
    hint: 'NCI.Settings.GigImpactScale.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: { min: 0.25, max: 3, step: 0.25 },
  });

  s.register(MODULE_ID, SETTINGS.HEAT_ENABLED, {
    name: 'NCI.Settings.HeatEnabled.Name',
    hint: 'NCI.Settings.HeatEnabled.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });

  s.register(MODULE_ID, SETTINGS.HEAT_STRENGTH, {
    name: 'NCI.Settings.HeatStrength.Name',
    hint: 'NCI.Settings.HeatStrength.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: { min: 0.25, max: 3, step: 0.25 },
  });

  s.register(MODULE_ID, SETTINGS.HEAT_CONSEQUENCES, {
    name: 'NCI.Settings.HeatConsequences.Name',
    hint: 'NCI.Settings.HeatConsequences.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.HEAT_PENALTY_APPROVAL, {
    name: 'NCI.Settings.HeatPenaltyApproval.Name',
    hint: 'NCI.Settings.HeatPenaltyApproval.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.GIG_TIPS, {
    name: 'NCI.Settings.GigTips.Name',
    hint: 'NCI.Settings.GigTips.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });

  s.register(MODULE_ID, SETTINGS.BROKER_ORDER_MODE, {
    name: 'NCI.Settings.BrokerOrderMode.Name',
    hint: 'NCI.Settings.BrokerOrderMode.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'auto',
    choices: {
      auto: 'NCI.Settings.BrokerOrderMode.Auto',
      manual: 'NCI.Settings.BrokerOrderMode.Manual',
    },
  });

  s.register(MODULE_ID, SETTINGS.DEPOSIT_FEE, {
    name: 'NCI.Settings.DepositFee.Name',
    hint: 'NCI.Settings.DepositFee.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 0,
  });

  s.register(MODULE_ID, SETTINGS.DIRECT_MODE, {
    name: 'NCI.Settings.DirectMode.Name',
    hint: 'NCI.Settings.DirectMode.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'terminal',
    choices: {
      terminal: 'NCI.Settings.DirectMode.Terminal',
      open: 'NCI.Settings.DirectMode.Open',
    },
  });

  s.register(MODULE_ID, SETTINGS.DIRECT_EXECUTION, {
    name: 'NCI.Settings.DirectExecution.Name',
    hint: 'NCI.Settings.DirectExecution.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'nextTick',
    choices: {
      nextTick: 'NCI.Settings.DirectExecution.NextTick',
      instant: 'NCI.Settings.DirectExecution.Instant',
    },
  });

  s.register(MODULE_ID, SETTINGS.DIRECT_COMMISSION_BPS, {
    name: 'NCI.Settings.DirectCommission.Name',
    hint: 'NCI.Settings.DirectCommission.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 200,
    range: { min: 25, max: 500, step: 5 },
  });

  s.register(MODULE_ID, SETTINGS.DIRECT_FLAT_FEE, {
    name: 'NCI.Settings.DirectFlatFee.Name',
    hint: 'NCI.Settings.DirectFlatFee.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 5,
  });

  s.register(MODULE_ID, SETTINGS.CORPNET_DV, {
    name: 'NCI.Settings.CorpnetDV.Name',
    hint: 'NCI.Settings.CorpnetDV.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 13,
    range: { min: 5, max: 30, step: 1 },
  });

  s.register(MODULE_ID, SETTINGS.CORPNET_NETWORK, {
    name: 'NCI.Settings.CorpnetNetwork.Name',
    hint: 'NCI.Settings.CorpnetNetwork.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'CORPNET',
  });

  s.register(MODULE_ID, SETTINGS.SESSION_TICKS, {
    name: 'NCI.Settings.SessionTicks.Name',
    hint: 'NCI.Settings.SessionTicks.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: { min: 1, max: 14, step: 1 },
  });

  s.register(MODULE_ID, SETTINGS.LOCKOUT_TICKS, {
    name: 'NCI.Settings.LockoutTicks.Name',
    hint: 'NCI.Settings.LockoutTicks.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: { min: 1, max: 14, step: 1 },
  });

  s.register(MODULE_ID, SETTINGS.SETTLEMENT_DAYS, {
    name: 'NCI.Settings.SettlementDays.Name',
    hint: 'NCI.Settings.SettlementDays.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 0,
    range: { min: 0, max: 5, step: 1 },
  });

  s.register(MODULE_ID, SETTINGS.SHOW_TICKER, {
    name: 'NCI.Settings.ShowTicker.Name',
    hint: 'NCI.Settings.ShowTicker.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    onChange: notifyMarketUpdated,
  });

  // GM-managed data, kept out of the settings screen.
  s.register(MODULE_ID, SETTINGS.PRODUCTION_CATALOG, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyBusinessesChanged,
  });
  s.register(MODULE_ID, SETTINGS.FACTION_DEFS, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyBusinessesChanged,
  });
  // Districts remembered from Night City Map (DESIGN §36.15).
  s.register(MODULE_ID, SETTINGS.DISTRICT_DEFS, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: (value) => {
      setExtraDistricts(value);
      notifyBusinessesChanged();
    },
  });

  s.register(MODULE_ID, SETTINGS.BROKER_DEFS, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyMarketUpdated,
  });

  s.register(MODULE_ID, SETTINGS.FUND_DEFS, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyMarketUpdated,
  });

  s.register(MODULE_ID, SETTINGS.SCHEMA_VERSION, {
    scope: 'world',
    config: false,
    type: Number,
    default: 1,
  });

  s.register(MODULE_ID, SETTINGS.WORLD_SEED, {
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });

  // Public market data. Players read these; only the active GM writes them.
  s.register(MODULE_ID, SETTINGS.MARKET_STATE, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyMarketUpdated,
  });

  s.register(MODULE_ID, SETTINGS.MARKET_HISTORY, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyMarketUpdated,
  });

  // Public headlines, and the record of the last dividend declared for each company.
  s.register(MODULE_ID, SETTINGS.NEWS_FEED, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyMarketUpdated,
  });

  s.register(MODULE_ID, SETTINGS.DIVIDEND_RECORDS, {
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: notifyMarketUpdated,
  });

  s.register(MODULE_ID, SETTINGS.BUSINESSES_ENABLED, {
    name: 'NCI.Settings.BusinessesEnabled.Name',
    hint: 'NCI.Settings.BusinessesEnabled.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: notifyBusinessesChanged,
  });

  // Offered only with Crew Tools there, and on with it: business work competes with a character's other downtime (B7b).
  s.register(MODULE_ID, SETTINGS.CREW_DOWNTIME, {
    name: 'NCI.Settings.CrewDowntime.Name',
    hint: 'NCI.Settings.CrewDowntime.Hint',
    scope: 'world',
    config: !!game.modules?.get(CREW_TOOLS_ID)?.active,
    type: Boolean,
    default: true,
    onChange: notifyBusinessesChanged,
  });

  // Each player's own, as their skin in that module is; offered only with that module there.
  s.register(MODULE_ID, SETTINGS.THEME, {
    name: 'NCI.Settings.Theme.Name',
    hint: 'NCI.Settings.Theme.Hint',
    scope: 'client',
    config: visualToolsActive(),
    type: String,
    default: THEMES.nightCity,
    choices: {
      [THEMES.nightCity]: 'NCI.Settings.Theme.NightCity',
      [THEMES.visualTools]: 'NCI.Settings.Theme.VisualTools',
    },
    onChange: applyTheme,
  });
  applyTheme();

  s.register(MODULE_ID, SETTINGS.UNDERWORLD, {
    name: 'NCI.Settings.Underworld.Name',
    hint: 'NCI.Settings.Underworld.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.CAMPAIGN_APPROVAL, {
    name: 'NCI.Settings.CampaignApproval.Name',
    hint: 'NCI.Settings.CampaignApproval.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.BUSINESS_APPROVAL, {
    name: 'NCI.Settings.BusinessApproval.Name',
    hint: 'NCI.Settings.BusinessApproval.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.SYNDICATES_ENABLED, {
    name: 'NCI.Settings.SyndicatesEnabled.Name',
    hint: 'NCI.Settings.SyndicatesEnabled.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: notifySyndicatesChanged,
  });

  s.register(MODULE_ID, SETTINGS.SYNDICATE_APPROVAL, {
    name: 'NCI.Settings.SyndicateApproval.Name',
    hint: 'NCI.Settings.SyndicateApproval.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.SYNDICATE_MAIL, {
    name: 'NCI.Settings.SyndicateMail.Name',
    hint: 'NCI.Settings.SyndicateMail.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.LISTING_THRESHOLD, {
    name: 'NCI.Settings.ListingThreshold.Name',
    hint: 'NCI.Settings.ListingThreshold.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 500000,
  });

  s.register(MODULE_ID, SETTINGS.STAFF_MAIL, {
    name: 'NCI.Settings.StaffMail.Name',
    hint: 'NCI.Settings.StaffMail.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  s.register(MODULE_ID, SETTINGS.BUSINESS_WEEKDAY, {
    name: 'NCI.Settings.BusinessWeekday.Name',
    hint: 'NCI.Settings.BusinessWeekday.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    choices: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, `NCI.Weekday.${d}`])),
    onChange: notifyBusinessesChanged,
  });

  s.register(MODULE_ID, SETTINGS.BUSINESS_GROWTH_RATE, {
    name: 'NCI.Settings.BusinessGrowthRate.Name',
    hint: 'NCI.Settings.BusinessGrowthRate.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: { min: 0.5, max: 2, step: 0.25 },
  });

  s.register(MODULE_ID, SETTINGS.SHARE_CONTACTS, {
    name: 'NCI.Settings.ShareContacts.Name',
    hint: 'NCI.Settings.ShareContacts.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  s.register(MODULE_ID, SETTINGS.ROOM_EVENTS, {
    name: 'NCI.Settings.RoomEvents.Name',
    hint: 'NCI.Settings.RoomEvents.Hint',
    scope: 'world',
    config: true,
    type: String,
    choices: { rare: 'NCI.Settings.RoomEvents.Rare', normal: 'NCI.Settings.RoomEvents.Normal', often: 'NCI.Settings.RoomEvents.Often' },
    default: 'normal',
  });
  s.register(MODULE_ID, SETTINGS.DATE_FORMAT, {
    name: 'NCI.Settings.DateFormat.Name',
    hint: 'NCI.Settings.DateFormat.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: DATE_FORMATS[0],
    choices: Object.fromEntries(DATE_FORMATS.map((f) => [f, f])),
    onChange: notifyBusinessesChanged,
  });

  s.register(MODULE_ID, SETTINGS.DEBUG_MODE, {
    name: 'NCI.Settings.DebugMode.Name',
    hint: 'NCI.Settings.DebugMode.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
  });
}
