// Shared ESLint configuration for every workspace, in flat config form.
//
// ESLint 10 removed the .eslintrc format this repo used, so the settings that
// lived in .eslintrc.json are expressed here instead: `env` became explicit
// `globals`, "eslint:recommended" became @eslint/js, and each package's
// `extends: ["../../.eslintrc.json"]` became an import of this array.
//
// Packages import it from their own eslint.config.mjs and append what is theirs
// alone (browser globals for the search widget, for instance), which keeps the
// per-package split the .eslintrc files had.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';

// Built output is generated, and worktrees are scratch checkouts of this same
// repo — linting either only produces noise about code nobody edits here.
export const ignores = {
  ignores: ['**/dist/**', '.worktrees/**']
};

export const base = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.node }
  }
};

// TypeScript sources get the parser, the plugin's recommended rules, and the
// project's own overrides. Flat config resolves a rule against the plugins
// registered in the same object, so these cannot live in `base`: that would
// apply them to the plain-JavaScript search widget, where the plugin is not
// registered and every rule name would fail to resolve.
export const typescript = {
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  plugins: { '@typescript-eslint': tsPlugin },
  rules: {
    ...tsPlugin.configs.recommended.rules,
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  }
};

export default [
  ignores,
  js.configs.recommended,
  base,
  typescript,
  // Last, so it can switch off the stylistic rules Prettier owns.
  prettier
];
