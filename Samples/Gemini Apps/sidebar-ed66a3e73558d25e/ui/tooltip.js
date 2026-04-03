import { createLogger } from '../../utils/logger.js';
const logger = createLogger('TooltipUI');

export function showTooltipForHint(sidebarInstance, hint) {
  if (!hint) return;
  const tipInner = hint.querySelector('.ai-tooltip-text');
  if (!tipInner) return;
  const sidebar = sidebarInstance?.sidebar;

  try {
    let global = document.getElementById('sf-global-tooltip');
    if (!global) {
      global = document.createElement('div');
      global.id = 'sf-global-tooltip';
      document.body.appendChild(global);
    }

    const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : { width: window.innerWidth, left: 0 };
    const hintRect = hint.getBoundingClientRect();

    const inset = 12; // px
    const width = Math.max(240, Math.min(sidebarRect.width - inset * 2, window.innerWidth - 40));
    const left = Math.max(8, Math.round(sidebarRect.left + inset));

    global.textContent = tipInner.textContent || tipInner.innerText || '';
    global.style.width = `${width}px`;
    global.style.display = 'block';
    global.style.visibility = 'hidden';

    const tooltipHeight = global.offsetHeight;
    const spaceBelow = window.innerHeight - hintRect.bottom;
    const spaceAbove = hintRect.top;
    const offset = 8;

    let top;
    if (spaceBelow < tooltipHeight && spaceAbove > spaceBelow) {
      top = Math.round(hintRect.top - tooltipHeight - offset);
    } else {
      top = Math.round(hintRect.bottom + offset);
    }

    global.style.left = `${left}px`;
    global.style.top = `${top}px`;
    global.style.visibility = 'visible';
  } catch (err) {
    logger.debug('Error showing hint tooltip', 'tooltip', err);
    const tip = tipInner;
    tip.style.display = 'block';
  }
}

export function hideTooltipForHint(_sidebarInstance, hint) {
  try {
    const global = document.getElementById('sf-global-tooltip');
    if (global) global.style.display = 'none';
  } catch (e) {
    logger.debug('Error hiding hint tooltip', 'tooltip', e);
    const tip = hint && hint.querySelector ? hint.querySelector('.ai-tooltip-text') : null;
    if (tip) tip.style.display = 'none';
  }
}
