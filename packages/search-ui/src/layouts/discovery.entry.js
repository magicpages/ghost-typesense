// Entry point for the discovery layout chunk (dist/discovery.min.js).
//
// Loaded on demand by the core when uiStyle === 'discovery'. Registers the
// layout factory and injects its CSS, so discovery's code/styles ship only in
// this chunk. LAYOUT_CSS is injected at build time from
// src/layouts/discovery.css.
import createDiscoveryLayout from './discovery.js';

/* global LAYOUT_CSS */
function injectStyles(shadowRoot) {
  if (!shadowRoot || shadowRoot.querySelector('style[data-mp-layout="discovery"]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-mp-layout', 'discovery');
  // eslint-disable-next-line no-undef
  style.textContent = typeof LAYOUT_CSS === 'string' ? LAYOUT_CSS : '';
  shadowRoot.appendChild(style);
}

if (typeof window !== 'undefined' && typeof window.__mpRegisterSearchLayout === 'function') {
  window.__mpRegisterSearchLayout('discovery', (ctx) => {
    const layout = createDiscoveryLayout(ctx);
    layout.injectStyles = injectStyles;
    return layout;
  });
}
