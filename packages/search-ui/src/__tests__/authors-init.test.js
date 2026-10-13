import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The Code Injection install: Ghost's own search script tag is on the page,
// carrying the Content API key and admin URL, and the widget removes it once it
// has initialized. The author profiles section still needs both values, so
// they must be read before the tag goes. This needs the real load path — the
// module evaluated with the tag present and a global config set — so it gets
// its own file and imports the widget only after the page is set up.

let fetchMock;

beforeAll(async () => {
  const tag = document.createElement('script');
  tag.type = 'application/json';
  tag.setAttribute('data-sodo-search', 'https://admin.example.com/');
  tag.setAttribute('data-key', 'tag-key');
  document.head.appendChild(tag);

  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ authors: [] }) }));
  vi.stubGlobal('fetch', fetchMock);

  window.__MP_SEARCH_CONFIG__ = {
    typesenseNodes: [{ host: 'localhost', port: '8108', protocol: 'http' }],
    typesenseApiKey: 'search-only',
    collectionName: 'ghost',
    showAuthorProfiles: true
  };
  await import('../search.js');
  // The widget's cleanup sweeps every 100ms after it initializes.
  await new Promise(resolve => setTimeout(resolve, 250));
});

afterAll(() => {
  if (window.magicPagesSearch && window.magicPagesSearch.isModalOpen) window.magicPagesSearch.closeModal();
  delete window.__MP_SEARCH_CONFIG__;
  vi.unstubAllGlobals();
});

function freshElement(config = {}) {
  const el = document.createElement('magicpages-search');
  el.config = { ...window.magicPagesSearch.config, ...config };
  return el;
}

describe('author profiles — Ghost search tag pickup', () => {
  it('reads the key and admin URL before the widget removes the tag', async () => {
    expect(document.querySelector('script[data-sodo-search]')).toBeNull();

    window.sessionStorage.clear();
    await window.magicPagesSearch.openModal();
    await window.magicPagesSearch.authorProfilesLoad;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The trailing slash of the admin URL is not doubled.
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://admin.example.com/ghost/api/content/search-index/authors/?key=tag-key');
  });

  it('lets the config overrides win over the tag', () => {
    const el = freshElement({ ghostContentApiKey: 'override-key', ghostUrl: 'https://cms.example.com//' });
    expect(el.authorIndexSource()).toEqual({ key: 'override-key', url: 'https://cms.example.com' });
  });

  it('takes each override on its own, keeping the tag for the other value', () => {
    expect(freshElement({ ghostContentApiKey: 'override-key' }).authorIndexSource())
      .toEqual({ key: 'override-key', url: 'https://admin.example.com' });
    expect(freshElement({ ghostUrl: 'https://cms.example.com' }).authorIndexSource())
      .toEqual({ key: 'tag-key', url: 'https://cms.example.com' });
  });
});
