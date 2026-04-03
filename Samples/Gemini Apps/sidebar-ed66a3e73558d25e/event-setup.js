// modules/sidebar/event-setup.js
//
// Event listener wiring for the sidebar UI.

import { createLogger } from '../utils/logger.js';

const logger = createLogger('SidebarEventSetup');

export function setupEventListeners(sidebarInstance) {
  const sidebar = sidebarInstance?.sidebar;
  if (!sidebar) return;

  // Close button
  const closeBtn = sidebar.querySelector('#ai-sidebar-close-btn');
  if (closeBtn) {
    sidebarInstance.boundHandlers.closeBtn = () => sidebarInstance.toggle(false);
    closeBtn.addEventListener('click', sidebarInstance.boundHandlers.closeBtn);
    sidebarInstance.eventHandlers.closeBtn = { element: closeBtn, type: 'click', handler: sidebarInstance.boundHandlers.closeBtn };
  }

  const spellcheckBtn = sidebar.querySelector('#spellcheck-btn');
  if (spellcheckBtn) {
    sidebarInstance.boundHandlers.spellcheckBtn = () => {
      sidebarInstance.showImprovedSection();
      sidebarInstance.handleSpellcheck();
    };
    spellcheckBtn.addEventListener('click', sidebarInstance.boundHandlers.spellcheckBtn);
    sidebarInstance.eventHandlers.spellcheckBtn = { element: spellcheckBtn, type: 'click', handler: sidebarInstance.boundHandlers.spellcheckBtn };
  }

  const suggestBtn = sidebar.querySelector('#suggest-solution-btn');
  if (suggestBtn) {
    sidebarInstance.boundHandlers.suggestBtn = () => {
      sidebarInstance.showImprovedSection();
      sidebarInstance.handleSuggestSolution();
    };
    suggestBtn.addEventListener('click', sidebarInstance.boundHandlers.suggestBtn);
    sidebarInstance.eventHandlers.suggestBtn = { element: suggestBtn, type: 'click', handler: sidebarInstance.boundHandlers.suggestBtn };
  }

  const improveBtn = sidebar.querySelector('#improve-solution-btn');
  if (improveBtn) {
    sidebarInstance.boundHandlers.improveBtn = () => {
      sidebarInstance.showImprovedSection();
      sidebarInstance.handleImproveSolution();
    };
    improveBtn.addEventListener('click', sidebarInstance.boundHandlers.improveBtn);
    sidebarInstance.eventHandlers.improveBtn = { element: improveBtn, type: 'click', handler: sidebarInstance.boundHandlers.improveBtn };
  }

  const importBtn = sidebar.querySelector('#import-text-btn');
  if (importBtn) {
    sidebarInstance.boundHandlers.importBtn = async () => {
      try {
        // Disable button and show loading state
        importBtn.disabled = true;
        const originalText = importBtn.textContent;
        importBtn.textContent = 'Importing...';

        // Add timeout to prevent indefinite hangs (5 second max)
        const importPromise = sidebarInstance.handleImportText();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Import timed out')), 5000)
        );

        await Promise.race([importPromise, timeoutPromise]);

        // Re-enable button
        importBtn.disabled = false;
        importBtn.textContent = originalText;
      } catch (error) {
        logger.error('[Sidebar] Error in import text handler:', 'event-setup', error);
        // Re-enable button on error
        importBtn.disabled = false;
        importBtn.textContent = 'Import Text';

        if (sidebarInstance.showError) {
          sidebarInstance.showError('Failed to import text. Please try again.');
        }
      }
    };
    importBtn.addEventListener('click', sidebarInstance.boundHandlers.importBtn);
    sidebarInstance.eventHandlers.importBtn = { element: importBtn, type: 'click', handler: sidebarInstance.boundHandlers.importBtn };
  }

  const copyBtn = sidebar.querySelector('#copy-improved-text-btn');
  if (copyBtn) {
    sidebarInstance.boundHandlers.copyBtn = () => sidebarInstance.handleCopyImprovedText();
    copyBtn.addEventListener('click', sidebarInstance.boundHandlers.copyBtn);
    sidebarInstance.eventHandlers.copyBtn = { element: copyBtn, type: 'click', handler: sidebarInstance.boundHandlers.copyBtn };
  }

  sidebarInstance.boundHandlers.escapeKey = (e) => {
    try {
      const keyIsEscape = e && e.key === 'Escape';
      const trusted = e && typeof e.isTrusted === 'boolean' ? e.isTrusted : true;
      const focusedInside = document.activeElement &&
        (document.activeElement === sidebarInstance.sidebarHost ||
          sidebarInstance.sidebarHost?.contains(document.activeElement) ||
          (sidebarInstance.shadowRoot && sidebarInstance.shadowRoot.activeElement !== null));
      if (keyIsEscape && sidebarInstance.isVisible && trusted && focusedInside) {
        sidebarInstance.vlog('[Sidebar] Escape key accepted for close (trusted & focused inside)');
        sidebarInstance.toggle(false);
      } else if (keyIsEscape && sidebarInstance.isVisible) {
        sidebarInstance.vlog('[Sidebar] Escape key ignored (trusted:', trusted, ', focusedInside:', !!focusedInside, ')');
      }
    } catch (err) {
      logger.debug('[Sidebar] Error in escape handler, ignoring close:', 'event-setup', err);
      sidebarInstance.vlog('[Sidebar] Error in escape handler, ignoring close:', err);
    }
  };
  document.addEventListener('keydown', sidebarInstance.boundHandlers.escapeKey);
  sidebarInstance.eventHandlers.escapeKey = { element: document, type: 'keydown', handler: sidebarInstance.boundHandlers.escapeKey };

  sidebarInstance.loadPreloadSettings();
  sidebarInstance.restoreCollapseState();

  const toggles = sidebar.querySelectorAll('.section-toggle');
  toggles.forEach(btn => {
    const handler = () => {
      const controlId = btn.getAttribute('aria-controls');
      const section = btn.closest('.related-section');
      if (!section) return;
      const isCollapsed = section.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', (!isCollapsed).toString());
      btn.textContent = isCollapsed ? '▸' : '▾';
      sidebarInstance.saveCollapseStateEntry(controlId, isCollapsed);
    };
    btn.addEventListener('click', handler);
    sidebarInstance.eventHandlers[`toggle_${btn.getAttribute('aria-controls')}`] = { element: btn, type: 'click', handler };
  });

  if (sidebarInstance.isVisible) {
    sidebarInstance.loadCaseDetailsEnhanced();
  }

  sidebarInstance.ensureRefreshButtonWired();

  sidebarInstance.resizeObserver = new ResizeObserver(sidebarInstance.handleResize.bind(sidebarInstance));
  sidebarInstance.resizeObserver.observe(sidebar);

  sidebarInstance.boundHandlers.tooltipDelegation = (e) => {
    try {
      const evType = e.type;
      const hint = e.target.closest && e.target.closest('.ai-hint');
      if (!hint) return;
      if (evType === 'mouseover' || evType === 'focusin') {
        sidebarInstance.showTooltipForHint(hint);
      } else if (evType === 'mouseout' || evType === 'focusout') {
        sidebarInstance.hideTooltipForHint(hint);
      }
    } catch (err) {
      logger.debug('[Sidebar] Tooltip delegation error:', 'event-setup', err);
    }
  };

  sidebar.addEventListener('mouseover', sidebarInstance.boundHandlers.tooltipDelegation);
  sidebar.addEventListener('mouseout', sidebarInstance.boundHandlers.tooltipDelegation);
  sidebar.addEventListener('focusin', sidebarInstance.boundHandlers.tooltipDelegation);
  sidebar.addEventListener('focusout', sidebarInstance.boundHandlers.tooltipDelegation);
  sidebarInstance.eventHandlers.tooltipDelegation = { element: sidebar, type: 'mouseover/mouseout/focusin/focusout', handler: sidebarInstance.boundHandlers.tooltipDelegation };
}
