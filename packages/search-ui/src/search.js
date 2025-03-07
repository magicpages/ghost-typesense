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
                commonSearches: [],
                ...config,
                ...defaultConfig,
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

            return {
                query_by: searchFields.join(','),
                query_by_weights: weights.join(','),
                highlight_full_fields: highlightFields.join(','),
                highlight_affix_num_tokens: 30,
                include_fields: 'title,url,excerpt,plaintext,published_at,tags',
                typo_tolerance: false,             // Disable typo tolerance/correction as requested
                num_typos: 0,                     // No typos allowed to ensure exact matching
                prefix: true,
                per_page: 20,
                drop_tokens_threshold: 0,
                enable_nested_fields: true,       // Ensure nested fields like tags are searched
                token_separators: ' -+/.&',        // Better handle common separators, including &
                split_join_tokens: true,           // Handle variations like "willow herb" vs "willowherb"
                tokenize_on_special_chars: true,    // Better handle special characters like "/"
                max_extra_prefix: 5,               // More flexible prefix matching
                max_extra_suffix: 5,               // More flexible suffix matching
                // Configure infix='off' for each field to match the number of fields and avoid schema errors
                infix: 'off,off,off,off,off',
                prioritize_exact_match: true,      // Prioritize exact matches
                sort_by: '_text_match:desc,published_at:desc'
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
            // Check for search query parameters in the URL
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');
            
            // Check for search terms in the hash path
            const hashParts = window.location.hash.split('/');
            let hashQuery = null;
            
            // If hash format is #/search/query
            if (hashParts.length > 2 && hashParts[1] === 'search') {
                hashQuery = decodeURIComponent(hashParts[2]);
            }
            
            // Prioritize hash query over URL query
            if (hashQuery) {
                // Open modal with the hash query
                await this.setModalState(true, { skipUrlUpdate: true });
                if (this.searchInput) {
                    this.searchInput.value = hashQuery;
                    this.handleSearch(hashQuery);
                }
            } else if (searchQuery) {
                // Open modal with the URL query and move it to the hash
                await this.setModalState(true);
                if (this.searchInput) {
                    this.searchInput.value = searchQuery;
                    this.handleSearch(searchQuery);
                }
            } else if (window.location.hash === '#/search') {
                // Just open the modal if the hash is #/search with no query
                await this.setModalState(true);
            }
        }

        async syncWithHash() {
            // Check if the hash starts with #/search
            const isSearchHash = window.location.hash.startsWith('#/search');
            
            // If hash format is #/search/query, extract the query
            const hashParts = window.location.hash.split('/');
            let searchQuery = null;
            
            if (hashParts.length > 2 && hashParts[1] === 'search') {
                searchQuery = decodeURIComponent(hashParts[2]);
            }
            
            if (isSearchHash !== this.isModalOpen) {
                await this.setModalState(isSearchHash);
                
                // If there's a search query in the hash and the modal is opening
                if (isSearchHash && searchQuery && this.searchInput) {
                    this.searchInput.value = searchQuery;
                    this.handleSearch(searchQuery);
                }
            }
        }
        
        // Extract text between quotes in a string
        extractTextBetweenQuotes(text) {
            if (!text) return null;
            
            // Replace URL-encoded quotes with actual quotes for easier processing
            const normalizedText = text.replace(/%22/g, '"');
            
            // Find the text between the first and last quote
            const firstQuote = normalizedText.indexOf('"');
            const lastQuote = normalizedText.lastIndexOf('"');
            
            if (firstQuote !== -1 && lastQuote !== -1 && firstQuote !== lastQuote) {
                return normalizedText.substring(firstQuote + 1, lastQuote);
            }
            return null;
        }

        initSearch() {
            this.initWidgets();
            if (!this.searchInput) return;

            // Initialize container references
            this.cachedElements.commonSearches = this.doc.querySelector('.mp-common-searches');
            this.cachedElements.loadingState = this.doc.getElementById('mp-loading-state');
            this.cachedElements.emptyState = this.doc.getElementById('mp-empty-state');
            
            // Add CSS for exact phrase match highlighting
            if (!this.doc.querySelector('#mp-highlight-style')) {
                const style = this.doc.createElement('style');
                style.id = 'mp-highlight-style';
                style.textContent = `
                    /* Special styling for exact phrase matches */
                    .mp-highlight.mp-exact-match {
                        background-color: rgba(255, 165, 0, 0.3); /* Orange background */
                        color: inherit;
                        font-weight: 600;
                        border-bottom: 1px dashed rgba(255, 165, 0, 0.7);
                        position: relative;
                    }
                    .dark .mp-highlight.mp-exact-match {
                        background-color: rgba(255, 140, 0, 0.2); /* Darker orange for dark mode */
                        border-bottom-color: rgba(255, 140, 0, 0.6);
                    }
                `;
                this.doc.head.appendChild(style);
            }
        }

        async handleSearch(query) {
            const { commonSearches, emptyState, loadingState } = this.cachedElements;
            
            // Store the original query before any trimming to preserve quotation marks
            const originalQuery = query;
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
                let searchParameters = {
                    q: query,
                    query_by: searchParams.query_by,
                    query_by_weights: searchParams.query_by_weights,
                    highlight_full_fields: searchParams.highlight_full_fields,
                    highlight_affix_num_tokens: searchParams.highlight_affix_num_tokens,
                    highlight_start_tag: '<mark>',   // Default highlight tag
                    highlight_end_tag: '</mark>',    // Default highlight tag
                    include_fields: searchParams.include_fields,
                    typo_tolerance: searchParams.typo_tolerance,
                    num_typos: searchParams.num_typos,
                    prefix: searchParams.prefix,
                    per_page: searchParams.per_page,
                    drop_tokens_threshold: searchParams.drop_tokens_threshold || 0,
                    enable_nested_fields: searchParams.enable_nested_fields || true,
                    token_separators: searchParams.token_separators || ' -+/.',
                    split_join_tokens: searchParams.split_join_tokens || true,
                    tokenize_on_special_chars: searchParams.tokenize_on_special_chars || true,
                    // Set infix='off' for each field to avoid schema compatibility issues
                    infix: 'off,off,off,off,off'
                };

                // Check for tag-specific search syntax (tag:slug)
                const tagMatch = query.match(/^tag:([\w-]+)$/i);
                let isTagSearch = false;
                
                if (tagMatch) {
                    isTagSearch = true;
                    const tagSlug = tagMatch[1];
                    searchParameters = {
                        ...searchParameters,
                        q: '',  // Empty query to match all documents with the filter
                        filter_by: `tags.slug:=${tagSlug}`,  // Exact tag match
                        sort_by: 'published_at:desc',        // Sort by date for tag results
                        infix: 'off'                        // Turn off infix search for tag filters
                    };
                    console.log('Explicit tag search for:', tagSlug);
                } else if (query.includes('-')) {
                    try {
                        // Enhanced tag handling for hyphenated terms like year-2016 that might be tags
                        const possibleTagSearches = query.split(/\s+/);
                        
                        // Log the query for debugging hyphenated searches
                        console.log('Hyphenated query detection:', query);
                        
                        // Check if the query ends with a hyphen (user is in the middle of typing)
                        const endsWithHyphen = query.trim().endsWith('-');
                        
                        // For queries ending with a hyphen, just perform normal search without special handling
                        if (endsWithHyphen) {
                            console.log('User is currently typing a hyphenated term:', query);
                            // Skip all special handling for queries ending with hyphen
                            // This ensures search doesn't get blocked when typing a hyphen
                        } 
                        // Only apply tag search logic if it's not an exact phrase search and query doesn't end with hyphen
                        else if (!isExactPhraseSearch) {
                            // User has completed typing the hyphenated term(s)
                            // Identify terms that look like they could be tags (contain hyphens)
                            const tagLikeTerms = possibleTagSearches.filter(term => 
                                term.includes('-') && /^[\w-]+$/.test(term)
                            );
                            
                            if (tagLikeTerms.length > 0) {
                                isTagSearch = true;
                                console.log('Detected potential tag terms:', tagLikeTerms);
                                
                                // Create a hybrid search approach:
                                // 1. Search the regular content with the original query
                                // 2. Also explicitly filter for exact tag matches
                                
                                // Create tag filters for each potential tag term
                                const tagFilters = tagLikeTerms.map(term => `tags.slug:=${term}`);
                                
                                // Combine with OR conditions - any tag match will include the document
                                const filterString = tagFilters.join(' || ');
                                
                                // Add filter to existing search parameters
                                searchParameters = {
                                    ...searchParameters,
                                    filter_by: filterString,
                                    enable_nested_fields: true, // Ensure nested fields (tags) are searched
                                    prioritize_exact_match: true // Prioritize exact matches for tags
                                };
                                
                                console.log('Applied tag filters:', filterString);
                            }
                        }
                    } catch (hyphenError) {
                        // If anything goes wrong in the hyphen handling code, catch it and log it
                        // but don't let it prevent the search from executing
                        console.error('Error in hyphen search handling:', hyphenError);
                        // Just continue with normal search parameters
                    }
                }

                // Check for quotes in the query - handle both regular quotes and URL-encoded quotes (%22)
                // Also handle partial quotes (just beginning or ending quote)
                const hasOpeningQuote = query.includes('"') || query.includes('%22') || originalQuery?.includes('"') || originalQuery?.includes('%22');
                const hasClosingQuote = (query.lastIndexOf('"') > 0 && query.lastIndexOf('"') !== query.indexOf('"')) || 
                                       (originalQuery?.lastIndexOf('"') > 0 && originalQuery?.lastIndexOf('"') !== originalQuery?.indexOf('"'));
                
                // More lenient quote pattern detection - look for any quotes anywhere
                const queryHasExactPhrase = (query.includes('"') && query.split('"').length > 2) || (query.includes('%22') && query.split('%22').length > 2);
                const originalHasExactPhrase = (originalQuery?.includes('"') && originalQuery?.split('"').length > 2) || 
                                           (originalQuery?.includes('%22') && originalQuery?.split('%22').length > 2);
                
                // Check URL parameters as well
                const urlParams = new URLSearchParams(window.location.search);
                const urlQuery = urlParams.get('q');
                const hasQuotesInUrl = urlQuery && (urlQuery.includes('"') || urlQuery.includes('%22'));
                
                // Define isExactPhraseSearch variable to be used in hyphen handling and exact search logic
                const isExactPhraseSearch = queryHasExactPhrase || originalHasExactPhrase || hasQuotesInUrl || 
                                          (hasOpeningQuote && hasClosingQuote);
                
                // Special character handling for terms with slashes like "Abelo/Swienty"
                if (query.includes('/') && !isTagSearch) {
                    console.log('Detected query with slash character:', query);
                    
                    // For searches with special characters, we need more specific handling
                    searchParameters.tokenize_on_special_chars = true;
                    searchParameters.prefix = true;
                    searchParameters.drop_tokens_threshold = 0;
                    
                    // Try both with and without tokenizing on the special character
                    // by creating appropriate filter conditions
                    const slashTerms = query.split(' ').filter(term => term.includes('/'));
                    
                    if (slashTerms.length > 0) {
                        console.log('Special handling for terms with slashes:', slashTerms);
                        
                        // For each slash term, generate both a tokenized and non-tokenized search approach
                        slashTerms.forEach(term => {
                            // Get the parts before and after the slash
                            const parts = term.split('/');
                            if (parts.length === 2) {
                                // Add specific highlighting for parts around slashes
                                console.log('Enhanced search for slash term parts:', parts);
                            }
                        });
                    }
                }
                
                // Apply exact search logic if we detect quotes in any of these places
                // Save a flag to remember this was a quoted search for later in the function
                let wasQuotedSearch = false;
                let quotedPhrase = null;
                
                if (isExactPhraseSearch) {
                    console.log('Detected exact phrase search for:', query);
                    wasQuotedSearch = true;
                    
                    // Extract the phrase between quotes, regardless of where they appear
                    let exactQuery = query;
                    
                    // Use the class method for consistency
                    quotedPhrase = this.extractTextBetweenQuotes(query);
                    
                    // If the class method failed, try more approaches
                    if (!quotedPhrase) {
                        // Try to extract from different sources
                        const fromOriginal = this.extractTextBetweenQuotes(originalQuery);
                        const fromUrl = this.extractTextBetweenQuotes(urlQuery);
                        
                        if (fromOriginal) {
                            quotedPhrase = fromOriginal;
                            console.log('Extracted exact phrase from original query:', quotedPhrase);
                        } else if (fromUrl) {
                            quotedPhrase = fromUrl;
                            console.log('Extracted exact phrase from URL:', quotedPhrase);
                        } else {
                            // If we can't extract between quotes but detected quotes, fall back to the query without quotes
                            quotedPhrase = query.replace(/"/g, '').replace(/%22/g, '');
                            console.log('Falling back to query without quotes:', quotedPhrase);
                        }
                    } else {
                        console.log('Extracted exact phrase using class method:', quotedPhrase);
                    }
                    
                    // Use the extracted phrase as the exact query
                    exactQuery = quotedPhrase;
                    
                    // For quoted searches, we need to modify search parameters
                    // The schema doesn't have infix search enabled for title, so we need to adjust our approach
                    console.log('Setting up quoted search parameters for:', exactQuery);
                    
                    // Create a new parameters object without the infix parameter
                    const { infix, ...parametersWithoutInfix } = searchParameters;
                    
                    searchParameters = {
                        ...parametersWithoutInfix,
                        q: exactQuery,
                        prefix: false,                   // Don't do prefix matching for exact phrases
                        split_join_tokens: false,        // Don't split/join for exact phrase matches
                        exhaustive_search: true,         // More thorough (but slower) search
                        highlight_affix_num_tokens: 30,  // Increase token count for better highlights
                        highlight_start_tag: '<mark>',   // Default highlight tag
                        highlight_end_tag: '</mark>',    // Default highlight tag
                        drop_tokens_threshold: 0,        // Don't drop any tokens
                        max_candidates: 10000,           // Increase candidates for exact matching
                        sort_by: '_text_match:desc',     // Prioritize exact matches
                        num_typos: 0,                   // No typos allowed for exact matching
                        typo_tokens_threshold: 1,        // Threshold for typo tokens
                        prioritize_exact_match: true,    // Prioritize exact matches
                        prioritize_token_position: true, // Match token positions
                        enable_nested_fields: true       // Ensure nested fields are searched
                    };
                    
                    // Add additional constraints for exact phrase matching
                    if (exactQuery.includes(' ')) {
                        // For multi-word phrases:
                        // 1. add strict_mode to ensure all terms are present
                        // 2. create a phrase query to ensure exact ordering
                        searchParameters.strict_mode = true;
                        
                        // Special handling for exact phrase matching
                        // 1. Create a combined filter with OR conditions for fields to contain all terms
                        const searchFields = searchParameters.query_by.split(',');
                        
                        // Split the query into words for exact matching
                        const words = exactQuery.trim().split(/\s+/);
                        
                        // Create a filter to ensure all words are present in at least one field
                        // This is more effective than relying on Typesense's default behavior
                        if (words.length > 1) {
                            const fieldFilters = [];
                            
                            searchFields.forEach(field => {
                                // For each field, create a condition where ALL words must exist in that field
                                const wordFilters = words.map(word => `${field}:${word}`);
                                fieldFilters.push(`(${wordFilters.join(' && ')})`);
                            });
                            
                            // Only add the filter if it's not already set (from tag search for example)
                            if (!searchParameters.filter_by) {
                                searchParameters.filter_by = fieldFilters.join(' || ');
                                console.log('Applied field filters:', searchParameters.filter_by);
                            }
                            
                            // Additional settings to ensure exact matching works better
                            searchParameters.rank_tokens_by_key = searchParameters.query_by; // Rank by all fields
                            
                            // Don't use group_by since url is not a facet field
                            // Instead, use prioritize_exact_match to ensure better results
                            searchParameters.prioritize_exact_match = true;
                            searchParameters.prioritize_token_position = true;
                            searchParameters.sort_by = '_text_match:desc'
                        }
                        
                        console.log('Applied strict phrase matching for:', exactQuery);
                    }
                }

                // Log search parameters for debugging
                console.log('Search parameters being sent to Typesense:', JSON.stringify(searchParameters, null, 2));
                
                let results;
                try {
                    results = await this.typesenseClient
                        .collections(this.config.collectionName)
                        .documents()
                        .search(searchParameters);
                    
                    // Debug log for results
                    console.log(`Search returned ${results.hits?.length || 0} hits`, 
                        wasQuotedSearch ? 'for quoted search' : 'for regular search');
                    if (results.hits?.length > 0) {
                        console.log('First hit text match score:', results.hits[0].text_match);
                    }
                } catch (searchError) {
                    console.error('Typesense search failed:', searchError);
                    // Create an empty results object to prevent further errors
                    results = { hits: [] };
                    
                    // Log additional information for debugging
                    console.error('Failed search query:', query);
                    console.error('Search parameters that failed:', JSON.stringify(searchParameters, null, 2));
                }

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
                
                // The wasQuotedSearch and quotedPhrase variables are already set earlier in the function
                // Just add a debug log here
                if (wasQuotedSearch && quotedPhrase) {
                    console.log('Displaying results for quoted search:', quotedPhrase);
                }
                
                if (this.hitsList) {
                    // Add a search info banner if this was a quoted search
                    if (wasQuotedSearch && quotedPhrase && results.hits.length > 0) {
                        const searchBannerEl = document.createElement('div');
                        searchBannerEl.className = 'mp-search-banner';
                        searchBannerEl.innerHTML = `
                            <div class="mp-quote-search-info">
                                <span class="mp-quote-icon">"</span>
                                Showing exact matches for <strong>${quotedPhrase}</strong>
                                <span class="mp-quote-icon">"</span>
                            </div>
                        `;
                        
                        // Insert banner at the top of results
                        this.hitsList.innerHTML = '';
                        this.hitsList.appendChild(searchBannerEl);
                    } else {
                        this.hitsList.innerHTML = '';
                    }
                    
                    // Add the search results
                    const resultsHtml = results.hits.map(hit => {
                        // Always use plaintext as our primary text content source
                        let textContent = hit.document.plaintext || '';

                        // If for some reason plaintext is empty, use excerpt as fallback
                        if (!textContent) {
                            textContent = hit.document.excerpt || '';
                        }

                        // Create a better excerpt that includes the search term context
                        let excerpt = '';
                        let query = this.searchInput?.value?.trim().toLowerCase() || '';
                        
                        // Handle quoted searches specially for highlighting
                        // Use the already extracted quotedPhrase if this was a quoted search
                        let exactPhrase = wasQuotedSearch ? quotedPhrase : null;
                        
                        // Double check if we should treat this as a quoted search based on query format
                        if (!exactPhrase) {
                            if ((query.startsWith('"') && query.endsWith('"')) || 
                                (query.startsWith('%22') && query.endsWith('%22'))) {
                                // Extract the exact phrase for highlighting as fallback
                                exactPhrase = this.extractTextBetweenQuotes(query);
                            } else if (query.includes('"') || query.includes('%22')) {
                                // Handle case where quotes might be in the middle of the query
                                exactPhrase = this.extractTextBetweenQuotes(query);
                                if (!exactPhrase) {
                                    // Try with the original query if the extraction failed
                                    exactPhrase = this.extractTextBetweenQuotes(originalQuery);
                                }
                            }
                        }
                        
                        if (exactPhrase) {
                            // Force query to the exact phrase for highlighting
                            query = exactPhrase.toLowerCase();
                            console.log('Using exact phrase for highlighting:', exactPhrase);
                        }

                        if (query && textContent.toLowerCase().includes(query)) {
                            // Find the position of the query in the text
                            const queryPosition = textContent.toLowerCase().indexOf(query);
                            // Get a window of text around the query
                            const startPos = Math.max(0, queryPosition - 60);
                            const endPos = Math.min(textContent.length, queryPosition + query.length + 60);
                            const rawExcerpt = textContent.substring(startPos, endPos);

                            // Add highlighting to the query terms in the excerpt if enabled
                            const words = query.split(/\s+/);
                            let highlightedExcerpt = rawExcerpt;

                            // Apply highlighting only if it's enabled in config
                            if (this.config.enableHighlighting !== false) {
                                // Sort words by length in descending order to handle longer phrases first
                                words.sort((a, b) => b.length - a.length);

                                // For exact phrase searches, try to highlight the entire phrase first
                            if (exactPhrase && exactPhrase.length > 2) {
                                try {
                                    // Escape special regex characters
                                    const escapedPhrase = exactPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    
                                    // Create a case-insensitive regex for the exact phrase
                                    const phraseRegex = new RegExp(`(${escapedPhrase})`, 'gi');
                                    
                                    // Apply highlighting using the standard highlight class for consistency
                                    highlightedExcerpt = highlightedExcerpt.replace(phraseRegex, '<mark class="mp-highlight">$1</mark>');
                                    
                                    // Log successful highlighting
                                    console.log('Applied exact phrase highlighting for:', exactPhrase);
                                } catch (e) {
                                    console.warn('Error highlighting exact phrase:', e);
                                }
                            }
                            
                            // Then highlight individual words
                            for (const word of words) {
                                if (word.length < 2) continue; // Skip very short words
                                try {
                                    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const regex = new RegExp(`(${escapedWord})`, 'gi');
                                    // Don't re-highlight words that are already part of a highlighted exact phrase
                                    highlightedExcerpt = highlightedExcerpt.replace(
                                        regex, 
                                        function(match) {
                                            // Only highlight if not already inside a mark tag
                                            if (/<mark[^>]*>[^<]*$/i.test(highlightedExcerpt.substring(0, highlightedExcerpt.indexOf(match))) &&
                                                /^[^<]*<\/mark>/i.test(highlightedExcerpt.substring(highlightedExcerpt.indexOf(match) + match.length))) {
                                                return match; // Already highlighted
                                            }
                                            return '<mark class="mp-highlight">'+match+'</mark>';
                                        }
                                    );
                                } catch (e) {
                                    console.warn('Error highlighting word:', word, e);
                                }
                            }
                            }

                            excerpt = highlightedExcerpt;

                            // Add ellipsis if we're not at the beginning or end
                            if (startPos > 0) excerpt = '...' + excerpt;
                            if (endPos < textContent.length) excerpt = excerpt + '...';
                        } else {
                            // Fallback to standard excerpt if query not found
                            excerpt = textContent.trim().substring(0, 160).replace(/\s+[^\s]*$/, '...');
                        }

                        // Get the original title
                        let title = hit.document.title || 'Untitled';

                        // Highlight the title if it contains the search query and highlighting is enabled
                        if (query && this.config.enableHighlighting !== false) {
                            // For exact phrase searches, try to highlight the entire phrase first in the title
                            if (exactPhrase && exactPhrase.length > 2) {
                                try {
                                    // Escape special regex characters
                                    const escapedPhrase = exactPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    
                                    // Create a case-insensitive regex for the exact phrase
                                    const phraseRegex = new RegExp(`(${escapedPhrase})`, 'gi');
                                    
                                    // Apply highlighting using the standard highlight class for consistency
                                    title = title.replace(phraseRegex, '<mark class="mp-highlight">$1</mark>');
                                    
                                    // Log successful highlighting
                                    console.log('Applied exact phrase highlighting in title for:', exactPhrase);
                                } catch (e) {
                                    console.warn('Error highlighting exact phrase in title:', e);
                                }
                            }
                            
                            const words = query.split(/\s+/);

                            // Sort words by length in descending order to handle longer phrases first
                            words.sort((a, b) => b.length - a.length);

                            // Highlight each word in the title
                            for (const word of words) {
                                if (word.length < 2) continue; // Skip very short words
                                try {
                                    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const regex = new RegExp(`(${escapedWord})`, 'gi');
                                    
                                    // Don't re-highlight words that are already part of a highlighted exact phrase
                                    title = title.replace(
                                        regex, 
                                        function(match) {
                                            // Only highlight if not already inside a mark tag
                                            if (/<mark[^>]*>[^<]*$/i.test(title.substring(0, title.indexOf(match))) &&
                                                /^[^<]*<\/mark>/i.test(title.substring(title.indexOf(match) + match.length))) {
                                                return match; // Already highlighted
                                            }
                                            return '<mark class="mp-highlight">'+match+'</mark>';
                                        }
                                    );
                                } catch (e) {
                                    console.warn('Error highlighting word in title:', word, e);
                                }
                            }
                        }

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
                    // Insert the results HTML into the hitsList element
                    this.hitsList.innerHTML = resultsHtml;
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

        // Suggestions feature has been completely removed
        
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
                // Get the current URL parts
                const url = new URL(window.location.href);
                const pathname = url.pathname;
                const searchParams = url.searchParams;
                
                if (isOpen) {
                    // When opening, check if there are search parameters to move to hash
                    const searchQuery = searchParams.get('s') || searchParams.get('q');
                    
                    if (searchQuery) {
                        // Move the query parameter to the hash portion with clean path format
                        const encodedQuery = encodeURIComponent(searchQuery).replace(/%20/g, '+');
                        const newHash = `#/search/${encodedQuery}`;
                        
                        // Remove the query parameter from the URL
                        searchParams.delete('s');
                        searchParams.delete('q');
                        
                        const newSearch = searchParams.toString();
                        const newPathWithSearch = `${pathname}${newSearch ? `?${newSearch}` : ''}`;
                        
                        // Set the new URL with the query in the hash
                        history.replaceState(null, null, `${newPathWithSearch}${newHash}`);
                    } else if (window.location.hash !== '#/search') {
                        // No query parameters to move, just add the hash
                        history.replaceState(null, null, `${pathname}${window.location.search}#/search`);
                    }
                } else {
                    // When closing, check if the hash contains a search term
                    const hashParts = window.location.hash.split('/');
                    const searchTerm = hashParts.length > 2 ? decodeURIComponent(hashParts[2]) : null;
                    
                    if (searchTerm) {
                        // Add the query parameter back to the URL
                        searchParams.set('q', searchTerm);
                        history.replaceState(null, null, `${pathname}?${searchParams.toString()}`);
                    } else {
                        // No search term in hash, just remove the hash
                        history.replaceState(null, null, `${pathname}${window.location.search}`);
                    }
                }
            }
        }

        async openModal() {
            await this.setModalState(true);
            
            // Check for search query parameters and set input value accordingly
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');
            
            if (searchQuery && this.searchInput) {
                this.searchInput.value = searchQuery;
                this.handleSearch(searchQuery);
            }
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

            // Remove any existing theme classes
            this.wrapper.classList.remove('dark');
            this.wrapper.setAttribute('data-theme', this.config.theme);

            // If system theme, add listener for system changes
            if (this.config.theme === 'system') {
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                const updateSystemTheme = (e) => {
                    this.wrapper.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                };
                updateSystemTheme(mediaQuery);
                mediaQuery.addEventListener('change', updateSystemTheme);
            }
        }
    }

    // Export to window
    window.MagicPagesSearch = MagicPagesSearch;

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