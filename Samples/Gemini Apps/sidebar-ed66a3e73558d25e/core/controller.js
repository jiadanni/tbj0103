import { importWithTimeout } from '../../utils/promise-utils.js';
import { createLogger } from '../../utils/logger.js';
import { DYNAMIC_IMPORT_TIMEOUT_MS } from '../../config/constants.js';
import { SidebarStateManager, applyStateToView, resetDOM } from '../state/manager.js';
import { sendMessageWithTimeout } from '../../utils/messaging.js';
import * as storageUtils from '../state/storage.js';
import * as sidebarUtils from '../state/labels.js';
import * as resultRenderer from '../ui/results.js';
import * as eventSetup from '../event-setup.js';
import * as aiAvailability from '../state/ai-availability.js';
import * as uiLoader from '../ui/loader.js';
import * as visibilityManager from '../visibility-manager.js';
import { PRELOAD_CONFIG } from '../features/related-content/source-config.js';
import * as caseDetails from '../features/case-details.js';
import * as importTools from '../features/import-tools.js';
import * as solutionTools from '../features/solution-tools.js';
import * as dataPreloader from '../features/related-content/data-preloader.js';
import * as uiComponents from '../ui/components.js';
import * as tooltipManager from '../ui/tooltip.js';
import { setupShortcutsHelp } from '../ui/shortcuts.js';

const logger = createLogger('Sidebar');

export class SalesforceSidebar {
  constructor() {
    this.sidebar = null;
    this.isVisible = false;
    this.currentSolution = null;
    this.isOpening = false;
    this.knowledgeBaseLabels = { entryLabel: 'Knowledge Base', sidebarLabel: 'Knowledge Base' };
    this.toggleInProgress = false;
    this.eventHandlers = {};
    this.boundHandlers = {};
    this.aiAvailable = false;
    this.verboseLogging = false;
    this.sectionVisibility = { jira: true, confluence: true, community: true };

    this.initializationPromise = null;
    this.isInitialized = false;
    this.initializationError = null;

    // Module References
    this.utils = sidebarUtils;
    this.caseModule = caseDetails;
    this.importModule = importTools;
    this.solutionModule = solutionTools;
    this.uiModule = uiComponents;
    this.stateManagerModule = { SidebarStateManager, applyStateToView, resetDOM };
    this.stateManager = new SidebarStateManager();
    this.dataModule = dataPreloader;
    this.tooltipModule = tooltipManager;
    this.storageModule = storageUtils;
    this.aiAvailabilityModule = aiAvailability;
    this.uiLoader = uiLoader;
    this.visibilityModule = visibilityManager;
    this.renderModule = resultRenderer;
    this.eventModule = eventSetup;

    this.initializationPromise = this.initialize()
      .then(() => {
        this.isInitialized = true;
      })
      .catch((error) => {
        logger.error('[Sidebar] Initialization failed:', 'sidebar', error);
        this.isInitialized = false;
        this.initializationError = error;
      });

    this.sourceConfig = new Map([
      ['jira', {
        listSelector: PRELOAD_CONFIG.jira.listSelector,
        sectionSelector: PRELOAD_CONFIG.jira.sectionSelector,
        displayName: PRELOAD_CONFIG.jira.displayName,
        preload: this.preloadJiraTickets.bind(this)
      }],
      ['confluence', {
        listSelector: PRELOAD_CONFIG.confluence.listSelector,
        sectionSelector: PRELOAD_CONFIG.confluence.sectionSelector,
        displayName: PRELOAD_CONFIG.confluence.displayName,
        preload: this.preloadConfluenceArticles.bind(this)
      }],
      ['community', {
        listSelector: PRELOAD_CONFIG.community.listSelector,
        sectionSelector: PRELOAD_CONFIG.community.sectionSelector,
        displayName: this.getKnowledgeBaseLabel('entry'),
        preload: this.preloadCommunityGuides.bind(this)
      }]
    ]);
  }

  async initialize() {
    await this.uiLoader.createSidebar(this);
    this.utils.applyKnowledgeBaseLabelsToSidebar(this);
    this.utils.loadKnowledgeBaseLabels(this);

    try {
      const res = await chrome.storage.local.get(['verboseLogging']);
      if (res && typeof res.verboseLogging === 'boolean') {
        this.verboseLogging = res.verboseLogging;
      }
    } catch (e) {
      logger.debug('Error loading verboseLogging preference', 'sidebar', e);
    }

    this.eventModule.setupEventListeners(this);
    this.setupStorageListener();
    await this.updateAiAvailability();
    await this.initializeNewFeatures();
  }

  async ensureInitialized() {
    if (this.isInitialized) return;
    if (!this.initializationPromise) throw new Error('[Sidebar] Initialization never started');
    await this.initializationPromise;
  }

  getKnowledgeBaseLabel(type = 'entry') {
    return this.utils.getKnowledgeBaseLabel(this, type);
  }

  async preloadSource(type, isManualFetch = false) {
    return this.dataModule.preloadSource(this, type, isManualFetch);
  }

