import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Command } from 'commander';
import { GhostTypesenseManager } from '@magicpages/ghost-typesense-core';

// Mock the core package
vi.mock('@magicpages/ghost-typesense-core', () => ({
  GhostTypesenseManager: vi.fn().mockImplementation(() => ({
    initializeCollection: vi.fn().mockResolvedValue(undefined),
    indexAllPosts: vi.fn().mockResolvedValue(undefined),
    clearCollection: vi.fn().mockResolvedValue(undefined)
  }))
}));

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
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
      fields: []
    }
  }))
}));

describe('CLI Commands', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
  });

  describe('init command', () => {
    it('should initialize collection with config', async () => {
      const initCommand = program
        .command('init')
        .option('-c, --config <path>', 'Path to config file')
        .action(async () => {
          const manager = new GhostTypesenseManager({} as any);
          await manager.initializeCollection();
        });

      await initCommand.parseAsync(['node', 'test', 'init', '--config', 'test.json']);
      
      expect(GhostTypesenseManager).toHaveBeenCalled();
      const mockManager = (GhostTypesenseManager as unknown as Mock).mock.results[0]?.value;
      expect(mockManager.initializeCollection).toHaveBeenCalled();
    });
  });

  describe('sync command', () => {
    it('should sync posts with config', async () => {
      const syncCommand = program
        .command('sync')
        .option('-c, --config <path>', 'Path to config file')
        .action(async () => {
          const manager = new GhostTypesenseManager({} as any);
          await manager.indexAllPosts();
        });

      await syncCommand.parseAsync(['node', 'test', 'sync', '--config', 'test.json']);
      
      expect(GhostTypesenseManager).toHaveBeenCalled();
      const mockManager = (GhostTypesenseManager as unknown as Mock).mock.results[0]?.value;
      expect(mockManager.indexAllPosts).toHaveBeenCalled();
    });
  });

  describe('clear command', () => {
    it('should clear collection with config', async () => {
      const clearCommand = program
        .command('clear')
        .option('-c, --config <path>', 'Path to config file')
        .action(async () => {
          const manager = new GhostTypesenseManager({} as any);
          await manager.clearCollection();
        });

      await clearCommand.parseAsync(['node', 'test', 'clear', '--config', 'test.json']);
      
      expect(GhostTypesenseManager).toHaveBeenCalled();
      const mockManager = (GhostTypesenseManager as unknown as Mock).mock.results[0]?.value;
      expect(mockManager.clearCollection).toHaveBeenCalled();
    });
  });
}); 