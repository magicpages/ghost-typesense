# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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