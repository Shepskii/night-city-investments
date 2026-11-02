/**
 * GM Console pending tab: every decision waiting for the GM, across the other tabs.
 * @file scripts/ui/GMConsole/tabs/pending.js
 * @description One row per decision, in the console's tab order. The tab buttons count these same rows,
 *              so a button and the table always agree. Things that settle themselves, like a syndicate's
 *              votes and a takeover's open offer, are not here.
 */

import { L } from '../../format.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { SyndicateRepository } from '../../../data/SyndicateRepository.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { HeatService } from '../../../services/HeatService.js';
import { sceneCandidate } from '../../../engine/index.js';
import { penaltyText } from './heat.js';
import { StoryService } from '../../../services/StoryService.js';

const row = (tab, item, need, params) => ({ tab, item, needed: L(`NCI.Pending.Need.${need}`, params) });

const gigRows = () => MarketStore.getGigs().pending.map((p) => row('gigs', p.title || p.client || '—', p.kind));

const heatRows = () => HeatService.snapshot().penalties.filter((p) => p.status === 'pending')
  .map((p) => row('heat', p.name, 'penalty', { penalty: penaltyText(p) }));

function businessRows() {
  return BusinessService.snapshot().filter(({ business: b }) => b.status !== 'closed').flatMap(({ business: b }) => {
    const need = (kind, params) => row('businesses', b.name, kind, params);
    return [
      b.status === 'pending' && need('approval'),
      b.charter?.status === 'awaiting' && need('charter'),
      b.listing?.status === 'awaiting' && need('listing'),
      b.listing?.review && need('delisting'),
      b.takeover?.status === 'awaiting' && need('takeover', { bidder: b.takeover.bidderName }),
      b.administration && need('administration'),
      b.regCase?.status === 'lost' && need('case'),
      b.campaign?.status === 'awaiting' && need('campaign', { name: b.campaign.name }),
      sceneCandidate(b) && need('scene', { event: L(`NCI.Event.${b.period.event.kind}.Name`) }),
      b.scene && need('sceneOpen', { event: L(`NCI.Event.${b.scene.event.kind}.Name`) }),
      ...(b.staff ?? []).filter((s) => s.status === 'offered' && s.source === 'npc')
        .map((s) => need('offer', { name: s.name, post: L(`NCI.Staff.Post.${s.post}`) })),
    ].filter(Boolean);
  });
}

const syndicateRows = () => SyndicateRepository.all().filter((s) => s.status === 'pending').map((s) => row('syndicates', s.name, 'syndicate'));

const storyRows = () => StoryService.pending().map((s) => row('events', s.media, 'story', { name: s.name }));

const rows = () => [...storyRows(), ...businessRows(), ...syndicateRows(), ...heatRows(), ...gigRows()];

/** How many decisions wait on each tab, and in all under `pending`. */
export function waiting() {
  const all = rows();
  const counts = { pending: all.length };
  for (const { tab } of all) counts[tab] = (counts[tab] ?? 0) + 1;
  return counts;
}

export const actions = {};

export function context() {
  return { pendingRows: rows().map((r) => ({ ...r, where: L(`NCI.GMConsole.Tab.${r.tab}`) })) };
}
