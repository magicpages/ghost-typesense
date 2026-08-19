// A small fake Ghost dataset and a minimal Typesense-shaped search responder,
// so the playground demonstrates the widget offline. This is intentionally not
// a Typesense reimplementation — it honours just enough (`q` substring match,
// `filter_by` facet equality, `facet_by` counts, basic highlighting, and
// `num_typos` word matching) to make the search, suggestions, facet, grid, and
// did-you-mean features visible.

export const POSTS = [
  {
    id: 'post-1',
    title: 'Growing tomatoes on a balcony',
    slug: 'growing-tomatoes',
    url: 'https://demo.example.com/growing-tomatoes/',
    excerpt: 'Everything you need to turn a sunny balcony into a small tomato garden.',
    plaintext: 'Tomatoes love sun and water. Start with seedlings, use deep pots, and feed weekly.',
    feature_image: 'https://images.unsplash.com/photo-1592841200221-a6898f307baa?w=1200&q=80',
    published_at: 1700000000000,
    tags: ['Gardening', 'How To'],
    authors: ['Jannis']
  },
  {
    id: 'post-2',
    title: 'A vegetable garden plan for beginners',
    slug: 'vegetable-garden-plan',
    url: 'https://demo.example.com/vegetable-garden-plan/',
    excerpt: 'Lay out your first vegetable garden with this simple seasonal plan.',
    plaintext: 'Plan beds by sunlight, rotate crops, and start with easy vegetables like lettuce and beans.',
    feature_image: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
    published_at: 1699000000000,
    tags: ['Gardening'],
    authors: ['Sam']
  },
  {
    id: 'post-3',
    title: 'Migrating your blog to Ghost',
    slug: 'migrating-to-ghost',
    url: 'https://demo.example.com/migrating-to-ghost/',
    excerpt: 'A step-by-step guide to moving an existing site onto Ghost.',
    plaintext: 'Export your content, map authors and tags, import into Ghost, then verify redirects.',
    feature_image: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&q=80',
    published_at: 1698000000000,
    tags: ['Ghost', 'How To'],
    authors: ['Jannis']
  },
  {
    id: 'post-4',
    title: 'Designing a fast Ghost theme',
    slug: 'fast-ghost-theme',
    url: 'https://demo.example.com/fast-ghost-theme/',
    excerpt: 'Performance tips for building a Ghost theme that loads instantly.',
    plaintext: 'Inline critical CSS, lazy-load images, and keep JavaScript minimal for a fast theme.',
    feature_image: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1200&q=80',
    published_at: 1697000000000,
    tags: ['Ghost', 'Design'],
    authors: ['Sam']
  },
  // Gated posts, to demo the members-only badge and redaction. Their plaintext
  // here represents the protected body — the mock responder and the seed must
  // never expose it; only the excerpt (the public teaser) is searchable.
  {
    id: 'post-5',
    title: 'Advanced soil chemistry for serious growers',
    slug: 'advanced-soil-chemistry',
    url: 'https://demo.example.com/advanced-soil-chemistry/',
    excerpt: 'The full members-only guide to amending soil pH and nutrients.',
    plaintext: 'MEMBERS_ONLY_BODY: detailed N-P-K ratios, chelated micronutrients, and lab testing protocols.',
    feature_image: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80',
    published_at: 1696000000000,
    tags: ['Gardening'],
    authors: ['Jannis'],
    visibility: 'members'
  },
  {
    id: 'post-6',
    title: 'The complete Ghost performance course',
    slug: 'ghost-performance-course',
    url: 'https://demo.example.com/ghost-performance-course/',
    excerpt: 'A paid deep-dive into squeezing every millisecond out of Ghost.',
    plaintext: 'PAID_BODY: CDN tuning, image pipelines, server-timing budgets, and a full audit checklist.',
    published_at: 1695000000000,
    tags: ['Ghost', 'Design'],
    authors: ['Sam'],
    visibility: 'paid'
  }
];

// Parse a Typesense filter_by clause like `tags:=[`Ghost`,`Design`] && authors:=[`Sam`]`
// into { field: [values] }. Only the subset the widget emits is handled.
function parseFilterBy(filterBy) {
  const filters = {};
  if (!filterBy) return filters;
  // Split on top-level && (the widget never nests beyond one level of parens).
  for (const clause of filterBy.replace(/[()]/g, '').split('&&')) {
    const match = clause.trim().match(/^([\w.]+):=\[(.*)\]$/);
    if (!match) continue;
    const [, field, rawValues] = match;
    filters[field] = rawValues
      .split(',')
      .map((v) => v.trim().replace(/^`|`$/g, ''))
      .filter(Boolean);
  }
  return filters;
}

function matchesFilters(post, filters) {
  return Object.entries(filters).every(([field, values]) => {
    const docValue = field === 'tags.name' ? post.tags : post[field];
    const have = Array.isArray(docValue) ? docValue : [docValue];
    return values.some((v) => have.includes(v));
  });
}

