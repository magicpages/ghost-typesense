import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../search.js';

// Loading a page whose URL already carries the search state — `#/search`,
// `?s=…`, `?q=…` — used to hang for the palette and discovery layouts: init()
// awaited handleInitialState(), which awaited openModal(), which awaited the
// very promise init() was fulfilling. The modal escaped it only by timing: it
// never suspends before handleInitialState, so `this.initReady` had not been
// assigned yet and openModal read undefined. Any layout that loads a chunk
// first — the only reason the promise exists — deadlocked (issue #73).
//
// These drive the real init() rather than the shorthand the other suites use,
// because the cycle only exists there.

// A layout stub with the surface methods init() and openModal() touch. Chunks
// register themselves through this global, and loadLayoutFactory serves an
// already-registered layout without a network fetch — while still awaiting,
// which is what makes `initReady` observable and reproduced the deadlock.
function registerLayout(id, overrides = {}) {
  const layout = {
    id,
    requiredFields: () => [],
    buildMarkup: () => `<div id="mp-search-${id}"><input class="mp-search-input" /></div>`,
    cacheElements: vi.fn(),
    bindEvents: vi.fn(),
    injectStyles: vi.fn(),
    setTheme: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    focusInput: vi.fn(),
    setQuery: vi.fn(),
    getQuery: () => '',
    renderInitial: vi.fn(),
    renderLoading: vi.fn(),
    renderEmpty: vi.fn(),
    renderError: vi.fn(),
    renderResults: vi.fn(),
    renderSuggestions: vi.fn(),
    renderFacets: vi.fn(),
    ...overrides
  };
  window.__mpRegisterSearchLayout(id, () => layout);
  return layout;
}

// Build an element and run init() exactly as connectedCallback does, without
// tripping its one-time `isInitialized` guard.
function startWidget(config = {}) {
  const el = document.createElement('magicpages-search');
  el.config = {
    typesenseNodes: [{ host: 'localhost', port: '8108', protocol: 'http' }],
    typesenseApiKey: 'search-only',
    collectionName: 'ghost',
    commonSearches: [],
    pinnedSearches: [],
    facets: [],
    ...config
  };
  el.i18n = el.defaultI18n;
  el.typesenseClient = {
    collections: () => ({ documents: () => ({ search: async () => ({ found: 0, hits: [] }) }) })
  };
  el.initReady = el.init();
  el.initReady.then(el.markSurfaceReady, el.markSurfaceReady);
  return el;
}

// Set the URL without firing `hashchange`. Assigning `location.hash` queues one,
// and the widget turns a hashchange into an open of its own — which would leak
// across tests on this shared jsdom window and be mistaken for the behaviour
// under test.
function setUrl(suffix = '') {
  history.replaceState(null, '', `${window.location.pathname}${suffix}`);
}

describe('initial state carried in the URL', () => {
  beforeEach(() => {
    setUrl();
  });

  afterEach(() => {
    setUrl();
    vi.restoreAllMocks();
  });

  it('opens an alternative layout for #/search instead of hanging', async () => {
    const layout = registerLayout('palette');
    setUrl('#/search');

    const el = startWidget({ uiStyle: 'palette' });
    // The assertion is that this settles at all: before the fix it never did.
    await el.initReady;

    expect(el.isModalOpen).toBe(true);
    expect(layout.onOpen).toHaveBeenCalled();
  });

  it('opens the built-in modal for #/search', async () => {
    setUrl('#/search');

    const el = startWidget();
    await el.initReady;

    expect(el.isModalOpen).toBe(true);
    expect(el.modal.classList.contains('mp-search-hidden')).toBe(false);
  });

  it('resolves openModal for a caller outside the init path', async () => {
    registerLayout('discovery');
    const el = startWidget({ uiStyle: 'discovery' });

    // A click, ⌘K or a hash change can land before init() finishes; it must
    // wait for the surface and then open it, not wait forever.
    await Promise.all([el.openModal(), el.initReady]);

    expect(el.isModalOpen).toBe(true);
  });

  it('still opens when mounting the layout throws, rather than stranding the caller', async () => {
    registerLayout('palette', {
      buildMarkup: () => { throw new Error('chunk mounted but broke'); }
    });
    setUrl('#/search');

    const el = startWidget({ uiStyle: 'palette' });
    await el.initReady;

    // init() falls back to the built-in modal; the point is that it opened.
    expect(el.isModalOpen).toBe(true);
    expect(el.activeLayout).toBeNull();
  });

  it('hands a hash-path query to an alternative layout, which has no input to write to', async () => {
    const layout = registerLayout('palette');
    setUrl('#/search/tomato');

    const el = startWidget({ uiStyle: 'palette' });
    await el.initReady;

    expect(layout.setQuery).toHaveBeenCalledWith('tomato');
    expect(el.isModalOpen).toBe(true);
  });

  it('decodes a hash-path query the way a shared link encodes it', async () => {
    const layout = registerLayout('palette');
    setUrl('#/search/garden+beds');

    const el = startWidget({ uiStyle: 'palette' });
    await el.initReady;

    expect(layout.setQuery).toHaveBeenCalledWith('garden beds');
  });

  it('runs a ?s= query once, not twice', async () => {
    const queries = [];
    const layout = registerLayout('palette');
    setUrl('?s=tomato');

    const el = startWidget({ uiStyle: 'palette' });
    // A hit, so the zero-result path does not add a did-you-mean retry to the
    // count — the question here is how many times the query itself was run.
    el.typesenseClient = {
      collections: () => ({
        documents: () => ({
          search: async (params) => {
            queries.push(params.q);
            return { found: 1, hits: [{ document: { id: 'p1', title: 'Tomatoes', url: '/p/' } }] };
          }
        })
      })
    };
    await el.initReady;

    // Opening applies the URL query; handleInitialState used to apply it again,
    // costing a second identical request for the same search.
    expect(layout.setQuery).toHaveBeenCalledWith('tomato');
    expect(queries).toEqual(['tomato']);
  });
});
