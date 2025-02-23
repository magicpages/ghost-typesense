# @magicpages/ghost-typesense-cli

Command-line tool for managing Ghost content in Typesense.

## Installation

```bash
npm install -g @magicpages/ghost-typesense-cli
```

## Usage

1. Create `ghost-typesense.config.json`:
```json
{
  "ghost": {
    "url": "https://your-ghost-blog.com",
    "key": "your-content-api-key",
    "version": "v5.0"
  },
  "typesense": {
    "nodes": [{
      "host": "your-typesense-host",
      "port": 443,
      "protocol": "https"
    }],
    "apiKey": "your-admin-api-key"
  },
  "collection": {
    "name": "ghost"
  }
}
```

2. Available commands:

```bash
# Initialize collection
ghost-typesense init --config ghost-typesense.config.json

# Sync all posts
ghost-typesense sync --config ghost-typesense.config.json

# Clear collection
ghost-typesense clear --config ghost-typesense.config.json
```

## Configuration

| Option | Description |
|--------|-------------|
| `ghost.url` | Your Ghost blog URL |
| `ghost.key` | Content API key |
| `ghost.version` | Ghost API version |
| `typesense.nodes` | Array of Typesense nodes |
| `typesense.apiKey` | Admin API key |
| `collection.name` | Collection name |

## License

MIT © [MagicPages](https://www.magicpages.co) 