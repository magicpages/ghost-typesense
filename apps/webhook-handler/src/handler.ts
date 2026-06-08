import { Handler } from '@netlify/functions';
import { z } from 'zod';
import { createDefaultConfig } from '@magicpages/ghost-typesense-config';
import { GhostTypesenseManager } from '@magicpages/ghost-typesense-core';

// Validate environment variables
const EnvSchema = z.object({
  GHOST_URL: z.string().url(),
  GHOST_CONTENT_API_KEY: z.string().min(1),
  TYPESENSE_HOST: z.string().min(1),
  TYPESENSE_API_KEY: z.string().min(1),
  COLLECTION_NAME: z.string().min(1).default('posts'),
  WEBHOOK_SECRET: z.string().min(1),
  // Opt-in: set to "true" to index members-only / paid posts as redacted
  // documents. Defaults off, so only public posts are indexed.
  INDEX_GATED_CONTENT: z.string().optional()
});

// Ghost webhook payload schema
const WebhookSchema = z.object({
  post: z.object({
    current: z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      url: z.string().url(),
      html: z.string(),
      status: z.string(),
      visibility: z.string(),
      updated_at: z.string(),
      published_at: z.string().nullable(),
      excerpt: z.string().nullable(),
      custom_excerpt: z.string().nullable().optional(),
      feature_image: z.string().nullable().optional(),
      tags: z.array(z.object({
        name: z.string()
      })).optional(),
      authors: z.array(z.object({
        name: z.string()
      })).optional()
    }).optional(),
    previous: z.object({
      updated_at: z.string(),
      html: z.string().optional(),
      plaintext: z.string().optional()
    }).optional()
  })
});

const handler: Handler = async (event) => {
  try {
    // Log request info
    console.log('\n🔔 Incoming webhook request');
    console.log('📝 Method:', event.httpMethod);
    
    // Validate environment variables
    const env = EnvSchema.parse(process.env);
    console.log('✅ Environment loaded successfully');

    // Validate webhook secret
    const secret = event.queryStringParameters?.secret;
    if (!secret) {
      console.log('❌ No secret provided in request');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing webhook secret' })
      };
    }
    
    if (secret !== env.WEBHOOK_SECRET) {
      console.log('🚫 Invalid secret provided');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid webhook secret' })
      };
    }

    console.log('🔐 Webhook secret validated');

    // Create configuration
    const config = createDefaultConfig(
      env.GHOST_URL,
      env.GHOST_CONTENT_API_KEY,
      env.TYPESENSE_HOST,
      env.TYPESENSE_API_KEY,
      env.COLLECTION_NAME
    );
    // Opt-in: index members-only / paid posts as redacted documents.
    const indexGatedContent = env.INDEX_GATED_CONTENT === 'true';
    config.collection.indexGatedContent = indexGatedContent;
    console.log('⚙️  Configuration loaded');

    // Initialize manager
    const manager = new GhostTypesenseManager(config);
    console.log('🔄 Typesense manager initialized');

    // Only process POST requests
    if (event.httpMethod !== 'POST') {
      console.log('⚠️  Invalid HTTP method:', event.httpMethod);
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // Parse and validate webhook payload
    if (!event.body) {
      console.log('❌ No request body provided');
      throw new Error('No request body');
    }

    const webhook = WebhookSchema.parse(JSON.parse(event.body));
    const { post } = webhook;
    console.log('📦 Webhook payload validated');

    // Handle different webhook events based on post status changes
    if (post.current) {
      const { id, status, visibility, title } = post.current;
      console.log(`📄 Processing post: "${title}" (${id})`);
      
      // Index public posts always; index gated posts only when opted in (core
      // redacts them). indexPost itself removes a gated post when the flag is
      // off, so anything published is safe to route through it here.
      const indexable = status === 'published' && (visibility === 'public' || indexGatedContent);

      if (indexable) {
        console.log('📝 Indexing published post');
        await manager.indexPost(id);
        console.log('✨ Post indexed successfully');
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Post indexed in Typesense' })
        };
      } else {
        console.log('🗑️  Removing unpublished/private post');
        await manager.deletePost(id);
        console.log('✨ Post removed successfully');
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Post removed from Typesense' })
        };
      }
    }

    console.log('ℹ️  No action required');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No action required' })
    };
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (error as Error).message })
    };
  }
};

export { handler }; 