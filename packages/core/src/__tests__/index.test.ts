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
        read: () => ({
          include: () => ({
            fetch: async () => ({
              success: true,
              data: {
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
            })
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