import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../search.js';

// The author profiles option (`showAuthorProfiles`): Ghost's author list is
// fetched once, matched locally, and rendered as an Authors group above the
// modal's posts. Every test here passes the key and admin URL through the
// config overrides; picking them up from Ghost's script tag is covered in
// authors-init.test.js, which needs a fresh module.

const AUTHORS = [
  { id: 'a1', slug: 'jane', name: 'Jane Doe', url: 'https://demo.example.com/author/jane/', profile_image: 'https://demo.example.com/content/images/jane.png' },
  { id: 'a2', slug: 'jose', name: 'José Álvarez', url: 'https://demo.example.com/team/jose/', profile_image: null },
  { id: 'a3', slug: 'janet', name: 'Janet Smith', url: 'https://demo.example.com/author/janet/', profile_image: null },
  { id: 'a4', slug: 'jan', name: 'Jan Novak', url: 'https://demo.example.com/author/jan/', profile_image: null },
  { id: 'a5', slug: 'janine', name: 'Janine Ray', url: 'https://demo.example.com/author/janine/', profile_image: null }
];

const SOURCE = { ghostContentApiKey: 'content-key', ghostUrl: 'https://admin.example.com/' };

let mounted = [];

function mount(config = {}) {
  const el = document.createElement('magicpages-search');
  el.config = {
    typesenseNodes: [{ host: 'localhost', port: '8108', protocol: 'http' }],
    typesenseApiKey: 'search-only',
    collectionName: 'ghost',
    commonSearches: [],
    pinnedSearches: [],
    facets: [],
    enableHighlighting: true,
    searchFields: { title: { weight: 5, highlight: true } },
    ...config
  };
  el.i18n = el.defaultI18n;
  el.selectedFacets = {};
  el.fetchedSuggestions = [];
  el.createShadowContent();
  el.cacheElements();
  el.typesenseClient = {
    collections: () => ({ documents: () => ({ search: async () => ({ found: 0, hits: [] }) }) })
  };
  el.markSurfaceReady();
  mounted.push(el);
  return el;
}

function respondWith(body, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Load the list as a first open would, and wait for the request to settle.
async function loaded(el) {
  el.loadAuthorProfiles();
  await el.authorProfilesLoad;
  return el;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  for (const el of mounted) {
    if (el.isModalOpen) el.closeModal();
  }
  mounted = [];
  vi.unstubAllGlobals();
  history.replaceState(null, '', window.location.pathname);
});

describe('author profiles — off by default', () => {
  it('makes no request when the option is off, even with a key', async () => {
    const fetchMock = respondWith({ authors: AUTHORS });
    const el = mount(SOURCE);

    await el.openModal();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the modal exactly as before: no Authors container, nothing for a name query', async () => {
    respondWith({ authors: AUTHORS });
    const el = mount(SOURCE);
    el.authorProfiles = AUTHORS;

    expect(el.shadowRoot.querySelector('#mp-search-authors')).toBeNull();
    await el.handleSearch('jane');
    expect(el.shadowRoot.querySelector('.mp-search-author-link')).toBeNull();
    expect(el.matchAuthorProfiles('jane')).toEqual([]);
  });

  it('makes no request when on but no key is available', async () => {
    const fetchMock = respondWith({ authors: AUTHORS });
    const el = mount({ showAuthorProfiles: true });

    await el.openModal();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('author profiles — loading', () => {
  it('waits for the first open, then asks Ghost’s author search index', async () => {
    const fetchMock = respondWith({ authors: AUTHORS });
    const el = mount({ showAuthorProfiles: true, ...SOURCE });
    expect(fetchMock).not.toHaveBeenCalled();

    await el.openModal();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://admin.example.com/ghost/api/content/search-index/authors/?key=content-key');
  });

  it('fetches once per page session: reopening and typing reuse the list', async () => {
    const fetchMock = respondWith({ authors: AUTHORS });
    const el = mount({ showAuthorProfiles: true, ...SOURCE });

    await el.openModal();
    await el.authorProfilesLoad;
    el.closeModal();
    await el.openModal();
    await el.handleSearch('jane');
    await el.handleSearch('jose');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a later page view from sessionStorage without a request', async () => {
    respondWith({ authors: AUTHORS });
    await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));

    const fetchMock = respondWith({ authors: [] });
    const next = mount({ showAuthorProfiles: true, ...SOURCE });
    next.loadAuthorProfiles();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(next.matchAuthorProfiles('doe').map(a => a.name)).toEqual(['Jane Doe']);
  });

  it('keeps the cache per admin URL', async () => {
    respondWith({ authors: AUTHORS });
    await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));

    const fetchMock = respondWith({ authors: [] });
    await loaded(mount({ showAuthorProfiles: true, ghostContentApiKey: 'k', ghostUrl: 'https://other.example.com' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the authors for a query typed before the list arrived', async () => {
    let release;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ authors: AUTHORS }) });
    })));
    const el = mount({ showAuthorProfiles: true, ...SOURCE });

    await el.openModal();
    el.searchInput.value = 'jose';
    await el.handleSearch('jose');
    expect(el.shadowRoot.querySelector('.mp-search-author-link')).toBeNull();

    release();
    await el.authorProfilesLoad;

    const names = el.shadowRoot.querySelectorAll('.mp-search-author-link .mp-search-author-name');
    expect([...names].map(n => n.textContent)).toEqual(['José Álvarez']);
  });
});

