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
    name: 'ghost'
  }
};
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
  };
}
```

## License

MIT © [MagicPages](https://www.magicpages.co) 