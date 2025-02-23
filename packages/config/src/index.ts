import { z } from 'zod';

/**
 * Ghost API configuration schema
 */
export const GhostConfigSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  version: z.literal('v5.0').default('v5.0')
});

/**
 * Clean a URL by removing protocol and any trailing slashes
 */
function cleanUrl(url: string): string {
  // Remove protocol (http:// or https://) if present
  const withoutProtocol = url.replace(/^https?:\/\//i, '');
  // Remove trailing slashes
  return withoutProtocol.replace(/\/+$/, '');
}

/**
 * Typesense node configuration schema
 */
export const TypesenseNodeSchema = z.object({
  host: z.string().transform(cleanUrl),
  port: z.number(),
  protocol: z.enum(['http', 'https']),
  path: z.string().optional()
});

/**
 * Typesense configuration schema
 */
export const TypesenseConfigSchema = z.object({
  nodes: z.array(TypesenseNodeSchema).min(1),
  apiKey: z.string().min(1),
  connectionTimeoutSeconds: z.number().optional(),
  retryIntervalSeconds: z.number().optional()
});

/**
 * Collection field configuration schema
 */
export const CollectionFieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'int32', 'int64', 'float', 'bool', 'string[]', 'int32[]', 'int64[]', 'float[]', 'bool[]']),
  facet: z.boolean().optional(),
  index: z.boolean().optional(),
  optional: z.boolean().optional(),
  sort: z.boolean().optional()
}).transform(data => ({
  ...data,
  optional: data.optional ?? false
}));

/**
 * Required fields that must be present in the collection
 */
export const REQUIRED_FIELDS = {
  id: { type: 'string' as const, description: 'Unique identifier for the post' },
  title: { type: 'string' as const, description: 'Post title' },
  url: { type: 'string' as const, description: 'Full URL to the post' },
  slug: { type: 'string' as const, description: 'URL-friendly post slug' },
  html: { type: 'string' as const, description: 'Post content in HTML format' },
  excerpt: { type: 'string' as const, description: 'Post excerpt or summary' },
  published_at: { type: 'int64' as const, description: 'Post publication timestamp' },
  updated_at: { type: 'int64' as const, description: 'Post last update timestamp' }
} as const;

/**
 * Collection configuration schema with strict validation
 */
export const CollectionConfigSchema = z.object({
  name: z.string().min(1, 'Collection name cannot be empty'),
  fields: z.array(CollectionFieldSchema)
    .min(1, 'At least one field must be defined')
    .refine(
      (fields) => {
        // Check if all required fields are present with correct types and not optional
        const missingOrInvalidFields = Object.entries(REQUIRED_FIELDS)
          .filter(([fieldName, spec]) => {
            const field = fields.find(f => f.name === fieldName);
            // A field is invalid if:
            // 1. It doesn't exist
            // 2. It has the wrong type
            // 3. It's marked as optional
            return !field || field.type !== spec.type || field.optional === true;
          });

        if (missingOrInvalidFields.length > 0) {
          const errors = missingOrInvalidFields.map(([fieldName, spec]) => {
            const field = fields.find(f => f.name === fieldName);
            if (!field) {
              return `Missing required field "${fieldName}" (${spec.description})`;
            }
            if (field.type !== spec.type) {
              return `Field "${fieldName}" must be of type "${spec.type}" (${spec.description})`;
            }
            if (field.optional === true) {
              return `Field "${fieldName}" cannot be optional (${spec.description})`;
            }
            return `Invalid configuration for "${fieldName}"`;
          });
          throw new Error(`Invalid collection configuration:\n- ${errors.join('\n- ')}`);
        }
        return true;
      },
      {
        message: 'Collection configuration is invalid'
      }
    ),
  default_sorting_field: z.string().optional()
});

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  ghost: GhostConfigSchema,
  typesense: TypesenseConfigSchema,
  collection: CollectionConfigSchema
});

/**
 * Type definitions derived from schemas
 */
export type GhostConfig = z.infer<typeof GhostConfigSchema>;
export type TypesenseNode = z.infer<typeof TypesenseNodeSchema>;
export type TypesenseConfig = z.infer<typeof TypesenseConfigSchema>;
export type CollectionField = z.infer<typeof CollectionFieldSchema>;
export type CollectionConfig = z.infer<typeof CollectionConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validates the configuration object against the schema
 * @param config The configuration object to validate
 * @returns The validated configuration object with types
 * @throws {ZodError} If validation fails
 */
export function validateConfig(config: unknown): Config {
  return ConfigSchema.parse(config);
}

/**
 * Default collection fields that should be included
 */
export const DEFAULT_COLLECTION_FIELDS: CollectionField[] = [
  { name: 'id', type: 'string', optional: false },
  { name: 'title', type: 'string', index: true, sort: true, optional: false },
  { name: 'url', type: 'string', index: true, optional: false },
  { name: 'slug', type: 'string', index: true, optional: false },
  { name: 'html', type: 'string', index: true, optional: false },
  { name: 'excerpt', type: 'string', index: true, optional: false },
  { name: 'feature_image', type: 'string', index: false, optional: true },
  { name: 'published_at', type: 'int64', sort: true, optional: false },
  { name: 'updated_at', type: 'int64', sort: true, optional: false },
  { name: 'tags', type: 'string[]', facet: true, optional: true },
  { name: 'authors', type: 'string[]', facet: true, optional: true }
];

/**
 * Creates a default configuration object
 * @param ghostUrl The URL of the Ghost instance
 * @param ghostKey The Ghost Content API key
 * @param typesenseHost The Typesense host
 * @param typesenseApiKey The Typesense API key
 * @param collectionName The name of the collection (defaults to 'posts')
 * @returns A default configuration object
 */
export function createDefaultConfig(
  ghostUrl: string,
  ghostKey: string,
  typesenseHost: string,
  typesenseApiKey: string,
  collectionName = 'posts'
): Config {
  // Clean the Typesense host URL
  const cleanedHost = cleanUrl(typesenseHost);
  
  return {
    ghost: {
      url: ghostUrl,
      key: ghostKey,
      version: 'v5.0'
    },
    typesense: {
      nodes: [
        {
          host: cleanedHost,
          port: 443,
          protocol: 'https'
        }
      ],
      apiKey: typesenseApiKey
    },
    collection: {
      name: collectionName,
      fields: DEFAULT_COLLECTION_FIELDS
    }
  };
} 