/**
 * Tools system: data migrations, keybindings, and the self-check and starter-macro APIs.
 * @file scripts/init/registerToolsSystem.js
 */

import { MODULE_ID, SCHEMA_VERSION, HOOKS } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { MigrationService } from '../services/MigrationService.js';
import { DiagnosticsService } from '../services/DiagnosticsService.js';
import { MacroService } from '../services/MacroService.js';
import { MarketTerminalApp } from '../ui/MarketTerminal/MarketTerminalApp.js';
import { GMConsoleApp } from '../ui/GMConsole/GMConsoleApp.js';
import { BusinessApp } from '../ui/Business/BusinessApp.js';

export function registerToolsSystem(initializer) {
  // Unbound by default so it cannot clash with a key the table already uses.
  initializer.register('init', 25, 'Keybindings', () => {
    game.keybindings.register(MODULE_ID, 'openTerminal', {
      name: 'NCI.Keybindings.OpenTerminal',
      hint: 'NCI.Keybindings.OpenTerminalHint',
      editable: [],
      onDown: () => {
        MarketTerminalApp.open();
        return true;
      },
    });
    game.keybindings.register(MODULE_ID, 'openBusiness', {
      name: 'NCI.Keybindings.OpenBusiness',
      hint: 'NCI.Keybindings.OpenBusinessHint',
      editable: [],
      onDown: () => {
        BusinessApp.open();
        return true;
      },
    });
    game.keybindings.register(MODULE_ID, 'openConsole', {
      name: 'NCI.Keybindings.OpenConsole',
      hint: 'NCI.Keybindings.OpenConsoleHint',
      editable: [],
      restricted: true,
      onDown: () => {
        if (isGM()) GMConsoleApp.open();
        return true;
      },
    });
  });

  // Before the tick service and the portfolio sweep read or write any of the stored data.
  initializer.register('ready', 22, 'Data migrations', async () => {
    await MigrationService.run();
  });

  initializer.register('ready', 60, 'Tools API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.schemaVersion = SCHEMA_VERSION;
    api.verify = (opts) => DiagnosticsService.verify(opts);
    api.gm ??= {};
    api.gm.tools = {
      verify: (opts) => DiagnosticsService.verify(opts),
      tradeLog: (opts) => DiagnosticsService.tradeLog(opts),
      suggestions: (limit) => DiagnosticsService.suggestions(limit),
      createMacros: () => MacroService.createDefaults(),
      migrate: () => MigrationService.run(),
    };
    log.info('Tools ready');
    Hooks.callAll(HOOKS.READY, api);
  });
}
