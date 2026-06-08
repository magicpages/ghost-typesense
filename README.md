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

## Semantic search

By default search is purely lexical. You can optionally enable **semantic (hybrid) search**, where Typesense ranks results by a fusion of keyword relevance and vector similarity — so a query matches on meaning, not just shared words. This needs no extra infrastructure: Typesense generates the embeddings itself.

### 1. Add an embedding field to the collection schema

Add a `float[]` field with an `embed` block to your `collection.fields` in `ghost-typesense.config.json`. The `from` fields are the content Typesense embeds; `model_config.model_name` selects the model.

```json
{
  "collection": {
    "name": "ghost",
    "fields": [
      { "name": "embedding", "type": "float[]", "optional": true,
        "embed": {
          "from": ["title", "plaintext", "excerpt"],
          "model_config": { "model_name": "ts/all-MiniLM-L12-v2" }
        }
      }
    ]
  }
}
```

> When you provide a custom `fields` array, the required content fields (`id`, `title`, `url`, `slug`, `html`, `plaintext`, `excerpt`, `published_at`, `updated_at`) are still enforced and merged in automatically, so you only need to add the `embedding` field itself.

**Models.** You can use a built-in Typesense model (e.g. `ts/all-MiniLM-L12-v2`) which runs locally on the Typesense server at no per-document cost, or an external provider by passing its details in `model_config` (for example an OpenAI model with `model_name`, `api_key`). Built-in models keep everything self-contained; external models can offer higher quality at a per-document API cost.

Then `init` and `sync` as usual — Typesense embeds each document at index time:

```bash
ghost-typesense init --config ghost-typesense.config.json
ghost-typesense sync --config ghost-typesense.config.json
```

### 2. Enable hybrid querying in the search UI

Set `semanticSearch: true` in your search config — see the [search-ui semantic search docs](packages/search-ui/README.md#semantic-search).

### Requirements and tradeoffs

- **Typesense version.** Auto-embedding with built-in models requires Typesense **v0.25.0 or newer** (the build that ships the ML models). External-provider embedding is available from the same versions.
- **Memory.** Vector fields meaningfully increase a collection's RAM footprint. Benchmark on a representative slice of your content before enabling it for a large blog.
- **Index time.** Generating embeddings adds latency to syncing. Built-in models add CPU time on the Typesense server; external providers add per-document API calls (and their cost). Large initial syncs take noticeably longer than lexical-only indexing.

## Members-only content

**By default, only public published posts are indexed.** Members-only and paid posts are skipped entirely, so a blog that publishes mostly gated content will have a near-empty search index.

You can opt in to indexing gated posts as **redacted** documents — discoverable in search, but without exposing the protected body. Set `indexGatedContent` on the collection config:

```json
{
  "collection": {
    "name": "ghost",
    "indexGatedContent": true
  }
}
```

With it enabled:

- Non-public posts (`members`, `paid`, tier-restricted) are indexed with their **title, excerpt, URL, tags, and feature image**, plus a `visibility` field.
- The searchable text is limited to the public excerpt (falling back to the title). The post's body is **never read or indexed** — this package uses Ghost's Content API, which only ever returns the public preview for gated posts, and the indexer ignores the body regardless. There is no protected text in the index to leak.
- The search UI marks these results with a "members only" badge (see the [search-ui README](packages/search-ui/README.md#members-only-results)), turning gated posts into discoverable lead magnets.

For real-time updates, set `INDEX_GATED_CONTENT=true` on the webhook handler to mirror this behaviour.

## Packages

| Package | Description |
|---------|-------------|
| [@magicpages/ghost-typesense-search-ui](packages/search-ui/README.md) | Search interface that matches your Ghost theme |
| [@magicpages/ghost-typesense-cli](packages/cli/README.md) | CLI tool for content syncing |
| [@magicpages/ghost-typesense-webhook](packages/webhook-handler/README.md) | Webhook handler for real-time updates |

## License

MIT © [MagicPages](https://www.magicpages.co)
