// Test setup for the search UI suite.
//
// `search.js` is bundled by Rollup with a `const BUNDLED_CSS = "..."` banner
// injected at build time, and reads that global when an element renders its
// shadow DOM. Under Vitest the banner is absent, so define the global before
// the module is imported, otherwise the source throws on first render.
globalThis.BUNDLED_CSS = '';

// Keep auto-initialization inert: search.js creates a default element on load
// only when a global config (or a search hash/param) is present. Tests
// construct their own elements with explicit config, so leave this unset.
delete globalThis.__MP_SEARCH_CONFIG__;
