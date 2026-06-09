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

describe('getSearchParameters — semantic search', () => {
  it('appends the embedding field to query_by when enabled', () => {
    const params = mountWithConfig({ semanticSearch: true }).getSearchParameters();
    expect(params.query_by.split(',')).toContain('embedding');
  });

  it('keeps query_by_weights the same length as query_by (Typesense requires it)', () => {
    const params = mountWithConfig({ semanticSearch: true }).getSearchParameters();
    expect(params.query_by_weights.split(',').length).toBe(params.query_by.split(',').length);
  });

  it('respects a custom embeddingFieldName', () => {
    const params = mountWithConfig({ semanticSearch: true, embeddingFieldName: 'vec' }).getSearchParameters();
    expect(params.query_by.split(',')).toContain('vec');
  });

  it('does not touch query_by when disabled', () => {
    const params = mountWithConfig().getSearchParameters();
    expect(params.query_by.split(',')).not.toContain('embedding');
  });

  it('emits a keyword-favoring vector_query (low alpha + distance threshold) when enabled', () => {
    const params = mountWithConfig({ semanticSearch: true }).getSearchParameters();
    expect(params.vector_query).toMatch(/^embedding:\(\[\], alpha: 0\.2, distance_threshold: 0\.8\)$/);
  });

  it('honors custom semanticAlpha / semanticDistanceThreshold', () => {
    const params = mountWithConfig({
      semanticSearch: true,
      semanticAlpha: 0.5,
      semanticDistanceThreshold: 0.4
    }).getSearchParameters();
    expect(params.vector_query).toContain('alpha: 0.5');
    expect(params.vector_query).toContain('distance_threshold: 0.4');
  });

  it('does not set vector_query when semantic search is disabled', () => {
    expect(mountWithConfig().getSearchParameters().vector_query).toBeUndefined();
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

  it('does not add id to include_fields when analytics is disabled', () => {
    const el = mountWithConfig({
      typesenseSearchParams: { include_fields: 'title,url' }
    });
    expect(el.getSearchParameters().include_fields.split(',')).not.toContain('id');
  });
});

describe('getSearchParameters — visibility include_fields', () => {
  it('preserves visibility when a host overrides include_fields (for the gated badge)', () => {
    const el = mountWithConfig({
      typesenseSearchParams: { include_fields: 'title,url' }
    });
    expect(el.getSearchParameters().include_fields.split(',')).toContain('visibility');
  });

  it('keeps visibility in the default include_fields', () => {
    const el = mountWithConfig();
    expect(el.getSearchParameters().include_fields.split(',')).toContain('visibility');
  });
});

describe('analytics events', () => {
  let fetchMock;
  let beacon;
  beforeEach(() => {
    // fetch(keepalive) is the preferred transport (Beacon API is blocked by
    // content blockers). sendBeacon stays mocked so we can assert it is NOT
    // used while fetch is available.
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    global.fetch = fetchMock;
    beacon = vi.fn(() => true);
    navigator.sendBeacon = beacon;
  });

  it('emits one search event for a settled query and dedupes a repeat', () => {
    const el = mountWithConfig({ analytics: { endpoint: 'https://e/queries', siteId: 's' } });

    el.trackSearch('ghost', 3);
    el.trackSearch('ghost', 3); // same query → suppressed by lastTrackedQuery
    el.trackSearch('themes', 0); // new query, zero results → search + zero_result

    // ghost(search) + themes(search) + themes(zero_result) = 3 events; the
    // repeated "ghost" call emits nothing.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('prefers fetch(keepalive) over sendBeacon as the transport', () => {
    const el = mountWithConfig({ analytics: { endpoint: 'https://e/queries', siteId: 's' } });

    el.trackSearch('ghost', 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(beacon).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://e/queries');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
  });

  it('emits nothing when analytics is not configured', () => {
    const el = mountWithConfig();
    el.trackSearch('ghost', 3);
    expect(fetchMock).not.toHaveBeenCalled();
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

// Parse a markup string into an element for structural assertions.
function parse(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  return wrap;
}

describe('result templates', () => {
  it('renders the list item with a title and excerpt (default layout)', () => {
    const el = mountWithConfig();
    const dom = parse(el.renderListItem('My title', 'An excerpt'));

    expect(dom.querySelector('.mp-search-result-title').textContent).toContain('My title');
    expect(dom.querySelector('.mp-search-result-excerpt').textContent).toContain('An excerpt');
    // No card-specific markup in list mode.
    expect(dom.querySelector('.mp-search-card-image')).toBeNull();
  });

  it('renders a grid card with image, title, excerpt and tags', () => {
    const el = mountWithConfig({ template: 'grid' });
    const hit = {
      document: {
        id: 'p1',
        title: 'Tomatoes',
        feature_image: 'https://cdn.example.com/t.jpg',
        tags: ['Garden', 'How To', 'Spring', 'Extra']
      }
    };
    const dom = parse(el.renderGridCard(hit, 'Tomatoes', 'Grow them'));

    const img = dom.querySelector('img.mp-search-card-image');
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/t.jpg');
    expect(img.getAttribute('alt')).toBe(''); // decorative; link carries the label
    expect(dom.querySelector('.mp-search-result-title').textContent).toContain('Tomatoes');
    expect(dom.querySelector('.mp-search-result-excerpt').textContent).toContain('Grow them');

    // Tags are capped at three.
    const tags = dom.querySelectorAll('.mp-search-card-tag');
    expect([...tags].map(t => t.textContent)).toEqual(['Garden', 'How To', 'Spring']);
  });

  it('shows a placeholder instead of a broken image when feature_image is absent', () => {
    const el = mountWithConfig({ template: 'grid' });
    const dom = parse(el.renderGridCard({ document: { id: 'p1', tags: [] } }, 'Untitled', ''));

    expect(dom.querySelector('img.mp-search-card-image')).toBeNull();
    expect(dom.querySelector('.mp-search-card-image-empty')).not.toBeNull();
  });

  it('escapes a malicious feature_image url', () => {
    const el = mountWithConfig({ template: 'grid' });
    const html = el.renderGridCard(
      { document: { id: 'p1', feature_image: '"><script>alert(1)</script>', tags: [] } },
      'T',
      ''
    );
    expect(html).not.toContain('<script>');
  });

  it('requests feature_image and authors for the refined modal (list and grid)', () => {
    // The refined modal shows a thumbnail + author in both list and grid rows,
    // so both fields are always requested.
    const listFields = mountWithConfig().getSearchParameters().include_fields;
    expect(listFields).toContain('feature_image');
    expect(listFields).toContain('authors');
    const gridFields = mountWithConfig({ template: 'grid' }).getSearchParameters().include_fields;
    expect(gridFields).toContain('feature_image');
    expect(gridFields).toContain('authors');
  });
});
