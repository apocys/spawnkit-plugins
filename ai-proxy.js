#!/usr/bin/env node
// ai-proxy.js — Proxy that translates SpawnKit extension requests
// into OpenAI-compatible chat completions via the OpenClaw gateway.
// Hardened: timeouts, rate limiting, input validation, structured logging.

const http = require('node:http');

const PORT = process.env.PORT || 3460;
const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://localhost:8317/v1/chat/completions';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || '';  // CLIProxyAPI doesn't need auth from localhost
const MODEL_FAST = process.env.MODEL_FAST || 'claude-sonnet-4-20250514';
const MODEL_PREMIUM = process.env.MODEL_PREMIUM || 'claude-opus-4-6';
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_PROMPT_LENGTH = 4000;
const MAX_BODY_BYTES = 20_000;

// ── Rate limiter (per-origin, sliding window) ────────────────────────────

const rateLimits = new Map(); // origin → { count, resetAt }
const RATE_LIMIT = 20;        // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function checkRateLimit(origin) {
  const key = origin || '__global__';
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimits.set(key, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 5 * 60_000).unref();

// ── Logging ──────────────────────────────────────────────────────────────

function log(level, msg, extra = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...extra };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

// ── System prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert CSS manipulation assistant AND award-winning UI designer.
You restyle websites to look premium, polished, and modern — Awwwards SOTD quality.

Return ONLY a valid JSON object with an "ops" array. No markdown, no code fences, no explanation.

## Operations

1. CSS operations:
   { "kind": "css", "selector": "<CSS selector>", "styles": { "<property>": "<value>" } }

2. DOM operations:
   { "kind": "dom", "selector": "<CSS selector>", "action": "<replace|append|remove>", "html": "<HTML string>" }

## Design Knowledge (use when user asks for "beautiful", "premium", "awwwards", "redesign", "make it look good")

### Typography
- Hero headlines: large (clamp(2rem, 5vw, 4rem)), weight 600-700, letter-spacing -0.02em
- Body: 16-18px, line-height 1.6-1.8, weight 400
- Subheadings: 13px uppercase, letter-spacing 0.12em, weight 500
- Font stack: 'Inter', 'SF Pro', system-ui, -apple-system, sans-serif
- Max paragraph width: 65ch
- Use text-wrap: balance on headings

### Color (HSL preferred)
- Dark themes: never pure black — use hsl(220, 15%, 6-8%) or similar dark blue-gray
- Light themes: text never pure black — use hsl(220, 15%, 12-15%)
- Accent color at max 10% of surface area
- Gradients: subtle, max 2 stops, for overlays or borders
- Glass effect: background rgba(255,255,255,0.04), backdrop-filter blur(20px), border 1px solid rgba(255,255,255,0.08)

### Spacing (8px grid)
- Section padding: 80-160px vertical
- Element gaps: 8, 16, 24, 32, 48, 64px
- Generous negative space — when in doubt, add more

### Layout
- Asymmetric grids (60/40, 70/30) over equal columns
- Border-radius: 8-16px on cards, 4-8px on buttons
- Subtle shadows: 0 4px 24px rgba(0,0,0,0.1)
- Overlapping elements for depth

### Interactions (CSS only)
- Buttons: transition all 0.2s, scale(0.98) on active, subtle background shift on hover
- Cards: translateY(-2px) + box-shadow increase on hover
- Images: slight scale(1.02) on hover within overflow:hidden
- Links: custom underline via border-bottom or background-gradient trick
- Focus states: outline with offset, visible ring

### Industry-aware styling
- SaaS/Tech: blue-purple accents, glassmorphism, Inter font
- Finance: dark mode, sharp type, trust-inducing minimal palette
- E-commerce/Luxury: serif headings, generous whitespace, gold/neutral accents
- Portfolio/Agency: bold typography, experimental layouts, strong contrast

