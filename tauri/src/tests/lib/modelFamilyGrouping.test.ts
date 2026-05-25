import { describe, it, expect } from 'vitest';
import { groupModelsByFamily } from '../../lib/modelFamilyGrouping';
import type { AiModel } from '../../lib/api';
describe('modelFamilyGrouping', () => {
  const models: AiModel[] = [
    {
      model_id: 'llama-3:8b',
      name: 'Llama 3 8B',
      provider: 'ollama',
      id: "",
      is_paid: false,
      is_hidden: false,
      tokens_used_total: 0,
      created_at: "",
      context_size: 4096,
      enabled: true,
      role_tags: [],
      priority: 1
    },
    {
      model_id: 'llama-3:70b',
      name: 'Llama 3 70B',
      provider: 'ollama',
      id: "",
      is_paid: false,
      is_hidden: false,
      tokens_used_total: 0,
      created_at: "",
      context_size: 4096,
      enabled: true,
      role_tags: [],
      priority: 1
    },
    {
      model_id: 'qwen2:7b',
      name: 'Qwen 2 7B',
      provider: 'ollama',
      id: "",
      is_paid: false,
      is_hidden: false,
      tokens_used_total: 0,
      created_at: "",
      context_size: 4096,
      enabled: true,
      role_tags: [],
      priority: 1
    },
    {
      model_id: 'custom-model',
      name: 'Custom',
      provider: 'other',
      id: "",
      is_paid: false,
      is_hidden: false,
      tokens_used_total: 0,
      created_at: "",
      context_size: 4096,
      enabled: true,
      role_tags: [],
      priority: 1
    }
  ];
  it('groups models by prefix using modelFamilyLabels', () => {
    const familyLabels = { 'llama-3': 'Meta Llama 3', 'qwen2': 'Alibaba Qwen 2' };
    const customFamilies: string[] = [];
    const { groups, options } = groupModelsByFamily(
      models,
      familyLabels,
      customFamilies,
      {},
      undefined,
      false
    );
    expect(groups.length).toBe(2);
    const llamaGroup = groups.find(g => g.label === 'Meta Llama 3');
    expect(llamaGroup).toBeDefined();
    expect(llamaGroup?.options.length).toBe(2);
    const qwenGroup = groups.find(g => g.label === 'Alibaba Qwen 2');
    expect(qwenGroup).toBeDefined();
    expect(qwenGroup?.options.length).toBe(1);
    expect(options.length).toBe(1); // 'custom-model' should be ungrouped
    expect(options[0].value).toBe('custom-model');
  });
  it('groups models correctly with customModelFamilies fallback', () => {
    const familyLabels = {};
    const customFamilies = ['llama-3'];
    const { groups, options } = groupModelsByFamily(
      models,
      familyLabels,
      customFamilies,
      {},
      undefined,
      false
    );
    const llamaGroup = groups.find(g => g.label === 'llama-3');
    expect(llamaGroup).toBeDefined();
    expect(llamaGroup?.options.length).toBe(2);
    expect(options.length).toBe(2); // 'qwen2:7b', 'custom-model'
  });
  it('uses prefix as fallback when usePrefixAsFallback is true', () => {
    const familyLabels = {};
    const customFamilies: string[] = [];
    const { groups, options } = groupModelsByFamily(
      models,
      familyLabels,
      customFamilies,
      {},
      undefined,
      true
    );
    expect(groups.length).toBe(3);
    expect(groups.find(g => g.label === 'llama-3')).toBeDefined();
    expect(groups.find(g => g.label === 'qwen2')).toBeDefined();
    expect(groups.find(g => g.label === 'custom-model')).toBeDefined();
    expect(options.length).toBe(0);
  });
  it('works with array of strings and modelLabels', () => {
    const stringModels = ['model-a:1', 'model-a:2', 'model-b'];
    const familyLabels = { 'model-a': 'Family A' };
    const modelLabels = { 'model-a:1': 'A One', 'model-a:2': 'A Two', 'model-b': 'B' };
    const { groups, options } = groupModelsByFamily(
      stringModels,
      familyLabels,
      [],
      modelLabels,
      undefined,
      false
    );
    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe('Family A');
    expect(groups[0].options[0].label).toBe('A One');
    expect(groups[0].options[1].label).toBe('A Two');
    expect(options.length).toBe(1);
    expect(options[0].label).toBe('B');
  });
});
