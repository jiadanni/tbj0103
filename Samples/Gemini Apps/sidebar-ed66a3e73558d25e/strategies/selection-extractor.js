/**
 * Strategy for extracting text from user selection.
 */
import { InputStrategy } from './input-strategy.js';
import { createLogger } from '../../utils/logger.js';
import { isPlaceholderText, isTextEntryElement } from './shadow-dom-utils.js';

const logger = createLogger('SelectionExtractor');

export class SelectionExtractor extends InputStrategy {
    canHandle() {
        const selection = window.getSelection();
        return selection && selection.toString().trim().length > 0;
    }

    execute() {
        const selection = window.getSelection();
        const text = selection?.toString()?.trim();
        if (text && text.length > 10) {
            logger.debug('Found selected text', 'selection-extractor');
            return text;
        }
        return null;
    }
}

/**
 * Helper to extract text from a specific element based on its type.
 * moved from import-tools.js extractTextFromElementHelper
 */
export function extractTextFromElement(element) {
    if (!element || !isTextEntryElement(element)) return null;

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        const text = element.value?.trim();
        if (text && text.length > 3) return text;
    }

    if (element.isContentEditable || element.hasAttribute('contenteditable')) {
        const innerText = element.innerText?.trim();
        if (innerText && innerText.length > 3 && !isPlaceholderText(innerText)) {
            return innerText;
        }
    }

    const textContent = element.textContent?.trim();
    if (textContent && textContent.length > 3 && !isPlaceholderText(textContent)) {
        return textContent;
    }

    return null;
}
