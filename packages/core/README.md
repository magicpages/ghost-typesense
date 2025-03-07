# @magicpages/ghost-typesense-core

Core functionality for Ghost-Typesense integration. This package provides the essential services for indexing Ghost CMS content in Typesense.

## Features

- 🔄 Seamless synchronization between Ghost CMS and Typesense
- 🔍 Automatic content transformation and indexing
- ⚙️ Flexible configuration for custom fields and schema
- 🚀 Efficient pagination handling for large Ghost sites
- 🧩 TypeScript interfaces for type safety
- 📝 Automatic plaintext generation from HTML content to make sure the most relevant content is indexed

## Installation

```bash
npm install @magicpages/ghost-typesense-core
```

## Usage

The core package provides the `GhostTypesenseManager` class which handles all interactions between Ghost and Typesense.

```typescript
import { GhostTypesenseManager } from '@magicpages/ghost-typesense-core';
import { config } from './config';

async function main() {
  // Initialize the manager with your configuration
  const manager = new GhostTypesenseManager(config);
  
  // Create or recreate the Typesense collection with proper schema
  await manager.initializeCollection();
  
  // Index all posts from Ghost to Typesense
  await manager.indexAllPosts();
  
  // You can also index or delete individual posts
  await manager.indexPost('post-id');
  await manager.deletePost('post-id');
}

main().catch(console.error);
```

## Configuration

This package requires a configuration object that follows the schema defined in `@magicpages/ghost-typesense-config`. The minimal configuration includes:

```typescript
const config = {
  ghost: {
    url: 'https://your-ghost-blog.com',
    key: 'your-content-api-key'
  },
  typesense: {
    nodes: [{
      host: 'your-typesense-host',
      port: 443,
      protocol: 'https'
    }],
    apiKey: 'your-admin-api-key',
    connectionTimeoutSeconds: 10,
    retryIntervalSeconds: 0.1
  },
  collection: {
    name: 'ghost',
    fields: [
      { name: 'id', type: 'string', index: true },
      { name: 'title', type: 'string', index: true, sort: true },
      { name: 'slug', type: 'string', index: true },
      { name: 'html', type: 'string', index: true },
      { name: 'plaintext', type: 'string', index: true },
      { name: 'excerpt', type: 'string', index: true },
      { name: 'feature_image', type: 'string', index: false, optional: true },
      { name: 'published_at', type: 'int64', sort: true },
      { name: 'updated_at', type: 'int64', sort: true },
      { name: 'tags', type: 'string[]', facet: true, optional: true },
      { name: 'authors', type: 'string[]', facet: true, optional: true }
    ]
  }
};
```

## API Reference

### `GhostTypesenseManager`

The main class for managing Ghost content in Typesense.

#### Constructor

```typescript
constructor(config: Config)
```

Creates a new instance with the provided configuration.

#### Methods

- **`async initializeCollection(): Promise<void>`**  
  Creates or recreates the Typesense collection with the schema defined in the configuration.

- **`async indexAllPosts(): Promise<void>`**  
  Fetches all posts from Ghost and indexes them in Typesense. Handles pagination automatically.

- **`async indexPost(postId: string): Promise<void>`**  
  Fetches a specific post from Ghost and indexes it in Typesense.

- **`async deletePost(postId: string): Promise<void>`**  
  Deletes a post from the Typesense collection.

- **`async clearCollection(): Promise<void>`**  
  Removes all documents from the collection and recreates it with the same schema.

## Content Transformation

The package automatically handles content transformation from Ghost to Typesense, including:

- Converting timestamps to numeric formats for sorting
- Extracting tags and authors as arrays
- Generating plaintext content from HTML for improved search relevance
- Ensuring all required fields are properly formatted

### Plaintext Generation

The plaintext generation process is particularly important for search quality:

  - Removes script tags and their content to eliminate JavaScript
  - Removes style tags and their content to eliminate CSS
  - Replaces all HTML tags with spaces to preserve word boundaries
  - Replaces HTML entities with spaces
  - Normalizes whitespace by collapsing multiple spaces to single spaces
  - Trims leading and trailing whitespace

Manual search tests have shown that this approach is more accurate than using the HTML content alone or Ghost's default plaintext field.

## Related Packages

- [@magicpages/ghost-typesense-config](https://github.com/magicpages/ghost-typesense/tree/main/packages/config) - Configuration schema and utilities
- [@magicpages/ghost-typesense-cli](https://github.com/magicpages/ghost-typesense/tree/main/apps/cli) - Command-line tool for managing Ghost content in Typesense
- [@magicpages/ghost-typesense-search-ui](https://github.com/magicpages/ghost-typesense/tree/main/packages/search-ui) - Search UI component for Ghost themes

## License

MIT