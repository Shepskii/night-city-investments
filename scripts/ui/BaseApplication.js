/**
 * Base ApplicationV2 for all module windows.
 * @file scripts/ui/BaseApplication.js
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BaseApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ['nci-app'],
    window: { resizable: true },
    position: { width: 900, height: 640 },
  };

  /** Open the window, or focus it if it is already open. */
  static open(options = {}) {
    if (this._instance?.rendered) {
      this._instance.bringToFront();
      return this._instance;
    }
    this._instance = new this(options);
    this._instance.render({ force: true });
    return this._instance;
  }
}
