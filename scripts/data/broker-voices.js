/**
 * Broker voices: the lines a broker uses, by Personality (the Cyberpunk RED table) and by what the mail is about.
 * @file scripts/data/broker-voices.js
 * @description Used only for a broker whose character sheet names one of these personalities. Every
 *              personality has `greetings` and `signoffs`, and a pool for each kind in
 *              engine/brokerVoice.js. `{ticker}` and `{name}` are filled in where the mail has a
 *              company. English only, like the starter companies.
 */

import { shy } from './voices/shy.js';
import { rebellious } from './voices/rebellious.js';
import { arrogant } from './voices/arrogant.js';
import { moody } from './voices/moody.js';
import { picky } from './voices/picky.js';
import { stable } from './voices/stable.js';
import { silly } from './voices/silly.js';
import { sneaky } from './voices/sneaky.js';
import { intellectual } from './voices/intellectual.js';
import { friendly } from './voices/friendly.js';

export const BROKER_VOICES = Object.freeze({
  shy, rebellious, arrogant, moody, picky, stable, silly, sneaky, intellectual, friendly,
});
