// modules/sidebar/ui/results.js
//
// Rendering helpers for related results and community sources.

import { createLogger } from '../../utils/logger.js';
const logger = createLogger('ResultsUI');

export function renderResultList(sidebarInstance, type, items = []) {
  if (typeof sidebarInstance?.isSectionEnabled === 'function' && !sidebarInstance.isSectionEnabled(type)) return;

  if (type === 'community') {
    return displaySources(sidebarInstance, items);
  }

  const cfg = sidebarInstance?.sourceConfig?.get(type);
  const sidebar = sidebarInstance?.sidebar;
  if (!cfg || !sidebar) return;
  const list = sidebar.querySelector(cfg.listSelector);
  if (!list) return;

  if (!items || items.length === 0) {
    renderMessage(list, 'empty', 'No results found.');
    setSectionEnhanced(sidebarInstance, type, false);
    return;
  }

  list.replaceChildren();
  let hasAiData = false;
  let hasFallbackAi = false;
  items.forEach(item => {
    const isConfluence = type === 'confluence';
    const isFallback = !!item.aiFallback;
    if (isFallback) hasFallbackAi = true;

    const container = document.createElement('div');
    container.className = 'result-item';

    const normalizedTitle = (item.title || item.summary || item.key || 'Untitled').replace(/^\?+/, '').trim();
    const link = document.createElement('a');
    link.href = item.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('title', normalizedTitle);

    const topRow = document.createElement('div');
    topRow.className = 'item-top-row';

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = normalizedTitle;
    topRow.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    if (item.key) {
      const keyBadge = document.createElement('span');
      keyBadge.className = 'item-key';
      keyBadge.textContent = item.key;
      meta.appendChild(keyBadge);
    }

    if (item.source && !isConfluence) {
      const sourceSpan = document.createElement('span');
      sourceSpan.className = 'item-source';
      sourceSpan.textContent = item.source;
      meta.appendChild(sourceSpan);
    }

    const rawScore = (typeof item.aiRelevanceScore === 'number') ? item.aiRelevanceScore : (typeof item.score === 'number' ? item.score : null);
    const score = isFallback ? null : rawScore;
    if (score !== null) {
      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'ai-score-badge';
      scoreBadge.textContent = `AI ${Math.round(score)}%`;
      meta.appendChild(scoreBadge);
      if (!isFallback) hasAiData = true;
    }

    // Unnecessary tooltip removed as per user request
    const explanationText = isFallback
      ? (item.aiExplanation || item.explanation || '')
      : (item.aiExplanation || item.explanation || '');

    if (explanationText && !isFallback) hasAiData = true;

    if (meta.children.length > 0) {
      topRow.appendChild(meta);
    }

    link.appendChild(topRow);

    let excerptText = item.excerpt || item.summary || '';
    // If we have an AI explanation, use that as the excerpt/body instead of the summary
    if (explanationText) {
      excerptText = explanationText;
    }

    // Sanitize leading question marks
    excerptText = excerptText ? excerptText.replace(/^\?+/, '').trim() : '';

    if (!isConfluence && excerptText && excerptText !== normalizedTitle) {
      const excerpt = document.createElement('div');
      excerpt.className = 'item-excerpt';
      excerpt.textContent = excerptText;
      link.appendChild(excerpt);
    }

    container.appendChild(link);
    list.appendChild(container);
  });
  setSectionEnhanced(sidebarInstance, type, hasAiData && !hasFallbackAi);
}

export function renderErrorState(sidebarInstance, type, message) {
  if (typeof sidebarInstance?.isSectionEnabled === 'function' && !sidebarInstance.isSectionEnabled(type)) return;

  const cfg = sidebarInstance?.sourceConfig?.get(type);
  const sidebar = sidebarInstance?.sidebar;
  if (!cfg || !sidebar) return;
  const list = sidebar.querySelector(cfg.listSelector);
  if (list) {
    const wrapper = document.createElement('div');
    wrapper.className = 'error';
    wrapper.textContent = message;
    list.replaceChildren();
    list.appendChild(wrapper);
  }
}

