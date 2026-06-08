import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GhostTypesenseManager } from '../index';
import type { Config } from '@magicpages/ghost-typesense-config';

// Mock the external dependencies
vi.mock('@ts-ghost/content-api', () => {
  return {
    TSGhostContentAPI: vi.fn().mockImplementation(() => ({
      posts: {
        browse: () => ({
          include: () => ({
            fetch: async () => ({
              success: true,
              data: [
                {
                  id: 'test-post-1',
                  title: 'Test Post 1',
                  slug: 'test-post-1',
                  html: '<p>Test content</p>',
                  excerpt: 'Test excerpt',
                  published_at: '2024-02-09T19:00:00.000Z',
                  updated_at: '2024-02-09T19:00:00.000Z',
                  tags: [{ name: 'test-tag' }],
                  authors: [{ name: 'Test Author' }]
                }
              ],
              meta: {
                pagination: {
                  total: 1,
                  limit: 15
                }
              }
            })
          })
        }),
        // `read` returns a public post by default, or a members-only post when
        // asked for the gated id — so the gated indexPost paths can be tested.
        read: ({ id }: { id: string }) => ({
          include: () => ({
            fetch: async () =>
              id === 'gated-post-1'
                ? {
                    success: true,
                    data: {
                      id: 'gated-post-1',
                      title: 'Members Post',
                      slug: 'members-post',
                      html: '<p>SECRET_PROTECTED_BODY for members only.</p>',
                      plaintext: 'SECRET_PROTECTED_BODY for members only.',
                      excerpt: 'A public teaser.',
                      visibility: 'members',
                      published_at: '2024-02-09T19:00:00.000Z',
                      updated_at: '2024-02-09T19:00:00.000Z',
                      tags: [{ name: 'premium', slug: 'premium' }],
                      authors: [{ name: 'Test Author' }]
                    }
                  }
                : {
                    success: true,
                    data: {
                      id: 'test-post-1',
                      title: 'Test Post 1',
                      slug: 'test-post-1',
                      html: '<p>Test content</p>',
                      excerpt: 'Test excerpt',
                      visibility: 'public',
                      published_at: '2024-02-09T19:00:00.000Z',
                      updated_at: '2024-02-09T19:00:00.000Z',
                      tags: [{ name: 'test-tag' }],
                      authors: [{ name: 'Test Author' }]
                    }
                  }
          })
        })
      }
    }))
  };
});

// Stable spies so tests can inspect what was sent to Typesense. The import
// import() call (`documents().import`) is used by batched indexing; upsert by
// single-post indexing; create by collection (re)creation.
const mockDocuments = {
  delete: vi.fn().mockResolvedValue(true),
  upsert: vi.fn().mockResolvedValue(true),
  import: vi.fn().mockResolvedValue([{ success: true }])
};
const mockCreate = vi.fn().mockResolvedValue(true);

vi.mock('typesense', () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      collections: (name?: string) => {
        if (name) {
          return {
            delete: vi.fn().mockResolvedValue(true),
            documents: () => mockDocuments
          };
        }
        return {
          retrieve: vi.fn().mockResolvedValue([]),
          create: mockCreate
        };
      }
    }))
  };
});

