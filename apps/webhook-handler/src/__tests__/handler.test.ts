import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { HandlerEvent, HandlerResponse } from '@netlify/functions';
import { handler } from '../handler';
import { GhostTypesenseManager } from '@magicpages/ghost-typesense-core';

// Mock environment variables
const mockEnv = {
  GHOST_URL: 'https://test.com',
  GHOST_CONTENT_API_KEY: 'test-key',
  TYPESENSE_HOST: 'localhost',
  TYPESENSE_API_KEY: 'test-key',
  COLLECTION_NAME: 'test-collection',
  WEBHOOK_SECRET: 'test-secret'
};

Object.entries(mockEnv).forEach(([key, value]) => {
  vi.stubEnv(key, value);
});

// Mock the core package
vi.mock('@magicpages/ghost-typesense-core', () => {
  const indexPost = vi.fn().mockResolvedValue(undefined);
  const deletePost = vi.fn().mockResolvedValue(undefined);
  return {
    GhostTypesenseManager: vi.fn().mockImplementation(() => ({
      indexPost,
      deletePost
    }))
  };
});

describe('Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createEvent = (overrides: Partial<HandlerEvent> = {}): HandlerEvent => ({
    httpMethod: 'POST',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: {},
    multiValueQueryStringParameters: {},
    path: '/',
    body: null,
    rawUrl: '',
    rawQuery: '',
    isBase64Encoded: false,
    ...overrides
  });

  const parseResponse = (response: HandlerResponse | void): HandlerResponse => {
    if (!response) {
      throw new Error('Handler returned void');
    }
    return {
      ...response,
      body: response.body || ''
    };
  };

  const parseResponseBody = <T>(response: HandlerResponse): T => {
    if (!response.body) {
      throw new Error('Response body is empty');
    }
    return JSON.parse(response.body) as T;
  };

  const mockContext = {
    awsRequestId: '123',
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'test',
    functionVersion: '1',
    invokedFunctionArn: 'test',
    memoryLimitInMB: '128',
    logGroupName: 'test',
    logStreamName: 'test',
    identity: undefined,
    clientContext: undefined,
    getRemainingTimeInMillis: () => 1000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };

  it('should return 401 if no secret provided', async () => {
    const event = createEvent();
    const response = parseResponse(await handler(event, mockContext));

    expect(response.statusCode, 'Status code').toBe(401);
    expect(parseResponseBody<{ error: string }>(response), 'Response body').toStrictEqual({ error: 'Missing webhook secret' });
  });

  it('should return 401 if invalid secret provided', async () => {
    const event = createEvent({
      queryStringParameters: { secret: 'wrong-secret' }
    });

    const response = parseResponse(await handler(event, mockContext));

    expect(response.statusCode, 'Status code').toBe(401);
    expect(parseResponseBody<{ error: string }>(response), 'Response body').toStrictEqual({ error: 'Invalid webhook secret' });
  });

  it('should return 405 for non-POST requests', async () => {
    const event = createEvent({
      httpMethod: 'GET',
      queryStringParameters: { secret: 'test-secret' }
    });

    const response = parseResponse(await handler(event, mockContext));

    expect(response.statusCode, 'Status code').toBe(405);
    expect(parseResponseBody<{ error: string }>(response), 'Response body').toStrictEqual({ error: 'Method not allowed' });
  });

  it('should index post when published', async () => {
    const event = createEvent({
      queryStringParameters: { secret: 'test-secret' },
      body: JSON.stringify({
        post: {
          current: {
            id: 'test-post-1',
            title: 'Test Post',
            slug: 'test-post-1',
            html: '<p>Test content</p>',
            status: 'published',
            visibility: 'public',
            updated_at: '2024-02-09T12:00:00.000Z',
            published_at: '2024-02-09T12:00:00.000Z',
            url: 'https://test.com/test-post-1',
            excerpt: 'Test excerpt',
            custom_excerpt: 'Test excerpt',
            feature_image: null
          }
        }
      })
    });

    const response = parseResponse(await handler(event, mockContext));

    expect(GhostTypesenseManager, 'Manager constructor').toHaveBeenCalledTimes(1);
    const mockManager = (GhostTypesenseManager as unknown as Mock).mock.results[0]?.value;
    expect(mockManager.indexPost, 'Index post').toHaveBeenCalledWith('test-post-1');
    expect(response.statusCode, 'Status code').toBe(200);
    expect(parseResponseBody<{ message: string }>(response), 'Response body').toStrictEqual({ message: 'Post indexed in Typesense' });
  });

  it('should delete post when unpublished', async () => {
    const event = createEvent({
      queryStringParameters: { secret: 'test-secret' },
      body: JSON.stringify({
        post: {
          current: {
            id: 'test-post-1',
            title: 'Test Post',
            slug: 'test-post-1',
            html: '<p>Test content</p>',
            status: 'draft',
            visibility: 'public',
            updated_at: '2024-02-09T12:00:00.000Z',
            published_at: '2024-02-09T12:00:00.000Z',
            url: 'https://test.com/test-post-1',
            excerpt: 'Test excerpt',
            custom_excerpt: 'Test excerpt',
            feature_image: null
          }
        }
      })
    });

    const response = parseResponse(await handler(event, mockContext));

    expect(GhostTypesenseManager, 'Manager constructor').toHaveBeenCalledTimes(1);
    const mockManager = (GhostTypesenseManager as unknown as Mock).mock.results[0]?.value;
    expect(mockManager.deletePost, 'Delete post').toHaveBeenCalledWith('test-post-1');
    expect(response.statusCode, 'Status code').toBe(200);
    expect(parseResponseBody<{ message: string }>(response), 'Response body').toStrictEqual({ message: 'Post removed from Typesense' });
  });
}); 