/**
 * Shortcuts UI Module
 * Handles keyboard shortcuts help tooltip logic
 * 
 * @module sidebar/ui/shortcuts
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('Shortcuts');

/**
 * Setup keyboard shortcuts help tooltip logic
 * @param {Object} context - The sidebar controller context
 * @param {Function} getShortcutHelpHTML - Function that returns the HTML content for the help tooltip
 */
export function setupShortcutsHelp(context, getShortcutHelpHTML) {
    if (!context.sidebar) return;

    const helpBtn = context.sidebar.querySelector('#shortcuts-help-btn');
    const tooltip = context.sidebar.querySelector('#shortcuts-help-tooltip');
    const content = tooltip?.querySelector('.shortcuts-help-content');

    if (!helpBtn || !tooltip || !content) return;

    helpBtn.setAttribute('role', 'button');
    helpBtn.setAttribute('aria-controls', 'shortcuts-help-tooltip');
    helpBtn.setAttribute('aria-expanded', 'false');

    const renderHelpContent = () => {
        if (typeof getShortcutHelpHTML === 'function') {
            try {
                content.innerHTML = getShortcutHelpHTML();
                return;
            } catch (err) {
                logger.warn('Failed to render shortcuts help content', 'shortcuts', err);
            }
        }
        content.textContent = 'Keyboard shortcuts unavailable.';
    };

    const setTooltipOpen = (open) => {
        tooltip.classList.toggle('hidden', !open);
        helpBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) renderHelpContent();
    };

    const isTooltipOpen = () => !tooltip.classList.contains('hidden');

    const removeHandler = (key) => {
        const existing = context.eventHandlers[key];
        if (existing) {
            existing.element.removeEventListener(existing.type, existing.handler);
            delete context.eventHandlers[key];
        }
    };

    removeHandler('shortcutsHelpClick');
    removeHandler('shortcutsHelpKeydown');
    removeHandler('shortcutsHelpDismiss');

    context.boundHandlers.shortcutsHelpClick = () => {
        setTooltipOpen(!isTooltipOpen());
    };
    helpBtn.addEventListener('click', context.boundHandlers.shortcutsHelpClick);
    context.eventHandlers.shortcutsHelpClick = { element: helpBtn, type: 'click', handler: context.boundHandlers.shortcutsHelpClick };

    context.boundHandlers.shortcutsHelpKeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setTooltipOpen(!isTooltipOpen());
        }
    };
    helpBtn.addEventListener('keydown', context.boundHandlers.shortcutsHelpKeydown);
    context.eventHandlers.shortcutsHelpKeydown = { element: helpBtn, type: 'keydown', handler: context.boundHandlers.shortcutsHelpKeydown };

    context.boundHandlers.shortcutsHelpDismiss = (event) => {
        if (!isTooltipOpen()) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const clickInside = path.length
            ? path.includes(helpBtn) || path.includes(tooltip)
            : helpBtn.contains(event.target) || tooltip.contains(event.target);

        if (!clickInside) setTooltipOpen(false);
    };
    document.addEventListener('click', context.boundHandlers.shortcutsHelpDismiss);
    context.eventHandlers.shortcutsHelpDismiss = { element: document, type: 'click', handler: context.boundHandlers.shortcutsHelpDismiss };

    if (!tooltip.classList.contains('hidden')) {
        tooltip.classList.add('hidden');
        helpBtn.setAttribute('aria-expanded', 'false');
    }

    renderHelpContent();
}
