import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPrefsWindowSingleInstance } from '../../lib/prefsWindowMode';

describe('prefsWindowMode', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value.toString();
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    } as any;

    // Stub global localStorage getter instead of overwriting property
    vi.stubGlobal('localStorage', mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getPrefsWindowSingleInstance', () => {
    it('returns false by default', () => {
      expect(getPrefsWindowSingleInstance()).toBe(false);
    });

    it('returns true if stored value is "true"', () => {
      localStorage.setItem('prefsWindowSingleInstance', 'true');
      expect(getPrefsWindowSingleInstance()).toBe(true);
    });

    it('returns false if stored value is "false"', () => {
      localStorage.setItem('prefsWindowSingleInstance', 'false');
      expect(getPrefsWindowSingleInstance()).toBe(false);
    });
  });
});
