/**
 * GM Console NPC businesses tab: NPCs' companies (N1), and the button that opens the New NPC business window.
 * @file scripts/ui/GMConsole/tabs/npcBusinesses.js
 * @description Each company shows as on the Businesses tab, marked as an NPC's, with how it is run. Its buttons are
 *              the Businesses tab's, whose handlers do the work. Action handlers run with `this` set to the console.
 */

import { context as businessesContext } from './businesses.js';
import { NpcCompanyApp } from '../../NpcCompany/NpcCompanyApp.js';

function onNew() {
  NpcCompanyApp.open();
}

export const actions = {
  npcBusinessNew: onNew,
};

export function context() {
  const { businesses } = businessesContext();
  return { npcBusinesses: { enabled: businesses.enabled, ...businesses.npc } };
}
