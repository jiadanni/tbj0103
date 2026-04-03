// modules/sidebar/state/storage.js

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('StorageUtils');
//
// Helpers for persisting sidebar UI preferences.

export async function applySidebarWidth(sidebarInstance) {
  try {
    const result = await chrome.storage.local.get(['sidebarWidth']);
    const width = result.sidebarWidth || 500;
    const target = sidebarInstance?.sidebarHost || document.documentElement;
    target.style.setProperty('--sidebar-width', `${width}px`);
    if (sidebarInstance?.vlog) {
      sidebarInstance.vlog('[Sidebar] Applied width:', width);
    }
  } catch (error) {
    const target = sidebarInstance?.sidebarHost || document.documentElement;
    target.style.setProperty('--sidebar-width', '500px');
  }
}

export function saveCollapseStateEntry(_sidebarInstance, controlId, isCollapsed) {
  try {
    const key = 'sidebarCollapseState';
    chrome.storage.local.get([key], (result) => {
      const state = result[key] || {};
      state[controlId] = !!isCollapsed;
      const put = {};
      put[key] = state;
      chrome.storage.local.set(put, () => { });
    });
  } catch (e) {
    logger.error('Error saving collapse state:', 'storage-utils', e);
  }
}

export function restoreCollapseState(sidebarInstance) {
  const sidebar = sidebarInstance?.sidebar;
  if (!sidebar) return;
  try {
    const key = 'sidebarCollapseState';
    chrome.storage.local.get([key], (result) => {
      const state = result[key] || {};
      const sections = sidebar.querySelectorAll('.related-section');
      sections.forEach(section => {
        const list = section.querySelector('.items-list');
        if (!list) return;
        const id = list.id;
        const shouldCollapse = !!state[id];
        const toggleBtn = section.querySelector('.section-toggle');
        if (shouldCollapse) {
          section.classList.add('collapsed');
          if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.textContent = '▸';
          }
        } else {
          section.classList.remove('collapsed');
          if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.textContent = '▾';
          }
        }
      });
    });
  } catch (e) {
    logger.error('Error restoring collapse state:', 'storage-utils', e);
  }
}
