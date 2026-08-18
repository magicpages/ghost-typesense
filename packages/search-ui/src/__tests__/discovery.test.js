import { describe, it, expect, afterEach, vi } from 'vitest';
import createDiscoveryLayout from '../layouts/discovery.js';

// Hosts mounted during a test, torn down afterwards so DOM fixtures never leak
// across tests sharing the jsdom environment.
let mountedHosts = [];

afterEach(() => {
  for (const host of mountedHosts) host.remove();
  mountedHosts = [];
});

// Minimal layout context. The discovery factory only touches the core through
// this object; for rendering we need the prefix, an HTML-attribute escaper, and
// the translation helper (echoing the key is enough for assertions).
function makeCtx() {
  return {
    prefix: 'mp-search',
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
    search: vi.fn()
  };
}

// Mount the layout into a real shadow root (so getElementById works the same as
// in the live widget) and return the layout plus its cached preview element.
function mountDiscovery() {
  const ctx = makeCtx();
  const layout = createDiscoveryLayout(ctx);
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountedHosts.push(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = layout.buildMarkup();
  layout.cacheElements(shadow);
  return { layout, shadow, ctx };
}

function modelWith(featureImage) {
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
      visibility: 'public',
      featureImage,
      tags: ['Gardening'],
      authors: ['Ada Lovelace'],
      publishedAt: 1700000000000
    }
  ];
}

describe('discovery request-failure state', () => {
  it('renders an alert with the error strings, not the no-results message', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderError('composting');

    const results = shadow.getElementById('mp-search-discovery-results');
    const alert = results.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // makeCtx().t echoes the key, so the keys themselves are the assertion.
    expect(alert.textContent).toContain('errorMessage');
    expect(alert.textContent).toContain('errorHint');
    expect(results.textContent).not.toContain('noResultsMessage');
  });

  it('collapses the panel to a single column and clears the rail, preview and count', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderResults(modelWith(null), { found: 1 });
    layout.renderError('composting');

    const panel = shadow.getElementById('mp-search-discovery');
    expect(panel.classList.contains('mp-search-discovery-notice')).toBe(true);
    expect(shadow.getElementById('mp-search-facets').innerHTML).toBe('');
    expect(shadow.getElementById('mp-search-discovery-preview').innerHTML).toBe('');
    expect(shadow.querySelector('.mp-search-discovery-count').textContent).toBe('');
  });

  it('drops the notice state again once results render', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderError('composting');
    layout.renderResults(modelWith(null), { found: 1 });

    const panel = shadow.getElementById('mp-search-discovery');
    expect(panel.classList.contains('mp-search-discovery-notice')).toBe(false);
  });
});

describe('discovery preview hero', () => {
  it('omits the hero entirely when the selected result has no feature image', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderResults(modelWith(null), { found: 1 });

    const preview = shadow.getElementById('mp-search-discovery-preview');
    // No image and — the point of this change — no placeholder box either.
    expect(preview.querySelector('.mp-search-discovery-hero')).toBeNull();
    expect(preview.querySelector('.mp-search-discovery-hero-empty')).toBeNull();
    // The rest of the preview still renders.
    expect(preview.querySelector('.mp-search-discovery-preview-title').textContent).toContain('A post');
  });

  it('renders the hero image when the selected result has a feature image', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderResults(modelWith('https://cdn.example.com/p.jpg'), { found: 1 });

    const preview = shadow.getElementById('mp-search-discovery-preview');
    const img = preview.querySelector('img.mp-search-discovery-hero');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/p.jpg');
  });
});

describe('discovery did-you-mean prompt', () => {
  it('adds the correction under the no-results message, keeping both on screen', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');

    const empty = shadow.querySelector('.mp-search-discovery-empty');
    expect(empty.textContent).toContain('noResultsMessage');
    const button = empty.querySelector('.mp-search-discovery-suggest');
    expect(button.dataset.search).toBe('composting');
    expect(button.textContent).toBe('Did you mean composting?');
  });

  it('escapes a suggested term rather than letting it into the markup', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderEmpty('x');
    layout.renderDidYouMean('"><img src=x onerror=alert(1)>');

    const empty = shadow.querySelector('.mp-search-discovery-empty');
    expect(empty.querySelector('img')).toBeNull();
  });

  it('adds nothing when the surface is not the empty state (a failed request)', () => {
    const { layout, shadow } = mountDiscovery();
    layout.renderError('compsting');
    layout.renderDidYouMean('composting');

    expect(shadow.querySelector('.mp-search-discovery-suggest')).toBeNull();
  });

  it('runs the corrected term and puts it in the input when clicked', () => {
    const { layout, shadow, ctx } = mountDiscovery();
    layout.bindEvents();
    layout.renderEmpty('compsting');
    layout.renderDidYouMean('composting');

    shadow.querySelector('.mp-search-discovery-suggest').click();

    expect(ctx.search).toHaveBeenCalledWith('composting');
    expect(shadow.querySelector('.mp-search-discovery-input').value).toBe('composting');
  });
});
