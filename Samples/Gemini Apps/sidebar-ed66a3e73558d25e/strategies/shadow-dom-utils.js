/**
 * DOM and Shadow DOM utility functions.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ShadowDomUtils');

/**
 * Check if an element is visible
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isElementVisible(element) {
    try {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 &&
            rect.height > 0 &&
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none';
    } catch (e) {
        logger.debug('Error checking element visibility:', 'shadow-dom-utils', e);
        return false;
    }
}

/**
 * Check if an element represents a user-editable text field/editor.
 * Prevents us from harvesting page chrome or button labels.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isTextEntryElement(element) {
    if (!element || (typeof Node !== 'undefined' && element.nodeType !== Node.ELEMENT_NODE)) return false;

    const tag = element.tagName?.toLowerCase();

    if (tag === 'textarea') return true;

    if (tag === 'input') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        const textTypes = ['text', 'email', 'search', 'tel', 'url', 'number', 'password', ''];
        return textTypes.includes(type);
    }

    if (element.isContentEditable || element.hasAttribute('contenteditable')) return true;
    if (element.classList?.contains('ql-editor')) return true;
    if (element.getAttribute && element.getAttribute('role') === 'textbox') return true;

    return false;
}

/**
 * Check if text is just a placeholder
 * @param {string} text
 * @returns {boolean}
 */
export function isPlaceholderText(text) {
    const placeholderPatterns = [
        'share an update',
        'what\'s on your mind',
        'write a comment',
        'add a comment',
        'type your message',
        'enter text here',
        'click here to',
        'placeholder'
    ];

    const lowerText = text.toLowerCase();
    return placeholderPatterns.some(pattern => lowerText.includes(pattern));
}

/**
 * Check if an element is part of the Sidebar
 * @param {Object} sidebar - Sidebar instance
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isElementInSidebar(sidebar, element) {
    if (!element) return false;
    return sidebar.sidebar?.contains(element) || element.closest('#ai-sidebar, .ai-sidebar');
}

/**
 * Check if an element is part of the Subject field (not the Chatter text area).
 * Subject fields should be excluded from Chatter text import.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isSubjectFieldElement(element) {
    if (!element) return false;

    // Check element itself and ancestors for Subject field indicators
    let current = element;
    while (current && current !== document.body) {
        // Check class names for subject-related patterns
        const className = current.className || '';
        const classLower = typeof className === 'string' ? className.toLowerCase() : '';

        // Check for Salesforce subject field patterns
        if (classLower.includes('subject') ||
            classLower.includes('case-subject') ||
            classLower.includes('casesubject')) {
            return true;
        }

        // Check data attributes
        const dataTarget = current.getAttribute?.('data-target-selection-name') || '';
        if (dataTarget.toLowerCase().includes('subject')) {
            return true;
        }

        // Check aria-label
        const ariaLabel = current.getAttribute?.('aria-label') || '';
        if (ariaLabel.toLowerCase().includes('subject')) {
            return true;
        }

        // Check for label associations
        const labelledBy = current.getAttribute?.('aria-labelledby');
        if (labelledBy) {
            const labelElement = document.getElementById(labelledBy);
            if (labelElement?.textContent?.toLowerCase().includes('subject')) {
                return true;
            }
        }

        // Check preceding label
        const prevSibling = current.previousElementSibling;
        if (prevSibling?.tagName === 'LABEL' &&
            prevSibling.textContent?.toLowerCase().includes('subject')) {
            return true;
        }

        current = current.parentElement;
    }

    return false;
}

/**
 * Recursively searches for elements matching a selector, piercing Shadow DOM boundaries.
 * @param {string} selector
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
export function querySelectorAllDeep(selector, root = document) {
    const results = [];

    // Add matches from the current root
    if (root.querySelectorAll) {
        results.push(...Array.from(root.querySelectorAll(selector)));
    }

    // Find all elements with shadow roots in this root
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];

    for (const el of elements) {
        if (el.shadowRoot) {
            results.push(...querySelectorAllDeep(selector, el.shadowRoot));
        }
    }

    return results;
}