## Rules
- Use specific selectors. The "origin" field tells you which site.
- Consider site structure (HN=tables, Reddit=.Post, GitHub=.Box/.container-lg).
- For full-page redesigns: cover body, headings, paragraphs, links, inputs, cards, nav, footer, images.
- Generate 15-30 ops for complex requests like "make it award-winning" or "redesign the whole page".
- For simple requests ("hide X", "change color"): be minimal, 1-3 ops.
- All values will be injected with !important via <style> tags.

Example (simple):
{"ops":[{"kind":"css","selector":"body","styles":{"background":"#1a1a2e","color":"#e0e0e0"}}]}

Example (full redesign):
{"ops":[{"kind":"css","selector":"body","styles":{"background":"hsl(220,15%,7%)","color":"hsl(220,10%,85%)","font-family":"'Inter',system-ui,sans-serif","line-height":"1.7"}},{"kind":"css","selector":"h1,h2,h3","styles":{"letter-spacing":"-0.02em","font-weight":"600"}},{"kind":"css","selector":"a","styles":{"color":"hsl(250,80%,70%)","text-decoration":"none","border-bottom":"1px solid transparent","transition":"border-color 0.2s"}},{"kind":"css","selector":"a:hover","styles":{"border-bottom-color":"currentColor"}}]}`;

// ── Helpers ──────────────────────────────────────────────────────────────

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  return {
    'Access-Control-Allow-Origin': origin.startsWith('chrome-extension://') ? origin : '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(res, status, body, req) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(req) };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Try to extract a JSON object from text that may contain markdown fences. */
function extractJSON(text) {
  try { return JSON.parse(text); } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* continue */ }
  }

  return null;
}

/** Validate ops array structure */
function validateOps(ops) {
  if (!Array.isArray(ops)) return [];
  return ops.filter(op => {
    if (op.kind === 'css') return op.selector && typeof op.styles === 'object';
    if (op.kind === 'dom') return op.selector && ['replace', 'append', 'remove'].includes(op.action);
    return false;
  });
}

// ── Detect if prompt needs premium model ──────────────────────────────────

const PREMIUM_TRIGGERS = [
  'award', 'awwwards', 'premium', 'redesign', 'beautiful', 'stunning',
  'make it look good', 'make it look great', 'professional', 'modern',
  'whole page', 'full redesign', 'overhaul', 'transform',
];

function selectModel(prompt) {
  const lower = prompt.toLowerCase();
  if (PREMIUM_TRIGGERS.some(t => lower.includes(t))) return MODEL_PREMIUM;
  return MODEL_FAST;
}

// ── Review prompt for self-critique ───────────────────────────────────────

const REVIEW_PROMPT = `You are reviewing CSS operations that were just generated for a website redesign.
The ops were applied but the result doesn't look award-winning yet.

Review the ops and return an IMPROVED version. Return ONLY a JSON object with an "ops" array.
Focus on:
- Missing elements (did we forget inputs, tables, code blocks, images, nav, footer?)
- Color consistency (are all backgrounds the same dark shade? any missed white/light areas?)
- Typography (is there proper hierarchy? letter-spacing on headings?)
- Interactions (hover states on links, buttons, cards?)
- Spacing (generous padding, proper margins?)
- Polish (border-radius, subtle shadows, transitions?)

