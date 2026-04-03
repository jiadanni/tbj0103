// modules/sidebar/ui/loader.js
//
// Handles creation and initial structural setup of the sidebar UI.

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('UI-Loader');

/**
 * Creates the sidebar element and injects its HTML/CSS structure.
 */
export async function createSidebar(sidebarInstance) {
    if (sidebarInstance.sidebarHost) return;

    // Create sidebar host (the element in the main page DOM)
    const host = document.createElement('div');
    host.id = 'sf-pandaid-sidebar-host';
    sidebarInstance.sidebarHost = host;

    // Attach Shadow Root
    const shadow = host.attachShadow({ mode: 'open' });
    sidebarInstance.shadowRoot = shadow;

    // Create sidebar container inside the shadow DOM
    const sidebar = document.createElement('div');
    sidebar.id = 'sf-case-assistant-sidebar';
    sidebar.className = 'sf-sidebar';
    shadow.appendChild(sidebar);
    sidebarInstance.sidebar = sidebar;

    try {
        const htmlUrl = chrome.runtime.getURL('sidebar.html');
        const cssUrl = chrome.runtime.getURL('sidebar.css');

        // Fetch both HTML and CSS
        const [htmlResp, cssResp] = await Promise.allSettled([fetch(htmlUrl), fetch(cssUrl)]);

        // Apply CSS to Shadow Root only
        if (cssResp.status === 'fulfilled' && cssResp.value.ok) {
            const cssText = await cssResp.value.text();
            const styleEl = document.createElement('style');
            styleEl.id = 'sf-sidebar-styles';
            styleEl.textContent = cssText;
            shadow.appendChild(styleEl);

            // Inject MINIMAL global styles for the tooltip if they aren't already present
            injectGlobalTooltipStyles();
        } else {
            logger.warn('Failed to load sidebar.css', 'sidebar');
        }

        // Fetch and insert HTML into the container inside shadow
        if (htmlResp.status === 'fulfilled' && htmlResp.value.ok) {
            const htmlText = await htmlResp.value.text();
            const template = document.createElement('template');
            template.innerHTML = htmlText;
            sidebar.replaceChildren(template.content.cloneNode(true));
        } else {
            logger.warn('Failed to load sidebar.html, using inline fallback', 'sidebar');
            injectFallbackMarkup(sidebar);
        }

        // Fix header image src
        const img = sidebar.querySelector('.header-icon');
        if (img) {
            img.src = chrome.runtime.getURL('images/copandacrop48.png');
        }

        // Load and apply custom sidebar label
        try {
            const settings = await chrome.storage.local.get(['sidebarLabel']);
            const sidebarLabel = settings.sidebarLabel?.trim() || 'PandAid Case Assistant';
            const titleEl = sidebar.querySelector('.header-title');
            if (titleEl) {
                titleEl.textContent = sidebarLabel;
            }
        } catch (e) {
            logger.warn('Failed to load sidebar label from storage', 'sidebar', e);
        }

        // Load and apply sidebar width
        if (typeof sidebarInstance.applySidebarWidth === 'function') {
            await sidebarInstance.applySidebarWidth();
        }
    } catch (err) {
        logger.error('Error loading sidebar resources:', 'sidebar', err);
    }

    // Append host to DOM
    if (!document.body.contains(host)) {
        document.body.appendChild(host);
    }

    // Setup observer for case-info
    if (typeof sidebarInstance.setupCaseInfoObserver === 'function') {
        try {
            sidebarInstance.setupCaseInfoObserver();
        } catch (e) {
            logger.warn('Failed to setup case-info observer:', 'sidebar', e);
        }
    }
}

function injectGlobalTooltipStyles() {
    if (document.getElementById('sf-global-tooltip-styles')) return;
    const style = document.createElement('style');
    style.id = 'sf-global-tooltip-styles';
    style.textContent = `
        #sf-global-tooltip {
            position: fixed;
            z-index: 2147483647;
            background: #172B4D;
            color: #FFFFFF;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.4;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            pointer-events: none;
            display: none;
            max-width: 300px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
    `;
    document.head.appendChild(style);
}

function injectFallbackMarkup(sidebar) {
    const header = document.createElement('div');
    header.className = 'ai-sidebar-header';
    const h3 = document.createElement('h3');
    h3.textContent = 'PandAid Case Assistant';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'ai-sidebar-close-btn';
    closeBtn.className = 'sf-sidebar-close';
    closeBtn.textContent = '×';
    header.append(h3, closeBtn);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'ai-sidebar-content';
    const innerContent = document.createElement('div');
    innerContent.className = 'pa-main-content';
    const loading = document.createElement('p');
    loading.className = 'loading';
    loading.textContent = 'Sidebar template failed to load.';
    innerContent.appendChild(loading);
    contentWrapper.appendChild(innerContent);

    sidebar.replaceChildren(header, contentWrapper);
}
