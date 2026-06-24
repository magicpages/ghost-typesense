# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.6] - 2026-06-24

### Changed
- **Discovery layout no longer shows a placeholder for posts without a feature
  image.** The discovery preview pane rendered a grey placeholder hero (a framed
  image icon) whenever the selected post had no `feature_image`. On text-led
  publications that meant a placeholder on effectively every result. The preview
  now omits the hero entirely when there is no image, so an image-less post reads
  as a clean text preview; the hero image still renders when one is present. The
  modal `grid` template's own placeholder is unchanged. Search-ui bundle change
  only — update and redeploy the rebuilt `discovery.min.js`.

## [2.0.5] - 2026-06-22

### Fixed
- **Search failed to load on pages that define a global `t`.** The search-ui
  bundles injected their inlined CSS via Rollup's `banner` option, which emits
  code *outside* the IIFE wrapper — so `BUNDLED_CSS` (and the layouts'
  `LAYOUT_CSS`) sat at global scope, where terser's `toplevel` mangle renamed it
  to a single-letter global lexical `const t`. On any page where another script
  already defines a global `t` (common in minified Ghost/theme bundles), the
  redeclaration threw `Identifier 't' has already been declared` on the first
  line of `search.min.js`. A top-level `SyntaxError` aborts the *entire* script
  before its IIFE runs, so `window.MagicPagesSearch` was never defined and search
  silently failed to load. The CSS is now injected via `intro`, which is emitted
  *inside* the IIFE, keeping the constant function-scoped so it can no longer
  leak to the global object or collide. Affects the core, palette, and discovery
  bundles. No source changes — build/release fix only; update and redeploy the
  rebuilt bundle.

## [2.0.4] - 2026-06-13

### Fixed
- **Internal tags were indexed and shown in results.** Ghost internal tags
  (`visibility: 'internal'`, `#`-prefixed name, `hash-` slug) — which Ghost hides
  from public output — were written into the `tags` / `tags.name` / `tags.slug`
  fields, so they were searchable, facetable, and displayed in the result meta
  line. The indexer now filters them out, matching Ghost's public-output
  behaviour. Existing collections need a reindex to drop already-indexed
  internal tags.

### Changed
- Added a `prepublishOnly` build step to the search-ui package so the published
  `dist/` can never go stale relative to source (the failure mode behind the
  bad 2.0.0 / 2.0.1 publishes).

## [2.0.3] - 2026-06-09

