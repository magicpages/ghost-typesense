import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  createDefaultConfig,
  DEFAULT_COLLECTION_FIELDS
} from '../index';

describe('Config Validation', () => {
  it('should validate a correct config', () => {
    const config = {
      ghost: {
        url: 'https://example.com',
        key: 'valid-key',
        version: 'v5.0'
      },
      typesense: {
        nodes: [{
          host: 'localhost',
          port: 8108,
          protocol: 'http'
        }],
        apiKey: 'valid-key'
      },
      collection: {
        name: 'posts',
        fields: DEFAULT_COLLECTION_FIELDS
      }
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('should throw on invalid ghost url', () => {
    const config = {
      ghost: {
        url: 'not-a-url',
        key: 'valid-key'
      },
      typesense: {
        nodes: [{
          host: 'localhost',
          port: 8108,
          protocol: 'http'
        }],
        apiKey: 'valid-key'
      },
      collection: {
        name: 'posts',
        fields: DEFAULT_COLLECTION_FIELDS
      }
    };

    expect(() => validateConfig(config)).toThrow();
  });

  it('should throw on missing required fields', () => {
    const config = {
      ghost: {
        url: 'https://example.com'
        // missing key
      },
      typesense: {
        nodes: [{
          host: 'localhost',
          port: 8108,
          protocol: 'http'
        }],
        apiKey: 'valid-key'
      },
      collection: {
        name: 'posts',
        fields: DEFAULT_COLLECTION_FIELDS
      }
    };

    expect(() => validateConfig(config)).toThrow();
  });

  it('should throw on invalid field type', () => {
    const config = {
      ghost: {
        url: 'https://example.com',
        key: 'valid-key'
      },
      typesense: {
        nodes: [{
          host: 'localhost',
          port: 8108,
          protocol: 'http'
        }],
        apiKey: 'valid-key'
      },
      collection: {
        name: 'posts',
        fields: [
          { name: 'test', type: 'invalid-type' } // invalid type
        ]
      }
    };

    expect(() => validateConfig(config)).toThrow();
  });
});

describe('Default Config Creation', () => {
  it('should create a valid default config', () => {
    const config = createDefaultConfig(
      'https://example.com',
      'ghost-key',
      'typesense-host',
      'typesense-key',
      'custom-collection'
    );

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.collection.name).toBe('custom-collection');
    expect(config.ghost.url).toBe('https://example.com');
    expect(config.ghost.key).toBe('ghost-key');
    expect(config.typesense.nodes[0]?.host).toBe('typesense-host');
    expect(config.typesense.apiKey).toBe('typesense-key');
  });

  it('should use default collection name if not provided', () => {
    const config = createDefaultConfig(
      'https://example.com',
      'ghost-key',
      'typesense-host',
      'typesense-key'
    );

    expect(config.collection.name).toBe('posts');
  });

  it('should include all default collection fields', () => {
    const config = createDefaultConfig(
      'https://example.com',
      'ghost-key',
      'typesense-host',
      'typesense-key'
    );

    expect(config.collection.fields).toEqual(DEFAULT_COLLECTION_FIELDS);
  });

  it('should not add an embedding field by default (semantic search is opt-in)', () => {
    expect(DEFAULT_COLLECTION_FIELDS.some((f) => f.name === 'embedding')).toBe(false);
    expect(DEFAULT_COLLECTION_FIELDS.some((f) => 'embed' in f)).toBe(false);
  });
});

describe('Semantic search field', () => {
  const baseConfig = (embeddingField: unknown) => ({
    ghost: { url: 'https://example.com', key: 'valid-key', version: 'v5.0' },
    typesense: {
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'valid-key'
    },
    collection: {
      name: 'posts',
      fields: [...DEFAULT_COLLECTION_FIELDS, embeddingField]
    }
  });

  it('should accept and preserve an auto-embedding field', () => {
    const config = validateConfig(
      baseConfig({
        name: 'embedding',
        type: 'float[]',
        optional: true,
        embed: {
          from: ['title', 'plaintext', 'excerpt'],
          model_config: { model_name: 'ts/all-MiniLM-L12-v2' }
        }
      })
    );

    const embeddingField = config.collection.fields.find((f) => f.name === 'embedding');
    expect(embeddingField).toBeDefined();
    // The embed block must survive validation — otherwise Typesense would
    // never generate vectors and semantic search would silently not work.
    expect(embeddingField?.embed?.from).toEqual(['title', 'plaintext', 'excerpt']);
    expect(embeddingField?.embed?.model_config.model_name).toBe('ts/all-MiniLM-L12-v2');
  });

  it('should preserve extra model_config keys for external providers', () => {
    const config = validateConfig(
      baseConfig({
        name: 'embedding',
        type: 'float[]',
        optional: true,
        embed: {
          from: ['title'],
          model_config: { model_name: 'openai/text-embedding-3-small', api_key: 'sk-test' }
        }
      })
    );

    const embeddingField = config.collection.fields.find((f) => f.name === 'embedding');
    expect((embeddingField?.embed?.model_config as Record<string, unknown>).api_key).toBe('sk-test');
  });

  it('should reject an embed block with no source fields', () => {
    expect(() =>
      validateConfig(
        baseConfig({
          name: 'embedding',
          type: 'float[]',
          optional: true,
          embed: { from: [], model_config: { model_name: 'ts/all-MiniLM-L12-v2' } }
        })
      )
    ).toThrow();
  });
});

describe('Gated content config', () => {
  const base = {
    ghost: { url: 'https://example.com', key: 'valid-key', version: 'v5.0' },
    typesense: { nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }], apiKey: 'valid-key' }
  };

  it('treats a missing indexGatedContent as off (falsy)', () => {
    const config = validateConfig({ ...base, collection: { name: 'posts' } });
    expect(config.collection.indexGatedContent).toBeFalsy();
  });

  it('accepts indexGatedContent: true', () => {
    const config = validateConfig({ ...base, collection: { name: 'posts', indexGatedContent: true } });
    expect(config.collection.indexGatedContent).toBe(true);
  });

  it('includes an optional visibility field in the default schema', () => {
    const field = DEFAULT_COLLECTION_FIELDS.find((f) => f.name === 'visibility');
    expect(field).toBeDefined();
    expect(field?.optional).toBe(true);
  });
});
