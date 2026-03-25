# 🧩 SpawnKit Plugins — Phase 1 Mission

**Goal:** Take the Chrome extension from scaffold to functional product
**Started:** 2026-03-25 22:20 UTC
**Executor:** Sycopa (no sub-agents)

## Task Tracker

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T1 | Fix AI proxy auth (401 → working) | ✅ DONE | Added Bearer token to OpenClaw gateway calls |
| T2 | Harden AI proxy (error handling, rate limit, timeout) | 🔲 TODO | |
| T3 | Improve system prompt (context-aware, better selectors) | 🔲 TODO | |
| T4 | Content script hardening (iframes, retry on load, CSP) | 🔲 TODO | |
| T5 | Auto-apply reliability (tab ready detection) | 🔲 TODO | |
| T6 | Popup UI polish (loading states, error display, op history) | 🔲 TODO | |
| T7 | Undo/redo support | 🔲 TODO | |
| T8 | Visual element picker | 🔲 TODO | |
| T9 | Preset library (dark mode, reader mode, hide ads) | 🔲 TODO | |
| T10 | Landing page v2 (demo, install guide, screenshots) | 🔲 TODO | |
| T11 | README + Chrome Web Store prep | 🔲 TODO | |

## Completed Log
- **T1** (22:20) — AI proxy returning 401. Root cause: no Authorization header. Fixed by adding Bearer token. Tested: HN dark mode → 11 context-aware ops returned. ✅
