# Search UI playground

A standalone dev harness for [`@magicpages/ghost-typesense-search-ui`](../../packages/search-ui). It loads the **built** widget the way Ghost does — a plain load of the shipped `search.min.js` — and drives it against a mocked Typesense backend, so you can iterate on the search UI and exercise every feature without a Ghost install or a running Typesense server.

## Running it

First build the widget the playground loads (re-run after any search-ui change):

```bash
npx turbo run build --filter=@magicpages/ghost-typesense-search-ui
```

Then start the playground. The default command brings up a real Typesense in Docker, seeds it, and starts the dev server — all in one step:

```bash
npm run dev --workspace @magicpages/ghost-typesense-playground
```

This requires Docker. It runs `docker compose up -d`, waits for Typesense to be healthy, seeds the sample posts (the first run downloads the embedding model, which can take a minute), then opens the playground. Choose options in the **Configuration** panel and press **Apply & open search**.

No Docker? Use the zero-setup offline mock instead:

```bash
npm run dev:mock --workspace @magicpages/ghost-typesense-playground
```

Stop and reset the Typesense container with:

```bash
npm run typesense:down --workspace @magicpages/ghost-typesense-playground
```

## What you can toggle

- **Template** — `list` (default) or `grid` (card layout with feature images).
- **Theme** — `system` / `light` / `dark`.
- **Facets** — reader-facing tag and author filters.
- **Suggestions** — pinned + common search terms shown before typing.
- **Semantic search** — appends the embedding field to the query (the mock returns the same results, but you can confirm the request shape).
- **Analytics** — emitted `search` / `zero_result` / `click` events are captured and shown in the on-page **Events** log, along with the queries they carry.

## Backends

The playground picks a backend automatically, in this order:

1. **An explicit endpoint** you type into the *Real Typesense endpoint* field.
2. **The local Docker Typesense** at `localhost:8108`, if it's running — what `npm run dev` starts for you.
3. **The built-in offline mock** otherwise — what `npm run dev:mock` uses.

### Real Typesense via Docker (the default `npm run dev`)

`npm run dev` orchestrates everything via [`scripts/dev.js`](./scripts/dev.js): `docker compose up -d` ([`docker-compose.yml`](./docker-compose.yml)) → wait for health → seed → Vite. The collection is created with an **embedding field**, so the semantic-search toggle runs a real hybrid query. The first run downloads the built-in model, which can take a minute.

You can also run the pieces by hand: `docker compose up -d`, then `npm run seed`. Re-seeding is idempotent (it drops and recreates the collection).

**Memory note.** Loading the embedding model needs a few hundred MB of free memory in the Typesense container. If it can't load, the seed prints a warning and **falls back to a lexical-only collection** — the playground stays fully usable, but the Semantic toggle is disabled and the Events log explains why. Give Docker more memory (Docker Desktop → Resources) and re-run `npm run seed` to enable it; set `SKIP_EMBEDDING=1` to skip the attempt deliberately.

### Testing semantic search

With embeddings enabled, semantic search matches on *meaning*, not shared words. Check **Semantic search**, Apply, and try a query whose words don't appear literally — e.g. `growing vegetables` or `cultivating plants` should still surface the gardening posts. Confirm the vector half ran via `vector_distance` on the hits:

```bash
curl -s 'http://localhost:8108/collections/ghost/documents/search?q=growing%20vegetables&query_by=title,plaintext,embedding' \
  -H 'x-typesense-api-key: playground' | python3 -c "import sys,json; d=json.load(sys.stdin); print([(h['document']['title'], h.get('vector_distance')) for h in d['hits']])"
```

### Offline mock (`npm run dev:mock`)

With no real instance reachable, the widget's Typesense node is pointed at the Vite dev server, and [`vite.config.js`](./vite.config.js) answers the `…/documents/search` endpoint from a small canned dataset ([`src/mock.js`](./src/mock.js)). Try `tomato`, `ghost`, or `garden`. Facet counts and highlighting are computed from that dataset. Note: with the mock, the *semantic search* toggle only changes the request shape — there is no real embedding model behind it.

The seed data and the mock dataset are the same source ([`src/mock.js`](./src/mock.js)), so both backends search identical posts.

### Another Typesense instance

Paste a `https://host:port` URL into the *Real Typesense endpoint* field. It must have a `ghost` collection; the playground sends a placeholder API key, so set a real search-only key in [`src/main.js`](./src/main.js) if you point it at a production instance.

## Notes

This app is `private` and is not published. It has no unit tests of its own — it is a manual dev tool; the widget's behaviour is covered by the test suite in `packages/search-ui`.