export async function displaySources(sidebarInstance, sources) {
  if (typeof sidebarInstance?.isSectionEnabled === 'function' && !sidebarInstance.isSectionEnabled('community')) return;

  const sourcesList = document.getElementById('community-list');
  if (!sourcesList) return;
  if (!sources || sources.length === 0) {
    const label = typeof sidebarInstance?.getKnowledgeBaseLabel === 'function'
      ? sidebarInstance.getKnowledgeBaseLabel('sidebar')
      : 'Knowledge Base';

    // Create a helpful empty state
    sourcesList.replaceChildren();

    // Check if we suspect it's because no file is loaded (by checking if any load was attempted)
    // For now, simpler message is better:
    const msgDiv = document.createElement('div');
    msgDiv.className = 'empty-message';
    msgDiv.innerHTML = `No ${label} results found.<br><br>Ensure you have uploaded a knowledge base file in <a href="#" id="open-options-link">Options</a>.`;

    const optionsLink = msgDiv.querySelector('#open-options-link');
    if (optionsLink) {
      optionsLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open(chrome.runtime.getURL('options.html'));
        }
      });
    }

    sourcesList.appendChild(msgDiv);
    return;
  }
  let aiEnabled = true;
  let showExplanation = true;
  let userToggledCommunity = null;
  try {
    const stored = await chrome.storage.local.get(['aiEnhancementSettings', 'aiEnabled']);
    const aiEnhancementSettings = stored.aiEnhancementSettings || {};
    const globalAiEnabled = typeof stored.aiEnabled === 'undefined' ? true : !!stored.aiEnabled;
    userToggledCommunity = aiEnhancementSettings?.userToggled?.community;
    const communityEnabled = (typeof userToggledCommunity === 'boolean')
      ? userToggledCommunity
      : (aiEnhancementSettings?.community !== false);
    aiEnabled = !!globalAiEnabled && communityEnabled;
    showExplanation = aiEnhancementSettings?.showExplanations?.community !== false;
  } catch (e) {
    logger.debug('Error loading AI settings for community display', 'results', e);
  }

  if (sources && sources.length > 0) {
    sourcesList.replaceChildren();
    let anySourceAi = false;
    let hadFallbackAi = false;
    let isAiOnPerSource = aiEnabled;
    let showInlineExplanationPerSource = showExplanation;
    sources.forEach(source => {
      const isFallback = !!source.aiFallback;
      const rawScore = (typeof source.aiRelevanceScore === 'number') ? source.aiRelevanceScore : (typeof source.score === 'number' ? source.score : null);
      const score = isFallback ? null : rawScore;
      const baseExplanation = source.aiExplanation || source.explanation || null;
      const fallbackNotice = 'AI unavailable; showing traditionally ranked articles. These suggestions may be less accurate.';
      const explanation = isFallback
        ? (baseExplanation ? `${fallbackNotice}\n\n${baseExplanation}` : fallbackNotice)
        : baseExplanation;
      const isAiOn = !isFallback && ((typeof source.aiEnabled !== 'undefined') ? !!source.aiEnabled : isAiOnPerSource);
      const showInlineExplanation = isAiOn && showInlineExplanationPerSource;
      if (isFallback) {
        hadFallbackAi = true;
      } else if (isAiOn && (typeof score === 'number' || explanation)) {
        anySourceAi = true;
      }

      const container = document.createElement('div');
      container.className = 'result-item';

      const link = document.createElement('a');
      link.href = source.url || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const titleText = source.title || 'Untitled';
      link.setAttribute('title', titleText);

      const topRow = document.createElement('div');
      topRow.className = 'item-top-row';

      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = titleText;
      topRow.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'item-meta';

      if (isAiOn && typeof score === 'number') {
        const badge = document.createElement('span');
        badge.className = 'ai-score-badge';
        badge.textContent = `AI ${Math.round(score)}%`;
        meta.appendChild(badge);
      }

      if ((isAiOn || isFallback) && explanation) {
        const hint = document.createElement('span');
        hint.className = 'ai-hint';
        hint.setAttribute('tabindex', '0');
        hint.setAttribute('role', 'button');
        hint.setAttribute('aria-label', 'Show AI explanation');
        hint.textContent = '?';
        const tip = document.createElement('span');
        tip.className = 'ai-tooltip-text';
        tip.textContent = explanation + (typeof score === 'number' ? `\n\nAI SCORE: ${Math.round(score)}%` : '');
        hint.appendChild(tip);
        meta.appendChild(hint);
      }

      if (meta.children.length > 0) {
        topRow.appendChild(meta);
      }

      link.appendChild(topRow);

      const snippetText = source.snippet || source.summary || '';
      if (snippetText) {
        const snippet = document.createElement('div');
        snippet.className = 'item-excerpt';
        snippet.textContent = snippetText.length > 300 ? snippetText.substring(0, 300) + '…' : snippetText;
        link.appendChild(snippet);
      }

      container.appendChild(link);

      if (showInlineExplanation && explanation) {
        const exp = document.createElement('div');
        exp.className = 'item-explanation';
        exp.textContent = explanation;
        container.appendChild(exp);
      }

      sourcesList.appendChild(container);
    });
    setSectionEnhanced(sidebarInstance, 'community', anySourceAi && !hadFallbackAi);
  } else if (!sources) {
    renderMessage(sourcesList, 'info', 'No sources were used.', 'p');
  } else {
    renderMessage(sourcesList, 'empty', 'No sources found for this query');
  }
}

