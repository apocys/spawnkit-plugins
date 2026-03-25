// background.js — Service worker: message routing, AI endpoint, persistence
//
// Imports storage.js via importScripts (MV3 service workers don't support ES modules).

importScripts('storage.js');

const AI_ENDPOINT = 'http://localhost:18789/ai/css-editor';

// ── AI call with fallback simulation ────────────────────────────────────

async function callAI(prompt, origin) {
  try {
    const resp = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, origin })
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.ops || [];
  } catch (_err) {
    // Simulate a response when the AI endpoint is unreachable
    return simulateOps(prompt);
  }
}

/** Produce a plausible set of ops from the prompt for offline testing. */
function simulateOps(prompt) {
  const lower = prompt.toLowerCase();
  const ops = [];

  if (lower.includes('dark') || lower.includes('background')) {
    ops.push({ kind: 'css', selector: 'body', styles: { background: '#1a1a2e', color: '#e0e0e0' } });
  }
  if (lower.includes('hide') || lower.includes('remove')) {
    const match = prompt.match(/hide\s+(.+)/i) || prompt.match(/remove\s+(.+)/i);
    const selector = match ? match[1].trim() : '.ad-banner';
    ops.push({ kind: 'dom', selector, action: 'remove', html: '' });
  }
  if (lower.includes('font')) {
    ops.push({ kind: 'css', selector: 'body', styles: { 'font-family': 'Georgia, serif' } });
  }
  if (lower.includes('border')) {
    ops.push({ kind: 'css', selector: '*', styles: { 'outline': '1px solid rgba(233,69,96,0.3)' } });
  }

  // Default: apply a subtle change so the user sees something
  if (ops.length === 0) {
    ops.push({
      kind: 'css',
      selector: 'body',
      styles: { 'filter': 'saturate(1.2)' }
    });
  }

  return ops;
}

// ── Send ops to content script in active tab ────────────────────────────

async function applyOpsToActiveTab(ops) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await chrome.tabs.sendMessage(tab.id, { type: 'apply', ops });
}

// ── Accumulated ops for the current session (per-origin) ────────────────

const sessionOps = {};  // origin → ops[]

// ── Message handler ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true;  // keep channel open for async response
});

async function handleMessage(msg) {
  try {
    switch (msg.type) {
      case 'chat': {
        const ops = await callAI(msg.prompt, msg.origin);
        // Accumulate for session
        if (msg.origin) {
          if (!sessionOps[msg.origin]) sessionOps[msg.origin] = [];
          sessionOps[msg.origin].push(...ops);
        }
        // Apply to active tab
        await applyOpsToActiveTab(ops);
        return { ok: true, ops };
      }

      case 'saveConfig': {
        const origin = msg.origin;
        if (!origin) return { ok: false, error: 'No origin' };
        const ops = sessionOps[origin] || [];
        if (ops.length === 0) return { ok: false, error: 'No ops to save' };
        const config = await saveConfig(origin, ops);
        return { ok: true, config };
      }

      case 'loadConfig': {
        const origin = msg.origin;
        if (!origin) return { ok: false, error: 'No origin' };
        const config = await loadConfig(origin);
        if (!config) return { ok: false, error: 'No saved config for this site' };
        // Refresh session ops
        sessionOps[origin] = [...(config.ops || [])];
        return { ok: true, config };
      }

      case 'applyToTab': {
        await applyOpsToActiveTab(msg.ops || []);
        return { ok: true };
      }

      case 'eraseConfig': {
        const origin = msg.origin;
        if (!origin) return { ok: false, error: 'No origin' };
        await eraseConfig(origin);
        delete sessionOps[origin];
        return { ok: true };
      }

      case 'exportConfig': {
        const data = await exportConfig();
        return { ok: true, data };
      }

      case 'importConfig': {
        await importConfig(msg.data || {});
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown message type: ${msg.type}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Auto-apply saved config when a tab finishes loading ─────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  let origin;
  try { origin = new URL(tab.url).origin; } catch { return; }

  const config = await loadConfig(origin);
  if (config && config.ops && config.ops.length > 0) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'apply', ops: config.ops });
    } catch {
      // Content script might not be ready yet — ignore
    }
  }
});
