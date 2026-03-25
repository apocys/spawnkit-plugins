# 🧩 SpawnKit Plugins — AI CSS Editor for Chrome

Describe style changes in plain English. The AI generates and applies CSS instantly to any website.

**[Live Site](https://plugins.spawnkit.ai)** · **[Install Guide](#install)**

## Features

- **🎨 Natural Language CSS** — Type "make it dark" or "hide the sidebar" and AI generates precise CSS
- **🎯 Visual Element Picker** — Click any element to auto-generate its CSS selector
- **⚡ Built-in Presets** — One-click Dark Mode, Reader Mode, Hide Ads, Focus Mode, Compact
- **💾 Per-Site Persistence** — Configs saved via Chrome sync, auto-apply on every visit
- **↩️ Undo** — One-click undo reverts all changes (non-destructive)
- **📦 Export/Import** — Share your site configs as JSON

## Install

1. Clone: `git clone https://github.com/apocys/spawnkit-plugins.git`
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select `spawnkit-plugins/` folder
4. Start AI proxy: `npm start` (requires Node.js 18+ and [OpenClaw](https://github.com/openclaw/openclaw) gateway)

## Usage

1. Navigate to any website
2. Click the 🧩 icon in your toolbar
3. Type a prompt (e.g. *"make the background dark"*, *"change font to serif"*)
4. Or use the **🎯 Pick** button to click an element, then describe changes
5. Or apply a **Preset** (Dark Mode, Reader Mode, etc.)

### Action Buttons

| Button | Action |
|--------|--------|
| **🎯 Pick** | Click-to-select an element on the page |
| **↩ Undo** | Revert all changes on the current page |
| **💾 Save** | Persist ops for this site (auto-applies on revisit) |
| **📂 Load** | Restore and re-apply saved ops |
| **📦 Export** | Download all site configs as JSON |
| **📥 Import** | Upload a JSON file to merge configs |
| **🗑 Erase** | Delete saved config for current site |

### Presets

| Preset | Effect |
|--------|--------|
| 🌙 Dark Mode | Full dark theme — body, containers, inputs, links, tables |
| 📖 Reader Mode | 700px centered, serif font, hide nav/sidebar/footer |
| 🚫 Hide Ads | Remove common ad/banner/cookie elements |
| 🔍 Focus Mode | Blur distractions, highlight main content |
| 📏 Compact | Reduce spacing and font size globally |

## AI Proxy

The extension talks to a local proxy (`ai-proxy.js`) that forwards prompts to the OpenClaw gateway.

```bash
npm start
# Proxy listens on http://localhost:3460
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/css-editor` | Main endpoint — `{ prompt, origin }` → `{ ops }` |
| GET | `/health` | Health check + uptime + request count |
| GET | `/stats` | Memory usage, rate limit stats |

### Rate Limits

- 20 requests per origin per minute
- 2KB max prompt length
- 30s request timeout

## Architecture

```
Chrome Extension (MV3)
  ├── popup.html/js     — Chat UI + presets + picker trigger
  ├── background.js     — Service worker: routing, AI calls, storage
  ├── content.js        — Applies CSS/DOM ops to pages
  ├── picker.js         — Visual element picker overlay
  ├── presets.js        — Built-in preset library
  └── storage.js        — Per-origin config persistence (chrome.storage.sync)

AI Proxy (Node.js)
  └── ai-proxy.js       — localhost:3460 → OpenClaw gateway → Claude Sonnet
```

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JS (no framework, no build step)
- OpenClaw gateway + Claude Sonnet for AI
- Chrome Storage Sync API for persistence

## License

MIT
