// popup.js — Chat UI controller (hardened)

const chatLog = document.getElementById('chat-log');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const siteLabel = document.getElementById('site-label');
const status = document.getElementById('status');
const loading = document.getElementById('loading');
const emptyState = document.getElementById('empty-state');

let currentOrigin = null;
let messageCount = 0;

// ── Helpers ──────────────────────────────────────────────────────────────

function addMessage(text, role, extra = '') {
  // Hide empty state on first message
  if (messageCount === 0 && emptyState) {
    emptyState.style.display = 'none';
  }
  messageCount++;

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = text + (extra ? `<br><span style="font-size:11px;opacity:0.7">${extra}</span>` : '');
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(msg, type = '') {
  status.textContent = msg;
  status.className = `status-bar ${type}`;
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => {
    status.textContent = '';
    status.className = 'status-bar';
  }, 4000);
}

function setLoading(on) {
  loading.classList.toggle('active', on);
  sendBtn.disabled = on;
  promptInput.disabled = on;
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
  setLoading(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'chat',
      prompt: text,
      origin: currentOrigin
    });

    if (response.error && response.ops?.length === 0) {
      addMessage(response.error, 'error');
      setStatus('Failed', 'error');
      return;
    }

    const ops = response.ops || [];
    const cssOps = ops.filter(o => o.kind === 'css').length;
    const domOps = ops.filter(o => o.kind === 'dom').length;

    let detail = [];
    if (cssOps) detail.push(`${cssOps} CSS`);
    if (domOps) detail.push(`${domOps} DOM`);
    const detailStr = detail.length ? ` (${detail.join(', ')})` : '';

    const cls = response.offline ? 'ai offline' : 'ai success';
    const prefix = response.offline ? '⚡ Offline: ' : '✅ ';
    addMessage(
      `${prefix}Applied <span class="op-count">${ops.length}</span> op${ops.length !== 1 ? 's' : ''}${detailStr}`,
      cls,
      response.error ? `⚠️ ${response.error}` : ''
    );

    setStatus(`${ops.length} ops applied`, 'success');
  } catch (err) {
    addMessage(`Connection error: ${err.message}`, 'error');
    setStatus('Error', 'error');
  } finally {
    setLoading(false);
    promptInput.focus();
  }
}

sendBtn.addEventListener('click', sendPrompt);

// ── Element Picker ───────────────────────────────────────────────────────

const pickBtn = document.getElementById('pick-btn');
let pickerActive = false;
let pickerPollInterval = null;

pickBtn.addEventListener('click', async () => {
  if (pickerActive) {
    // Cancel picker
    pickerActive = false;
    pickBtn.classList.remove('active');
    clearInterval(pickerPollInterval);
    setStatus('Picker cancelled');
    return;
  }

  const resp = await chrome.runtime.sendMessage({ type: 'startPicker' });
  if (!resp.ok) {
    setStatus(resp.error || 'Could not start picker', 'error');
    return;
  }

  pickerActive = true;
  pickBtn.classList.add('active');
  setStatus('Click an element on the page...', '');

  // Poll for picker result (popup can't receive messages directly from content script)
  pickerPollInterval = setInterval(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'getPickerResult' });
    if (r.result) {
      clearInterval(pickerPollInterval);
      pickerActive = false;
      pickBtn.classList.remove('active');

      const { selector, tag, dims } = r.result;
      promptInput.value = `${selector} → `;
      promptInput.focus();
      promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
      addMessage(`🎯 Selected: <code>${selector}</code> (${tag}, ${dims.w}×${dims.h})`, 'ai');
      setStatus('Element selected — type your change', 'success');
    }
  }, 300);

  // Auto-cancel after 30s
  setTimeout(() => {
    if (pickerActive) {
      clearInterval(pickerPollInterval);
      pickerActive = false;
      pickBtn.classList.remove('active');
      setStatus('Picker timed out', '');
    }
  }, 30000);
});
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

// ── Action buttons ───────────────────────────────────────────────────────

