// modules/sidebar/module-loader.js
//
// Centralized helper for loading sidebar dependencies with consistent
// error handling and reporting. Keeps sidebar.js lean and focused on
// orchestration rather than import boilerplate.

import { importWithTimeout } from '../utils/promise-utils.js';
import { DYNAMIC_IMPORT_TIMEOUT_MS } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SidebarModuleLoader');

const CORE_MODULES = [
  { key: 'caseModule', path: 'modules/sidebar/features/case-details.js' },
  { key: 'importModule', path: 'modules/sidebar/features/import-tools.js' },
  { key: 'solutionModule', path: 'modules/sidebar/features/solution-tools.js' },
  { key: 'uiModule', path: 'modules/sidebar/ui/components.js' },
  { key: 'dataModule', path: 'modules/sidebar/features/related-content/data-preloader.js' },
  { key: 'tooltipModule', path: 'modules/sidebar/ui/tooltip.js' }
];

/**
 * Load all core sidebar modules sequentially so logs stay readable.
 * Returns both the loaded module map and a list of failed module keys.
 */
export async function loadCoreModules() {
  const modules = {};
  const failedModules = [];

  for (const mod of CORE_MODULES) {
    try {
      modules[mod.key] = await importWithTimeout(chrome.runtime.getURL(mod.path), DYNAMIC_IMPORT_TIMEOUT_MS, mod.key);
    } catch (error) {
      logger.error(`[Sidebar] Failed to load ${mod.key} module:`, 'module-loader', error);
      failedModules.push(mod.key);
      modules[mod.key] = undefined;
    }
  }

  return { modules, failedModules };
}
