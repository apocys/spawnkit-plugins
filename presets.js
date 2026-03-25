// presets.js — Built-in preset library for SpawnKit Plugins
// Each preset is a named set of ops using the standard {kind, selector, styles/action/html} format.

const PRESETS = {
  'dark-mode': {
    name: '🌙 Dark Mode',
    description: 'Convert page to dark theme',
    ops: [
      { kind: 'css', selector: 'html, body', styles: { 'background-color': '#1a1a2e', 'color': '#d4d4d8' } },
      { kind: 'css', selector: 'div, section, main, article, aside, header, footer, nav', styles: { 'background-color': '#1a1a2e' } },
      { kind: 'css', selector: 'a', styles: { 'color': '#818cf8' } },
      { kind: 'css', selector: 'a:visited', styles: { 'color': '#a78bfa' } },
      { kind: 'css', selector: 'h1, h2, h3, h4, h5, h6', styles: { 'color': '#e4e4e7' } },
      { kind: 'css', selector: 'input, textarea, select, button', styles: { 'background-color': '#27272a', 'color': '#d4d4d8', 'border-color': '#3f3f46' } },
      { kind: 'css', selector: 'table, th, td, tr', styles: { 'background-color': '#1a1a2e', 'color': '#d4d4d8', 'border-color': '#3f3f46' } },
      { kind: 'css', selector: 'pre, code', styles: { 'background-color': '#27272a', 'color': '#a5f3fc' } },
      { kind: 'css', selector: 'img', styles: { 'opacity': '0.9' } },
      { kind: 'css', selector: '::placeholder', styles: { 'color': '#71717a' } },
    ],
  },

  'reader-mode': {
    name: '📖 Reader Mode',
    description: 'Clean reading layout',
    ops: [
      { kind: 'css', selector: 'body', styles: { 'max-width': '700px', 'margin': '0 auto', 'padding': '20px 24px', 'font-family': 'Georgia, "Times New Roman", serif', 'font-size': '18px', 'line-height': '1.8', 'color': '#1a1a2e', 'background': '#fefce8' } },
      { kind: 'css', selector: 'nav, .nav, .navbar, .navigation, .sidebar, .side-bar, aside', styles: { 'display': 'none' } },
      { kind: 'css', selector: 'footer, .footer', styles: { 'display': 'none' } },
      { kind: 'css', selector: '.ad, .ads, .advertisement, [class*="ad-banner"]', styles: { 'display': 'none' } },
      { kind: 'css', selector: 'h1', styles: { 'font-size': '2em', 'margin-bottom': '0.5em' } },
      { kind: 'css', selector: 'h2', styles: { 'font-size': '1.5em', 'margin-top': '1.5em' } },
      { kind: 'css', selector: 'p', styles: { 'margin-bottom': '1.2em' } },
      { kind: 'css', selector: 'img', styles: { 'max-width': '100%', 'height': 'auto', 'border-radius': '4px' } },
    ],
  },

  'hide-ads': {
    name: '🚫 Hide Ads',
    description: 'Remove common ad elements',
    ops: [
      { kind: 'css', selector: '.ad, .ads, .advert, .advertisement, .ad-container, .ad-wrapper', styles: { 'display': 'none' } },
      { kind: 'css', selector: '[class*="ad-"], [class*="ad_"], [class*="ads-"], [class*="ads_"]', styles: { 'display': 'none' } },
      { kind: 'css', selector: '[id*="ad-"], [id*="ad_"], [id*="ads-"], [id*="ads_"]', styles: { 'display': 'none' } },
      { kind: 'css', selector: '[class*="banner"], [class*="sponsor"], [class*="promo"]', styles: { 'display': 'none' } },
      { kind: 'css', selector: 'iframe[src*="doubleclick"], iframe[src*="googlesyndication"], iframe[src*="adservice"]', styles: { 'display': 'none' } },
      { kind: 'css', selector: '[aria-label*="advertisement"], [aria-label*="sponsored"]', styles: { 'display': 'none' } },
      { kind: 'css', selector: '.cookie-banner, .cookie-consent, [class*="cookie"], [class*="consent-banner"]', styles: { 'display': 'none' } },
    ],
  },

  'focus-mode': {
    name: '🔍 Focus Mode',
    description: 'Dim distractions, highlight content',
    ops: [
      { kind: 'css', selector: 'nav, .nav, .navbar, .navigation, header, .header', styles: { 'opacity': '0.2', 'transition': 'opacity 0.3s', 'filter': 'blur(1px)' } },
      { kind: 'css', selector: 'nav:hover, .nav:hover, .navbar:hover, header:hover, .header:hover', styles: { 'opacity': '1', 'filter': 'none' } },
      { kind: 'css', selector: 'aside, .sidebar, .side-bar, [class*="sidebar"]', styles: { 'opacity': '0.15', 'transition': 'opacity 0.3s', 'filter': 'blur(2px)' } },
      { kind: 'css', selector: 'aside:hover, .sidebar:hover, [class*="sidebar"]:hover', styles: { 'opacity': '1', 'filter': 'none' } },
      { kind: 'css', selector: 'footer, .footer', styles: { 'opacity': '0.1', 'filter': 'blur(2px)' } },
      { kind: 'css', selector: 'main, article, .content, .main-content, [role="main"], #content', styles: { 'position': 'relative', 'z-index': '10' } },
    ],
  },

  'compact': {
    name: '📏 Compact',
    description: 'Reduce spacing, smaller text',
    ops: [
      { kind: 'css', selector: 'body', styles: { 'font-size': '13px', 'line-height': '1.4' } },
      { kind: 'css', selector: 'h1', styles: { 'font-size': '1.5em', 'margin': '0.3em 0' } },
      { kind: 'css', selector: 'h2', styles: { 'font-size': '1.25em', 'margin': '0.3em 0' } },
      { kind: 'css', selector: 'h3, h4, h5, h6', styles: { 'font-size': '1.1em', 'margin': '0.2em 0' } },
      { kind: 'css', selector: 'p, li, td, th', styles: { 'margin-bottom': '0.3em', 'padding': '1px 2px' } },
      { kind: 'css', selector: 'div, section, article', styles: { 'padding': '4px 8px' } },
      { kind: 'css', selector: '.card, [class*="card"]', styles: { 'padding': '8px', 'margin': '4px' } },
    ],
  },
};

// Export for use in background.js
if (typeof self !== 'undefined') {
  self.PRESETS = PRESETS;
}
