/**
 * Register the module's Handlebars partials the way Foundry does: named by their module path.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PARTIAL_DIRS = ['templates/gm/console'];

export function registerPartials(Handlebars, root) {
  for (const dir of PARTIAL_DIRS) {
    for (const file of readdirSync(join(root, dir))) {
      Handlebars.registerPartial(`modules/night-city-investments/${dir}/${file}`, readFileSync(join(root, dir, file), 'utf8'));
    }
  }
}

/** A template and every partial file it pulls in, for checks that scan template source. */
export function withPartials(root, file) {
  const source = readFileSync(join(root, file), 'utf8');
  const used = [...source.matchAll(/\{\{> "modules\/night-city-investments\/([^"]+)"/g)].map((m) => m[1]);
  return [source, ...used.map((p) => readFileSync(join(root, p), 'utf8'))].join('\n');
}
