import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installMatchMedia, setViewport } from './viewport';

installMatchMedia();

afterEach(() => {
  cleanup();
  setViewport('desktop');
  vi.unstubAllGlobals();
});
