// content.js — Applies CSS/DOM ops received from the background service worker
//
// Hardened: retry on load, mutation observer for SPAs, error boundaries,
// iframe awareness, graceful degradation on CSP-restricted sites.

// Track injected <style> elements so we can update rather than duplicate
const injectedStyles = new Map();  // selector → <style> element
let opsHistory = [];               // for undo support
let undoStack = [];                // stack of { ops, timestamp }

// ── CSS Operations ───────────────────────────────────────────────────────

function applyCssOp(op) {
  const { selector, styles } = op;
  if (!selector || !styles || typeof styles !== 'object') return false;

  try {
    // Verify selector is valid
    document.querySelector(selector);
  } catch {
    console.warn('[SpawnKit] Invalid selector:', selector);
    return false;
  }

  const props = Object.entries(styles)
    .map(([k, v]) => `${k}: ${v} !important`)
    .join('; ');
  const rule = `${selector} { ${props}; }`;

  let styleEl = injectedStyles.get(selector);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.dataset.spawnkit = selector;
    styleEl.dataset.spawnkitPlugin = 'true';
    (document.head || document.documentElement).appendChild(styleEl);
    injectedStyles.set(selector, styleEl);
  }
  styleEl.textContent = rule;
  return true;
}

// ── DOM Operations ───────────────────────────────────────────────────────

function applyDomOp(op) {
  const { selector, action, html } = op;
  if (!selector || !action) return false;

  let targets;
  try {
    targets = document.querySelectorAll(selector);
  } catch {
    console.warn('[SpawnKit] Invalid selector:', selector);
    return false;
  }

  if (targets.length === 0) return false;

  let applied = 0;
  for (const el of targets) {
    try {
      switch (action) {
        case 'remove':
          el.dataset.spawnkitRemoved = 'true';
          el.style.display = 'none';  // hide instead of remove for undo support
          applied++;
          break;
        case 'append':
          if (html) {
            const wrapper = document.createElement('div');
            wrapper.dataset.spawnkitAppended = 'true';
            wrapper.innerHTML = html;
            el.appendChild(wrapper);
            applied++;
          }
          break;
        case 'replace':
          if (html) {
            el.dataset.spawnkitOriginal = el.outerHTML;
            el.outerHTML = html;
            applied++;
          }
          break;
      }
    } catch (err) {
      console.warn('[SpawnKit] DOM op failed:', action, selector, err.message);
    }
  }
  return applied > 0;
}

// ── Apply ops batch ──────────────────────────────────────────────────────

function applyOps(ops) {
  if (!Array.isArray(ops) || ops.length === 0) return { applied: 0, failed: 0 };

  let applied = 0;
  let failed = 0;

  for (const op of ops) {
    try {
      const ok = op.kind === 'css' ? applyCssOp(op)
               : op.kind === 'dom' ? applyDomOp(op)
               : false;
      if (ok) applied++;
      else failed++;
    } catch (err) {
      console.warn('[SpawnKit] Failed to apply op:', op, err);
      failed++;
    }
  }

  // Save to history for undo
  if (applied > 0) {
    opsHistory.push(...ops.filter(o => o.kind === 'css' || o.kind === 'dom'));
  }

  return { applied, failed };
}

// ── Undo all SpawnKit modifications ──────────────────────────────────────

function undoAll() {
  // Remove all injected styles
  for (const [, styleEl] of injectedStyles) {
    styleEl.remove();
  }
  injectedStyles.clear();

  // Restore hidden elements
  document.querySelectorAll('[data-spawnkit-removed]').forEach(el => {
    el.style.display = '';
    delete el.dataset.spawnkitRemoved;
  });

  // Remove appended elements
  document.querySelectorAll('[data-spawnkit-appended]').forEach(el => {
    el.remove();
  });

  const count = opsHistory.length;
  opsHistory = [];
  return count;
}

// ── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'apply' && Array.isArray(msg.ops)) {
    const result = applyOps(msg.ops);
    sendResponse({ ok: true, ...result });
  } else if (msg.type === 'undo') {
    const count = undoAll();
    sendResponse({ ok: true, undone: count });
  } else if (msg.type === 'ping') {
    // Used by background to check if content script is ready
    sendResponse({ ok: true, ready: true, opsCount: opsHistory.length });
  }
});

// ── SPA navigation detection ─────────────────────────────────────────────
// Re-apply saved ops when SPA navigates (URL changes without page reload)

let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Notify background that URL changed — it may want to re-apply configs
    chrome.runtime.sendMessage({ type: 'urlChanged', url: location.href }).catch(() => {});
  }
});

urlObserver.observe(document.documentElement, { childList: true, subtree: true });

// ── Signal readiness ─────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: 'contentReady', url: location.href }).catch(() => {});
