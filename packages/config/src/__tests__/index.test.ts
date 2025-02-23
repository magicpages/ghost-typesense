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
}); 