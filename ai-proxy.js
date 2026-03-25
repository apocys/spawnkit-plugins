#!/usr/bin/env node
// ai-proxy.js — Lightweight proxy that translates SpawnKit extension requests
// into OpenAI-compatible chat completions via the OpenClaw gateway.

const http = require('node:http');

const PORT = 3460;
const OPENCLAW_URL = 'http://localhost:18789/v1/chat/completions';
const MODEL = 'claudemax/claude-sonnet-4-20250514';

const SYSTEM_PROMPT = `You are a CSS and DOM manipulation assistant for web pages.
The user will describe a change they want to make to a website. You must return ONLY a valid JSON object with an "ops" array containing operations to apply.

Two kinds of operations are supported:

1. CSS operations — inject or override styles:
   { "kind": "css", "selector": "<CSS selector>", "styles": { "<property>": "<value>" } }

2. DOM operations — modify page elements:
   { "kind": "dom", "selector": "<CSS selector>", "action": "<replace|append|remove>", "html": "<HTML string>" }
   For "remove" actions, set "html" to an empty string.

Rules:
- Return ONLY the JSON object. No markdown, no code fences, no explanation.
- Be conservative: only modify exactly what the user asks for.
- Use specific selectors when possible; avoid overly broad selectors like "*".
- For CSS changes, prefer class/tag selectors over universal selectors.
- The "origin" field tells you which website the user is on — use it for context.
- If the request is ambiguous, make a reasonable best guess and keep changes minimal.

Example response:
{"ops":[{"kind":"css","selector":"body","styles":{"background":"#1a1a2e","color":"#e0e0e0"}}]}`;

// ── Helpers ──────────────────────────────────────────────────────────────

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  return {
    'Access-Control-Allow-Origin': origin.startsWith('chrome-extension://') ? origin : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Try to extract a JSON object from text that may contain markdown fences. */
function extractJSON(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch { /* continue */ }

  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // Find first { ... } block
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* continue */ }
  }

  return null;
}

// ── OpenClaw gateway call ────────────────────────────────────────────────

async function callOpenClaw(prompt, origin) {
  const userMessage = origin
    ? `Website: ${origin}\n\nRequest: ${prompt}`
    : prompt;

  const payload = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
  };

  const resp = await fetch(OPENCLAW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenClaw returned HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');

  const parsed = extractJSON(content);
  if (!parsed || !Array.isArray(parsed.ops)) {
    throw new Error(`Could not parse ops from LLM response: ${content.slice(0, 200)}`);
  }

  return parsed.ops;
}

// ── HTTP server ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    return jsonResponse(res, 200, { status: 'ok' }, req);
  }

  // Main endpoint
  if (req.method === 'POST' && req.url === '/ai/css-editor') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return jsonResponse(res, 400, { ops: [], error: 'Invalid JSON body' }, req);
    }

    const { prompt, origin } = body;
    if (!prompt || typeof prompt !== 'string') {
      return jsonResponse(res, 400, { ops: [], error: 'Missing or invalid "prompt" field' }, req);
    }

    try {
      const ops = await callOpenClaw(prompt, origin);
      return jsonResponse(res, 200, { ops }, req);
    } catch (err) {
      console.error('[ai-proxy] LLM error:', err.message);
      return jsonResponse(res, 200, { ops: [], error: err.message }, req);
    }
  }

  jsonResponse(res, 404, { error: 'Not found' }, req);
});

server.listen(PORT, () => {
  console.log(`[ai-proxy] Listening on http://localhost:${PORT}`);
  console.log(`[ai-proxy] POST /ai/css-editor  →  OpenClaw (${OPENCLAW_URL})`);
});
