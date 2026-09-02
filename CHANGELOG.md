# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.1] - 2026-09-02

### Fixed
- **Opening the search from a theme's popup navigation left the panel visible
  but unusable.** Readers could see the search but never type into it: the
  input did not keep the caret. Loading `#/search` directly or using the
  keyboard shortcut worked, which is what made it look like a search bug rather
  than a focus one. Themes commonly focus-trap their popup navigation while it
  is open, and a nav link pointing at Ghost's `#/search` magic URL changes the
  hash without unloading the page — so none of the trap's release paths (close
  button, Escape, page load) ever fire and the trap stays armed. Every surface
  renders into the widget's shadow root in the same document, so the trap saw
  the `focusin` and pulled the caret straight back into the navigation. Each
  surface is now promoted into the top layer with `<dialog>.showModal()`: the
  browser makes everything outside the top layer inert, so the trap's own
  `focus()` call becomes a no-op and the caret stays in the search field. The
  theme's accessibility code keeps working exactly as its author intended —
  nothing patches or disables it. Visibility remains owned by the
  `mp-search-hidden` class and the new calls no-op where `<dialog>` is
  unavailable (Safari before 15.4), so those browsers behave as they did
  before, and native `Esc` is routed back through the widget's own close path
  so the scroll lock and the URL hash stay in step. One visible consequence:
  top-layer stacking belongs to the browser, so the overlay now sits above
  Ghost's subscribe button on desktop, where `z-index: 3999997` had placed it
  below.

### Changed
- **Runtime dependency upgrades.** `@ts-ghost/content-api` 4.2.0 → 5.0.0 (core),
  `@netlify/functions` 2.8.2 → 6.0.0 (webhook handler), and `ora` 8 → 9 (CLI).
  Each is a major upgrade of a published package's dependency; none required a
  source change, and lint, typecheck, the full suite and the builds pass
  unchanged.
- **The dev toolchain moved to Node 22.** `.nvmrc` pinned Node 20, which jsdom
  30 does not support (`^22.22.2 || ^24.15.0 || >=26`) — its bundled undici
  failed on load and took the search-ui suite down with it. Contributors and CI
  now run Node 22. Nothing in the published packages changed, so this affects
  only how the repository is built and tested.
- **Test tooling refreshed**: vitest 1 → 4 (class mocks now have to be
  constructible, so the mocked `TSGhostContentAPI`, Typesense `Client` and
  `GhostTypesenseManager` return their instance from a `function`
  implementation), jsdom 24 → 30, cssnano 6 → 9, rollup-plugin-visualizer 5 →
  7, inquirer 12 → 14, globals 16 → 17, plus eslint, rollup, `@types/node` and
  `@typescript-eslint/*` minors.

## [2.3.0] - 2026-08-21

### Added
- **Search results now say *which* gate a post is behind.** Every non-public
  result carried the same "Members only" badge, which is wrong on more than half
  of them: Ghost gates a post either to anyone who signed up or to paying
  readers only, and a free subscriber is a member as far as they are concerned.
  They clicked, and they hit a paywall. Results are now badged **Members** for
  `visibility: members` and **Paid members** for `paid` and `tiers` — the latter
  because Ghost only ever tier-restricts to paid tiers, so tier-gated content is
  never reachable on a free account. The free badge stays quiet and the paid one
  carries the site's accent colour in all three layouts, so the two read as a
  pair rather than as one badge with two spellings. Both are translatable:
  `paidLabel` / `ariaPaidLabel` join the existing `membersLabel` /
  `ariaMembersLabel`, and the discovery preview's notice gains a
  `discoveryPaidNotice` variant, so a publisher who calls paying readers
  something of their own can say so. No reindex is needed — the exact
  `visibility` was already on the indexed documents; only the widget was
  throwing it away.
- **`memberAwareBadges` — badge only what the reader cannot open.** Naming the
  gate helps, but a free subscriber still has to read the badge to work out that
  a post is not for them. With this opt-in flag the widget asks Ghost who is
  reading (one same-origin request to `/members/api/member` when it initialises)
  and drops the badge from anything that reader can already open: `members`
  posts for any signed-in reader, `paid` posts for a paying one. A `tiers` post
  keeps its badge even then, because it names specific paid tiers and the index
  does not record which — an unverifiable promise of access is worse than a
  redundant badge. Off by default, since the widget is also embedded on sites
  with no Ghost member endpoint to ask. Every failure — endpoint missing, reader
  offline, response not yet back — leaves the badges exactly as they are without
  the flag, so nothing is ever wrongly unbadged. The lookup is fired when the
  widget initialises and never awaited, so it costs no search latency; a fast
  reader on a slow connection who gets results before it lands sees them badged
  for an unknown reader, and the query is re-run once when the answer arrives.
  The path is configurable via `memberEndpoint`: the default assumes Ghost sits
  at the origin root, and a subdirectory install or a path-rewriting proxy needs
  its own prefix.
