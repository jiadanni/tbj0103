/**
 * Sidebar State Manager
 * Handles state derivation, settings retrieval, and UI synchronization.
 * Refactored to separate Data (State) from View (DOM).
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('StateManager');

export class SidebarStateManager {
    constructor() {
        this.isAuthenticated = false;
    }

    /**
     * Load all configuration and derive the target state for the sidebar
     * @returns {Promise<Object>} The calculated state object
     */
    async loadState() {
        // FAST FAIL: Check context validity before anything else
        // This prevents "active" checks or logs from crashing if the runtime is gone
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
            return {
                valid: false,
                error: new Error('Extension context invalidated')
            };
        }

        try {
            const keys = [
                'atlassianToken',
                'aiServiceToken',
                'preloadSettings',
                'communityGuides',
                'sidebarSections',
                'knowledgeBaseLabels'
            ];

            const storage = await chrome.storage.local.get(keys);

            const sectionVisibility = this.normalizeSectionVisibility(storage.sidebarSections);
            const communitySettings = this.deriveCommunitySettings(storage.preloadSettings, storage.communityGuides);

            return {
                valid: true,
                tokens: {
                    atlassian: !!(storage.atlassianToken && storage.atlassianToken.trim()),
                    ai: !!(storage.aiServiceToken)
                },
                visibility: sectionVisibility,
                preload: {
                    jira: storage.preloadSettings?.jira !== false,
                    confluence: storage.preloadSettings?.confluence !== false,
                    community: communitySettings.shouldPreloadCommunity
                },
                hasCommunityGuides: communitySettings.hasCommunityGuides,
                labels: storage.knowledgeBaseLabels || { entryLabel: 'Knowledge Base', sidebarLabel: 'Knowledge Base' }
            };

        } catch (error) {
            logger.error('Error loading state:', 'state-manager', error);
            return {
                valid: false,
                error: error
            };
        }
    }

    normalizeSectionVisibility(sections = {}) {
        return {
            jira: sections.jira !== false,
            confluence: sections.confluence !== false,
            community: sections.community !== false
        };
    }

    deriveCommunitySettings(preloadSettings = {}, communityGuides = []) {
        const shouldPreloadCommunity = (typeof preloadSettings?.community !== 'undefined')
            ? preloadSettings.community !== false
            : preloadSettings?.knowledgeBase !== false;

        const hasCommunityGuides = Array.isArray(communityGuides) && communityGuides.length > 0;

        return { shouldPreloadCommunity, hasCommunityGuides };
    }
}

// ============================================================================
// UI RENDRING HELPERS (View Layer)
// These functions apply the State object to the DOM.
// They mimic the legacy resetToInitialState behavior but use the clean State object.
// ============================================================================

function renderStatus(container, className, text) {
    if (!container) return;
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    container.replaceChildren(el);
}

/**
 * Apply the calculated state to the Sidebar UI
 * @param {Object} sidebar - The Sidebar View Controller instance
 * @param {Object} state - The state object from SidebarStateManager.loadState()
 */
export function applyStateToView(sidebar, state) {
    if (!state.valid) {
        handleStateLoadError(sidebar, state.error);
        return;
    }

    // 1. Apply Visibility
    if (typeof sidebar.applySectionVisibility === 'function') {
        sidebar.applySectionVisibility(state.visibility);
    }

    // 2. Render Section States (Loading vs Fetch Button)

    // JIRA
    if (state.visibility.jira) {
        if (state.preload.jira) {
            const list = sidebar.sidebar.querySelector('#jira-list');
            renderStatus(list, 'loading', 'Loading JIRA tickets...');
            // Trigger side-effect (Controller action)
            sidebar.preloadJiraTickets().catch(() => { });
        } else {
            sidebar.renderFetchButton('jira', state.tokens.atlassian);
        }
    }

    // Confluence
    if (state.visibility.confluence) {
        if (state.preload.confluence) {
            const list = sidebar.sidebar.querySelector('#confluence-list');
            renderStatus(list, 'loading', 'Loading Confluence pages...');
            sidebar.preloadConfluenceArticles().catch(() => { });
        } else {
            sidebar.renderFetchButton('confluence', state.tokens.atlassian);
        }
    }

    // Community / Knowledge Base
    if (state.visibility.community) {
        if (state.preload.community) {
            if (state.hasCommunityGuides) {
                const list = sidebar.sidebar.querySelector('#community-list');
                const label = state.labels.sidebarLabel || 'Knowledge Base';
                renderStatus(list, 'loading', `Loading ${label}...`);
                sidebar.preloadCommunityGuides().catch(() => { });
            } else {
                // No knowledge base data loaded - show grayed-out fetch button
                sidebar.renderFetchButton('community', false);
            }
        } else {
            // Preload disabled - show fetch button (grayed out if no data available)
            sidebar.renderFetchButton('community', state.hasCommunityGuides);
        }
    }
}

