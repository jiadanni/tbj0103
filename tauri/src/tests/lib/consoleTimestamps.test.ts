import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installConsoleTimestamps,
  enableLogForwarding,
  enableBatchLogForwarding
} from '../../lib/consoleTimestamps';

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
