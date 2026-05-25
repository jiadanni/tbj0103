import { describe, it, expect } from 'vitest';
import {
  resolveModelDisplayName,
  resolveModelSecondaryDisplayName
} from '../../lib/modelDisplayName';
import type { AiModel } from '../../lib/api';

describe('modelDisplayName', () => {
  const mockModels: any[] = [
    {
      model_id: 'llama-3:8b',
      name: 'llama-3:8b',
      provider: 'ollama',
      description: null,
      context_length: 4096,
      size_bytes: null,
      parameter_size: null,
      quantization_level: null,
      enabled: true,
      role_tags: [],
      priority: 1
    },
    {
      model_id: 'chatgpt-web',
      name: 'chatgpt-web',
      provider: 'web_openai',
      description: null,
      context_length: 4096,
      size_bytes: null,
      parameter_size: null,
      quantization_level: null,
      enabled: true,
      role_tags: [],
      priority: 1
    },
    {
      model_id: 'unknown-web',
      name: 'unknown-web',
      provider: 'web_unknown',
      description: null,
      context_length: 4096,
      size_bytes: null,
      parameter_size: null,
      quantization_level: null,
      enabled: true,
      role_tags: [],
      priority: 1
    },
    {
      model_id: 'custom-model',
      name: 'My Custom Model',
      provider: 'other',
      description: null,
      context_length: 4096,
      size_bytes: null,
      parameter_size: null,
      quantization_level: null,
      enabled: true,
      role_tags: [],
      priority: 1
    }
  ];

  describe('resolveModelDisplayName', () => {
    it('returns custom model label if provided', () => {
      const labels = { 'llama-3:8b': 'My Llama Model' };
      const result = resolveModelDisplayName('llama-3:8b', labels, mockModels);
      expect(result).toBe('My Llama Model');
    });

    it('returns base model name if custom label is auto-trimmed Ollama label', () => {
      const labels = { 'llama-3:8b': 'llama-3' }; // "llama-3:8b".split(":")[0] === "llama-3"
      const result = resolveModelDisplayName('llama-3:8b', labels, mockModels);
      expect(result).toBe('llama-3:8b');
    });

    it('returns default label for provider-neutral web models', () => {
      const labels = {};
      const result = resolveModelDisplayName('chatgpt-web', labels, mockModels);
      expect(result).toBe('Browser Assistant A');
    });

    it('handles web models with no specific neutral mapping', () => {
      const labels = {};
      const result = resolveModelDisplayName('unknown-web', labels, mockModels);
      expect(result).toBe('Browser Assistant');
    });

    it('returns stored name if no custom label provided', () => {
      const labels = {};
      const result = resolveModelDisplayName('custom-model', labels, mockModels);
      expect(result).toBe('My Custom Model');
    });

    it('returns model_id if nothing else is available', () => {
      const labels = {};
      const result = resolveModelDisplayName('missing-model', labels, []);
      expect(result).toBe('missing-model');
    });
  });

  describe('resolveModelSecondaryDisplayName', () => {
    it('returns technical ID for known web models', () => {
      const result = resolveModelSecondaryDisplayName('chatgpt-web', 'web_openai');
      expect(result).toBe('browser-assistant-a');
    });

    it('returns fallback technical ID for unknown web models', () => {
      const result = resolveModelSecondaryDisplayName('unknown-web', 'web_unknown');
      expect(result).toBe('browser-assistant');
    });

    it('returns model ID for non-web models', () => {
      const result = resolveModelSecondaryDisplayName('llama-3:8b', 'ollama');
      expect(result).toBe('llama-3:8b');
    });
  });
});
