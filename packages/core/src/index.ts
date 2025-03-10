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
      connectionTimeoutSeconds: config.typesense.connectionTimeoutSeconds,
      retryIntervalSeconds: config.typesense.retryIntervalSeconds,
      numRetries: 3
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
    this.config.collection.fields.forEach((field) => {
      const value = post[field.name as keyof GhostPost];
      if (!transformed[field.name] && value !== undefined && value !== null) {
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

    const response = await posts.fetch();

    if (!response.success) {
      throw new Error('Failed to fetch posts from Ghost');
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

    try {
      const collection = this.typesense.collections(this.collectionName);

      // Use upsert for each document instead of bulk import
      const results = await Promise.all(
        documents.map(doc =>
          collection.documents().upsert(doc)
            .then(() => ({ success: true, id: doc.id }))
            .catch(error => ({ success: false, id: doc.id, error: error.message }))
        )
      );

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log(`Indexing complete: ${succeeded} succeeded, ${failed} failed`);
      if (failed > 0) {
        console.log('Failed documents:', results.filter(r => !r.success));
      }
    } catch (error) {
      console.error('Indexing error:', error);
      throw error;
    }
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