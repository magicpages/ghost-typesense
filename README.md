# @magicpages/ghost-typesense

Add powerful search to your Ghost blog with Typesense. This monorepo provides everything you need:

- 🔍 **Search UI**: Beautiful, accessible search interface
- 🤖 **CLI Tool**: Easy content syncing and management
- 🪝 **Webhook Handler**: Real-time content updates

## Quick Start

### 1. Set Up Typesense

You'll need:
- A Typesense instance ([cloud](https://cloud.typesense.org) or [self-hosted](https://typesense.org/docs/guide/install-typesense.html))
- Admin API key (for syncing content)
- Search-only API key (for the search UI)

### 2. Add Search to Your Theme

There are two ways to add search to your Ghost site:

#### Option 1: Replace Ghost's Default Search (Recommended)

Add to your `config.[environment].json`:
```json
"sodoSearch": {
    "url": "https://unpkg.com/@magicpages/ghost-typesense-search-ui/dist/search.min.js"
}
```

Or set the environment variable:
```bash
sodoSearch__url=https://unpkg.com/@magicpages/ghost-typesense-search-ui/dist/search.min.js
```

#### Option 2: Code Injection

If you're using a managed host like Ghost(Pro), add this to your site's code injection (Settings → Code injection → Site Header):

```html
<script src="https://unpkg.com/@magicpages/ghost-typesense-search-ui/dist/search.min.js"></script>
```

You can also self-host the `search.min.js` and add that URL instead of `https://unpkg.com/@magicpages/ghost-typesense-search-ui/dist/search.min.js`.

For either of these options, you'll then need to add a code injection into your site's header to configure the search UI:

```
<script>
  window.__MP_SEARCH_CONFIG__ = {
    typesenseNodes: [{
      host: 'your-typesense-host',
      port: '443',
      protocol: 'https'
    }],
    typesenseApiKey: 'your-search-only-api-key',
    collectionName: 'ghost',
    theme: 'system'  // Optional: 'light', 'dark', or 'system'
  };
</script>
```

### 3. Initial Content Sync

1. Install the CLI:
```bash
npm install -g @magicpages/ghost-typesense-cli
```

2. Create `ghost-typesense.config.json`:
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

3. Initialize and sync:
```bash
ghost-typesense init --config ghost-typesense.config.json
ghost-typesense sync --config ghost-typesense.config.json
```

### 4. Set Up Real-Time Updates (Optional)

To keep your search index in sync with your content:

1. Deploy the webhook handler to Netlify:

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/magicpages/ghost-typesense)

2. Set these environment variables in Netlify (Site settings → Environment variables):
```bash
GHOST_URL=https://your-ghost-blog.com
GHOST_CONTENT_API_KEY=your-content-api-key  # From Ghost Admin
TYPESENSE_HOST=your-typesense-host
TYPESENSE_API_KEY=your-admin-api-key  # Typesense Admin API key
COLLECTION_NAME=ghost  # Must match search config
WEBHOOK_SECRET=your-secret-key  # Generate a random string
```

3. Set up webhooks in Ghost Admin:
   - Go to Settings → Integrations
   - Create/select a Custom Integration
   - Give it a name (e.g. "Typesense Search")
   - Add these webhooks:

| Event | Target URL |
|---|---|
| Post published | https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key |
| Post updated | https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key |
| Post deleted | https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key |
| Post unpublished | https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key |

Now your search index will automatically update when you publish, update, or delete posts!

## Packages

| Package | Description |
|---------|-------------|
| [@magicpages/ghost-typesense-search-ui](packages/search-ui/README.md) | Search interface that matches your Ghost theme |
| [@magicpages/ghost-typesense-cli](packages/cli/README.md) | CLI tool for content syncing |
| [@magicpages/ghost-typesense-webhook](packages/webhook-handler/README.md) | Webhook handler for real-time updates |

## License

MIT © [MagicPages](https://www.magicpages.co)