Return the COMPLETE improved ops array (not just additions — the full replacement set).`;

// ── LLM call ──────────────────────────────────────────────────────────────

async function llmCall(messages, model, maxTokens = 4096) {
  const payload = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: maxTokens,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(OPENCLAW_URL, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        OPENCLAW_TOKEN ? { 'Authorization': `Bearer ${OPENCLAW_TOKEN}` } : {}
      ),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from LLM');

    const parsed = extractJSON(content);
    if (!parsed || !Array.isArray(parsed.ops)) {
      throw new Error(`Could not parse ops: ${content.slice(0, 200)}`);
    }

    return validateOps(parsed.ops);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main orchestrator: generate + optional review ─────────────────────────

async function callOpenClaw(prompt, origin) {
  const model = selectModel(prompt);
  const isPremium = model === MODEL_PREMIUM;
  const userMessage = origin
    ? `Website: ${origin}\n\nRequest: ${prompt}`
    : prompt;

  log('info', 'LLM call', { model, isPremium, origin });

  // Step 1: Generate ops
  const ops = await llmCall(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    model,
  );

  // Step 2: Self-review (only for premium/complex requests with 10+ ops)
  // Uses Sonnet for speed — review is faster/cheaper than generation
  if (isPremium && ops.length >= 10) {
    log('info', 'Running self-review', { initialOps: ops.length });
    try {
      const opsJSON = JSON.stringify({ ops });
      const reviewedOps = await llmCall(
        [
          { role: 'system', content: REVIEW_PROMPT },
          { role: 'user', content: `Website: ${origin}\n\nOriginal request: ${prompt}\n\nGenerated ops:\n${opsJSON}\n\nReturn ONLY the improved JSON ops object. No markdown fences.` },
        ],
        MODEL_FAST,
        8192,
      );
      if (reviewedOps.length >= ops.length) {
        log('info', 'Review improved ops', { before: ops.length, after: reviewedOps.length });
        return reviewedOps;
      }
      // If review produced fewer ops, keep original (review degraded quality)
      log('warn', 'Review produced fewer ops, keeping original', { before: ops.length, after: reviewedOps.length });
    } catch (err) {
      log('warn', 'Review failed, using original ops', { error: err.message });
    }
  }

  return ops;
}

// ── HTTP server ──────────────────────────────────────────────────────────

let requestCount = 0;

const server = http.createServer(async (req, res) => {
  const requestId = ++requestCount;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    return jsonResponse(res, 200, {
      status: 'ok',
      uptime: process.uptime() | 0,
      requests: requestCount,
      modelFast: MODEL_FAST,
      modelPremium: MODEL_PREMIUM,
    }, req);
  }

  // Stats endpoint
  if (req.method === 'GET' && req.url === '/stats') {
    return jsonResponse(res, 200, {
      uptime: process.uptime() | 0,
      requests: requestCount,
      modelFast: MODEL_FAST,
      modelPremium: MODEL_PREMIUM,
      memoryMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
      rateLimits: rateLimits.size,
    }, req);
  }

  // Main endpoint
  if (req.method === 'POST' && req.url === '/ai/css-editor') {
    const t0 = Date.now();
    let body;

    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      log('warn', 'Invalid request body', { requestId, error: err.message });
      return jsonResponse(res, 400, { ops: [], error: 'Invalid JSON body' }, req);
    }

    const { prompt, origin } = body;

    // Validate prompt
    if (!prompt || typeof prompt !== 'string') {
      return jsonResponse(res, 400, { ops: [], error: 'Missing or invalid "prompt" field' }, req);
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return jsonResponse(res, 400, { ops: [], error: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars)` }, req);
    }

    // Rate limit check
    if (!checkRateLimit(origin)) {
      log('warn', 'Rate limited', { requestId, origin });
      return jsonResponse(res, 429, { ops: [], error: 'Rate limit exceeded. Try again in a minute.' }, req);
    }

    try {
      const ops = await callOpenClaw(prompt, origin);
      const elapsed = Date.now() - t0;
      log('info', 'Request completed', { requestId, origin, ops: ops.length, ms: elapsed });
      return jsonResponse(res, 200, { ops }, req);
    } catch (err) {
      const elapsed = Date.now() - t0;
      const isTimeout = err.name === 'AbortError';
      log('error', 'LLM call failed', {
        requestId, origin, error: err.message, ms: elapsed, timeout: isTimeout,
      });
      const userError = isTimeout
        ? 'Request timed out. Try a simpler prompt.'
        : 'AI processing failed. Try again.';
      return jsonResponse(res, 200, { ops: [], error: userError }, req);
    }
  }

  jsonResponse(res, 404, { error: 'Not found' }, req);
});

server.listen(PORT, () => {
  log('info', 'AI proxy started', { port: PORT, modelFast: MODEL_FAST, modelPremium: MODEL_PREMIUM, openclaw: OPENCLAW_URL });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'Shutting down...');
  server.close(() => process.exit(0));
});