- **`data-gated` in every layout.** The `mp-search-result-gated` class and
  `data-gated="<visibility>"` attribute are documented as the way to style a
  gated result or route its click into a membership flow, but only the modal
  layout actually emitted them; a site on the palette or discovery layout had
  nothing to hook. Both now appear on the palette row, the discovery card, and
  the discovery "Read post" link, so
  `[data-gated="paid"], [data-gated="tiers"]` selects the paid gate whichever
  layout is in use. They are independent of the badge: when
  `memberAwareBadges` suppresses a badge, the gate stays on the element.

### Changed
- **`membersLabel` now defaults to "Members", not "Members only".** It is no
  longer the label for every gate, so a name that reads as "and nothing more"
  was misleading next to the new paid badge. An existing `membersLabel` override
  keeps working and now applies only to `visibility: members`; sites that had
  overridden it to cover all gated posts will want to set `paidLabel` too.

### Fixed
- The modal's gated badge interpolated its ARIA label into an attribute without
  escaping it, unlike the same badge in the palette and discovery layouts. All
  three now go through the escaper, so a translation containing markup or a
  quote renders as text.
- `example.config.json` supplied an explicit `fields` array that omitted
  `visibility`, `tags.name`, and `tags.slug`. Only *required* fields are
  backfilled into a config that brings its own field list, so anyone starting
  from the example got a collection where those three were undeclared — and
  `visibility`, which the badges read, was not facetable. The example now lists
  them, and `@magicpages/ghost-typesense-config`'s README documents the
  backfill rule instead of a stale field list.

## [2.2.0] - 2026-08-19

### Added
- **"Did you mean …?" for a query that matched nothing.** The widget searches
  strictly (`num_typos: 0`), which is what keeps results predictable — and left
  a reader who mistyped a word with "No results found" and nowhere to go, while
  `enableDidYouMean` sat in the config doing nothing at all. A zero-hit query is
  now re-run once with typo tolerance raised, and if that finds posts the reader
  is offered the corrected term: a button under the empty message in the modal
  and discovery layouts, and a navigable row in the palette, so `↵` accepts it.
  The suggestion comes from the `matched_tokens` the retry returned, so it is
  always a word the site's own posts contain rather than a guess from a
  dictionary that has never seen the archive, and words are only replaced within
  the typo budget Typesense itself would allow for their length. The retry is
  skipped for sites already searching with a non-zero `num_typos`, so strict
  sites pay one extra request only on a genuine miss and lenient ones pay none.
  Translatable via the new `didYouMeanLabel` key; turn it off with
  `enableDidYouMean: false`.
- **The facet rail admits when a list was cut short.** Typesense returns facet
  values by count descending, so the display cap always dropped the least common
  ones — a tag on two posts could never appear, even when those were the top two
  results, which reads as "this topic doesn't exist" rather than "this list is
  abridged". Each search now asks for one value more than it will show; that
  extra value is never rendered, it is simply what distinguishes a cut list from
  a complete one. Where it appears, the field gets a **Show more** control that
  widens the list and re-runs the query, and **Show less** to collapse it, so a
  wider rail costs one request and only when a reader asks. Both labels are
  translatable (`facetShowMoreLabel`, `facetShowLessLabel`).

### Fixed
- **A facet's `limit` now does what it documents.** It was described as the
  number of values shown for a field, but only fed the global
  `max_facet_values`; the modal and the discovery rail then rendered every value
  the response carried, so a field with `limit: 5` displayed as many values as
  the largest facet allowed.
- **A selected facet value can always be switched off again.** It stayed on
  screen only while the response happened to carry it, so a value ranked below
  what was requested lost its chip — and a filter that narrowed the results to
  nothing lost the whole group, taking the **Clear filters** control with it and
  leaving closing the modal as the only escape.
- **`searchAuthors` works alongside a custom `query_by`.** It appended `authors`
  while building the default parameters, and a host-supplied
  `typesenseSearchParams.query_by` replaced those defaults wholesale — so the
  documented way to make author names matchable silently did nothing for exactly
  the sites that had tuned their query. The field is now added to the merged
  parameters, with `query_by_weights` extended alongside it when weights are
  configured, since Typesense rejects a search whose two lists differ in length.
