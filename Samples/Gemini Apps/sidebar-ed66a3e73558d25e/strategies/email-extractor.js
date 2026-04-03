/**
 * Strategy for extracting text from Email composers (IFrames, CKEditor, Lightning inputs).
 */
import { InputStrategy } from './input-strategy.js';
import { createLogger } from '../../utils/logger.js';
import { generateMessageNonce, getFrameOrigin, isTrustedOrigin } from '../../utils/message-auth.js';
import { isElementInSidebar, isElementVisible, querySelectorAllDeep } from './shadow-dom-utils.js';

const logger = createLogger('EmailExtractor');

// Configuration for extraction behavior
const EXTRACTION_CONFIG = {
    MIN_TEXT_LENGTH: {
        PRIMARY: 10,        // oneIframeComposer & legacy methods
        IFRAME_BODY: 5,     // Shorter threshold for iframe body text
        FALLBACK: 20        // Stricter threshold for generic fallback
    },
    IFRAME_TIMEOUT: 2000,
    // Regex for matching toolbar UI patterns with word boundaries
    // Matches: "Font Size", "Bold Italic", "Align Left"
    // Does NOT match: "Font size is too small"
    TOOLBAR_PATTERN: /^[\s]*(Font|Size|Format|Bold|Italic|Underline|Align|List|Link|Image|Source|Styles|Paragraph|Heading)\s+(Font|Size|Format|Bold|Italic|Underline|Align|List|Link|Image|Source|Styles|Paragraph|Heading)[\s]*$/i
};

export class EmailExtractor extends InputStrategy {
    constructor(sidebar) {
        super();
        this.sidebar = sidebar;
    }

    async canHandle() {
        // Check if any email-like elements exist
        const emailElements = document.querySelectorAll('iframe, .emailComposer, [data-aura-class*="email"]');
        return emailElements.length > 0;
    }

    async execute() {
        // Try direct extraction first
        let emailText = await this.extractEmailText(this.sidebar);
        logger.debug(`Direct extraction result: ${emailText ? 'found ' + emailText.length + ' chars' : 'not found'}`, 'email-extractor');

        // If not found, try iframe message request with longer timeout
        if (!emailText) {
            logger.debug('Attempting iframe message request...', 'email-extractor');
            emailText = await this.requestEmailContentFromIframes(2000);
            logger.debug(`Iframe message result: ${emailText ? 'found ' + emailText.length + ' chars' : 'not found'}`, 'email-extractor');
        }

        return emailText;
    }

    /**
     * Helper: Extract text from elements matching a selector
     * @param {string|NodeList} selector - CSS selector or NodeList
     * @param {Function} textExtractor - Function to extract text from element
     * @param {number} minLength - Minimum text length requirement
     * @param {Document} contextDoc - Document to query (for iframe support)
     * @returns {string|null} - Extracted text or null
     */
    extractTextFromElements(selector, textExtractor, minLength, contextDoc) {
        const isToolbarText = this.createToolbarValidator();
        const doc = contextDoc || document;
        
        try {
            const elements = typeof selector === 'string' 
                ? querySelectorAllDeep(selector, doc)
                : selector;
            
            for (const element of elements) {
                if (isElementInSidebar(this.sidebar, element)) continue;
                const text = textExtractor(element)?.trim();
                if (text && text.length >= minLength && !isToolbarText(text)) {
                    return text;
                }
            }
        } catch (error) {
            logger.debug('Error extracting from elements', 'email-extractor', error?.message);
        }
        return null;
    }

    /**
     * Creates a toolbar text validator function (with closure over config)
     * @returns {Function} - Validator function
     */
    createToolbarValidator() {
        return (text) => {
            if (!text || typeof text !== 'string') return true;
            const normalized = text.trim();
            if (normalized.length === 0) return true;
            if (text.includes('\n') || text.includes('\r')) return false;
            return EXTRACTION_CONFIG.TOOLBAR_PATTERN.test(normalized);
        };
    }

