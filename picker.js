// picker.js — Visual element picker overlay
// Injected into the page when user clicks "Pick" in popup.
// Highlights elements on hover, returns best CSS selector on click.

(function() {
  // Toggle: if already active, destroy and exit
  if (window.__spawnkitPicker) {
    window.__spawnkitPicker.destroy();
    chrome.runtime.sendMessage({ type: 'pickerCancelled' }).catch(() => {});
    return;
  }

  const HIGHLIGHT_COLOR = 'rgba(102, 126, 234, 0.3)';
  const OUTLINE_COLOR = '#667eea';

  // ── Overlay elements ────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.id = '__spawnkit-picker-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    border: `2px solid ${OUTLINE_COLOR}`,
    backgroundColor: HIGHLIGHT_COLOR,
    borderRadius: '2px',
    transition: 'all 0.1s ease',
    display: 'none',
  });

  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    background: '#1a1a2e',
    color: '#e4e4e7',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    display: 'none',
    whiteSpace: 'nowrap',
    maxWidth: '400px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(label);

  let currentEl = null;

  // ── Selector generation ─────────────────────────────────────────────

  function getSelector(el) {
    if (!el || el === document.documentElement || el === document.body) {
      return el === document.body ? 'body' : 'html';
    }

    // ID is unique — best selector
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      return `#${el.id}`;
    }

    // Build class-based selector
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList)
      .filter(c => /^[a-zA-Z][\w-]*$/.test(c) && !c.startsWith('__'))
      .slice(0, 3);

    if (classes.length > 0) {
      const sel = `${tag}.${classes.join('.')}`;
      // Check uniqueness
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
        // If not unique, try with parent context
        const parent = el.parentElement;
        if (parent) {
          const parentSel = getShortParentSelector(parent);
          if (parentSel) {
            const full = `${parentSel} > ${sel}`;
            try {
              if (document.querySelectorAll(full).length <= 3) return full;
            } catch { /* fallback */ }
          }
        }
        return sel;  // return non-unique class selector as reasonable default
      } catch { /* fallback */ }
    }

    // nth-child fallback
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length === 1) {
        const parentSel = getShortParentSelector(parent);
        return parentSel ? `${parentSel} > ${tag}` : tag;
      }
      const idx = siblings.indexOf(el) + 1;
      const parentSel = getShortParentSelector(parent);
      return parentSel ? `${parentSel} > ${tag}:nth-child(${idx})` : `${tag}:nth-child(${idx})`;
    }

    return tag;
  }

  function getShortParentSelector(el) {
    if (!el || el === document.documentElement) return null;
    if (el === document.body) return 'body';
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList)
      .filter(c => /^[a-zA-Z][\w-]*$/.test(c))
      .slice(0, 2);
    return cls.length > 0 ? `${tag}.${cls.join('.')}` : null;
  }

  // ── Event handlers ──────────────────────────────────────────────────

  function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === label || el.id === '__spawnkit-picker-overlay') return;
    if (el === currentEl) return;
    currentEl = el;

    const rect = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: 'block',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });

    const tag = el.tagName.toLowerCase();
    const sel = getSelector(el);
    const dims = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    label.textContent = `${sel}  (${dims})`;
    label.style.display = 'block';

    // Position label above or below the element
    const labelH = 22;
    if (rect.top > labelH + 4) {
      label.style.top = (rect.top - labelH - 4) + 'px';
    } else {
      label.style.top = (rect.bottom + 4) + 'px';
    }
    label.style.left = Math.max(4, rect.left) + 'px';
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (!currentEl) return;
    const selector = getSelector(currentEl);

    // Send selector back to extension
    chrome.runtime.sendMessage({
      type: 'pickerResult',
      selector: selector,
      tag: currentEl.tagName.toLowerCase(),
      dims: {
        w: Math.round(currentEl.getBoundingClientRect().width),
        h: Math.round(currentEl.getBoundingClientRect().height),
      },
    });

    destroy();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'pickerCancelled' });
      destroy();
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  function destroy() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    label.remove();
    document.body.style.cursor = '';
    window.__spawnkitPicker = null;
  }

  // Activate
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.body.style.cursor = 'crosshair';

  window.__spawnkitPicker = { destroy };
})();
