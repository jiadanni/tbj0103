import { describe, it, expect } from 'vitest';
import { lookupTechTerm } from '../../lib/techDictionary';

describe('techDictionary', () => {
  it('performs case-insensitive lookups', () => {
    // Basic test
    const termLLM = lookupTechTerm('llm');
    expect(termLLM).toBeDefined();

    // Check uppercase vs lowercase
    expect(lookupTechTerm('LLM')).toEqual(termLLM);
    expect(lookupTechTerm('lLm')).toEqual(termLLM);
  });

  it('handles spaces and trimming', () => {
    const ft = lookupTechTerm('fine-tuning');
    const spacedFt = lookupTechTerm('  fine-tuning  ');

    expect(ft).toBeDefined();
    expect(spacedFt).toEqual(ft);
  });

  it('returns null for unknown terms', () => {
    expect(lookupTechTerm('non-existent-tech-term-123')).toBeNull();
    expect(lookupTechTerm('')).toBeNull();
    expect(lookupTechTerm('   ')).toBeNull();
  });
});
