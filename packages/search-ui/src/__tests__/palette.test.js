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

function mountPalette() {
  const ctx = makeCtx();
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
