import { TSGhostContentAPI, type Post as GhostPost } from '@ts-ghost/content-api';
import { Client } from 'typesense';
import type { Config } from '@magicpages/ghost-typesense-config';

export interface Post {
  id: string;
  title: string;
  slug: string;
  url: string;
  html?: string;
  plaintext: string;
  excerpt: string;
  feature_image?: string;
  published_at: number;
  updated_at: number;
  'tags.name'?: string[];
  'tags.slug'?: string[];
  authors?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export class GhostTypesenseManager {
  private ghost: TSGhostContentAPI;
  private typesense: Client;
  private config: Config;
  private collectionName: string;

  constructor(config: Config) {
    this.config = config;
    this.collectionName = config.collection.name;
    this.ghost = new TSGhostContentAPI(
      config.ghost.url,
      config.ghost.key,
      'v5.0' as const
    );

    this.typesense = new Client({
      nodes: config.typesense.nodes,
      apiKey: config.typesense.apiKey,
      connectionTimeoutSeconds: config.typesense.connectionTimeoutSeconds || 3600, // 60 minutes for bulk operations
      retryIntervalSeconds: config.typesense.retryIntervalSeconds || 2,
      numRetries: 5
    });
  }

  /**
   * Initialize the Typesense collection with the specified schema
   */
  async initializeCollection(): Promise<void> {
    const collections = await this.typesense.collections().retrieve();
    const existingCollection = collections.find((c: { name: string }) => c.name === this.collectionName);

    if (existingCollection) {
      const collection = this.typesense.collections(this.collectionName);
      await collection.delete();
    }

    // Add support for nested fields
    const schema = {
      name: this.collectionName,
      fields: this.config.collection.fields.map((field) => ({
        name: field.name,
        type: field.type,
        facet: field.facet,
        index: field.index,
        optional: field.optional,
        sort: field.sort
      })),
      enable_nested_fields: true // Enable nested fields support
    };

    await this.typesense.collections().create(schema);
  }

  /**
   * Transform a Ghost post into the format expected by Typesense
   */
  private transformPost(post: GhostPost): Post {
    console.log('Transforming post:', post.id, post.title);

    // Ensure we have plaintext content
    let plaintext = post.plaintext || '';

    // Always try to enhance/improve plaintext extraction from HTML 
    // even if plaintext already exists
    if (post.html) {
      // Use a more comprehensive approach to extract text including from links and special formatting
      // First remove script and style tags
      let cleanHtml = post.html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

      // Extract text from anchor tags to preserve linked text
      cleanHtml = cleanHtml.replace(/<a[^>]*>([^<]*)<\/a>/gi, ' $1 ');

      // Extract text from other formatting tags (strong, em, b, i, etc.)
      cleanHtml = cleanHtml.replace(/<(strong|b|em|i|mark|span)[^>]*>([^<]*)<\/(strong|b|em|i|mark|span)>/gi, ' $2 ');

      // Remove all remaining HTML tags
      cleanHtml = cleanHtml.replace(/<[^>]*>/g, ' ');

      // Handle common HTML entities
      cleanHtml = cleanHtml
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&[a-z]+;/gi, ' '); // Replace any remaining entities

      // Normalize whitespace and trim
      cleanHtml = cleanHtml.replace(/\s+/g, ' ').trim();

      // If we didn't have plaintext or if our extracted text is more comprehensive, use it
      if (!plaintext || cleanHtml.length > plaintext.length) {
        plaintext = cleanHtml;
      }
    }

    const transformed: Post = {
      id: post.id,
      title: post.title,
      slug: post.slug,
      url: post.url || `${this.config.ghost.url}/${post.slug}/`,
      html: post.html || '',
      plaintext: plaintext,
      excerpt: post.excerpt || '',
      published_at: new Date(post.published_at || Date.now()).getTime(),
      updated_at: new Date(post.updated_at || Date.now()).getTime()
    };

    if (post.feature_image) {
      transformed.feature_image = post.feature_image;
    }

    const tags = post.tags;
    if (tags && Array.isArray(tags) && tags.length > 0) {
      // Use dot notation for nested tag fields
      transformed['tags.name'] = tags.map((tag: { name: string }) => tag.name);
      transformed['tags.slug'] = tags.map((tag: { slug: string }) => tag.slug);
      
      // Add the standard tags field that Typesense expects as string[]
      transformed.tags = tags.map((tag: { name: string }) => tag.name);
    }

    const authors = post.authors;
    if (authors && Array.isArray(authors) && authors.length > 0) {
      transformed.authors = authors.map((author: { name: string }) => author.name);
    }

    // Add any additional fields specified in the config
    // Only add fields that haven't already been transformed to avoid overriding custom transformations
    this.config.collection.fields.forEach((field) => {
      const value = post[field.name as keyof GhostPost];
      if (!(field.name in transformed) && value !== undefined && value !== null) {
        transformed[field.name] = value;
      }
    });

    console.log('Transformed document:', transformed);
    return transformed;
  }

