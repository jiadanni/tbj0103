// UI helper functions for the sidebar (exported as functions that accept `self`)

import { createLogger } from '../../utils/logger.js';
import { getFrameOrigin, getMessageNonce, isTrustedOrigin } from '../../utils/message-auth.js';

const logger = createLogger('UiComponents');

export function getProductIconHTML(self, productName) {
  // Defer to utils if present
  if (self.utils && typeof self.utils.getProductIconHTML === 'function') {
    try { return self.utils.getProductIconHTML(productName); } catch (e) { /* fallthrough */ }
  }

  if (!productName) return '';
  const productLower = (productName || '').toLowerCase();
  if (productLower === 'impact' || productLower.includes('impact')) {
    return `<img src="${chrome.runtime.getURL('icons/impact.svg')}" alt="Impact" class="product-icon" />`;
  }
  return '';
}

export function showImprovedSection(self) {
  try {
    const improvedSection = self.sidebar.querySelector('#improved-section');
    if (improvedSection && improvedSection.classList.contains('hidden')) {
      improvedSection.classList.remove('hidden');
    }
  } catch (e) {
    logger.debug('showImprovedSection error', 'ui-components', e);
  }
}

export function adjustButtonLabels(self) {
  try {
    const buttons = self.sidebar.querySelectorAll('.action-button');
    const sidebarWidth = self.sidebar.offsetWidth;
    buttons.forEach(button => {
      const buttonText = button.querySelector('.button-text');
      const originalText = button.dataset.originalText;
      const shortText = button.dataset.shortText;
      if (sidebarWidth < 380 && shortText) {
        buttonText.textContent = shortText;
      } else if (buttonText) {
        buttonText.textContent = originalText;
      }
    });
  } catch (e) {
    logger.debug('adjustButtonLabels error', 'ui-components', e);
  }
}

export function renderFetchButton(self, type, isConfigured) {
  if (typeof self.isSectionEnabled === 'function' && !self.isSectionEnabled(type)) return;

  const cfg = self.sourceConfig.get(type);
  if (!cfg) return;

  const list = self.sidebar.querySelector(cfg.listSelector);
  const buttonId = `fetch-${type}-btn`;
  const buttonText = isConfigured ? `${cfg.displayName.replace(/ articles| tickets$/i, '')} Preload disabled - Click to fetch` :
    `Configure ${cfg.displayName.replace(/ tickets| articles$/i, '')}`;

  if (!list) return;

  list.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'prefetch-disabled';

  const button = document.createElement('button');
  button.className = `fetch-button ${!isConfigured ? 'disabled' : ''}`.trim();
  button.id = buttonId;
  if (!isConfigured) button.disabled = true;
  const span = document.createElement('span');
  span.textContent = buttonText;
  button.appendChild(span);
  wrapper.appendChild(button);

  if (!isConfigured) {
    const notice = document.createElement('div');
    notice.className = 'prefetch-notice';
    notice.textContent = 'Configure in Options to enable';
    wrapper.appendChild(notice);
  }

  list.appendChild(wrapper);

  if (button) {
    self.boundHandlers[buttonId] = () => {
      if (isConfigured) {
        try {
          cfg.preload(true);
        } catch (err) {
          self.fetchRelatedItems(type);
        }
      } else {
        try {
          self.sendMessageWithTimeout({ action: 'openOptionsPage' }, 5000).catch(() => { });
        } catch (e) {
          logger.debug('sendMessageWithTimeout fallback error', 'ui-components', e);
          try { chrome.runtime.sendMessage({ action: 'openOptionsPage' }); } catch (_) { /* messaging failed - options page may not open */ }
        }
      }
    };
    button.addEventListener('click', self.boundHandlers[buttonId]);
    self.eventHandlers[buttonId] = { element: button, type: 'click', handler: self.boundHandlers[buttonId] };
  }
}

export async function handleCopyImprovedText(self) {
  const improvedInput = self.sidebar.querySelector('#improved-text-input');
  const copyBtn = self.sidebar.querySelector('#copy-improved-text-btn');
  if (!improvedInput || !copyBtn) return;

  const textToCopy = improvedInput.value.trim();
  if (!textToCopy) {
    copyBtn.style.color = '#ff6b6b';
    copyBtn.title = 'No text to copy';
    setTimeout(() => { copyBtn.style.color = ''; copyBtn.title = 'Copy to clipboard'; }, 1000);
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    copyBtn.classList.add('copied');
    copyBtn.title = 'Copied!';
    const originalIcon = copyBtn.querySelector('svg')?.cloneNode(true);
    copyBtn.replaceChildren(createCheckIcon());
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.title = 'Copy to clipboard';
      if (originalIcon) {
        copyBtn.replaceChildren(originalIcon);
      }
    }, 2000);
  } catch (error) {
    logger.error('Failed to copy text to clipboard:', 'ui-components', error);
    copyBtn.style.color = '#ff6b6b';
    copyBtn.title = 'Copy failed - try selecting and copying manually';
    setTimeout(() => { copyBtn.style.color = ''; copyBtn.title = 'Copy to clipboard'; }, 3000);
  }
}

export function showError(self, message) {
  try {
    const improvedInput = self.sidebar.querySelector('#improved-text-input');
    if (improvedInput) improvedInput.value = `Error: ${message}`;
    if (typeof self.toggle === 'function') self.toggle(true);
  } catch (e) {
    logger.warn('showError failed:', 'ui-components', e);
  }
}

export function notifyButtonVisibilityChange(self) {
  try {
    const event = new CustomEvent('sidebarToggle', { detail: { isVisible: self.isVisible } });
    self.vlog && self.vlog('[Sidebar] dispatching sidebarToggle event:', { isVisible: self.isVisible });
    window.dispatchEvent(event);
    try {
      const emailIframes = document.querySelectorAll('iframe.cke_wysiwyg_frame, iframe[title*="Email"]');
      if (!emailIframes.length) return;

      getMessageNonce()
        .then((nonce) => {
          const fallbackOrigin = window.location?.origin && window.location.origin !== 'null'
            ? window.location.origin
            : null;

          emailIframes.forEach(iframe => {
            try {
              if (!iframe.contentWindow) return;
              const frameOriginRes = getFrameOrigin(iframe, fallbackOrigin);
              const frameOrigin = frameOriginRes.ok ? frameOriginRes.value : null;
              if (!isTrustedOrigin(frameOrigin, fallbackOrigin)) return;
              const targetOrigin = frameOrigin && frameOrigin !== 'null' ? frameOrigin : fallbackOrigin;
              if (!targetOrigin) return;
              iframe.contentWindow.postMessage({ action: 'sidebarStateChange', isOpen: self.isVisible, nonce }, targetOrigin);
            } catch (err) { logger.debug('iframe postMessage error (cross-origin)', 'ui-components', err); }
          });
          self.vlog && self.vlog('[Sidebar] posted sidebarStateChange to iframes:', { isOpen: self.isVisible });
        })
        .catch((err) => {
          logger.warn('Failed to fetch message nonce for iframe notification', 'ui-components', err);
        });
    } catch (err) {
      logger.warn('Error notifying iframe buttons:', 'ui-components', err);
    }
  } catch (e) {
    logger.debug('notifyButtonVisibilityChange error', 'ui-components', e);
  }
}

function createCheckIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '20,6 9,17 4,12');
  svg.appendChild(polyline);

  return svg;
}
