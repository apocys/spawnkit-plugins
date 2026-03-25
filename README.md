# SpawnKit Plugins — Chrome Extension (MV3)

AI-driven CSS and DOM manipulation via a chat interface. Describe style changes in natural language, and the extension applies them to the current page.

## Install

1. Clone or copy the `spawnkit-plugins/` folder
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `spawnkit-plugins/` folder
5. The SpawnKit icon appears in the toolbar

## Usage

1. Navigate to any website
2. Click the SpawnKit icon to open the popup
3. Type a prompt (e.g. *"make the background dark"*, *"hide .sidebar"*, *"change font to serif"*)
4. The extension sends the prompt to the AI endpoint and applies returned ops to the page

### Buttons

| Button   | Action |
|----------|--------|
| **Save** | Persist current ops to `chrome.storage.sync` for this origin |
| **Load** | Restore and re-apply saved ops for this origin |
| **Export** | Download all saved configs as a JSON file |
| **Import** | Upload a JSON file to merge configs into storage |
| **Erase** | Delete saved config for the current origin |

## AI Endpoint

The extension POSTs to `http://localhost:18789/ai/css-editor` with:

```json
{ "prompt": "user message", "origin": "https://example.com" }
```

Expected response:

```json
{
  "ops": [
    { "kind": "css", "selector": "body", "styles": { "background": "#000" } },
    { "kind": "dom", "selector": ".ad", "action": "remove", "html": "" }
  ]
}
```

If the endpoint is unreachable, the extension simulates ops based on keyword matching (dark, hide, font, border).

## Message Protocol

```
{ type: 'apply', ops: [
    { kind: 'css', selector, styles: { prop: value, ... } },
    { kind: 'dom', selector, action: 'replace'|'append'|'remove', html }
]}
```

## Persistence

- Configs are stored per origin (`protocol+host`) in `chrome.storage.sync`
- On save, CSS ops are coalesced per selector; DOM ops are deduped by selector+action
- On import, the more recent config wins (by `updatedAt` timestamp); ops are merged for older entries
- Saved configs auto-apply when navigating to a matching origin

## Files

```
spawnkit-plugins/
├── manifest.json   — MV3 manifest
├── popup.html      — Chat UI
├── popup.js        — Popup controller
├── background.js   — Service worker (routing, AI, persistence)
├── content.js      — Applies CSS/DOM ops to pages
├── storage.js      — Storage helpers (get/save/load/erase/export/import)
└── README.md       — This file
```

## Dev / Test

1. Load the extension as described above
2. Open any page, click the extension icon
3. Type "make background dark" → page background changes
4. Click **Save** → reload the page → ops re-apply automatically
5. Click **Export** → download JSON → click **Erase** → click **Import** → select the JSON
6. Open DevTools console to see `[SpawnKit]` warnings if any op fails