describe('author profiles — failure', () => {
  it.each([
    ['a failed request', () => vi.fn(async () => { throw new TypeError('Failed to fetch'); })],
    ['a non-2xx response', () => vi.fn(async () => ({ ok: false, json: async () => ({}) }))],
    ['an unexpected body', () => vi.fn(async () => ({ ok: true, json: async () => ({ posts: [] }) }))],
    ['invalid JSON', () => vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }))]
  ])('leaves the section out, posts unaffected, after %s', async (_label, makeFetch) => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const el = mount({ showAuthorProfiles: true, ...SOURCE });
    el.typesenseClient = {
      collections: () => ({ documents: () => ({ search: async () => ({
        found: 1,
        hits: [{ document: { id: 'p1', title: 'Jane’s garden', url: 'https://demo.example.com/p1/' } }]
      }) }) })
    };

    await el.openModal();
    await el.authorProfilesLoad;
    await el.handleSearch('jane');
    await el.handleSearch('janet');

    expect(el.shadowRoot.querySelector('#mp-search-authors').classList.contains('mp-search-hidden')).toBe(true);
    expect(el.shadowRoot.querySelectorAll('.mp-search-result-link')).toHaveLength(1);
    expect(el.errorState.classList.contains('mp-search-hidden')).toBe(true);
    // Not retried on every keystroke.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('author profiles — matching', () => {
  async function matcher() {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));
    return (q) => el.matchAuthorProfiles(q).map(a => a.name);
  }

  it('matches a prefix of any word of the name, case-insensitively', async () => {
    const match = await matcher();
    expect(match('DOE')).toEqual(['Jane Doe']);
    expect(match('smi')).toEqual(['Janet Smith']);
  });

  it('does not match inside a word', async () => {
    const match = await matcher();
    expect(match('oe')).toEqual([]);
    expect(match('mith')).toEqual([]);
  });

  it('ignores accents on either side', async () => {
    const match = await matcher();
    expect(match('jose')).toEqual(['José Álvarez']);
    expect(match('alv')).toEqual(['José Álvarez']);
    expect(match('JOSÉ')).toEqual(['José Álvarez']);
  });

  it('needs at least two characters', async () => {
    const match = await matcher();
    expect(match('j')).toEqual([]);
    expect(match(' j ')).toEqual([]);
    expect(match('do')).toEqual(['Jane Doe']);
  });

  it('shows at most three authors, in Ghost’s order', async () => {
    const match = await matcher();
    expect(match('jan')).toEqual(['Jane Doe', 'Janet Smith', 'Jan Novak']);
  });

  it('matches a multi-word query when every word starts a word of the name', async () => {
    const match = await matcher();
    expect(match('jane doe')).toEqual(['Jane Doe']);
    expect(match('doe ja')).toEqual(['Jane Doe']);
    expect(match('jane novak')).toEqual([]);
  });
});

