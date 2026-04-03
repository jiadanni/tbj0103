// modules/sidebar/visibility-manager.js
//
// Handles the show/hide animation and lifecycle transitions of the sidebar.

import { createLogger } from '../utils/logger.js';

const logger = createLogger('Visibility-Manager');

/**
 * Toggles the sidebar visibility with animations and state management.
 */
export async function toggle(sidebarInstance, show = !sidebarInstance.isVisible) {
    if (sidebarInstance.toggleInProgress) {
        logger.vlog('[Sidebar] toggle ignored because another toggle is in progress');
        return;
    }
    sidebarInstance.toggleInProgress = true;

    try {
        await sidebarInstance.ensureInitialized();

        // Prevent multiple simultaneous opens
        if (show && (sidebarInstance.isVisible || sidebarInstance.isOpening)) {
            return;
        }

        // Prevent multiple simultaneous closes
        if (!show && !sidebarInstance.isVisible) {
            return;
        }

        if (!sidebarInstance.sidebar) return;

        // Guard: ignore programmatic close requests within a short grace period after opening
        if (!show && sidebarInstance.suppressImmediateCloseUntil && Date.now() < sidebarInstance.suppressImmediateCloseUntil) {
            return;
        }

        // Guard: ignore close requests that occur immediately after a single-page-app location change
        try {
            const lastNav = window._pandaid_last_location_change || 0;
            if (!show && lastNav && (Date.now() - lastNav) < 1000) {
                return;
            }
        } catch (e) {
            logger.debug('Error checking last location change', 'visibility-manager', e);
        }

        if (show) {
            // Set opening flag when showing
            sidebarInstance.isOpening = true;
            // Set a short grace period to ignore stray close calls immediately after opening
            sidebarInstance.suppressImmediateCloseUntil = Date.now() + 500; // ms

            const host = sidebarInstance.sidebarHost;
            if (!host) return;

            // Make sure the host is in the DOM and visible
            if (!document.body.contains(host)) {
                document.body.appendChild(host);
            }

            // Always set display to flex before adding the visible class
            host.style.display = 'flex';

            // Force reflow
            void host.offsetWidth;

            // Add the visible class to trigger the slide-in animation
            host.classList.add('visible');

            // Update visibility state
            sidebarInstance.isVisible = true;

            // Load preload settings
            sidebarInstance.loadPreloadSettings().catch(err => {
                logger.error('Error loading preload settings on sidebar open:', 'sidebar', err);
            });

            // Attempt to (re)load case details
            try {
                sidebarInstance.loadCaseDetailsEnhanced();
            } catch (err) {
                logger.warn('Error triggering case details load on open:', 'sidebar', err);
            }

            // Clear opening flag after animation
            setTimeout(() => {
                sidebarInstance.isOpening = false;
                if (typeof sidebarInstance.notifyButtonVisibilityChange === 'function') {
                    sidebarInstance.notifyButtonVisibilityChange();
                }
            }, 300);

            // Focus close button (inside shadow)
            const closeBtn = sidebarInstance.sidebar ? sidebarInstance.sidebar.querySelector('#ai-sidebar-close-btn') : null;
            if (closeBtn) closeBtn.focus();

        } else {
            // Update visibility state immediately
            sidebarInstance.isVisible = false;

            const host = sidebarInstance.sidebarHost;
            if (!host) return;

            // Slide-out animation
            host.classList.remove('visible');

            // Reset state when closing
            sidebarInstance.resetToInitialState().catch(err => {
                logger.error('Error resetting sidebar state:', 'sidebar', err);
            });

            if (typeof sidebarInstance.notifyButtonVisibilityChange === 'function') {
                sidebarInstance.notifyButtonVisibilityChange();
            }

            const hideTimeout = setTimeout(() => {
                if (host) host.style.display = 'none';
            }, 300);

            const handleTransitionEnd = () => {
                clearTimeout(hideTimeout);
                if (host) host.style.display = 'none';
                host.removeEventListener('transitionend', handleTransitionEnd);
            };

            host.addEventListener('transitionend', handleTransitionEnd, { once: true });
        }
    } catch (error) {
        logger.error('[Sidebar] toggle failed:', 'sidebar', error);
    } finally {
        sidebarInstance.toggleInProgress = false;
    }
}
