// Command-palette layout (uiStyle: 'palette') — STUB.
//
// Implements the layout interface so the seam builds and the default 'modal'
// path is unaffected. The real palette UI is ported from the playground
// prototype (apps/playground/src/prototypes/palette.js) in a follow-up.
//
// Interface (see search.js buildLayoutContext + init): id, requiredFields(),
// buildMarkup(), cacheElements(root), bindEvents(), onOpen(), onClose(),
// focusInput(), setQuery(q), getQuery(), setTheme(isDark), renderInitial(),
// renderLoading(), renderEmpty(query), renderResults(model, meta),
// renderSuggestions(), renderFacets(counts, selected), handleKeydown(e).

export default function createPaletteLayout(ctx) {
  const P = ctx.prefix;
  let root = null;
  const refs = {};

  return {
    id: 'palette',
    requiredFields() {
      return ['authors'];
    },
    buildMarkup() {
      return `
        <div id="${P}-palette" class="${P}-palette ${P}-hidden" role="dialog" aria-modal="true" aria-label="${ctx.t('ariaModalLabel')}">
          <div class="${P}-backdrop"></div>
          <div class="${P}-palette-panel">
            <input type="search" class="${P}-palette-input ${P}-input" placeholder="${ctx.t('searchPlaceholder')}"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
              aria-label="${ctx.t('ariaSearchLabel')}" />
            <div id="${P}-palette-results" class="${P}-palette-results" role="listbox" aria-label="${ctx.t('ariaResultsLabel')}"></div>
          </div>
        </div>`;
    },
    cacheElements(shadowRoot) {
      root = shadowRoot;
      refs.panel = root.getElementById(`${P}-palette`);
      refs.input = root.querySelector(`.${P}-palette-input`);
      refs.results = root.getElementById(`${P}-palette-results`);
      this.input = refs.input;
      this.facetsContainer = refs.results;
    },
    bindEvents() {
      if (refs.panel) {
        refs.panel.addEventListener('click', (e) => {
          if (e.target.classList.contains(`${P}-backdrop`)) ctx.close();
        });
      }
      let debounce = null;
      if (refs.input) {
        refs.input.addEventListener('input', (e) => {
          const q = e.target.value;
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => ctx.search(q), 80);
        });
      }
      if (refs.results) {
        refs.results.addEventListener('click', (e) => {
          const link = e.target.closest(`.${P}-result-link`);
          if (!link) return;
          const position = Number(link.dataset.resultPosition);
          ctx.trackClick(link.dataset.resultId, Number.isNaN(position) ? null : position);
        }, true);
      }
    },
    onOpen() { if (refs.panel) refs.panel.classList.remove(`${P}-hidden`); },
    onClose() { if (refs.panel) refs.panel.classList.add(`${P}-hidden`); if (refs.input) refs.input.value = ''; },
    focusInput() { setTimeout(() => refs.input && refs.input.focus(), 50); },
    setQuery(q) { if (refs.input) refs.input.value = q; },
    getQuery() { return refs.input ? refs.input.value : ''; },
    setTheme(isDark) { if (refs.panel) refs.panel.classList.toggle(`${P}-dark`, isDark); },
    renderInitial() { if (refs.results) refs.results.innerHTML = ''; },
    renderLoading() {},
    renderEmpty() { if (refs.results) refs.results.innerHTML = `<div class="${P}-empty-message">${ctx.t('noResultsMessage')}</div>`; },
    renderResults(model) {
      if (!refs.results) return;
      refs.results.innerHTML = model.map((m) => `
        <a href="${m.url}" class="${P}-result-link" role="option"
           data-result-id="${ctx.escapeHtmlAttr(m.id)}" data-result-position="${m.position}"
           aria-label="${m.ariaTitle}">
          <span class="${P}-palette-title">${m.titleHtml}</span>
        </a>`).join('');
    },
    renderSuggestions() {},
    renderFacets() {},
    handleKeydown() { return false; }
  };
}
