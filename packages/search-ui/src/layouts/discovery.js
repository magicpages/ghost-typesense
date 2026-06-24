// Discovery two-pane layout (uiStyle: 'discovery').
//
// A wide content explorer: a facet rail (tags + authors), a compact results
// list, and a live preview pane (feature image, title, full excerpt, date,
// tags, author, members badge, "Read post" link). Arrow keys move the
// selection and the preview follows live. Collapses to a single column on
// narrow widths.
//
// Ported from the playground prototype
// (apps/playground/src/prototypes/discovery.js). All mutable state lives in
// the factory closure (no module-level singleton). Search, facets, analytics,
// and lifecycle are core-driven through ctx; this layout owns only markup,
// rendering, and in-surface keyboard navigation.
//
// Rendering contract: renderResults receives the NormalizedResult model from
// the core. titleHtml/excerptHtml are trusted (assigned via innerHTML); all
// other fields (url, featureImage, tags, authors, id, visibility) are raw and
// MUST be escaped with ctx.escapeHtmlAttr before reaching HTML/attributes.

export default function createDiscoveryLayout(ctx) {
  const P = ctx.prefix;
  const esc = (v) => ctx.escapeHtmlAttr(v);

  // ---- Closure state (was a module-level singleton in the prototype) ------
  let root = null;
  const refs = {};
  // The currently rendered model (NormalizedResult[]) and selection.
  let model = [];
  let selectedIndex = -1;
  let debounce = null;
  // Last facet counts + selection, kept so the rail can re-render values that
  // a narrowing selection removed from the live counts.
  let lastFacetCounts = [];

  // ---- Pure helpers -------------------------------------------------------

  function formatDate(epochMs) {
    if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return '';
    try {
      return new Date(epochMs).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '';
    }
  }

  // Facet field → translated group label. Tags index under tags.name, authors
  // under authors — the two fields the discovery rail surfaces.
  function facetGroups() {
    return [
      { field: 'tags.name', label: ctx.t('facetTopicsLabel') },
      { field: 'authors', label: ctx.t('facetAuthorsLabel') }
    ];
  }

  // The gated members badge, mirroring the shared modal markup. Both strings
  // come through ctx.t so they stay translatable.
  function gatedBadge() {
    return `<span class="${P}-gated-badge" aria-label="${esc(ctx.t('ariaMembersLabel'))}">`
      + `<span aria-hidden="true">🔒</span> ${esc(ctx.t('membersLabel'))}</span>`;
  }

  // ---- Selection ----------------------------------------------------------

  function applySelectionClasses() {
    if (!refs.results) return;
    const cards = refs.results.querySelectorAll(`.${P}-discovery-card`);
    cards.forEach((card) => {
      const idx = Number(card.dataset.index);
      const on = idx === selectedIndex;
      card.classList.toggle(`${P}-selected`, on);
      card.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (selectedIndex >= 0) {
      refs.results.setAttribute('aria-activedescendant', `${P}-discovery-opt-${selectedIndex}`);
    } else {
      refs.results.removeAttribute('aria-activedescendant');
    }
  }

  function selectIndex(index, opts = {}) {
    if (index < 0 || index >= model.length) return;
    if (index === selectedIndex) return;
    selectedIndex = index;
    applySelectionClasses();
    if (opts.scroll !== false && refs.results) {
      const card = refs.results.querySelector(`[data-index="${index}"]`);
      if (card) card.scrollIntoView({ block: 'nearest' });
    }
    renderPreview();
  }

  function moveSelection(delta) {
    if (model.length === 0) return;
    let next = selectedIndex < 0 ? (delta > 0 ? 0 : model.length - 1) : selectedIndex + delta;
    if (next < 0) next = 0;
    if (next > model.length - 1) next = model.length - 1;
    selectIndex(next);
  }

  // Open the selected result: emit a click event (capture-equivalent: before
  // navigation) attributed to the query that produced it, then navigate.
  function openSelected() {
    const m = model[selectedIndex];
    if (!m || !m.url || m.url === '#') return;
    ctx.trackClick(m.id, m.position);
    window.location.assign(m.url);
  }

  // ---- Preview ------------------------------------------------------------

  function renderPreview() {
    if (!refs.preview) return;
    const m = model[selectedIndex];

    if (!m) {
      const msg = model.length ? ctx.t('discoverySelectPrompt') : ctx.t('discoveryNoSelection');
      refs.preview.innerHTML = `<div class="${P}-discovery-preview-empty">${esc(msg)}</div>`;
      return;
    }

    const parts = [];

    // Hero image — feature_image is often null (e.g. text-only posts). When it
    // is absent the preview omits the hero entirely rather than showing a
    // placeholder, so an image-less post reads as a clean text preview.
    if (m.featureImage) {
      parts.push(
        `<img class="${P}-discovery-hero" src="${esc(m.featureImage)}" alt="" loading="lazy" />`
      );
    }

    // Title — trusted highlight markup.
    parts.push(`<h2 class="${P}-discovery-preview-title">${m.titleHtml}</h2>`);

    // Byline: author · date · members badge.
    const byline = [];
    if (Array.isArray(m.authors) && m.authors.length) {
      const authorsText = m.authors.map((a) => esc(a)).join(', ');
      byline.push(`<span>${esc(ctx.t('byLabel'))} ${authorsText}</span>`);
    }
    const dateStr = formatDate(m.publishedAt);
    if (dateStr) byline.push(`<span>${esc(dateStr)}</span>`);
    if (m.isGated) byline.push(gatedBadge());
    if (byline.length) {
      parts.push(
        `<div class="${P}-discovery-preview-byline">`
        + byline.join(`<span class="${P}-discovery-dot" aria-hidden="true">·</span>`)
        + `</div>`
      );
    }

    // Gated notice — never render a protected body; only the teaser/excerpt is
    // present in the index for non-public posts.
    if (m.isGated) {
      parts.push(
        `<div class="${P}-discovery-gated-notice" role="note">${esc(ctx.t('discoveryGatedNotice'))}</div>`
      );
    }

    // Body teaser — the excerpt highlight markup is trusted.
    if (m.excerptHtml) {
      parts.push(`<p class="${P}-discovery-preview-body">${m.excerptHtml}</p>`);
    }

    // Tags row.
    if (Array.isArray(m.tags) && m.tags.length) {
      const tags = m.tags
        .map((t) => `<span class="${P}-discovery-tag">${esc(t)}</span>`)
        .join('');
      parts.push(`<div class="${P}-discovery-preview-tags">${tags}</div>`);
    }

    // Read-post link. Carries the result-link class + data attributes so the
    // delegated click handler (bindEvents) emits the click analytics event.
    if (m.url && m.url !== '#') {
      parts.push(
        `<a href="${esc(m.url)}" class="${P}-result-link ${P}-discovery-open" `
        + `data-result-id="${esc(m.id)}" data-result-position="${m.position}" rel="noopener">`
        + `${esc(ctx.t('readPostLabel'))} <span aria-hidden="true">→</span></a>`
      );
    }

    refs.preview.innerHTML = parts.join('');
  }

  // ---- Facet rail ---------------------------------------------------------

  function renderFacetsFrom(counts, selected) {
    if (!refs.facets) return;
    const byField = new Map(
      (Array.isArray(counts) ? counts : []).map((fc) => [fc.field_name, fc])
    );
    const sel = selected || {};

    const groupsHtml = [];
    for (const group of facetGroups()) {
      const fc = byField.get(group.field);
      const fcCounts = fc && Array.isArray(fc.counts) ? fc.counts : [];
      const selectedSet = sel[group.field] instanceof Set ? sel[group.field] : new Set();

      // Show a group if it has counts OR an active selection (so a value that
      // narrowed the set to where it no longer appears can still be cleared).
      if (fcCounts.length === 0 && selectedSet.size === 0) continue;

      // Merge selected values missing from the live counts.
      const seen = new Set();
      const rows = [];
      for (const c of fcCounts) {
        seen.add(c.value);
        rows.push({ value: c.value, count: c.count });
      }
      for (const v of selectedSet) {
        if (!seen.has(v)) rows.push({ value: v, count: 0 });
      }

      const chips = rows
        .map((row) => {
          const on = selectedSet.has(row.value);
          return (
            `<button type="button" class="${P}-facet-chip ${P}-discovery-facet-chip" `
            + `aria-pressed="${on ? 'true' : 'false'}" `
            + `data-facet-field="${esc(group.field)}" data-facet-value="${esc(row.value)}">`
            + `<span class="${P}-discovery-facet-box" aria-hidden="true">${on ? '✓' : ''}</span>`
            + `<span class="${P}-discovery-facet-label">${esc(row.value)}</span>`
            + `<span class="${P}-discovery-facet-count">${esc(row.count)}</span>`
            + `</button>`
          );
        })
        .join('');

      groupsHtml.push(
        `<div class="${P}-facet-group ${P}-discovery-facet-group">`
        + `<p class="${P}-discovery-facet-title">${esc(group.label)}</p>`
        + `<div class="${P}-facet-chips" role="group" aria-label="${esc(group.label)}">${chips}</div>`
        + `</div>`
      );
    }

    if (groupsHtml.length === 0) {
      refs.facets.innerHTML = `<p class="${P}-discovery-facet-empty">${esc(ctx.t('discoveryNoFilters'))}</p>`;
      return;
    }

    const hasSelection = Object.values(sel).some((s) => s instanceof Set && s.size > 0);
    const clearBtn = hasSelection
      ? `<button type="button" class="${P}-facet-clear ${P}-discovery-facet-clear">${esc(ctx.t('clearFiltersLabel'))}</button>`
      : '';

    refs.facets.innerHTML = groupsHtml.join('') + clearBtn;
  }

  // ---- Public layout interface -------------------------------------------

  return {
    id: 'discovery',

    requiredFields() {
      return ['authors', 'feature_image'];
    },

    buildMarkup() {
      return `
        <div id="${P}-discovery" class="${P}-discovery ${P}-hidden" role="dialog" aria-modal="true" aria-label="${esc(ctx.t('ariaModalLabel'))}">
          <div class="${P}-backdrop"></div>
          <div class="${P}-discovery-panel" role="document">
            <div class="${P}-discovery-header">
              <div class="${P}-discovery-search">
                <input type="search" class="${P}-discovery-input ${P}-input" placeholder="${esc(ctx.t('searchPlaceholder'))}"
                  autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="512"
                  aria-label="${esc(ctx.t('ariaSearchLabel'))}" />
              </div>
              <div class="${P}-discovery-header-meta">
                <span class="${P}-discovery-count" role="status" aria-live="polite"></span>
                <button class="${P}-close" aria-label="${esc(ctx.t('ariaCloseLabel'))}"><span aria-hidden="true">×</span></button>
              </div>
            </div>
            <div class="${P}-discovery-body">
              <aside id="${P}-facets" class="${P}-discovery-rail ${P}-facets" role="group" aria-label="${esc(ctx.t('ariaFacetsLabel'))}"></aside>
              <div id="${P}-discovery-results" class="${P}-discovery-results" role="listbox" tabindex="-1" aria-label="${esc(ctx.t('ariaResultsLabel'))}"></div>
              <section id="${P}-discovery-preview" class="${P}-discovery-preview" aria-live="polite" aria-label="${esc(ctx.t('discoveryPreviewLabel'))}"></section>
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
      refs.facets = root.getElementById(`${P}-facets`);
      refs.count = root.querySelector(`.${P}-discovery-count`);
      // Exposed for parity with the core's expectations.
      this.input = refs.input;
      this.facetsContainer = refs.facets;
    },

    bindEvents() {
      const closeBtn = root.querySelector(`.${P}-close`);
      if (closeBtn) closeBtn.addEventListener('click', () => ctx.close());

      if (refs.panel) {
        refs.panel.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains(`${P}-backdrop`)) ctx.close();
        });
      }

      // Debounced, core-driven search (~80ms).
      if (refs.input) {
        refs.input.addEventListener('input', (e) => {
          const q = e.target.value;
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => ctx.search(q), 80);
        });
      }

      // Result list: hover selects (preview follows), click selects + opens.
      // The click handler runs in capture phase so trackClick fires before
      // navigation begins unloading the page.
      if (refs.results) {
        refs.results.addEventListener('click', (e) => {
          const card = e.target.closest(`.${P}-discovery-card`);
          if (!card) return;
          const idx = Number(card.dataset.index);
          if (Number.isNaN(idx)) return;
          selectIndex(idx);
          openSelected();
        }, true);
        refs.results.addEventListener('mousemove', (e) => {
          const card = e.target.closest(`.${P}-discovery-card`);
          if (!card) return;
          const idx = Number(card.dataset.index);
          if (!Number.isNaN(idx)) selectIndex(idx, { scroll: false });
        });
      }

      // Preview "Read post" link analytics (capture, before navigation).
      if (refs.preview) {
        refs.preview.addEventListener('click', (e) => {
          const link = e.target.closest(`.${P}-result-link`);
          if (!link) return;
          const position = Number(link.dataset.resultPosition);
          ctx.trackClick(link.dataset.resultId, Number.isNaN(position) ? null : position);
        }, true);
      }

      // Facet rail: chip toggle → core toggleFacet + requery; clear → core
      // clearFacets + requery. The core re-runs the active query and calls
      // renderFacets/renderResults with fresh counts.
      if (refs.facets) {
        refs.facets.addEventListener('click', (e) => {
          const clear = e.target.closest(`.${P}-facet-clear`);
          if (clear) {
            e.preventDefault();
            ctx.clearFacets();
            ctx.requery();
            return;
          }
          const chip = e.target.closest(`.${P}-facet-chip`);
          if (!chip) return;
          e.preventDefault();
          const field = chip.dataset.facetField;
          const value = chip.dataset.facetValue;
          if (!field || value === undefined) return;
          ctx.toggleFacet(field, value);
          ctx.requery();
        });
      }
    },

    onOpen() {
      if (refs.panel) refs.panel.classList.remove(`${P}-hidden`);
      // Paint the welcoming initial state if nothing has been typed yet — the
      // seam doesn't render layouts on open, so without this the panes show as
      // bare empty columns.
      if (!(refs.input && refs.input.value.trim())) this.renderInitial();
    },

    onClose() {
      if (refs.panel) refs.panel.classList.add(`${P}-hidden`);
      if (refs.input) refs.input.value = '';
      if (debounce) { clearTimeout(debounce); debounce = null; }
      model = [];
      selectedIndex = -1;
      lastFacetCounts = [];
    },

    focusInput() {
      setTimeout(() => refs.input && refs.input.focus(), 50);
    },

    setQuery(q) {
      if (refs.input) refs.input.value = q;
    },

    getQuery() {
      return refs.input ? refs.input.value : '';
    },

    setTheme(isDark) {
      if (refs.panel) refs.panel.classList.toggle(`${P}-dark`, isDark);
    },

    // Empty query: show a single welcoming prompt that spans the results +
    // preview area (the panel sets the body to a single column in this state),
    // so the surface reads as an invitation rather than bare empty panes.
    renderInitial() {
      model = [];
      selectedIndex = -1;
      if (refs.panel) refs.panel.classList.add(`${P}-discovery-initial`);
      if (refs.results) {
        refs.results.innerHTML =
          `<div class="${P}-discovery-prompt">`
          + `<div class="${P}-discovery-prompt-icon" aria-hidden="true">`
          + '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
          + '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>'
          + '</svg></div>'
          + `<p class="${P}-discovery-prompt-title">${esc(ctx.t('discoveryEmptyTitle'))}</p>`
          + `<p class="${P}-discovery-prompt-hint">${esc(ctx.t('discoveryEmptyHint'))}</p>`
          + '</div>';
        refs.results.removeAttribute('aria-activedescendant');
      }
      if (refs.preview) refs.preview.innerHTML = '';
      if (refs.facets) refs.facets.innerHTML = '';
      if (refs.count) refs.count.textContent = '';
    },

    renderLoading() {
      if (refs.panel) refs.panel.classList.remove(`${P}-discovery-initial`);
      if (refs.results && model.length === 0) {
        refs.results.innerHTML = `<div class="${P}-discovery-empty">${esc(ctx.t('loadingMessage'))}</div>`;
      }
    },

    renderEmpty(query) {
      model = [];
      selectedIndex = -1;
      if (refs.panel) refs.panel.classList.remove(`${P}-discovery-initial`);
      const q = (query || '').trim();
      if (refs.results) {
        refs.results.innerHTML = `<div class="${P}-discovery-empty">${esc(ctx.t('noResultsMessage'))}</div>`;
        refs.results.removeAttribute('aria-activedescendant');
      }
      if (refs.preview) {
        refs.preview.innerHTML = `<div class="${P}-discovery-preview-empty">${esc(ctx.t('discoveryNoSelection'))}</div>`;
      }
      if (refs.count) refs.count.textContent = q ? `0 ${ctx.t('resultsLabel')}` : '';
    },

    renderResults(nextModel, meta) {
      if (!refs.results) return;
      if (refs.panel) refs.panel.classList.remove(`${P}-discovery-initial`);

      // Preserve the selected post (by id) across the re-render where possible;
      // otherwise default to the first hit.
      const prev = model[selectedIndex];
      const prevId = prev ? prev.id : null;

      model = Array.isArray(nextModel) ? nextModel : [];

      selectedIndex = model.length ? 0 : -1;
      if (prevId != null) {
        const idx = model.findIndex((m) => m.id === prevId);
        if (idx >= 0) selectedIndex = idx;
      }

      refs.results.innerHTML = model
        .map((m) => {
          const metaParts = [];
          const tags = Array.isArray(m.tags) ? m.tags.slice(0, 2) : [];
          for (const t of tags) {
            metaParts.push(`<span class="${P}-discovery-tag">${esc(t)}</span>`);
          }
          const dateStr = formatDate(m.publishedAt);
          if (dateStr) metaParts.push(`<span>${esc(dateStr)}</span>`);
          if (m.isGated) metaParts.push(gatedBadge());
          const metaHtml = metaParts.join(`<span class="${P}-discovery-dot" aria-hidden="true">·</span>`);

          return (
            `<div class="${P}-discovery-card" id="${P}-discovery-opt-${m.position}" role="option" `
            + `aria-selected="false" data-index="${m.position}" `
            + `data-result-id="${esc(m.id)}" data-result-position="${m.position}" `
            + `aria-label="${m.ariaTitle}">`
            + `<p class="${P}-discovery-card-title">${m.titleHtml}</p>`
            + (m.excerptHtml ? `<p class="${P}-discovery-card-excerpt">${m.excerptHtml}</p>` : '')
            + (metaHtml ? `<div class="${P}-discovery-card-meta">${metaHtml}</div>` : '')
            + `</div>`
          );
        })
        .join('');

      applySelectionClasses();
      renderPreview();

      const found = meta && typeof meta.found === 'number' ? meta.found : model.length;
      if (refs.count) {
        refs.count.textContent = `${found} ${found === 1 ? ctx.t('resultLabel') : ctx.t('resultsLabel')}`;
      }
    },

    // The core handles suggestion fetching; discovery surfaces suggestions only
    // through the empty/initial prompt, so there is nothing to re-render here.
    renderSuggestions() {},

    renderFacets(counts, selected) {
      lastFacetCounts = Array.isArray(counts) ? counts : [];
      renderFacetsFrom(lastFacetCounts, selected || ctx.getSelectedFacets());
    },

    // In-surface keyboard navigation. Returns true when the key was consumed so
    // the core leaves it alone. Esc and Cmd/Ctrl+K are owned by the core.
    handleKeydown(e) {
      const inInput = e.target === refs.input;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveSelection(1);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          moveSelection(-1);
          return true;
        case 'Home':
          if (inInput) return false;
          e.preventDefault();
          selectIndex(0);
          return true;
        case 'End':
          if (inInput) return false;
          e.preventDefault();
          selectIndex(model.length - 1);
          return true;
        case 'PageDown':
          e.preventDefault();
          moveSelection(5);
          return true;
        case 'PageUp':
          e.preventDefault();
          moveSelection(-5);
          return true;
        case 'Enter':
          if (selectedIndex >= 0) {
            e.preventDefault();
            openSelected();
            return true;
          }
          return false;
        default:
          return false;
      }
    }
  };
}
