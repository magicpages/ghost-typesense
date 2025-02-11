import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import instantsearch from 'instantsearch.js/dist/instantsearch.production.min';
import { searchBox, hits } from 'instantsearch.js/es/widgets';
import './styles.css';

(function() {
    // Keep track of our initialization state
    let isInitialized = false;

    // Function to take over Ghost's search functionality
    function takeOverSearch() {
        // Create a fake sodo-search-root to prevent Ghost's search from initializing
        if (!document.getElementById('sodo-search-root')) {
            const fakeRoot = document.createElement('div');
            fakeRoot.id = 'sodo-search-root';
            fakeRoot.style.display = 'none';
            document.body.appendChild(fakeRoot);
        }

        // Disable Ghost's search script if it exists
        const ghostSearchScript = document.querySelector('script[data-sodo-search]');
        if (ghostSearchScript) {
            ghostSearchScript.setAttribute('data-sodo-search', 'disabled');
        }

        // Override Ghost's keyboard shortcut handler
        if (window.__ghost_search_trigger) {
            document.removeEventListener('keydown', window.__ghost_search_trigger);
            window.__ghost_search_trigger = null;
        }

        // Take over Ghost's custom trigger buttons
        document.querySelectorAll('[data-ghost-search]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.magicSearch?.openModal();
            });
        });

        // Handle cmd/ctrl + k shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                e.stopPropagation();
                window.magicSearch?.openModal();
            }
        });

        // Handle hash-based search trigger
        window.addEventListener('hashchange', () => {
            if (window.location.hash === '#/search') {
                window.magicSearch?.openModal();
            }
        });

        // Check initial hash
        if (window.location.hash === '#/search') {
            window.magicSearch?.openModal();
        }
    }

    // Watch for Ghost's search script and take over when it loads
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && // Element node
                    node.tagName === 'SCRIPT' && 
                    (node.src.includes('sodo-search') || node.getAttribute('data-sodo-search'))) {
                    takeOverSearch();
                }
            });
        });
    });

    // Start observing
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Take over immediately if Ghost's search is already present
    if (document.querySelector('script[data-sodo-search]')) {
        takeOverSearch();
    }

    class MagicPagesSearch {
        constructor(config = {}) {
            // Prevent multiple instances
            if (isInitialized) {
                console.warn('MagicPagesSearch is already initialized');
                return window.magicSearch;
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
                theme: 'system', // 'light', 'dark', or 'system'
                searchFields: {
                    title: { weight: 4, highlight: true },
                    excerpt: { weight: 2, highlight: true },
                    html: { weight: 1, highlight: true }
                },
                siteUrl: null  // Add siteUrl to config
            };

            this.config = {
                ...defaultConfig,
                ...config
            };

            if (!this.config.typesenseNodes || !this.config.typesenseApiKey || !this.config.collectionName) {
                throw new Error('MagicPagesSearch: Missing required configuration. Please ensure typesenseNodes, typesenseApiKey, and collectionName are provided.');
            }
            
            this.selectedIndex = -1;
            this.init();

            isInitialized = true;
        }

        getSearchParameters() {
            // Ensure we have at least some search fields configured
            const fields = Object.keys(this.config.searchFields || {}).length > 0 
                ? this.config.searchFields 
                : {
                    // Default fallback fields based on typical Ghost schema
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

            // Ensure we have at least one search field
            if (searchFields.length === 0) {
                console.warn('No search fields configured, falling back to title field');
                searchFields.push('title');
                weights.push(1);
                highlightFields.push('title');
            }

            return {
                query_by: searchFields.join(','),
                query_by_weights: weights.join(','),
                highlight_full_fields: highlightFields.join(','),
                highlight_affix_num_tokens: 20,
                include_fields: '*',  // Include all fields in the response
                typo_tolerance: true,
                num_typos: 1,
                per_page: 10
            };
        }

        createSearchModal() {
            const commonSearchesHtml = this.config.commonSearches.length ? `
                <div class="mp-common-searches">
                    <div class="mp-common-searches-title">Common searches</div>
                    <div id="mp-common-searches-container">
                        ${this.config.commonSearches.map(search => `
                            <button type="button" class="mp-common-search-btn" data-search="${search}">
                                ${search}
                            </button>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            const modalHtml = `
                <div id="mp-search-wrapper">
                    <div id="mp-search-modal" class="hidden">
                        <div class="mp-backdrop"></div>
                        <div class="mp-modal-container">
                            <div class="mp-modal-content">
                                <div class="mp-search-header">
                                    <div id="mp-searchbox"></div>
                                    <div class="mp-keyboard-hints">
                                        <span>
                                            <kbd class="mp-kbd">↑↓</kbd>
                                            to navigate
                                        </span>
                                        <span>
                                            <kbd class="mp-kbd">/</kbd>
                                            to search
                                        </span>
                                        <span>
                                            <kbd class="mp-kbd">esc</kbd>
                                            to close
                                        </span>
                                    </div>
                                </div>
                                <div class="mp-results-container">
                                    ${commonSearchesHtml}
                                    <div id="mp-hits"></div>
                                    <div id="mp-empty-state" class="hidden">
                                        <div class="mp-empty-message">
                                            <p>No results found for your search</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        init() {
            this.createSearchModal();
            
            // Get modal reference after creation
            this.modal = document.getElementById('mp-search-modal');
            
            // Initialize theme before anything else
            this.handleThemeChange();

            const searchParameters = this.getSearchParameters();
            console.log('Search parameters:', searchParameters);
            
            // Initialize Typesense search with dynamic fields
            const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
                server: {
                    apiKey: this.config.typesenseApiKey,
                    nodes: this.config.typesenseNodes
                },
                additionalSearchParameters: searchParameters
            });

            // Add console logging to help debug
            console.log('Typesense Configuration:', {
                nodes: this.config.typesenseNodes,
                collectionName: this.config.collectionName,
                searchParameters
            });

            this.search = instantsearch({
                indexName: this.config.collectionName,
                searchClient: typesenseInstantsearchAdapter.searchClient,
                searchFunction: (helper) => {
                    // Add debugging for search queries
                    console.log('Search query:', helper.state);
                    this.handleSearch(helper);
                }
            });

            // Initialize widgets and start search
            this.initWidgets();
            this.search.start();
            
            // Add event listeners after modal and search are initialized
            this.initEventListeners();
            this.attachCommonSearchListeners();
            
            // Check if we should open the modal
            if (window.location.hash === '#/search') {
                this.openModal();
            }
        }

        handleSearch(helper) {
            const container = document.getElementById('mp-hits');
            const commonSearches = document.querySelector('.mp-common-searches');
            const emptyState = document.getElementById('mp-empty-state');
            
            if (helper.state.query === '') {
                container.classList.add('hidden');
                commonSearches?.classList.remove('hidden');
                emptyState.classList.add('hidden');
            } else {
                container.classList.remove('hidden');
                commonSearches?.classList.add('hidden');
                emptyState.classList.add('hidden');
                helper.search();
            }
        }

        initWidgets() {
            this.searchBox = searchBox({
                container: '#mp-searchbox',
                placeholder: 'Search for anything',
                autofocus: true,
                showReset: false,
                showSubmit: false,
                showLoadingIndicator: false,
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
                    container: '#mp-hits',
                    cssClasses: {
                        root: '',
                        list: '',
                        item: ''
                    },
                    templates: {
                        item: (hit) => {
                            try {
                                // Create a temporary div to safely strip HTML
                                const div = document.createElement('div');
                                // Use excerpt if available, fall back to html
                                div.innerHTML = hit.excerpt || hit.html || '';
                                const text = div.textContent || div.innerText || '';
                                
                                // Get first 120 characters and trim to last complete word
                                const excerpt = text
                                    .trim()
                                    .substring(0, 120)
                                    .replace(/\s+[^\s]*$/, '...');

                                // Handle highlighted results from Typesense
                                const title = hit._highlightResult?.title?.value || hit.title || 'Untitled';

                                return `
                                    <article class="mp-result-item">
                                        <h3 class="mp-result-title">
                                            <a href="${hit.url || '#'}">${title}</a>
                                        </h3>
                                        <p class="mp-result-excerpt">${excerpt}</p>
                                    </article>
                                `;
                            } catch (error) {
                                console.error('Error rendering hit:', error, hit);
                                return '';
                            }
                        },
                        empty: (results) => {
                            console.log('No results found:', results);
                            return `
                                <div class="mp-empty-message">
                                    <p>No results found for "${results.query}"</p>
                                    <p>Try adjusting your search query or filters</p>
                                </div>
                            `;
                        }
                    }
                })
            ]);
        }

        initEventListeners() {
            if (!this.modal) return;  // Guard clause

            // Handle hash change
            window.addEventListener('hashchange', () => {
                if (window.location.hash === '#/search') {
                    this.openModal();
                } else if (this.modal && !this.modal.classList.contains('hidden')) {
                    this.closeModal();
                }
            });

            // Modal close event
            this.modal.addEventListener('close', () => this.closeModal());

            // Prevent clicks on modal content from closing the modal
            const modalContent = this.modal.querySelector('.mp-modal-content');
            if (modalContent) {
                modalContent.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }

            // Close on click outside modal content
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal || 
                    e.target.classList.contains('mp-modal-container') || 
                    !e.target.closest('.mp-modal-content')) {
                    this.closeModal();
                }
            });

            // Keyboard navigation
            document.addEventListener('keydown', (e) => this.handleKeydown(e));
        }

        attachCommonSearchListeners() {
            const container = document.getElementById('mp-common-searches-container');
            if (!container) return;

            container.removeEventListener('click', this._handleCommonSearchClick);
            
            this._handleCommonSearchClick = (e) => {
                const btn = e.target.closest('.mp-common-search-btn');
                if (!btn) return;
                
                e.preventDefault();
                const searchTerm = btn.dataset.search;
                
                try {
                    const searchInput = document.querySelector('.mp-search-input');
                    if (searchInput) {
                        // First update the InstantSearch helper
                        this.search.helper.setQuery(searchTerm);
                        
                        // Then update the input
                        searchInput.value = searchTerm;
                        
                        // Trigger the search
                        this.search.helper.search();
                        
                        // Finally focus the input
                        searchInput.focus();
                        const length = searchInput.value.length;
                        searchInput.setSelectionRange(length, length);
                    }
                } catch (error) {
                    console.error('Error handling common search click:', error);
                }
            };

            container.addEventListener('click', this._handleCommonSearchClick);
        }

        openModal() {
            this.modal.classList.remove('hidden');
            document.documentElement.style.overflow = 'hidden';
            document.querySelector('.ais-SearchBox-input').focus();
            history.replaceState(null, null, '#/search');
        }

        closeModal() {
            this.modal.classList.add('hidden');
            document.documentElement.style.overflow = '';
            document.querySelector('.ais-SearchBox-input').value = '';
            this.search.helper.setQuery('').search();
            if (window.location.hash === '#/search') {
                history.replaceState(null, null, window.location.pathname);
            }
        }

        handleKeydown(e) {
            // Don't handle keyboard shortcuts if target is an input or textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            if (window.innerWidth < 640) return;

            if (this.modal.classList.contains('hidden')) {
                // Open search with forward slash
                if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.openModal();
                    return;
                }
            } else {
                switch (e.key) {
                    case 'Escape':
                        this.closeModal();
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        this.navigateResults('next');
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this.navigateResults('prev');
                        break;
                    case 'Enter':
                        e.preventDefault();
                        this.handleEnterKey();
                        break;
                }
            }
        }

        navigateResults(direction) {
            const results = [...document.querySelectorAll('#mp-hits .mp-result-item, .mp-common-search-btn:not(.hidden)')].filter(
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
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        handleEnterKey() {
            const results = [...document.querySelectorAll('#mp-hits .mp-result-item, .mp-common-search-btn:not(.hidden)')].filter(
                el => el.offsetParent !== null && !el.closest('.hidden')
            );
            
            if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
                const selectedElement = results[this.selectedIndex];
                if (selectedElement.classList.contains('mp-result-item')) {
                    const link = selectedElement.querySelector('a');
                    if (link) window.location.href = link.href;
                } else {
                    const searchBox = document.querySelector('.mp-search-input');
                    searchBox.value = selectedElement.textContent.trim();
                    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }

        handleThemeChange() {
            const wrapper = document.getElementById('mp-search-wrapper');
            if (!wrapper) return;

            const setTheme = (isDark) => {
                wrapper.classList.toggle('dark', isDark);
            };

            // Remove any existing theme first
            wrapper.classList.remove('dark');

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
    
    // Auto-initialize when the script loads
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize if we have a config or if #/search is in the URL
        if (window.__MP_SEARCH_CONFIG__ || window.location.hash === '#/search') {
            takeOverSearch(); // Ensure we take over before initializing
            window.magicSearch = new MagicPagesSearch();
        }
    });
})(); 