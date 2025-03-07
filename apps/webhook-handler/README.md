# @magicpages/ghost-typesense-webhook

A Netlify Function that keeps your Typesense search index in sync with your Ghost content.

## Quick Setup

1. Deploy to Netlify:

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/magicpages/ghost-typesense)

2. Set environment variables in Netlify:

```bash
GHOST_URL=https://your-ghost-blog.com
GHOST_CONTENT_API_KEY=your-content-api-key
TYPESENSE_HOST=your-typesense-host
TYPESENSE_API_KEY=your-admin-api-key
COLLECTION_NAME=ghost
WEBHOOK_SECRET=your-secret-key  # Create a secure random string
```

3. Add webhooks in Ghost Admin:
   - Go to Settings → Integrations
   - Create/select a Custom Integration
   - Add the following four webhooks:
     | Name | Event | Target URL |
     |------|-------|------------|
     | Post published | Post published | `https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key` |
     | Post updated | Post updated | `https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key` |
     | Post deleted | Post deleted | `https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key` |
     | Post unpublished | Post unpublished | `https://your-site.netlify.app/.netlify/functions/handler?secret=your-secret-key` |

## Manual Setup

1. Install the package:
```bash
npm install @magicpages/ghost-typesense-webhook
```

2. Create the function:
```typescript
// netlify/functions/handler.ts
import { handler } from '@magicpages/ghost-typesense-webhook';
export { handler };
```

3. Configure `netlify.toml`:
```toml
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GHOST_URL` | Your Ghost blog URL |
| `GHOST_CONTENT_API_KEY` | Content API key from Ghost |
| `TYPESENSE_HOST` | Typesense host |
| `TYPESENSE_API_KEY` | Typesense admin API key |
| `COLLECTION_NAME` | Collection name (default: 'ghost') |
| `WEBHOOK_SECRET` | Secret key for webhook security |

## How It Works

The webhook handler:
1. Validates the secret in the URL query parameter
2. Processes post status changes (publish/unpublish/update)
3. Updates the Typesense index accordingly
4. Automatically generates plaintext content from HTML for better search quality
5. Ensures content is properly formatted for optimal search results

### Content Processing

When a post is published or updated, the handler:

1. **Fetches complete data**: Gets the full post details from Ghost including tags and authors
2. **Transforms content**: 
   - Converts timestamps to numeric formats for sorting
   - Extracts tag and author information 
   - Generates clean plaintext content from HTML by:
     - Removing script and style tags with their content
     - Replacing HTML tags with spaces to preserve word boundaries
     - Normalizing whitespace
     - Creating a clean, searchable text version
3. **Updates index**: Adds or updates the document in Typesense with the transformed content
4. **Optimizes for search**: Ensures the content is indexed in a way that enables:
   - Context-aware search result highlighting
   - Relevant excerpts showing search terms in context
   - Accurate full-text search across all content

This automatic transformation ensures that your search index stays in sync with your Ghost content while providing the best possible search experience for your users.

## License

MIT © [MagicPages](https://www.magicpages.co)