import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';

// Read CSS file directly
const css = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

export default {
  input: 'src/search.js',
  output: {
    file: 'dist/search.min.js',
    format: 'iife',
    name: 'MagicPagesSearch',
    banner: `const BUNDLED_CSS = ${JSON.stringify(css)};`
  },
  plugins: [
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({
        NODE_ENV: 'production'
      })
    }),
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs({
      include: /node_modules/,
      transformMixedEsModules: true
    }),
    terser({
      format: {
        comments: false
      },
      compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn']
      }
    })
  ]
};