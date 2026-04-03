/**
 * Auto-Save Module
 * Automatically saves draft solution text to prevent data loss
 */

import { AUTO_SAVE_INTERVAL_MS, AUTO_SAVE_RECENT_THRESHOLD_MS, INPUT_DEBOUNCE_MS } from '../../config/constants.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('AutoSave');

const AUTO_SAVE_INTERVAL = AUTO_SAVE_INTERVAL_MS;
const STORAGE_KEY = 'pandaid_draft_autosave';

let autoSaveTimer = null;
let _currentCaseId = null;
let _currentTextarea = null;
let _boundInputHandler = null;

/**
 * Initialize auto-save functionality
 * @param {HTMLTextAreaElement} textarea - The solution textarea element
 * @param {string} caseId - Current case ID
 */
export function initializeAutoSave(textarea, caseId) {
  if (!textarea) return;

  // STRICT CLEANUP: Always remove existing listener ensuring we never have duplicates
  // This handles cases where initialize is called multiple times (e.g. re-renders)
  if (_currentTextarea && _boundInputHandler) {
    try {
      _currentTextarea.removeEventListener('input', _boundInputHandler);
    } catch (e) {
      // Ignore errors if element is already gone, but log for debugging
      logger.debug('Listener cleanup error', 'initializeAutoSave', e);
    }
  }

  _currentCaseId = caseId;
  _currentTextarea = textarea;

  // Clear any existing timer
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
  }

  // Try to restore previous draft
  restoreDraft(textarea, caseId);

  // Set up auto-save interval
  autoSaveTimer = setInterval(() => {
    saveDraft(textarea, caseId);
  }, AUTO_SAVE_INTERVAL);

  // Define new handler
  let inputTimer;
  _boundInputHandler = () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      saveDraft(textarea, caseId);
    }, INPUT_DEBOUNCE_MS * 4); // Save after user stops typing
  };

  // Attach new listener
  textarea.addEventListener('input', _boundInputHandler);

  logger.info('[Auto-Save] Initialized for case:', 'auto-save', caseId);
}

/**
 * Remove the input event listener to prevent accumulation
 */
function cleanupInputListener() {
  if (_boundInputHandler) {
    if (_currentTextarea) {
      try {
        _currentTextarea.removeEventListener('input', _boundInputHandler);
      } catch (e) {
        // Element might be detached, log for debugging
        logger.debug('Listener cleanup error', 'cleanupInputListener', e);
      }
    }
    _boundInputHandler = null;
    _currentTextarea = null;
  }
}

/**
 * Save current draft to storage
 * @param {HTMLTextAreaElement} textarea - The solution textarea element
 * @param {string} caseId - Current case ID
 */
function saveDraft(textarea, caseId) {
  if (!textarea || !caseId) return;

  const content = textarea.value.trim();

  // Don't save empty drafts
  if (!content) return;

  const draft = {
    caseId: caseId,
    content: content,
    timestamp: Date.now(),
    savedAt: new Date().toISOString()
  };

  chrome.storage.local.set({ [STORAGE_KEY]: draft }, () => {
    logger.debug(`Draft saved at ${new Date().toLocaleTimeString()}`, 'saveDraft');
    showAutoSaveIndicator(textarea);
  });
}

/**
 * Restore previously saved draft
 * @param {HTMLTextAreaElement} textarea - The solution textarea element
 * @param {string} caseId - Current case ID
 */
