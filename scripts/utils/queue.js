/**
 * Serial queue: runs async tasks one after another.
 * @file scripts/utils/queue.js
 */

import { log } from './helpers.js';

export class SerialQueue {
  /**
   * @param {string} label - names the task in the error log ("<label> failed")
   * @param {*} [failed] - what a task that throws resolves with
   */
  constructor(label, failed = undefined) {
    this._label = label;
    this._failed = failed;
    this._tail = Promise.resolve();
  }

  /** Run `fn` after the tasks already queued. Resolves with its result, or with `failed` if it throws. */
  run(fn) {
    const task = this._tail.then(() => fn());
    this._tail = task.catch((error) => log.error(`${this._label} failed`, error));
    return task.catch(() => this._failed);
  }

  /** Awaiting the queue itself waits for every task queued so far. */
  then(resolve, reject) {
    return this._tail.then(() => undefined).then(resolve, reject);
  }
}
