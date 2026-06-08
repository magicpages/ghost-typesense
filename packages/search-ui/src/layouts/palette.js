// Command-palette layout (uiStyle: 'palette') — PRODUCTION.
//
// A dense, keyboard-first spotlight bar in the Linear / Algolia DocSearch idiom.
// Top-anchored, compact one-line rows grouped into buckets (Posts / Tags /
// Authors). Before typing it shows a "Recent searches" group persisted to
// localStorage. Strong cross-group keyboard navigation with a single visible
// active row, and a footer command bar of keyboard hints. No thumbnails.
//
// Ported from apps/playground/src/prototypes/palette.js onto the shipped seam:
// the core (search.js) owns query/analytics/lifecycle and drives this layout
// through the ctx contract (buildLayoutContext) and the lifecycle methods below.
// All previously module-level mutable state now lives in the factory closure.
//
// Interface (see search.js buildLayoutContext + init): id, requiredFields(),
// buildMarkup(), cacheElements(root), bindEvents(), onOpen(), onClose(),
// focusInput(), setQuery(q), getQuery(), setTheme(isDark), renderInitial(),
// renderLoading(), renderEmpty(query), renderResults(model, meta),
// renderSuggestions(), renderFacets(counts, selected), handleKeydown(e).

const RECENT_KEY = 'mp-search-palette-recent';
const RECENT_MAX = 5;
const DEBOUNCE_MS = 80;
const FACET_LIMIT = 6;

