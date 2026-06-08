import Typesense from 'typesense';

(function () {
    let isInitialized = false;
    let observer = null;

    function cleanupGhostSearch() {
        // Only cleanup after we've initialized
        if (!isInitialized) return;

        const searchScript = document.querySelector('script[data-sodo-search]');
        if (searchScript) searchScript.remove();
        const searchRoot = document.getElementById('sodo-search-root');
        if (searchRoot) searchRoot.remove();
    }

    function setupCleanup() {
        // Setup observer only after we've initialized
        observer = new MutationObserver((mutations) => {
            if (!isInitialized) return;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.tagName === 'SCRIPT' && node.hasAttribute('data-sodo-search')) {
                            node.remove();
                        } else if (node.id === 'sodo-search-root') {
                            node.remove();
                        }
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // Also set up periodic cleanup just in case
        const cleanupInterval = setInterval(cleanupGhostSearch, 100);
        // Stop checking after 5 seconds
        setTimeout(() => {
            clearInterval(cleanupInterval);
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }, 5000);
    }

    // CSS class prefix to avoid conflicts (kept for consistency)
    const CSS_PREFIX = 'mp-search';

    // Web Component Definition
    class MagicPagesSearchElement extends HTMLElement {
        constructor() {
            super();

            // Attach shadow DOM for style encapsulation
            this.attachShadow({ mode: 'open' });

            this.isModalOpen = false;
            this.activeElement = null;
            this.scrollPosition = 0;
            this.selectedIndex = -1;
            this.searchDebounceTimeout = null;
            this.cachedElements = {};
            this.typesenseClient = null;

            // Analytics: the query that produced the currently rendered
            // results (used to attribute clicks), and the last query for
            // which a `search` event was already emitted (de-dupes repeats).
            this.lastQuery = '';
            this.lastTrackedQuery = null;

            // Reader-selected facet values, keyed by field name. Each value is
            // a Set of the chosen values for that field. Reset when the modal
            // closes. Only used when `facets` is configured.
            this.selectedFacets = {};

            // Suggestions fetched from `suggestionsUrl`, cached for the page
            // session. `suggestionsFetched` guards against re-fetching (and
            // re-failing) on every modal open.
            this.fetchedSuggestions = [];
            this.suggestionsFetched = false;

            // Default English translations
            this.defaultI18n = {
                searchPlaceholder: 'Search for anything',
                commonSearchesTitle: 'Common searches',
                emptyStateMessage: 'Start typing to search...',
                loadingMessage: 'Searching...',
                noResultsMessage: 'No results found for your search',
                navigateHint: 'to navigate',
                closeHint: 'to close',
                ariaSearchLabel: 'Search',
                ariaCloseLabel: 'Close search',
                ariaResultsLabel: 'Search results',
                ariaArticleExcerpt: 'Article excerpt',
                ariaModalLabel: 'Search',
                ariaFacetsLabel: 'Filters',
                clearFiltersLabel: 'Clear filters',
                untitledPost: 'Untitled'
            };
        }

        connectedCallback() {
            if (isInitialized) {
                return;
            }

            const defaultConfig = window.__MP_SEARCH_CONFIG__ || {
                typesenseNodes: [{
                    host: 'localhost',
                    port: '8108',
                    protocol: 'http'
                }],
                typesenseApiKey: null,
                collectionName: null,
                commonSearches: [],
                theme: 'system',
                enableHighlighting: true,
                enableDidYouMean: true,
                searchFields: {
                    title: { weight: 5, highlight: true },
                    excerpt: { weight: 3, highlight: true },
                    plaintext: { weight: 4, highlight: true },
                    'tags.name': { weight: 4, highlight: true },
                    'tags.slug': { weight: 3, highlight: true }
                }
            };

            this.config = {
                ...defaultConfig,
                commonSearches: defaultConfig.commonSearches || [],
                pinnedSearches: defaultConfig.pinnedSearches || [],
                facets: defaultConfig.facets || [],
                // Result layout: 'list' (default) or 'grid'. Normalise unknown
                // values to 'list' so the default behaviour can't be changed by
                // a typo.
                template: defaultConfig.template === 'grid' ? 'grid' : 'list'
            };

            if (!this.config.typesenseNodes || !this.config.typesenseApiKey || !this.config.collectionName) {
                throw new Error('MagicPagesSearch: Missing required Typesense configuration');
            }

            // Merge i18n with defaults (supports partial overrides)
            this.i18n = {
                ...this.defaultI18n,
                ...(this.config.i18n || {})
            };

            // Store locale for future use
            this.locale = this.config.locale || 'en';

            this.init();
            isInitialized = true;
        }

        // Translation helper method
        t(key) {
            return this.i18n[key] || this.defaultI18n[key] || key;
        }

        // Escape a value for safe interpolation into an HTML attribute. Used
        // for indexed values (e.g. a document id) that are written into the
        // results markup via innerHTML and would otherwise allow a crafted
        // value to break out of its attribute.
        escapeHtmlAttr(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Convert absolute URL to relative path
        toRelativeUrl(url) {
            if (!url) return '#';
            try {
                const parsed = new URL(url);
                return parsed.pathname + parsed.search + parsed.hash;
            } catch {
                // If URL parsing fails, return the original value
                return url;
            }
        }

        // Analytics is strictly opt-in: it is only active when the host page
        // provides an endpoint to receive events. With no `analytics.endpoint`
        // configured, the widget makes no requests beyond Typesense.
        isAnalyticsEnabled() {
            return !!(this.config.analytics && this.config.analytics.endpoint);
        }

        // Send a single analytics event. Uses navigator.sendBeacon so events
        // survive page navigation (clicking a result unloads the page) and
        // never block the UI thread, falling back to fetch(keepalive) where
        // sendBeacon is unavailable. Fully fail-silent: any transport error,
        // or a non-2xx response, must never surface to the reader or break
        // search.
        sendAnalyticsEvent(event) {
            if (!this.isAnalyticsEnabled()) return;

            try {
                const { endpoint, siteId, token } = this.config.analytics;
                const payload = {
                    ...event,
                    siteId: siteId || null,
                    token: token || undefined,
                    ts: Date.now()
                };
                const body = JSON.stringify(payload);

                // sendBeacon is the preferred transport: it is fire-and-forget
                // and is not cancelled when the document starts unloading.
                if (navigator.sendBeacon) {
                    const blob = new Blob([body], { type: 'application/json' });
                    if (navigator.sendBeacon(endpoint, blob)) return;
                }

                // Fallback for environments without sendBeacon.
                fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true,
                    mode: 'cors',
                    credentials: 'omit'
                }).catch(() => {});
            } catch {
                // Swallow everything — analytics must never affect search.
            }
        }

        // Emit a `search` event for a settled query, plus a derived
        // `zero_result` event when the query returned nothing. De-duplicated
        // so re-running the same settled query (e.g. reopening the modal with
        // a ?q= parameter) emits at most one `search` event.
        trackSearch(query, resultCount) {
            if (!this.isAnalyticsEnabled() || !query) return;
            if (query === this.lastTrackedQuery) return;
            this.lastTrackedQuery = query;

            this.sendAnalyticsEvent({ type: 'search', q: query, resultCount });

            if (resultCount === 0) {
                this.sendAnalyticsEvent({ type: 'zero_result', q: query, resultCount: 0 });
            }
        }

        // Emit a `click` event attributing a result selection to the query
        // that produced it. Called before navigation; sendBeacon survives the
        // unload that the navigation triggers.
        trackClick(resultId, position) {
            if (!this.isAnalyticsEnabled() || !this.lastQuery) return;
            this.sendAnalyticsEvent({
                type: 'click',
                q: this.lastQuery,
                resultId: resultId || null,
                position: typeof position === 'number' ? position : null
            });
        }

        // Resolve the suggestion list shown in the empty state, in priority
        // order: pinned terms first (publisher-curated), then any terms
        // fetched from `suggestionsUrl`, then the static `commonSearches`
        // fallback. Duplicates are collapsed (case-insensitively) so a term
        // never appears twice.
        getSuggestions() {
            const ordered = [
                ...(this.config.pinnedSearches || []),
                ...(this.fetchedSuggestions || []),
                ...(this.config.commonSearches || [])
            ];

            const seen = new Set();
            const result = [];
            for (const term of ordered) {
                if (typeof term !== 'string') continue;
                const trimmed = term.trim();
                if (!trimmed) continue;
                const key = trimmed.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                result.push(trimmed);
            }
            return result;
        }

        // Fetch suggestions from `suggestionsUrl` once per page session. The
        // endpoint may return either a bare string[] or { suggestions: [...] }.
        // Fail-silent: any error leaves fetchedSuggestions empty, so the empty
        // state falls back to pinned + commonSearches. The fetched flag is set
        // regardless of outcome so a failing URL is not retried on every open.
        async fetchSuggestions() {
            if (this.suggestionsFetched || !this.config.suggestionsUrl) return;
            this.suggestionsFetched = true;

            try {
                const response = await fetch(this.config.suggestionsUrl, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit'
                });
                if (!response.ok) return;

                const data = await response.json();
                const list = Array.isArray(data) ? data : data?.suggestions;
                if (Array.isArray(list)) {
                    this.fetchedSuggestions = list.filter(t => typeof t === 'string');
                }
            } catch {
                // Swallow — a failed fetch must not surface to the reader.
            }
        }

        // Rebuild the suggestions block in place from the current resolved
        // list. Replacing the block's contents discards the old delegated
        // click listener with its container, so a single re-attach is correct
        // (no double-binding).
        renderSuggestions() {
            if (!this.commonSearches) return;
            this.commonSearches.innerHTML = this.getCommonSearchesInnerHtml();
            this.attachCommonSearchListeners();
        }

        async init() {
            this.createShadowContent();
            this.cacheElements();
            this.updateTheme();
            this.initEventListeners();
            this.setupHashHandling();
            await this.handleInitialState();
        }

        createShadowContent() {
            // Create styles
            const styles = document.createElement('style');
            // eslint-disable-next-line no-undef
            styles.textContent = BUNDLED_CSS;

            // Create modal HTML
            const modalContainer = document.createElement('div');
            modalContainer.innerHTML = `
                <div id="${CSS_PREFIX}-modal" class="${CSS_PREFIX}-modal ${CSS_PREFIX}-hidden" role="dialog" aria-modal="true" aria-label="${this.t('ariaModalLabel')}">
                    <div class="${CSS_PREFIX}-backdrop"></div>
                    <div class="${CSS_PREFIX}-container">
                        <button class="${CSS_PREFIX}-close" aria-label="${this.t('ariaCloseLabel')}">
                            <span aria-hidden="true">×</span>
                        </button>
                        <div class="${CSS_PREFIX}-content">
                            <div class="${CSS_PREFIX}-header">
                                <div id="${CSS_PREFIX}-searchbox" role="search">
                                    <form class="${CSS_PREFIX}-form" role="search">
                                        <input
                                            type="search"
                                            class="${CSS_PREFIX}-input"
                                            placeholder="${this.t('searchPlaceholder')}"
                                            autocomplete="off"
                                            autocorrect="off"
                                            autocapitalize="off"
                                            spellcheck="false"
                                            maxlength="512"
                                            aria-label="${this.t('ariaSearchLabel')}"
                                        />
                                    </form>
                                </div>
                                <div class="${CSS_PREFIX}-hints">
                                    <span>
                                        <kbd class="${CSS_PREFIX}-kbd">↑↓</kbd>
                                        ${this.t('navigateHint')}
                                    </span>
                                    <span>
                                        <kbd class="${CSS_PREFIX}-kbd">esc</kbd>
                                        ${this.t('closeHint')}
                                    </span>
                                </div>
                            </div>
                            <div class="${CSS_PREFIX}-results-container">
                                ${this.getCommonSearchesHtml()}
                                <div id="${CSS_PREFIX}-facets" class="${CSS_PREFIX}-facets ${CSS_PREFIX}-hidden" role="group" aria-label="${this.t('ariaFacetsLabel')}"></div>
                                <div id="${CSS_PREFIX}-hits" class="${CSS_PREFIX}-hits-list" role="region" aria-label="${this.t('ariaResultsLabel')}"></div>
                                <div id="${CSS_PREFIX}-loading" class="${CSS_PREFIX}-loading ${CSS_PREFIX}-hidden" role="status" aria-live="polite">
                                    <div class="${CSS_PREFIX}-spinner" aria-hidden="true"></div>
                                    <div>${this.t('loadingMessage')}</div>
                                </div>
                                <div id="${CSS_PREFIX}-empty" class="${CSS_PREFIX}-empty ${CSS_PREFIX}-hidden" role="status" aria-live="polite">
                                    <div class="${CSS_PREFIX}-empty-message">
                                        <p>${this.t('noResultsMessage')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Append to shadow DOM
            this.shadowRoot.appendChild(styles);
            this.shadowRoot.appendChild(modalContainer.firstElementChild);
        }

        cacheElements() {
            this.modal = this.shadowRoot.getElementById(`${CSS_PREFIX}-modal`);
            this.searchInput = this.shadowRoot.querySelector(`.${CSS_PREFIX}-input`);
            this.searchForm = this.shadowRoot.querySelector(`.${CSS_PREFIX}-form`);
            this.hitsList = this.shadowRoot.querySelector(`#${CSS_PREFIX}-hits`);
            this.facetsContainer = this.shadowRoot.querySelector(`#${CSS_PREFIX}-facets`);
            this.commonSearches = this.shadowRoot.querySelector(`.${CSS_PREFIX}-common-searches`);
            this.loadingState = this.shadowRoot.querySelector(`#${CSS_PREFIX}-loading`);
            this.emptyState = this.shadowRoot.querySelector(`#${CSS_PREFIX}-empty`);
        }

        getCommonSearchesHtml() {
            return `
                <div class="${CSS_PREFIX}-common-searches">
                    ${this.getCommonSearchesInnerHtml()}
                </div>
            `;
        }

        // The inner markup of the suggestions block, so it can be re-rendered
        // independently once dynamic suggestions have been fetched. Suggestion
        // strings may originate from a remote `suggestionsUrl`, so every term
        // is escaped before being interpolated into the markup.
        getCommonSearchesInnerHtml() {
            const suggestions = this.getSuggestions();

            if (!suggestions.length) {
                return `
                    <div class="${CSS_PREFIX}-empty-message">${this.t('emptyStateMessage')}</div>
                `;
            }

            return `
                <div class="${CSS_PREFIX}-common-searches-title" role="heading" aria-level="2">
                    ${this.t('commonSearchesTitle')}
                </div>
                <div id="${CSS_PREFIX}-common-searches-container" role="list">
                    ${suggestions.map(search => {
                        const safe = this.escapeHtmlAttr(search);
                        return `
                            <button type="button"
                                class="${CSS_PREFIX}-common-search-btn"
                                data-search="${safe}"
                                role="listitem">
                                ${safe}
                            </button>
                        `;
                    }).join('')}
                </div>
            `;
        }

        updateTheme() {
            const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const isDarkMode = this.config.theme === 'light' ? false : (this.config.theme === 'dark' || preferDark);
            this.modal.classList.toggle(`${CSS_PREFIX}-dark`, isDarkMode);
        }

        initEventListeners() {
            // Close button
            const closeButton = this.shadowRoot.querySelector(`.${CSS_PREFIX}-close`);
            closeButton.addEventListener('click', () => this.closeModal());

            // Click outside to close
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal || e.target.classList.contains(`${CSS_PREFIX}-backdrop`)) {
                    this.closeModal();
                }
            });

            // Prevent clicks on modal content from closing
            const modalContent = this.shadowRoot.querySelector(`.${CSS_PREFIX}-container`);
            modalContent.addEventListener('click', (e) => e.stopPropagation());

            // Search form submission
            this.searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
            });

            // Search input
            this.searchInput.addEventListener('input', (e) => {
                const query = e.target.value;

                // Clear any pending search
                if (this.searchDebounceTimeout) {
                    clearTimeout(this.searchDebounceTimeout);
                }

                // Debounce search
                this.searchDebounceTimeout = setTimeout(() => {
                    this.handleSearch(query);
                }, 80);
            });

            // Result clicks (delegated) — emit a click event before the
            // browser navigates. Uses capture so it runs before the link's
            // default navigation begins unloading the page.
            if (this.hitsList) {
                this.hitsList.addEventListener('click', (e) => {
                    const link = e.target.closest(`.${CSS_PREFIX}-result-link`);
                    if (!link) return;
                    const position = Number(link.dataset.resultPosition);
                    this.trackClick(link.dataset.resultId, Number.isNaN(position) ? null : position);
                }, true);
            }

            // Common searches
            this.attachCommonSearchListeners();

            // Facet chips (delegated; container persists across re-renders)
            this.attachFacetListeners();

            // Keyboard shortcuts (attached to document, outside shadow DOM)
            document.addEventListener('keydown', (e) => {
                // Cmd/Ctrl + K to open
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                    e.preventDefault();
                    this.openModal();
                }

                // / to open (when not in input)
                if (e.key === '/' && !e.ctrlKey && !e.metaKey &&
                    e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.openModal();
                }

                // Escape to close
                if (e.key === 'Escape' && this.isModalOpen) {
                    e.preventDefault();
                    this.closeModal();
                }
            });

            // Handle keyboard navigation in modal
            this.modal.addEventListener('keydown', (e) => this.handleKeydown(e));

            // Handle Ghost's search buttons (outside shadow DOM)
            document.querySelectorAll('[data-ghost-search]').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                });
            });

            // Handle theme changes
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                this.updateTheme();
            });
        }

        attachCommonSearchListeners() {
            const container = this.shadowRoot.querySelector(`#${CSS_PREFIX}-common-searches-container`);
            if (!container) return;

            const handleClick = (e) => {
                const btn = e.target.closest(`.${CSS_PREFIX}-common-search-btn`);
                if (!btn) return;

                e.preventDefault();
                const searchTerm = btn.dataset.search;

                if (this.searchInput) {
                    this.selectedIndex = -1;
                    this.searchInput.value = searchTerm;
                    this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    setTimeout(() => {
                        this.searchInput.focus();
                        this.searchInput.setSelectionRange(searchTerm.length, searchTerm.length);
                    }, 0);
                }
            };

            container.addEventListener('click', handleClick);
            container.addEventListener('touchend', handleClick);
        }

        lockBodyScroll() {
            // Store current scroll position
            this.scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

            // Apply body lock styles
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.top = `-${this.scrollPosition}px`;
            document.body.style.width = '100%';
        }

        unlockBodyScroll() {
            // Remove body lock styles
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('position');
            document.body.style.removeProperty('top');
            document.body.style.removeProperty('width');

            // Restore scroll position
            window.scrollTo(0, this.scrollPosition);
        }

        async openModal() {
            if (this.isModalOpen) return;

            // Store active element for focus restoration
            this.activeElement = document.activeElement;

            // Show modal
            this.modal.classList.remove(`${CSS_PREFIX}-hidden`);
            this.isModalOpen = true;

            // Lock body scroll
            this.lockBodyScroll();

            // Focus search input
            setTimeout(() => {
                this.searchInput.focus();
            }, 50);

            // Lazily fetch dynamic suggestions on first open (no-op without a
            // suggestionsUrl), then re-render the list. Done after the modal is
            // shown so opening stays instant; the suggestions update in place
            // when the fetch resolves.
            if (this.config.suggestionsUrl && !this.suggestionsFetched) {
                this.fetchSuggestions().then(() => this.renderSuggestions());
            }

            // Update URL
            if (window.location.hash !== '#/search') {
                history.replaceState(null, null, `${window.location.pathname}${window.location.search}#/search`);
            }

            // Check for search query parameters
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');

            if (searchQuery && this.searchInput) {
                this.searchInput.value = searchQuery;
                this.handleSearch(searchQuery);
            }
        }

        closeModal() {
            if (!this.isModalOpen) return;

            // Hide modal
            this.modal.classList.add(`${CSS_PREFIX}-hidden`);
            this.isModalOpen = false;

            // Unlock body scroll
            this.unlockBodyScroll();

            // Clear search
            this.selectedIndex = -1;
            if (this.searchInput) {
                this.searchInput.value = '';
            }
            // Reset analytics session state so the next time the modal opens,
            // the first search is emitted even if it repeats a prior query.
            this.lastQuery = '';
            this.lastTrackedQuery = null;
            // Clear any active facet filters so a new session starts unfiltered.
            this.selectedFacets = {};
            this.handleSearch('');

            // Restore focus
            if (this.activeElement && typeof this.activeElement.focus === 'function') {
                this.activeElement.focus();
            }

            // Update URL
            if (window.location.hash === '#/search') {
                history.replaceState(null, null, `${window.location.pathname}${window.location.search}`);
            }
        }

        async handleSearch(query) {
            query = query?.trim();

            if (!query) {
                this.selectedIndex = -1;
                if (this.hitsList) this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.commonSearches) this.commonSearches.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.facetsContainer) this.facetsContainer.classList.add(`${CSS_PREFIX}-hidden`);
                return;
            }

            // Update UI immediately
            if (this.commonSearches) this.commonSearches.classList.add(`${CSS_PREFIX}-hidden`);
            if (this.hitsList) this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            if (this.loadingState) this.loadingState.classList.remove(`${CSS_PREFIX}-hidden`);
            if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);

            try {
                // Initialize Typesense client if not already initialized
                if (!this.typesenseClient) {
                    this.typesenseClient = new Typesense.Client({
                        nodes: this.config.typesenseNodes,
                        apiKey: this.config.typesenseApiKey,
                        connectionTimeoutSeconds: 2
                    });
                }

                const searchParams = this.getSearchParameters();
                const searchParameters = {
                    q: query,
                    ...searchParams
                };

                const results = await this.typesenseClient
                    .collections(this.config.collectionName)
                    .documents()
                    .search(searchParameters);


                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);

                // Total matches across all pages; fall back to the hit count
                // on this page when `found` is absent.
                const resultCount = typeof results.found === 'number'
                    ? results.found
                    : results.hits.length;

                // Remember the query behind the rendered results so a later
                // result click can be attributed to it.
                this.lastQuery = query;
                this.trackSearch(query, resultCount);

                // Render facet chips from the returned counts. Done before the
                // no-results check so a reader can still clear a filter that
                // produced zero results.
                if (this.config.facets?.length) {
                    this.renderFacets(results.facet_counts);
                }

                if (results.hits.length === 0) {
                    if (this.emptyState) this.emptyState.classList.remove(`${CSS_PREFIX}-hidden`);
                    if (this.hitsList) {
                        this.hitsList.innerHTML = '';
                        this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                    }
                    return;
                }

                if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);

                // Clear and populate results
                this.hitsList.innerHTML = '';

                const resultsHtml = results.hits.map((hit, index) => {
                    // Use highlighted content when available, otherwise fall back to original
                    const getHighlightedTitle = (fieldName, fallback) => {
                        if (this.config.enableHighlighting && hit.highlight && hit.highlight[fieldName]) {
                            return hit.highlight[fieldName].snippet || hit.highlight[fieldName].value || fallback;
                        }
                        return fallback;
                    };

                    const getHighlightedExcerpt = (fieldName, fallback) => {
                        if (this.config.enableHighlighting && hit.highlight && hit.highlight[fieldName]) {
                            // For excerpts, prefer snippet (shorter) and truncate if needed
                            const highlighted = hit.highlight[fieldName].snippet || hit.highlight[fieldName].value || fallback;
                            // Truncate to ~160 characters if too long (accounting for HTML tags)
                            if (highlighted && highlighted.length > 200) {
                                return highlighted.substring(0, 200) + '...';
                            }
                            return highlighted;
                        }
                        return fallback;
                    };

                    const title = getHighlightedTitle('title', hit.document.title) || this.t('untitledPost');
                    const excerpt = getHighlightedExcerpt('excerpt', hit.document.excerpt) ||
                                  getHighlightedExcerpt('plaintext', hit.document.plaintext?.substring(0, 80)) ||
                                  hit.document.excerpt ||
                                  hit.document.plaintext?.substring(0, 80) || '';

                    const resultUrl = this.config.transformToRelativeUrls
                        ? this.toRelativeUrl(hit.document.url)
                        : (hit.document.url || '#');

                    // The link wrapper (class + data attributes + aria-label) is
                    // shared by both templates, so keyboard navigation, click
                    // handling, and analytics behave identically — only the
                    // inner article markup differs.
                    return `
                        <a href="${resultUrl}"
                            class="${CSS_PREFIX}-result-link"
                            data-result-id="${this.escapeHtmlAttr(hit.document.id)}"
                            data-result-position="${index}"
                            aria-label="${title.replace(/<[^>]*>/g, '')}">
                            ${this.config.template === 'grid'
                                ? this.renderGridCard(hit, title, excerpt)
                                : this.renderListItem(title, excerpt)}
                        </a>
                    `;
                }).join('');

                this.hitsList.innerHTML = resultsHtml;
                this.hitsList.classList.toggle(`${CSS_PREFIX}-grid`, this.config.template === 'grid');
                this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            } catch (error) {
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.emptyState) this.emptyState.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.hitsList) {
                    this.hitsList.innerHTML = '';
                    this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                }
                if (this.facetsContainer) this.facetsContainer.classList.add(`${CSS_PREFIX}-hidden`);
            }
        }

        getSearchParameters() {
            const fields = Object.keys(this.config.searchFields || {}).length > 0
                ? this.config.searchFields
                : {
                    title: { weight: 5, highlight: true },
                    excerpt: { weight: 3, highlight: true },
                    plaintext: { weight: 4, highlight: true },
                    'tags.name': { weight: 4, highlight: true },
                    'tags.slug': { weight: 3, highlight: true }
                };

            const searchFields = [];
            const weights = [];
            const highlightFields = [];

            Object.entries(fields).forEach(([field, config]) => {
                searchFields.push(field);
                weights.push(config.weight || 1);
                if (config.highlight) {
                    highlightFields.push(field);
                }
            });

            // Default search parameters
            const defaultParams = {
                query_by: searchFields.join(','),
                query_by_weights: weights.join(','),
                highlight_full_fields: highlightFields.join(','),
                highlight_affix_num_tokens: 30,
                include_fields: 'id,title,url,excerpt,plaintext,published_at,tags',
                typo_tolerance: false,
                num_typos: 0,
                prefix: true,
                per_page: 20,
                drop_tokens_threshold: 0,
                enable_nested_fields: true,
                prioritize_exact_match: true,
                sort_by: '_text_match:desc,published_at:desc'
            };

            // Merge with custom typesenseSearchParams from config (if provided)
            // Custom params override defaults, allowing full control over sorting, filtering, etc.
            const customParams = this.config.typesenseSearchParams || {};

            // If user provides custom query_by without custom weights, don't use default weights
            // (they're taking control of fields, so weights should be explicit or equal)
            if (customParams.query_by && !customParams.query_by_weights) {
                delete defaultParams.query_by_weights;
            }

            const mergedParams = {
                ...defaultParams,
                ...customParams
            };

            // Click analytics needs each hit's `id` in the response. A host
            // that overrides `include_fields` may legitimately omit it, so
            // re-add `id` when analytics is enabled — otherwise click events
            // would report a null resultId.
            if (this.isAnalyticsEnabled()) {
                const fields = String(mergedParams.include_fields || '')
                    .split(',')
                    .map(f => f.trim())
                    .filter(Boolean);
                if (!fields.includes('id')) {
                    fields.unshift('id');
                    mergedParams.include_fields = fields.join(',');
                }
            }

            // The grid template shows the post's feature image, so make sure it
            // is returned. Only added in grid mode, leaving the list/default
            // query's returned fields unchanged.
            if (this.config.template === 'grid') {
                const fields = String(mergedParams.include_fields || '')
                    .split(',')
                    .map(f => f.trim())
                    .filter(Boolean);
                if (!fields.includes('feature_image')) {
                    fields.push('feature_image');
                    mergedParams.include_fields = fields.join(',');
                }
            }

            // Semantic (hybrid) search: when enabled, append the embedding
            // field to `query_by`. Typesense then fuses keyword and vector
            // relevance, auto-embedding the query against the field's model.
            // When disabled, queries stay purely lexical.
            if (this.config.semanticSearch) {
                const embeddingField = this.config.embeddingFieldName || 'embedding';
                const queryFields = String(mergedParams.query_by || '')
                    .split(',')
                    .map(f => f.trim())
                    .filter(Boolean);
                if (!queryFields.includes(embeddingField)) {
                    queryFields.push(embeddingField);
                    mergedParams.query_by = queryFields.join(',');

                    // Typesense requires query_by_weights to have the same number
                    // of entries as query_by when it is set, so add a weight for
                    // the embedding field too. (When no weights are set, leaving
                    // it unset is valid — Typesense weights fields equally.)
                    if (mergedParams.query_by_weights) {
                        const weights = String(mergedParams.query_by_weights)
                            .split(',')
                            .map(w => w.trim())
                            .filter(Boolean);
                        weights.push('1');
                        mergedParams.query_by_weights = weights.join(',');
                    }
                }
            }

            // Reader-facing facets: request facet counts for the configured
            // fields and AND any selected values into `filter_by`, preserving a
            // publisher-configured filter rather than overwriting it.
            if (this.config.facets?.length) {
                mergedParams.facet_by = this.config.facets.map(f => f.field).join(',');

                const maxValues = Math.max(...this.config.facets.map(f => f.limit || 10));
                if (Number.isFinite(maxValues)) {
                    mergedParams.max_facet_values = maxValues;
                }

                const composed = this.composeFilterBy(mergedParams.filter_by);
                if (composed) {
                    mergedParams.filter_by = composed;
                } else {
                    delete mergedParams.filter_by;
                }
            }

            return mergedParams;
        }

        // Build the `filter_by` clause for the currently selected facet values:
        // values within a field are OR-ed, and the per-field clauses are
        // AND-ed together. Values are backtick-quoted (with any backticks
        // stripped) so spaces and commas don't break the expression.
        buildFacetFilter() {
            const clauses = [];
            for (const facet of this.config.facets || []) {
                const values = this.selectedFacets[facet.field];
                if (!values || values.size === 0) continue;
                const quoted = [...values]
                    .map(v => `\`${String(v).replace(/`/g, '')}\``)
                    .join(',');
                clauses.push(`${facet.field}:=[${quoted}]`);
            }
            return clauses.join(' && ');
        }

        // Combine the selected-facet filter with a publisher-provided
        // `filter_by` (from typesenseSearchParams). Both sides are wrapped in
        // parentheses and AND-ed so neither clobbers the other. Returns an
        // empty string when there is nothing to filter by.
        composeFilterBy(existingFilter) {
            const facetFilter = this.buildFacetFilter();
            const existing = (existingFilter || '').trim();

            if (existing && facetFilter) {
                return `(${existing}) && (${facetFilter})`;
            }
            return existing || facetFilter;
        }

        // Render the facet chip groups from the facet counts Typesense returned
        // for the current query. Each value is a toggle button (aria-pressed
        // reflects selection); a "clear filters" button appears when anything
        // is selected. Hidden entirely when no facets are configured or no
        // counts came back.
        renderFacets(facetCounts) {
            if (!this.facetsContainer) return;

            if (!this.config.facets?.length || !Array.isArray(facetCounts) || facetCounts.length === 0) {
                this.facetsContainer.innerHTML = '';
                this.facetsContainer.classList.add(`${CSS_PREFIX}-hidden`);
                return;
            }

            // Map configured fields to their display labels and order.
            const countsByField = {};
            for (const fc of facetCounts) {
                countsByField[fc.field_name] = fc.counts || [];
            }

            const groups = this.config.facets.map(facet => {
                const counts = countsByField[facet.field] || [];
                if (counts.length === 0) return '';

                const selected = this.selectedFacets[facet.field];
                const chips = counts.map(({ value, count }) => {
                    const isSelected = selected ? selected.has(value) : false;
                    const safeValue = this.escapeHtmlAttr(value);
                    return `
                        <button type="button"
                            class="${CSS_PREFIX}-facet-chip${isSelected ? ` ${CSS_PREFIX}-facet-chip-selected` : ''}"
                            data-facet-field="${this.escapeHtmlAttr(facet.field)}"
                            data-facet-value="${safeValue}"
                            aria-pressed="${isSelected ? 'true' : 'false'}">
                            <span class="${CSS_PREFIX}-facet-chip-label">${safeValue}</span>
                            <span class="${CSS_PREFIX}-facet-chip-count">${count}</span>
                        </button>
                    `;
                }).join('');

                return `
                    <div class="${CSS_PREFIX}-facet-group">
                        <div class="${CSS_PREFIX}-facet-group-label">${this.escapeHtmlAttr(facet.label || facet.field)}</div>
                        <div class="${CSS_PREFIX}-facet-chips" role="list">${chips}</div>
                    </div>
                `;
            }).join('');

            const hasSelection = Object.values(this.selectedFacets).some(s => s && s.size > 0);
            const clearButton = hasSelection
                ? `<button type="button" class="${CSS_PREFIX}-facet-clear">${this.t('clearFiltersLabel')}</button>`
                : '';

            this.facetsContainer.innerHTML = groups + clearButton;
            this.facetsContainer.classList.toggle(`${CSS_PREFIX}-hidden`, groups.trim() === '');
        }

        // Delegated handler for facet chip toggles and the clear-filters
        // button. Toggling a value updates the selection and re-runs the
        // current query so results and counts reflect the active filters.
        attachFacetListeners() {
            if (!this.facetsContainer) return;

            this.facetsContainer.addEventListener('click', (e) => {
                const clearBtn = e.target.closest(`.${CSS_PREFIX}-facet-clear`);
                if (clearBtn) {
                    e.preventDefault();
                    this.selectedFacets = {};
                    this.rerunQueryForFacets();
                    return;
                }

                const chip = e.target.closest(`.${CSS_PREFIX}-facet-chip`);
                if (!chip) return;
                e.preventDefault();

                const field = chip.dataset.facetField;
                const value = chip.dataset.facetValue;
                if (!field || value === undefined) return;

                if (!this.selectedFacets[field]) {
                    this.selectedFacets[field] = new Set();
                }
                const set = this.selectedFacets[field];
                if (set.has(value)) {
                    set.delete(value);
                } else {
                    set.add(value);
                }

                this.rerunQueryForFacets();
            });
        }

        // Re-run the active query after a facet change, using the live input
        // value (falling back to the last searched query).
        rerunQueryForFacets() {
            const query = this.searchInput?.value?.trim() || this.lastQuery;
            if (query) {
                this.handleSearch(query);
            }
        }

        // Default list layout: title + excerpt. `title` and `excerpt` already
        // contain (Typesense-escaped) highlight markup.
        renderListItem(title, excerpt) {
            return `
                <article class="${CSS_PREFIX}-result-item" role="article">
                    <h3 class="${CSS_PREFIX}-result-title" role="heading" aria-level="3">${title}</h3>
                    <p class="${CSS_PREFIX}-result-excerpt" aria-label="${this.t('ariaArticleExcerpt')}">${excerpt}</p>
                </article>
            `;
        }

        // Grid (card) layout: feature image, title, excerpt, and tags. The
        // image is decorative (the link already carries the title via
        // aria-label); when a post has no feature_image a styled placeholder is
        // shown instead of a broken image.
        renderGridCard(hit, title, excerpt) {
            const featureImage = hit.document.feature_image;
            const imageHtml = featureImage
                ? `<img class="${CSS_PREFIX}-card-image" src="${this.escapeHtmlAttr(featureImage)}" alt="" loading="lazy" />`
                : `<div class="${CSS_PREFIX}-card-image ${CSS_PREFIX}-card-image-empty" aria-hidden="true"></div>`;

            const tags = Array.isArray(hit.document.tags) ? hit.document.tags.slice(0, 3) : [];
            const tagsHtml = tags.length
                ? `<div class="${CSS_PREFIX}-card-tags">${tags
                    .map(tag => `<span class="${CSS_PREFIX}-card-tag">${this.escapeHtmlAttr(tag)}</span>`)
                    .join('')}</div>`
                : '';

            return `
                <article class="${CSS_PREFIX}-result-item ${CSS_PREFIX}-card" role="article">
                    ${imageHtml}
                    <div class="${CSS_PREFIX}-card-body">
                        <h3 class="${CSS_PREFIX}-result-title" role="heading" aria-level="3">${title}</h3>
                        <p class="${CSS_PREFIX}-result-excerpt" aria-label="${this.t('ariaArticleExcerpt')}">${excerpt}</p>
                        ${tagsHtml}
                    </div>
                </article>
            `;
        }

        handleKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closeModal();
                return;
            }

            if (e.target !== this.searchInput) return;

            // Stop all keydown events from propagating outside the shadow DOM
            // when the search input is focused. Without this, events bubble to
            // the document where the target appears as the shadow host (not an
            // input), causing browser extensions or theme JS to misinterpret
            // keypresses (e.g. spacebar triggering page scroll/navigation).
            e.stopPropagation();

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateResults('next');
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateResults('prev');
                    break;
                case 'Enter':
                    if (this.selectedIndex !== -1) {
                        e.preventDefault();
                        this.handleEnterKey();
                    }
                    break;
            }
        }

        navigateResults(direction) {
            const results = [...this.shadowRoot.querySelectorAll(`.${CSS_PREFIX}-result-link, .${CSS_PREFIX}-common-search-btn:not(.${CSS_PREFIX}-hidden)`)].filter(
                el => el.offsetParent !== null && !el.closest(`.${CSS_PREFIX}-hidden`)
            );

            if (results.length === 0) return;

            if (this.selectedIndex === -1) {
                this.selectedIndex = direction === 'next' ? 0 : results.length - 1;
            } else {
                this.selectedIndex = direction === 'next'
                    ? (this.selectedIndex + 1) % results.length
                    : (this.selectedIndex - 1 + results.length) % results.length;
            }

            results.forEach(result => result.classList.remove(`${CSS_PREFIX}-selected`));
            const selectedElement = results[this.selectedIndex];
            selectedElement.classList.add(`${CSS_PREFIX}-selected`);
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }

        handleEnterKey() {
            const results = [...this.shadowRoot.querySelectorAll(`.${CSS_PREFIX}-result-link, .${CSS_PREFIX}-common-search-btn:not(.${CSS_PREFIX}-hidden)`)].filter(
                el => el.offsetParent !== null && !el.closest(`.${CSS_PREFIX}-hidden`)
            );

            if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
                const selectedElement = results[this.selectedIndex];
                if (selectedElement.classList.contains(`${CSS_PREFIX}-result-link`)) {
                    const position = Number(selectedElement.dataset.resultPosition);
                    this.trackClick(selectedElement.dataset.resultId, Number.isNaN(position) ? null : position);
                    window.location.href = selectedElement.href;
                } else {
                    this.searchInput.value = selectedElement.textContent.trim();
                    this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }

        setupHashHandling() {
            window.addEventListener('hashchange', () => this.syncWithHash());
        }

        async syncWithHash() {
            const isSearchHash = window.location.hash.startsWith('#/search');

            if (isSearchHash !== this.isModalOpen) {
                if (isSearchHash) {
                    await this.openModal();
                } else {
                    this.closeModal();
                }
            }
        }

        async handleInitialState() {
            // Check for search query parameters in the URL
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');

            // Check for search terms in the hash path
            const hashParts = window.location.hash.split('/');
            let hashQuery = null;

            if (hashParts.length > 2 && hashParts[1] === 'search') {
                hashQuery = decodeURIComponent(hashParts[2]).replace(/\+/g, ' ');
            }

            // Prioritize hash query over URL query
            if (hashQuery) {
                await this.openModal();
                if (this.searchInput) {
                    this.searchInput.value = hashQuery;
                    this.handleSearch(hashQuery);
                }
            } else if (searchQuery) {
                await this.openModal();
                if (this.searchInput) {
                    this.searchInput.value = searchQuery;
                    this.handleSearch(searchQuery);
                }
            } else if (window.location.hash === '#/search') {
                await this.openModal();
            }
        }
    }

    // Define custom element
    if (!customElements.get('magicpages-search')) {
        customElements.define('magicpages-search', MagicPagesSearchElement);
    }

    // Export to window for backwards compatibility
    window.MagicPagesSearch = MagicPagesSearchElement;

    // Auto-initialize function
    function initializeSearch() {
        // Check for search query parameters
        const searchParams = new URLSearchParams(window.location.search);
        const hasSearchParam = searchParams.has('s') || searchParams.has('q');

        if (!window.magicPagesSearch && (
            window.__MP_SEARCH_CONFIG__ ||
            window.location.hash === '#/search' ||
            hasSearchParam ||
            document.querySelectorAll('[data-ghost-search]').length > 0
        )) {
            // Create and append the web component
            const searchElement = document.createElement('magicpages-search');
            document.body.appendChild(searchElement);

            // Store reference for backwards compatibility
            window.magicPagesSearch = searchElement;

            // Only after successful initialization, start cleaning up Ghost's search
            setupCleanup();
        }
    }

    // Wait for document.body before initializing
    function waitForBody() {
        return new Promise(resolve => {
            if (document.body) {
                resolve();
            } else {
                const observer = new MutationObserver(() => {
                    if (document.body) {
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(document.documentElement, { childList: true });
            }
        });
    }

    // Try to initialize immediately if body exists
    waitForBody().then(initializeSearch);

    // Also try again on DOMContentLoaded just in case
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSearch);
    }
})();
