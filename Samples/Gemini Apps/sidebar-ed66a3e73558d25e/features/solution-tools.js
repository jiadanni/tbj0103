// AI-driven solution tools (spellcheck, suggest, improve) for the sidebar
import { sendMessageWithTimeout } from '../../utils/messaging.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('SolutionTools');



export async function handleSpellcheck(self) {
  const originalInput = self.sidebar.querySelector('#original-text-input');
  const improvedInput = self.sidebar.querySelector('#improved-text-input');
  if (!originalInput || !improvedInput) return;
  try {
    const improvedSection = self.sidebar.querySelector('#improved-section');
    const improvedLabel = improvedSection ? improvedSection.querySelector('.input-label') : null;
    if (improvedSection) improvedSection.classList.remove('hidden');
    if (improvedLabel) {
      const copyBtn = improvedLabel.querySelector('#copy-improved-text-btn');
      const labelText = document.createTextNode('Corrected Text');
      Array.from(improvedLabel.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
      if (copyBtn) improvedLabel.insertBefore(labelText, copyBtn);
      else improvedLabel.textContent = 'Corrected Text';
    }
  } catch (e) {
    logger.debug('DOM update error (spellcheck header)', 'solution-tools', e);
  }

  const currentText = originalInput.value.trim();
  if (!currentText || currentText === 'Original text or imported content...') {
    originalInput.value = 'Please enter text in the Original Text box to check spelling and grammar.';
    return;
  }

  const originalText = currentText;
  improvedInput.value = 'Checking spelling and grammar...';
  improvedInput.disabled = true;

  try {
    const caseData = (typeof self.getCaseDataFromPage === 'function') ? self.getCaseDataFromPage() : {};
    const response = await sendMessageWithTimeout({ action: 'spellcheck', text: originalText, caseData }, 20000);
    if (response.error) throw new Error(response.error);
    improvedInput.value = response.correctedText || response.data || originalText;
    if (response.correctedText && response.correctedText !== originalText) {
      const tempMessage = 'Spelling and grammar checked - corrections applied to improved text';
      const originalPlaceholder = improvedInput.placeholder;
      improvedInput.placeholder = tempMessage;
      setTimeout(() => { improvedInput.placeholder = originalPlaceholder; }, 3000);
    } else if (response.correctedText === originalText) {
      improvedInput.value = originalText;
      const tempMessage = 'No spelling or grammar errors found';
      const originalPlaceholder = improvedInput.placeholder;
      improvedInput.placeholder = tempMessage;
      setTimeout(() => { improvedInput.placeholder = originalPlaceholder; }, 2000);
    }
  } catch (error) {
    logger.error('Error checking spelling:', 'solution-tools', error);
    improvedInput.value = `Error: ${error.message || 'Failed to check spelling and grammar'}`;
    setTimeout(() => { improvedInput.value = ''; }, 3000);
  } finally {
    improvedInput.disabled = false;
  }
}

export async function handleSuggestSolution(self) {
  const originalInput = self.sidebar.querySelector('#original-text-input');
  const improvedInput = self.sidebar.querySelector('#improved-text-input');
  if (!originalInput || !improvedInput) return;
  try {
    const improvedSection = self.sidebar.querySelector('#improved-section');
    const improvedLabel = improvedSection ? improvedSection.querySelector('.input-label') : null;
    if (improvedSection) improvedSection.classList.remove('hidden');
    if (improvedLabel) {
      const copyBtn = improvedLabel.querySelector('#copy-improved-text-btn');
      const labelText = document.createTextNode('Guidance');
      Array.from(improvedLabel.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
      if (copyBtn) improvedLabel.insertBefore(labelText, copyBtn);
      else improvedLabel.textContent = 'Guidance';
    }
  } catch (e) {
    logger.debug('DOM update error (suggest header)', 'solution-tools', e);
  }

  improvedInput.value = 'Analyzing case and generating solution...';
  improvedInput.disabled = true;

  try {
    const caseData = (typeof self.getCaseDataFromPage === 'function') ? self.getCaseDataFromPage() : {};

    // Gather context from rendered results
    const contextLines = [];
    const collectors = [
      { id: '#jira-list', label: 'Jira Work Items' },
      { id: '#confluence-list', label: 'Confluence articles' },
      { id: '#community-list', label: 'Knowledge Base' }
    ];

    collectors.forEach(c => {
      const container = self.sidebar.querySelector(c.id);
      if (container) {
        const items = container.querySelectorAll('.item-title');
        if (items.length > 0) {
          contextLines.push(`${c.label}:`);
          items.forEach(item => contextLines.push(`- ${item.textContent.trim()}`));
        }
      }
    });

    const context = contextLines.join('\n');
    const response = await sendMessageWithTimeout({
      action: 'suggestSolution',
      data: caseData,
      context: context
    }, 20000);

    if (response.error) throw new Error(response.error);
    self.currentSolution = response.solution || response.data?.solution || response.data || 'No solution could be generated.';
    improvedInput.value = self.currentSolution;
  } catch (error) {
    logger.error('Error suggesting solution:', 'solution-tools', error);
    improvedInput.value = `Error: ${error.message || 'Failed to generate solution'}`;
  } finally {
    improvedInput.disabled = false;
  }
}

export async function handleImproveSolution(self) {
  const originalInput = self.sidebar.querySelector('#original-text-input');
  const improvedInput = self.sidebar.querySelector('#improved-text-input');
  if (!originalInput || !improvedInput) return;
  try {
    const improvedSection = self.sidebar.querySelector('#improved-section');
    const improvedLabel = improvedSection ? improvedSection.querySelector('.input-label') : null;
    if (improvedSection) improvedSection.classList.remove('hidden');
    if (improvedLabel) {
      const copyBtn = improvedLabel.querySelector('#copy-improved-text-btn');
      const labelText = document.createTextNode('Enhanced Text');
      Array.from(improvedLabel.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
      if (copyBtn) improvedLabel.insertBefore(labelText, copyBtn);
      else improvedLabel.textContent = 'Enhanced Text';
    }
  } catch (e) {
    logger.debug('DOM update error (improve header)', 'solution-tools', e);
  }

  const currentSolution = originalInput.value.trim();
  if (!currentSolution || currentSolution === 'Original text or imported content...') {
    originalInput.value = 'Please enter text in the Original Text box first before improving it.';
    return;
  }

  improvedInput.value = 'Improving the written solution...';
  improvedInput.disabled = true;

  try {
    const caseData = (typeof self.getCaseDataFromPage === 'function') ? self.getCaseDataFromPage() : {};
    const response = await sendMessageWithTimeout({ action: 'improveSolution', currentSolution, caseData }, 20000);
    if (response.error) throw new Error(response.error);
    improvedInput.value = response.improvedSolution || response.data || 'No improvements could be made.';
  } catch (error) {
    logger.error('Error improving solution:', 'solution-tools', error);
    improvedInput.value = `Error: ${error.message || 'Failed to improve solution'}`;
  } finally {
    improvedInput.disabled = false;
  }
}
