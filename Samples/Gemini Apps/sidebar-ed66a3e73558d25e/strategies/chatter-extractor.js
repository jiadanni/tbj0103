/**
 * Strategy for extracting text from Salesforce Chatter publishers.
 */
import { InputStrategy } from './input-strategy.js';
import { createLogger } from '../../utils/logger.js';
import { isElementInSidebar, isTextEntryElement, isSubjectFieldElement, isElementVisible } from './shadow-dom-utils.js';
import { extractTextFromElement } from './selection-extractor.js';

const logger = createLogger('ChatterExtractor');

export class ChatterExtractor extends InputStrategy {
    constructor(sidebar) {
        super();
        this.sidebar = sidebar;
    }

    canHandle() {
        // Optimistically check for chatter publisher elements
        return !!document.querySelector('.forceChatterPublisher, .slds-publisher, [class*="chatter"]');
    }

    execute() {
        return this.getOperatorInputText(this.sidebar);
    }

    getOperatorInputText(sidebar) {
        try {
            logger.info('=== Chatter Text Detection Debug ===', 'chatter-extractor', undefined);

            // Method 1: Check currently focused element first (but exclude sidebar elements)
            const focusedElement = document.activeElement;

            if (focusedElement && !isElementInSidebar(sidebar, focusedElement)) {
                if (!isTextEntryElement(focusedElement)) {
                    // not text entry
                } else if (isSubjectFieldElement(focusedElement)) {
                    // subject field
                } else {
                    const focusedText = extractTextFromElement(focusedElement);
                    if (focusedText) {
                        logger.debug('✓ Found text in focused element:', 'chatter-extractor', focusedText.substring(0, 50) + '...');
                        return focusedText;
                    }
                }
            }

            // Method 2: Comprehensive selector search with multiple extraction methods
            const selectors = [
                // Quill editors (most common in Salesforce Chatter)
                '.ql-editor',
                '.forceChatterPublisher .ql-editor',
                '.slds-publisher .ql-editor',
                '.publisherContainer .ql-editor',
                '[data-aura-class*="forceChatterPublisher"] .ql-editor',
                '.forceChatterCommentPublisher .ql-editor',
                '[data-aura-class*="CommentPublisher"] .ql-editor',

                // Contenteditable elements
                '[contenteditable="true"]',
                '.forceChatterPublisher [contenteditable="true"]',
                '.slds-publisher [contenteditable="true"]',
                '.publisherContainer [contenteditable="true"]',

                // Text areas and inputs
                'textarea',
                'input[type="text"]',
                '.forceChatterPublisher textarea',
                '.slds-publisher textarea',

                // Rich text editor patterns
                '.cke_editable',
                '.mce-content-body',
                '[role="textbox"]',

                // Generic patterns that might contain user input
                '[class*="chatter"] .ql-editor',
                '[class*="publisher"] .ql-editor',
                '[class*="composer"] .ql-editor',
                '[class*="editor"]',

                // Lightning patterns
                'lightning-input-rich-text [contenteditable]',
                'lightning-textarea textarea',

                // Salesforce specific patterns
                '[data-target-selection-name*="chatter"] .ql-editor',
                '[data-aura-class*="chatter"] .ql-editor'
            ];

            const foundElements = [];

            // Search with each selector and collect all potential elements
            for (const selector of selectors) {
                try {
                    const elements = document.querySelectorAll(selector);
                    for (const element of elements) {
                        // Skip sidebar elements
                        if (isElementInSidebar(sidebar, element)) continue;
                        if (!isTextEntryElement(element)) continue;
                        // Skip Subject field elements - we want Chatter text, not case subject
                        if (isSubjectFieldElement(element)) {
                            continue;
                        }

                        const text = extractTextFromElement(element);
                        if (text) {
                            foundElements.push({
                                element: element,
                                text: text,
                                selector: selector,
                                isFocused: element === focusedElement,
                                isVisible: isElementVisible(element),
                                length: text.length
                            });
                        }
                    }
                } catch (e) {
                    logger.warn('Selector failed:', 'chatter-extractor', selector, e.message);
                }
            }

            if (foundElements.length === 0) {
                return null;
            }

            // Priority sorting: focused > visible > longest text
            foundElements.sort((a, b) => {
                if (a.isFocused && !b.isFocused) return -1;
                if (!a.isFocused && b.isFocused) return 1;
                if (a.isVisible && !b.isVisible) return -1;
                if (!a.isVisible && b.isVisible) return 1;
                return b.length - a.length; // Longest text first
            });

            const selectedItem = foundElements[0];
            logger.debug('✓ Selected text:', 'chatter-extractor', selectedItem.text.substring(0, 50) + '...');

            return selectedItem.text;

        } catch (error) {
            logger.error('Error getting operator input text:', 'chatter-extractor', error);
            // Return null is expected by InputStrategy interface when no text is found, 
            // but we log the error for diagnostics.
            return null;
        }
    }
}
