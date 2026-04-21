import "@testing-library/jest-dom";
import { beforeEach, afterEach } from "vitest";

// Mock localStorage
class LocalStorageMock {
  store: Record<string, string> = {};
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = value.toString();
  }
  clear() {
    this.store = {};
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  get length() {
    return Object.keys(this.store).length;
  }
  key(index: number) {
    return Object.keys(this.store)[index] || null;
  }
}

const mock = new LocalStorageMock();

// Define on window and global
Object.defineProperty(window, 'localStorage', { value: mock });
Object.defineProperty(globalThis, 'localStorage', { value: mock });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverMock });
Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverMock });

beforeEach(() => {
  mock.clear();
});

afterEach(() => {
  mock.clear();
});
