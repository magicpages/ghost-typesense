import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // search.js is a browser Web Component (document, customElements, Shadow
    // DOM, matchMedia, sendBeacon), so it needs a DOM environment.
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.js']
  }
});
