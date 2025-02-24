

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



    class MagicPagesSearch {
        constructor(config = {}) {
            if (isInitialized) {
                console.warn('MagicPagesSearch is already initialized');
                return window.magicPagesSearch;
            }

            this.isModalOpen = false;

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
                throw new Error('MagicPagesSearch: Missing required Typesense configuration');
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

        async createIframe() {
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

            // Update z-index on resize
            window.addEventListener('resize', () => {
                const isMobile = window.innerWidth < 640;
                this.iframe.style.zIndex = isMobile ? 3999999 : 3999997;
            });

            // Ensure body exists
            if (!document.body) {
                await new Promise(resolve => {
                    const observer = new MutationObserver(() => {
                        if (document.body) {
                            observer.disconnect();
                            resolve();
                        }
                    });
                    observer.observe(document.documentElement, { childList: true });
                });
            }

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

        async init() {
            await this.setupUI();
            await this.setupSearch();
            this.initEventListeners();
            this.setupHashHandling();
            await this.handleInitialState();
        }

        async setupUI() {
            this.createIframe();
            this.handleThemeChange();
        }

        async setupSearch() {
            await this.initSearch();
        }

        setupHashHandling() {
            window.addEventListener('hashchange', () => this.syncWithHash());
        }

        async handleInitialState() {
            await this.syncWithHash();
        }

        async syncWithHash() {
            const shouldBeOpen = window.location.hash === '#/search';
            if (shouldBeOpen !== this.isModalOpen) {
                await this.setModalState(shouldBeOpen);
            }
        }

        initSearch() {
            this.initWidgets();
            if (!this.searchInput) return;

            // Initialize container references
            this.cachedElements.commonSearches = this.doc.querySelector('.mp-common-searches');
            this.cachedElements.loadingState = this.doc.getElementById('mp-loading-state');
        }

        async handleSearch(query) {
            const { commonSearches, emptyState, loadingState } = this.cachedElements;
            query = query?.trim();

            if (!query) {
                this.selectedIndex = -1;
                if (this.hitsList) this.hitsList.classList.add('hidden');
                if (commonSearches) commonSearches.classList.remove('hidden');
                if (emptyState) emptyState.classList.add('hidden');
                if (loadingState) loadingState.classList.remove('active');
                return;
            }

            // Update UI immediately
            if (commonSearches) commonSearches.classList.add('hidden');
            if (this.hitsList) this.hitsList.classList.remove('hidden');
            if (loadingState) loadingState.classList.add('active');

            try {
                // Initialize Typesense client if not already initialized
                if (!this.typesenseClient) {
                    // Typesense is now imported at the top
                    this.typesenseClient = new Typesense.Client({
                        nodes: this.config.typesenseNodes,
                        apiKey: this.config.typesenseApiKey,
                        connectionTimeoutSeconds: 2
                    });
                }

                const searchParams = this.getSearchParameters();
                const searchParameters = {
                    q: query,
                    query_by: searchParams.query_by,
                    query_by_weights: searchParams.query_by_weights,
                    highlight_full_fields: searchParams.highlight_full_fields,
                    highlight_affix_num_tokens: searchParams.highlight_affix_num_tokens,
                    include_fields: searchParams.include_fields,
                    typo_tolerance: searchParams.typo_tolerance,
                    num_typos: searchParams.num_typos,
                    prefix: searchParams.prefix,
                    per_page: searchParams.per_page
                };

                const results = await this.typesenseClient
                    .collections(this.config.collectionName)
                    .documents()
                    .search(searchParameters);

                if (loadingState) loadingState.classList.remove('active');

                if (results.hits.length === 0) {
                    if (emptyState) emptyState.classList.remove('hidden');
                    if (this.hitsList) {
                        this.hitsList.innerHTML = '';
                        this.hitsList.classList.add('hidden');
                    }
                    return;
                }

                if (emptyState) emptyState.classList.add('hidden');
                if (this.hitsList) {
                    this.hitsList.innerHTML = results.hits.map(hit => {
                        const div = document.createElement('div');
                        div.innerHTML = hit.document.excerpt || hit.document.html || '';
                        const text = div.textContent || div.innerText || '';
                        const excerpt = text.trim().substring(0, 120).replace(/\s+[^\s]*$/, '...');
                        const title = hit.document.title || 'Untitled';

                        return `
                            <a href="${hit.document.url || '#'}" 
                                class="mp-result-link"
                                aria-label="${title.replace(/<[^>]*>/g, '')}">
                                <article class="mp-result-item" role="article">
                                    <h3 class="mp-result-title" role="heading" aria-level="3">${title}</h3>
                                    <p class="mp-result-excerpt" aria-label="Article excerpt">${excerpt}</p>
                                </article>
                            </a>
                        `;
                    }).join('');
                    this.hitsList.classList.remove('hidden');
                }
            } catch (error) {
                console.error('Search failed:', error);
                if (loadingState) loadingState.classList.remove('active');
                if (emptyState) emptyState.classList.remove('hidden');
                if (this.hitsList) {
                    this.hitsList.innerHTML = '';
                    this.hitsList.classList.add('hidden');
                }
            }
        }

        initWidgets() {
            // Initialize search box
            const searchBoxContainer = this.doc.querySelector('#mp-searchbox');
            if (!searchBoxContainer) return;

            // Clear any existing content
            searchBoxContainer.innerHTML = '';

            // Create search input
            const searchForm = this.doc.createElement('form');
            searchForm.className = '';
            searchForm.setAttribute('novalidate', '');
            searchForm.setAttribute('role', 'search');

            const searchInput = this.doc.createElement('input');
            searchInput.type = 'search';
            searchInput.placeholder = 'Search for anything';
            searchInput.className = 'mp-search-input';
            searchInput.setAttribute('autocomplete', 'off');
            searchInput.setAttribute('autocorrect', 'off');
            searchInput.setAttribute('autocapitalize', 'off');
            searchInput.setAttribute('spellcheck', 'false');
            searchInput.setAttribute('maxlength', '512');
            searchInput.setAttribute('aria-label', 'Search');

            searchForm.appendChild(searchInput);
            searchBoxContainer.appendChild(searchForm);

            // Store reference to search input
            this.searchInput = searchInput;

            // Set focus
            setTimeout(() => searchInput.focus(), 0);

            // Handle search input
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
            });

            searchInput.addEventListener('input', (e) => {
                const query = e.target.value;

                // Clear any pending search
                if (this.searchDebounceTimeout) {
                    clearTimeout(this.searchDebounceTimeout);
                }

                // Use a shorter debounce for a more responsive feel while still preventing too many requests
                this.searchDebounceTimeout = setTimeout(() => {
                    this.handleSearch(query);
                }, 80);
            });

            // Store references
            this.searchInput = searchInput;
            this.searchForm = searchForm;

            // Initialize hits container
            const hitsContainer = this.doc.querySelector('#mp-hits');
            if (!hitsContainer) return;

            // Create hits list
            const hitsList = this.doc.createElement('div');
            hitsList.className = 'mp-hits-list list-none';
            hitsContainer.appendChild(hitsList);

            // Store reference
            this.hitsList = hitsList;
        }



        initEventListeners() {


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

        async setModalState(isOpen, options = {}) {
            const { skipUrlUpdate = false } = options;

            if (isOpen && !this.searchUI) {
                await this.initSearch();
            }

            if (isOpen) {
                // Ensure iframe is ready
                await new Promise(resolve => {
                    const checkIframe = () => {
                        if (this.iframe && this.doc && this.doc.readyState === 'complete') {
                            resolve();
                        } else {
                            setTimeout(checkIframe, 10);
                        }
                    };
                    checkIframe();
                });

                // Ensure styles are applied
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // Update UI state
            this.iframe.style.pointerEvents = isOpen ? 'auto' : 'none';
            this.iframe.style.opacity = isOpen ? '1' : '0';
            this.modal.classList.toggle('hidden', !isOpen);

            // Update search state
            if (!isOpen) {
                this.selectedIndex = -1;
                if (this.searchInput) {
                    this.searchInput.value = '';
                }
                this.handleSearch('');
            } else {
                const searchInput = this.doc.querySelector('.mp-search-input');
                if (searchInput) {
                    searchInput.focus();
                }
            }

            // Update URL state
            if (!skipUrlUpdate) {
                const newHash = isOpen ? '#/search' : '';
                if (window.location.hash !== newHash) {
                    history.replaceState(null, null, newHash || window.location.pathname);
                }
            }
        }

        async openModal() {
            await this.setModalState(true);
        }

        closeModal() {
            this.setModalState(false);
        }

        handleKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.closeModal();
                return;
            }

            if (e.target !== this.searchInput) return;
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
            const results = [...this.doc.querySelectorAll('.mp-result-link, .mp-common-search-btn:not(.hidden)')].filter(
                el => el.offsetParent !== null && !el.closest('.hidden')
            );

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
            const results = [...this.doc.querySelectorAll('.mp-result-link, .mp-common-search-btn:not(.hidden)')].filter(
                el => el.offsetParent !== null && !el.closest('.hidden')
            );

            if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
                const selectedElement = results[this.selectedIndex];
                if (selectedElement.classList.contains('mp-result-link')) {
                    window.location.href = selectedElement.href;
                } else {
                    this.searchInput.value = selectedElement.textContent.trim();
                    this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
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

    // Auto-initialize function
    function initializeSearch() {
        if (!window.magicPagesSearch && (
            window.__MP_SEARCH_CONFIG__ ||
            window.location.hash === '#/search' ||
            document.querySelectorAll('[data-ghost-search]').length > 0
        )) {
            window.magicPagesSearch = new MagicPagesSearch();
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