  async hasAtlassianToken() {
    try {
      const stored = await chrome.storage.local.get(['atlassianToken']);
      return !!(stored?.atlassianToken?.trim());
    } catch (e) {
      logger.debug('Error checking atlassianToken', 'sidebar', e);
      return false;
    }
  }

  preloadJiraTickets(isManualFetch = false) { return this.preloadSource('jira', isManualFetch); }
  preloadConfluenceArticles(isManualFetch = false) { return this.preloadSource('confluence', isManualFetch); }
  preloadCommunityGuides(isManualFetch = false) { return this.preloadSource('community', isManualFetch); }

  async resetToInitialState() {
    try {
      this.stateManagerModule.resetDOM(this);
      const state = await this.stateManager.loadState();
      this.stateManagerModule.applyStateToView(this, state);
    } catch (e) {
      logger.error('Error in resetToInitialState:', 'sidebar', e);
    }
  }

  async loadPreloadSettings() {
    try {
      const state = await this.stateManager.loadState();
      this.stateManagerModule.applyStateToView(this, state);
    } catch (e) {
      logger.error('Error in loadPreloadSettings:', 'sidebar', e);
    }
  }

  async initializeNewFeatures() {
    if (!this.sidebar) return;
    try {
      const initializerModule = await this.safeLoadModule('modules/sidebar/feature-initializer.js', 'feature-initializer');
      if (initializerModule) {
        const result = await initializerModule.initializeFeatures(this);
        this.featureModules = result.featureModules || {};
      }
    } catch (error) {
      logger.error('[Sidebar] Feature initialization failed:', 'sidebar', error);
    }
  }

  async safeLoadModule(relativePath, key) {
    try {
      return await importWithTimeout(chrome.runtime.getURL(relativePath), DYNAMIC_IMPORT_TIMEOUT_MS, key);
    } catch (error) {
      logger.error(`[Sidebar] Failed to load module ${key}:`, 'sidebar', error);
      return null;
    }
  }

  setupEventListeners() {
    this.eventModule.setupEventListeners(this);
  }

