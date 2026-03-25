// content.js — Applies CSS/DOM ops received from the background service worker
//
// Message protocol:
// { type: 'apply', ops: [
//     { kind: 'css', selector: 'body', styles: { color: '#fff' } },
//     { kind: 'dom', selector: '.ad', action: 'remove', html: '' },
//     { kind: 'dom', selector: '#root', action: 'append', html: '<p>hi</p>' },
//     { kind: 'dom', selector: 'h1',   action: 'replace', html: '<h1>New</h1>' }
// ]}

// Track injected <style> elements so we can update rather than duplicate
const injectedStyles = new Map();  // selector → <style> element

function applyCssOp(op) {
  const { selector, styles } = op;
  if (!selector || !styles) return;

  // Build CSS text
  const props = Object.entries(styles)
    .map(([k, v]) => `${k}: ${v} !important`)
    .join('; ');
  const rule = `${selector} { ${props}; }`;

  // Reuse or create <style> tag per selector
  let styleEl = injectedStyles.get(selector);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.dataset.spawnkit = selector;
    document.head.appendChild(styleEl);
    injectedStyles.set(selector, styleEl);
  }
  styleEl.textContent = rule;
}

function applyDomOp(op) {
  const { selector, action, html } = op;
  if (!selector || !action) return;

  const targets = document.querySelectorAll(selector);
  if (targets.length === 0) return;

  for (const el of targets) {
    switch (action) {
      case 'remove':
        el.remove();
        break;
      case 'append':
        if (html) el.insertAdjacentHTML('beforeend', html);
        break;
      case 'replace':
        if (html) el.outerHTML = html;
        break;
    }
  }
}

function applyOps(ops) {
  for (const op of ops) {
    try {
      if (op.kind === 'css') applyCssOp(op);
      else if (op.kind === 'dom') applyDomOp(op);
    } catch (err) {
      console.warn('[SpawnKit] Failed to apply op:', op, err);
    }
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'apply' && Array.isArray(msg.ops)) {
    applyOps(msg.ops);
    sendResponse({ ok: true, applied: msg.ops.length });
  }
});