describe('author profiles — modal rendering', () => {
  it('renders the Authors group above the posts, linking to each profile URL', async () => {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));

    await el.handleSearch('jose');

    const group = el.shadowRoot.querySelector('#mp-search-authors');
    expect(group.classList.contains('mp-search-hidden')).toBe(false);
    expect(group.getAttribute('aria-label')).toBe('Authors');
    expect(group.compareDocumentPosition(el.hitsList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const link = group.querySelector('.mp-search-author-link');
    // Custom routes come through as Ghost reports them.
    expect(link.getAttribute('href')).toBe('https://demo.example.com/team/jose/');
  });

  it('renders the group in the grid template too', async () => {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, template: 'grid', ...SOURCE }));

    await el.handleSearch('doe');

    expect(el.shadowRoot.querySelectorAll('.mp-search-author-link')).toHaveLength(1);
  });

  it('uses the avatar when there is one and the initial otherwise', async () => {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));

    await el.handleSearch('jane');
    const img = el.shadowRoot.querySelector('.mp-search-author-link img.mp-search-author-avatar');
    expect(img.getAttribute('src')).toBe('https://demo.example.com/content/images/jane.png');

    await el.handleSearch('jose');
    const fallback = el.shadowRoot.querySelector('.mp-search-author-avatar-empty');
    expect(fallback.textContent).toBe('J');
    expect(el.shadowRoot.querySelector('.mp-search-author-link img')).toBeNull();
  });

  it('follows transformToRelativeUrls like post links do', async () => {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, transformToRelativeUrls: true, ...SOURCE }));

    await el.handleSearch('doe');

    expect(el.shadowRoot.querySelector('.mp-search-author-link').getAttribute('href')).toBe('/author/jane/');
  });

  it('escapes names, URLs and image URLs', async () => {
    respondWith({ authors: [{
      id: 'x',
      slug: 'x',
      name: 'Eve <img src=x onerror=alert(1)>',
      url: 'https://demo.example.com/author/eve/" onmouseover="alert(1)',
      profile_image: 'https://demo.example.com/e.png" onerror="alert(1)'
    }] });
    const el = await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));

    await el.handleSearch('eve');

    const group = el.shadowRoot.querySelector('#mp-search-authors');
    expect(group.querySelector('[onerror], [onmouseover]')).toBeNull();
    expect(group.querySelectorAll('img')).toHaveLength(1);
    const link = group.querySelector('.mp-search-author-link');
    expect(link.textContent).toContain('Eve <img src=x onerror=alert(1)>');
    expect(link.getAttribute('href')).toBe('https://demo.example.com/author/eve/" onmouseover="alert(1)');
  });

  it('hides the group again when the query is cleared', async () => {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));

    await el.handleSearch('jane');
    await el.handleSearch('');

    const group = el.shadowRoot.querySelector('#mp-search-authors');
    expect(group.classList.contains('mp-search-hidden')).toBe(true);
    expect(group.innerHTML).toBe('');
  });
});

describe('author profiles — modal keyboard', () => {
  // jsdom does no layout, so offsetParent is always null and the modal would
  // consider nothing visible. Treat attached elements as laid out.
  let restore;
  beforeEach(() => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() { return this.parentNode; }
    });
    restore = () => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
      else delete HTMLElement.prototype.offsetParent;
    };
  });
  afterEach(() => restore());

  it('puts author links first in arrow-key order and opens them with Enter', async () => {
    respondWith({ authors: AUTHORS });
    const el = await loaded(mount({ showAuthorProfiles: true, ...SOURCE }));
    el.typesenseClient = {
      collections: () => ({ documents: () => ({ search: async () => ({
        found: 1,
        hits: [{ document: { id: 'p1', title: 'Jane’s garden', url: 'https://demo.example.com/p1/' } }]
      }) }) })
    };
    // Open, so the modal itself is not the hidden ancestor.
    await el.openModal();
    await el.handleSearch('jane');

    const press = (key) => el.handleKeydown({
      key, target: el.searchInput, preventDefault() {}, stopPropagation() {}
    });

    press('ArrowDown');
    const selected = () => el.shadowRoot.querySelector('.mp-search-selected');
    expect(selected().classList.contains('mp-search-author-link')).toBe(true);
    expect(selected().querySelector('.mp-search-author-name').textContent).toBe('Jane Doe');

    press('ArrowDown');
    press('ArrowDown');
    expect(selected().classList.contains('mp-search-result-link')).toBe(true);

    press('ArrowUp');
    press('ArrowUp');
    expect(selected().querySelector('.mp-search-author-name').textContent).toBe('Jane Doe');

    // jsdom cannot navigate; observe the assignment instead.
    const hrefs = [];
    const realLocation = window.location;
    vi.stubGlobal('location', { set href(v) { hrefs.push(v); }, get href() { return realLocation.href; } });
    const trackClick = vi.spyOn(el, 'trackClick');
    press('Enter');

    expect(hrefs).toEqual(['https://demo.example.com/author/jane/']);
    // A profile is not a search result, so no result click is reported.
    expect(trackClick).not.toHaveBeenCalled();
  });
});
