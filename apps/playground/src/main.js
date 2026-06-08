// Playground wiring: read the controls, assemble window.__MP_SEARCH_CONFIG__,
// (re)load the built widget the way Ghost does, and surface analytics events in
// an on-page log.

const SEARCH_BUNDLE_URL = '/search.min.js';

const els = {
  uistyle: document.getElementById('opt-uistyle'),
  template: document.getElementById('opt-template'),
  theme: document.getElementById('opt-theme'),
  facets: document.getElementById('opt-facets'),
  searchAuthors: document.getElementById('opt-searchauthors'),
  suggestions: document.getElementById('opt-suggestions'),
  semantic: document.getElementById('opt-semantic'),
  analytics: document.getElementById('opt-analytics'),
  endpoint: document.getElementById('opt-endpoint'),
  apply: document.getElementById('apply'),
  open: document.getElementById('open'),
  clearLog: document.getElementById('clear-log'),
  log: document.getElementById('log')
};

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

function write(line, kind = 'info') {
  const span = document.createElement('span');
  span.className = `ev-${kind}`;
  span.textContent = `[${stamp()}] ${line}\n`;
  els.log.appendChild(span);
  els.log.scrollTop = els.log.scrollHeight;
}

// The widget reports analytics via navigator.sendBeacon. Intercept it so the
// playground can show search/click/zero_result events (and the queries they
// carry) without a backend.
const ANALYTICS_ENDPOINT = '/__playground_analytics';
const realSendBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
navigator.sendBeacon = (url, data) => {
  if (typeof url === 'string' && url.includes('__playground_analytics')) {
    readBeacon(data).then((payload) => {
      if (!payload) return;
      const detail =
        payload.type === 'click'
          ? `click → "${payload.q}" → ${payload.resultId} (pos ${payload.position})`
          : `${payload.type} → "${payload.q}" (${payload.resultCount} results)`;
      write(detail, 'analytics');
    });
    return true;
  }
  return realSendBeacon ? realSendBeacon(url, data) : true;
};

async function readBeacon(data) {
  try {
    if (data instanceof Blob) return JSON.parse(await data.text());
    if (typeof data === 'string') return JSON.parse(data);
  } catch {
    /* ignore malformed beacon payloads */
  }
  return null;
}

const LOCAL_TYPESENSE = { host: 'localhost', port: 8108, protocol: 'http', apiKey: 'playground' };

// Has the Docker Typesense from docker-compose.yml been started and seeded?
// Probed once so the playground can prefer a real instance when it's available.
let localTypesense = null;
async function detectLocalTypesense() {
  if (localTypesense !== null) return localTypesense;
  try {
    const res = await fetch(`${LOCAL_TYPESENSE.protocol}://${LOCAL_TYPESENSE.host}:${LOCAL_TYPESENSE.port}/health`, {
      signal: AbortSignal.timeout(800)
    });
    localTypesense = res.ok;
  } catch {
    localTypesense = false;
  }
  return localTypesense;
}

// Does the active backend's `ghost` collection actually have an embedding
// field? The seed falls back to a lexical-only collection when the embedding
// model can't load (e.g. not enough memory in the Docker container), and the
// offline mock has no real embeddings at all — in both cases semantic search
// is a no-op, so the playground needs to know and say so.
let embeddingSupport = null;
async function detectEmbeddingSupport(node, apiKey) {
  try {
    const res = await fetch(`${node.protocol}://${node.host}:${node.port}/collections/ghost`, {
      headers: { 'x-typesense-api-key': apiKey },
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return false;
    const schema = await res.json();
    return Array.isArray(schema.fields) && schema.fields.some((f) => f.embed || f.name === 'embedding');
  } catch {
    // The mock backend doesn't answer /collections/ghost — treat as no support.
    return false;
  }
}

// Reflect embedding availability in the Semantic toggle so it can't silently be
// a no-op.
function applyEmbeddingState(supported, usingMock) {
  embeddingSupport = supported;
  const label = els.semantic.closest('label');
  if (supported) {
    els.semantic.disabled = false;
    if (label) label.title = 'Hybrid keyword + vector search';
    return;
  }
  els.semantic.disabled = true;
  els.semantic.checked = false;
  if (label) {
    label.style.opacity = '0.55';
    label.title = usingMock
      ? 'Semantic search needs a real Typesense — run `npm run dev` with Docker.'
      : 'This collection was seeded without embeddings (model could not load). Give Docker more memory and re-run `npm run seed`.';
  }
}

// Decide which backend to use, in priority order:
//   1. an explicit endpoint typed into the field
//   2. the local Docker Typesense, if it's up (real engine + real semantic search)
//   3. the built-in offline mock served by this dev server
function resolveBackend() {
  const raw = els.endpoint.value.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      write(`using real Typesense at ${u.host}`);
      return {
        node: { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), protocol: u.protocol.replace(':', '') },
        apiKey: 'playground-search-only-key'
      };
    } catch {
      write(`could not parse endpoint "${raw}", falling back`, 'error');
    }
  }

  if (localTypesense) {
    write('using local Docker Typesense at localhost:8108');
    return { node: { host: LOCAL_TYPESENSE.host, port: LOCAL_TYPESENSE.port, protocol: LOCAL_TYPESENSE.protocol }, apiKey: LOCAL_TYPESENSE.apiKey };
  }

  write('using built-in mock backend on this dev server');
  return {
    node: { host: location.hostname, port: Number(location.port) || 80, protocol: location.protocol.replace(':', '') },
    apiKey: 'playground-search-only-key'
  };
}