describe('GhostTypesenseManager', () => {
  let manager: GhostTypesenseManager;
  const testConfig: Config = {
    ghost: {
      url: 'https://test.com',
      key: 'test-key',
      version: 'v5.0'
    },
    typesense: {
      nodes: [{
        host: 'localhost',
        port: 8108,
        protocol: 'http'
      }],
      apiKey: 'test-key'
    },
    collection: {
      name: 'test-collection',
      fields: [
        { name: 'id', type: 'string', optional: false },
        { name: 'title', type: 'string', optional: false },
        { name: 'slug', type: 'string', optional: false },
        { name: 'html', type: 'string', optional: true },
        { name: 'excerpt', type: 'string', optional: true },
        { name: 'published_at', type: 'int64', optional: false },
        { name: 'updated_at', type: 'int64', optional: false }
      ]
    }
  };

  beforeEach(() => {
    mockDocuments.upsert.mockClear();
    mockDocuments.import.mockClear();
    mockCreate.mockClear();
    manager = new GhostTypesenseManager(testConfig);
  });

  describe('initializeCollection', () => {
    it('should initialize collection successfully', async () => {
      await expect(manager.initializeCollection()).resolves.not.toThrow();
    });
  });

  describe('indexAllPosts', () => {
    it('should index all posts successfully', async () => {
      await expect(manager.indexAllPosts()).resolves.not.toThrow();
    });
  });

  describe('indexPost', () => {
    it('should index a single post successfully', async () => {
      await expect(manager.indexPost('test-post-1')).resolves.not.toThrow();
    });
  });

  describe('deletePost', () => {
    it('should delete a post successfully', async () => {
      await expect(manager.deletePost('test-post-1')).resolves.not.toThrow();
    });
  });

  describe('clearCollection', () => {
    it('should clear collection successfully', async () => {
      await expect(manager.clearCollection()).resolves.not.toThrow();
    });
  });
});

describe('GhostTypesenseManager — semantic search', () => {
  const embeddingField = {
    name: 'embedding',
    type: 'float[]' as const,
    optional: true,
    embed: {
      from: ['title', 'plaintext', 'excerpt'],
      model_config: { model_name: 'ts/all-MiniLM-L12-v2' }
    }
  };

  const semanticConfig: Config = {
    ghost: { url: 'https://test.com', key: 'test-key', version: 'v5.0' },
    typesense: {
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'test-key'
    },
    collection: {
      name: 'test-collection',
      fields: [
        { name: 'id', type: 'string', optional: false },
        { name: 'title', type: 'string', optional: false },
        { name: 'slug', type: 'string', optional: false },
        { name: 'html', type: 'string', optional: true },
        { name: 'excerpt', type: 'string', optional: true },
        { name: 'published_at', type: 'int64', optional: false },
        { name: 'updated_at', type: 'int64', optional: false },
        embeddingField
      ]
    }
  };

  beforeEach(() => {
    mockDocuments.upsert.mockClear();
    mockCreate.mockClear();
  });

  it('passes the embed config through to the created collection schema', async () => {
    const manager = new GhostTypesenseManager(semanticConfig);
    await manager.initializeCollection();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const schema = mockCreate.mock.calls[0]![0] as {
      fields: Array<{ name: string; embed?: unknown }>;
    };
    const field = schema.fields.find((f) => f.name === 'embedding');
    expect(field?.embed).toEqual(embeddingField.embed);
  });

  it('does not write a value into the auto-embedding field when indexing', async () => {
    const manager = new GhostTypesenseManager(semanticConfig);
    await manager.indexPost('test-post-1');

    expect(mockDocuments.upsert).toHaveBeenCalledTimes(1);
    const document = mockDocuments.upsert.mock.calls[0]![0] as Record<string, unknown>;
    // Typesense generates the vector itself; supplying one would be rejected.
    expect('embedding' in document).toBe(false);
  });
});