// Word-level matching, mirroring the two things the widget relies on: prefix
// matching (`prefix: true`) and a per-word typo budget (`num_typos`). The typo
// side is only ever reached when the widget asks for it, which is what makes
// the did-you-mean retry demonstrable offline: the strict first request finds
// nothing, the lenient second one matches. `queryWord` comes in lowercased
// (see queryWords); the document's own casing is preserved for the caller.
function wordMatches(docWord, queryWord, budget) {
  const word = docWord.toLowerCase();
  if (word.startsWith(queryWord)) return true;
  if (budget <= 0 || Math.abs(word.length - queryWord.length) > budget) return false;

  // Levenshtein distance, abandoned once it is known to exceed the budget.
  let previous = Array.from({ length: word.length + 1 }, (_, i) => i);
  for (let i = 1; i <= queryWord.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= word.length; j++) {
      const cost = queryWord[i - 1] === word[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > budget) return false;
    previous = current;
  }
  return previous[word.length] <= budget;
}

function words(text) {
  return String(text).match(/[\p{L}\p{N}']+/gu) || [];
}

function queryWords(q) {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

// Every query word has to match some word in the text — the mock's stand-in for
// a typo-tolerant match, used only when the widget asked for one.
function matchesWithTypos(text, q, budget) {
  const docWords = words(text);
  return queryWords(q).every((queryWord) =>
    docWords.some((docWord) => wordMatches(docWord, queryWord, budget))
  );
}

// The document's own words that the query matched. The widget reads these as
// `matched_tokens` — they are where a "did you mean" correction comes from, so
// they carry the document's spelling rather than the reader's.
function matchedTokens(text, q, budget) {
  if (!q) return [];
  const qWords = queryWords(q);
  return words(text).filter((docWord) =>
    qWords.some((queryWord) => wordMatches(docWord, queryWord, budget))
  );
}

function highlight(text, q, budget) {
  const matched_tokens = matchedTokens(text, q, budget);
  if (!q) return { snippet: text, matched_tokens };
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return { snippet: text, matched_tokens };
  const snippet = `${text.slice(0, idx)}<mark>${text.slice(idx, idx + q.length)}</mark>${text.slice(idx + q.length)}`;
  return { snippet, matched_tokens };
}

// The indexed representation of a post, mirroring what packages/core writes to
// Typesense. Public posts keep their plaintext; gated (members/paid) posts are
// redacted to the excerpt only, so their protected body is never searchable and
// never returned — the same guarantee the real indexer provides.
function toIndexedDoc(post) {
  const visibility = post.visibility || 'public';
  const { plaintext, html, ...rest } = post;
  if (visibility === 'public') {
    return { ...rest, ...(html !== undefined ? { html } : {}), plaintext, visibility };
  }
  // Mirror the core indexer: gated posts carry no body — empty html and
  // excerpt-only plaintext.
  return { ...rest, html: '', plaintext: post.excerpt || post.title || '', visibility };
}

export function mockSearchResponse(params = {}) {
  const q = (params.q || '').trim();
  // Arrives as a query-string value, so it is a string on the wire.
  const numTypos = Number(params.num_typos) || 0;
  const filters = parseFilterBy(params.filter_by);
  const facetBy = (params.facet_by || '').split(',').map((f) => f.trim()).filter(Boolean);

  // Search against the redacted index view, never the raw posts, so a gated
  // post's protected body is not even matchable.
  const indexed = POSTS.map(toIndexedDoc);

  // Match over the fields the widget actually asked for (query_by). authors is
  // included when query_by lists it (searchAuthors) or when the query is
  // semantic (embedding in query_by) — so a semantic/author search for a
  // contributor name finds *their* posts, not unrelated ones.
  const queryBy = (params.query_by || '').toLowerCase();
  const includeAuthors = queryBy.includes('author') || queryBy.includes('embedding');
  const filtered = indexed.filter((p) => {
    if (!matchesFilters(p, filters)) return false;
    if (!q || q === '*') return true;
    const fieldsText = [p.title, p.excerpt, p.plaintext, p.tags.join(' ')];
    if (includeAuthors) fieldsText.push((p.authors || []).join(' '));
    const haystack = fieldsText.join(' ');
    if (haystack.toLowerCase().includes(q.toLowerCase())) return true;
    // Only when the widget asked for typo tolerance, so the strict default
    // keeps matching exactly as before.
    return numTypos > 0 && matchesWithTypos(haystack, q, numTypos);
  });

  const hits = filtered.map((document) => ({
    document,
    highlight: {
      title: highlight(document.title, q, numTypos),
      excerpt: highlight(document.excerpt, q, numTypos)
    }
  }));

  // Facet counts are computed over the filtered set, mirroring how Typesense
  // narrows counts as filters are applied.
  const facet_counts = facetBy.map((field) => {
    const counts = {};
    for (const post of filtered) {
      const values = field === 'tags.name' ? post.tags : [].concat(post[field] || []);
      for (const value of values) counts[value] = (counts[value] || 0) + 1;
    }
    return {
      field_name: field,
      counts: Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count, highlighted: value }))
    };
  });

  return {
    facet_counts,
    found: hits.length,
    hits,
    out_of: POSTS.length,
    page: 1,
    request_params: { collection_name: 'ghost', q, per_page: 20 },
    search_time_ms: 1
  };
}