function restoreDraft(textarea, caseId) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const draft = result[STORAGE_KEY];

    if (!draft || draft.caseId !== caseId) {
      return; // No draft or different case
    }

    // Check if draft is recent (within last 24 hours)
    const age = Date.now() - draft.timestamp;
    const isRecent = age < AUTO_SAVE_RECENT_THRESHOLD_MS;

    if (!isRecent) {
      // Clear old draft
      chrome.storage.local.remove([STORAGE_KEY]);
      return;
    }

    // Don't restore if textarea already has content
    if (textarea.value.trim()) return;

    // Show restore prompt
    const minutes = Math.floor(age / 60000);
    const timeAgo = minutes < 60
      ? `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
      : `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) !== 1 ? 's' : ''} ago`;

    showRestorePrompt(textarea, draft, timeAgo);
  });
}

/**
 * Show prompt to restore draft
 * @param {HTMLTextAreaElement} textarea - The solution textarea element
 * @param {Object} draft - The saved draft object
 * @param {string} timeAgo - Human-readable time since save
 */
function showRestorePrompt(textarea, draft, timeAgo) {
  const container = textarea.parentElement;
  if (!container) return;

  const prompt = document.createElement('div');
  prompt.className = 'restore-draft-prompt';
  const content = document.createElement('div');
  content.className = 'restore-draft-content';

  const icon = document.createElement('span');
  icon.className = 'restore-icon';
  icon.textContent = '💾';

  const text = document.createElement('span');
  text.className = 'restore-text';
  text.textContent = `Draft saved ${timeAgo}. Restore?`;

  const yesBtn = document.createElement('button');
  yesBtn.className = 'restore-yes-btn';
  yesBtn.textContent = 'Yes';

  const noBtn = document.createElement('button');
  noBtn.className = 'restore-no-btn';
  noBtn.textContent = 'Discard';

  content.appendChild(icon);
  content.appendChild(text);
  content.appendChild(yesBtn);
  content.appendChild(noBtn);
  prompt.appendChild(content);

  // Insert before textarea
  container.insertBefore(prompt, textarea);

  // Handle restore
  yesBtn.addEventListener('click', () => {
    textarea.value = draft.content;
    textarea.dispatchEvent(new Event('input'));
    prompt.remove();
    logger.info('[Auto-Save] Draft restored', 'auto-save', undefined);
  });

  // Handle discard
  noBtn.addEventListener('click', () => {
    chrome.storage.local.remove([STORAGE_KEY]);
    prompt.remove();
    logger.info('[Auto-Save] Draft discarded', 'auto-save', undefined);
  });
}

/**
 * Show visual indicator that draft was auto-saved
 * @param {HTMLTextAreaElement} textarea - The solution textarea element
 */
function showAutoSaveIndicator(textarea) {
  const container = textarea.parentElement;
  if (!container) return;

  let indicator = container.querySelector('.auto-save-indicator');

  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'auto-save-indicator';
    container.appendChild(indicator);
  }

  indicator.textContent = '✓ Draft saved';
  indicator.classList.add('show');

  setTimeout(() => {
    indicator.classList.remove('show');
  }, 2000);
}

/**
 * Clear auto-save timer, event listeners, and saved draft
 */
export function clearAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }

  // Clean up input listener to prevent memory leaks
  cleanupInputListener();

  try {
    // Check if context is valid before accessing storage
    if (chrome?.runtime?.id) {
      chrome.storage.local.remove([STORAGE_KEY]);
    }
  } catch (e) {
    // Ignore context invalidation errors during cleanup, log for debugging
    logger.debug('Storage cleanup error', 'clearAutoSave', e);
  }
  logger.info('[Auto-Save] Cleared', 'auto-save', undefined);
}

/**
 * Manually trigger a save
 * @param {HTMLTextAreaElement} textarea - The solution textarea element
 * @param {string} caseId - Current case ID
 */
export function manualSave(textarea, caseId) {
  saveDraft(textarea, caseId);
}

/**
 * Clean up stale auto-save data that exceeds the retention threshold.
 * Called during extension startup or periodically to prevent indefinite storage.
 * @returns {Promise<boolean>} Whether any cleanup was performed
 */
export async function cleanupStaleAutoSave() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const draft = result[STORAGE_KEY];

    if (!draft || !draft.timestamp) {
      return false;
    }

    const age = Date.now() - draft.timestamp;
    if (age > AUTO_SAVE_RECENT_THRESHOLD_MS) {
      await chrome.storage.local.remove([STORAGE_KEY]);
      logger.info(`[Auto-Save] Cleaned up stale draft (age: ${Math.floor(age / 3600000)} hours)`, 'auto-save', undefined);
      return true;
    }

    return false;
  } catch (error) {
    logger.warn('[Auto-Save] Cleanup error:', 'auto-save', error);
    return false;
  }
}
