/**
 * Shared helpers for sidebar import tools.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ImportTextHelpers');
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

export function extractTextFromElement(element) {
  if (!element || !isTextEntryElement(element)) return null;

  // Method 1: For input/textarea elements, use value
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const text = element.value?.trim();
    if (text && text.length > 3) return text;
  }

  // Method 2: For contenteditable elements, try innerText first
  if (element.isContentEditable || element.hasAttribute('contenteditable')) {
    const innerText = element.innerText?.trim();
    if (innerText && innerText.length > 3 && !isPlaceholderText(innerText)) {
      return innerText;
    }
  }

  // Method 3: Try textContent
  const textContent = element.textContent?.trim();
  if (textContent && textContent.length > 3 && !isPlaceholderText(textContent)) {
    return textContent;
  }

  // Method 4: For rich text editors, try innerHTML parsing
  if (element.innerHTML && element.innerHTML.includes('<')) {
    try {
      // Avoid using innerHTML to prevent DOM-based XSS.
      // The text content should already be extracted by innerText or textContent.
    } catch (e) {
      logger.debug('Error in HTML safety check:', 'import-text-helpers', e);
    }
  }

  return null;
}

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
    logger.debug('Error checking element visibility:', 'import-text-helpers', e);
    return false;
  }
}

export function elementHasSelection(element) {
  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    return element.contains(container) || element === container;
  } catch (e) {
    logger.debug('Error checking element selection:', 'import-text-helpers', e);
    return false;
  }
}

export function debugAllElements() {
  const allInputs = document.querySelectorAll('input, textarea, [contenteditable], .ql-editor');
  logger.debug(`Found ${allInputs.length} total input-like elements:`, 'import-text-helpers');

  allInputs.forEach((el, i) => {
    const text = el.value || el.innerText || el.textContent || '';
    logger.debug(
      `${i + 1}. ${el.tagName}.${el.className} = "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}" (${text.length} chars)`,
      'import-text-helpers'
    );
  });
}
