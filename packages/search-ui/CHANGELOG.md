# @magicpages/ghost-typesense-search-ui

## 1.1.3

### Patch Changes

- Fixed Ghost search integration:
  - Fixed race condition with Ghost's search initialization
  - Fixed timing of search takeover
  - Fixed error when body is not ready for DOM manipulation
  - Improved handling of multiple initialization attempts

## 1.1.2

### Patch Changes

- Improved Ghost search integration:
  - Better handling of Ghost's native search takeover
  - Support for cmd/ctrl + k keyboard shortcut
  - Support for Ghost's search trigger buttons
  - Proper handling of hash-based search trigger
  - Fixed search modal initialization

## 1.1.1

### Minor Changes

- Initial release of the Ghost Typesense Search UI:
  - Vanilla JavaScript search interface
  - Responsive and accessible design
  - Dark mode support with system preference detection
  - Keyboard navigation
    - Forward slash (/) to open search
    - Arrow keys for navigation
    - Escape to close
  - Common searches support
  - Real-time search with Typesense
  - Ghost theme integration
  - Custom styling support
  - Seamless integration with Ghost's default search configuration
  - Robust conflict resolution with Ghost's native search:
    - Automatic detection and override of Ghost's search
    - Forward slash (/) keyboard shortcut
    - Preserves URL-based search triggers
    - Works with both self-hosted and managed Ghost installations
  - Support for both config-based and direct script installation 