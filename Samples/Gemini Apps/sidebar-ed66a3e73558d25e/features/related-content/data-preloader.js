// modules/sidebar/features/related-content/data-preloader.js
//
// Centralized helper for related-content preloads so sidebar.js can stay lean.

import { sendMessageWithTimeout } from '../../../utils/messaging.js';
import { PRELOAD_CONFIG } from './source-config.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('DataPreloader');

async function hasAtlassianToken(sidebarInstance) {
  if (sidebarInstance && typeof sidebarInstance.hasAtlassianToken === 'function') {
    return sidebarInstance.hasAtlassianToken();
  }
  return false;
}

export async function preloadSource(sidebarInstance, type, isManualFetch = false) {
  const config = PRELOAD_CONFIG[type];
  if (!config) {
    logger.warn(`[Sidebar] Unknown preload type requested: ${type}`, 'data-preloader', undefined);
    return null;
  }

  if (sidebarInstance && typeof sidebarInstance.isSectionEnabled === 'function' && !sidebarInstance.isSectionEnabled(type)) {
    return null;
  }

  // Prevent Atlassian fetches when no token is configured
  if ((type === 'jira' || type === 'confluence') && !(await hasAtlassianToken(sidebarInstance))) {
    const msg = 'Add an Atlassian API token in Options to load JIRA/Confluence results.';
    sidebarInstance.renderErrorState(type, msg);
    if (typeof sidebarInstance.showWarning === 'function') {
      sidebarInstance.showWarning(msg);
    }
    return null;
  }

  const list = sidebarInstance.sidebar
    ? sidebarInstance.sidebar.querySelector(config.listSelector)
    : null;
  const label = type === 'community' && typeof sidebarInstance?.getKnowledgeBaseLabel === 'function'
    ? sidebarInstance.getKnowledgeBaseLabel('sidebar')
    : config.label;
  const loadingMessage = type === 'community'
    ? `Searching Knowledge Base...`
    : (config.loadingMessage || 'Loading...');

  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  loadingEl.textContent = loadingMessage;

  if (list) {
    list.replaceChildren();
    list.appendChild(loadingEl);
  }

  // Progressive loading updates for community search
  let progressTimer;
  if (type === 'community' && list) {
    progressTimer = setTimeout(() => {
      if (list.contains(loadingEl)) {
        loadingEl.textContent = 'Still searching (taking longer than expected)...';
      }
    }, 5000);
  }

  try {
    const rawCaseData = sidebarInstance.getCaseDataFromPage() || {};

    // Create a lightweight copy of caseData to avoid message size limits
    // CRITICAL: Do NOT spread ...rawCaseData here. It may contain massive objects that break message passing.
    const caseData = {
      subject: rawCaseData.subject ? String(rawCaseData.subject).substring(0, 500) : '',
      description: rawCaseData.description ? String(rawCaseData.description).substring(0, 2500) : '',
      productName: rawCaseData.productName ? String(rawCaseData.productName).substring(0, 100) : '',
      errorMessage: rawCaseData.errorMessage ? String(rawCaseData.errorMessage).substring(0, 500) : '',
      category: rawCaseData.category ? String(rawCaseData.category).substring(0, 100) : ''
    };

    logger.debug(`[DataPreloader] Sending ${type} request`, 'data-preloader');
    const response = await sendMessageWithTimeout(
      config.actionBuilder(caseData, isManualFetch),
      15000 // Reduced timeout for faster feedback
    );
    logger.debug(`[DataPreloader] Received ${type} response`, 'data-preloader', response);

    if (progressTimer) clearTimeout(progressTimer);

    if (response && response.ok) {
      const items = response[config.responseKey] || response.data || [];
      if (typeof sidebarInstance.renderResultList === 'function') {
        sidebarInstance.renderResultList(type, items);
      }
      return items;
    }

    const errorMsg =
      response && response.error
        ? response.error
        : `Unknown error fetching ${label}`;
    throw new Error(errorMsg);
  } catch (error) {
    logger.error(`[Sidebar] Failed to preload ${config.label}:`, 'data-preloader', error);

    // Explicitly clear the loading state and show error message in the list
    if (list) {
      list.replaceChildren();
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = `Unable to load ${label}. ${error.message || 'Please retry.'}`;
      list.appendChild(errorDiv);
    }

    if (typeof sidebarInstance.showError === 'function') {
      sidebarInstance.showError(`Unable to load ${config.label}. ${error.message || ''}`);
    }
    return null;
  }
}

export { PRELOAD_CONFIG as SOURCE_CONFIG };
