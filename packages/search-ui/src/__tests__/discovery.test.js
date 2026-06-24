import { describe, it, expect } from 'vitest';
import createDiscoveryLayout from '../layouts/discovery.js';

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
    t: (k) => k
  };
}

// Mount the layout into a real shadow root (so getElementById works the same as
// in the live widget) and return the layout plus its cached preview element.
function mountDiscovery() {
  const layout = createDiscoveryLayout(makeCtx());
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = layout.buildMarkup();
  layout.cacheElements(shadow);
  return { layout, shadow };
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
      tags: ['Trade'],
      authors: ['Simon'],
      publishedAt: 1700000000000
    }
  ];
}

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
