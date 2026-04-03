/**
 * Base interface for text extraction strategies.
 */
export class InputStrategy {
    /**
     * Check if this strategy applies to the current context or specific element
     * @param {Object} [context] - Contextual information (e.g., sidebar instance, event)
     * @returns {Promise<boolean>|boolean} True if applicable
     */
    canHandle(_context) {
        return false;
    }

    /**
     * Extract text using this strategy
     * @param {Object} [context] - Contextual information
     * @returns {Promise<string|null>|string|null} Extracted text or null
     */
    execute(_context) {
        return null;
    }
}
