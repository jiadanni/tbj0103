// modules/sidebar/features/case-details.js

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CaseDetails');

// Escape special regex characters to prevent ReDoS attacks
function escapeRegExp(value) {
  const str = (typeof value === 'string' ? value : String(value || '')).slice(0, 200);
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isElementVisible(element) {
  if (!element) return false;
  try {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      element.getAttribute('aria-hidden') !== 'true';
  } catch (e) {
    logger.debug('Error checking element visibility:', 'case-details', e);
    return false;
  }
}

export function loadCaseDetails(sidebar) {
  // Fallback: run original inline behavior by calling existing methods
  const caseInfo = sidebar.sidebar.querySelector('#case-info');
  if (!caseInfo) return;
  try { performCaseDetailsLoad(sidebar, caseInfo); } catch (e) { logger.error('Error loading case details fallback:', 'case-details', e); }
}

// Enhanced version of case details loading with delay and better UI
// Adds a small retry mechanism in case the sidebar template hasn't been
// attached yet and '#case-info' is not found immediately.
export function loadCaseDetailsEnhanced(sidebar, attempt = 0) {
  sidebar.vlog('[Sidebar] loadCaseDetailsEnhanced called (attempt', attempt + 1 + ')');
  const caseInfo = sidebar.sidebar && sidebar.sidebar.querySelector ? sidebar.sidebar.querySelector('#case-info') : null;
  if (!caseInfo) {
    if (attempt < 5) {
      const retryDelay = 200; // ms
      logger.warn(`[Sidebar] loadCaseDetailsEnhanced: #case-info not found, retrying in ${retryDelay}ms (attempt ${attempt + 1})`, 'case-details', undefined);
      setTimeout(() => loadCaseDetailsEnhanced(sidebar, attempt + 1), retryDelay);
    } else {
      logger.warn('[Sidebar] loadCaseDetailsEnhanced: #case-info not found after retries', 'case-details', undefined);
    }
    return;
  }
  try {
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Loading case details...';
    caseInfo.replaceChildren(loading);
  } catch (e) { logger.warn('Unable to set loading state for case-info:', 'case-details', e); }
  setTimeout(() => { sidebar.vlog('[Sidebar] calling performCaseDetailsLoad after delay'); performCaseDetailsLoad(sidebar, caseInfo); }, 1500);
}

export function performCaseDetailsLoad(sidebar, caseInfo) {
  try {
    sidebar.vlog('[Sidebar] performCaseDetailsLoad started');
    const caseData = getCaseDataFromPage(sidebar);
    sidebar.vlog('[Sidebar] performCaseDetailsLoad - caseData:', caseData);
    const fragment = document.createDocumentFragment();

    if (caseData.subject) {
      fragment.appendChild(createDetailItem('Subject:', [
        document.createTextNode(caseData.subject)
      ]));
    }
    if (caseData.productFamily) {
      const nodes = [];
      const productIcon = getProductIconElement(sidebar, caseData.productFamily);
      if (productIcon) nodes.push(productIcon);
      const productName = document.createElement('span');
      productName.className = 'product-name';
      productName.textContent = caseData.productFamily;
      nodes.push(productName);
      fragment.appendChild(createDetailItem('Product:', nodes));
    }
    if (caseData.productComponent) {
      const componentText = caseData.productComponentAction
        ? `${caseData.productComponent} - ${caseData.productComponentAction}`
        : caseData.productComponent;
      fragment.appendChild(createDetailItem('Component:', [
        document.createTextNode(componentText)
      ]));
    }

    if (fragment.childNodes.length > 0) {
      caseInfo.replaceChildren(fragment);
    } else {
      const debugInfo = getDebugFieldInfo(sidebar);
      const debugContainer = document.createElement('div');
      debugContainer.className = 'debug-info';
      debugContainer.textContent = 'No case details found';

      const debugButton = document.createElement('button');
      debugButton.className = 'debug-button';
      debugButton.textContent = 'Show Debug Info';

      const hiddenSection = document.createElement('div');
      hiddenSection.style.display = 'none';

      const details = document.createElement('details');
      details.className = 'debug-details';

      const summary = document.createElement('summary');
      summary.className = 'debug-summary';
      summary.textContent = 'Debug Information';

      const pre = document.createElement('pre');
      pre.className = 'debug-pre';
      pre.textContent = debugInfo;

      const refreshButton = document.createElement('button');
      refreshButton.className = 'refresh-button';
      refreshButton.textContent = 'Refresh Page';

      // Add event listeners
      debugButton.addEventListener('click', () => {
        hiddenSection.style.display = 'block';
        debugButton.style.display = 'none';
      });

      refreshButton.addEventListener('click', () => {
        location.reload();
      });

      // Assemble the structure
      details.appendChild(summary);
      details.appendChild(pre);
      hiddenSection.appendChild(details);
      hiddenSection.appendChild(refreshButton);
      debugContainer.appendChild(debugButton);
      debugContainer.appendChild(hiddenSection);

      caseInfo.replaceChildren();
      caseInfo.appendChild(debugContainer);
    }
  } catch (error) {
    logger.error('Error loading case details:', 'case-details', error);
    const errorDiv = document.createElement('div');
    errorDiv.className = 'debug-info';
    errorDiv.style.color = '#999';
    errorDiv.textContent = 'Unable to load case details';
    caseInfo.replaceChildren(errorDiv);
    // Show user notification for visibility
    if (sidebar && typeof sidebar.showWarning === 'function') {
      sidebar.showWarning('Unable to load case details. Some case information may not be available.');
    }
  }
}

// Retry helper used when Lightning fields are slow to render
export async function retryPerformCaseDetailsLoad(sidebar, attempts = 3, intervalMs = 800) {
  const caseInfo = sidebar.sidebar.querySelector('#case-info');
  if (!caseInfo) return;
  for (let i = 0; i < attempts; i++) {
    try {
      sidebar.vlog(`[Sidebar] retryPerformCaseDetailsLoad attempt ${i + 1}/${attempts}`);
      performCaseDetailsLoad(sidebar, caseInfo);
      const current = getCaseDataFromPage(sidebar);
      if (current && (current.subject || current.productFamily || current.productComponent)) {
        sidebar.vlog('[Sidebar] retry succeeded on attempt', i + 1);
        return;
      }
    } catch (err) {
      logger.warn('Retry attempt failed:', 'case-details', err);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  sidebar.vlog('[Sidebar] retries exhausted - no case details found');
}

function createDetailItem(label, valueNodes = []) {
  const item = document.createElement('div');
  item.className = 'case-detail-item';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'case-detail-label';
  labelDiv.textContent = label;

  const valueDiv = document.createElement('div');
  valueDiv.className = 'case-detail-value';
  valueNodes.forEach(node => valueDiv.appendChild(node));

  item.appendChild(labelDiv);
  item.appendChild(valueDiv);
  return item;
}

function getProductIconElement(sidebar, productFamily) {
  try {
    const iconHtml = sidebar.utils?.getProductIconHTML ? sidebar.utils.getProductIconHTML(productFamily) : '';
    if (!iconHtml) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'product-icon-wrapper';
    wrapper.insertAdjacentHTML('beforeend', iconHtml);
    // Return the inserted icon if only one node exists, otherwise the wrapper
    return wrapper.childNodes.length === 1 ? wrapper.firstChild : wrapper;
  } catch (e) {
    logger.debug('Error getting product icon element:', 'case-details', e);
    return undefined;
  }
}

// Get case data from the current page
export function getCaseDataFromPage(sidebar) {
  // First try to get data from the specific Case Details section in the sidebar
  const caseDetailsSection = getCaseDetailsFromSidebar(sidebar);
  if (caseDetailsSection.subject || caseDetailsSection.productFamily || caseDetailsSection.productComponent) {
    // If we got some data from section, but missing caseOwner, try general field extraction
    if (!caseDetailsSection.caseOwner) {
      caseDetailsSection.caseOwner = getFieldValueByLabel(sidebar, 'Case Owner') || getFieldValueByLabel(sidebar, 'Owner') || getFieldValueByLabel(sidebar, 'Assigned To');
    }
    return caseDetailsSection;
  }

  // Fallback to general field extraction
  const caseNumber = getFieldValueByLabel(sidebar, 'Case Number') || getFieldValueByLabel(sidebar, 'Case #') || getCaseIdFromUrl();
  const data = {
    caseId: caseNumber || '',
    caseNumber: caseNumber || '',
    subject: getFieldValueByLabel(sidebar, 'Subject'),
    productFamily: getFieldValueByLabel(sidebar, 'Product Family') || getFieldValueByLabel(sidebar, 'Product'),
    productComponent: (() => {
      // Handle Product Component with proper fallback logic
      const affected = getFieldValueByLabel(sidebar, 'Product Component Affected');
      const section = getFieldValueByLabel(sidebar, 'Product Component Section');

      // Return first found field, even if empty string
      if (affected !== undefined) return affected;
      if (section !== undefined) return section;
      return undefined; // Neither field found
    })(),
    productComponentAction: getFieldValueByLabel(sidebar, 'Product Component Action'),
    caseOwner: getFieldValueByLabel(sidebar, 'Case Owner') || getFieldValueByLabel(sidebar, 'Owner') || getFieldValueByLabel(sidebar, 'Assigned To')
  };

  return data;
}

// New method to extract case details specifically from the sidebar/details panel
export function getCaseDetailsFromSidebar(sidebar) {
  try {
    const data = { caseId: '', caseNumber: '', subject: '', productFamily: '', productComponent: '', caseOwner: '' };
    const candidates = [];
    const sidebarSections = ['[title*="Case Details"]', '[aria-label*="Case Details"]', '[data-aura-class*="caseDetail"]', '.slds-card:has([title*="Case Details"])', '.forceRelatedListCardDesktop', '[data-target-selection-name*="case"]'];
    for (const selector of sidebarSections) {
      try {
        const sections = document.querySelectorAll(selector);
        sections.forEach(section => {
          if (!section) return;
          if (sidebar.sidebar && sidebar.sidebar.contains(section)) return;
          candidates.push({
            element: section,
            visible: isElementVisible(section),
            textLength: (section.textContent || '').trim().length,
            selector
          });
        });
      } catch (e) {
        logger.debug('Sidebar section selector failed:', 'case-details', selector, e);
        // continue to next
      }
    }
    const rightSidebar = document.querySelector('.highlights-panel, .slds-col--padded, [data-aura-class*="highlights"], .oneContent .rightCol');
    if (rightSidebar) {
      candidates.push({
        element: rightSidebar,
        visible: isElementVisible(rightSidebar),
        textLength: (rightSidebar.textContent || '').trim().length,
        selector: 'right-sidebar'
      });
    }

    // Prefer visible, more substantial sections first
    candidates.sort((a, b) => {
      if (a.visible && !b.visible) return -1;
      if (!a.visible && b.visible) return 1;
      return (b.textLength || 0) - (a.textLength || 0);
    });

    for (const candidate of candidates) {
      const sectionData = extractFieldsFromSection(sidebar, candidate.element);
      if (sectionData.subject || sectionData.productFamily || sectionData.productComponent || sectionData.caseNumber) {
        if (sectionData.caseNumber && !sectionData.caseId) {
          sectionData.caseId = sectionData.caseNumber;
        }
        return sectionData;
      }
    }
    return data;
  } catch (error) {
    logger.error('Error getting case details from sidebar:', 'case-details', error);
    return { caseId: '', caseNumber: '', subject: '', productFamily: '', productComponent: '', caseOwner: '' };
  }
}

// Extract specific fields from a given section
export function extractFieldsFromSection(sidebar, section) {
  const data = { caseNumber: '', subject: '', productFamily: '', productComponent: '', caseOwner: '' };
  try {
    const sectionText = section.textContent || '';
    data.caseNumber = extractFieldFromSectionText(sidebar, sectionText, ['Case Number', 'Case #']) || getFieldValueFromSection(sidebar, section, 'Case Number') || getFieldValueFromSection(sidebar, section, 'Case #');
    data.subject = extractFieldFromSectionText(sidebar, sectionText, ['Subject']) || getFieldValueFromSection(sidebar, section, 'Subject');
    data.productFamily = extractFieldFromSectionText(sidebar, sectionText, ['Product Family', 'Product']) || getFieldValueFromSection(sidebar, section, 'Product Family') || getFieldValueFromSection(sidebar, section, 'Product');
    const affected = extractFieldFromSectionText(sidebar, sectionText, ['Product Component Affected', 'Product Component Section', 'Component']);
    const fromSection = getFieldValueFromSection(sidebar, section, 'Product Component Affected') || getFieldValueFromSection(sidebar, section, 'Product Component Section');
    data.productComponent = affected !== null ? affected : fromSection;
    data.productComponentAction = extractFieldFromSectionText(sidebar, sectionText, ['Product Component Action']) || getFieldValueFromSection(sidebar, section, 'Product Component Action');
    data.caseOwner = extractFieldFromSectionText(sidebar, sectionText, ['Case Owner', 'Owner', 'Assigned To']) || getFieldValueFromSection(sidebar, section, 'Case Owner') || getFieldValueFromSection(sidebar, section, 'Owner') || getFieldValueFromSection(sidebar, section, 'Assigned To');
    return data;
  } catch (error) {
    logger.error('Error extracting fields from section:', 'case-details', error);
    return data;
  }
}

// Extract field value from section text using regex patterns
export function extractFieldFromSectionText(sidebar, text, fieldNames) {
  for (const fieldName of fieldNames) {
    const pattern = new RegExp(`${escapeRegExp(fieldName)}\\s*:?\\s*([^\\n\\r]*)`, 'i');
    const match = text.match(pattern);
    if (match && match[1] !== undefined) {
      const value = match[1].trim();
      if (value.toLowerCase() !== fieldName.toLowerCase() && value.length < 100) return value;
    }
  }
  return null;
}

// Get field value specifically from within a section
export function getFieldValueFromSection(sidebar, section, labelText) {
  try {
    const labels = section.querySelectorAll('span, div, label, .slds-form-element__label');
    for (const label of labels) {
      const text = label.textContent?.trim();
      if (text && text.toLowerCase() === labelText.toLowerCase()) {
        const value = findValueForLabel(sidebar, label, labelText);
        if (value) return value;
      }
    }
    return '';
  } catch (error) { logger.error('Error getting field value from section:', 'case-details', error); return ''; }
}

// Debug helper to show what fields are available on the page
export function getDebugFieldInfo(_sidebar) {
  try {
    const availableLabels = [];
    const lightningSelectors = ['.test-id__field-label', 'span.test-id__field-label', '.slds-form-element__label', '.forceInputLabel', '[data-aura-class*="forceInputLabel"]', '.field-label', '[class*="field-label"]'];
    for (const selector of lightningSelectors) { const labels = document.querySelectorAll(selector); labels.forEach(label => { if (label.textContent && label.textContent.trim()) availableLabels.push(`${selector}: "${label.textContent.trim()}"`); }); }
    const formLabels = document.querySelectorAll('label, .slds-form-element__label'); formLabels.forEach(label => { if (label.textContent && label.textContent.trim() && !availableLabels.some(l => l.includes(label.textContent.trim()))) availableLabels.push(`Form: "${label.textContent.trim()}"`); });
    const caseFieldTerms = ['subject', 'product', 'priority', 'status', 'owner', 'created', 'description', 'case number', 'case #'];
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      if (element.children.length === 0) {
        const text = element.textContent?.trim();
        if (text && text.length < 50) {
          for (const term of caseFieldTerms) { if (text.toLowerCase().includes(term)) { availableLabels.push(`Potential: "${text}"`); break; } }
        }
      }
    }
    const urlInfo = `URL: ${window.location.href.substring(0, 100)}...`;
    const readyState = `Document ready: ${document.readyState}`;
    const lightningReady = document.querySelector('[data-aura-rendered-by]') ? 'Lightning components found' : 'No Lightning components detected';
    return `${urlInfo}
${readyState}
${lightningReady}

Available labels (${availableLabels.length}):
${availableLabels.slice(0, 15).join('\n')}${availableLabels.length > 15 ? `\n... and ${availableLabels.length - 15} more` : ''}`;
  } catch (error) {
    logger.debug('Error generating debug field info:', 'case-details', error);
    return `Debug error: ${error.message}`;
  }
}

// Helper method to get field values
export function getFieldValueByLabel(sidebar, label) {
  try {
    const lightningSelectors = ['.test-id__field-label', 'span.test-id__field-label', '[data-target-selection-name*="field"]', '.slds-form-element__label', '.forceInputLabel', '[data-aura-class*="forceInputLabel"]', '.field-label', '[class*="field-label"]'];
    for (const selector of lightningSelectors) {
      const labels = document.querySelectorAll(selector);
      for (const labelElement of labels) {
        const labelText = labelElement.textContent?.trim();
        if (labelText && labelText.toLowerCase() === label.toLowerCase()) {
          const value = findValueForLabel(sidebar, labelElement, label);
          if (value !== null) return value;
        }
      }
    }
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const spanText = span.textContent?.trim();
      if (spanText && spanText.toLowerCase() === label.toLowerCase()) {
        const value = findValueForLabel(sidebar, span, label);
        if (value !== null) return value;
      }
    }
    const textPattern = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*([^\\n\\r]+)`, 'i');
    const bodyText = document.body.textContent || '';
    const match = bodyText.match(textPattern);
    if (match && match[1]) {
      const potentialValue = match[1].trim();
      if (potentialValue.toLowerCase() !== label.toLowerCase() && potentialValue.length >= 0 && potentialValue.length < 200) return potentialValue;
    }
    return undefined;
  } catch (error) {
    logger.error('Error getting field value for label:', 'case-details', label, error);
    return undefined;
  }
}

// Helper method to find value associated with a label element
export function findValueForLabel(sidebar, labelElement, originalLabel) {
  try {
    const formElement = labelElement.closest('.slds-form-element, .forceDetailPanelDesktopLayoutItem, [data-aura-class*="forceDetailPanelDesktopLayoutItem"]');
    if (formElement) {
      if (originalLabel.toLowerCase().includes('owner') || originalLabel.toLowerCase().includes('assigned')) {
        const userSpans = formElement.querySelectorAll('.slds-form-element__control > span, .slds-form-element__control > div > span');
        for (const span of userSpans) {
          const value = span.textContent?.trim();
          if (value && value !== originalLabel && value.split(' ').length >= 2 && value.length > 3 && value.length < 50) {
            if (!value.match(/\b(open|edit|view|preview|click|select|choose|more|less)\b/i)) return value;
          }
        }
      }
      const lightningTexts = formElement.querySelectorAll('lightning-formatted-text, [data-aura-class*="lightning-formatted-text"]');
      for (const lt of lightningTexts) {
        const value = lt.textContent?.trim();
        if (value && value !== originalLabel && value.length > 0 && !value.includes('to change without notice')) return value;
      }
      const controlAreas = formElement.querySelectorAll('.slds-form-element__control, .forceOutputText, [data-aura-class*="forceOutputText"]');
      for (const control of controlAreas) {
        const value = control.textContent?.trim();
        if (value && value !== originalLabel && value.length > 0 && value.length < 200 && !value.includes('to change without notice')) {
          if (!originalLabel.toLowerCase().includes('owner') && !originalLabel.toLowerCase().includes('assigned')) return value;
        }
      }
    }
    return '';
  } catch (error) { logger.error('Error finding value for label:', 'case-details', originalLabel, error); return ''; }
}

function getCaseIdFromUrl() {
  try {
    const href = window.location.href || '';
    const match = href.match(new RegExp('Case/([A-Za-z0-9]{8,18})'));
    if (match && match[1]) return match[1];
    const pathParts = (window.location.pathname || '').split('/').filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    if (last && /^[A-Za-z0-9]{8,18}$/.test(last)) return last;
  } catch (e) {
    logger.debug('Error getting case ID from URL:', 'case-details', e);
  }
  return '';
}
