import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { mockSearchResponse } from './src/mock.js';

const searchUiDist = resolve(__dirname, '../../packages/search-ui/dist');

/**
 * Serve the built search widget at `/search.min.js`, straight from
 * `packages/search-ui/dist` with no Vite module transform — the same shape
 * Ghost loads in production (a plain `<script>` of the shipped bundle). If the
 * bundle hasn't been built yet, return a clear error rather than a 404 that
 * looks like a routing bug.
 */
function serveSearchBundle() {
  return {
    name: 'serve-search-bundle',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!/^\/search\.min\.js(?:\?.*)?$/.test(req.url ?? '')) return next();
        const filePath = resolve(searchUiDist, 'search.min.js');
        try {
          await stat(filePath);
        } catch {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(
            'search.min.js not built yet — run `npm run build` in packages/search-ui ' +
              '(or `npx turbo run build --filter=@magicpages/ghost-typesense-search-ui`).'
          );
          return;
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(await readFile(filePath));
      });
    }
  };
}

/**
 * Answer the Typesense documents-search endpoint with a canned response so the
 * playground works fully offline. The real widget builds and sends the request
 * via its Typesense client; only the network reply is faked, so search,
 * facets, and highlighting all run through the actual widget code.
 *
 * Pointing the widget's node at this dev server (see index.html) routes its
 * search requests here.
 */
function mockTypesense() {
  return {
    name: 'mock-typesense',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!/\/collections\/[^/]+\/documents\/search/.test(url)) return next();

        // Search params arrive in the query string (GET) for this client.
        const params = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
        const body = mockSearchResponse(params);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify(body));
      });
    }
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [serveSearchBundle(), mockTypesense()],
  server: {
    port: 5174,
    open: true,
    fs: {
      // Allow reading the built bundle from the sibling package.
      allow: [resolve(__dirname, '../../')]
    }
  },
  build: {
    target: 'es2020'
  }
});