export default function createPaletteLayout(ctx) {
  const P = ctx.prefix; // 'mp-search'
  const L = `${P}-palette`; // layout-specific element prefix

  // --- Factory-closure state (no module-level singletons) ---
  let root = null;
  const refs = {};
  let debounceTimer = null;

  // Flat list of navigable rows; each entry is one of:
  //   { kind: 'recent', value }
  //   { kind: 'post', model }   (model is the NormalizedResult)
  //   { kind: 'tag' | 'author', value }
  let flatItems = [];
  let activeIndex = 0;

  // Last rendered result model + facet counts, so the two seam calls
  // (renderFacets then renderResults) can be composed into one surface.
  let currentModel = [];
  let currentFacetCounts = [];
  let currentQuery = '';

  // Recent searches, loaded from localStorage and mirrored in memory.
  let recent = loadRecent();

  // --- localStorage helpers (fail-silent; degrade to in-memory only) ---
  function loadRecent() {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }

  function saveRecent(list) {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch {
      /* localStorage unavailable — degrade silently */
    }
  }

  function pushRecent(term) {
    const trimmed = (term || '').trim();
    if (!trimmed) return;
    recent = [trimmed, ...recent.filter((t) => t !== trimmed)].slice(0, RECENT_MAX);
    saveRecent(recent);
  }

  // --- Small presentation helpers ---
  // Human-relative date from an epoch-ms timestamp (model.publishedAt).
  function relativeDate(epochMs) {
    if (epochMs == null) return '';
    const diff = Date.now() - Number(epochMs);
    if (Number.isNaN(diff)) return '';
    const sec = Math.round(diff / 1000);
    const min = Math.round(sec / 60);
    const hr = Math.round(min / 60);
    const day = Math.round(hr / 24);
    if (day > 365) return ctx.t('paletteRelativeYears').replace('{n}', Math.round(day / 365));
    if (day > 30) return ctx.t('paletteRelativeMonths').replace('{n}', Math.round(day / 30));
    if (day >= 1) return ctx.t('paletteRelativeDays').replace('{n}', day);
    if (hr >= 1) return ctx.t('paletteRelativeHours').replace('{n}', hr);
    if (min >= 1) return ctx.t('paletteRelativeMinutes').replace('{n}', min);
    return ctx.t('paletteRelativeNow');
  }

  function pluralResults(count) {
    return count === 1
      ? ctx.t('paletteResultCountOne').replace('{n}', '1')
      : ctx.t('paletteResultCountOther').replace('{n}', String(count));
  }

  // Find a facet-count block by a substring of its field name, so the layout
  // works whether the index exposes tags as `tags.name`/`tags` or authors as
  // `authors`/`authors.name`.
  function facetByName(needle) {
    if (!Array.isArray(currentFacetCounts)) return null;
    return currentFacetCounts.find(
      (f) => f && typeof f.field_name === 'string' && f.field_name.indexOf(needle) !== -1
    );
  }

  function setStatus(text) {
    if (refs.status) refs.status.textContent = text;
  }

  // --- Active-row management ---
  function applyActive() {
    if (!refs.results) return;
    const rows = refs.results.querySelectorAll(`.${L}-row`);
    rows.forEach((rowEl, i) => {
      const isActive = i === activeIndex;
      rowEl.classList.toggle(`${L}-row-active`, isActive);
      rowEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        if (rowEl.id && refs.input) refs.input.setAttribute('aria-activedescendant', rowEl.id);
        rowEl.scrollIntoView({ block: 'nearest' });
      }
    });
    if (flatItems.length === 0 && refs.input) {
      refs.input.removeAttribute('aria-activedescendant');
    }
  }

  function setActive(index) {
    if (flatItems.length === 0) {
      activeIndex = 0;
      applyActive();
      return;
    }
    activeIndex = Math.max(0, Math.min(index, flatItems.length - 1));
    applyActive();
  }

  function move(delta) {
    if (flatItems.length === 0) return;
    let next = activeIndex + delta;
    if (next < 0) next = flatItems.length - 1;
    if (next >= flatItems.length) next = 0;
    setActive(next);
  }

  // Jump to the first row of the next/previous group (group-level nav).
  function moveGroup(direction) {
    if (flatItems.length === 0) return;
    const groupOf = (i) => flatItems[i] && flatItems[i].kind === 'post'
      ? 'post'
      : (flatItems[i] ? flatItems[i].kind : '');
    const currentGroup = groupOf(activeIndex);
    let i = activeIndex;
    if (direction > 0) {
      while (i < flatItems.length && groupOf(i) === currentGroup) i += 1;
      if (i >= flatItems.length) i = 0; // wrap to first
    } else {
      // Step back to the start of the current group, then to the previous
      // group's start.
      while (i > 0 && groupOf(i - 1) === currentGroup) i -= 1;
      if (i === activeIndex) {
        // Already at group start — go to previous group's start.
        i -= 1;
        if (i < 0) i = flatItems.length - 1;
        const prevGroup = groupOf(i);
        while (i > 0 && groupOf(i - 1) === prevGroup) i -= 1;
      }
    }
    setActive(i);
  }

  // Activate the row at index. newTab opens posts in a new tab. Posts navigate
  // (after a click-track + recent push); recent/tag/author rows refine the
  // query by typing their value back into the input.
  function activate(index, newTab) {
    const item = flatItems[index];
    if (!item) return;

    if (item.kind === 'recent' || item.kind === 'tag' || item.kind === 'author') {
      // Ignore malformed rows so we never type the literal "undefined" into the
      // input or issue a query for it.
      const value = item.value;
      if (typeof value !== 'string' || value.trim() === '') return;
      if (refs.input) {
        refs.input.value = value;
        refs.input.focus();
      }
      currentQuery = value;
      ctx.search(value);
      return;
    }

    if (item.kind === 'post') {
      const m = item.model;
      if (!m || !m.url) return;
      pushRecent(currentQuery);
      const position = Number.isNaN(Number(m.position)) ? null : Number(m.position);
      ctx.trackClick(m.id, position);
      if (newTab) {
        window.open(m.url, '_blank', 'noopener');
      } else {
        window.location.href = m.url;
      }
    }
  }

  // --- Markup builders for the two surfaces ---
  function recentSurfaceHtml() {
    flatItems = [];
    if (!recent || recent.length === 0) {
      return `
        <div class="${L}-empty">
          <p class="${L}-empty-title">${ctx.t('paletteEmptyTitle')}</p>
          <p class="${L}-empty-sub">${ctx.t('paletteEmptySub')}</p>
        </div>`;
    }

    const rows = recent.map((term) => {
      flatItems.push({ kind: 'recent', value: term });
      const idx = flatItems.length - 1;
      return `
        <div class="${L}-row ${L}-row-recent" id="${L}-row-${idx}"
             role="option" aria-selected="false" data-index="${idx}">
          <span class="${L}-row-icon" aria-hidden="true">↺</span>
          <span class="${L}-row-title">${ctx.escapeHtmlAttr(term)}</span>
          <span class="${L}-row-meta">${ctx.t('paletteRecentLabel')}</span>
        </div>`;
    });

    return `
      <div class="${L}-group" role="group" aria-label="${ctx.t('paletteRecentGroup')}">
        <div class="${L}-group-label">${ctx.t('paletteRecentGroup')}</div>
        ${rows.join('')}
      </div>`;
  }

  function postRowHtml(m) {
    flatItems.push({ kind: 'post', model: m });
    const idx = flatItems.length - 1;

    const tag = Array.isArray(m.tags) && m.tags.length ? String(m.tags[0]) : '';
    const date = relativeDate(m.publishedAt);

    const metaParts = [];
    if (tag) metaParts.push(`<span class="${L}-meta-chip">${ctx.escapeHtmlAttr(tag)}</span>`);
    if (date) metaParts.push(`<span class="${L}-meta-date">${ctx.escapeHtmlAttr(date)}</span>`);

    const badge = m.isGated
      ? `<span class="${L}-badge" aria-label="${ctx.escapeHtmlAttr(ctx.t('ariaMembersLabel'))}">${ctx.escapeHtmlAttr(ctx.t('membersLabel'))}</span>`
      : '';

    const position = Number.isNaN(Number(m.position)) ? '' : Number(m.position);

    return `
      <a href="${ctx.escapeHtmlAttr(m.url)}" class="${L}-row ${L}-row-post ${P}-result-link"
         id="${L}-row-${idx}" role="option" aria-selected="false"
         data-index="${idx}" data-result-id="${ctx.escapeHtmlAttr(m.id)}"
         data-result-position="${position}" aria-label="${m.ariaTitle}">
        <span class="${L}-row-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3v4a1 1 0 0 0 1 1h4"></path>
            <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"></path>
          </svg>
        </span>
        <span class="${L}-row-title">${m.titleHtml}</span>
        <span class="${L}-row-meta">${metaParts.join('')}${badge}</span>
        <span class="${L}-row-enter" aria-hidden="true">↵</span>
      </a>`;
  }

  function facetRowHtml(kind, sigil, value, count) {
    flatItems.push({ kind, value: String(value) });
    const idx = flatItems.length - 1;
    return `
      <div class="${L}-row ${L}-row-${kind}" id="${L}-row-${idx}"
           role="option" aria-selected="false" data-index="${idx}">
        <span class="${L}-row-icon ${L}-row-icon-sigil" aria-hidden="true">${ctx.escapeHtmlAttr(sigil)}</span>
        <span class="${L}-row-title">${ctx.escapeHtmlAttr(value)}</span>
        <span class="${L}-row-meta"><span class="${L}-meta-count">${ctx.escapeHtmlAttr(String(count))}</span></span>
      </div>`;
  }

  // In-surface keyboard navigation. Returns true when the key was consumed so
  // the core (which owns Esc and Cmd/Ctrl+K) can tell whether to act on it.
  function handleKeydownImpl(e) {
    // Core owns Esc and Cmd/Ctrl+K — never consume them here.
    if (e.key === 'Escape') return false;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        return true;
      case 'Home':
        e.preventDefault();
        setActive(0);
        return true;
      case 'End':
        e.preventDefault();
        setActive(flatItems.length - 1);
        return true;
      case 'PageDown':
        e.preventDefault();
        moveGroup(1);
        return true;
      case 'PageUp':
        e.preventDefault();
        moveGroup(-1);
        return true;
      case 'Enter':
        if (flatItems.length === 0) return false;
        e.preventDefault();
        activate(activeIndex, e.metaKey || e.ctrlKey);
        return true;
      default:
        return false;
    }
  }

  // Compose the full results surface from the stored model + facet counts.
  function renderSurface() {
    if (!refs.results) return;
    flatItems = [];

    if (!currentModel || currentModel.length === 0) {
      refs.results.innerHTML = `
        <div class="${L}-empty">
          <p class="${L}-empty-title">${ctx.t('paletteNoResultsTitle').replace('{q}', ctx.escapeHtmlAttr(currentQuery))}</p>
          <p class="${L}-empty-sub">${ctx.t('paletteNoResultsSub')}</p>
        </div>`;
      activeIndex = 0;
      applyActive();
      setStatus(pluralResults(0));
      return;
    }

    const sections = [];

    // --- Posts bucket ---
    const postRows = currentModel.map((m) => postRowHtml(m));
    sections.push(`
      <div class="${L}-group" role="group" aria-label="${ctx.t('palettePostsGroup')}">
        <div class="${L}-group-label">${ctx.t('palettePostsGroup')}
          <span class="${L}-group-count">${currentModel.length}</span>
        </div>
        ${postRows.join('')}
      </div>`);

    // --- Tags bucket ---
    const tagFacet = facetByName('tag');
    if (tagFacet && Array.isArray(tagFacet.counts) && tagFacet.counts.length) {
      const rows = tagFacet.counts
        .slice(0, FACET_LIMIT)
        .map((c) => facetRowHtml('tag', '#', c.value, c.count));
      sections.push(`
        <div class="${L}-group" role="group" aria-label="${ctx.t('paletteTagsGroup')}">
          <div class="${L}-group-label">${ctx.t('paletteTagsGroup')}</div>
          ${rows.join('')}
        </div>`);
    }

    // --- Authors bucket ---
    const authorFacet = facetByName('author');
    if (authorFacet && Array.isArray(authorFacet.counts) && authorFacet.counts.length) {
      const rows = authorFacet.counts
        .slice(0, FACET_LIMIT)
        .map((c) => facetRowHtml('author', '@', c.value, c.count));
      sections.push(`
        <div class="${L}-group" role="group" aria-label="${ctx.t('paletteAuthorsGroup')}">
          <div class="${L}-group-label">${ctx.t('paletteAuthorsGroup')}</div>
          ${rows.join('')}
        </div>`);
    }

    refs.results.innerHTML = sections.join('');
    activeIndex = 0;
    applyActive();
    setStatus(pluralResults(currentModel.length));
  }

  return {
    id: 'palette',

    requiredFields() {
      return ['authors'];
    },

    buildMarkup() {
      return `
        <div id="${L}" class="${L} ${P}-hidden" role="dialog" aria-modal="true"
             aria-label="${ctx.t('ariaModalLabel')}">
          <div class="${P}-backdrop ${L}-backdrop"></div>
          <div class="${L}-panel">
            <div class="${L}-searchbar">
              <span class="${L}-magnifier" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="7"></circle>
                  <line x1="21" y1="21" x2="16.5" y2="16.5"></line>
                </svg>
              </span>
              <input class="${L}-input ${P}-input" type="search" role="combobox"
                     aria-expanded="true" aria-controls="${L}-listbox"
                     aria-autocomplete="list" autocomplete="off" autocorrect="off"
                     autocapitalize="off" spellcheck="false" maxlength="512"
                     placeholder="${ctx.t('searchPlaceholder')}"
                     aria-label="${ctx.t('ariaSearchLabel')}" />
              <kbd class="${P}-kbd ${L}-esc-hint">esc</kbd>
            </div>
            <div id="${L}-listbox" class="${L}-results" role="listbox" tabindex="-1"
                 aria-label="${ctx.t('ariaResultsLabel')}"></div>
            <div class="${L}-footer">
              <span class="${L}-hint">
                <kbd class="${P}-kbd">↑</kbd><kbd class="${P}-kbd">↓</kbd>
                <span>${ctx.t('paletteHintNavigate')}</span>
              </span>
              <span class="${L}-hint">
                <kbd class="${P}-kbd">↵</kbd><span>${ctx.t('paletteHintOpen')}</span>
              </span>
              <span class="${L}-hint">
                <kbd class="${P}-kbd">⌘↵</kbd><span>${ctx.t('paletteHintNewTab')}</span>
              </span>
              <span class="${L}-hint">
                <kbd class="${P}-kbd">esc</kbd><span>${ctx.t('paletteHintClose')}</span>
              </span>
              <span class="${L}-hint ${L}-status" aria-live="polite"></span>
            </div>
          </div>
        </div>`;
    },

    cacheElements(shadowRoot) {
      root = shadowRoot;
      refs.panel = root.getElementById(`${L}`);
      refs.backdrop = root.querySelector(`.${L}-backdrop`);
      refs.input = root.querySelector(`.${L}-input`);
      refs.results = root.getElementById(`${L}-listbox`);
      refs.status = root.querySelector(`.${L}-status`);
      // Exposed for parity with the core's expectations.
      this.input = refs.input;
      this.facetsContainer = refs.results;
    },

    bindEvents() {
      if (refs.backdrop) {
        refs.backdrop.addEventListener('click', () => ctx.close());
      }

      if (refs.input) {
        refs.input.addEventListener('input', (e) => {
          const value = e.target.value;
          currentQuery = value;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => ctx.search(value), DEBOUNCE_MS);
        });
      }

      // In-surface keyboard navigation. The core does not forward keydown to
      // alt layouts, so the layout wires its own listener on the panel. Stop
      // propagation when consumed so keypresses don't leak past the shadow DOM
      // (mirrors the modal's stopPropagation behaviour for the search input).
      if (refs.panel) {
        refs.panel.addEventListener('keydown', (e) => {
          if (handleKeydownImpl(e)) e.stopPropagation();
        });
      }

      if (refs.results) {
        // Capture-phase click tracking on post rows, before navigation begins
        // unloading the page (mirrors the core's delegated handler).
        refs.results.addEventListener('click', (e) => {
          const link = e.target.closest(`.${P}-result-link`);
          if (!link) return;
          const position = Number(link.dataset.resultPosition);
          ctx.trackClick(link.dataset.resultId, Number.isNaN(position) ? null : position);
        }, true);

        // Selection click handling for every row kind (recent/tag/author rows
        // refine; posts let the anchor navigate after the capture-phase track).
        refs.results.addEventListener('click', (e) => {
          const rowEl = e.target.closest(`.${L}-row`);
          if (!rowEl) return;
          const index = Number(rowEl.dataset.index);
          if (Number.isNaN(index)) return;
          const item = flatItems[index];
          activeIndex = index;
          applyActive();
          // Posts are real anchors — let the browser navigate (modifier-aware)
          // rather than calling window.location, so middle-click / cmd-click
          // keep their native behaviour and analytics already fired above.
          if (item && item.kind === 'post') {
            pushRecent(currentQuery);
            return;
          }
          e.preventDefault();
          activate(index, e.metaKey || e.ctrlKey);
        });
      }
    },

    onOpen() {
      if (refs.panel) refs.panel.classList.remove(`${P}-hidden`);
      // Refresh recent (another tab may have written it) and show the recent
      // surface if nothing has been typed yet.
      if (!currentQuery.trim()) {
        recent = loadRecent();
        this.renderInitial();
      }
    },

    onClose() {
      if (refs.panel) refs.panel.classList.add(`${P}-hidden`);
      if (refs.input) refs.input.value = '';
      currentQuery = '';
      currentModel = [];
      currentFacetCounts = [];
      flatItems = [];
      activeIndex = 0;
    },

    focusInput() {
      // Defer until the panel is visible/painted before focusing + selecting.
      window.requestAnimationFrame(() => {
        if (refs.input) {
          refs.input.focus();
          refs.input.select();
        }
      });
    },

    setQuery(q) {
      if (refs.input) refs.input.value = q;
      currentQuery = q || '';
    },

    getQuery() {
      return refs.input ? refs.input.value : '';
    },

    setTheme(isDark) {
      if (refs.panel) refs.panel.classList.toggle(`${P}-dark`, isDark);
    },

    renderInitial() {
      currentModel = [];
      currentFacetCounts = [];
      activeIndex = 0;
      setStatus('');
      if (refs.results) refs.results.innerHTML = recentSurfaceHtml();
      applyActive();
    },

    renderLoading() {
      setStatus(ctx.t('paletteSearching'));
    },

    renderEmpty(query) {
      currentModel = [];
      currentQuery = query || currentQuery;
      renderSurface();
    },

    renderResults(model, meta) {
      currentModel = Array.isArray(model) ? model : [];
      if (meta) {
        if (typeof meta.query === 'string') currentQuery = meta.query;
        if (Array.isArray(meta.facetCounts)) currentFacetCounts = meta.facetCounts;
      }
      renderSurface();
    },

    renderSuggestions() {
      // The palette uses its own localStorage-backed "Recent searches" group
      // for the pre-typing surface, so core suggestions are not rendered here.
    },

    renderFacets(counts) {
      // The seam calls this before renderResults; store the counts so the
      // composed surface can build the Tags / Authors buckets. Re-render only
      // when results are already on screen (avoids clobbering the recent view).
      currentFacetCounts = Array.isArray(counts) ? counts : [];
      if (currentModel.length) renderSurface();
    },

    handleKeydown(e) {
      return handleKeydownImpl(e);
    }
  };
}
