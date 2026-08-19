import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('typesenseClientOptions', () => {
  it('defaults the connection timeout to 5s (the handshake needs more than 2s on a slow link)', () => {
    expect(mountWithConfig().typesenseClientOptions().connectionTimeoutSeconds).toBe(5);
  });

  it('honors a host-configured connectionTimeoutSeconds', () => {
    const options = mountWithConfig({ connectionTimeoutSeconds: 12 }).typesenseClientOptions();
    expect(options.connectionTimeoutSeconds).toBe(12);
  });

  it('falls back to the default for a non-positive or non-numeric timeout', () => {
    for (const connectionTimeoutSeconds of [0, -1, '8', null, NaN]) {
      const options = mountWithConfig({ connectionTimeoutSeconds }).typesenseClientOptions();
      expect(options.connectionTimeoutSeconds).toBe(5);
    }
  });

  it('passes numRetries and retryIntervalSeconds through when configured', () => {
    const options = mountWithConfig({ numRetries: 1, retryIntervalSeconds: 0.5 }).typesenseClientOptions();
    expect(options.numRetries).toBe(1);
    expect(options.retryIntervalSeconds).toBe(0.5);
  });

  it("omits the retry options entirely when unset, keeping typesense-js's own defaults", () => {
    const options = mountWithConfig().typesenseClientOptions();
    expect(options).not.toHaveProperty('numRetries');
    expect(options).not.toHaveProperty('retryIntervalSeconds');
  });

  it('ignores invalid retry options rather than disabling retries', () => {
    const options = mountWithConfig({ numRetries: -1, retryIntervalSeconds: '2' }).typesenseClientOptions();
    expect(options).not.toHaveProperty('numRetries');
    expect(options).not.toHaveProperty('retryIntervalSeconds');
  });

  it('carries the node list and search key', () => {
    const options = mountWithConfig().typesenseClientOptions();
    expect(options.nodes).toEqual([{ host: 'localhost', port: '8108', protocol: 'http' }]);
    expect(options.apiKey).toBe('search-only');
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

// A failed request must never render the empty state: telling a reader on a
// timing-out connection that nothing matched their query is what took four
// rounds of support email to unpick (issue #55).
describe('request failures', () => {
  const HIDDEN = 'mp-search-hidden';
  const clientRejecting = (error) => ({
    collections: () => ({ documents: () => ({ search: async () => { throw error; } }) })
  });
  const clientReturning = (hits) => ({
    collections: () => ({ documents: () => ({ search: async () => ({ found: hits.length, hits }) }) })
  });
  const hit = {
    document: { id: 'p1', title: 'Composting', url: 'https://x/p/', excerpt: 'How to', published_at: 1700000000000 }
  };

  let errorLog;
  beforeEach(() => {
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorLog.mockRestore();
  });

  it('shows the error state — not the empty state — when the request fails', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientRejecting(new Error('timeout of 5000ms exceeded'));

    await el.handleSearch('composting');

    expect(el.errorState.classList.contains(HIDDEN)).toBe(false);
    expect(el.emptyState.classList.contains(HIDDEN)).toBe(true);
    expect(el.loadingState.classList.contains(HIDDEN)).toBe(true);
    expect(el.hitsList.innerHTML).toBe('');
    expect(el.hitsList.classList.contains(HIDDEN)).toBe(true);
  });

  it('logs the underlying error so a broken connection is diagnosable', async () => {
    const el = mountWithConfig();
    const failure = new Error('ECONNABORTED timeout of 5000ms exceeded');
    el.typesenseClient = clientRejecting(failure);

    await el.handleSearch('composting');

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('MagicPagesSearch'), failure);
  });

  it('still shows the empty state for a query that genuinely matched nothing', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientReturning([]);

    await el.handleSearch('nothing matches this');

    expect(el.emptyState.classList.contains(HIDDEN)).toBe(false);
    expect(el.errorState.classList.contains(HIDDEN)).toBe(true);
  });

  it('clears the error state once a later search succeeds', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientRejecting(new Error('offline'));
    await el.handleSearch('composting');
    expect(el.errorState.classList.contains(HIDDEN)).toBe(false);

    el.typesenseClient = clientReturning([hit]);
    await el.handleSearch('composting');

    expect(el.errorState.classList.contains(HIDDEN)).toBe(true);
    expect(el.hitsList.classList.contains(HIDDEN)).toBe(false);
    expect(el.hitsList.innerHTML).toContain('Composting');
  });

  it('emits no analytics events for a request that never completed', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    global.fetch = fetchMock;
    const el = mountWithConfig({ analytics: { endpoint: 'https://e/queries', siteId: 's' } });
    el.typesenseClient = clientRejecting(new Error('timeout'));

    await el.handleSearch('composting');

    // Reporting a failure as a zero_result would poison the publisher's
    // "queries with no results" report.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes an alternative layout to renderError instead of its empty surface', async () => {
    const el = mountWithConfig({ uiStyle: 'discovery' });
    el.activeLayout = {
      renderLoading: vi.fn(),
      renderEmpty: vi.fn(),
      renderError: vi.fn(),
      renderResults: vi.fn(),
      renderFacets: vi.fn()
    };
    el.typesenseClient = clientRejecting(new Error('timeout'));

    await el.handleSearch('composting');

    expect(el.activeLayout.renderError).toHaveBeenCalledWith('composting');
    expect(el.activeLayout.renderEmpty).not.toHaveBeenCalled();
  });

  it('falls back to renderEmpty for a layout chunk that predates renderError', async () => {
    const el = mountWithConfig({ uiStyle: 'discovery' });
    el.activeLayout = {
      renderLoading: vi.fn(),
      renderEmpty: vi.fn(),
      renderResults: vi.fn(),
      renderFacets: vi.fn()
    };
    el.typesenseClient = clientRejecting(new Error('timeout'));

    await el.handleSearch('composting');

    expect(el.activeLayout.renderEmpty).toHaveBeenCalledWith('composting');
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

describe('highlight snippet selection', () => {
  // Regression for the body-only-match case: the term matched in the body
  // (plaintext) but not in the excerpt. The preview must show the highlighted
  // body snippet, not the (unhighlighted) raw excerpt that pre-empted it before.
  it('normalizeHit uses the body snippet when only plaintext matched', () => {
    const el = mountWithConfig();
    const hit = {
      document: {
        id: 'p1',
        title: 'A Field Guide to Garden Birds',
        excerpt: 'Spotting common backyard visitors through the seasons...',
        plaintext: 'my notes from the field, where I watch the goldfinch at the feeder'
      },
      highlight: {
        plaintext: {
          matched_tokens: ['goldfinch'],
          snippet: 'my notes from the field, where I watch the <mark>goldfinch</mark> at the'
        }
      }
    };
    const m = el.normalizeHit(hit, 0);
    expect(m.excerptHtml).toContain('<mark>goldfinch</mark>');
    expect(m.excerptHtml).not.toContain('Spotting common backyard');
  });

  it('normalizeHit prefers the excerpt snippet when the excerpt matched', () => {
    const el = mountWithConfig();
    const hit = {
      document: { id: 'p1', title: 'T', excerpt: 'A composting guide', plaintext: 'body text' },
      highlight: {
        excerpt: { matched_tokens: ['composting'], snippet: 'A <mark>composting</mark> guide' },
        plaintext: { matched_tokens: ['composting'], snippet: 'body <mark>composting</mark> text' }
      }
    };
    expect(el.normalizeHit(hit, 0).excerptHtml).toBe('A <mark>composting</mark> guide');
  });

  it('normalizeHit falls back to the raw excerpt when neither excerpt nor body matched', () => {
    const el = mountWithConfig();
    const hit = {
      document: { id: 'p1', title: 'Composting 101', excerpt: 'An intro to composting', plaintext: 'body' },
      highlight: { title: { matched_tokens: ['Composting'], snippet: '<mark>Composting</mark> 101' } }
    };
    const m = el.normalizeHit(hit, 0);
    expect(m.excerptHtml).toBe('An intro to composting');
    expect(m.excerptHtml).not.toContain('<mark>');
  });

  it('matchedSnippet ignores a field present without matched tokens', () => {
    const el = mountWithConfig();
    const hit = {
      highlight: {
        excerpt: { matched_tokens: [], snippet: 'echoed excerpt value' },
        plaintext: { matched_tokens: ['x'], snippet: 'body <mark>x</mark>' }
      }
    };
    expect(el.matchedSnippet(hit, 'excerpt')).toBeNull();
    expect(el.matchedSnippet(hit, 'plaintext')).toBe('body <mark>x</mark>');
  });

  it('matchedSnippet returns null when highlighting is disabled', () => {
    const el = mountWithConfig({ enableHighlighting: false });
    const hit = { highlight: { plaintext: { matched_tokens: ['x'], snippet: 'a <mark>x</mark> b' } } };
    expect(el.matchedSnippet(hit, 'plaintext')).toBeNull();
  });

  // The modal render path (results.hits.map) builds its excerpt with the same
  // matchedSnippet chain; cover it directly so it can't drift from normalizeHit.
  const clientReturning = (hits) => ({
    collections: () => ({ documents: () => ({ search: async () => ({ found: hits.length, hits }) }) })
  });

  it('modal path renders the body snippet when only plaintext matched', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientReturning([{
      document: {
        id: 'p1', title: 'A Field Guide to Garden Birds', url: 'https://x/p/',
        excerpt: 'Spotting common backyard visitors through the seasons',
        plaintext: 'I watch the goldfinch', published_at: 1700000000000
      },
      highlight: { plaintext: { matched_tokens: ['goldfinch'], snippet: 'I watch the <mark>goldfinch</mark>' } }
    }]);
    await el.handleSearch('goldfinch');
    const html = el.hitsList.innerHTML;
    expect(html).toContain('<mark>goldfinch</mark>');
    expect(html).not.toContain('Spotting common backyard');
  });

  it('modal path escapes the raw excerpt fallback when neither excerpt nor body matched', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientReturning([{
      document: {
        id: 'p1', title: 'Safe', url: 'https://x/p/',
        excerpt: '<img src=x onerror=alert(1)>', plaintext: 'body', published_at: 1700000000000
      },
      highlight: { title: { matched_tokens: ['Safe'], snippet: '<mark>Safe</mark>' } }
    }]);
    await el.handleSearch('Safe');
    const html = el.hitsList.innerHTML;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

// enableDidYouMean. The widget matches strictly (num_typos: 0) so results stay
// predictable, which leaves a mistyped query with nowhere to go. One typo-
// tolerant retry on a genuine miss turns that dead end into an offer.
describe('did you mean', () => {
  const HIDDEN = 'mp-search-hidden';

  const hit = (title) => ({
    document: { id: 'p1', title, url: 'https://x/p/', excerpt: 'e', published_at: 1700000000000 }
  });

  const matching = (...tokens) => ({
    ...hit('Composting'),
    highlight: { title: { matched_tokens: tokens, snippet: '' } }
  });

  // A backend that finds nothing as typed but matches `typoHits` once the
  // retry raises num_typos — the shape of a real misspelling.
  const clientTolerating = (typoHits, calls = []) => ({
    collections: () => ({
      documents: () => ({
        search: async (params) => {
          calls.push(params);
          const hits = Number(params.num_typos) > 0 ? typoHits : [];
          return { found: hits.length, hits };
        }
      })
    })
  });

  it('offers the term the index holds when the query matched nothing as typed', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([matching('composting')]);

    await el.handleSearch('compsting');

    expect(el.emptyState.classList.contains(HIDDEN)).toBe(false);
    expect(el.didYouMeanState.classList.contains(HIDDEN)).toBe(false);
    const button = el.didYouMeanState.querySelector('.mp-search-did-you-mean-btn');
    expect(button.dataset.search).toBe('composting');
    expect(button.textContent).toBe('Did you mean composting?');
  });

  it('costs exactly one extra request, and only on a genuine miss', async () => {
    const calls = [];
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([matching('composting')], calls);

    await el.handleSearch('compsting');

    expect(calls).toHaveLength(2);
    expect(calls[0].num_typos).toBe(0);
    expect(calls[1].num_typos).toBe(2);
    // The retry keeps every other parameter, so the suggestion respects the
    // publisher's filters and the reader's facet selection.
    expect(calls[1].query_by).toBe(calls[0].query_by);
  });

  it('does not retry a query that already returned results', async () => {
    const calls = [];
    const el = mountWithConfig();
    el.typesenseClient = {
      collections: () => ({
        documents: () => ({
          search: async (params) => {
            calls.push(params);
            return { found: 1, hits: [hit('Composting')] };
          }
        })
      })
    };

    await el.handleSearch('composting');

    expect(calls).toHaveLength(1);
    expect(el.didYouMeanState.innerHTML).toBe('');
  });

  it('skips the retry for a host that already searches with typo tolerance', async () => {
    // Their first request was the lenient one; repeating it would find the
    // same nothing at the cost of a second round trip.
    const calls = [];
    const el = mountWithConfig({ typesenseSearchParams: { num_typos: 1 } });
    el.typesenseClient = clientTolerating([matching('composting')], calls);

    await el.handleSearch('compsting');

    expect(calls).toHaveLength(1);
    expect(el.didYouMeanState.classList.contains(HIDDEN)).toBe(true);
  });

  it('skips the retry when the option is turned off', async () => {
    const calls = [];
    const el = mountWithConfig({ enableDidYouMean: false });
    el.typesenseClient = clientTolerating([matching('composting')], calls);

    await el.handleSearch('compsting');

    expect(calls).toHaveLength(1);
    expect(el.didYouMeanState.innerHTML).toBe('');
  });

  it('keeps the plain empty state when the retry also finds nothing', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([]);

    await el.handleSearch('nothing like this exists');

    expect(el.emptyState.classList.contains(HIDDEN)).toBe(false);
    expect(el.didYouMeanState.classList.contains(HIDDEN)).toBe(true);
    expect(el.errorState.classList.contains(HIDDEN)).toBe(true);
  });

  it('leaves the empty state alone when the retry itself fails', async () => {
    // A failed second request is not the reader's problem: they are already
    // looking at a valid empty result, and an error panel would contradict it.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = mountWithConfig();
    el.typesenseClient = {
      collections: () => ({
        documents: () => ({
          search: async (params) => {
            if (Number(params.num_typos) > 0) throw new Error('timeout');
            return { found: 0, hits: [] };
          }
        })
      })
    };

    await el.handleSearch('compsting');

    expect(el.emptyState.classList.contains(HIDDEN)).toBe(false);
    expect(el.errorState.classList.contains(HIDDEN)).toBe(true);
    expect(el.didYouMeanState.innerHTML).toBe('');
    errorLog.mockRestore();
  });

  it('drops a suggestion whose query the reader has already typed past', async () => {
    // The retry lands a request later than the search it belongs to. Bumping
    // the sequence stands in for that newer query having been issued meanwhile.
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([matching('composting')]);

    const pending = el.handleSearch('compsting');
    el.searchSequence += 1;
    await pending;

    expect(el.didYouMeanState.innerHTML).toBe('');
  });

  it('clears a previous suggestion before the next query can produce one', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([matching('composting')]);
    await el.handleSearch('compsting');
    expect(el.didYouMeanState.innerHTML).not.toBe('');

    el.typesenseClient = clientTolerating([]);
    await el.handleSearch('mulching techniques');

    expect(el.didYouMeanState.innerHTML).toBe('');
  });

  it('escapes a suggested term so an indexed value cannot inject markup', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([matching('"><img src=x onerror=alert(1)>')]);

    await el.handleSearch('"><img src=y onerror=alert(2)>');

    expect(el.didYouMeanState.innerHTML).not.toContain('<img');
  });

  it('runs the corrected search when the prompt is clicked', async () => {
    const el = mountWithConfig();
    el.typesenseClient = clientTolerating([matching('composting')]);
    el.initEventListeners();

    await el.handleSearch('compsting');
    el.didYouMeanState.querySelector('.mp-search-did-you-mean-btn').click();

    expect(el.searchInput.value).toBe('composting');
  });

  it('hands the suggestion to an alternative layout instead of the modal DOM', async () => {
    const el = mountWithConfig({ uiStyle: 'palette' });
    el.activeLayout = {
      renderLoading: vi.fn(),
      renderEmpty: vi.fn(),
      renderError: vi.fn(),
      renderResults: vi.fn(),
      renderFacets: vi.fn(),
      renderDidYouMean: vi.fn()
    };
    el.typesenseClient = clientTolerating([matching('composting')]);

    await el.handleSearch('compsting');

    expect(el.activeLayout.renderEmpty).toHaveBeenCalledWith('compsting');
    expect(el.activeLayout.renderDidYouMean).toHaveBeenCalledWith('composting');
  });

  it('leaves a layout chunk that predates the prompt with its plain empty surface', async () => {
    const el = mountWithConfig({ uiStyle: 'palette' });
    el.activeLayout = {
      renderLoading: vi.fn(),
      renderEmpty: vi.fn(),
      renderError: vi.fn(),
      renderResults: vi.fn(),
      renderFacets: vi.fn()
    };
    el.typesenseClient = clientTolerating([matching('composting')]);

    await el.handleSearch('compsting');

    expect(el.activeLayout.renderEmpty).toHaveBeenCalledWith('compsting');
    expect(el.activeLayout.renderError).not.toHaveBeenCalled();
  });
});

// Two searches can be in flight at once — the 80ms debounce narrows the window
// but does not close it. Whichever request returns last used to win the surface,
// so a slow early query could repaint over the results of the query the reader
// is actually looking at.
describe('superseded searches', () => {
  const HIDDEN = 'mp-search-hidden';

  const hit = {
    document: { id: 'p1', title: 'Composting', url: 'https://x/p/', excerpt: 'How to', published_at: 1700000000000 }
  };

  // A backend whose per-query responses resolve when the test says so.
  const deferredClient = (responders) => ({
    collections: () => ({
      documents: () => ({
        search: (params) => responders[params.q]()
      })
    })
  });

  const deferred = () => {
    let settle;
    const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    return { promise, ...settle };
  };

  it('does not let an earlier empty response wipe the newer query\'s results', async () => {
    const slow = deferred();
    const el = mountWithConfig();
    el.typesenseClient = deferredClient({
      compost: () => slow.promise,
      composting: () => Promise.resolve({ found: 1, hits: [hit] })
    });

    const first = el.handleSearch('compost');
    await el.handleSearch('composting');
    expect(el.hitsList.innerHTML).toContain('Composting');

    slow.resolve({ found: 0, hits: [] });
    await first;

    expect(el.hitsList.classList.contains(HIDDEN)).toBe(false);
    expect(el.hitsList.innerHTML).toContain('Composting');
    expect(el.emptyState.classList.contains(HIDDEN)).toBe(true);
  });

  it('does not let an earlier failure raise the error state over newer results', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const slow = deferred();
    const el = mountWithConfig();
    el.typesenseClient = deferredClient({
      compost: () => slow.promise,
      composting: () => Promise.resolve({ found: 1, hits: [hit] })
    });

    const first = el.handleSearch('compost');
    await el.handleSearch('composting');

    slow.reject(new Error('timeout'));
    await first;

    expect(el.errorState.classList.contains(HIDDEN)).toBe(true);
    expect(el.hitsList.innerHTML).toContain('Composting');
    // The failure is still logged — a broken connection is worth a trace even
    // when its query has been typed past.
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('attributes clicks and analytics to the query actually on screen', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    global.fetch = fetchMock;
    const slow = deferred();
    const el = mountWithConfig({ analytics: { endpoint: 'https://e/queries', siteId: 's' } });
    el.typesenseClient = deferredClient({
      compost: () => slow.promise,
      composting: () => Promise.resolve({ found: 1, hits: [hit] })
    });

    const first = el.handleSearch('compost');
    await el.handleSearch('composting');
    slow.resolve({ found: 4, hits: [hit] });
    await first;

    expect(el.lastQuery).toBe('composting');
    const queries = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).q);
    expect(queries).not.toContain('compost');
  });

  it('keeps the same guard on the alternative-layout path', async () => {
    const slow = deferred();
    const el = mountWithConfig({ uiStyle: 'discovery' });
    el.activeLayout = {
      renderLoading: vi.fn(),
      renderEmpty: vi.fn(),
      renderError: vi.fn(),
      renderResults: vi.fn(),
      renderFacets: vi.fn()
    };
    el.typesenseClient = deferredClient({
      compost: () => slow.promise,
      composting: () => Promise.resolve({ found: 1, hits: [hit] })
    });

    const first = el.handleSearch('compost');
    await el.handleSearch('composting');
    slow.resolve({ found: 0, hits: [] });
    await first;

    expect(el.activeLayout.renderResults).toHaveBeenCalledTimes(1);
    expect(el.activeLayout.renderEmpty).not.toHaveBeenCalled();
  });
});