### Fixed
- **Analytics events were dropped for readers running content blockers.** The
  emitter preferred `navigator.sendBeacon`, which uBlock Origin and similar
  block broadly regardless of destination — and the `fetch(keepalive)` fallback
  only ran when `sendBeacon` was *absent*, not when it was present-but-blocked,
  so the event was simply lost. `fetch(keepalive)` is now the primary transport
  (it survives page unload and isn't caught by Beacon-API filters); `sendBeacon`
  remains only as a fallback for engines without `fetch`. Behaviour is otherwise
  unchanged — analytics stays fully fail-silent and never affects search.

## [2.0.2] - 2026-06-09

### Fixed
- **Republished with the correct build artifacts.** The `2.0.0` and `2.0.1` npm
  packages were published with a stale `dist/` that predated the 2.0 features —
  the bundle contained no semantic-search or `uiStyle` layout code, and the
  `palette.min.js` / `discovery.min.js` chunks were missing entirely. As a
  result, sites updated to `2.0.0`/`2.0.1` silently kept running keyword-only
  search even with `semanticSearch` enabled. `2.0.2` ships the correctly built
  bundle (semantic/hybrid querying, the three `uiStyle` layouts, and the layout
  chunks). No source changes versus 2.0.0 — this is a build/release fix only.
  Update to `2.0.2`; `2.0.0` and `2.0.1` should not be used.

## [2.0.1] - 2026-06-09

### Fixed
- Attempted republish of 2.0.0 to correct the stale build artifacts; the
  packaged `dist/` was still incorrect. Superseded by 2.0.2 — do not use.

## [2.0.0] - 2026-06-08

A major release that turns the search UI from a single modal into a configurable
search platform: selectable layouts, semantic search, reader-facing facets,
curated suggestions, opt-in analytics, gated-content indexing, a grid template,
and a full test + playground harness. The version bump is major because the
default search experience changes visibly out of the box (see Changed).

### Added

#### Selectable UI layouts (`uiStyle`)
- **Three interchangeable layouts**, chosen with `uiStyle`, all sharing the same
  engine, query, theming, keyboard shortcuts, analytics, facets, and i18n:
  - `'modal'` *(default)* — the centered modal, now with rich result rows.
  - `'palette'` — a keyboard-first command palette (⌘K idiom) with grouped
    Posts / Tags / Authors buckets, a localStorage-backed "Recent searches"
    list, and a footer command bar.
  - `'discovery'` — a two-pane content explorer: results list, a live preview
    pane (feature image, full excerpt, date, tags, author, "Read post" link),
    and a facet rail. Shows a welcoming prompt before the first query.
- **One-script install, no wasted bytes.** The install is unchanged — a single
  `<script src=".../search.min.js">`. The core bundle carries only the engine
  and the default modal; `palette` and `discovery` lazily load their own chunk
  (`palette.min.js` / `discovery.min.js`, each with its own CSS) from the same
  directory on first use. Modal-only sites download nothing extra. A failed
  chunk load falls back to the built-in modal so search keeps working.
- **Uniform keyboard navigation** across all layouts: `/` and `Cmd/Ctrl+K` to
  open, `↑/↓` to move the selection (the discovery preview follows live),
  `Home`/`End`, `PageUp`/`PageDown`, `Enter` to open, `Esc` to close.

#### Semantic (hybrid) search
- **`semanticSearch` config option**: opt-in hybrid keyword + vector search
  against a collection embedding field, so a search for "growing tomatoes" can
  surface a post about "vegetable garden tips" without overlapping words.
- **`embeddingFieldName`** (default `'embedding'`) to name the vector field.
- **Keyword-favoring defaults** keep hybrid results relevant: `semanticAlpha`
  (default `0.2`) biases rank fusion toward keyword matches, and
  `semanticDistanceThreshold` (default `0.8`) drops distant vector-only matches.
  Both are configurable.
- Collection-schema support for an auto-embedding field on the indexing side
  (built-in models, Typesense v0.25.0+).

#### Reader-facing facets
- **`facets` config option**: opt-in filter controls for faceted fields (e.g.
  tags, authors). Facet counts update as filters are applied; the UI and queries
  are unchanged when `facets` is unset.

#### Search suggestions
- **Curated and dynamic suggestions**: `pinnedSearches` (publisher-curated,
  always shown first), `commonSearches` (static fallback terms), and
  `suggestionsUrl` (fetched on open for dynamic suggestions).

#### Searchable fields
- **`searchAuthors`** (opt-in, default off): make author names matchable by a
  keyword query, so searching a contributor's name finds their posts.

#### Result templates
- **`template: 'grid'`** within the modal layout: a responsive card grid
  (feature image, title, excerpt, up to three tags) alongside the default
  `'list'`. Posts without a feature image get a styled placeholder.

#### Opt-in analytics
- **`analytics` config option**: emit `search`, `click`, and `zero_result`
  events (with their queries) to your own endpoint via `navigator.sendBeacon`.
  Privacy-conscious and fully opt-in.

#### Members-only content indexing
- **`indexGatedContent`** (collection/webhook config): index members-only and
  paid posts as **redacted** documents — discoverable by title, excerpt, URL,
  tags, and feature image, with a `visibility` field — without ever reading or
  exposing the protected body. The search UI marks these with a "members only"
  badge, turning gated posts into discoverable lead magnets. Off by default.

#### Tooling
- **Vitest + jsdom test suite** for the search UI.
- **Dev playground** (`apps/playground`) for driving the widget and every
  feature offline against a mocked Typesense, with a real Docker Typesense
  option for semantic search.
- **CI workflow**, Dependabot, and a `typecheck` task across the monorepo.

### Changed
- **The default modal now renders rich result rows** instead of a plain
  title + excerpt list: a feature-image thumbnail (with a tinted first-letter
  fallback), highlighted title, one-line excerpt, and a metadata line
  (date · primary tag · author). This is the visible default change behind the
  major version bump — no config change is required, but existing sites will see
  the upgraded rows automatically.
- **Default `include_fields`** now also requests `feature_image`, `authors`,
  `tags`, `published_at`, and `visibility` so the richer rows and layouts have
  the data they need.

### Fixed
- **`/` keystroke swallowed in the palette/discovery search input**: across the
  shadow boundary a document-level listener sees the event target retargeted to
  the host element, so the input-focus guard couldn't tell focus was in the
  field and the `/` opener intercepted the keystroke. Open shortcuts are now
  gated on the open state, so the active surface owns the keyboard while open.
- **Hardened layout chunk loading**: concurrent loads share a single in-flight
  request instead of injecting duplicate `<script>` tags, and a layout that
  loads but fails to mount cleanly falls back to the modal.
- **Core-script URL detection** tightened to a path boundary so it no longer
  matches names like `presearch.min.js`.
- Gated-post bodies are never present in the index (redaction verified end to
  end), and `visibility` is preserved through `include_fields`.

## [1.12.0] - 2026-04-07

### Added
- **`transformToRelativeUrls` config option**: Convert search result URLs to relative paths
  - Useful when the site is accessed through a proxy domain or custom domain where the path is identical but the hostname differs
  - When enabled, absolute URLs like `https://example.com/my-post/` become `/my-post/`
  - Preserves query parameters and hash fragments
  - Gracefully falls back to the original URL if parsing fails

## [1.11.4] - 2026-02-03

### Fixed
- **Spacebar causes page navigation instead of typing space in search**: Added `stopPropagation()` to keydown events in the search modal
  - When the search input (inside Shadow DOM) is focused, `document.activeElement` returns the shadow host, not the input — causing browser extensions, theme JS, or built-in browser behaviour to misinterpret keypresses as page-level actions
  - Spacebar in particular could trigger scroll-to-next-page or extension-based pagination via `<link rel="next">`
  - All keydown events are now contained within the modal when the search input is focused
  - Escape key propagation is also stopped to prevent conflicts with other modal/overlay handlers

## [1.11.3] - 2026-01-04

### Fixed
- **CLI broken due to upstream dependency**: Pinned `@ts-ghost/content-api` to version 4.2.0
  - Upstream package v4.2.1 was published without the `dist/` folder, causing `MODULE_NOT_FOUND` errors

## [1.11.2] - 2025-12-29

### Fixed
- **Search modal too small on desktop**: Increased modal height from 60vh to 80vh and reduced top margin from 10vh to 5vh
  - Shows 6-7 search results on typical laptop screens instead of 2-3
  - Improves usability on MacBook Air and similar displays
  - Mobile behavior unchanged (still uses full viewport height)

## [1.11.1] - 2025-12-21

### Fixed
- **Custom query_by without weights**: When providing custom `query_by` in `typesenseSearchParams` without `query_by_weights`, default weights are now properly removed
  - Prevents mismatch between number of fields and number of weights
  - Users who customize `query_by` now have full control without inheriting incompatible default weights

## [1.11.0] - 2025-11-28

### Added
- **Custom Typesense Search Parameters**: The search UI now supports `typesenseSearchParams` in the configuration
  - Allows full control over Typesense search behavior (sort_by, filter_by, query_by, etc.)
  - Enables advanced ranking strategies like recency boosting with `_text_match(buckets: N)`
  - Supports `_eval()` for optional filtering to boost/demote specific content
  - Custom params merge with defaults, only overriding specified fields
  - Example: Prioritize recent English content by filtering older articles to lower positions

## [1.10.1] - 2025-11-21

### Changed
- **Reduced excerpt length**: Search result excerpts now limited to ~160 characters (200 with HTML tags)
  - Prefer Typesense `snippet` field over `value` field for more concise excerpts
  - Added automatic truncation as safety measure for long excerpts
  - Improved readability of search results

### Fixed
- Fixed overly long search result excerpts that made results difficult to scan

## [1.10.0] - 2025-11-21

### Added
- **Web Component Architecture**: Converted search UI to a custom element (`<magicpages-search>`) with Shadow DOM
  - Complete style encapsulation prevents Ghost theme CSS from interfering with search UI
  - Search UI styles no longer leak into the page
  - Consistent appearance across all Ghost themes
  - Improved performance through scoped styles
- **Internationalization (i18n) Support**: Full translation support for all UI elements
  - 13 translatable strings covering all UI text and ARIA labels
  - Support for partial overrides (users only translate what they need)
  - Automatic fallback to English for missing translations
  - Lightweight implementation with no external dependencies
  - Optional `locale` property for future features
  - Example translations provided for German, Spanish, and French in documentation

### Changed
- Search UI now renders inside Shadow DOM instead of direct DOM injection
- All styles now scoped to Shadow DOM instead of global page styles
- Improved element initialization and caching flow

### Removed
- Global style injection (now uses Shadow DOM)
- Console statements for cleaner production builds

### Fixed
- Theme styles can no longer interfere with search UI appearance
- Fixed theme update timing issue where `updateTheme()` was called before elements were cached

## [1.7.0] - 2025-01-23

### Changed
- **Major refactor**: Replaced iframe-based search UI with direct DOM injection approach
  - Search modal now renders directly in the page DOM using portal pattern
  - All CSS classes now use consistent `mp-search-` prefix to avoid conflicts
  - Simplified event handling and scroll management
  - Improved compatibility with complex Ghost themes

### Fixed
- Fixed scroll behavior on mobile WebKit browsers for themes using custom scrollbars (e.g., Principle theme with SimpleBar)
- Fixed tiny text issue when search UI is used on sites with custom root font-size
  - Replaced all `rem` units with `calc()` functions using a custom `--mp-rem` CSS variable
  - Search UI now maintains consistent sizing regardless of the host page's root font-size
  - This ensures proper text readability and UI scaling on all Ghost themes

## [1.6.2] - 2025-03-08

### Fixed
- Fixed URL encoding in hash-based searches to properly convert plus signs to spaces (e.g., `#/search/test+test` now correctly searches for "test test")

## [1.6.1] - 2025-03-08

### Fixed
- Hash-based search now properly replaces existing results instead of appending them when changing search terms

## [1.6.0] - 2025-03-07

### Added
- `plaintext` field support in default configuration
- Automatic generation of plaintext content from HTML
- Smart context-aware search result highlighting
- Contextual excerpts that show search terms in context
- Support for exact phrase matching in search
- Support for nested fields using dot notation (e.g., `tags.name`, `authors.name`)
- Enhanced CSS styling for highlighted search terms with `.mp-highlight` class

### Changed
- Optimized field weights for better search relevance:
  - Title: weight 5 (was 4)
  - Plaintext: weight 4 (new)
  - Excerpt: weight 3 (was 2)
  - HTML: weight 1 (unchanged)
- Increased search results per page from 10 to 20
- Expanded context for search term highlighting from 20 to 30 tokens
- Improved URL-based search with cleaner hash path format
- Enhanced HTML cleaning algorithm for plaintext generation:
  - Removes script and style tags with their content
  - Replaces HTML tags with spaces to preserve word boundaries
  - Normalizes whitespace
  - Creates cleaner searchable content

### Fixed
- Improved search relevance by using plaintext rather than raw HTML
- Enhanced excerpt generation for more meaningful search result previews
- Better handling of nested fields for tags and authors