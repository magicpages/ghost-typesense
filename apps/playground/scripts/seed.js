// Seed the local Docker Typesense (see docker-compose.yml) with the sample
// posts so the playground can search a real Typesense instance — including
// real semantic search, since the collection is created with an auto-embedding
// field.
//
//   docker compose up -d
//   npm run seed
//
// Re-running is safe: the collection is dropped and recreated.
import Typesense from 'typesense';
import { POSTS } from '../src/mock.js';

const HOST = process.env.TYPESENSE_HOST || 'localhost';
const PORT = Number(process.env.TYPESENSE_PORT || 8108);
const PROTOCOL = process.env.TYPESENSE_PROTOCOL || 'http';
const API_KEY = process.env.TYPESENSE_API_KEY || 'playground';
const COLLECTION = process.env.TYPESENSE_COLLECTION || 'ghost';

const client = new Typesense.Client({
  nodes: [{ host: HOST, port: PORT, protocol: PROTOCOL }],
  apiKey: API_KEY,
  // Creating the collection downloads the embedding model on first run, which
  // can take a while — give it a generous timeout with a few retries.
  connectionTimeoutSeconds: 120,
  numRetries: 3,
  retryIntervalSeconds: 3
});

const schema = {
  name: COLLECTION,
  enable_nested_fields: true,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'slug', type: 'string' },
    { name: 'url', type: 'string' },
    { name: 'excerpt', type: 'string' },
    { name: 'plaintext', type: 'string' },
    { name: 'feature_image', type: 'string', optional: true },
    { name: 'published_at', type: 'int64' },
    // Mirror the fields the real indexer (packages/core) produces and the
    // widget queries: a flat `tags` array plus the nested `tags.name` /
    // `tags.slug`. Omitting the nested fields makes Typesense reject the
    // widget's default query_by with "Could not find a field named tags.name".
    { name: 'tags', type: 'string[]', facet: true, optional: true },
    { name: 'tags.name', type: 'string[]', facet: true, optional: true },
    { name: 'tags.slug', type: 'string[]', facet: true, optional: true },
    { name: 'authors', type: 'string[]', facet: true, optional: true }
  ]
};

// Auto-embedding field — appended only when embeddings are enabled. On first
// use Typesense downloads the built-in model (~120MB) and caches it under
// /data/models; that download takes a moment and needs network + some free
// memory. If it can't initialize, the seed falls back to a collection without
// embeddings.
const embeddingField = {
  name: 'embedding',
  type: 'float[]',
  optional: true,
  embed: {
    from: ['title', 'excerpt', 'plaintext'],
    // Typesense's officially bundled built-in model (downloaded on first use).
    // Must be a model from Typesense's repo — a made-up name yields
    // "Model not found".
    model_config: { model_name: 'ts/all-MiniLM-L12-v2' }
  }
};

const WANT_EMBEDDING = process.env.SKIP_EMBEDDING !== '1';

// The embedding model can fail to initialize for a few reasons: the model
// couldn't be downloaded (no network in the container), it isn't a real model
// in Typesense's repo ("Model not found"), or there wasn't enough memory to
// load it. Any of these should degrade gracefully rather than abort the seed.
function isModelInitError(err) {
  const msg = String(err?.message || err).toLowerCase();
  return msg.includes('model') || msg.includes('memory') || msg.includes('embed');
}

async function createCollection() {
  if (WANT_EMBEDDING) {
    try {
      // The first run downloads the model (~120MB), which can take a minute.
      await client.collections().create({ ...schema, fields: [...schema.fields, embeddingField] });
      console.log(`Created "${COLLECTION}" collection (with embedding field — semantic search enabled).`);
      return true;
    } catch (err) {
      if (!isModelInitError(err)) throw err;
      console.warn(
        `⚠ Could not initialize the embedding model (${err?.message || err}).\n` +
          '  Falling back to a collection WITHOUT embeddings — semantic search will be\n' +
          '  unavailable, but everything else works. Common causes: the model download\n' +
          '  needs network access from the container and a minute to complete, or the\n' +
          '  container is low on memory. Fix the cause and re-run `npm run seed`, or set\n' +
          '  SKIP_EMBEDDING=1 to skip the attempt deliberately.'
      );
      // The failed attempt may have left a partial collection behind.
      await client.collections(COLLECTION).delete().catch(() => {});
    }
  }
  await client.collections().create(schema);
  console.log(`Created "${COLLECTION}" collection (no embedding field — lexical search only).`);
  return false;
}

async function main() {
  try {
    await client.collections(COLLECTION).delete();
    console.log(`Dropped existing "${COLLECTION}" collection.`);
  } catch {
    // Collection didn't exist yet — fine.
  }

  await createCollection();

  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const documents = POSTS.map(({ feature_image, tags = [], ...rest }) => ({
    ...rest,
    tags,
    // The widget's default query_by/facets use the nested fields, so provide
    // them the way packages/core does.
    'tags.name': tags,
    'tags.slug': tags.map(slugify),
    // Typesense rejects null for an optional string; omit instead.
    ...(feature_image ? { feature_image } : {})
  }));

  const results = await client.collections(COLLECTION).documents().import(documents, { action: 'upsert' });
  const failed = results.filter((r) => !r.success);
  console.log(`Imported ${documents.length - failed.length}/${documents.length} posts.`);
  if (failed.length) {
    console.error('Some documents failed:', failed);
    process.exitCode = 1;
  } else {
    console.log('Done. Point the playground at http://localhost:8108 (or just reload — it auto-detects).');
  }
}

main().catch((err) => {
  console.error('Seeding failed:', err?.message || err);
  console.error('Is Typesense running? Try `docker compose up -d` first.');
  process.exit(1);
});