function handleStateLoadError(sidebar, error) {
    // Handle extension context invalidated specifically
    if (error && (error.message.includes('Extension context invalidated') ||
        error.message.includes('receiving end does not exist'))) {
        const reloadMessage = 'PandAid was updated. Please refresh your browser page to continue.';

        ['#jira-list', '#confluence-list', '#community-list'].forEach(selector => {
            const list = sidebar.sidebar.querySelector(selector);
            if (list) {
                renderStatus(list, 'info', reloadMessage);
                const btn = document.createElement('button');
                btn.className = 'action-button';
                btn.style.marginTop = '8px';
                btn.textContent = 'Refresh Page';
                btn.onclick = () => window.location.reload();
                list.appendChild(btn);
            }
        });
    } else {
        // Fallback: show fetch buttons
        sidebar.renderFetchButton('jira', false);
        sidebar.renderFetchButton('confluence', false);
        sidebar.renderFetchButton('community', false);
    }
}

/**
 * Reset UI elements to their initial clean state
 * @param {Object} sidebar - Sidebar instance
 */
export function resetDOM(sidebar) {
    // Clear text areas
    const originalInput = sidebar.sidebar.querySelector('#original-text-input');
    const improvedInput = sidebar.sidebar.querySelector('#improved-text-input');
    if (originalInput) originalInput.value = '';
    if (improvedInput) improvedInput.value = '';

    // Clear current solution state
    sidebar.currentSolution = null;

    // Hide improved section
    const improvedSection = sidebar.sidebar.querySelector('#improved-section');
    if (improvedSection) improvedSection.classList.add('hidden');

    // Remove enhanced badges
    try {
        sidebar.sidebar.querySelectorAll('.related-section.enhanced').forEach(sec => {
            sec.classList.remove('enhanced');
            const badge = sec.querySelector('.enhanced-badge');
            if (badge) badge.remove();
        });
    } catch (e) {
        logger.warn('Failed to remove enhanced badges during reset', 'resetDOM', e);
    }

    // Reset Case Info
    const caseDetailsDiv = sidebar.sidebar.querySelector('#case-details');
    if (caseDetailsDiv) {
        const caseInfo = caseDetailsDiv.querySelector('#case-info');
        const loadingHTML = '<div class="loading">Click "PandAid" to load case details...</div>';
        if (caseInfo) caseInfo.innerHTML = loadingHTML;
    }

    // Reset errors and buttons
    sidebar.sidebar.querySelectorAll('.error').forEach(el => el.remove());
    sidebar.sidebar.querySelectorAll('button').forEach(btn => {
        if (btn.id !== 'ai-sidebar-close-btn') {
            const originalText = btn.getAttribute('data-original-text');
            // Simple text reset
            if (originalText) {
                const textSpan = btn.querySelector('.button-text');
                if (textSpan) textSpan.textContent = originalText.replace(/^[^\s]+\s/, '');
            }
            btn.disabled = false;
        }
    });

    sidebar.ensureRefreshButtonWired();
}

// ============================================================================
// LEGACY COMPATIBILITY BRIDGE
// ============================================================================

const store = new SidebarStateManager();

export async function resetToInitialState(sidebar) {
    resetDOM(sidebar);
    const state = await store.loadState();
    applyStateToView(sidebar, state);
}

export async function loadPreloadSettings(sidebar) {
    const state = await store.loadState();
    applyStateToView(sidebar, state); // reuse same logic
}
