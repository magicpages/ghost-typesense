// A small fake Ghost dataset and a minimal Typesense-shaped search responder,
// so the playground demonstrates the widget offline. This is intentionally not
// a Typesense reimplementation — it honours just enough (`q` substring match,
// `filter_by` facet equality, `facet_by` counts, basic highlighting) to make
// the search, suggestions, facet, and grid features visible.

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
    feature_image: null,
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

function highlight(text, q) {
  if (!q) return { snippet: text };
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return { snippet: text };
  const snippet = `${text.slice(0, idx)}<mark>${text.slice(idx, idx + q.length)}</mark>${text.slice(idx + q.length)}`;
  return { snippet };
}

export function mockSearchResponse(params = {}) {
  const q = (params.q || '').trim();
  const filters = parseFilterBy(params.filter_by);
  const facetBy = (params.facet_by || '').split(',').map((f) => f.trim()).filter(Boolean);

  const filtered = POSTS.filter((p) => {
    if (!matchesFilters(p, filters)) return false;
    if (!q || q === '*') return true;
    const haystack = `${p.title} ${p.excerpt} ${p.plaintext} ${p.tags.join(' ')}`.toLowerCase();
    return haystack.includes(q.toLowerCase());
  });

  const hits = filtered.map((document) => ({
    document,
    highlight: {
      title: highlight(document.title, q),
      excerpt: highlight(document.excerpt, q)
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
