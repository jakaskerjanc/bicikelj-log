import { vi } from 'vitest';

// jsdom has no matchMedia; this fake answers the app's single "(min-width: 640px)" query.
let desktop = true;

export function setViewport(viewport: 'desktop' | 'mobile'): void {
  desktop = viewport === 'desktop';
}

export function installMatchMedia(): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('min-width') ? desktop : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}
