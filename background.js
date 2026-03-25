// background.js — Service worker: message routing, AI endpoint, persistence
//
// Hardened: retry logic for content script injection, proper tab lifecycle,
// conversation history per origin, better error reporting.

importScripts('storage.js');
importScripts('presets.js');

const AI_ENDPOINT = 'http://localhost:3460/ai/css-editor';

// ── AI call ──────────────────────────────────────────────────────────────

async function callAI(prompt, origin) {
  try {
    const resp = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, origin })
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (data.error) {
      console.warn('[bg] AI returned error:', data.error);
      // Still return ops if any (partial success)
    }

    return { ops: data.ops || [], error: data.error || null };
  } catch (err) {
    console.error('[bg] AI call failed:', err.message);
    return { ops: simulateOps(prompt), error: `Offline mode: ${err.message}`, offline: true };
  }
}

/** Produce plausible ops for offline testing. */
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

  if (ops.length === 0) {
    ops.push({ kind: 'css', selector: 'body', styles: { filter: 'saturate(1.2)' } });
  }

  return ops;
}

// ── Send ops to tab with retry ───────────────────────────────────────────

async function sendOpsToTab(tabId, ops, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: 'apply', ops });
      return resp;
    } catch (err) {
      if (i < retries) {
        // Content script might not be injected yet — wait and retry
        await new Promise(r => setTimeout(r, 500));
        // Try to inject content script
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });
        } catch { /* ignore — might already be injected */ }
      } else {
        console.warn('[bg] Failed to send ops to tab after retries:', err.message);
        return null;
      }
    }
  }
}

async function applyOpsToActiveTab(ops) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return sendOpsToTab(tab.id, ops);
}

// ── Accumulated ops for the current session (per-origin) ────────────────

const sessionOps = {};  // origin → ops[]
let pickerResult = null; // last picker selection

// ── Message handler ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse);
  return true;  // keep channel open for async response
});

async function handleMessage(msg, sender) {
  try {
    switch (msg.type) {
      case 'chat': {
        const { ops, error, offline } = await callAI(msg.prompt, msg.origin);

        // Accumulate for session
        if (msg.origin && ops.length > 0) {
          if (!sessionOps[msg.origin]) sessionOps[msg.origin] = [];
          sessionOps[msg.origin].push(...ops);
        }

        // Apply to active tab
        const result = await applyOpsToActiveTab(ops);
        return {
          ok: true,
          ops,
          applied: result?.applied || 0,
          failed: result?.failed || 0,
          error: error || null,
          offline: offline || false,
        };
      }

      case 'undo': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'No active tab' };
        try {
          const resp = await chrome.tabs.sendMessage(tab.id, { type: 'undo' });
          // Clear session ops for this origin
          if (msg.origin) delete sessionOps[msg.origin];
          return { ok: true, undone: resp?.undone || 0 };
        } catch {
          return { ok: false, error: 'Content script not available' };
        }
      }

      case 'saveConfig': {
        const origin = msg.origin;
        if (!origin) return { ok: false, error: 'No origin' };
        const ops = sessionOps[origin] || [];
        if (ops.length === 0) return { ok: false, error: 'No ops to save — make some changes first' };
        const config = await saveConfig(origin, ops);
        return { ok: true, config, opsCount: config.ops.length };
      }

      case 'loadConfig': {
        const origin = msg.origin;
        if (!origin) return { ok: false, error: 'No origin' };
        const config = await loadConfig(origin);
        if (!config) return { ok: false, error: 'No saved config for this site' };
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

      case 'getSessionOps': {
        return { ok: true, ops: sessionOps[msg.origin] || [] };
      }

      case 'startPicker': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'No active tab' };
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['picker.js']
          });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }

      case 'pickerResult': {
        // Forward to popup — store temporarily
        pickerResult = { selector: msg.selector, tag: msg.tag, dims: msg.dims };
        return { ok: true };
      }

      case 'pickerCancelled': {
        pickerResult = null;
        return { ok: true };
      }

      case 'getPickerResult': {
        const result = pickerResult;
        pickerResult = null;
        return { ok: true, result };
      }

      case 'getPresets': {
        const list = Object.entries(self.PRESETS || {}).map(([id, p]) => ({
          id, name: p.name, description: p.description, opsCount: p.ops.length,
        }));
        return { ok: true, presets: list };
      }

      case 'applyPreset': {
        const preset = (self.PRESETS || {})[msg.presetId];
        if (!preset) return { ok: false, error: `Unknown preset: ${msg.presetId}` };
        const result = await applyOpsToActiveTab(preset.ops);
        // Track in session ops
        if (msg.origin) {
          if (!sessionOps[msg.origin]) sessionOps[msg.origin] = [];
          sessionOps[msg.origin].push(...preset.ops);
        }
        return { ok: true, applied: result?.applied || 0, name: preset.name };
      }

      case 'contentReady': {
        // Content script just loaded — check if we have saved ops for this origin
        if (msg.url) {
          try {
            const origin = new URL(msg.url).origin;
            const config = await loadConfig(origin);
            if (config?.ops?.length > 0 && sender.tab?.id) {
              await sendOpsToTab(sender.tab.id, config.ops);
            }
          } catch { /* ignore */ }
        }
        return { ok: true };
      }

      case 'urlChanged': {
        // SPA navigation — re-apply if we have config for new URL's origin
        if (msg.url && sender.tab?.id) {
          try {
            const origin = new URL(msg.url).origin;
            const config = await loadConfig(origin);
            if (config?.ops?.length > 0) {
              await sendOpsToTab(sender.tab.id, config.ops);
            }
          } catch { /* ignore */ }
        }
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown message type: ${msg.type}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Auto-apply saved config on tab load ──────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  // Skip chrome:// and extension pages
  if (tab.url.startsWith('chrome') || tab.url.startsWith('about:')) return;

  let origin;
  try { origin = new URL(tab.url).origin; } catch { return; }

  const config = await loadConfig(origin);
  if (config?.ops?.length > 0) {
    // Small delay to let content script initialize
    setTimeout(() => sendOpsToTab(tabId, config.ops), 300);
  }
});