    /**
     * Extract from iframe document with access checking
     * @param {HTMLIFrameElement} iframe - The iframe element
     * @returns {string|null} - Extracted text or null
     */
    extractFromIframeDocument(iframe) {
        const isToolbarText = this.createToolbarValidator();
        try {
            let doc = null;
            try {
                doc = iframe.contentDocument || iframe.contentWindow?.document;
            } catch (error) {
                logger.debug('Cross-origin iframe access restricted', 'email-extractor', error?.message);
                return null;
            }

            if (!doc) return null;

            // Try textarea#editor (standard)
            const editorTextarea = querySelectorAllDeep('textarea#editor, textarea[name="editor"]', doc)[0];
            if (editorTextarea?.value?.trim().length >= EXTRACTION_CONFIG.MIN_TEXT_LENGTH.PRIMARY && !isToolbarText(editorTextarea.value.trim())) {
                logger.debug('✓ Found email text in iframe editor textarea', 'email-extractor');
                return editorTextarea.value.trim();
            }

            // Try body text (shorter threshold)
            if (doc.body) {
                const bodyText = doc.body.innerText?.trim();
                if (bodyText?.length >= EXTRACTION_CONFIG.MIN_TEXT_LENGTH.IFRAME_BODY && !isToolbarText(bodyText)) {
                    logger.debug('✓ Found email text in iframe body', 'email-extractor');
                    return bodyText;
                }
            }

            // Try div[contenteditable]
            const editableDiv = querySelectorAllDeep('div[contenteditable="true"]', doc)[0];
            if (editableDiv?.innerText?.trim().length >= EXTRACTION_CONFIG.MIN_TEXT_LENGTH.IFRAME_BODY && !isToolbarText(editableDiv.innerText.trim())) {
                logger.debug('✓ Found email text in iframe div[contenteditable]', 'email-extractor');
                return editableDiv.innerText.trim();
            }
        } catch (error) {
            logger.debug('Unable to extract from iframe document', 'email-extractor', error?.message);
        }
        return null;
    }

    extractEmailText(sidebar) {
        try {
            // Try each extraction method in priority order, return first successful result
            
            // METHOD 1: Salesforce Lightning oneIframeComposer (HIGHEST PRIORITY)
            let result = this.tryOneIframeComposerStrategy();
            if (result) return result;

            // METHOD 2: CKEditor iframe content (legacy)
            result = this.tryCKEditorIframeStrategy();
            if (result) return result;

            // METHOD 3: CKEditor body elements
            result = this.tryCKEditorBodyStrategy(sidebar);
            if (result) return result;

            // METHOD 4: Standard form inputs
            result = this.tryEmailInputsStrategy(sidebar);
            if (result) return result;

            // METHOD 5: Lightning email components (legacy)
            result = this.tryLightningComponentStrategy(sidebar);
            if (result) return result;

            // METHOD 6: Generic fallback
            result = this.tryGenericFallbackStrategy(sidebar);
            if (result) return result;

            return null;
        } catch (error) {
            logger.error('Error extracting email text:', 'email-extractor', error);
            return null;
        }
    }

    tryOneIframeComposerStrategy() {
        const iframeComposers = querySelectorAllDeep('.oneIframeComposer');
        for (const composer of iframeComposers) {
            const iframes = querySelectorAllDeep('iframe', composer);
            for (const iframe of iframes) {
                const text = this.extractFromIframeDocument(iframe);
                if (text) return text;
            }
        }
        return null;
    }

    tryCKEditorIframeStrategy() {
        const ckeIframes = document.querySelectorAll(
            'iframe.cke_wysiwyg_frame, iframe[class*="cke"], .cke_contents iframe, ' +
            'iframe[title*="Email"], iframe[title*="Rich Text"], iframe[title="Email Body"], ' +
            'iframe[allowtransparency="true"]'
        );
        for (const iframe of ckeIframes) {
            const text = this.extractFromIframeDocument(iframe);
            if (text) return text;
        }
        return null;
    }

    tryCKEditorBodyStrategy(sidebar) {
        const selector = 'body.cke_editable, .cke_editable[contenteditable="true"], [class*="cke"][contenteditable="true"]';
        return this.extractTextFromElements(
            selector,
            (el) => el.innerText,
            EXTRACTION_CONFIG.MIN_TEXT_LENGTH.PRIMARY
        );
    }

    tryEmailInputsStrategy(sidebar) {
        const selector = 
            'textarea[placeholder*="email" i], textarea[id*="email" i], textarea[name*="email" i], ' +
            'textarea[aria-label*="email" i], textarea[class*="email" i], ' +
            'div[contenteditable="true"][role="textbox"], .emailComposer textarea, ' +
            '[data-aura-class*="email"] textarea';
        return this.extractTextFromElements(
            selector,
            (el) => el.value || el.textContent || el.innerText,
            EXTRACTION_CONFIG.MIN_TEXT_LENGTH.PRIMARY
        );
    }

    tryLightningComponentStrategy(sidebar) {
        const selector =
            '[data-aura-class*="forceEmailComposer"] textarea, [class*="forceEmailComposer"] textarea, ' +
            '[data-target-selection-name*="Email"] textarea, ' +
            'lightning-textarea[data-name*="email" i] textarea, ' +
            'lightning-input-rich-text[data-name*="email" i] textarea, ' +
            '[data-name="HtmlBody"] textarea, [data-name="TextBody"] textarea, ' +
            'textarea[name*="HtmlBody"], textarea[name*="TextBody"], ' +
            '.forceEmailComposer textarea, .emailComposer textarea';
        return this.extractTextFromElements(
            selector,
            (el) => el.value || el.textContent,
            EXTRACTION_CONFIG.MIN_TEXT_LENGTH.PRIMARY
        );
    }

