/**
 * SidebarContext contract for sidebar modules.
 *
 * This file documents the expected shape of the sidebar controller passed to
 * sidebar modules. It is intentionally side-effect free and should be kept in
 * sync as modules move into core/ui/state/features.
 *
 * Target layer ownership (planned):
 * - core: ui-loader, event-setup, visibility-manager, feature-initializer
 * - ui: ui-components, result-renderer, tooltip-manager, filters
 * - state: state-manager, storage-utils, ai-availability, utils (labels)
 * - features: data-preloader, import-tools, solution-tools, case-details, auto-save, keyboard-shortcuts
 *
 * Dependency map (current):
 * - ui-loader: sidebarHost, shadowRoot, sidebar, applySidebarWidth(), setupCaseInfoObserver()
 * - visibility-manager: ensureInitialized(), isVisible, isOpening, toggleInProgress, sidebar, sidebarHost,
 *   suppressImmediateCloseUntil, loadPreloadSettings(), loadCaseDetailsEnhanced(), notifyButtonVisibilityChange(),
 *   resetToInitialState()
 * - event-setup: sidebar, sidebarHost, shadowRoot, isVisible, eventHandlers, boundHandlers,
 *   toggle(), showImprovedSection(), handleSpellcheck(), handleSuggestSolution(), handleImproveSolution(),
 *   handleImportText(), handleCopyImprovedText(), vlog(), loadPreloadSettings(), restoreCollapseState(),
 *   saveCollapseStateEntry(), loadCaseDetailsEnhanced(), ensureRefreshButtonWired(), handleResize(),
 *   showTooltipForHint(), hideTooltipForHint()
 * - data-preloader: hasAtlassianToken(), isSectionEnabled(), renderErrorState(), showWarning(),
 *   sidebar, getKnowledgeBaseLabel(), getCaseDataFromPage(), renderResultList(), showError()
 * - result-renderer: isSectionEnabled(), sourceConfig, sidebar, getKnowledgeBaseLabel(),
 *   currentSolution, getCaseDataFromPage(), toggle(), isVisible, displaySources? (optional)
 * - ai-availability: sidebar, aiAvailable
 * - storage-utils: sidebarHost, vlog()
 * - ui-components: sidebar, sourceConfig, sendMessageWithTimeout(), fetchRelatedItems(),
 *   boundHandlers, eventHandlers, isSectionEnabled(), notifyButtonVisibilityChange(), isVisible, vlog()
 * - solution-tools: sidebar, currentSolution, getCaseDataFromPage(), vlog()
 * - import-tools: sidebar, importModule (legacy), getCaseDataFromPage(), showError()
 * - case-details: sidebar, utils.getProductIconHTML(), showWarning(), vlog()
 */

/**
 * @typedef {Object} SidebarLabels
 * @property {string} entryLabel
 * @property {string} sidebarLabel
 */

/**
 * @typedef {Object} SidebarSectionVisibility
 * @property {boolean} jira
 * @property {boolean} confluence
 * @property {boolean} community
 */

/**
 * @typedef {Object} SidebarSourceConfig
 * @property {string} listSelector
 * @property {string} sectionSelector
 * @property {string} displayName
 * @property {(isManualFetch?: boolean) => Promise<any>} preload
 */

/**
 * @typedef {Object} SidebarEventBinding
 * @property {EventTarget} element
 * @property {string} type
 * @property {Function} handler
 */

