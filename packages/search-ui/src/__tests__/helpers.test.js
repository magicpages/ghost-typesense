import { describe, it, expect, beforeEach } from 'vitest';
import '../search.js';

// The component class is only exposed via window (search.js is an IIFE with no
// exports). Construct instances through the registered element so the custom
// element upgrade runs the constructor, then drive the pure methods directly
// with an explicit config — this avoids connectedCallback's one-time
// `isInitialized` guard, which would otherwise block a second instance.
function makeInstance(config = {}) {
  const el = document.createElement('magicpages-search');
  el.config = {
    typesenseNodes: [{ host: 'localhost', port: '8108', protocol: 'http' }],
    typesenseApiKey: 'search-only',
    collectionName: 'ghost',
    commonSearches: [],
    pinnedSearches: [],
    facets: [],
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
  return el;
}

describe('escapeHtmlAttr', () => {
  const el = makeInstance();

  it('escapes the five significant characters', () => {
    expect(el.escapeHtmlAttr(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('coerces null/undefined to an empty string', () => {
    expect(el.escapeHtmlAttr(undefined)).toBe('');
    expect(el.escapeHtmlAttr(null)).toBe('');
  });

  it('escapes ampersand before entities to avoid double-encoding artifacts', () => {
    expect(el.escapeHtmlAttr('a&b<c')).toBe('a&amp;b&lt;c');
  });
});

describe('toRelativeUrl', () => {
  const el = makeInstance();

  it('strips the origin, keeping path, search and hash', () => {
    expect(el.toRelativeUrl('https://example.com/blog/post/?a=1#x')).toBe('/blog/post/?a=1#x');
  });

  it('returns # for an empty value and the original for an unparseable one', () => {
    expect(el.toRelativeUrl('')).toBe('#');
    expect(el.toRelativeUrl('not a url')).toBe('not a url');
  });
});

describe('getSuggestions', () => {
  it('orders pinned first, then fetched, then commonSearches', () => {
    const el = makeInstance({
      pinnedSearches: ['Pinned'],
      commonSearches: ['Common']
    });
    el.fetchedSuggestions = ['Fetched'];
    expect(el.getSuggestions()).toEqual(['Pinned', 'Fetched', 'Common']);
  });

  it('collapses duplicates case-insensitively, keeping the first occurrence', () => {
    const el = makeInstance({
      pinnedSearches: ['Tutorials'],
      commonSearches: ['tutorials', 'Pricing']
    });
    el.fetchedSuggestions = ['TUTORIALS'];
    expect(el.getSuggestions()).toEqual(['Tutorials', 'Pricing']);
  });

  it('ignores non-strings and blank entries', () => {
    const el = makeInstance({ commonSearches: ['  ', 'Real', 42, null] });
    expect(el.getSuggestions()).toEqual(['Real']);
  });
});

describe('facet filter composition', () => {
  let el;
  beforeEach(() => {
    el = makeInstance({
      facets: [
        { field: 'tags.name', label: 'Topics' },
        { field: 'authors', label: 'Authors' }
      ]
    });
  });

  it('returns an empty clause when nothing is selected', () => {
    expect(el.buildFacetFilter()).toBe('');
  });

  it('ORs values within a field and ANDs across fields, backtick-quoting values', () => {
    el.selectedFacets = {
      'tags.name': new Set(['Ghost', 'How To']),
      authors: new Set(['Jannis'])
    };
    expect(el.buildFacetFilter()).toBe('tags.name:=[`Ghost`,`How To`] && authors:=[`Jannis`]');
  });

  it('strips backticks from values so they cannot break the expression', () => {
    el.selectedFacets = { 'tags.name': new Set(['a`b']) };
    expect(el.buildFacetFilter()).toBe('tags.name:=[`ab`]');
  });

  it('preserves a publisher filter by ANDing it with the facet clause', () => {
    el.selectedFacets = { authors: new Set(['Jannis']) };
    expect(el.composeFilterBy('published_at:>0')).toBe('(published_at:>0) && (authors:=[`Jannis`])');
  });

  it('returns the publisher filter unchanged when no facets are selected', () => {
    expect(el.composeFilterBy('published_at:>0')).toBe('published_at:>0');
  });

  it('returns only the facet clause when there is no publisher filter', () => {
    el.selectedFacets = { authors: new Set(['Jannis']) };
    expect(el.composeFilterBy(undefined)).toBe('authors:=[`Jannis`]');
  });
});
