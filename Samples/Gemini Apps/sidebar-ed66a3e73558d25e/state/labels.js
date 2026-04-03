import { createLogger } from '../../utils/logger.js';
const logger = createLogger('SidebarLabels');

export function getProductIconHTML(sidebar, productName) {
    if (sidebar.uiModule && typeof sidebar.uiModule.getProductIconHTML === 'function') {
        try { return sidebar.uiModule.getProductIconHTML(sidebar, productName); } catch (e) { /* fallback */ }
    }
    // fallback to existing inline logic
    if (sidebar.utils && typeof sidebar.utils.getProductIconHTML === 'function') {
        try { return sidebar.utils.getProductIconHTML(productName); } catch (e) { /* fallthrough */ }
    }
    if (!productName) return '';
    const productLower = productName.toLowerCase();
    if (productLower === 'impact' || productLower.includes('impact')) {
        return `<img src="${chrome.runtime.getURL('icons/impact.svg')}" alt="Impact" class="product-icon" />`;
    }
    return '';
}

/**
 * Get the current label for Knowledge Base based on context.
 */
export function getKnowledgeBaseLabel(sidebar, type = 'entry') {
    const entry = sidebar.knowledgeBaseLabels?.entryLabel || 'Knowledge Base';
    const sidebarLabel = sidebar.knowledgeBaseLabels?.sidebarLabel || entry;

    if (type === 'sidebar') return sidebarLabel;
    if (type === 'options') return `${entry} Guides`;
    return entry;
}

/**
 * Load Knowledge Base labels from storage.
 */
export async function loadKnowledgeBaseLabels(sidebar) {
    try {
        const { knowledgeBaseLabels } = await chrome.storage.local.get('knowledgeBaseLabels');
        if (knowledgeBaseLabels) {
            sidebar.knowledgeBaseLabels = {
                entryLabel: knowledgeBaseLabels.entryLabel?.trim() || 'Knowledge Base',
                sidebarLabel: knowledgeBaseLabels.sidebarLabel?.trim() || knowledgeBaseLabels.entryLabel?.trim() || 'Knowledge Base'
            };
            if (typeof sidebar.updateKnowledgeBaseSourceConfig === 'function') {
                sidebar.updateKnowledgeBaseSourceConfig();
            }
            if (typeof sidebar.applyKnowledgeBaseLabelsToSidebar === 'function') {
                sidebar.applyKnowledgeBaseLabelsToSidebar();
            }
        }
    } catch (e) {
        logger.debug('Error loading knowledgeBaseLabels from storage', 'labels', e);
    }
}

/**
 * Apply Knowledge Base labels to the sidebar DOM.
 */
export function applyKnowledgeBaseLabelsToSidebar(sidebar) {
    if (!sidebar.sidebar) return;
    const title = sidebar.sidebar.querySelector('#community-guides .section-title');
    if (title) title.textContent = getKnowledgeBaseLabel(sidebar, 'sidebar');
    const filterInput = sidebar.sidebar.querySelector('#community-guides .results-filter');
    if (filterInput) filterInput.placeholder = `Filter ${getKnowledgeBaseLabel(sidebar, 'sidebar')}...`;
}
