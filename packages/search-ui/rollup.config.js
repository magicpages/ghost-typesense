import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

// Read CSS file directly
const css = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

export default {
  treeshake: {
    preset: 'recommended',
    moduleSideEffects: true,
    propertyReadSideEffects: true
  },
  input: 'src/search.js',
  output: {
    file: 'dist/search.min.js',
    format: 'iife',
    name: 'MagicPagesSearch',
    inlineDynamicImports: true,
    generatedCode: {
      preset: 'es2015',
      constBindings: true
    },
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
      ecma: 2020,
      module: true,
      format: {
        comments: false
      },
      compress: {
        passes: 3,
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
        unsafe: true,
        unsafe_math: true,
        toplevel: true
      },
      mangle: {
        toplevel: true,
        properties: {
          regex: /^_/
        }
      }
    }),
    visualizer({
      filename: 'stats.html',
      open: true
    })
  ]
};