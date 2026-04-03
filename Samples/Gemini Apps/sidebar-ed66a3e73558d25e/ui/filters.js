/**
 * Filters Module
 * Provides search/filter functionality for JIRA, Confluence, and Community results
 */

import { debounce } from '../../utils/debounce.js';
import { FILTER_DEBOUNCE_MS } from '../../config/constants.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('Filters');

/**
 * Initialize filters for a results section
 * @param {HTMLElement} section - The section element containing results
 * @param {string} listSelector - CSS selector for the results list
 * @param {string} placeholder - Placeholder text for the filter input
 */
export function initializeFilter(section, listSelector, placeholder = 'Filter results...') {
  if (!section) return;

  const list = section.querySelector(listSelector);
  if (!list) return;

  // Check if filter already exists
  if (section.querySelector('.results-filter')) return;

  // Create filter container
  const filterContainer = document.createElement('div');
  filterContainer.className = 'results-filter-container';

  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.className = 'results-filter';
  filterInput.placeholder = placeholder;
  filterInput.setAttribute('aria-label', placeholder);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'filter-clear-btn';
  clearBtn.textContent = '×';
  clearBtn.title = 'Clear filter';
  clearBtn.style.display = 'none';

  const matchCount = document.createElement('span');
  matchCount.className = 'filter-match-count';
  matchCount.setAttribute('aria-live', 'polite');
  matchCount.style.display = 'none';

  filterContainer.appendChild(filterInput);
  filterContainer.appendChild(clearBtn);
  filterContainer.appendChild(matchCount);

  // Insert filter before the list
  list.parentElement.insertBefore(filterContainer, list);

  // Filter logic using debounce utility
  const debouncedFilter = debounce((query) => {
    applyFilter(list, query, matchCount);
    clearBtn.style.display = query ? 'block' : 'none';
  }, FILTER_DEBOUNCE_MS);

  filterInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    debouncedFilter(query);
  });

  // Apply immediately on Enter key (user expectation)
  filterInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      debouncedFilter.flush(e.target.value.toLowerCase().trim());
    }
  });

  // Also apply on blur and paste to reduce surprises
  filterInput.addEventListener('blur', (e) => {
    debouncedFilter.flush(e.target.value.toLowerCase().trim());
  });

  filterInput.addEventListener('paste', () => {
    // Handle pasted content after browser updates input value
    setTimeout(() => {
      debouncedFilter.flush(filterInput.value.toLowerCase().trim());
    }, 20);
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    filterInput.value = '';
    filterInput.dispatchEvent(new Event('input'));
    filterInput.focus();
  });

  logger.info('[Filters] Initialized for:', 'filters', listSelector);
}

/**
 * Apply filter to a results list
 * @param {HTMLElement} list - The list element containing results
 * @param {string} query - The search query
 * @param {HTMLElement | null} matchCount - The match count element
 */
function applyFilter(list, query, matchCount) {
  if (!list) return;

  const items = list.querySelectorAll('.result-item, li');
  let visibleCount = 0;

  items.forEach(item => {
    if (!query) {
      // Show all if no query
      item.style.display = '';
      visibleCount++;
      return;
    }

    // Get text content from the item
    const text = item.textContent.toLowerCase();

    if (text.includes(query)) {
      item.style.display = '';
      visibleCount++;
    } else {
      item.style.display = 'none';
    }
  });

  // Update empty state
  updateEmptyState(list, visibleCount, query);

  // Update match count UI
  try {
    if (matchCount) {
      if (!query) {
        matchCount.style.display = 'none';
        matchCount.textContent = '';
      } else {
        matchCount.style.display = 'inline-block';
        matchCount.textContent = `${visibleCount} match${visibleCount === 1 ? '' : 'es'}`;
      }
    }
  } catch (e) {
    logger.debug('Error updating match count UI', 'filters', e);
  }
}

/**
 * Update or create empty state message
 * @param {HTMLElement} list - The list element
 * @param {number} visibleCount - Number of visible items
 * @param {string} query - Current search query
 */
function updateEmptyState(list, visibleCount, query) {
  const emptyStateId = 'filter-empty-state';
  let emptyState = list.querySelector(`#${emptyStateId}`);

  if (visibleCount === 0 && query) {
    // Create empty state if needed
    if (!emptyState) {
      emptyState = document.createElement('div');
      emptyState.id = emptyStateId;
      emptyState.className = 'filter-empty-state';
      list.appendChild(emptyState);
    }

    emptyState.textContent = `No results found for "${query}"`;
    emptyState.style.display = 'block';
  } else if (emptyState) {
    // Hide empty state
    emptyState.style.display = 'none';
  }
}

/**
 * Initialize filters for all standard sections
 * @param {HTMLElement} sidebar - The sidebar element
 */
export function initializeAllFilters(sidebar) {
  if (!sidebar) return;

  // JIRA tickets
  const jiraSection = sidebar.querySelector('#jira-tickets');
  if (jiraSection) {
    initializeFilter(jiraSection, '#jira-list', 'Filter JIRA tickets...');
  }

  // Confluence articles
  const confluenceSection = sidebar.querySelector('#confluence-pages');
  if (confluenceSection) {
    initializeFilter(confluenceSection, '#confluence-list', 'Filter Confluence articles...');
  }

  // Knowledge Base / Community guides
  const communitySection = sidebar.querySelector('#community-guides');
  if (communitySection) {
    const label = communitySection.querySelector('.section-title')?.textContent?.trim() || 'Knowledge Base';
    initializeFilter(communitySection, '#community-list', `Filter ${label}...`);
  }

  logger.info('[Filters] Initialized all filters', 'filters', undefined);
}

/**
 * Clear all filters in the sidebar
 * @param {HTMLElement} sidebar - The sidebar element
 */
export function clearAllFilters(sidebar) {
  if (!sidebar) return;

  const filterInputs = sidebar.querySelectorAll('.results-filter');
  filterInputs.forEach(input => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
}
