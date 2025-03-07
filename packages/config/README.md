# @magicpages/ghost-typesense-config

Configuration types and utilities for Ghost-Typesense integration.

## Installation

```bash
npm install @magicpages/ghost-typesense-config
```

## Usage

```typescript
import { createDefaultConfig } from '@magicpages/ghost-typesense-config';

// Create a config with default schema
const config = createDefaultConfig(
  'https://your-ghost-blog.com',
  'your-content-api-key',
  'your-typesense-host',
  'your-typesense-api-key',
  'ghost' // collection name
);

// Or create a custom config
import type { Config } from '@magicpages/ghost-typesense-config';

const config: Config = {
  ghost: {
    url: 'https://your-ghost-blog.com',
    key: 'your-content-api-key',
    version: 'v5.0'
  },
  typesense: {
    nodes: [{
      host: 'your-typesense-host',
      port: 443,
      protocol: 'https'
    }],
    apiKey: 'your-typesense-api-key'
  },
  collection: {
    name: 'ghost',
    // Optional: customize fields
    fields: [
      { name: 'title', type: 'string', index: true, sort: true },
      { name: 'plaintext', type: 'string', index: true },
      { name: 'custom_field', type: 'string', optional: true },
      // Nested fields are supported with dot notation
      { name: 'tags.name', type: 'string', facet: true, optional: true },
      { name: 'authors.name', type: 'string', facet: true, optional: true }
    ]
  }
};
```

## Default Fields

The package includes default fields optimized for Ghost content, including:

```typescript
// Required fields
{ name: 'id', type: 'string' }
{ name: 'title', type: 'string' }
{ name: 'url', type: 'string' }
{ name: 'slug', type: 'string' }
{ name: 'html', type: 'string' }
{ name: 'plaintext', type: 'string' }
{ name: 'excerpt', type: 'string' }
{ name: 'published_at', type: 'int64' }
{ name: 'updated_at', type: 'int64' }

// Optional fields
{ name: 'feature_image', type: 'string', optional: true }
{ name: 'tags', type: 'string[]', optional: true }
{ name: 'authors', type: 'string[]', optional: true }
```

## Types

```typescript
interface Config {
  ghost: {
    url: string;
    key: string;
    version: string;
  };
  typesense: {
    nodes: {
      host: string;
      port: number;
      protocol: 'http' | 'https';
    }[];
    apiKey: string;
  };
  collection: {
    name: string;
    fields?: CollectionField[];
  };
}

interface CollectionField {
  name: string;         // Can use dot notation for nested fields (e.g., 'tags.name')
  type: string;         // 'string', 'int32', 'int64', 'float', 'bool', or string arrays (e.g., 'string[]')
  index?: boolean;      // Whether to index this field for searching
  sort?: boolean;       // Whether this field can be used for sorting
  facet?: boolean;      // Whether this field can be used for faceting
  optional?: boolean;   // Whether this field is optional in documents
}
```

## Nested Fields

The package supports nested fields using dot notation in the field name. This is particularly useful for accessing properties of complex objects like tags and authors:

```typescript
// Example with nested fields
const config = {
  collection: {
    name: 'ghost',
    fields: [
      // Access nested properties
      { name: 'tags.name', type: 'string', facet: true, optional: true },
      { name: 'authors.bio', type: 'string', index: true, optional: true },
      { name: 'authors.name', type: 'string', facet: true, optional: true }
    ]
  }
};
```

When Typesense is configured with `enable_nested_fields: true`, you can efficiently search and facet on these nested properties.

## License

MIT © [MagicPages](https://www.magicpages.co) 