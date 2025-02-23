import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import instantsearch from 'instantsearch.js/dist/instantsearch.production.min';
import { searchBox, hits } from 'instantsearch.js/es/widgets';

// BUNDLED_CSS will be injected by rollup banner

(function () {
    let isInitialized = false;

    // Block Ghost's search script from loading
    Object.defineProperty(window, 'SodoSearch', {
        configurable: false,
        enumerable: false,
        get: () => ({
            init: () => { },
            preact: {
                render: () => { },
                h: () => { },
                Component: class { }
            }
        }),
        set: () => { }
    });

    // Remove any existing sodo-search elements
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.tagName === 'SCRIPT' && node.hasAttribute('data-sodo-search')) {
                        node.remove();
                    }
                    if (node.id === 'sodo-search-root') {
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

    function cleanupGhostSearch() {
        const searchScript = document.querySelector('script[data-sodo-search]');
        if (searchScript) searchScript.remove();
        const searchRoot = document.getElementById('sodo-search-root');
        if (searchRoot) searchRoot.remove();
    }

    cleanupGhostSearch();
    document.addEventListener('DOMContentLoaded', cleanupGhostSearch);

    class MagicPagesSearch {
        constructor(config = {}) {
            if (isInitialized) {
                console.warn('MagicPagesSearch is already initialized');
                return window.magicPagesSearch;
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
                theme: 'system',
                searchFields: {
                    title: { weight: 4, highlight: true },
                    excerpt: { weight: 2, highlight: true },
                    html: { weight: 1, highlight: true }
                }
            };

            this.config = {
                commonSearches: [],
                ...defaultConfig,
                ...config,
                commonSearches: config.commonSearches || defaultConfig.commonSearches || []
            };

            if (!this.config.typesenseNodes || !this.config.typesenseApiKey || !this.config.collectionName) {
                throw new Error('MagicPagesSearch: Missing required configuration');
            }

            this.selectedIndex = -1;
            this.searchDebounceTimeout = null;
            this.cachedElements = {};


            this.init();
            isInitialized = true;
        }

        getParentAccentColor() {
            try {
                const computedStyle = window.getComputedStyle(document.documentElement);
                const accentColor = computedStyle.getPropertyValue('--ghost-accent-color').trim();
                return accentColor || null;
            } catch (error) {
                console.warn('Failed to get Ghost accent color:', error);
                return null;
            }
        }

        updateDarkMode() {
            const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

            if (this.doc) {
                this.doc.documentElement.classList.toggle('dark', isDarkMode);
            }
        }

        createIframe() {
            // Create iframe with initial styles
            this.iframe = document.createElement('iframe');

            // Set initial z-index based on viewport width
            const isMobile = window.innerWidth < 640;
            const zIndex = isMobile ? 3999999 : 3999997;

            this.iframe.style.cssText = `
                border: none;
                width: 100vw;
                height: 100vh;
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: ${zIndex};
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
            `;

            // Handle visual viewport changes (e.g., mobile keyboard)
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', () => {
                    if (this.modal && this.modal.classList.contains('hidden')) return;

                    const modalContainer = this.doc.querySelector('.mp-modal-container');
                    if (modalContainer) {
                        modalContainer.style.height = `${window.visualViewport.height}px`;
                        modalContainer.style.transform = `translateY(${window.visualViewport.offsetTop}px)`;
                    }
                });
            }

            // Update z-index on resize
            window.addEventListener('resize', () => {
                const isMobile = window.innerWidth < 640;
                this.iframe.style.zIndex = isMobile ? 3999999 : 3999997;
            });
            document.body.appendChild(this.iframe);

            // Get iframe document
            this.doc = this.iframe.contentDocument || this.iframe.contentWindow.document;

            // Get Ghost's accent color
            const accentColor = this.getParentAccentColor();
            const accentColorStyle = accentColor ? `
                :root {
                    --ghost-accent-color: ${accentColor};
                }` : '';

            // Write initial HTML with styles
            this.doc.open();
            this.doc.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <style>${accentColorStyle}</style>
                    <style>${BUNDLED_CSS}</style>
                </head>
                <body>
                    <div id="mp-search-wrapper" data-theme="${this.config.theme}">
                        <div id="mp-search-modal" class="hidden" role="dialog" aria-modal="true" aria-label="Search">
                            <div class="mp-backdrop"></div>
                            <div class="mp-modal-container">
                                <button class="mp-close-button" aria-label="Close search">
                                    <span aria-hidden="true">×</span>
                                </button>
                                <div class="mp-modal-content">
                                    <div class="mp-search-header">
                                        <div id="mp-searchbox" role="search"></div>
                                        <div class="mp-keyboard-hints">
                                            <span>
                                                <kbd class="mp-kbd">↑↓</kbd>
                                                to navigate
                                            </span>
                                            <span>
                                                <kbd class="mp-kbd">esc</kbd>
                                                to close
                                            </span>
                                        </div>
                                    </div>
                                    <div class="mp-results-container">
                                        ${this.getCommonSearchesHtml()}
                                        <div id="mp-hits" role="region" aria-label="Search results"></div>
                                        <div id="mp-loading-state" class="mp-loading-state" role="status" aria-live="polite">
                                            <div class="mp-loading-spinner" aria-hidden="true"></div>
                                            <div>Searching...</div>
                                        </div>
                                        <div id="mp-empty-state" class="hidden" role="status" aria-live="polite">
                                            <div class="mp-empty-message">
                                                <p>No results found for your search</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `);
            this.doc.close();

            // Store references
            this.modal = this.doc.getElementById('mp-search-modal');
            this.wrapper = this.doc.getElementById('mp-search-wrapper');
            this.cachedElements = { modal: this.modal, wrapper: this.wrapper };

            // Initial dark mode check
            this.updateDarkMode();

            // Watch for system dark mode changes
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                this.updateDarkMode();
            });

            // Watch for Ghost theme dark mode changes
            const observer = new MutationObserver(() => {
                this.updateDarkMode();
            });

            observer.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class']
            });
        }

        getCommonSearchesHtml() {
            if (!this.config.commonSearches?.length) {
                return `
                    <div class="mp-common-searches">
                        <div class="mp-empty-message">Start typing to search...</div>
                    </div>
                `;
            }

            return `
                <div class="mp-common-searches">
                    <div class="mp-common-searches-title" role="heading" aria-level="2">
                        Common searches
                    </div>
                    <div id="mp-common-searches-container" role="list">
                        ${this.config.commonSearches.map(search => `
                            <button type="button" 
                                class="mp-common-search-btn" 
                                data-search="${search}"
                                role="listitem">
                                ${search}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        getSearchParameters() {
            const fields = Object.keys(this.config.searchFields || {}).length > 0
                ? this.config.searchFields
                : {
                    title: { weight: 4, highlight: true },
                    excerpt: { weight: 2, highlight: true },
                    html: { weight: 1, highlight: true }
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

            return {
                query_by: searchFields.join(','),
                query_by_weights: weights.join(','),
                highlight_full_fields: highlightFields.join(','),
                highlight_affix_num_tokens: 20,
                include_fields: 'title,url,excerpt,html',
                typo_tolerance: true,
                num_typos: 2,
                prefix: true,
                per_page: 10
            };
        }

        init() {
            this.createIframe();
            this.initSearch();
            this.initEventListeners();
            this.handleThemeChange();

            if (window.location.hash === '#/search') {
                this.openModal();
            }
        }

        initSearch() {
            const searchParameters = this.getSearchParameters();

            const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
                server: {
                    apiKey: this.config.typesenseApiKey,
                    nodes: this.config.typesenseNodes
                },
                additionalSearchParameters: searchParameters
            });

            this.search = instantsearch({
                indexName: this.config.collectionName,
                searchClient: typesenseInstantsearchAdapter.searchClient,
                searchFunction: (helper) => this.handleSearch(helper)
            });

            this.initWidgets();
            this.search.start();
        }

        handleSearch(helper) {
            if (!this.cachedElements.container) {
                this.cachedElements.container = this.doc.getElementById('mp-hits');
                this.cachedElements.commonSearches = this.doc.querySelector('.mp-common-searches');
                this.cachedElements.emptyState = this.doc.getElementById('mp-empty-state');
                this.cachedElements.loadingState = this.doc.getElementById('mp-loading-state');
            }

            const { container, commonSearches, emptyState, loadingState } = this.cachedElements;

            if (emptyState && !helper.state.query) {
                emptyState.classList.add('hidden');
            }

            const query = helper.state.query?.trim();

            if (!query) {
                this.selectedIndex = -1;
                if (container) container.classList.add('hidden');
                if (commonSearches) commonSearches.classList.remove('hidden');
                if (emptyState) emptyState.classList.add('hidden');
                if (loadingState) loadingState.classList.remove('active');
                return;
            }

            // Only update UI immediately, defer search
            if (commonSearches) commonSearches.classList.add('hidden');
            if (container) container.classList.remove('hidden');
            if (loadingState) loadingState.classList.add('active');
            helper.search();
        }

        initWidgets() {
            this.searchBox = searchBox({
                container: this.doc.querySelector('#mp-searchbox'),
                placeholder: 'Search for anything',
                autofocus: true,
                showReset: false,
                showSubmit: false,
                showLoadingIndicator: false,
                searchAsYouType: true,
                queryHook: (query, search) => {
                    // Clear any pending search
                    if (this.searchDebounceTimeout) {
                        clearTimeout(this.searchDebounceTimeout);
                    }

                    // Use a shorter debounce for a more responsive feel while still preventing too many requests
                    this.searchDebounceTimeout = setTimeout(() => {
                        search(query);
                    }, 80);
                },
                cssClasses: {
                    root: '',
                    form: '',
                    input: 'mp-search-input',
                    resetIcon: 'hidden',
                    submitIcon: 'hidden',
                }
            });

            this.search.addWidgets([
                this.searchBox,
                hits({
                    container: this.doc.querySelector('#mp-hits'),
                    cssClasses: {
                        root: '',
                        list: 'mp-hits-list list-none',
                        emptyRoot: 'hidden',
                        item: ''
                    },
                    templates: {
                        item: (hit) => {
                            // Hide loading state when results are rendered
                            const loadingState = this.doc.getElementById('mp-loading-state');
                            if (loadingState) loadingState.classList.remove('active');

                            try {
                                const div = document.createElement('div');
                                div.innerHTML = hit.excerpt || hit.html || '';
                                const text = div.textContent || div.innerText || '';
                                const excerpt = text.trim().substring(0, 120).replace(/\s+[^\s]*$/, '...');
                                const title = hit._highlightResult?.title?.value || hit.title || 'Untitled';

                                return `
                                    <a href="${hit.url || '#'}" 
                                        class="mp-result-link"
                                        aria-label="${title.replace(/<[^>]*>/g, '')}">
                                        <article class="mp-result-item" role="article">
                                            <h3 class="mp-result-title" role="heading" aria-level="3">${title}</h3>
                                            <p class="mp-result-excerpt" aria-label="Article excerpt">${excerpt}</p>
                                        </article>
                                    </a>
                                `;
                            } catch (error) {
                                console.error('Error rendering hit:', error, hit);
                                return '';
                            }
                        },
                        empty: (results) => {
                            if (results.query && results.query.trim()) {
                                const emptyState = this.doc.getElementById('mp-empty-state');
                                const container = this.doc.getElementById('mp-hits');
                                const loadingState = this.doc.getElementById('mp-loading-state');
                                if (container) container.classList.add('hidden');
                                if (emptyState) emptyState.classList.remove('hidden');
                                if (loadingState) loadingState.classList.remove('active');
                            }
                            return '';
                        }
                    }
                })
            ]);
        }

        initEventListeners() {
            // Handle hash change
            window.addEventListener('hashchange', () => {
                if (window.location.hash === '#/search') {
                    this.openModal();
                } else if (this.modal && !this.modal.classList.contains('hidden')) {
                    this.closeModal();
                }
            });

            // Close button
            const closeButton = this.doc.querySelector('.mp-close-button');
            if (closeButton) {
                closeButton.addEventListener('click', () => this.closeModal());
            }

            // Click outside to close
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal || e.target.classList.contains('mp-backdrop')) {
                    this.closeModal();
                }
            });

            // Prevent clicks on modal content from closing
            const modalContent = this.modal.querySelector('.mp-modal-content');
            if (modalContent) {
                modalContent.addEventListener('click', (e) => e.stopPropagation());
            }

            // Common searches
            this.attachCommonSearchListeners();

            // Parent window keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                    e.preventDefault();
                    this.openModal();
                }
                if (e.key === '/' && !e.ctrlKey && !e.metaKey &&
                    e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.openModal();
                }
            });

            // Iframe keyboard navigation
            this.doc.addEventListener('keydown', (e) => this.handleKeydown(e));

            // Handle Ghost's search buttons
            document.querySelectorAll('[data-ghost-search]').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                });
            });

            // Handle search result clicks
            const hitsContainer = this.doc.querySelector('#mp-hits');
            if (hitsContainer) {
                hitsContainer.addEventListener('click', (e) => {
                    const resultLink = e.target.closest('.mp-result-link');
                    if (resultLink) {
                        e.preventDefault();
                        window.location.href = resultLink.href;
                    }
                });
            }
        }

        attachCommonSearchListeners() {
            const container = this.doc.getElementById('mp-common-searches-container');
            if (!container) return;

            const handleClick = (e) => {
                const btn = e.target.closest('.mp-common-search-btn');
                if (!btn) return;

                e.preventDefault();
                const searchTerm = btn.dataset.search;

                const searchInput = this.doc.querySelector('.mp-search-input');
                if (searchInput) {
                    this.selectedIndex = -1;
                    searchInput.value = searchTerm;
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    this.search.helper.setQuery(searchTerm).search();
                    setTimeout(() => {
                        searchInput.focus();
                        searchInput.setSelectionRange(searchTerm.length, searchTerm.length);
                    }, 0);
                }
            };

            container.addEventListener('click', handleClick);
            container.addEventListener('touchend', handleClick);
        }

        openModal() {
            this.iframe.style.pointerEvents = 'auto';
            this.iframe.style.opacity = '1';
            this.modal.classList.remove('hidden');

            const searchInput = this.doc.querySelector('.mp-search-input');
            if (searchInput) {
                searchInput.focus();
            }

            history.replaceState(null, null, '#/search');
        }

        closeModal() {
            this.iframe.style.opacity = '0';
            this.iframe.style.pointerEvents = 'none';
            this.modal.classList.add('hidden');
            this.selectedIndex = -1;

            const searchInput = this.doc.querySelector('.mp-search-input');
            if (searchInput) {
                searchInput.value = '';
            }
            this.search.helper.setQuery('').search();

            if (window.location.hash === '#/search') {
                history.replaceState(null, null, window.location.pathname);
            }
        }

        handleKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.closeModal();
                return;
            }

            const isSearchInput = e.target.classList.contains('mp-search-input');
            if (e.target.tagName === 'INPUT' && !isSearchInput) return;
            if (window.innerWidth < 640) return;

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
            // Cache selector results
            if (!this.cachedElements.results) {
                this.cachedElements.results = this.doc.querySelectorAll('#mp-hits .mp-result-link, .mp-common-search-btn:not(.hidden)');
            }

            const results = [...this.cachedElements.results].filter(
                el => el.offsetParent !== null && !el.closest('.hidden'));
            this.cachedElements.results = null; // Clear cache for next navigation

            if (results.length === 0) return;

            if (this.selectedIndex === -1) {
                this.selectedIndex = direction === 'next' ? 0 : results.length - 1;
            } else {
                this.selectedIndex = direction === 'next'
                    ? (this.selectedIndex + 1) % results.length
                    : (this.selectedIndex - 1 + results.length) % results.length;
            }

            results.forEach(result => result.classList.remove('mp-selected'));
            const selectedElement = results[this.selectedIndex];
            selectedElement.classList.add('mp-selected');
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }

        handleEnterKey() {
            const results = [...this.doc.querySelectorAll('#mp-hits .mp-result-link, .mp-common-search-btn:not(.hidden)')].filter(
                el => el.offsetParent !== null && !el.closest('.hidden')
            );

            if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
                const selectedElement = results[this.selectedIndex];
                if (selectedElement.classList.contains('mp-result-link')) {
                    window.location.href = selectedElement.href;
                } else {
                    const searchBox = this.doc.querySelector('.mp-search-input');
                    searchBox.value = selectedElement.textContent.trim();
                    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }

        handleThemeChange() {
            if (!this.wrapper) return;

            const setTheme = (isDark) => {
                this.wrapper.classList.toggle('dark', isDark);
            };

            this.wrapper.classList.remove('dark');

            switch (this.config.theme) {
                case 'dark':
                    setTheme(true);
                    break;
                case 'light':
                    setTheme(false);
                    break;
                case 'system':
                default:
                    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                    setTheme(mediaQuery.matches);
                    mediaQuery.addEventListener('change', (e) => setTheme(e.matches));
                    break;
            }
        }
    }

    // Export to window
    window.MagicPagesSearch = MagicPagesSearch;

    // Auto-initialize
    document.addEventListener('DOMContentLoaded', () => {
        if (window.__MP_SEARCH_CONFIG__ ||
            window.location.hash === '#/search' ||
            document.querySelectorAll('[data-ghost-search]').length > 0) {
            window.magicPagesSearch = new MagicPagesSearch();
        }
    });
})();