function buildConfig(backend) {
  const config = {
    typesenseNodes: [backend.node],
    typesenseApiKey: backend.apiKey,
    collectionName: 'ghost',
    theme: els.theme.value,
    template: els.template.value,
    enableHighlighting: true
  };

  // UI style from the selector. 'palette'/'discovery' are loaded on demand
  // from /palette.min.js or /discovery.min.js; 'modal' is the built-in default.
  const uiStyle = els.uistyle ? els.uistyle.value : 'modal';
  if (uiStyle === 'palette' || uiStyle === 'discovery') {
    config.uiStyle = uiStyle;
  }

  if (els.facets.checked) {
    config.facets = [
      { field: 'tags.name', label: 'Topics', limit: 10 },
      { field: 'authors', label: 'Authors', limit: 10 }
    ];
  }
  if (els.searchAuthors && els.searchAuthors.checked) {
    config.searchAuthors = true;
  }
  if (els.suggestions.checked) {
    config.pinnedSearches = ['Ghost'];
    config.commonSearches = ['tomatoes', 'garden', 'theme'];
  }
  if (els.semantic.checked && embeddingSupport) {
    config.semanticSearch = true;
  }
  if (els.analytics.checked) {
    config.analytics = { endpoint: ANALYTICS_ENDPOINT, siteId: 'playground' };
  }
  return config;
}

// The widget is a single-instance Web Component: it reads its config once, when
// it first initializes, and guards against re-initialization. So rather than
// swap the element in place, applying new options persists them and reloads —
// the same way a real site loads the widget fresh with a given config. This
// also sidesteps the component's one-time init guard entirely.
const STORAGE_KEY = 'mp-playground-state';

function readControls() {
  return {
    uistyle: els.uistyle ? els.uistyle.value : 'modal',
    template: els.template.value,
    theme: els.theme.value,
    facets: els.facets.checked,
    searchAuthors: els.searchAuthors ? els.searchAuthors.checked : false,
    suggestions: els.suggestions.checked,
    semantic: els.semantic.checked,
    analytics: els.analytics.checked,
    endpoint: els.endpoint.value.trim()
  };
}

function restoreControls(state) {
  if (!state) return;
  if (els.uistyle) els.uistyle.value = state.uistyle ?? 'modal';
  els.template.value = state.template ?? 'list';
  els.theme.value = state.theme ?? 'system';
  els.facets.checked = !!state.facets;
  if (els.searchAuthors) els.searchAuthors.checked = !!state.searchAuthors;
  els.suggestions.checked = !!state.suggestions;
  els.semantic.checked = !!state.semantic;
  els.analytics.checked = state.analytics !== false;
  els.endpoint.value = state.endpoint ?? '';
}

function apply() {
  // Persist the chosen options and reload; loadWidget() picks them up.
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readControls(), open: true }));
  location.reload();
}

// On load: if options were applied, build the config, load the built bundle the
// way Ghost does, and open the modal once the widget has initialized.
async function loadWidget() {
  let state = null;
  try {
    state = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    /* ignore */
  }
  restoreControls(state);

  if (!state) {
    // Annotate the Semantic toggle on first load too, so its availability is
    // clear before the first Apply.
    await detectLocalTypesense();
    const backend = resolveBackend();
    const usingMock = !els.endpoint.value.trim() && !localTypesense;
    applyEmbeddingState(usingMock ? false : await detectEmbeddingSupport(backend.node, backend.apiKey), usingMock);
    write('ready — choose options and press “Apply & open search”.');
    return;
  }

  await detectLocalTypesense();
  const backend = resolveBackend();

  // Check whether semantic search is actually available on this backend and
  // reflect it in the UI before building the config.
  const usingMock = !els.endpoint.value.trim() && !localTypesense;
  const supported = usingMock ? false : await detectEmbeddingSupport(backend.node, backend.apiKey);
  applyEmbeddingState(supported, usingMock);
  if (els.semantic.checked && !supported) {
    write(
      usingMock
        ? 'semantic search unavailable on the mock backend — start the Docker Typesense with `npm run dev`'
        : 'semantic search unavailable — the collection was seeded without embeddings (model could not load); give Docker more memory and re-run `npm run seed`',
      'error'
    );
  } else if (supported) {
    write('semantic search available (collection has an embedding field)');
  }

  const config = buildConfig(backend);
  window.__MP_SEARCH_CONFIG__ = config;
  write(`config applied: ui=${config.uiStyle || 'modal'}, template=${config.template}, facets=${!!config.facets}, semantic=${!!config.semanticSearch}, analytics=${!!config.analytics}`);

  try {
    // Dynamic import of the shipped artifact — the widget auto-creates its own
    // instance and sets window.magicPagesSearch because the config is present.
    await import(/* @vite-ignore */ SEARCH_BUNDLE_URL);
    write(`loaded ${SEARCH_BUNDLE_URL}`);
  } catch (err) {
    write(`failed to load ${SEARCH_BUNDLE_URL}: ${err?.message || err}`, 'error');
    return;
  }

  if (state.open) {
    // Wait for the widget to exist, then open. openModal() itself awaits the
    // widget's async init (which lazily loads the selected layout's chunk), so
    // the surface is ready before it shows.
    await waitFor(() => window.magicPagesSearch && typeof window.magicPagesSearch.openModal === 'function');
    await window.magicPagesSearch.openModal();
    write('search opened — type to query (try “tomato”, “ghost”, “garden”)');
  }
}

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function check() {
      if (predicate() || Date.now() - start > timeoutMs) return resolve();
      setTimeout(check, 30);
    })();
  });
}

els.apply.addEventListener('click', apply);
els.open.addEventListener('click', () => {
  if (window.magicPagesSearch) window.magicPagesSearch.openModal();
  else apply();
});
els.clearLog.addEventListener('click', () => els.log.replaceChildren());

void loadWidget();
