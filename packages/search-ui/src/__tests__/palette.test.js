import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createPaletteLayout from '../layouts/palette.js';

// Hosts mounted during a test, torn down afterwards so DOM fixtures never leak
// across tests sharing the jsdom environment.
let mountedHosts = [];

beforeEach(() => {
  // The palette persists recent searches; start every test from a clean slate.
  window.localStorage.clear();
});

afterEach(() => {
  for (const host of mountedHosts) host.remove();
  mountedHosts = [];
});

// Minimal layout context. The palette factory only touches the core through
// this object; for rendering we need the prefix, an HTML-attribute escaper, and
// the translation helper (echoing the key is enough for assertions).
function makeCtx(config = {}) {
  return {
    prefix: 'mp-search',
    // The core's resolved config; empty means every option is at its default.
    config,
    escapeHtmlAttr: (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    // Echoing the key is enough for most assertions. didYouMeanLabel carries a
    // {q} placeholder the layout has to substitute, so it needs a real template.
    t: (k) => (k === 'didYouMeanLabel' ? 'Did you mean {q}?' : k),
    // Part of the real layout context (buildLayoutContext in search.js); the
    // composed result surface reads it to draw the active-filter pills.
    getSelectedFacets: () => ({}),
    toggleFacet: vi.fn(),
    search: vi.fn()
  };
}

function mountPalette(config) {
  const ctx = makeCtx(config);
  const layout = createPaletteLayout(ctx);
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountedHosts.push(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = layout.buildMarkup();
  layout.cacheElements(shadow);
  return { layout, shadow, ctx };
}

describe('palette request-failure state', () => {
  it('renders an alert with the error strings, not the no-results message', () => {
    const { layout, shadow } = mountPalette();
    layout.renderError('composting');

    const results = shadow.getElementById('mp-search-palette-listbox');
    const alert = results.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // makeCtx().t echoes the key, so the keys themselves are the assertion.
    expect(alert.textContent).toContain('errorMessage');
    expect(alert.textContent).toContain('errorHint');
    expect(results.textContent).not.toContain('paletteNoResultsTitle');
  });

  it('clears the footer status so a stale "Searching…" hint does not linger', () => {
    const { layout, shadow } = mountPalette();
    layout.renderLoading();
    expect(shadow.querySelector('.mp-search-palette-status').textContent).toBe('paletteSearching');

    layout.renderError('composting');

    expect(shadow.querySelector('.mp-search-palette-status').textContent).toBe('');
  });

  it('leaves no navigable rows behind, so Enter cannot open a stale result', () => {
    const { layout, shadow } = mountPalette();
    layout.renderError('composting');

    const results = shadow.getElementById('mp-search-palette-listbox');
    expect(results.querySelectorAll('.mp-search-palette-row')).toHaveLength(0);
    // Enter is only consumed when there is something to activate.
    expect(layout.handleKeydown({ key: 'Enter', preventDefault() {} })).toBe(false);
  });

  it('reports zero results for a genuine no-match query (distinct from a failure)', () => {
    const { layout, shadow } = mountPalette();
    layout.renderEmpty('composting');

    const results = shadow.getElementById('mp-search-palette-listbox');
    expect(results.textContent).toContain('paletteNoResultsTitle');
    expect(results.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('palette did-you-mean prompt', () => {
  it('offers the correction as a row below the no-results message', () => {
    const { layout, shadow } = mountPalette();
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');

    const results = shadow.getElementById('mp-search-palette-listbox');
    expect(results.textContent).toContain('paletteNoResultsTitle');
    const row = results.querySelector('.mp-search-palette-row-suggest');
    expect(row.textContent).toContain('Did you mean composting?');
  });

  it('accepts the correction on Enter, so the keyboard path never dead-ends', () => {
    const { layout, shadow, ctx } = mountPalette();
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');

    expect(layout.handleKeydown({ key: 'Enter', preventDefault() {} })).toBe(true);
    expect(ctx.search).toHaveBeenCalledWith('composting');
    expect(shadow.querySelector('.mp-search-palette-input').value).toBe('composting');
  });

  it('escapes a suggested term rather than letting it into the markup', () => {
    const { layout, shadow } = mountPalette();
    layout.renderEmpty('x');
    layout.renderDidYouMean('"><img src=x onerror=alert(1)>');

    const results = shadow.getElementById('mp-search-palette-listbox');
    expect(results.querySelector('img')).toBeNull();
  });

  it('drops the correction when the next query matches nothing either', () => {
    const { layout, shadow } = mountPalette();
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');
    layout.renderEmpty('mulching techniques');

    const results = shadow.getElementById('mp-search-palette-listbox');
    expect(results.querySelector('.mp-search-palette-row-suggest')).toBeNull();
  });
});

// The label is a translation from the site's config, so its text is escaped and
// only the wrapper around the suggested term is markup — matching the modal and
// discovery layouts, which previously differed on this.
describe('palette did-you-mean label contract', () => {
  function mountWithLabel(label) {
    const ctx = makeCtx();
    ctx.t = (k) => (k === 'didYouMeanLabel' ? label : k);
    const layout = createPaletteLayout(ctx);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountedHosts.push(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = layout.buildMarkup();
    layout.cacheElements(shadow);
    return { layout, shadow };
  }

  it('substitutes {q} in a translated label', () => {
    const { layout, shadow } = mountWithLabel('Meintest du {q}?');
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');

    const row = shadow.querySelector('.mp-search-palette-row-suggest');
    expect(row.textContent).toContain('Meintest du composting?');
    expect(row.querySelector('.mp-search-palette-suggest-term').textContent).toBe('composting');
  });

  it('renders a label containing markup as text, never as markup', () => {
    const { layout, shadow } = mountWithLabel('<img src=x onerror=alert(1)> {q}?');
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');

    const results = shadow.getElementById('mp-search-palette-listbox');
    expect(results.querySelector('img')).toBeNull();
    expect(results.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// Ghost gates a post two ways — anyone signed up, or paying readers only — and
// the palette's row badge has to say which.
describe('palette gated rows', () => {
  // Mirrors what normalizeHit hands the layout. `showBadge` is the core's
  // per-reader decision; `access` is the gate itself.
  function gatedModel({ visibility, access, showBadge = true }) {
    return [
      {
        id: 'p1',
        position: 0,
        url: '/post/',
        title: 'A post',
        titleHtml: 'A post',
        ariaTitle: 'A post',
        excerptHtml: 'Body teaser',
        isGated: visibility !== 'public',
        access,
        showBadge,
        visibility,
        featureImage: null,
        tags: ['Gardening'],
        authors: ['Ada Lovelace'],
        publishedAt: 1700000000000
      }
    ];
  }

  function rowFor(model) {
    const { layout, shadow } = mountPalette();
    layout.renderResults(model, { found: 1, query: 'composting' });
    return shadow.querySelector('.mp-search-palette-row-post');
  }

  // makeCtx().t echoes the key, so the keys themselves are the assertion.
  it('labels a free-member row distinctly from a paid one', () => {
    const free = rowFor(gatedModel({ visibility: 'members', access: 'members' }))
      .querySelector('.mp-search-palette-badge');
    expect(free.classList.contains('mp-search-palette-badge-members')).toBe(true);
    expect(free.textContent).toBe('membersLabel');
    expect(free.getAttribute('aria-label')).toBe('ariaMembersLabel');

    const paid = rowFor(gatedModel({ visibility: 'paid', access: 'paid' }))
      .querySelector('.mp-search-palette-badge');
    expect(paid.classList.contains('mp-search-palette-badge-paid')).toBe(true);
    expect(paid.textContent).toBe('paidLabel');
    expect(paid.getAttribute('aria-label')).toBe('ariaPaidLabel');
  });

  it('badges a tier-gated row as paid', () => {
    const badge = rowFor(gatedModel({ visibility: 'tiers', access: 'paid' }))
      .querySelector('.mp-search-palette-badge');
    expect(badge.classList.contains('mp-search-palette-badge-paid')).toBe(true);
  });

  // Same contract the modal layout offers, so theme code can style a gate or
  // route the click to a membership flow whichever layout is in use.
  it('exposes the raw visibility on the row', () => {
    const row = rowFor(gatedModel({ visibility: 'tiers', access: 'paid' }));
    expect(row.getAttribute('data-gated')).toBe('tiers');
    expect(row.classList.contains('mp-search-result-gated')).toBe(true);
  });

  it('drops the badge for a reader who can already open the post', () => {
    const row = rowFor(gatedModel({ visibility: 'members', access: 'members', showBadge: false }));
    expect(row.querySelector('.mp-search-palette-badge')).toBeNull();
    // The gate itself is still exposed for theme code.
    expect(row.getAttribute('data-gated')).toBe('members');
  });

  it('leaves a public row unbadged and unmarked', () => {
    const row = rowFor(gatedModel({ visibility: 'public', access: 'public', showBadge: false }));
    expect(row.querySelector('.mp-search-palette-badge')).toBeNull();
    expect(row.hasAttribute('data-gated')).toBe(false);
    expect(row.classList.contains('mp-search-result-gated')).toBe(false);
  });
});

// A public post as normalizeHit hands it to the layout.
function postModel(overrides = {}) {
  return [
    {
      id: 'p1',
      position: 0,
      url: '/post/',
      title: 'A post',
      titleHtml: 'A post',
      ariaTitle: 'A post',
      excerptHtml: 'Body teaser',
      isGated: false,
      access: 'public',
      showBadge: false,
      visibility: 'public',
      featureImage: null,
      tags: ['Gardening'],
      authors: ['Jane Doe'],
      publishedAt: 1700000000000,
      ...overrides
    }
  ];
}

// Tag and author facet counts, so the surface draws all three result groups.
const facetCounts = [
  { field_name: 'tags.name', counts: [{ value: 'Gardening', count: 2 }] },
  { field_name: 'authors', counts: [{ value: 'Jane Doe', count: 1 }] }
];

function metaFor(model, config) {
  const { layout, shadow } = mountPalette(config);
  layout.renderResults(model, { found: 1, query: 'composting' });
  return shadow.querySelector('.mp-search-palette-row-post .mp-search-palette-row-meta');
}

describe('palette post row meta', () => {
  it('shows the tag, first author and date, in that order', () => {
    const meta = metaFor(postModel({ authors: ['Jane Doe', 'John Roe'] }));
    const classes = [...meta.children].map((el) => el.className);
    expect(classes).toEqual([
      'mp-search-palette-meta-chip',
      'mp-search-palette-meta-author',
      'mp-search-palette-meta-date'
    ]);
    expect(meta.querySelector('.mp-search-palette-meta-author').textContent).toBe('Jane Doe');
  });

  it('renders an author name as text, not markup', () => {
    const author = metaFor(postModel({ authors: ['<b>x</b>'] }))
      .querySelector('.mp-search-palette-meta-author');
    expect(author.textContent).toBe('<b>x</b>');
    expect(author.querySelector('b')).toBeNull();
  });

  it('leaves a row without authors as it was', () => {
    const meta = metaFor(postModel({ authors: [] }));
    expect(meta.querySelector('.mp-search-palette-meta-author')).toBeNull();
    expect([...meta.children].map((el) => el.className)).toEqual([
      'mp-search-palette-meta-chip',
      'mp-search-palette-meta-date'
    ]);
  });

  it('drops the date when showDates is false', () => {
    const meta = metaFor(postModel(), { showDates: false });
    expect(meta.querySelector('.mp-search-palette-meta-date')).toBeNull();
    expect(meta.querySelector('.mp-search-palette-meta-chip')).not.toBeNull();
    expect(meta.querySelector('.mp-search-palette-meta-author')).not.toBeNull();
  });
});

describe('palette group labels', () => {
  function resultsSurface(config) {
    const { layout, shadow } = mountPalette(config);
    layout.renderFacets(facetCounts);
    layout.renderResults(postModel(), { found: 1, query: 'composting' });
    return shadow.getElementById('mp-search-palette-listbox');
  }

  function recentSurface(config) {
    window.localStorage.setItem('mp-search-palette-recent', JSON.stringify(['composting']));
    const { layout, shadow } = mountPalette(config);
    layout.renderInitial();
    return shadow.getElementById('mp-search-palette-listbox');
  }

  const groupNames = (surface) =>
    [...surface.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));

  it('heads every group by default', () => {
    const labels = [...resultsSurface().querySelectorAll('.mp-search-palette-group-label')];
    expect(labels.map((l) => l.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'palettePostsGroup 1',
      'paletteTagsGroup',
      'paletteAuthorsGroup'
    ]);
    expect(recentSurface().querySelector('.mp-search-palette-group-label').textContent)
      .toBe('paletteRecentGroup');
  });

  it('drops the headings but keeps each group labelled when showGroupLabels is false', () => {
    const results = resultsSurface({ showGroupLabels: false });
    expect(results.querySelector('.mp-search-palette-group-label')).toBeNull();
    expect(results.querySelector('.mp-search-palette-group-count')).toBeNull();
    expect(groupNames(results)).toEqual(['palettePostsGroup', 'paletteTagsGroup', 'paletteAuthorsGroup']);
    // The rows themselves are untouched.
    expect(results.querySelectorAll('[role="option"]')).toHaveLength(3);

    const recent = recentSurface({ showGroupLabels: false });
    expect(recent.querySelector('.mp-search-palette-group-label')).toBeNull();
    expect(groupNames(recent)).toEqual(['paletteRecentGroup']);
  });
});
