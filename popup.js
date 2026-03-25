// popup.js — Chat UI controller

const chatLog = document.getElementById('chat-log');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const siteLabel = document.getElementById('site-label');
const status = document.getElementById('status');

let currentOrigin = null;

// ── Helpers ──────────────────────────────────────────────────────────────

function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(msg) {
  status.textContent = msg;
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => { status.textContent = ''; }, 3000);
}

async function getActiveTabOrigin() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try { return new URL(tab.url).origin; } catch { return null; }
}

// ── Chat → AI → Apply ───────────────────────────────────────────────────

async function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  promptInput.value = '';
  sendBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'chat',
      prompt: text,
      origin: currentOrigin
    });

    if (response.error) {
      addMessage(response.error, 'error');
      return;
    }

    const ops = response.ops || [];
    addMessage(`Applied ${ops.length} op(s)`, 'ai');
  } catch (err) {
    addMessage(`Error: ${err.message}`, 'error');
  } finally {
    sendBtn.disabled = false;
    promptInput.focus();
  }
}

sendBtn.addEventListener('click', sendPrompt);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

// ── Action buttons ───────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'saveConfig', origin: currentOrigin });
  setStatus(resp.ok ? 'Config saved' : `Save failed: ${resp.error}`);
});

document.getElementById('btn-load').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'loadConfig', origin: currentOrigin });
  if (resp.ok) {
    setStatus(`Loaded ${resp.config?.ops?.length || 0} ops — applying`);
    await chrome.runtime.sendMessage({ type: 'applyToTab', origin: currentOrigin, ops: resp.config?.ops || [] });
  } else {
    setStatus(resp.error || 'No config found');
  }
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'exportConfig' });
  if (resp.ok) {
    const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spawnkit-config.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported all configs');
  } else {
    setStatus(`Export failed: ${resp.error}`);
  }
});

document.getElementById('btn-import').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const resp = await chrome.runtime.sendMessage({ type: 'importConfig', data });
      setStatus(resp.ok ? 'Imported configs' : `Import failed: ${resp.error}`);
    } catch (err) {
      setStatus(`Import error: ${err.message}`);
    }
  });
  input.click();
});

document.getElementById('btn-erase').addEventListener('click', async () => {
  if (!confirm(`Erase config for ${currentOrigin}?`)) return;
  const resp = await chrome.runtime.sendMessage({ type: 'eraseConfig', origin: currentOrigin });
  setStatus(resp.ok ? 'Config erased' : `Erase failed: ${resp.error}`);
});

// ── Init ─────────────────────────────────────────────────────────────────

(async () => {
  currentOrigin = await getActiveTabOrigin();
  siteLabel.textContent = currentOrigin || 'N/A';
})();