// The prompt's wording is a translation from the site's own config. Its text is
// escaped like any other string; only the wrapper around the suggested term is
// markup — the same contract in all three layouts.
describe('did-you-mean label contract', () => {
  const matching = (...tokens) => ({
    document: { id: 'p1', title: 'Composting', url: 'https://x/p/', excerpt: 'e', published_at: 1700000000000 },
    highlight: { title: { matched_tokens: tokens, snippet: '' } }
  });

  const clientTolerating = (typoHits) => ({
    collections: () => ({
      documents: () => ({
        search: async (params) => {
          const hits = Number(params.num_typos) > 0 ? typoHits : [];
          return { found: hits.length, hits };
        }
      })
    })
  });

  it('substitutes {q} in a translated label', async () => {
    const el = mountWithConfig();
    el.i18n = { ...el.defaultI18n, didYouMeanLabel: 'Meintest du {q}?' };
    el.typesenseClient = clientTolerating([matching('composting')]);

    await el.handleSearch('compsting');

    const button = el.didYouMeanState.querySelector('.mp-search-did-you-mean-btn');
    expect(button.textContent).toBe('Meintest du composting?');
    expect(button.querySelector('.mp-search-did-you-mean-term').textContent).toBe('composting');
  });

  it('renders a label containing markup as text, never as markup', async () => {
    const el = mountWithConfig();
    el.i18n = { ...el.defaultI18n, didYouMeanLabel: '<img src=x onerror=alert(1)> {q}?' };
    el.typesenseClient = clientTolerating([matching('composting')]);

    await el.handleSearch('compsting');

    expect(el.didYouMeanState.querySelector('img')).toBeNull();
    expect(el.didYouMeanState.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// Typesense returns facet values by count descending, so a cap always drops the
// least common ones. A value that exists on the current results but falls
// outside it used to be simply absent — indistinguishable, to a reader, from a
// topic the archive does not cover.
describe('facet truncation', () => {
  const facetConfig = (limit) => ({
    facets: [{ field: 'tags.name', label: 'Topics', limit }]
  });

  const countsFor = (n) =>
    Array.from({ length: n }, (_, i) => ({ value: `Tag ${i + 1}`, count: n - i }));

  const render = (el, counts) => {
    el.renderFacets([{ field_name: 'tags.name', counts }]);
    return {
      chips: [...el.facetsContainer.querySelectorAll('.mp-search-facet-chip')],
      more: el.facetsContainer.querySelector('.mp-search-facet-more')
    };
  };

  it('asks for one more value than it will show, so a cut list is detectable', () => {
    const el = mountWithConfig(facetConfig(10));
    expect(el.getSearchParameters().max_facet_values).toBe(11);
  });

  it('sizes the request by the largest facet, since the parameter is global', () => {
    const el = mountWithConfig({
      facets: [
        { field: 'tags.name', label: 'Topics', limit: 5 },
        { field: 'authors', label: 'Authors', limit: 12 }
      ]
    });
    expect(el.getSearchParameters().max_facet_values).toBe(13);
  });

  it('shows only the configured limit, not everything the response carried', () => {
    // The smaller facet receives the larger facet's allowance; its own limit is
    // what governs the list a reader sees.
    const el = mountWithConfig(facetConfig(3));
    const { chips } = render(el, countsFor(11));

    expect(chips).toHaveLength(3);
    expect(chips.map(c => c.dataset.facetValue)).toEqual(['Tag 1', 'Tag 2', 'Tag 3']);
  });

  it('offers the rest when the response held more than the limit', () => {
    const el = mountWithConfig(facetConfig(3));
    const { more } = render(el, countsFor(4));

    expect(more).not.toBeNull();
    expect(more.textContent.trim()).toBe('Show more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    // The control points at the list it expands.
    expect(el.facetsContainer.querySelector(`#${more.getAttribute('aria-controls')}`)).not.toBeNull();
  });

  it('stays silent when the whole list fits', () => {
    const el = mountWithConfig(facetConfig(3));
    const { chips, more } = render(el, countsFor(3));

    expect(chips).toHaveLength(3);
    expect(more).toBeNull();
  });

  it('raises the cap and re-runs the query when the reader asks for more', async () => {
    const calls = [];
    const el = mountWithConfig(facetConfig(3));
    el.typesenseClient = {
      collections: () => ({
        documents: () => ({
          search: async (params) => {
            calls.push(params);
            return { found: 0, hits: [], facet_counts: [] };
          }
        })
      })
    };
    el.initEventListeners();
    el.searchInput.value = 'ghost';
    render(el, countsFor(4));

    el.facetsContainer.querySelector('.mp-search-facet-more').click();
    await Promise.resolve();

    expect(el.expandedFacets['tags.name']).toBe(43);
    expect(calls.at(-1).max_facet_values).toBe(44);
  });

  it('shows the wider list and a way back once expanded', () => {
    const el = mountWithConfig(facetConfig(3));
    el.expandFacet('tags.name');
    const { chips, more } = render(el, countsFor(11));

    expect(chips).toHaveLength(11);
    expect(more.textContent.trim()).toBe('Show less');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.dataset.facetExpand).toBe('less');
  });

  it('keeps offering more while values remain beyond the raised cap', () => {
    const el = mountWithConfig(facetConfig(3));
    el.expandFacet('tags.name');
    const { more } = render(el, countsFor(60));

    expect(more.textContent.trim()).toBe('Show more');
    el.expandFacet('tags.name');
    expect(el.expandedFacets['tags.name']).toBe(83);
  });

  it('collapses back to the publisher\'s limit', () => {
    const el = mountWithConfig(facetConfig(3));
    el.expandFacet('tags.name');
    el.collapseFacet('tags.name');

    expect(render(el, countsFor(11)).chips).toHaveLength(3);
    expect(el.getSearchParameters().max_facet_values).toBe(4);
  });

  it('keeps a selected value visible even when it ranks below the cap', () => {
    // Otherwise the only way out of that filter is Clear filters — the chip
    // that switched it on would have vanished.
    const el = mountWithConfig(facetConfig(3));
    el.selectedFacets = { 'tags.name': new Set(['Tag 9']) };
    const { chips } = render(el, countsFor(11));

    const values = chips.map(c => c.dataset.facetValue);
    expect(values).toContain('Tag 9');
    expect(values.slice(0, 3)).toEqual(['Tag 1', 'Tag 2', 'Tag 3']);
    expect([...chips].find(c => c.dataset.facetValue === 'Tag 9').getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to the default limit for a missing or nonsensical one', () => {
    for (const limit of [undefined, 0, -4, 'ten', NaN]) {
      const el = mountWithConfig(facetConfig(limit));
      expect(render(el, countsFor(20)).chips).toHaveLength(10);
    }
  });

  it('collapses expanded facets when the modal closes', () => {
    const el = mountWithConfig(facetConfig(3));
    el.expandFacet('tags.name');
    el.isModalOpen = true;
    el.closeModal();

    expect(el.expandedFacets).toEqual({});
  });
});