describe('GhostTypesenseManager — gated content redaction', () => {
  const baseConfig: Config = {
    ghost: { url: 'https://test.com', key: 'test-key', version: 'v5.0' },
    typesense: { nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }], apiKey: 'test-key' },
    collection: {
      name: 'test-collection',
      fields: [
        { name: 'id', type: 'string', optional: false },
        { name: 'title', type: 'string', optional: false },
        { name: 'slug', type: 'string', optional: false },
        { name: 'html', type: 'string', optional: true },
        { name: 'excerpt', type: 'string', optional: true },
        { name: 'published_at', type: 'int64', optional: false },
        { name: 'updated_at', type: 'int64', optional: false }
      ]
    }
  };

  // A members-only post whose body, if ever indexed, would contain this
  // sentinel. The redaction must guarantee it never appears in the document.
  const gatedPost = {
    id: 'gated-1',
    title: 'Members deep dive',
    slug: 'members-deep-dive',
    excerpt: 'A teaser anyone can read.',
    html: '<p>SECRET_PROTECTED_BODY that must never be indexed.</p>',
    plaintext: 'SECRET_PROTECTED_BODY that must never be indexed.',
    visibility: 'members',
    published_at: '2024-02-09T19:00:00.000Z',
    updated_at: '2024-02-09T19:00:00.000Z',
    tags: [{ name: 'Premium', slug: 'premium' }],
    authors: [{ name: 'Author' }]
  };

  // transformPost is private; reach it for a focused unit test of redaction.
  function transform(manager: GhostTypesenseManager, post: unknown) {
    return (manager as unknown as { transformPost: (p: unknown) => Record<string, unknown> }).transformPost(post);
  }

  it('redacts a gated post: no protected body, preview-only plaintext, visibility set', () => {
    const manager = new GhostTypesenseManager({
      ...baseConfig,
      collection: { ...baseConfig.collection, indexGatedContent: true }
    });
    const doc = transform(manager, gatedPost);

    expect(doc.visibility).toBe('members');
    expect(doc.html).toBe('');
    // The searchable text is the public excerpt, never the protected body.
    expect(doc.plaintext).toBe('A teaser anyone can read.');
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('SECRET_PROTECTED_BODY');
    // Public metadata is still indexed so the result is useful/discoverable.
    expect(doc.tags).toEqual(['Premium']);
  });

  it('falls back to the title when a gated post has no excerpt', () => {
    const manager = new GhostTypesenseManager({
      ...baseConfig,
      collection: { ...baseConfig.collection, indexGatedContent: true }
    });
    const doc = transform(manager, { ...gatedPost, excerpt: '' });
    expect(doc.plaintext).toBe('Members deep dive');
  });

  it('indexes public posts in full with visibility "public"', () => {
    const manager = new GhostTypesenseManager(baseConfig);
    const doc = transform(manager, {
      id: 'pub-1', title: 'Public', slug: 'public',
      html: '<p>Readable body</p>', excerpt: 'x', visibility: 'public',
      published_at: '2024-02-09T19:00:00.000Z', updated_at: '2024-02-09T19:00:00.000Z'
    });
    expect(doc.visibility).toBe('public');
    expect(String(doc.plaintext)).toContain('Readable body');
  });

  // Integration through indexPost (the path the webhook uses), driving the
  // mocked Ghost API's gated post.
  describe('indexPost', () => {
    beforeEach(() => {
      mockDocuments.upsert.mockClear();
      mockDocuments.delete.mockClear();
    });

    it('removes a gated post (does not index it) when the flag is off', async () => {
      const manager = new GhostTypesenseManager(baseConfig); // indexGatedContent undefined → off
      await manager.indexPost('gated-post-1');

      expect(mockDocuments.upsert).not.toHaveBeenCalled();
      expect(mockDocuments.delete).toHaveBeenCalledTimes(1);
    });

    it('indexes a gated post as a redacted document when the flag is on', async () => {
      const manager = new GhostTypesenseManager({
        ...baseConfig,
        collection: { ...baseConfig.collection, indexGatedContent: true }
      });
      await manager.indexPost('gated-post-1');

      expect(mockDocuments.upsert).toHaveBeenCalledTimes(1);
      const doc = mockDocuments.upsert.mock.calls[0]![0] as Record<string, unknown>;
      expect(doc.visibility).toBe('members');
      expect(doc.html).toBe('');
      expect(JSON.stringify(doc)).not.toContain('SECRET_PROTECTED_BODY');
    });

    it('indexes a public post normally regardless of the flag', async () => {
      const manager = new GhostTypesenseManager(baseConfig);
      await manager.indexPost('test-post-1');

      expect(mockDocuments.upsert).toHaveBeenCalledTimes(1);
      expect(mockDocuments.delete).not.toHaveBeenCalled();
    });
  });
});