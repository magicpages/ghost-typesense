import Typesense from 'typesense';

(function () {
    let isInitialized = false;
    let observer = null;

    // Alternative UI layouts (uiStyle) are loaded ON DEMAND, not bundled into
    // the core. 'modal' (default) is the built-in centered modal handled inline
    // below — a modal-only site downloads only this core script. When 'palette'
    // or 'discovery' is selected, the core fetches that layout's separate chunk
    // (palette.min.js / discovery.min.js) from its own directory, so a reader
    // never downloads the layouts they didn't choose.
    const ALT_LAYOUTS = ['palette', 'discovery'];

    // Capture the core script's own URL synchronously at load, so on-demand
    // layout chunks can be resolved relative to it (same CDN directory).
    const SELF_URL = (function () {
        try {
            if (document.currentScript && document.currentScript.src) {
                return document.currentScript.src;
            }
            const scripts = document.getElementsByTagName('script');
            for (let i = scripts.length - 1; i >= 0; i--) {
                // Match the core filename only — anchored to a path boundary so
                // it doesn't also match e.g. "presearch.min.js".
                if (scripts[i].src && /(^|\/)search(\.min)?\.js(\?|$)/.test(scripts[i].src)) {
                    return scripts[i].src;
                }
            }
        } catch {
            // ignore — falls back to a relative chunk path below
        }
        return '';
    })();

    // Layout chunks register their factory here when they finish loading.
    const layoutRegistry = {};
    // In-flight chunk loads, keyed by layout id, so concurrent callers share a
    // single <script> injection instead of racing to add duplicates.
    const layoutLoads = {};
    window.__mpRegisterSearchLayout = function (id, factory) {
        layoutRegistry[id] = factory;
    };

    // Resolve a layout chunk URL next to the core script.
    function layoutChunkUrl(id) {
        const file = `${id}.min.js`;
        if (!SELF_URL) return file;
        return SELF_URL.replace(/[^/]+(\?.*)?$/, file);
    }

    // Load (once) and return the factory for an alternative layout. Injects a
    // classic <script> for the chunk — no module system needed, so the core's
    // own classic-script integration is unchanged.
    function loadLayoutFactory(id) {
        if (layoutRegistry[id]) return Promise.resolve(layoutRegistry[id]);
        // Reuse an in-flight load so concurrent callers don't each inject a
        // <script> for the same chunk.
        if (layoutLoads[id]) return layoutLoads[id];
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = layoutChunkUrl(id);
            script.async = true;
            script.onload = () => {
                if (layoutRegistry[id]) resolve(layoutRegistry[id]);
                else reject(new Error(`layout chunk "${id}" loaded but did not register`));
            };
            script.onerror = () => reject(new Error(`failed to load layout chunk "${id}"`));
            document.head.appendChild(script);
        });
        // A failed load clears the cache so a later attempt can retry; a
        // successful one is served from layoutRegistry on the next call anyway.
        layoutLoads[id] = promise;
        promise.catch(() => { delete layoutLoads[id]; });
        return promise;
    }

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

    // Default Typesense client timeout. The first search of a session pays DNS
    // + TCP + TLS to the search host before the query itself goes out, so a
    // tighter budget aborts the handshake on a high-latency or lossy link
    // (a distant VPN exit node is enough). Overridable per site with
    // `connectionTimeoutSeconds`.
    const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 5;

    // What the deprecated `typo_tolerance: true` alias maps to. Typesense's own
    // default, which is what a host asking for "typo tolerance" is describing.
    const DEFAULT_TYPO_TOLERANT_NUM_TYPOS = 2;

    // Spelling correction ("did you mean"). The retry that produces it asks for
    // two typos per word — Typesense's own maximum — because the first, strict
    // request already established that nothing matches as typed.
    const DID_YOU_MEAN_NUM_TYPOS = 2;
    // How much of the retry to mine for the correction. The top hits are the
    // most relevant ones, and the prompt offers a single term.
    const DID_YOU_MEAN_HIT_SAMPLE = 3;
    const DID_YOU_MEAN_TOKEN_SAMPLE = 24;

    // Whether a query already tolerated typos. Typesense's own default is 2, so
    // an absent value is lenient; the widget's defaults set it to 0 explicitly.
    // The value may also be the per-field CSV form ("2,1"), lenient when any
    // field allows a typo.
    function alreadyTypoTolerant(numTypos) {
        if (numTypos === undefined || numTypos === null || numTypos === '') return true;
        return String(numTypos)
            .split(',')
            .some(value => Number(value.trim()) > 0);
    }

    // The typo budget Typesense's defaults allow for a word this long
    // (min_len_1typo: 4, min_len_2typo: 7). Applying the server's own rule
    // keeps a suggestion to words it could actually have corrected.
    function typoBudget(word) {
        if (word.length >= 7) return 2;
        if (word.length >= 4) return 1;
        return 0;
    }

    // Levenshtein distance between two words, abandoned as soon as it is known
    // to exceed `max` (returning max + 1). Only used to decide which indexed
    // token a mistyped word most likely meant, so the exact value past the
    // budget carries no information.
    function editDistanceWithin(a, b, max) {
        if (Math.abs(a.length - b.length) > max) return max + 1;

        let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const current = [i];
            let rowMin = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
                if (current[j] < rowMin) rowMin = current[j];
            }
            if (rowMin > max) return max + 1;
            previous = current;
        }
        return previous[b.length];
    }

    // Every token Typesense reports as matched on a hit. The highlight payload
    // is read structurally rather than field by field, because its shape varies
    // with the Typesense version (`highlight` object vs. the older `highlights`
    // array) and nested fields (tags.name) nest their token lists further.
    function matchedTokensFrom(hit) {
        const tokens = [];

        const collect = (value) => {
            if (Array.isArray(value)) value.forEach(collect);
            else if (typeof value === 'string' && value) tokens.push(value);
        };

        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node.matched_tokens !== undefined) collect(node.matched_tokens);
            Object.values(node).forEach(value => {
                if (value && typeof value === 'object') walk(value);
            });
        };

        walk(hit && hit.highlight);
        walk(hit && hit.highlights);
        return tokens;
    }

    // Facet display. A facet's `limit` is how many values it shows; one more
    // than that is requested, so a list that was cut can be told apart from a
    // complete one without asking Typesense for a total. "Show more" raises the
    // cap by a step, which costs one request and only when a reader asks.
    const DEFAULT_FACET_LIMIT = 10;
    const FACET_EXPANSION_STEP = 40;

    // Ghost's own member-session endpoint, relative to the origin root. A
    // subdirectory install or a path-rewriting proxy overrides it via
    // `memberEndpoint`.
    const DEFAULT_MEMBER_ENDPOINT = '/members/api/member';

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

            // Resolves once the search surface is mounted and safe to show.
            // openModal waits on this rather than on init() as a whole: init()
            // finishes by applying the URL-driven initial state, which may
            // itself open the modal, so waiting on init() there would have it
            // wait on itself.
            this.surfaceReady = new Promise(resolve => {
                this.markSurfaceReady = resolve;
            });

            // Monotonic id of the newest query. The did-you-mean retry resolves
            // after a second request, so it checks this before rendering — a
            // suggestion for a query the reader has already typed past must
            // never land on top of newer results.
            this.searchSequence = 0;
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

            // Facets the reader expanded past their configured limit, keyed by
            // field name to the raised cap. Also reset when the modal closes,
            // so a new session starts from the publisher's own limits.
            this.expandedFacets = {};

            // Suggestions fetched from `suggestionsUrl`, cached for the page
            // session. `suggestionsFetched` guards against re-fetching (and
            // re-failing) on every modal open.
            this.fetchedSuggestions = [];
            this.suggestionsFetched = false;

            // The reader's own access level, resolved once from Ghost (see
            // resolveReaderAccess). 'unknown' until it lands — and permanently
            // when the lookup is off or unavailable — which badges every gated
            // result, the behaviour of a widget that never asked.
            this.readerAccess = 'unknown';
            this.readerAccessPromise = null;

            // Default English translations
            this.defaultI18n = {
                searchPlaceholder: 'Search for anything',
                commonSearchesTitle: 'Common searches',
                emptyStateMessage: 'Start typing to search...',
                loadingMessage: 'Searching...',
                noResultsMessage: 'No results found for your search',
                // Spelling correction offered when a query matched nothing as
                // typed. {q} is replaced with the suggested term.
                didYouMeanLabel: 'Did you mean {q}?',
                // Shown when the search request itself failed (timeout, offline,
                // unreachable host) — never for a query that genuinely matched
                // nothing.
                errorMessage: 'Search is temporarily unavailable',
                errorHint: 'Check your connection and try again.',
                navigateHint: 'to navigate',
                closeHint: 'to close',
                ariaSearchLabel: 'Search',
                ariaCloseLabel: 'Close search',
                ariaResultsLabel: 'Search results',
                ariaArticleExcerpt: 'Article excerpt',
                ariaModalLabel: 'Search',
                ariaFacetsLabel: 'Filters',
                clearFiltersLabel: 'Clear filters',
                // Shown under a facet whose value list was cut short, and on the
                // control that collapses it again.
                facetShowMoreLabel: 'Show more',
                facetShowLessLabel: 'Show less',
                // Gated-result badges. Ghost has two kinds of gate — anyone
                // signed up, and paying readers only — so each gets its own
                // label, overridable by publishers who use their own words for
                // a paying reader ('supporters', 'patrons', …).
                membersLabel: 'Members',
                ariaMembersLabel: 'Members-only content',
                paidLabel: 'Paid members',
                ariaPaidLabel: 'Paid-members-only content',
                untitledPost: 'Untitled',

                // Relative dates for the refined result rows. {n} is substituted.
                relativeNow: 'just now',
                relativeMinutes: '{n}m ago',
                relativeHours: '{n}h ago',
                relativeDays: '{n}d ago',
                relativeMonths: '{n}mo ago',
                relativeYears: '{n}y ago',

                // Palette layout (uiStyle: 'palette'). {n}/{q} placeholders are
                // substituted by the layout.
                paletteRecentGroup: 'Recent searches',
                paletteRecentLabel: 'recent',
                palettePostsGroup: 'Posts',
                paletteTagsGroup: 'Filter by topic',
                paletteAuthorsGroup: 'Filter by author',
                paletteFilterAction: 'Filter',
                paletteEmptyTitle: 'Start typing to search',
                paletteEmptySub: 'Posts, tags, and authors — fast.',
                paletteNoResultsTitle: 'No results for “{q}”',
                paletteNoResultsSub: 'Try a different term.',
                paletteSearching: 'Searching…',
                paletteResultCountOne: '{n} result',
                paletteResultCountOther: '{n} results',
                paletteHintNavigate: 'navigate',
                paletteHintOpen: 'open',
                paletteHintNewTab: 'new tab',
                paletteHintClose: 'close',
                paletteRelativeNow: 'just now',
                paletteRelativeMinutes: '{n}m ago',
                paletteRelativeHours: '{n}h ago',
                paletteRelativeDays: '{n}d ago',
                paletteRelativeMonths: '{n}mo ago',
                paletteRelativeYears: '{n}y ago',

                // Discovery layout (uiStyle: 'discovery').
                facetTopicsLabel: 'Topics',
                facetAuthorsLabel: 'Authors',
                byLabel: 'By',
                readPostLabel: 'Read post',
                resultLabel: 'result',
                resultsLabel: 'results',
                discoveryPreviewLabel: 'Result preview',
                discoverySelectPrompt: 'Select a result to preview it.',
                discoveryNoSelection: 'No post selected.',
                discoveryEmptyTitle: 'Search the archive',
                discoveryEmptyHint: 'Start typing to explore posts. Use ↑ ↓ to move and ↵ to open.',
                discoveryNoFilters: 'No filters available.',
                discoveryGatedNotice: 'This post is available to members. Only the public teaser is shown here.',
                discoveryPaidNotice: 'This post is available to paid members. Only the public teaser is shown here.'
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
                template: defaultConfig.template === 'grid' ? 'grid' : 'list',
                // Overall UI layout: 'modal' (default, the built-in centered
                // modal) or an alternative layout loaded on demand ('palette',
                // 'discovery'). Unknown values fall back to 'modal'.
                uiStyle: ALT_LAYOUTS.includes(defaultConfig.uiStyle) ? defaultConfig.uiStyle : 'modal',
                // Opt in to reading the reader's own membership from Ghost, so a
                // badge is only shown for content they actually cannot open.
                // Off by default: the widget is also embedded on sites that have
                // no Ghost member endpoint to ask.
                memberAwareBadges: defaultConfig.memberAwareBadges === true,
                // Where that lookup goes. The default is Ghost's own path at the
                // origin root; a subdirectory install or a path-rewriting proxy
                // needs its own prefix, or the lookup 404s and every gated
                // result keeps its badge.
                memberEndpoint: typeof defaultConfig.memberEndpoint === 'string' && defaultConfig.memberEndpoint.trim()
                    ? defaultConfig.memberEndpoint.trim()
                    : DEFAULT_MEMBER_ENDPOINT
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

            // Start the membership lookup now rather than on first search, so it
            // has almost certainly landed by the time a reader types. Nothing
            // waits on it: until it resolves, gated results simply keep their
            // badge.
            this.resolveReaderAccess();

            // init() is async (an alternative layout lazily loads its chunk);
            // expose the promise so openModal can wait for the surface to be
            // ready before showing it.
            this.initReady = this.init();
            // A failed mount must not leave openModal waiting for a surface that
            // will never arrive. init() marks the surface ready itself on both
            // paths; this only covers a throw before it gets there.
            this.initReady.then(this.markSurfaceReady, this.markSurfaceReady);
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

        // Send a single analytics event. Prefers fetch(keepalive): it is
        // fire-and-forget, survives the page unload triggered by clicking a
        // result (that is what `keepalive` is for), and — unlike the Beacon
        // API — is not cancelled wholesale by content blockers. uBlock Origin
        // and similar block navigator.sendBeacon broadly, regardless of the
        // destination, so preferring it silently drops events for any reader
        // running a blocker. sendBeacon is kept only as a fallback for the rare
        // engine without fetch. Fully fail-silent: any transport error, or a
        // non-2xx response, must never surface to the reader or break search.
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

                // Preferred transport: keepalive fetch completes across page
                // unloads and isn't caught by Beacon-API filters.
                if (typeof fetch === 'function') {
                    fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body,
                        keepalive: true,
                        mode: 'cors',
                        credentials: 'omit'
                    }).catch(() => {});
                    return;
                }

                // Fallback for environments without fetch.
                if (navigator.sendBeacon) {
                    const blob = new Blob([body], { type: 'application/json' });
                    navigator.sendBeacon(endpoint, blob);
                }
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

        // Whether dark mode is active, from config.theme + OS preference.
        isDarkTheme() {
            const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            return this.config.theme === 'light' ? false : (this.config.theme === 'dark' || preferDark);
        }

        // The highlighted snippet for a field, but only when that field actually
        // matched the query (its highlight carries matched tokens). Returns null
        // otherwise, so a non-matching field that merely echoes its value never
        // pre-empts a field that did match — this is what lets a body-only match
        // surface its highlighted body snippet instead of the (unhighlighted)
        // excerpt. Typesense only lists matched fields in `hit.highlight`, but we
        // also guard on matched_tokens for versions that echo every queried field.
        matchedSnippet(hit, fieldName) {
            if (!this.config.enableHighlighting || !hit || !hit.highlight) return null;
            const h = hit.highlight[fieldName];
            if (!h) return null;
            if (Array.isArray(h.matched_tokens) && h.matched_tokens.length === 0) return null;
            return h.snippet || h.value || null;
        }

        // Normalize a Typesense hit into the model the alternative layouts
        // render, resolving highlight markup, gated status, and the URL once so
        // layouts never re-implement that logic. The *Html fields are trusted
        // (highlight snippet or escaped fallback); other fields are raw data the
        // layout must escape itself.
        normalizeHit(hit, index) {
            const doc = hit.document || {};
            const highlight = (fieldName, fallback) => {
                if (this.config.enableHighlighting && hit.highlight && hit.highlight[fieldName]) {
                    return hit.highlight[fieldName].snippet || hit.highlight[fieldName].value || fallback;
                }
                return fallback;
            };
            const titleHtml = highlight('title', this.escapeHtmlAttr(doc.title)) || this.t('untitledPost');
            // Prefer the highlighted snippet from whichever field actually
            // matched (excerpt, then the body plaintext), so a body-only match
            // still shows its highlighted snippet. Only when neither matched do
            // we fall back to the raw excerpt/plaintext.
            let excerptHtml = this.matchedSnippet(hit, 'excerpt')
                || this.matchedSnippet(hit, 'plaintext')
                || this.escapeHtmlAttr(doc.excerpt || (doc.plaintext || '').substring(0, 160) || '');
            if (excerptHtml && excerptHtml.length > 200) excerptHtml = excerptHtml.substring(0, 200) + '...';

            const url = this.config.transformToRelativeUrls
                ? this.toRelativeUrl(doc.url)
                : (doc.url || '#');
            const isGated = !!doc.visibility && doc.visibility !== 'public';

            return {
                id: doc.id,
                position: index,
                url,
                title: doc.title || '',
                titleHtml,
                ariaTitle: this.escapeHtmlAttr(String(titleHtml).replace(/<[^>]*>/g, '')),
                excerptHtml,
                isGated,
                // Which gate this result sits behind, and whether this reader
                // still needs telling about it. Resolved here so no layout has
                // to reimplement the rule.
                access: this.accessLevel(doc.visibility),
                showBadge: this.needsBadge(doc.visibility),
                visibility: doc.visibility || 'public',
                featureImage: doc.feature_image || null,
                tags: Array.isArray(doc.tags) ? doc.tags : [],
                authors: Array.isArray(doc.authors) ? doc.authors : [],
                publishedAt: typeof doc.published_at === 'number' ? doc.published_at : null
            };
        }

        // The contract an alternative layout receives. The layout touches the
        // core only through this object — never the element internals — which
        // is what keeps layout files isolated and parallel-safe.
        buildLayoutContext() {
            return {
                prefix: CSS_PREFIX,
                config: this.config,
                shadowRoot: this.shadowRoot,
                t: (k) => this.t(k),
                escapeHtmlAttr: (v) => this.escapeHtmlAttr(v),
                toRelativeUrl: (u) => this.toRelativeUrl(u),
                getSuggestions: () => this.getSuggestions(),
                getSelectedFacets: () => this.selectedFacets,
                toggleFacet: (field, value) => {
                    if (!this.selectedFacets[field]) this.selectedFacets[field] = new Set();
                    const set = this.selectedFacets[field];
                    if (set.has(value)) set.delete(value); else set.add(value);
                },
                clearFacets: () => { this.selectedFacets = {}; },
                // Facet display caps, so a layout can render the same abridged
                // list the core does and show the same "show more" affordance.
                getFacetRows: (field, counts) => {
                    const facet = (this.config.facets || []).find(f => f.field === field);
                    if (!facet) return null;
                    return this.facetRows(facet, Array.isArray(counts) ? counts : []);
                },
                expandFacet: (field) => this.expandFacet(field),
                collapseFacet: (field) => this.collapseFacet(field),
                setFacetFilter: () => {},
                search: (q) => this.handleSearch(q),
                requery: () => this.rerunQueryForFacets(),
                trackSearch: (q, c) => this.trackSearch(q, c),
                trackClick: (id, pos) => this.trackClick(id, pos),
                emitClick: (id, pos) => this.trackClick(id, pos),
                close: () => this.closeModal(),
                log: () => {}
            };
        }

        async init() {
            // Alternative layout path: lazily load the selected layout's chunk
            // (palette/discovery), then let it own markup, rendering, and
            // in-surface keyboard nav. The core keeps query/analytics/lifecycle.
            // A modal-only site never reaches this branch and never downloads a
            // layout chunk.
            if (this.config.uiStyle && this.config.uiStyle !== 'modal' && ALT_LAYOUTS.includes(this.config.uiStyle)) {
                let factory;
                try {
                    factory = await loadLayoutFactory(this.config.uiStyle);
                } catch (err) {
                    // Chunk failed to load — fall back to the built-in modal so
                    // search still works.
                    this.config.uiStyle = 'modal';
                }
                if (factory) {
                    try {
                        this.ctx = this.buildLayoutContext();
                        this.activeLayout = factory(this.ctx);
                        // The layout injects its own CSS chunk; the core only injects
                        // the shared base stylesheet (tokens + shared result/badge/
                        // facet styles the layouts reuse).
                        const styles = document.createElement('style');
                        // eslint-disable-next-line no-undef
                        styles.textContent = BUNDLED_CSS;
                        this.shadowRoot.appendChild(styles);
                        if (typeof this.activeLayout.injectStyles === 'function') {
                            this.activeLayout.injectStyles(this.shadowRoot);
                        }
                        const host = document.createElement('div');
                        host.innerHTML = this.activeLayout.buildMarkup();
                        while (host.firstChild) this.shadowRoot.appendChild(host.firstChild);
                        this.activeLayout.cacheElements(this.shadowRoot);
                        this.activeLayout.setTheme(this.isDarkTheme());
                        this.activeLayout.bindEvents();
                        // Deliver in-surface keydowns (arrows, Enter, Home/End,
                        // PageUp/Down) to the layout. bindEvents only wires the
                        // input + clicks; navigation is owned here so every layout
                        // gets it. The listener sits on the shadow root so it fires
                        // while focus is in the layout's search input. The layout
                        // returns true when it consumed the key.
                        if (typeof this.activeLayout.handleKeydown === 'function') {
                            this.shadowRoot.addEventListener('keydown', (e) => {
                                if (!this.isModalOpen) return;
                                const consumed = this.activeLayout.handleKeydown(e);
                                if (consumed) e.stopPropagation();
                            });
                        }
                        this.initGlobalShortcuts();
                        this.setupHashHandling();
                        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                            this.activeLayout.setTheme(this.isDarkTheme());
                        });
                        // The surface is mounted, so anything waiting to open it
                        // may proceed — including handleInitialState below.
                        this.markSurfaceReady();
                        await this.handleInitialState();
                        return;
                    } catch (err) {
                        // The chunk loaded but mounting the layout threw. Reset to
                        // a clean modal state — clear the half-mounted layout and
                        // its shadow content — and fall through to the modal path
                        // below so search still works.
                        this.activeLayout = null;
                        this.config.uiStyle = 'modal';
                        this.shadowRoot.replaceChildren();
                    }
                }
            }

            // Default 'modal' path — unchanged.
            this.createShadowContent();
            this.cacheElements();
            this.updateTheme();
            this.initEventListeners();
            this.setupHashHandling();
            this.markSurfaceReady();
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
                                    <div id="${CSS_PREFIX}-did-you-mean" class="${CSS_PREFIX}-did-you-mean ${CSS_PREFIX}-hidden"></div>
                                </div>
                                <div id="${CSS_PREFIX}-error" class="${CSS_PREFIX}-error ${CSS_PREFIX}-hidden" role="alert">
                                    <p class="${CSS_PREFIX}-error-title">${this.t('errorMessage')}</p>
                                    <p class="${CSS_PREFIX}-error-hint">${this.t('errorHint')}</p>
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
            this.errorState = this.shadowRoot.querySelector(`#${CSS_PREFIX}-error`);
            this.didYouMeanState = this.shadowRoot.querySelector(`#${CSS_PREFIX}-did-you-mean`);
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

        // Document-level global shortcuts + Ghost search-button openers, shared
        // by every layout. Per-layout in-surface nav lives in the layout's own
        // handleKeydown; here we only own open (Cmd/Ctrl+K, /) and close (Esc).
        initGlobalShortcuts() {
            document.addEventListener('keydown', (e) => {
                // When the search is already open, the active surface owns the
                // keyboard. Don't re-fire the open shortcuts — and critically,
                // don't let the "/" opener swallow a slash the reader is trying
                // to type into the search input. Across a shadow boundary the
                // document sees e.target retargeted to the host element (not the
                // inner <input>), so the tagName guard alone can't tell that
                // focus is in the field; gating on isModalOpen does.
                if (this.isModalOpen) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.closeModal();
                    }
                    return;
                }
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

            document.querySelectorAll('[data-ghost-search]').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                });
            });
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

            // "Did you mean …" prompt (delegated; the container is part of the
            // empty state and persists across renders).
            if (this.didYouMeanState) {
                this.didYouMeanState.addEventListener('click', (e) => {
                    const button = e.target.closest(`.${CSS_PREFIX}-did-you-mean-btn`);
                    if (!button) return;
                    e.preventDefault();
                    this.applySearchTerm(button.dataset.search);
                });
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
                this.applySearchTerm(btn.dataset.search);
            };

            container.addEventListener('click', handleClick);
            container.addEventListener('touchend', handleClick);
        }

        // Put a term into the search box and run it, as if the reader had typed
        // it. Shared by the suggestion chips and the "did you mean" prompt so
        // both take the same debounced path and leave the caret at the end.
        applySearchTerm(term) {
            if (!term || !this.searchInput) return;

            this.selectedIndex = -1;
            this.searchInput.value = term;
            this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(() => {
                this.searchInput.focus();
                this.searchInput.setSelectionRange(term.length, term.length);
            }, 0);
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

            // The surface may still be mounting (an alternative layout lazily
            // loads its chunk). Wait for it so we never open against a
            // half-built widget. This settles even when init() failed, so a
            // broken mount shows whatever surface exists rather than hanging.
            await this.surfaceReady;
            if (this.isModalOpen) return;

            // Store active element for focus restoration
            this.activeElement = document.activeElement;
            this.isModalOpen = true;
            this.lockBodyScroll();

            if (this.activeLayout) {
                this.activeLayout.onOpen();
                this.activeLayout.focusInput();
            } else if (this.modal) {
                // Show modal
                this.modal.classList.remove(`${CSS_PREFIX}-hidden`);
                // Focus search input
                setTimeout(() => {
                    this.searchInput && this.searchInput.focus();
                }, 50);
            }

            // Lazily fetch dynamic suggestions on first open (no-op without a
            // suggestionsUrl), then re-render the list. Done after the modal is
            // shown so opening stays instant; the suggestions update in place
            // when the fetch resolves.
            if (this.config.suggestionsUrl && !this.suggestionsFetched) {
                this.fetchSuggestions().then(() => {
                    if (this.activeLayout) this.activeLayout.renderSuggestions();
                    else this.renderSuggestions();
                });
            }

            // Update URL
            if (window.location.hash !== '#/search') {
                history.replaceState(null, null, `${window.location.pathname}${window.location.search}#/search`);
            }

            // Check for search query parameters
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');

            this.applyUrlQuery(searchQuery);
        }

        closeModal() {
            if (!this.isModalOpen) return;
            this.isModalOpen = false;
            this.unlockBodyScroll();
            this.selectedIndex = -1;

            if (this.activeLayout) {
                this.activeLayout.onClose();
            } else {
                this.modal.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.searchInput) this.searchInput.value = '';
            }

            // Reset analytics session state so the next time the modal opens,
            // the first search is emitted even if it repeats a prior query.
            this.lastQuery = '';
            this.lastTrackedQuery = null;
            // Clear any active facet filters so a new session starts unfiltered,
            // and collapse any expanded facet back to its configured limit.
            this.selectedFacets = {};
            this.expandedFacets = {};
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

        // Typesense client options, with the connection budget and retry
        // behaviour overridable per site. Values must be numbers in a sane
        // range; anything else falls back to the default (for the timeout) or
        // to typesense-js's own default (for the retry options), so a typo in
        // the host's config can never disable retries or set a 0s timeout.
        typesenseClientOptions() {
            const { connectionTimeoutSeconds, numRetries, retryIntervalSeconds } = this.config;

            const options = {
                nodes: this.config.typesenseNodes,
                apiKey: this.config.typesenseApiKey,
                connectionTimeoutSeconds: Number.isFinite(connectionTimeoutSeconds) && connectionTimeoutSeconds > 0
                    ? connectionTimeoutSeconds
                    : DEFAULT_CONNECTION_TIMEOUT_SECONDS
            };

            if (Number.isInteger(numRetries) && numRetries >= 0) {
                options.numRetries = numRetries;
            }
            if (Number.isFinite(retryIntervalSeconds) && retryIntervalSeconds >= 0) {
                options.retryIntervalSeconds = retryIntervalSeconds;
            }

            return options;
        }

        // The Typesense client, created on first search and reused afterwards.
        getTypesenseClient() {
            if (!this.typesenseClient) {
                this.typesenseClient = new Typesense.Client(this.typesenseClientOptions());
            }
            return this.typesenseClient;
        }

        // Tell the site owner about a config problem, once per key.
        // getSearchParameters runs on every keystroke, so an unconditional
        // message would fill the console and bury what it is trying to say.
        //
        // console.error, not console.warn: the production bundle strips warn
        // (see the terser `drop_console` list in rollup.config.js), so a warning
        // here would exist in the source and nowhere a publisher could ever read
        // it — which is the same silence this message exists to break.
        logConfigIssueOnce(key, message) {
            if (!this.reportedConfigIssues) this.reportedConfigIssues = new Set();
            if (this.reportedConfigIssues.has(key)) return;
            this.reportedConfigIssues.add(key);
            console.error(message);
        }

        // A search request that never completed — timeout, offline, unreachable
        // host. Logged so a failing connection is diagnosable from the reader's
        // console (typesense-js logs its own retry warnings; this identifies the
        // widget as the caller and carries the final error). The reader sees the
        // translated error state instead, never an empty-results panel.
        logSearchError(error) {
            console.error('MagicPagesSearch: search request failed', error);
        }

        async handleSearch(query) {
            query = query?.trim();

            // Every call supersedes the one before it. The did-you-mean retry
            // finishes after its own round trip, so it carries this token and
            // renders only while it still describes what is on screen.
            const sequence = ++this.searchSequence;

            if (!query) {
                this.selectedIndex = -1;
                if (this.activeLayout) {
                    this.activeLayout.renderInitial();
                    return;
                }
                if (this.hitsList) this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.commonSearches) this.commonSearches.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.errorState) this.errorState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.facetsContainer) this.facetsContainer.classList.add(`${CSS_PREFIX}-hidden`);
                return;
            }

            // Alternative layout path: query via the same params, then hand
            // the normalized model + facet counts to the layout to render.
            if (this.activeLayout) {
                this.activeLayout.renderLoading();
                const searchParams = this.getSearchParameters();
                try {
                    const results = await this.getTypesenseClient()
                        .collections(this.config.collectionName)
                        .documents()
                        .search({ q: query, ...searchParams });

                    // A superseded query's results were never on screen, so they
                    // must not repaint over the newer query's — nor be reported
                    // to analytics or take over click attribution.
                    if (sequence !== this.searchSequence) return;

                    const resultCount = typeof results.found === 'number' ? results.found : results.hits.length;
                    this.lastQuery = query;
                    this.trackSearch(query, resultCount);

                    if (this.config.facets?.length) {
                        this.activeLayout.renderFacets(results.facet_counts, this.selectedFacets);
                    }
                    if (!results.hits.length) {
                        this.activeLayout.renderEmpty(query);
                        const suggestion = await this.fetchDidYouMean(query, searchParams);
                        // Additive: a layout chunk older than this feature keeps
                        // its plain empty surface rather than breaking.
                        if (suggestion && sequence === this.searchSequence &&
                            typeof this.activeLayout.renderDidYouMean === 'function') {
                            this.activeLayout.renderDidYouMean(suggestion);
                        }
                        return;
                    }
                    const model = results.hits.map((hit, i) => this.normalizeHit(hit, i));
                    this.activeLayout.renderResults(model, { query, found: resultCount, facetCounts: results.facet_counts });
                } catch (error) {
                    // Logged even when superseded — a failing connection is
                    // worth a console trace whether or not its query is still
                    // the current one.
                    this.logSearchError(error);
                    if (sequence !== this.searchSequence) return;
                    // A failed request is not an empty archive. Layout chunks
                    // are fetched separately from the core, so fall back to the
                    // empty surface for a layout that predates renderError.
                    if (typeof this.activeLayout.renderError === 'function') {
                        this.activeLayout.renderError(query);
                    } else {
                        this.activeLayout.renderEmpty(query);
                    }
                }
                return;
            }

            // Update UI immediately
            if (this.commonSearches) this.commonSearches.classList.add(`${CSS_PREFIX}-hidden`);
            if (this.hitsList) this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            if (this.loadingState) this.loadingState.classList.remove(`${CSS_PREFIX}-hidden`);
            if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);
            if (this.errorState) this.errorState.classList.add(`${CSS_PREFIX}-hidden`);

            try {
                const searchParams = this.getSearchParameters();
                const searchParameters = {
                    q: query,
                    ...searchParams
                };

                const results = await this.getTypesenseClient()
                    .collections(this.config.collectionName)
                    .documents()
                    .search(searchParameters);

                // Superseded while in flight: the newer query owns the surface,
                // and its own request is still running — so leave the loading
                // state alone rather than reporting this one's outcome.
                if (sequence !== this.searchSequence) return;

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
                    // Cleared first, so a suggestion for an earlier query can
                    // never sit under this one while the retry is in flight.
                    this.renderDidYouMean(null);
                    if (this.emptyState) this.emptyState.classList.remove(`${CSS_PREFIX}-hidden`);
                    if (this.hitsList) {
                        this.hitsList.innerHTML = '';
                        this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                    }

                    const suggestion = await this.fetchDidYouMean(query, searchParams);
                    if (suggestion && sequence === this.searchSequence) {
                        this.renderDidYouMean(suggestion);
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

                    const title = getHighlightedTitle('title', hit.document.title) || this.t('untitledPost');
                    // Prefer the highlighted snippet from whichever field actually
                    // matched (excerpt, then the body plaintext), so a body-only
                    // match still shows its highlighted snippet rather than the
                    // unhighlighted excerpt. Fall back to the raw excerpt/plaintext
                    // only when neither matched.
                    // matchedSnippet returns trusted highlight markup (Typesense
                    // <mark> tags); the raw document fallback is escaped before it
                    // reaches innerHTML, mirroring normalizeHit.
                    let excerpt = this.matchedSnippet(hit, 'excerpt') ||
                                  this.matchedSnippet(hit, 'plaintext') ||
                                  this.escapeHtmlAttr(
                                      hit.document.excerpt ||
                                      hit.document.plaintext?.substring(0, 80) || ''
                                  );
                    if (excerpt && excerpt.length > 200) excerpt = excerpt.substring(0, 200) + '...';

                    const resultUrl = this.config.transformToRelativeUrls
                        ? this.toRelativeUrl(hit.document.url)
                        : (hit.document.url || '#');

                    // A non-public (members-only / paid) result, surfaced via
                    // the redacted index documents. The raw visibility stays on
                    // the link so a theme can style it or route the click to a
                    // membership flow; `badgeAccess` is the narrower question of
                    // what to show this reader.
                    const isGated = !!hit.document.visibility && hit.document.visibility !== 'public';
                    const badgeAccess = this.needsBadge(hit.document.visibility)
                        ? this.accessLevel(hit.document.visibility)
                        : null;

                    // The link wrapper (class + data attributes + aria-label) is
                    // shared by both templates, so keyboard navigation, click
                    // handling, and analytics behave identically — only the
                    // inner article markup differs.
                    return `
                        <a href="${resultUrl}"
                            class="${CSS_PREFIX}-result-link${isGated ? ` ${CSS_PREFIX}-result-gated` : ''}"
                            data-result-id="${this.escapeHtmlAttr(hit.document.id)}"
                            data-result-position="${index}"
                            ${isGated ? `data-gated="${this.escapeHtmlAttr(hit.document.visibility)}"` : ''}
                            aria-label="${title.replace(/<[^>]*>/g, '')}">
                            ${this.config.template === 'grid'
                                ? this.renderGridCard(hit, title, excerpt, badgeAccess)
                                : this.renderListItem(hit, title, excerpt, badgeAccess)}
                        </a>
                    `;
                }).join('');

                this.hitsList.innerHTML = resultsHtml;
                this.hitsList.classList.toggle(`${CSS_PREFIX}-grid`, this.config.template === 'grid');
                this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            } catch (error) {
                // Logged even when superseded (see the layout path above).
                this.logSearchError(error);
                if (sequence !== this.searchSequence) return;
                // The request failed, so show the error state — not the empty
                // state, which would tell the reader the archive has nothing on
                // their topic. The empty state was hidden before the request.
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.errorState) this.errorState.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.hitsList) {
                    this.hitsList.innerHTML = '';
                    this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                }
                if (this.facetsContainer) this.facetsContainer.classList.add(`${CSS_PREFIX}-hidden`);
            }
        }

        // A query that matched nothing, re-run once with typo tolerance raised,
        // so a misspelling can be offered back to the reader as a correction
        // instead of a dead end. Returns the corrected phrase, or null when
        // there is nothing worth offering.
        async fetchDidYouMean(query, searchParams) {
            // On unless the host turned it off: the widget matches strictly
            // (num_typos: 0), so without this a mistyped word is a dead end.
            if (this.config.enableDidYouMean === false) return null;

            // A host that already searches leniently took its best shot on the
            // first request; repeating it more leniently would find the same
            // nothing. So strict-matching hosts (the default) pay one extra
            // request, and only on a genuine miss; lenient ones pay none.
            if (alreadyTypoTolerant(searchParams.num_typos)) return null;

            let results;
            try {
                results = await this.getTypesenseClient()
                    .collections(this.config.collectionName)
                    .documents()
                    .search({
                        ...searchParams,
                        q: query,
                        num_typos: DID_YOU_MEAN_NUM_TYPOS
                    });
            } catch (error) {
                // The correction is an extra on top of an empty result the
                // reader is already looking at. A failed retry leaves that
                // empty state alone rather than escalating to an error the
                // first request never hit.
                this.logSearchError(error);
                return null;
            }

            const hits = Array.isArray(results?.hits) ? results.hits : [];
            if (!hits.length) return null;

            return this.didYouMeanFromHits(query, hits);
        }

        // The phrase to offer for `query`, derived from what the typo-tolerant
        // retry actually matched in the index — so the wording comes from the
        // publisher's own posts rather than a client-side dictionary. Each typed
        // word is either confirmed by a matched token or replaced by the nearest
        // one within the typo budget Typesense allows for a word that length.
        // Returns null when nothing changed: there is nothing to suggest to a
        // reader who already typed the words the index holds.
        didYouMeanFromHits(query, hits) {
            const candidates = [];
            const indexed = new Set();

            for (const hit of hits.slice(0, DID_YOU_MEAN_HIT_SAMPLE)) {
                for (const token of matchedTokensFrom(hit)) {
                    const lower = token.toLowerCase();
                    if (indexed.has(lower)) continue;
                    indexed.add(lower);
                    candidates.push(token);
                    if (candidates.length >= DID_YOU_MEAN_TOKEN_SAMPLE) break;
                }
                if (candidates.length >= DID_YOU_MEAN_TOKEN_SAMPLE) break;
            }

            if (candidates.length === 0) return null;

            let corrected = false;
            const words = query.split(/\s+/).filter(Boolean).map(word => {
                // The index holds this word as typed — whatever went wrong with
                // the query, it was not this one.
                if (indexed.has(word.toLowerCase())) return word;

                const budget = typoBudget(word);
                if (budget === 0) return word;

                let best = null;
                let bestDistance = budget + 1;
                for (const candidate of candidates) {
                    const distance = editDistanceWithin(word.toLowerCase(), candidate.toLowerCase(), budget);
                    if (distance < bestDistance) {
                        best = candidate;
                        bestDistance = distance;
                        // A distance of 0 is impossible here (the word is not in
                        // the index), so 1 is as close as a candidate can get.
                        if (distance === 1) break;
                    }
                }

                if (!best) return word;
                corrected = true;
                return best;
            });

            return corrected ? words.join(' ') : null;
        }

        // The "did you mean" prompt inside the modal's empty state. Passing null
        // clears it.
        renderDidYouMean(term) {
            if (!this.didYouMeanState) return;

            if (!term) {
                this.didYouMeanState.innerHTML = '';
                this.didYouMeanState.classList.add(`${CSS_PREFIX}-hidden`);
                return;
            }

            const safeTerm = this.escapeHtmlAttr(term);
            // The translation is publisher config, not markup: its own text is
            // escaped and only the wrapper around the term is HTML. Splitting on
            // the placeholder — rather than escaping the whole string and then
            // substituting into it — keeps that contract obvious, and is the
            // same in all three layouts.
            const label = this.t('didYouMeanLabel')
                .split('{q}')
                .map(part => this.escapeHtmlAttr(part))
                .join(`<strong class="${CSS_PREFIX}-did-you-mean-term">${safeTerm}</strong>`);

            this.didYouMeanState.innerHTML =
                `<button type="button" class="${CSS_PREFIX}-did-you-mean-btn" data-search="${safeTerm}">${label}</button>`;
            this.didYouMeanState.classList.remove(`${CSS_PREFIX}-hidden`);
        }

        // Add a field to what a query searches, keeping `query_by_weights` the
        // same length as `query_by`. That pairing is not cosmetic: Typesense
        // rejects a search outright when the two lists differ, so a field added
        // without its weight would turn a ranking tweak into a failed request.
        // Weights are left alone when unset — Typesense then weights every field
        // equally, and a partial list would be worse than none. Returns whether
        // the field was added, which is false when it was already searched.
        addQueryField(params, field, weight = 1) {
            if (!field) return false;

            const fields = String(params.query_by || '')
                .split(',')
                .map(f => f.trim())
                .filter(Boolean);
            if (fields.includes(field)) return false;

            fields.push(field);
            params.query_by = fields.join(',');

            if (params.query_by_weights) {
                const weights = String(params.query_by_weights)
                    .split(',')
                    .map(w => w.trim())
                    .filter(Boolean);
                weights.push(String(weight));
                params.query_by_weights = weights.join(',');
            }

            return true;
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
                include_fields: 'id,title,url,excerpt,plaintext,published_at,tags,authors,feature_image,visibility',
                // Stricter than Typesense's own default of 2: a query returns
                // the posts that contain the words, not their near-neighbours,
                // which keeps results predictable. `enableDidYouMean` covers the
                // misspelling case by retrying once and offering the correction.
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

            // `typo_tolerance` is not a Typesense search parameter — it never
            // was. The widget used to send it and the README documented it as
            // the switch for typo correction, so a host who set it got nothing:
            // Typesense ignores unknown parameters, `num_typos` stayed 0, and
            // nothing anywhere said so. It is read here as the alias its authors
            // meant it to be (and never forwarded), so those configs start
            // behaving as intended. An explicit `num_typos` always wins.
            if (Object.prototype.hasOwnProperty.call(customParams, 'typo_tolerance')) {
                delete mergedParams.typo_tolerance;
                if (customParams.typo_tolerance && customParams.num_typos === undefined) {
                    mergedParams.num_typos = DEFAULT_TYPO_TOLERANT_NUM_TYPOS;
                }
                this.logConfigIssueOnce(
                    'typo_tolerance',
                    'MagicPagesSearch: `typo_tolerance` is not a Typesense search parameter and does '
                    + 'nothing on its own. Reading it as `num_typos: 2` for now; set `num_typos` '
                    + 'directly instead (0 matches strictly, 1–2 tolerate typos).'
                );
            }

            // Opt-in: make author names matchable by keyword. Off by default
            // (matching the historical behaviour where typing an author name
            // found nothing). Applied to the merged params rather than the
            // defaults, because a host-supplied `query_by` replaces the default
            // one wholesale — appending to the defaults meant the option did
            // nothing for exactly that host who had tuned their query. Publishers
            // can still put `authors` in searchFields (or their own query_by) for
            // full control over its weight; this is a no-op when it is there.
            if (this.config.searchAuthors) {
                this.addQueryField(mergedParams, 'authors');
            }

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

            // The members-only badge keys off `visibility`, so keep it in the
            // returned fields even if a host overrode include_fields. Harmless
            // for public-only collections (the field is simply absent there).
            {
                const fields = String(mergedParams.include_fields || '')
                    .split(',')
                    .map(f => f.trim())
                    .filter(Boolean);
                if (fields.length && !fields.includes('visibility')) {
                    fields.push('visibility');
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

            // Alternative layouts declare the extra fields they render (e.g.
            // discovery needs feature_image + authors for its preview pane);
            // union them into include_fields so the layout actually receives
            // that data. Without this, the preview falls back to a placeholder.
            if (this.activeLayout && typeof this.activeLayout.requiredFields === 'function') {
                const needed = this.activeLayout.requiredFields() || [];
                if (needed.length) {
                    const fields = String(mergedParams.include_fields || '')
                        .split(',')
                        .map(f => f.trim())
                        .filter(Boolean);
                    let changed = false;
                    for (const f of needed) {
                        if (f && !fields.includes(f)) { fields.push(f); changed = true; }
                    }
                    if (changed) mergedParams.include_fields = fields.join(',');
                }
            }

            // Semantic (hybrid) search: when enabled, append the embedding
            // field to `query_by`. Typesense then fuses keyword and vector
            // relevance, auto-embedding the query against the field's model.
            // When disabled, queries stay purely lexical.
            if (this.config.semanticSearch) {
                const embeddingField = this.config.embeddingFieldName || 'embedding';
                if (this.addQueryField(mergedParams, embeddingField)) {
                    // Bias hybrid ranking toward keyword matches so a strong
                    // textual hit (e.g. an author name) outranks merely
                    // vector-near posts, and drop far semantic-only matches.
                    // alpha is the vector weight in rank fusion (lower = more
                    // keyword-dominant; Typesense default 0.3); distance_threshold
                    // excludes vector matches beyond that cosine distance. Both
                    // are overridable via config.semanticAlpha /
                    // config.semanticDistanceThreshold, and a host-provided
                    // vector_query wins outright.
                    if (!mergedParams.vector_query) {
                        const alpha = typeof this.config.semanticAlpha === 'number'
                            ? this.config.semanticAlpha : 0.2;
                        const threshold = typeof this.config.semanticDistanceThreshold === 'number'
                            ? this.config.semanticDistanceThreshold : 0.8;
                        mergedParams.vector_query =
                            `${embeddingField}:([], alpha: ${alpha}, distance_threshold: ${threshold})`;
                    }
                }
            }

            // Reader-facing facets: request facet counts for the configured
            // fields and AND any selected values into `filter_by`, preserving a
            // publisher-configured filter rather than overwriting it.
            if (this.config.facets?.length) {
                mergedParams.facet_by = this.config.facets.map(f => f.field).join(',');

                // One more than the longest list any facet will show. The extra
                // value is never rendered; it is what tells a cut list apart
                // from a complete one. `max_facet_values` is a single global
                // parameter, so the largest cap wins — which is also why a facet
                // with a smaller limit receives more values than it shows, and
                // can detect its own truncation from the same response.
                const caps = this.config.facets.map(f => this.facetCap(f));
                const maxCap = Math.max(...caps);
                if (Number.isFinite(maxCap)) {
                    mergedParams.max_facet_values = maxCap + 1;
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

        // How many values a facet shows when collapsed: its configured `limit`,
        // or the default. A non-numeric or non-positive limit falls back to the
        // default rather than hiding the facet entirely.
        facetLimit(facet) {
            const limit = facet && facet.limit;
            return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_FACET_LIMIT;
        }

        // How many values it shows right now — the same, unless the reader has
        // expanded it.
        facetCap(facet) {
            const limit = this.facetLimit(facet);
            const raised = facet ? this.expandedFacets[facet.field] : undefined;
            return Number.isFinite(raised) && raised > limit ? raised : limit;
        }

        // Raise a facet's cap by one step. The wider list comes from the next
        // request, so the reader pays for it only by asking.
        expandFacet(field) {
            const facet = (this.config.facets || []).find(f => f.field === field);
            if (!facet) return;
            this.expandedFacets[field] = this.facetCap(facet) + FACET_EXPANSION_STEP;
        }

        // Back to the publisher's configured limit.
        collapseFacet(field) {
            delete this.expandedFacets[field];
        }

        // The values a facet renders, and whether the response held more than
        // that. Selected values are always kept, even when they rank below the
        // cap — a filter the reader turned on must stay switchable off.
        facetRows(facet, counts) {
            const cap = this.facetCap(facet);
            const selected = this.selectedFacets[facet.field];
            const visible = counts.slice(0, cap);

            if (selected && selected.size) {
                const shown = new Set(visible.map(c => c.value));

                // Ranked below the cap but still in the response: keep its real
                // count.
                for (const entry of counts.slice(cap)) {
                    if (selected.has(entry.value) && !shown.has(entry.value)) {
                        visible.push(entry);
                        shown.add(entry.value);
                    }
                }

                // Ranked below what was even requested, so the response does not
                // carry it at all — the field asks for one value past the cap,
                // not for everything. Shown with a zero count, as the discovery
                // rail already does, because a chip the reader switched on has
                // to stay switchable off.
                for (const value of selected) {
                    if (!shown.has(value)) {
                        visible.push({ value, count: 0 });
                        shown.add(value);
                    }
                }
            }

            return {
                rows: visible,
                truncated: counts.length > cap,
                expanded: cap > this.facetLimit(facet)
            };
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

            // An active selection keeps the rail on screen even when the
            // response carried no counts at all: hiding it would take the
            // "clear filters" control with it, stranding the reader in a filter
            // they can no longer see, let alone undo.
            const hasSelection = Object.values(this.selectedFacets).some(s => s && s.size > 0);
            const hasCounts = Array.isArray(facetCounts) && facetCounts.length > 0;

            if (!this.config.facets?.length || (!hasCounts && !hasSelection)) {
                this.facetsContainer.innerHTML = '';
                this.facetsContainer.classList.add(`${CSS_PREFIX}-hidden`);
                return;
            }

            // Map configured fields to their display labels and order.
            const countsByField = {};
            for (const fc of (hasCounts ? facetCounts : [])) {
                countsByField[fc.field_name] = fc.counts || [];
            }

            const groups = this.config.facets.map((facet, groupIndex) => {
                const counts = countsByField[facet.field] || [];
                const selected = this.selectedFacets[facet.field];
                // A field with an active selection renders even when the
                // response carried no counts for it — a query that its own
                // filter narrowed to nothing would otherwise take the chip away
                // along with the only way to undo it.
                if (counts.length === 0 && !(selected && selected.size)) return '';

                const { rows, truncated, expanded } = this.facetRows(facet, counts);
                const chips = rows.map(({ value, count }) => {
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

                // A cut list says so, and offers the rest. Without this the
                // missing values read as "this topic doesn't exist" rather than
                // "this list is abridged".
                const chipsId = `${CSS_PREFIX}-facet-chips-${groupIndex}`;
                const toggle = truncated || expanded
                    ? `<button type="button"
                            class="${CSS_PREFIX}-facet-more"
                            data-facet-field="${this.escapeHtmlAttr(facet.field)}"
                            data-facet-expand="${truncated ? 'more' : 'less'}"
                            aria-controls="${chipsId}"
                            aria-expanded="${expanded ? 'true' : 'false'}">${
                                truncated ? this.t('facetShowMoreLabel') : this.t('facetShowLessLabel')
                            }</button>`
                    : '';

                return `
                    <div class="${CSS_PREFIX}-facet-group">
                        <div class="${CSS_PREFIX}-facet-group-label">${this.escapeHtmlAttr(facet.label || facet.field)}</div>
                        <div id="${chipsId}" class="${CSS_PREFIX}-facet-chips" role="list">${chips}</div>
                        ${toggle}
                    </div>
                `;
            }).join('');

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

                const moreBtn = e.target.closest(`.${CSS_PREFIX}-facet-more`);
                if (moreBtn) {
                    e.preventDefault();
                    const field = moreBtn.dataset.facetField;
                    if (!field) return;
                    if (moreBtn.dataset.facetExpand === 'less') this.collapseFacet(field);
                    else this.expandFacet(field);
                    // The wider (or narrower) list comes from the response, so
                    // the current query is re-run for it.
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

        // Ghost's post visibility, reduced to the gate a reader runs into:
        // 'public' (none), 'members' (any signed-up reader), or 'paid'.
        //
        // 'tiers' counts as paid. Ghost filters a tiers post's tier list down to
        // paid tiers when it serialises the post, so tier-gated content is never
        // reachable on a free account. Anything else unrecognised falls back to
        // 'members', which is the weaker of the two claims.
        accessLevel(visibility) {
            const value = visibility || 'public';
            if (value === 'public') return 'public';
            if (value === 'paid' || value === 'tiers') return 'paid';
            return 'members';
        }

        // Whether this reader still needs the badge on a gated result.
        //
        // Only suppressed where access is certain: a signed-in reader of any
        // kind can open a members post, and a paying reader can open a paid
        // one. A 'tiers' post names specific paid tiers that the index does not
        // record, so it stays badged even for a paying reader rather than
        // promising access we cannot verify.
        needsBadge(visibility) {
            const access = this.accessLevel(visibility);
            if (access === 'public') return false;

            const signedIn = this.readerAccess === 'free' || this.readerAccess === 'paid';
            if (signedIn && access === 'members') return false;
            if (this.readerAccess === 'paid' && visibility === 'paid') return false;
            return true;
        }

        // Ask Ghost who is reading, once per page, at `memberEndpoint`.
        // Same-origin and cookie-authed: 204 means signed out, a body means
        // signed in, and `paid` there already folds in comped members. Every
        // other outcome — the flag off, a site without the endpoint, an offline
        // reader — leaves 'unknown', which badges everything.
        //
        // Deliberately never awaited by a render path: badges reflect whatever
        // has resolved by the time a query is typed, and the request is fired at
        // init so that is almost always the real answer.
        resolveReaderAccess() {
            if (!this.config.memberAwareBadges) return Promise.resolve('unknown');
            if (this.readerAccessPromise) return this.readerAccessPromise;

            this.readerAccessPromise = fetch(this.config.memberEndpoint || DEFAULT_MEMBER_ENDPOINT, {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            })
                .then(async (response) => {
                    if (response.status === 204) return 'anonymous';
                    if (!response.ok) return 'unknown';
                    const member = await response.json();
                    return member && member.paid ? 'paid' : 'free';
                })
                .catch(() => 'unknown')
                .then((access) => {
                    this.readerAccess = access;
                    return access;
                });

            return this.readerAccessPromise;
        }

        // A small lock badge shown on gated results. `access` is an accessLevel()
        // value; 'public' (or nothing) renders no badge.
        gatedBadge(access) {
            if (!access || access === 'public') return '';
            const isPaid = access === 'paid';
            const label = this.escapeHtmlAttr(this.t(isPaid ? 'paidLabel' : 'membersLabel'));
            const ariaLabel = this.escapeHtmlAttr(this.t(isPaid ? 'ariaPaidLabel' : 'ariaMembersLabel'));
            return `<span class="${CSS_PREFIX}-gated-badge ${CSS_PREFIX}-gated-badge-${access}" aria-label="${ariaLabel}">
                        <span aria-hidden="true">🔒</span> ${label}
                    </span>`;
        }

        // Human-relative date from an epoch-ms timestamp.
        relativeDate(epochMs) {
            if (epochMs == null) return '';
            const diff = Date.now() - Number(epochMs);
            if (Number.isNaN(diff)) return '';
            const day = Math.round(diff / 86400000);
            if (day > 365) return this.t('relativeYears').replace('{n}', Math.round(day / 365));
            if (day > 30) return this.t('relativeMonths').replace('{n}', Math.round(day / 30));
            if (day >= 1) return this.t('relativeDays').replace('{n}', day);
            const hr = Math.round(diff / 3600000);
            if (hr >= 1) return this.t('relativeHours').replace('{n}', hr);
            const min = Math.round(diff / 60000);
            if (min >= 1) return this.t('relativeMinutes').replace('{n}', min);
            return this.t('relativeNow');
        }

        // Refined list row: a feature-image thumbnail (tinted first-letter
        // fallback when absent), highlighted title, one-line excerpt, and a
        // metadata line (date · primary tag · author).
        //
        // Two call signatures are supported, distinguished at runtime by the
        // type of the first argument:
        //
        //   renderListItem(title: string, excerpt?: string, access?: string)
        //     — the simple title+excerpt row. Used by the unit tests, which
        //       assert on this stable shape.
        //   renderListItem(hit: object, title: string, excerpt: string, access: string)
        //     — the rich row. `hit` is the Typesense hit (its `.document`
        //       supplies feature_image/tags/authors/etc.); `title`/`excerpt`
        //       are the highlighted HTML. `access` is an accessLevel() value and
        //       arrives as the 4th argument (read via `arguments[3]`) so the two
        //       signatures can share the same three named parameters.
        //
        // Prefer calling the rich signature explicitly with all four arguments.
        renderListItem(hitOrTitle, excerptOrUndefined, accessArg) {
            // Legacy/string-call signature (tests): (title, excerpt, access)
            if (typeof hitOrTitle === 'string') {
                const title = hitOrTitle;
                const excerpt = excerptOrUndefined || '';
                return `
                    <article class="${CSS_PREFIX}-result-item" role="article">
                        <h3 class="${CSS_PREFIX}-result-title" role="heading" aria-level="3">${title}${this.gatedBadge(accessArg)}</h3>
                        <p class="${CSS_PREFIX}-result-excerpt" aria-label="${this.t('ariaArticleExcerpt')}">${excerpt}</p>
                    </article>
                `;
            }

            // Rich-call signature: (hit, title, excerpt, access)
            const hit = hitOrTitle;
            const title = excerptOrUndefined;
            const excerpt = accessArg;
            const access = arguments[3];
            const doc = hit.document || {};

            const featureImage = doc.feature_image;
            const letter = this.escapeHtmlAttr((doc.title || '?').trim().charAt(0).toUpperCase() || '?');
            const thumb = featureImage
                ? `<img class="${CSS_PREFIX}-row-thumb" src="${this.escapeHtmlAttr(featureImage)}" alt="" loading="lazy" />`
                : `<span class="${CSS_PREFIX}-row-thumb ${CSS_PREFIX}-row-thumb-empty" aria-hidden="true">${letter}</span>`;

            const metaParts = [];
            const date = this.relativeDate(doc.published_at);
            if (date) metaParts.push(`<span>${this.escapeHtmlAttr(date)}</span>`);
            const primaryTag = Array.isArray(doc.tags) && doc.tags.length ? doc.tags[0] : '';
            if (primaryTag) metaParts.push(`<span class="${CSS_PREFIX}-row-meta-tag">${this.escapeHtmlAttr(primaryTag)}</span>`);
            const author = Array.isArray(doc.authors) && doc.authors.length ? doc.authors[0] : '';
            if (author) metaParts.push(`<span>${this.escapeHtmlAttr(author)}</span>`);
            const meta = metaParts.length
                ? `<div class="${CSS_PREFIX}-row-meta">${metaParts.join(`<span class="${CSS_PREFIX}-row-meta-sep" aria-hidden="true">·</span>`)}</div>`
                : '';

            return `
                <article class="${CSS_PREFIX}-result-item ${CSS_PREFIX}-row" role="article">
                    ${thumb}
                    <div class="${CSS_PREFIX}-row-body">
                        <h3 class="${CSS_PREFIX}-result-title" role="heading" aria-level="3">${title}${this.gatedBadge(access)}</h3>
                        <p class="${CSS_PREFIX}-result-excerpt" aria-label="${this.t('ariaArticleExcerpt')}">${excerpt}</p>
                        ${meta}
                    </div>
                </article>
            `;
        }

        // Grid (card) layout: feature image, title, excerpt, and tags. The
        // image is decorative (the link already carries the title via
        // aria-label); when a post has no feature_image a styled placeholder is
        // shown instead of a broken image.
        renderGridCard(hit, title, excerpt, access) {
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
                        <h3 class="${CSS_PREFIX}-result-title" role="heading" aria-level="3">${title}${this.gatedBadge(access)}</h3>
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

        // Put a query carried in the URL into whichever surface is mounted and
        // run it. The modal owns an input; an alternative layout takes it
        // through setQuery — which is why this cannot just write to
        // `this.searchInput`, as it is null for palette and discovery.
        applyUrlQuery(query) {
            if (!query) return;

            if (this.activeLayout) this.activeLayout.setQuery(query);
            else if (this.searchInput) this.searchInput.value = query;
            else return;

            this.handleSearch(query);
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
                // openModal reads `?s=`/`?q=` from the URL itself; the hash-path
                // form is this branch's own to apply.
                this.applyUrlQuery(hashQuery);
            } else if (searchQuery || window.location.hash === '#/search') {
                // No second call for `searchQuery`: opening already ran it, and
                // repeating it here cost a duplicate request for the same query.
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
