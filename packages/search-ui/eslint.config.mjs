import globals from 'globals';

import shared from '../../eslint.config.mjs';

export default [
  ...shared,
  {
    // The widget is browser code: a Web Component in a shadow root, driving the
    // DOM and the Typesense client.
    files: ['**/*.js'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      // `case` blocks here declare their own consts, which reads better than
      // hoisting them above a switch only one arm of it belongs to.
      'no-case-declarations': 'off'
    }
  }
];
