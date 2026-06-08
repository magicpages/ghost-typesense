// Entry point for the palette layout chunk (dist/palette.min.js).
//
// This IIFE bundle is loaded on demand by the core when uiStyle === 'palette'.
// It registers the layout factory and exposes a CSS injector so the layout's
// styles ship only with this chunk (never in the core modal-only bundle).
//
// LAYOUT_CSS is injected at build time by rollup (banner) from
// src/layouts/palette.css.
import createPaletteLayout from './palette.js';

/* global LAYOUT_CSS */
function injectStyles(shadowRoot) {
  if (!shadowRoot || shadowRoot.querySelector('style[data-mp-layout="palette"]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-mp-layout', 'palette');
  // eslint-disable-next-line no-undef
  style.textContent = typeof LAYOUT_CSS === 'string' ? LAYOUT_CSS : '';
  shadowRoot.appendChild(style);
}

if (typeof window !== 'undefined' && typeof window.__mpRegisterSearchLayout === 'function') {
  window.__mpRegisterSearchLayout('palette', (ctx) => {
    const layout = createPaletteLayout(ctx);
    layout.injectStyles = injectStyles;
    return layout;
  });
}
