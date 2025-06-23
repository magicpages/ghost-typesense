# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2025-06-23

### Fixed
- Fixed scroll behaviour on mobile webkit browsers for certain Ghost themes

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