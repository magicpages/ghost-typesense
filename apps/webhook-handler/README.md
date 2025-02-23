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


## License

MIT © [MagicPages](https://www.magicpages.co)