export async function setSectionEnhanced(sidebarInstance, type, hasAiData = false) {
  if (typeof sidebarInstance?.isSectionEnabled === 'function' && !sidebarInstance.isSectionEnabled(type)) return;

  try {
    const cfg = sidebarInstance?.sourceConfig?.get(type);
    const sidebar = sidebarInstance?.sidebar;
    if (!cfg || !sidebar) return;
    const section = sidebar.querySelector(cfg.sectionSelector);
    if (!section) return;
    const h5 = section.querySelector('h5');
    const existing = h5 ? h5.querySelector('.enhanced-badge') : null;

    const stored = await chrome.storage.local.get(['aiEnhancementSettings', 'aiEnabled']);
    const aiSettings = stored.aiEnhancementSettings || {};
    const globalAiEnabled = typeof stored.aiEnabled === 'undefined' ? true : !!stored.aiEnabled;
    const sectionEnabled = !!globalAiEnabled && (aiSettings?.[type] !== false);

    const shouldShow = sectionEnabled && !!hasAiData;

    if (shouldShow) {
      section.classList.add('enhanced');
      if (h5 && !existing) {
        const badge = document.createElement('span');
        badge.className = 'enhanced-badge';
        badge.textContent = 'Enhanced';
        badge.setAttribute('data-tooltip', 'Contains AI-enhanced relevance or explanation');
        const toggleBtn = h5.querySelector('.section-toggle');
        h5.insertBefore(badge, toggleBtn || null);
        setTimeout(() => badge.classList.add('visible'), 20);
      }
    } else {
      section.classList.remove('enhanced');
      if (existing) existing.remove();
    }
  } catch (e) {
    logger.debug('Error setting section enhanced badge', 'results', e);
  }
}

export function updateContent(sidebarInstance, data) {
  if (!sidebarInstance || !sidebarInstance.sidebar) return;

  // Update the appropriate text areas
  const originalInput = sidebarInstance.sidebar.querySelector('#original-text-input');
  const improvedInput = sidebarInstance.sidebar.querySelector('#improved-text-input');

  if (originalInput && improvedInput && data.solution) {
    // Put solution in improved text box
    improvedInput.value = data.solution;
    sidebarInstance.currentSolution = data.solution;

    // Show improved section
    const improvedSection = sidebarInstance.sidebar.querySelector('#improved-section');
    if (improvedSection) {
      improvedSection.classList.remove('hidden');
    }

    // If original is empty, add some context
    if (!originalInput.value.trim()) {
      const caseData = typeof sidebarInstance.getCaseDataFromPage === 'function'
        ? sidebarInstance.getCaseDataFromPage()
        : {};

      let contextText = 'Case Context:\n';
      if (caseData.subject) contextText += `Subject: ${caseData.subject}\n`;
      if (caseData.productFamily) contextText += `Product: ${caseData.productFamily}\n`;

      // Handle Product Component
      if (caseData.productComponent !== undefined && caseData.productComponent !== null) {
        if (caseData.productComponent.trim()) {
          contextText += `Component: ${caseData.productComponent}\n`;
        } else {
          contextText += `Component: [Not Specified]\n`;
        }
      }

      originalInput.value = contextText;
    }
  }

  if (data.sources && typeof sidebarInstance.displaySources === 'function') {
    sidebarInstance.displaySources(data.sources);
  }

  // Only show if already visible; do not auto-open on page load
  if (sidebarInstance.isVisible && typeof sidebarInstance.toggle === 'function') {
    sidebarInstance.toggle(true);
  }
}

function renderMessage(container, className, text, tagName = 'div') {
  if (!container) return;
  const el = document.createElement(tagName);
  el.className = className;
  el.textContent = text;
  container.replaceChildren(el);
}
