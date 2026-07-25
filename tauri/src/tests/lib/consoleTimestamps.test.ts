/* eslint-disable no-console -- this suite tests console patching itself */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installConsoleTimestamps } from '../../lib/consoleTimestamps';

describe('consoleTimestamps', () => {
  let originalConsoleInfo: typeof console.info;

  beforeEach(() => {
    originalConsoleInfo = console.info;
  });

  afterEach(() => {
    console.info = originalConsoleInfo;
  });

  it('should patch console methods', () => {
    installConsoleTimestamps();
    expect(console.info).not.toBe(originalConsoleInfo);
  });
});