  /**
   * Fetch all posts from Ghost and index them in Typesense
   */
  async indexAllPosts(): Promise<void> {
    let allPosts: GhostPost[] = [];

    const posts = this.ghost.posts
      .browse({
        limit: 15 // Default limit in Ghost
      })
      .include({ tags: true, authors: true });

    let response;
    try {
      response = await posts.fetch();
    } catch (fetchError: any) {
      // Network or connection error
      if (fetchError.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Ghost at ${this.config.ghost.url} - is Ghost running?`);
      }
      throw new Error(`Failed to connect to Ghost: ${fetchError.message || fetchError}`);
    }
    
    if (!response.success) {
      // API response error (401, 404, etc)
      const errors = response.errors || [];
      const errorMessage = errors.map((e: any) => e.message || e).join(', ');
      
      if (errors.some((e: any) => e.code === 'UNKNOWN_CONTENT_API_KEY')) {
        throw new Error(`Invalid Ghost API key: ${errorMessage}`);
      }
      
      throw new Error(`Ghost API error: ${errorMessage || 'Unknown error'}`);
    }

    allPosts = allPosts.concat(response.data);

    // Get total number of posts and calculate pages
    const total = response.meta.pagination.total;
    const limit = response.meta.pagination.limit as number;
    const totalPages = Math.ceil(total / limit);

    // Fetch remaining pages
    for (let page = 2; page <= totalPages; page++) {
      const pageResponse = await this.ghost.posts
        .browse({
          limit,
          page
        })
        .include({ tags: true, authors: true })
        .fetch();

      if (!pageResponse.success) {
        throw new Error(`Failed to fetch page ${page} from Ghost`);
      }

      allPosts = allPosts.concat(pageResponse.data);
    }

    console.log(`Found ${allPosts.length} posts to index`);
    const documents = allPosts.map((post) => this.transformPost(post));

    // Use batched bulk import for better performance and reliability
    await this.indexDocumentsBatched(documents);
  }

  /**
   * Index documents in batches with retry logic and backpressure handling
   * @private
   */
  private async indexDocumentsBatched(documents: Post[]): Promise<void> {
    const batchSize = this.config.typesense.batchSize || 200;
    const maxConcurrentBatches = this.config.typesense.maxConcurrentBatches || 12;
    
    // Split documents into batches
    const batches: Post[][] = [];
    for (let i = 0; i < documents.length; i += batchSize) {
      batches.push(documents.slice(i, i + batchSize));
    }
    
    console.log(`Processing ${documents.length} documents in ${batches.length} batches (batch size: ${batchSize})`);
    const collection = this.typesense.collections(this.collectionName);
    let totalSucceeded = 0;
    let totalFailed = 0;
    const failedBatches: Array<{ batchIndex: number; documents: Post[]; error: string }> = [];
    
    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
      const batchGroup = batches.slice(i, i + maxConcurrentBatches);
      const batchPromises = batchGroup.map(async (batch, batchIndex) => {
        const actualBatchIndex = i + batchIndex;
        return this.processBatchWithRetry(collection, batch, actualBatchIndex, batches.length);
      });
      
      const results = await Promise.allSettled(batchPromises);
      
      results.forEach((result, batchIndex) => {
        const actualBatchIndex = i + batchIndex;
        if (result.status === 'fulfilled') {
          totalSucceeded += result.value.succeeded;
          totalFailed += result.value.failed;
          if (result.value.error) {
            failedBatches.push({
              batchIndex: actualBatchIndex,
              documents: batchGroup[batchIndex]!,
              error: result.value.error
            });
          }
        } else {
          const batchSize = batchGroup[batchIndex]!.length;
          totalFailed += batchSize;
          failedBatches.push({
            batchIndex: actualBatchIndex,
            documents: batchGroup[batchIndex]!,
            error: result.reason?.message || 'Unknown batch error'
          });
        }
      });
      
      console.log(`Progress: ${Math.min(i + maxConcurrentBatches, batches.length)}/${batches.length} batch groups processed`);
    }
    
    console.log(`Indexing complete: ${totalSucceeded} succeeded, ${totalFailed} failed`);
    
    // Retry failed batches once with smaller batch sizes
    if (failedBatches.length > 0) {
      console.log(`Retrying ${failedBatches.length} failed batches with smaller batch size...`);
      const retryResults = await this.retryFailedBatches(collection, failedBatches);
      totalSucceeded += retryResults.succeeded;
      totalFailed = totalFailed - retryResults.retryAttempted + retryResults.failed;
      
      console.log(`Final result: ${totalSucceeded} succeeded, ${totalFailed} failed`);
    }
    
    if (totalFailed > 0) {
      console.log(`⚠️  ${totalFailed} documents failed to index. Consider running sync again or checking server capacity.`);
    }
  }
  
  /**
   * Process a single batch with retry logic and backpressure handling
   * @private
   */
  private async processBatchWithRetry(
    collection: any, 
    documents: Post[], 
    batchIndex: number, 
    totalBatches: number
  ): Promise<{ succeeded: number; failed: number; error?: string }> {
    const maxRetries = 3;
    let lastError: string = '';
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Processing batch ${batchIndex + 1}/${totalBatches} (${documents.length} docs) - attempt ${attempt}`);
        
        const result = await collection.documents().import(documents, {
          action: 'upsert',
          batch_size: documents.length,
          return_doc: false,
          return_id: false
        });
        
        // Parse bulk import result
        const succeeded = result.filter((r: any) => r.success === true).length;
        const failed = documents.length - succeeded;
        
        if (failed > 0) {
          console.log(`Batch ${batchIndex + 1}: ${succeeded} succeeded, ${failed} failed`);
        }
        
        return { succeeded, failed };
        
      } catch (error: any) {
        lastError = error.message || error;
        
        // Handle HTTP 503 (server overload) with exponential backoff
        if (error.httpStatus === 503 || lastError.includes('503') || lastError.includes('Not Ready')) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
          console.log(`Batch ${batchIndex + 1}: Server overload (503), retrying in ${backoffDelay}ms...`);
          await this.sleep(backoffDelay);
          continue;
        }
        
        // Handle timeout errors
        if (lastError.includes('timeout') || lastError.includes('ECONNABORTED')) {
          const backoffDelay = Math.min(2000 * attempt, 8000); // Max 8s for timeouts
          console.log(`Batch ${batchIndex + 1}: Timeout error, retrying in ${backoffDelay}ms...`);
          await this.sleep(backoffDelay);
          continue;
        }
        
        // For other errors, retry with shorter delay
        if (attempt < maxRetries) {
          const backoffDelay = 1000 * attempt;
          console.log(`Batch ${batchIndex + 1}: Error (${lastError}), retrying in ${backoffDelay}ms...`);
          await this.sleep(backoffDelay);
          continue;
        }
      }
    }
    
    console.error(`Batch ${batchIndex + 1} failed after ${maxRetries} attempts: ${lastError}`);
    return { succeeded: 0, failed: documents.length, error: lastError };
  }
  
  /**
   * Retry failed batches with smaller batch sizes
   * @private
   */
  private async retryFailedBatches(
    collection: any,
    failedBatches: Array<{ batchIndex: number; documents: Post[]; error: string }>
  ): Promise<{ succeeded: number; failed: number; retryAttempted: number }> {
    let succeeded = 0;
    let failed = 0;
    let retryAttempted = 0;
    
    for (const failedBatch of failedBatches) {
      retryAttempted += failedBatch.documents.length;
      
      // Retry with smaller batches (50 docs each)
      const smallBatches: Post[][] = [];
      for (let i = 0; i < failedBatch.documents.length; i += 50) {
        smallBatches.push(failedBatch.documents.slice(i, i + 50));
      }
      
      for (const smallBatch of smallBatches) {
        try {
          const result = await collection.documents().import(smallBatch, {
            action: 'upsert',
            batch_size: smallBatch.length,
            return_doc: false,
            return_id: false
          });
          
          const batchSucceeded = result.filter((r: any) => r.success === true).length;
          succeeded += batchSucceeded;
          failed += smallBatch.length - batchSucceeded;
          
        } catch (error: any) {
          console.error(`Small batch retry failed: ${error.message || error}`);
          failed += smallBatch.length;
        }
        
        // Small delay between retry batches
        await this.sleep(500);
      }
    }
    
    return { succeeded, failed, retryAttempted };
  }
  
  /**
   * Sleep utility for backoff delays
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Index a single post in Typesense
   */
  async indexPost(postId: string): Promise<void> {
    const post = await this.ghost.posts
      .read({
        id: postId
      })
      .include({ tags: true, authors: true })
      .fetch();

    if (!post.success) {
      throw new Error(`Failed to fetch post ${postId} from Ghost`);
    }

    const document = this.transformPost(post.data);
    const collection = this.typesense.collections(this.collectionName);
    await collection.documents().upsert(document);
  }

  /**
   * Delete a post from Typesense
   */
  async deletePost(postId: string): Promise<void> {
    const collection = this.typesense.collections(this.collectionName);
    await collection.documents().delete({ filter_by: `id:${postId}` });
  }

  /**
   * Clear all documents from the collection
   */
  async clearCollection(): Promise<void> {
    const collection = this.typesense.collections(this.collectionName);
    await collection.delete();

    const schema = {
      name: this.collectionName,
      fields: this.config.collection.fields.map((field) => ({
        name: field.name,
        type: field.type,
        facet: field.facet,
        index: field.index,
        optional: field.optional,
        sort: field.sort
      }))
    };

    await this.typesense.collections().create(schema);
  }
} 