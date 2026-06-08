// Discovery two-pane layout (uiStyle: 'discovery') — STUB.
//
// Implements the layout interface so the seam builds and the default 'modal'
// path is unaffected. The real discovery UI (results list + live preview pane +
// facet rail) is ported from the playground prototype
// (apps/playground/src/prototypes/discovery.js) in a follow-up.
//
// Interface: same as palette.js (see search.js buildLayoutContext + init).

export default function createDiscoveryLayout(ctx) {
  const P = ctx.prefix;
  let root = null;
  const refs = {};

  return {
    id: 'discovery',
    requiredFields() {
      return ['authors', 'feature_image'];
    },
    buildMarkup() {
      return `
        <div id="${P}-discovery" class="${P}-discovery ${P}-hidden" role="dialog" aria-modal="true" aria-label="${ctx.t('ariaModalLabel')}">
          <div class="${P}-backdrop"></div>
          <div class="${P}-discovery-panel">
            <div class="${P}-discovery-header">
              <input type="search" class="${P}-discovery-input ${P}-input" placeholder="${ctx.t('searchPlaceholder')}"
                autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                aria-label="${ctx.t('ariaSearchLabel')}" />
              <button class="${P}-close" aria-label="${ctx.t('ariaCloseLabel')}"><span aria-hidden="true">×</span></button>
            </div>
            <div class="${P}-discovery-body">
              <div id="${P}-facets" class="${P}-discovery-rail ${P}-facets" role="group" aria-label="${ctx.t('ariaFacetsLabel')}"></div>
              <div id="${P}-discovery-results" class="${P}-discovery-results" role="listbox" aria-label="${ctx.t('ariaResultsLabel')}"></div>
              <div id="${P}-discovery-preview" class="${P}-discovery-preview"></div>
            </div>
          </div>
        </div>`;
    },
    cacheElements(shadowRoot) {
      root = shadowRoot;
      refs.panel = root.getElementById(`${P}-discovery`);
      refs.input = root.querySelector(`.${P}-discovery-input`);
      refs.results = root.getElementById(`${P}-discovery-results`);
      refs.preview = root.getElementById(`${P}-discovery-preview`);
      refs.facetsContainer = root.getElementById(`${P}-facets`);
      this.input = refs.input;
      this.facetsContainer = refs.facetsContainer;
    },
    bindEvents() {
      const closeBtn = root.querySelector(`.${P}-close`);
      if (closeBtn) closeBtn.addEventListener('click', () => ctx.close());
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
    renderInitial() { if (refs.results) refs.results.innerHTML = ''; if (refs.preview) refs.preview.innerHTML = ''; },
    renderLoading() {},
    renderEmpty() { if (refs.results) refs.results.innerHTML = `<div class="${P}-empty-message">${ctx.t('noResultsMessage')}</div>`; },
    renderResults(model) {
      if (!refs.results) return;
      refs.results.innerHTML = model.map((m) => `
        <a href="${m.url}" class="${P}-result-link" role="option"
           data-result-id="${ctx.escapeHtmlAttr(m.id)}" data-result-position="${m.position}"
           aria-label="${m.ariaTitle}">
          <span class="${P}-discovery-title">${m.titleHtml}</span>
        </a>`).join('');
    },
    renderSuggestions() {},
    renderFacets() {},
    handleKeydown() { return false; }
  };
}
