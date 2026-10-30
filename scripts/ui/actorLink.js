/**
 * A character's name as a link to their actor, with their portrait.
 * @file scripts/ui/actorLink.js
 * @description The markup is Foundry's own content link (`a.content-link` with `data-uuid`), so Foundry
 *              opens the actor's sheet on a click (with its usual permission check) and lets the link be
 *              dragged like any actor link, onto a sheet, a scene or a business's post. A name with no
 *              actor behind it (a syndicate, a recruit, an NPC angel) is shown as plain text.
 *              Templates show the result with triple braces: `{{{who}}}`.
 */

import { escapeHtml } from '../utils/text.js';

const DEFAULT_IMG = 'icons/svg/mystery-man.svg';

/**
 * @param {string|null} actorId
 * @param {string} [name] - the name to show, when the record keeps its own (it wins over the actor's)
 * @returns {string} HTML
 */
export function actorLink(actorId, name = '') {
  const actor = actorId ? game.actors?.get?.(actorId) : null;
  const label = escapeHtml(name || actor?.name || '?');
  if (!actor) return `<span class="nci-who">${label}</span>`;
  const img = escapeHtml(actor.img || actor.prototypeToken?.texture?.src || DEFAULT_IMG);
  const uuid = escapeHtml(actor.uuid ?? `Actor.${actor.id}`);
  return `<a class="content-link nci-who" draggable="true" data-link data-uuid="${uuid}" data-id="${escapeHtml(actor.id)}" data-type="Actor" data-tooltip="${label}">`
    + `<img class="nci-avatar" src="${img}" alt="">${label}</a>`;
}
