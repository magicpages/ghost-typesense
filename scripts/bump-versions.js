#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = resolve(__dirname, '..');
const packages = [
  'packages/config/package.json',
  'packages/core/package.json',
  'packages/search-ui/package.json',
  'apps/cli/package.json',
  'apps/webhook-handler/package.json',
  'package.json'
];

// Read current version from root package.json
const rootPackage = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
const currentVersion = rootPackage.version;
const [currentMajor, currentMinor, currentPatch] = currentVersion.split('.').map(Number);

async function getNewVersion() {
  const { bumpType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'bumpType',
      message: `Current version is ${currentVersion}. What kind of bump would you like?`,
      choices: [
        { name: `Patch (${currentMajor}.${currentMinor}.${currentPatch + 1})`, value: 'patch' },
        { name: `Minor (${currentMajor}.${currentMinor + 1}.0)`, value: 'minor' },
        { name: `Major (${currentMajor + 1}.0.0)`, value: 'major' },
        { name: 'Custom version', value: 'custom' }
      ]
    }
  ]);

  if (bumpType === 'custom') {
    const { version } = await inquirer.prompt([
      {
        type: 'input',
        name: 'version',
        message: 'Enter the new version:',
        validate: (input) => {
          if (/^\d+\.\d+\.\d+$/.test(input)) {
            return true;
          }
          return 'Please enter a valid semver version (e.g., 1.2.3)';
        }
      }
    ]);
    return version;
  }

  switch (bumpType) {
    case 'patch':
      return `${currentMajor}.${currentMinor}.${currentPatch + 1}`;
    case 'minor':
      return `${currentMajor}.${currentMinor + 1}.0`;
    case 'major':
      return `${currentMajor + 1}.0.0`;
  }
}

const newVersion = await getNewVersion();
console.log(`\nBumping version from ${currentVersion} to ${newVersion}`);

// Update all package versions and their @magicpages dependencies
for (const pkg of packages) {
  const packagePath = resolve(rootDir, pkg);
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));

  // Update package version
  packageJson.version = newVersion;

  // Update @magicpages dependencies
  for (const depType of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (!packageJson[depType]) continue;

    for (const [dep, version] of Object.entries(packageJson[depType])) {
      if (dep.startsWith('@magicpages/')) {
        packageJson[depType][dep] = `^${newVersion}`;
      }
    }
  }

  // Write back to file
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`Updated ${pkg}`);
}

console.log('\nDone! Now run:');
console.log('npm run build');
console.log('cd packages/config && npm publish');
console.log('cd ../core && npm publish');
console.log('cd ../search-ui && npm publish');
console.log('cd ../../apps/cli && npm publish');
console.log('cd ../webhook-handler && npm publish');
