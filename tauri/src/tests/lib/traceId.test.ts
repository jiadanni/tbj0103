import { describe, it, expect } from 'vitest';
import { generateTraceId, traceMetadata } from '../../lib/traceId';

describe('traceId', () => {
  describe('generateTraceId', () => {
    it('generates a valid UUID v4 format string', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const id1 = generateTraceId();
      expect(id1).toMatch(uuidRegex);
    });

    it('generates unique IDs', () => {
      const id1 = generateTraceId();
      const id2 = generateTraceId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('traceMetadata', () => {
    it('returns JSON string with trace_id', () => {
      const traceId = 'test-trace-123';
      const result = traceMetadata(traceId);
      expect(result).toBe('{"trace_id":"test-trace-123"}');
    });

    it('merges extra fields into the JSON string', () => {
      const traceId = 'test-trace-123';
      const result = traceMetadata(traceId, { action: 'test', count: 42 });
      const parsed = JSON.parse(result);

      expect(parsed.trace_id).toBe('test-trace-123');
      expect(parsed.action).toBe('test');
      expect(parsed.count).toBe(42);
    });
  });
});
