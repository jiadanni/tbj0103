import { describe, it, expect } from 'vitest';
import {
  normalizeTheme,
  hexToRgbChannels,
} from '../../lib/theme';

describe('theme', () => {
  describe('normalizeTheme', () => {
    it('returns the same theme if it is valid', () => {
      expect(normalizeTheme('system')).toBe('system');
      expect(normalizeTheme('light')).toBe('light');
      expect(normalizeTheme('noir')).toBe('noir');
      expect(normalizeTheme('sepia')).toBe('sepia');
      expect(normalizeTheme('hacker')).toBe('hacker');
    });

    it('normalizes legacy theme aliases to noir', () => {
      expect(normalizeTheme('dark')).toBe('noir');
      expect(normalizeTheme('glasscode')).toBe('noir');
      expect(normalizeTheme('oled')).toBe('noir');
    });

    it('defaults to system for unknown themes', () => {
      expect(normalizeTheme('unknown')).toBe('system');
      expect(normalizeTheme('random123')).toBe('system');
    });
  });

  describe('hexToRgbChannels', () => {
    it('converts valid hex codes to rgb channels', () => {
      expect(hexToRgbChannels('#007AFF')).toBe('0, 122, 255');
      expect(hexToRgbChannels('#ffffff')).toBe('255, 255, 255');
      expect(hexToRgbChannels('#000000')).toBe('0, 0, 0');
      expect(hexToRgbChannels('#ff0000')).toBe('255, 0, 0');
    });

    it('handles hex codes without #', () => {
      expect(hexToRgbChannels('007AFF')).toBe('0, 122, 255');
    });

    it('returns default Aether Blue for invalid hex codes', () => {
      expect(hexToRgbChannels('invalid')).toBe('0, 122, 255');
      expect(hexToRgbChannels('#123')).toBe('0, 122, 255'); // only handles 6 chars currently
      expect(hexToRgbChannels('#xyz123')).toBe('0, 122, 255');
    });
  });
});