    tryGenericFallbackStrategy(sidebar) {
        // Try contenteditable elements first
        const contentEditables = document.querySelectorAll('[contenteditable="true"]');
        for (const element of contentEditables) {
            if (isElementInSidebar(sidebar, element)) continue;
            if (!isElementVisible(element)) continue;
            if (element.closest('[role="toolbar"], .cke_top, .slds-rich-text-editor__toolbar, .ql-toolbar')) continue;
            if (element.classList.contains('cke_top') || element.classList.contains('toolbar')) continue;

            const isToolbarText = this.createToolbarValidator();
            const text = element.innerText?.trim();
            if (text && text.length >= EXTRACTION_CONFIG.MIN_TEXT_LENGTH.FALLBACK && !isToolbarText(text)) {
                return text;
            }
        }

        // Then try all visible textareas
        const allTextareas = document.querySelectorAll('textarea:not([readonly])');
        for (const textarea of allTextareas) {
            if (isElementInSidebar(sidebar, textarea)) continue;
            if (!isElementVisible(textarea)) continue;
            
            const isToolbarText = this.createToolbarValidator();
            const text = textarea.value?.trim();
            if (text && text.length >= EXTRACTION_CONFIG.MIN_TEXT_LENGTH.FALLBACK && !isToolbarText(text)) {
                return text;
            }
        }

        return null;
    }

    async requestEmailContentFromIframes(timeout = 2000) {
        // Generate unique nonce for THIS REQUEST (not cached)
        const nonce = generateMessageNonce();
        const fallbackOrigin = window.location?.origin && window.location.origin !== 'null'
            ? window.location.origin
            : null;

        return new Promise((resolve) => {
            const requestId = `email-request-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            let resolved = false;
            let messageTimeout = null;

            // Define cleanup function (called on both success and timeout)
            const cleanup = () => {
                if (messageTimeout) clearTimeout(messageTimeout);
                window.removeEventListener('message', handleResponse);
            };

            // Set up listener for response
            const handleResponse = (event) => {
                if (resolved) return;
                try {
                    // Use centralized origin validation (single source of truth)
                    if (!isTrustedOrigin(event.origin, fallbackOrigin)) {
                        logger.warn('Rejected message from untrusted origin', 'email-extractor', { origin: event.origin });
                        return;
                    }

                    if (event.data?.action === 'emailContentResponse' &&
                        event.data?.requestId === requestId &&
                        event.data?.nonce === nonce) {
                        resolved = true;
                        cleanup();
                        resolve(event.data.text || null);
                    }
                } catch (error) {
                    logger.debug('Error processing iframe message response', 'email-extractor', error?.message);
                }
            };

            window.addEventListener('message', handleResponse);

            // Find all potential email iframes
            const emailIframes = querySelectorAllDeep(
                'iframe.cke_wysiwyg_frame, ' +
                'iframe[class*="cke"], ' +
                '.cke_contents iframe, ' +
                'iframe[title*="Email"], ' +
                'iframe[title*="Rich Text"], ' +
                'iframe[name*="vfFrameId"]'
            );

            // Send request to all iframes
            for (const iframe of emailIframes) {
                try {
                    if (iframe.contentWindow) {
                        const frameOriginRes = getFrameOrigin(iframe, fallbackOrigin);
                        const frameOrigin = frameOriginRes.ok ? frameOriginRes.value : null;
                        if (!isTrustedOrigin(frameOrigin, fallbackOrigin)) continue;
                        const targetOrigin = frameOrigin && frameOrigin !== 'null' ? frameOrigin : fallbackOrigin;
                        if (targetOrigin) {
                            iframe.contentWindow.postMessage({
                                action: 'requestEmailContent',
                                requestId: requestId,
                                nonce
                            }, targetOrigin);
                        }
                    }
                } catch (error) {
                    logger.debug('Failed to post message to iframe', 'email-extractor', { error: error?.message });
                }
            }

            // Also try nested iframes (VF frames)
            const vfIframes = querySelectorAllDeep('iframe[name*="vfFrameId"], iframe[id*="vfFrameId"]');
            for (const vfFrame of vfIframes) {
                try {
                    if (vfFrame.contentWindow) {
                        const frameOriginRes = getFrameOrigin(vfFrame, fallbackOrigin);
                        const frameOrigin = frameOriginRes.ok ? frameOriginRes.value : null;
                        if (!isTrustedOrigin(frameOrigin, fallbackOrigin)) continue;
                        const targetOrigin = frameOrigin && frameOrigin !== 'null' ? frameOrigin : fallbackOrigin;
                        if (targetOrigin) {
                            vfFrame.contentWindow.postMessage({
                                action: 'requestEmailContent',
                                requestId: requestId,
                                broadcast: true,
                                nonce
                            }, targetOrigin);
                        }
                    }
                } catch (e) {
                    // Attempt to post message to iframe failed; expected if iframe is cross-origin or unreachable
                    logger.debug('Failed to post message to iframe', 'email-extractor', e?.message);
                }
            }

            // Timeout - ensure cleanup is called
            messageTimeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(null);
                }
            }, timeout);
        });
    }
}
