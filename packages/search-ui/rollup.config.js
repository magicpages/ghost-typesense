import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';

// Read each layout's CSS so it can be inlined into its own bundle. The core
// (modal) CSS is the shared base in src/styles.css; each alternative layout
// ships ONLY its own CSS in its own chunk, so a site that uses the default
// modal layout never downloads palette/discovery code or styles.
const coreCss = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
const readCss = (p) => (fs.existsSync(path.resolve(p)) ? fs.readFileSync(path.resolve(p), 'utf8') : '');
const paletteCss = readCss('src/layouts/palette.css');
const discoveryCss = readCss('src/layouts/discovery.css');

const plugins = () => [
  replace({
    preventAssignment: true,
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({ NODE_ENV: 'production' })
  }),
  resolve({ browser: true, preferBuiltins: false }),
  commonjs({ include: /node_modules/, transformMixedEsModules: true }),
  terser({
    ecma: 2020,
    module: true,
    format: { comments: false },
    compress: {
      passes: 3,
      drop_console: true,
      drop_debugger: true,
      pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
      unsafe: true,
      unsafe_math: true,
      toplevel: true
    },
    mangle: { toplevel: true, properties: { regex: /^_/ } }
  })
];

const treeshake = { preset: 'recommended', moduleSideEffects: true, propertyReadSideEffects: true };
const generatedCode = { preset: 'es2015', constBindings: true };

// Every bundle injects its inlined CSS via `intro` (NOT `banner`). `intro` is
// emitted INSIDE the IIFE wrapper, so the CSS constant stays function-scoped.
// With `banner` it landed at global scope, where terser's toplevel mangle
// renamed it to `const t` — a global lexical that throws "Identifier 't' has
// already been declared" whenever another page script defines a global `t`,
// aborting the whole bundle before it can run.
export default [
  // Core bundle: widget engine + the default inline modal layout. This is the
  // single classic <script> every install loads today — unchanged contract.
  {
    treeshake,
    input: 'src/search.js',
    output: {
      file: 'dist/search.min.js',
      format: 'iife',
      name: 'MagicPagesSearch',
      inlineDynamicImports: true,
      generatedCode,
      intro: `const BUNDLED_CSS = ${JSON.stringify(coreCss)};`
    },
    plugins: plugins()
  },
  // Palette layout chunk — loaded on demand only when uiStyle === 'palette'.
  // Registers itself onto window via the entry's registration call and carries
  // its own CSS.
  {
    treeshake,
    input: 'src/layouts/palette.entry.js',
    output: {
      file: 'dist/palette.min.js',
      format: 'iife',
      name: 'MagicPagesSearchPalette',
      inlineDynamicImports: true,
      generatedCode,
      intro: `const LAYOUT_CSS = ${JSON.stringify(paletteCss)};`
    },
    plugins: plugins()
  },
  // Discovery layout chunk — loaded on demand only when uiStyle === 'discovery'.
  {
    treeshake,
    input: 'src/layouts/discovery.entry.js',
    output: {
      file: 'dist/discovery.min.js',
      format: 'iife',
      name: 'MagicPagesSearchDiscovery',
      inlineDynamicImports: true,
      generatedCode,
      intro: `const LAYOUT_CSS = ${JSON.stringify(discoveryCss)};`
    },
    plugins: plugins()
  }
];
