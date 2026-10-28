/**
 * Scene controls and window launchers.
 * @file scripts/init/registerUIComponents.js
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { MarketTerminalApp } from '../ui/MarketTerminal/MarketTerminalApp.js';
import { GMConsoleApp } from '../ui/GMConsole/GMConsoleApp.js';
import { MarketTicker } from '../ui/MarketTicker.js';
import { addMarketControls } from '../ui/sceneControls.js';

export function registerUIComponents(initializer) {
  initializer.register('init', 20, 'Scene controls', () => {
    // Foundry v12 form: the controls array, with each group's tools as an array. The market
    // buttons go in the Token Controls group.
    Hooks.on('getSceneControlButtons', (controls) => {
      const tools = [
        {
          name: 'nci-terminal',
          title: game.i18n.localize('NCI.SceneControls.OpenTerminal'),
          icon: 'fas fa-chart-line',
          button: true,
          onClick: () => MarketTerminalApp.open(),
        },
      ];

      if (isGM()) {
        tools.push({
          name: 'nci-gm-console',
          title: game.i18n.localize('NCI.SceneControls.OpenGMConsole'),
          icon: 'fas fa-sliders',
          button: true,
          onClick: () => GMConsoleApp.open(),
        });
      }

      if (!addMarketControls(controls, tools)) log.warn('Token Controls group not found; market buttons not added');
    });
  });

  initializer.register('ready', 30, 'UI launchers', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.open = () => MarketTerminalApp.open();
    api.openGM = () => {
      if (!isGM()) return ui.notifications.warn('GM only');
      return GMConsoleApp.open();
    };
    MarketTicker.start();

    // Mirror NCM's namespace so macros can use game.nightcity.investments.open().
    game.nightcity ??= {};
    game.nightcity.investments = api;
    log.info('UI launchers ready');
  });
}