/**
 * Core lifecycle contract (controller + visibility).
 * @typedef {Object} SidebarCoreContext
 * @property {HTMLElement|null} sidebar
 * @property {HTMLElement|null} sidebarHost
 * @property {ShadowRoot|null} shadowRoot
 * @property {ResizeObserver|null} resizeObserver
 * @property {MutationObserver|null} caseInfoObserver
 * @property {boolean} isVisible
 * @property {boolean} isOpening
 * @property {boolean} toggleInProgress
 * @property {number|undefined} suppressImmediateCloseUntil
 * @property {Record<string, SidebarEventBinding>} eventHandlers
 * @property {Record<string, Function>} boundHandlers
 * @property {(show?: boolean) => Promise<void>} toggle
 * @property {() => Promise<void>} ensureInitialized
 * @property {() => Promise<void>} loadPreloadSettings
 * @property {() => Promise<void>} resetToInitialState
 * @property {(attempt?: number) => Promise<void>} loadCaseDetailsEnhanced
 * @property {() => void} ensureRefreshButtonWired
 * @property {() => void} setupCaseInfoObserver
 * @property {() => Promise<void>} applySidebarWidth
 * @property {() => void} handleResize
 * @property {() => void} notifyButtonVisibilityChange
 * @property {(...args: any[]) => void} vlog
 */

/**
 * UI rendering contract.
 * @typedef {Object} SidebarUiContext
 * @property {HTMLElement|null} sidebar
 * @property {Map<string, SidebarSourceConfig>} sourceConfig
 * @property {SidebarSectionVisibility} sectionVisibility
 * @property {string|null} currentSolution
 * @property {boolean} isVisible
 * @property {Record<string, SidebarEventBinding>} eventHandlers
 * @property {Record<string, Function>} boundHandlers
 * @property {(type: string) => boolean} isSectionEnabled
 * @property {(type: string, items?: any[]) => void} renderResultList
 * @property {(type: string, message: string) => void} renderErrorState
 * @property {(type: string, isConfigured: boolean) => void} renderFetchButton
 * @property {(sources: any[]) => Promise<void>|void} [displaySources]
 * @property {(message: Object, timeoutMs?: number) => Promise<any>} sendMessageWithTimeout
 * @property {(type: string) => Promise<any>} fetchRelatedItems
 * @property {() => void} showImprovedSection
 * @property {(hint: Element) => void} showTooltipForHint
 * @property {(hint: Element) => void} hideTooltipForHint
 * @property {(type?: string) => string} getKnowledgeBaseLabel
 * @property {() => void} applyKnowledgeBaseLabelsToSidebar
 * @property {(...args: any[]) => void} vlog
 */

/**
 * State and settings contract.
 * @typedef {Object} SidebarStateContext
 * @property {SidebarLabels} knowledgeBaseLabels
 * @property {SidebarSectionVisibility} sectionVisibility
 * @property {boolean} aiAvailable
 * @property {(visibility: SidebarSectionVisibility) => void} applySectionVisibility
 * @property {(type: string) => boolean} isSectionEnabled
 * @property {() => Promise<void>} applySidebarWidth
 * @property {() => void} restoreCollapseState
 * @property {(controlId: string, isCollapsed: boolean) => void} saveCollapseStateEntry
 * @property {(type: string, isConfigured: boolean) => void} renderFetchButton
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadJiraTickets
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadConfluenceArticles
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadCommunityGuides
 * @property {() => Promise<void>} updateAiAvailability
 * @property {() => void} updateKnowledgeBaseSourceConfig
 * @property {() => void} applyKnowledgeBaseLabelsToSidebar
 * @property {() => Promise<boolean>} hasAtlassianToken
 */

/**
 * Feature flow contract (solutions/import/preload/case details).
 * @typedef {Object} SidebarFeatureContext
 * @property {HTMLElement|null} sidebar
 * @property {string|null} currentSolution
 * @property {boolean} aiAvailable
 * @property {() => Object} getCaseDataFromPage
 * @property {(message: Object, timeoutMs?: number) => Promise<any>} sendMessageWithTimeout
 * @property {(message: string) => void} showWarning
 * @property {(message: string) => void} showError
 * @property {(type: string, isManualFetch?: boolean) => Promise<any>} preloadSource
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadJiraTickets
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadConfluenceArticles
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadCommunityGuides
 * @property {(type: string) => Promise<any>} fetchRelatedItems
 * @property {(type: string, items?: any[]) => void} renderResultList
 * @property {(type: string, message: string) => void} renderErrorState
 * @property {(type?: string) => string} getKnowledgeBaseLabel
 * @property {() => void} showImprovedSection
 * @property {(...args: any[]) => void} vlog
 * @property {Object} [utils]
 * @property {(productName: string) => string} [utils.getProductIconHTML]
 * @property {Object} [importModule]
 */

