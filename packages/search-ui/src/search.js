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
                commonSearches: defaultConfig.commonSearches || []
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
            this.commonSearches = this.shadowRoot.querySelector(`.${CSS_PREFIX}-common-searches`);
            this.loadingState = this.shadowRoot.querySelector(`#${CSS_PREFIX}-loading`);
            this.emptyState = this.shadowRoot.querySelector(`#${CSS_PREFIX}-empty`);
        }

        getCommonSearchesHtml() {
            if (!this.config.commonSearches?.length) {
                return `
                    <div class="${CSS_PREFIX}-common-searches">
                        <div class="${CSS_PREFIX}-empty-message">${this.t('emptyStateMessage')}</div>
                    </div>
                `;
            }

            return `
                <div class="${CSS_PREFIX}-common-searches">
                    <div class="${CSS_PREFIX}-common-searches-title" role="heading" aria-level="2">
                        ${this.t('commonSearchesTitle')}
                    </div>
                    <div id="${CSS_PREFIX}-common-searches-container" role="list">
                        ${this.config.commonSearches.map(search => `
                            <button type="button"
                                class="${CSS_PREFIX}-common-search-btn"
                                data-search="${search}"
                                role="listitem">
                                ${search}
                            </button>
                        `).join('')}
                    </div>
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

            // Common searches
            this.attachCommonSearchListeners();

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

                const resultsHtml = results.hits.map(hit => {
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

                    return `
                        <a href="${hit.document.url || '#'}"
                            class="${CSS_PREFIX}-result-link"
                            aria-label="${title.replace(/<[^>]*>/g, '')}">
                            <article class="${CSS_PREFIX}-result-item" role="article">
                                <h3 class="${CSS_PREFIX}-result-title" role="heading" aria-level="3">${title}</h3>
                                <p class="${CSS_PREFIX}-result-excerpt" aria-label="${this.t('ariaArticleExcerpt')}">${excerpt}</p>
                            </article>
                        </a>
                    `;
                }).join('');

                this.hitsList.innerHTML = resultsHtml;
                this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            } catch (error) {
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.emptyState) this.emptyState.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.hitsList) {
                    this.hitsList.innerHTML = '';
                    this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                }
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
                include_fields: 'title,url,excerpt,plaintext,published_at,tags',
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

            return {
                ...defaultParams,
                ...customParams
            };
        }

        handleKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.closeModal();
                return;
            }

            if (e.target !== this.searchInput) return;

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
