// modules/sidebar/feature-initializer.js
//
// Helper to initialize optional sidebar features (keyboard shortcuts,
// auto-save) without cluttering sidebar.js with import boilerplate.

import { importWithTimeout } from '../utils/promise-utils.js';
import { createLogger } from '../utils/logger.js';
import { DYNAMIC_IMPORT_TIMEOUT_MS } from '../config/constants.js';

const logger = createLogger('FeatureInitializer');

/**
 * Initialize sidebar productivity features.
 * @param {SalesforceSidebar} sidebar
 * @returns {{ featureModules: Record<string, any>, failedFeatures: string[] }}
 */
export async function initializeFeatures(sidebar) {
  const featureModules = {};
  const failedFeatures = [];

  // Keyboard shortcuts
  try {
    const keyboardShortcutsModule = await importWithTimeout(
      chrome.runtime.getURL('modules/sidebar/features/keyboard-shortcuts.js'),
      DYNAMIC_IMPORT_TIMEOUT_MS,
      'keyboard-shortcuts'
    );
    keyboardShortcutsModule.initializeKeyboardShortcuts(sidebar);
    featureModules.keyboardShortcuts = keyboardShortcutsModule;

    try {
      sidebar.setupShortcutsHelp(keyboardShortcutsModule.getShortcutHelpHTML);
    } catch (helpError) {
      logger.warn('[Sidebar] Shortcuts help button setup failed:', 'feature-initializer', helpError);
    }

    logger.info('[Sidebar] ⌨️  Keyboard shortcuts initialized', 'feature-initializer', undefined);
  } catch (error) {
    logger.error('[Sidebar] ⚠️  Keyboard shortcuts failed to initialize:', 'feature-initializer', error);
    failedFeatures.push('Keyboard shortcuts');
  }

  // Auto-save
  try {
    const autoSaveModule = await importWithTimeout(
      chrome.runtime.getURL('modules/sidebar/features/auto-save.js'),
      DYNAMIC_IMPORT_TIMEOUT_MS,
      'auto-save'
    );
    const textarea = sidebar.sidebar?.querySelector('#original-text-input');
    const caseData = sidebar.getCaseDataFromPage();

    if (textarea && caseData?.caseNumber) {
      autoSaveModule.initializeAutoSave(textarea, caseData.caseNumber);
      logger.info('[Sidebar] 💾 Auto-save initialized for case:', 'feature-initializer', caseData.caseNumber);
    } else {
      logger.info('[Sidebar] 💾 Auto-save skipped (no textarea or case number)', 'feature-initializer', undefined);
    }

    featureModules.autoSave = autoSaveModule;
  } catch (error) {
    logger.error('[Sidebar] ⚠️  Auto-save failed to initialize:', 'feature-initializer', error);
    failedFeatures.push('Auto-save');
  }

  return { featureModules, failedFeatures };
}