- **`typo_tolerance` is no longer treated as a Typesense parameter.** It is not
  one, and never was: the widget sent it, this project documented it as the
  switch for typo correction, and Typesense ignored it — so a site that set
  `typo_tolerance: true` and stopped there kept matching strictly, with nothing
  anywhere to say so. It is dropped from the requests, and a host-supplied value
  is now read as the alias its author meant (`true` becomes `num_typos: 2`
  unless `num_typos` is set explicitly) with a deprecation notice in the browser
  console. `num_typos` is the control; the README explains why the widget's `0`
  is deliberately stricter than Typesense's own default of `2`.
- **The palette and discovery layouts open from a URL that already carries the
  search.** Loading a page at `#/search`, `?s=…` or `?q=…` left the panel hidden
  forever, because initialization waited on the state handling that was waiting
  on initialization. Following a shared search link looked exactly like search
  being broken. Opening now waits only for the surface to be mounted, a query in
  the hash path reaches those layouts (it was only ever written to the modal's
  input), and a `?s=` link no longer runs its query twice.
- **A slow search can no longer repaint over a newer one.** Results, empty and
  failure states all rendered unconditionally when their request returned, so an
  earlier query that finished late could wipe the results the reader was looking
  at — and take over click attribution with it. Failures are still logged when
  superseded; they simply no longer reach the screen.

### Changed
- The search widget's ESLint setup moved to flat config, and the toolchain moved
  with it (ESLint 10, typescript-eslint 8). Two rethrows in the Ghost fetch path
  now attach the original error as `cause`, which the new rules caught.

## [2.1.0] - 2026-08-04

### Fixed
- **Failed search requests were shown to readers as "No results found".** Every
  error — a timed-out request, an offline reader, an unreachable search host —
  rendered the same panel as a query that genuinely matched nothing, so a reader
  on a slow or high-latency connection was told the archive had nothing on their
  topic while the search server sat idle. The error was swallowed with no trace
  anywhere, which is why one reported case took four rounds of support email to
  pin on the connection rather than the index. Failures now render their own
  state — "Search is temporarily unavailable" / "Check your connection and try
  again." — in all three layouts: a `role="alert"` block in the modal, an alert
  surface in the palette (with the stale "Searching…" status cleared), and a
  full-surface prompt in discovery (where the facet rail and preview collapse,
  as they do in the initial state). Both strings are translatable through the
  new `errorMessage` and `errorHint` i18n keys. The underlying error is now
  logged as `MagicPagesSearch: search request failed`, so the next failing
  connection is diagnosable from the reader's own browser console. Search-ui
  bundle change — publishing refreshes the CDN; redeploy the rebuilt bundle to
  sites.

### Added
- **The search client's connection budget is configurable.**
  `connectionTimeoutSeconds` in `window.__MP_SEARCH_CONFIG__` replaces a
  hardcoded 2 s timeout, and now defaults to 5 s. The first search of a session
  pays DNS + TCP + TLS to the search host before the query itself goes out, and
  2 s could not cover that handshake on a lossy link or a VPN with a distant
  exit node — the request was aborted client-side while the backend was idle.
  `numRetries` and `retryIntervalSeconds` are exposed the same way, falling back
  to typesense-js's own defaults when unset. All three are validated, so a typo
  in a site's config can't disable retries or set a zero-second timeout.

## [2.0.8] - 2026-06-27

### Added
- **Exclude individual posts from search by tag.** Posts carrying a configured
  tag — `#no-search-index` by default — are kept out of the index entirely, for
  landing pages, legal/policy pages, or internal notes. Configure with
  `collection.excludeTags` (an explicit `[]` disables it); values are matched
  case-insensitively against a post's Ghost tag names and slugs, so the internal
  tag form (`#no-search-index` / `hash-no-search-index`) is caught however the
  tag was created. Through the webhook handler, an edit that adds the tag
  de-indexes the post. Sits alongside the existing internal-tag filtering and
  gated-content redaction as one canonical, index-time content policy.

## [2.0.7] - 2026-06-24

### Fixed
- **Search highlighting missed matches that occur only in the post body.** The
  result preview picked its snippet by trying the `excerpt` field first and
  falling back to the raw excerpt text — which is virtually always present — so
  the `||` chain short-circuited there and never reached the `plaintext` (body)
  highlight. When a query term matched only in the body (e.g. a name that appears
  in the article but not the excerpt), the post still ranked for it, but the
  matched term wasn't highlighted in the preview. The snippet is now taken from
  whichever field actually matched (excerpt, then body `plaintext`, gated on the
  highlight's `matched_tokens`), falling back to the raw excerpt only when neither
  matched. Affects all layouts (modal, palette, discovery). Search-ui bundle
  change — publishing refreshes the CDN; redeploy the rebuilt bundle to sites.

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