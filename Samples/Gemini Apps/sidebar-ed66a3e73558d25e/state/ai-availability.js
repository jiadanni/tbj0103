// modules/sidebar/state/ai-availability.js

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('AiAvailability');
//
// Manage AI availability state and apply it to the UI.

export function setAiUiAvailability(sidebarInstance, enabled) {
  const sidebar = sidebarInstance?.sidebar;
  try {
    const tooltipMsg = enabled
      ? 'Use AI to spellcheck, suggest guidance, or enhance text.'
      : 'AI features disabled until you configure the AI service and token in Options.';
    sidebarInstance.aiAvailable = !!enabled;
    const setTooltip = (el) => {
      if (!el) return;
      if (!el.dataset.originalTitle) {
        el.dataset.originalTitle = el.getAttribute('title') || '';
      }
      el.setAttribute('title', enabled ? el.dataset.originalTitle : tooltipMsg);
    };

    const actionableButtons = [
      sidebar?.querySelector('#spellcheck-btn'),
      sidebar?.querySelector('#suggest-solution-btn'),
      sidebar?.querySelector('#improve-solution-btn')
    ];
    actionableButtons.forEach(btn => {
      if (!btn) return;
      btn.disabled = !enabled;
      btn.dataset.aiBlocked = enabled ? 'false' : 'true';
      btn.classList.toggle('ai-disabled', !enabled);
      btn.style.opacity = enabled ? '' : '0.5';
      btn.style.pointerEvents = enabled ? '' : 'none';
      setTooltip(btn);
    });

    const actionContainer = sidebar?.querySelector('.action-buttons');
    if (actionContainer) {
      actionContainer.classList.toggle('ai-disabled', !enabled);
      actionContainer.style.opacity = enabled ? '' : '0.45';
    }

    const content = sidebar?.querySelector('.pa-main-content');
    if (content) {
      content.classList.toggle('ai-disabled', !enabled);
      content.style.opacity = enabled ? '' : '0.55';
    }

    const improvedInput = sidebar?.querySelector('#improved-text-input');
    if (improvedInput) {
      improvedInput.readOnly = !enabled;
      improvedInput.classList.toggle('ai-disabled', !enabled);
      setTooltip(improvedInput);
    }
  } catch (e) {
    logger.warn('[Sidebar] Failed to apply AI availability state:', 'ai-availability', e);
  }
}

export async function updateAiAvailability(sidebarInstance) {
  try {
    const { aiEnabled, aiServiceToken, apiEndpoint } = await chrome.storage.local.get(['aiEnabled', 'aiServiceToken', 'apiEndpoint']);
    const masterOn = typeof aiEnabled === 'undefined' ? true : !!aiEnabled;
    // Token can be encrypted, so just check if it exists (don't try to trim encrypted data)
    const hasToken = !!aiServiceToken;
    // Endpoint must be a non-empty string
    const hasEndpoint = !!(apiEndpoint && typeof apiEndpoint === 'string' && apiEndpoint.trim());
    const enabled = masterOn && hasToken && hasEndpoint;
    logger.debug(`[AI Availability] masterOn=${masterOn}, hasToken=${hasToken}, hasEndpoint=${hasEndpoint}, enabled=${enabled}`, 'ai-availability');
    setAiUiAvailability(sidebarInstance, enabled);
    return enabled;
  } catch (e) {
    logger.warn('[Sidebar] Could not read AI availability:', 'ai-availability', e);
    setAiUiAvailability(sidebarInstance, false);
    return false;
  }
}
