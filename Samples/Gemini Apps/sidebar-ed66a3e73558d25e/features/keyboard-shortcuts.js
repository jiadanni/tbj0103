/**
 * Keyboard Shortcuts Module
 * Handles keyboard shortcuts for the PandAid sidebar
 */

/**
 * Initialize keyboard shortcuts for the sidebar
 * @param {Object} sidebar - The sidebar instance with method references
 */
export function initializeKeyboardShortcuts(sidebar) {
  document.addEventListener('keydown', (e) => {
    // Only trigger if sidebar is visible and focus is appropriate
    if (!sidebar.isVisible) return;

    // Check for Ctrl/Cmd + Shift combinations
    const modifier = e.ctrlKey || e.metaKey;

    if (modifier && e.shiftKey) {
      switch(e.key.toLowerCase()) {
        case 's': // Suggest Solution
          e.preventDefault();
          const suggestBtn = sidebar.sidebar?.querySelector('#suggest-solution-btn');
          if (suggestBtn && !suggestBtn.disabled) {
            suggestBtn.click();
            showShortcutFeedback(sidebar, 'Suggesting solution...');
          }
          break;

        case 'i': // Improve Solution
          e.preventDefault();
          const improveBtn = sidebar.sidebar?.querySelector('#improve-solution-btn');
          if (improveBtn && !improveBtn.disabled) {
            improveBtn.click();
            showShortcutFeedback(sidebar, 'Improving solution...');
          }
          break;

        case 'k': // Spellcheck
          e.preventDefault();
          const spellcheckBtn = sidebar.sidebar?.querySelector('#spellcheck-btn');
          if (spellcheckBtn && !spellcheckBtn.disabled) {
            spellcheckBtn.click();
            showShortcutFeedback(sidebar, 'Checking spelling...');
          }
          break;

        case 'c': // Copy to Clipboard
          e.preventDefault();
          const copyBtn = sidebar.sidebar?.querySelector('#copy-improved-text-btn');
          if (copyBtn && !copyBtn.disabled) {
            copyBtn.click();
            showShortcutFeedback(sidebar, 'Copied to clipboard!');
          }
          break;

        case 'r': // Refresh All Data
          e.preventDefault();
          const refreshBtn = sidebar.sidebar?.querySelector('#refresh-case-details-btn');
          if (refreshBtn && !refreshBtn.disabled) {
            refreshBtn.click();
            showShortcutFeedback(sidebar, 'Refreshing data...');
          }
          break;
      }
    }
  });
}

/**
 * Show visual feedback when a keyboard shortcut is used
 * @param {Object} sidebar - The sidebar instance
 * @param {string} message - Feedback message to display
 */
function showShortcutFeedback(sidebar, message) {
  // Create or get feedback element
  let feedback = sidebar.sidebar?.querySelector('#shortcut-feedback');

  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'shortcut-feedback';
    feedback.className = 'shortcut-feedback';
    sidebar.sidebar?.appendChild(feedback);
  }

  feedback.textContent = message;
  feedback.classList.add('show');

  // Hide after 2 seconds
  setTimeout(() => {
    feedback.classList.remove('show');
  }, 2000);
}

/**
 * Get keyboard shortcut help text
 * @returns {string} HTML string with shortcut documentation
 */
export function getShortcutHelpHTML() {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifier = isMac ? '⌘' : 'Ctrl';

  return `
    <div class="shortcuts-help">
      <h4>Keyboard Shortcuts</h4>
      <ul>
        <li><kbd>${modifier}</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> → Suggest Solution</li>
        <li><kbd>${modifier}</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> → Improve Solution</li>
        <li><kbd>${modifier}</kbd> + <kbd>Shift</kbd> + <kbd>K</kbd> → Spellcheck</li>
        <li><kbd>${modifier}</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> → Copy to Clipboard</li>
        <li><kbd>${modifier}</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> → Refresh Data</li>
        <li><kbd>Esc</kbd> → Close Sidebar</li>
      </ul>
    </div>
  `;
}
