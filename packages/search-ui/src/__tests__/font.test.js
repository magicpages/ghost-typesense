import { describe, it, expect, afterEach, vi } from 'vitest';
import '../search.js';

// The `fontFamily` option. The typefaces themselves are `:host([data-font=…])`
// rules in styles.css, which jsdom neither loads (BUNDLED_CSS is empty under
// Vitest) nor resolves across a shadow boundary; what the widget controls, and
// what is asserted here, is the host attribute that selects a preset and the
// body font it hands the 'theme' preset.

const BASE_CONFIG = {
  typesenseNodes: [{ host: 'localhost', port: '8108', protocol: 'http' }],
  typesenseApiKey: 'search-only',
  collectionName: 'ghost'
};

// Run the real connectedCallback, since that is where the option is normalised.
// Its one-time `isInitialized` guard lives in the module closure, so re-evaluate
// the module for a fresh guard and call the new class's connectedCallback on an
// element; the tag itself stays bound to the first class, which shares the code.
async function boot(config = {}) {
  vi.resetModules();
  await import('../search.js');
  window.__MP_SEARCH_CONFIG__ = { ...BASE_CONFIG, ...config };
  const el = document.createElement('magicpages-search');
  window.MagicPagesSearch.prototype.connectedCallback.call(el);
  await el.initReady;
  return el;
}

afterEach(() => {
  delete window.__MP_SEARCH_CONFIG__;
  document.body.style.removeProperty('font-family');
  history.replaceState(null, '', window.location.pathname);
  vi.restoreAllMocks();
});

describe('fontFamily normalisation', () => {
  it.each(['system', 'theme', 'sans', 'serif', 'mono'])('keeps %s', async (value) => {
    const el = await boot({ fontFamily: value });
    expect(el.config.fontFamily).toBe(value);
  });

  it.each([
    ['omitted', undefined],
    ['an unknown name', 'comic-sans'],
    ['a differently cased preset', 'Serif'],
    ['a CSS font stack', 'Georgia, serif'],
    ['a non-string', 42]
  ])('falls back to system when %s', async (_label, value) => {
    const el = await boot({ fontFamily: value });
    expect(el.config.fontFamily).toBe('system');
  });
});

describe('fontFamily presets on the host', () => {
  it('leaves the host untouched by default, so existing sites render as before', async () => {
    const el = await boot();
    await el.openModal();

    expect(el.hasAttribute('data-font')).toBe(false);
    expect(el.hasAttribute('style')).toBe(false);
  });

  it('leaves the host untouched for an unknown value', async () => {
    const el = await boot({ fontFamily: 'comic-sans' });
    expect(el.hasAttribute('data-font')).toBe(false);
  });

  it.each(['theme', 'sans', 'serif', 'mono'])('selects the %s preset on the host', async (value) => {
    const el = await boot({ fontFamily: value });
    expect(el.getAttribute('data-font')).toBe(value);
  });

  it('sets no inline font property for the fixed presets, so page CSS stays in charge', async () => {
    document.body.style.fontFamily = 'Lora, serif';
    const el = await boot({ fontFamily: 'serif' });
    await el.openModal();

    expect(el.style.getPropertyValue('--mp-font')).toBe('');
    expect(el.style.getPropertyValue('--mp-theme-font')).toBe('');
  });
});

describe("fontFamily: 'theme'", () => {
  it("hands the theme's body font to the preset when the search opens", async () => {
    document.body.style.fontFamily = 'Lora, Georgia, serif';
    const el = await boot({ fontFamily: 'theme' });
    await el.openModal();

    expect(el.style.getPropertyValue('--mp-theme-font')).toBe('Lora, Georgia, serif');
  });

  it('never writes --mp-font or --mp-font-heading inline, which would outrank page CSS', async () => {
    document.body.style.fontFamily = 'Lora, serif';
    const el = await boot({ fontFamily: 'theme' });
    await el.openModal();

    expect(el.style.getPropertyValue('--mp-font')).toBe('');
    expect(el.style.getPropertyValue('--mp-font-heading')).toBe('');
  });

  it('re-reads the body font on each open, picking up a stylesheet that landed late', async () => {
    document.body.style.fontFamily = 'Lora, serif';
    const el = await boot({ fontFamily: 'theme' });
    await el.openModal();
    el.closeModal();

    document.body.style.fontFamily = '"Source Serif 4", serif';
    await el.openModal();

    expect(el.style.getPropertyValue('--mp-theme-font')).toBe('"Source Serif 4", serif');
  });

  it('drops a stale value when the body reports no font, leaving the system stack', async () => {
    document.body.style.fontFamily = 'Lora, serif';
    const el = await boot({ fontFamily: 'theme' });
    await el.openModal();
    el.closeModal();

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontFamily: '' });
    await el.openModal();

    expect(el.style.getPropertyValue('--mp-theme-font')).toBe('');
  });

  it('does not read the body font for any other preset', async () => {
    const spy = vi.spyOn(window, 'getComputedStyle');
    const el = await boot({ fontFamily: 'mono' });
    spy.mockClear();
    await el.openModal();

    expect(spy).not.toHaveBeenCalledWith(document.body);
  });
});
