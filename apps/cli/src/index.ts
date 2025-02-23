#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { validateConfig } from '@magicpages/ghost-typesense-config';
import { GhostTypesenseManager } from '@magicpages/ghost-typesense-core';

const program = new Command();

// Import version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8')
);

program
  .name('ghost-typesense')
  .description('CLI tool for managing Ghost content in Typesense')
  .version(version, '-V, --version', 'Output the version number')
  .option('-v', 'Output the version number', () => {
    console.log(version);
    process.exit(0);
  });

program
  .command('init')
  .description('Initialize Typesense collection with schema from config')
  .requiredOption('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    try {
      const spinner = ora('Reading configuration...').start();
      const configPath = resolve(process.cwd(), options.config);
      const configContent = readFileSync(configPath, 'utf-8');
      const config = validateConfig(JSON.parse(configContent));

      spinner.text = 'Initializing Typesense collection...';
      const manager = new GhostTypesenseManager(config);
      await manager.initializeCollection();

      spinner.succeed('Collection initialized successfully');
    } catch (error) {
      ora().fail(chalk.red(`Failed to initialize collection: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync all Ghost posts to Typesense')
  .requiredOption('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    try {
      const spinner = ora('Reading configuration...').start();
      const configPath = resolve(process.cwd(), options.config);
      const configContent = readFileSync(configPath, 'utf-8');
      const config = validateConfig(JSON.parse(configContent));

      spinner.text = 'Syncing posts to Typesense...';
      const manager = new GhostTypesenseManager(config);
      await manager.indexAllPosts();

      spinner.succeed('Posts synced successfully');
    } catch (error) {
      ora().fail(chalk.red(`Failed to sync posts: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('clear')
  .description('Clear all documents from Typesense collection')
  .requiredOption('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    try {
      const spinner = ora('Reading configuration...').start();
      const configPath = resolve(process.cwd(), options.config);
      const configContent = readFileSync(configPath, 'utf-8');
      const config = validateConfig(JSON.parse(configContent));

      spinner.text = 'Clearing collection...';
      const manager = new GhostTypesenseManager(config);
      await manager.clearCollection();

      spinner.succeed('Collection cleared successfully');
    } catch (error) {
      ora().fail(chalk.red(`Failed to clear collection: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program.parse(); 