import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../search.js';

// Build an element with shadow content rendered, but without going through
// connectedCallback (whose one-time `isInitialized` guard would block repeated
// construction). We set config explicitly and run the same setup steps init()
// would: render the shadow DOM and cache element references.
function mountWithConfig(config = {}) {
  const el = document.createElement('magicpages-search');
  el.config = {
    typesenseNodes: [{ host: 'localhost', port: '8108', protocol: 'http' }],
    typesenseApiKey: 'search-only',
    collectionName: 'ghost',
    commonSearches: [],
    pinnedSearches: [],
    facets: [],
    enableHighlighting: true,
    searchFields: {
      title: { weight: 5, highlight: true },
      excerpt: { weight: 3, highlight: true },
      plaintext: { weight: 4, highlight: true }
    },
    ...config
  };
  el.i18n = el.defaultI18n;
  el.selectedFacets = {};
  el.fetchedSuggestions = [];
  el.createShadowContent();
  el.cacheElements();
  return el;
}

describe('getSearchParameters — lexical baseline', () => {
  it('produces the default lexical query with no opt-in features configured', () => {
    const el = mountWithConfig();
    const params = el.getSearchParameters();

    expect(params.query_by).toBe('title,excerpt,plaintext');
    expect(params.facet_by).toBeUndefined();
    expect(params.filter_by).toBeUndefined();
    expect(params.per_page).toBe(20);
  });
});

describe('getSearchParameters — facets', () => {
  const facetConfig = {
    facets: [
      { field: 'tags.name', label: 'Topics', limit: 10 },
      { field: 'authors', label: 'Authors', limit: 5 }
    ]
  };

  it('requests facet_by for the configured fields', () => {
    const el = mountWithConfig(facetConfig);
    expect(el.getSearchParameters().facet_by).toBe('tags.name,authors');
  });

  it('composes selected facets into filter_by, preserving a publisher filter', () => {
    const el = mountWithConfig({
      ...facetConfig,
      typesenseSearchParams: { filter_by: 'published_at:>0' }
    });
    el.selectedFacets = { 'tags.name': new Set(['Ghost']) };

    expect(el.getSearchParameters().filter_by).toBe('(published_at:>0) && (tags.name:=[`Ghost`])');
  });

  it('omits filter_by entirely when no facet is selected and no publisher filter is set', () => {
    const el = mountWithConfig(facetConfig);
    expect(el.getSearchParameters().filter_by).toBeUndefined();
  });
});

describe('getSearchParameters — analytics include_fields', () => {
  it('re-adds id to include_fields when analytics is enabled and a host omitted it', () => {
    const el = mountWithConfig({
      analytics: { endpoint: 'https://example.com/collect' },
      typesenseSearchParams: { include_fields: 'title,url' }
    });
    const fields = el.getSearchParameters().include_fields.split(',');
    expect(fields).toContain('id');
  });

  it('does not touch include_fields when analytics is disabled', () => {
    const el = mountWithConfig({
      typesenseSearchParams: { include_fields: 'title,url' }
    });
    expect(el.getSearchParameters().include_fields).toBe('title,url');
  });
});

describe('analytics events', () => {
  let beacon;
  beforeEach(() => {
    beacon = vi.fn(() => true);
    navigator.sendBeacon = beacon;
  });

  it('emits one search event for a settled query and dedupes a repeat', () => {
    const el = mountWithConfig({ analytics: { endpoint: 'https://e/collect', siteId: 's' } });

    el.trackSearch('ghost', 3);
    el.trackSearch('ghost', 3); // same query → suppressed by lastTrackedQuery
    el.trackSearch('themes', 0); // new query, zero results → search + zero_result

    // ghost(search) + themes(search) + themes(zero_result) = 3 beacons; the
    // repeated "ghost" call emits nothing.
    expect(beacon).toHaveBeenCalledTimes(3);
  });

  it('emits nothing when analytics is not configured', () => {
    const el = mountWithConfig();
    el.trackSearch('ghost', 3);
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe('suggestions fetching', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a bare string array from suggestionsUrl', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['alpha', 'beta']
    });
    const el = mountWithConfig({ suggestionsUrl: 'https://e/suggest' });
    await el.fetchSuggestions();
    expect(el.fetchedSuggestions).toEqual(['alpha', 'beta']);
  });

  it('accepts a { suggestions: [...] } object', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: ['gamma'] })
    });
    const el = mountWithConfig({ suggestionsUrl: 'https://e/suggest' });
    await el.fetchSuggestions();
    expect(el.fetchedSuggestions).toEqual(['gamma']);
  });

  it('falls back silently on a failed fetch and does not retry within the session', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    global.fetch = fetchMock;
    const el = mountWithConfig({
      suggestionsUrl: 'https://e/suggest',
      commonSearches: ['fallback']
    });

    await el.fetchSuggestions();
    expect(el.fetchedSuggestions).toEqual([]);
    expect(el.getSuggestions()).toEqual(['fallback']);

    await el.fetchSuggestions(); // session cache: no second request
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when no suggestionsUrl is configured', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const el = mountWithConfig();
    await el.fetchSuggestions();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('facet rendering', () => {
  it('renders chips with counts and marks selected values aria-pressed', () => {
    const el = mountWithConfig({
      facets: [{ field: 'tags.name', label: 'Topics' }]
    });
    el.selectedFacets = { 'tags.name': new Set(['Ghost']) };

    el.renderFacets([
      { field_name: 'tags.name', counts: [
        { value: 'Ghost', count: 4 },
        { value: 'Themes', count: 2 }
      ] }
    ]);

    const chips = el.facetsContainer.querySelectorAll('.mp-search-facet-chip');
    expect(chips).toHaveLength(2);

    const ghost = [...chips].find(c => c.dataset.facetValue === 'Ghost');
    expect(ghost.getAttribute('aria-pressed')).toBe('true');
    expect(ghost.querySelector('.mp-search-facet-chip-count').textContent).toBe('4');

    const themes = [...chips].find(c => c.dataset.facetValue === 'Themes');
    expect(themes.getAttribute('aria-pressed')).toBe('false');

    // A clear-all control appears when something is selected.
    expect(el.facetsContainer.querySelector('.mp-search-facet-clear')).not.toBeNull();
  });

  it('hides the facet container when no counts are returned', () => {
    const el = mountWithConfig({ facets: [{ field: 'tags.name' }] });
    el.renderFacets([]);
    expect(el.facetsContainer.classList.contains('mp-search-hidden')).toBe(true);
  });
});