/**
 * @typedef {Object} SidebarContext
 * @property {HTMLElement|null} sidebar
 * @property {HTMLElement|null} sidebarHost
 * @property {ShadowRoot|null} shadowRoot
 * @property {ResizeObserver|null} resizeObserver
 * @property {MutationObserver|null} caseInfoObserver
 * @property {boolean} isVisible
 * @property {boolean} isOpening
 * @property {boolean} toggleInProgress
 * @property {number|undefined} suppressImmediateCloseUntil
 * @property {boolean} aiAvailable
 * @property {boolean} verboseLogging
 * @property {string|null} currentSolution
 * @property {SidebarLabels} knowledgeBaseLabels
 * @property {SidebarSectionVisibility} sectionVisibility
 * @property {Map<string, SidebarSourceConfig>} sourceConfig
 * @property {Record<string, SidebarEventBinding>} eventHandlers
 * @property {Record<string, Function>} boundHandlers
 * @property {Record<string, any>} [featureModules]
 * @property {Object} [utils] - Legacy utility helpers.
 * @property {(productName: string) => string} [utils.getProductIconHTML]
 * @property {Object} [importModule] - Legacy import tool overrides.
 *
 * @property {(show?: boolean) => Promise<void>} toggle
 * @property {() => Promise<void>} ensureInitialized
 * @property {() => Promise<void>} loadPreloadSettings
 * @property {() => Promise<void>} resetToInitialState
 * @property {(attempt?: number) => Promise<void>} loadCaseDetailsEnhanced
 * @property {() => void} ensureRefreshButtonWired
 * @property {() => void} setupCaseInfoObserver
 * @property {() => Promise<void>} applySidebarWidth
 * @property {() => void} restoreCollapseState
 * @property {(controlId: string, isCollapsed: boolean) => void} saveCollapseStateEntry
 * @property {() => void} handleResize
 * @property {(...args: any[]) => void} vlog
 * @property {() => void} notifyButtonVisibilityChange
 * @property {() => void} showImprovedSection
 * @property {() => Promise<void>} handleSpellcheck
 * @property {() => Promise<void>} handleSuggestSolution
 * @property {() => Promise<void>} handleImproveSolution
 * @property {(overrideText?: string) => Promise<void>} handleImportText
 * @property {() => Promise<void>} handleCopyImprovedText
 * @property {(hint: Element) => void} showTooltipForHint
 * @property {(hint: Element) => void} hideTooltipForHint
 * @property {(message: string) => void} showWarning
 * @property {(message: string) => void} showError
 * @property {(type: string, items?: any[]) => void} renderResultList
 * @property {(type: string, message: string) => void} renderErrorState
 * @property {(type: string, isConfigured: boolean) => void} renderFetchButton
 * @property {(sources: any[]) => Promise<void>|void} [displaySources]
 * @property {(type?: string) => string} getKnowledgeBaseLabel
 * @property {() => void} applyKnowledgeBaseLabelsToSidebar
 * @property {() => void} updateKnowledgeBaseSourceConfig
 * @property {() => Object} getCaseDataFromPage
 * @property {(type: string, isManualFetch?: boolean) => Promise<any>} preloadSource
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadJiraTickets
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadConfluenceArticles
 * @property {(isManualFetch?: boolean) => Promise<any>} preloadCommunityGuides
 * @property {(type: string) => Promise<any>} fetchRelatedItems
 * @property {(message: Object, timeoutMs?: number) => Promise<any>} sendMessageWithTimeout
 * @property {() => Promise<void>} updateAiAvailability
 * @property {(type: string) => boolean} isSectionEnabled
 * @property {(visibility: SidebarSectionVisibility) => void} applySectionVisibility
 * @property {() => Promise<boolean>} hasAtlassianToken
 */

export {};