  setupStorageListener() {
    this.boundHandlers.storageChange = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.preloadSettings || changes.sidebarSections) this.loadPreloadSettings();
      if (changes.sidebarWidth) this.applySidebarWidth();
      if (changes.aiEnabled || changes.aiServiceToken || changes.apiEndpoint) this.updateAiAvailability();
      if (changes.knowledgeBaseLabels) this.utils.loadKnowledgeBaseLabels(this);
    };
    chrome.storage.onChanged.addListener(this.boundHandlers.storageChange);
  }

  vlog(...args) {
    if (this.verboseLogging) logger.debug(args.join(' '), 'sidebar');
  }

  isSectionEnabled(type) {
    return this.sectionVisibility?.[type] !== false;
  }

  applySectionVisibility(visibility = {}) {
    this.sectionVisibility = { jira: true, confluence: true, community: true, ...visibility };
    if (!this.sidebar) return;
    this.sourceConfig.forEach((cfg, type) => {
      const enabled = this.isSectionEnabled(type);
      const section = this.sidebar.querySelector(cfg.sectionSelector);
      if (section) {
        section.style.display = enabled ? '' : 'none';
        section.setAttribute('data-section-enabled', String(enabled));
      }
      if (!enabled) this.sidebar.querySelector(cfg.listSelector)?.replaceChildren();
    });
  }

  async toggle(show = !this.isVisible) {
    return this.visibilityModule.toggle(this, show);
  }

  updateContent(data) { return this.renderModule.updateContent(this, data); }
  renderResultList(type, items = []) {
    if (this.isSectionEnabled(type)) return this.renderModule.renderResultList(this, type, items);
  }
  renderErrorState(type, message) {
    if (this.isSectionEnabled(type)) return this.renderModule.renderErrorState(this, type, message);
  }
  renderFetchButton(type, isConfigured) {
    return this.uiModule.renderFetchButton(this, type, isConfigured);
  }

  showImprovedSection() {
    return this.uiModule.showImprovedSection(this);
  }

  adjustButtonLabels() {
    return this.uiModule.adjustButtonLabels(this);
  }

  getProductIconHTML(productName) {
    return this.uiModule.getProductIconHTML(this, productName);
  }

  async loadCaseDetails() {
    await this.ensureInitialized();
    return this.caseModule.loadCaseDetails(this);
  }

  async performCaseDetailsLoad(caseInfo) {
    await this.ensureInitialized();
    return this.caseModule.performCaseDetailsLoad(this, caseInfo);
  }

  async retryPerformCaseDetailsLoad(attempts = 3, intervalMs = 800) {
    await this.ensureInitialized();
    return this.caseModule.retryPerformCaseDetailsLoad(this, attempts, intervalMs);
  }

  async loadCaseDetailsEnhanced(attempt = 0) {
    await this.ensureInitialized();
    return this.caseModule.loadCaseDetailsEnhanced(this, attempt);
  }

  getCaseDataFromPage() {
    return this.caseModule.getCaseDataFromPage(this);
  }

  async handleImportText(overrideText) {
    return this.importModule.handleImportText(this, overrideText);
  }

  async handleCopyImprovedText() {
    return this.uiModule.handleCopyImprovedText(this);
  }

  showWarning(message) {
    logger.warn('[Sidebar] Warning:', 'sidebar', message);
    chrome.runtime.sendMessage({ action: 'showNotification', message, type: 'warning' }).catch(() => { });
  }

  showError(message) {
    logger.error('Error', 'sidebar', message);
    chrome.runtime.sendMessage({ action: 'showNotification', message, type: 'error' }).catch(() => { });
    return this.uiModule.showError(this, message);
  }

  notifyButtonVisibilityChange() {
    return this.uiModule.notifyButtonVisibilityChange(this);
  }

  async applySidebarWidth() {
    return this.storageModule.applySidebarWidth(this);
  }

  restoreCollapseState() {
    return this.storageModule.restoreCollapseState(this);
  }

  saveCollapseStateEntry(controlId, isCollapsed) {
    return this.storageModule.saveCollapseStateEntry(this, controlId, isCollapsed);
  }

  async updateAiAvailability() {
    const available = await this.aiAvailabilityModule.updateAiAvailability(this);
    this.aiAvailable = available;
    this.aiAvailabilityModule.setAiUiAvailability(this, available);
  }

  // Pure UI Logic still needed here for DOM coordination
  ensureRefreshButtonWired(retryCount = 0) {
    const refreshBtn = this.sidebar.querySelector('#refresh-case-details-btn');
    if (!refreshBtn) {
      if (retryCount < 5) setTimeout(() => this.ensureRefreshButtonWired(retryCount + 1), 500);
      return;
    }
    if (this.eventHandlers.refreshCaseDetails) {
      const existing = this.eventHandlers.refreshCaseDetails;
      existing.element.removeEventListener(existing.type, existing.handler);
    }
    this.boundHandlers.refreshCaseDetails = async () => {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('loading');
      try {
        await this.retryPerformCaseDetailsLoad(4, 700);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('loading');
      }
    };
    refreshBtn.addEventListener('click', this.boundHandlers.refreshCaseDetails);
    this.eventHandlers.refreshCaseDetails = { element: refreshBtn, type: 'click', handler: this.boundHandlers.refreshCaseDetails };
  }

  async handleSpellcheck() {
    if (!this.aiAvailable) return this.showWarning('AI token not configured.');
    return this.solutionModule.handleSpellcheck(this);
  }

  async handleSuggestSolution() {
    if (!this.aiAvailable) return this.showWarning('AI token not configured.');
    return this.solutionModule.handleSuggestSolution(this);
  }

  async handleImproveSolution() {
    if (!this.aiAvailable) return this.showWarning('AI token not configured.');
    return this.solutionModule.handleImproveSolution(this);
  }

  fetchRelatedItems(type) {
    return this.preloadSource(type, true);
  }

  sendMessageWithTimeout(message, timeoutMs) {
    return sendMessageWithTimeout(message, timeoutMs);
  }

  handleResize() {
    return this.adjustButtonLabels();
  }

  setupShortcutsHelp(getShortcutHelpHTML) {
    setupShortcutsHelp(this, getShortcutHelpHTML);
  }

  showTooltipForHint(hint) {
    return this.tooltipModule.showTooltipForHint(this, hint);
  }

  hideTooltipForHint(hint) {
    return this.tooltipModule.hideTooltipForHint(this, hint);
  }

  updateKnowledgeBaseSourceConfig() {
    const cfg = this.sourceConfig.get('community');
    if (cfg) cfg.displayName = this.getKnowledgeBaseLabel('entry');
  }

  applyKnowledgeBaseLabelsToSidebar() {
    return this.utils.applyKnowledgeBaseLabelsToSidebar(this);
  }

  setupCaseInfoObserver() {
    if (!this.sidebar) return;
    const observer = new MutationObserver((mutations, obs) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.id === 'case-info' || node.querySelector?.('#case-info')) {
            obs.disconnect();
            setTimeout(() => this.loadCaseDetailsEnhanced(), 100);
            return;
          }
        }
      }
    });
    observer.observe(this.sidebar, { childList: true, subtree: true });
    this.caseInfoObserver = observer;
  }

  cleanup() {
    logger.info('Cleaning up sidebar', 'sidebar');
    if (this.eventHandlers) {
      Object.values(this.eventHandlers).forEach(({ element, type, handler }) => {
        element?.removeEventListener?.(type, handler);
      });
    }
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.caseInfoObserver) this.caseInfoObserver.disconnect();
    if (chrome.storage?.onChanged && this.boundHandlers?.storageChange) {
      chrome.storage.onChanged.removeListener(this.boundHandlers.storageChange);
    }
    if (this.featureModules?.autoSave?.clearAutoSave) {
      this.featureModules.autoSave.clearAutoSave();
    }
    this.sidebar?.parentNode?.removeChild(this.sidebar);
    this.eventHandlers = {};
    this.boundHandlers = {};
    this.sidebar = null;
    this.isVisible = false;
  }
}
