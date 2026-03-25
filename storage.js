// storage.js — Persistence helpers for per-origin configs
//
// Config shape per origin:
// {
//   ops: [ { kind, selector, ... } ],
//   updatedAt: ISO timestamp
// }

/** Normalize an origin into a safe storage key. */
function getSiteKey(origin) {
  // chrome.storage keys must be strings; strip protocol slashes for compactness
  return 'sk_' + origin.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/** Merge new ops into existing config using dedup/coalesce heuristics. */
function mergeOps(existing, incoming) {
  const merged = [...(existing || [])];

  for (const op of incoming) {
    if (op.kind === 'css') {
      // Coalesce: find existing CSS op with same selector, merge styles
      const idx = merged.findIndex(m => m.kind === 'css' && m.selector === op.selector);
      if (idx !== -1) {
        merged[idx] = { ...merged[idx], styles: { ...merged[idx].styles, ...op.styles } };
      } else {
        merged.push(op);
      }
    } else if (op.kind === 'dom') {
      // Dedupe by selector + action (keep newest)
      const idx = merged.findIndex(m => m.kind === 'dom' && m.selector === op.selector && m.action === op.action);
      if (idx !== -1) {
        merged[idx] = op;
      } else {
        merged.push(op);
      }
    } else {
      merged.push(op);
    }
  }

  return merged;
}

/** Save (merge) ops for an origin. */
async function saveConfig(origin, ops) {
  const key = getSiteKey(origin);
  const result = await chrome.storage.sync.get(key);
  const existing = result[key] || { ops: [], updatedAt: null };

  const mergedOps = mergeOps(existing.ops, ops);
  const config = { ops: mergedOps, updatedAt: new Date().toISOString() };

  await chrome.storage.sync.set({ [key]: config });
  return config;
}

/** Load config for an origin. Returns null if none. */
async function loadConfig(origin) {
  const key = getSiteKey(origin);
  const result = await chrome.storage.sync.get(key);
  return result[key] || null;
}

/** Erase config for an origin. */
async function eraseConfig(origin) {
  const key = getSiteKey(origin);
  await chrome.storage.sync.remove(key);
}

/** Export all configs as a plain object. */
async function exportConfig() {
  const all = await chrome.storage.sync.get(null);
  // Filter to only our keys
  const exported = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('sk_')) {
      exported[k] = v;
    }
  }
  return exported;
}

/** Import configs from a plain object (merges with existing by timestamp). */
async function importConfig(data) {
  const existing = await chrome.storage.sync.get(null);
  const toSet = {};

  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith('sk_')) continue;
    const current = existing[k];
    if (!current || (v.updatedAt && (!current.updatedAt || v.updatedAt > current.updatedAt))) {
      // Incoming is newer or no existing — use incoming
      toSet[k] = v;
    } else {
      // Existing is newer — merge ops from incoming
      toSet[k] = {
        ops: mergeOps(current.ops, v.ops || []),
        updatedAt: current.updatedAt
      };
    }
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }
  return toSet;
}
