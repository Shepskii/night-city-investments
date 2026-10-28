/**
 * ModuleInitializer: priority-ordered startup tasks across Foundry hooks.
 * @file scripts/core/ModuleInitializer.js
 */

import { log } from '../utils/helpers.js';

export class ModuleInitializer {
  constructor() {
    this._phases = new Map([
      ['preInit', []],
      ['init', []],
      ['ready', []],
      ['postReady', []],
    ]);
  }

  /**
   * @param {'preInit'|'init'|'ready'|'postReady'} phase
   * @param {number} priority - lower runs first
   * @param {string} name
   * @param {Function} fn
   */
  register(phase, priority, name, fn) {
    const tasks = this._phases.get(phase);
    if (!tasks) throw new Error(`Unknown phase: ${phase}`);
    tasks.push({ priority, name, fn });
  }

  async runPhase(phase) {
    const tasks = this._phases.get(phase);
    if (!tasks?.length) return;
    tasks.sort((a, b) => a.priority - b.priority);
    log.info(`Running phase: ${phase} (${tasks.length} tasks)`);
    for (const task of tasks) {
      try {
        log.debug(`  [${task.priority}] ${task.name}`);
        await task.fn();
      } catch (error) {
        log.error(`  FAILED: ${task.name}`, error);
      }
    }
  }
}