document.getElementById('btn-undo').addEventListener('click', async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'undo', origin: currentOrigin });
    if (resp.ok) {
      addMessage(`↩ Undid ${resp.undone} op${resp.undone !== 1 ? 's' : ''}`, 'ai');
      setStatus('Changes reverted', 'success');
    } else {
      setStatus(resp.error || 'Undo failed', 'error');
    }
  } catch {
    setStatus('Undo failed — reload the page', 'error');
  }
});

document.getElementById('btn-save').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'saveConfig', origin: currentOrigin });
  if (resp.ok) {
    setStatus(`Saved ${resp.opsCount} ops for this site`, 'success');
  } else {
    setStatus(resp.error || 'Save failed', 'error');
  }
});

document.getElementById('btn-load').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'loadConfig', origin: currentOrigin });
  if (resp.ok) {
    const ops = resp.config?.ops || [];
    await chrome.runtime.sendMessage({ type: 'applyToTab', origin: currentOrigin, ops });
    addMessage(`📂 Loaded ${ops.length} saved op${ops.length !== 1 ? 's' : ''}`, 'ai');
    setStatus(`Applied ${ops.length} saved ops`, 'success');
  } else {
    setStatus(resp.error || 'No config found', 'error');
  }
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'exportConfig' });
  if (resp.ok) {
    const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spawnkit-plugins-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const count = Object.keys(resp.data).length;
    setStatus(`Exported ${count} site config${count !== 1 ? 's' : ''}`, 'success');
  } else {
    setStatus('Export failed', 'error');
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
      setStatus(resp.ok ? 'Configs imported' : 'Import failed', resp.ok ? 'success' : 'error');
    } catch (err) {
      setStatus(`Import error: ${err.message}`, 'error');
    }
  });
  input.click();
});

document.getElementById('btn-erase').addEventListener('click', async () => {
  if (!confirm(`Erase saved config for ${currentOrigin}?`)) return;
  const resp = await chrome.runtime.sendMessage({ type: 'eraseConfig', origin: currentOrigin });
  setStatus(resp.ok ? 'Config erased' : 'Erase failed', resp.ok ? 'success' : 'error');
});

// ── Presets ──────────────────────────────────────────────────────────────

const presetsToggle = document.getElementById('presets-toggle');
const presetsGrid = document.getElementById('presets-grid');
const toggleArrow = presetsToggle.querySelector('.toggle-arrow');
let presetsOpen = false;
const appliedPresets = new Set();

presetsToggle.addEventListener('click', async () => {
  presetsOpen = !presetsOpen;
  presetsGrid.style.display = presetsOpen ? 'grid' : 'none';
  toggleArrow.classList.toggle('open', presetsOpen);

  if (presetsOpen && presetsGrid.children.length === 0) {
    // Load presets on first open
    const resp = await chrome.runtime.sendMessage({ type: 'getPresets' });
    if (resp.ok) {
      for (const preset of resp.presets) {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.dataset.presetId = preset.id;
        btn.innerHTML = `<div class="preset-name">${preset.name}</div><div class="preset-desc">${preset.description}</div>`;
        btn.addEventListener('click', async () => {
          const r = await chrome.runtime.sendMessage({
            type: 'applyPreset',
            presetId: preset.id,
            origin: currentOrigin,
          });
          if (r.ok) {
            appliedPresets.add(preset.id);
            btn.classList.add('applied');
            addMessage(`⚡ ${preset.name} applied (${r.applied} ops)`, 'ai success');
            setStatus(`${preset.name} active`, 'success');
          } else {
            setStatus(r.error || 'Preset failed', 'error');
          }
        });
        presetsGrid.appendChild(btn);
      }
    }
  }
});

// ── Init ─────────────────────────────────────────────────────────────────

(async () => {
  currentOrigin = await getActiveTabOrigin();
  if (currentOrigin) {
    // Show just hostname
    try {
      siteLabel.textContent = new URL(currentOrigin).hostname;
    } catch {
      siteLabel.textContent = currentOrigin;
    }
  } else {
    siteLabel.textContent = 'N/A';
    promptInput.placeholder = 'Navigate to a website first...';
    promptInput.disabled = true;
    sendBtn.disabled = true;
  }
})();
