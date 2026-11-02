import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installMatchMedia, setViewport } from './viewport';

installMatchMedia();

// jsdom has no ResizeObserver; tests that care about sizes install their own.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  setViewport('desktop');
  vi.unstubAllGlobals();
});
