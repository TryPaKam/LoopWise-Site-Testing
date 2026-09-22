// Loopwise backend — serves the static site and proxies AI audit
// requests to Groq so the API key never touches the browser.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory lead store. This resets whenever the server restarts —
// fine for low volume, but for anything serious, wire this up to an
// email notification or a real database instead.
const leads = [];
const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.post('/api/lead', (req, res) => {
  const name = (req.body?.name || '').toString().trim().slice(0, 200);
  const email = (req.body?.email || '').toString().trim().slice(0, 200);
  const business = (req.body?.business || '').toString().trim().slice(0, 4000);

  if (!name || !email) {
    return res.status(400).json({ error: 'Missing name or email' });
  }

  const lead = { name, email, business, at: new Date().toISOString() };
  leads.push(lead);
  console.log('New lead:', JSON.stringify(lead));
  res.json({ ok: true });
});

// View captured leads: yoursite.com/api/leads?key=YOUR_ADMIN_KEY
// Set ADMIN_KEY in your host's environment variables / secrets to
// something only you know (e.g. Replit Secrets).
app.get('/api/leads', (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({ count: leads.length, leads });
});

// Very small in-memory rate limiter (per IP) so a stray script kiddie
// can't burn through your Groq credits. Resets on server restart —
// fine for a small marketing-site tool. For real production traffic,
// swap this for a proper store (Redis, etc).
const hits = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

app.post('/api/audit', async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'Server is missing GROQ_API_KEY.', code: 'upstream_error' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'Rate limited', code: 'rate_limited' });
    }

    const business = (req.body?.business || '').toString().trim();
    if (!business) {
      return res.status(400).json({ error: 'Missing business description', code: 'invalid_request' });
    }
    if (business.length > 4000) {
      return res.status(400).json({ error: 'Input too long', code: 'prompt_too_large' });
    }

    const prompt = `You are an automation consultant at Loopwise, an AI automation studio. A prospective client has described their business below (this may be a website link, a plain description, or both — work with whatever is given). Write a short, specific free automation audit for them.

Business info from the client:
"""
${business}
"""

Format your reply as plain text using exactly this structure (no other headers, no preamble before "## Quick take"):

## Quick take
One or two sentences showing you understood their specific business, and naming their single biggest automation opportunity — described as a cost (time, money, errors, missed sales), not as a workflow.

## 3 automation opportunities
- **Short bold title** — one sentence naming the manual task, and one sentence on the cost of doing it manually (hours lost, mistakes, customers waiting, revenue left on the table). Do NOT describe the mechanism, steps, or sequence of how it would work — no "captures X, then updates Y, then triggers Z." Just name the problem and its cost.
- **Short bold title** — same format.
- **Short bold title** — same format.

## Suggested first step
Not a build step. Something reflective or diagnostic they could do this week — e.g. tracking how many hours a specific task takes this week, or noting how many times a specific manual error happens — so they can see the cost for themselves. Never a system, workflow, or tool to set up.

Keep the whole answer under 180 words. Do not mention pricing or ask questions back. Do not invent specific facts (like named tools or numbers) you weren't given. Never name specific software, platforms, workflow steps, or any sequence of "what happens first, then next." Describe the pain and its cost, never the mechanism of the fix — the reader should feel the problem clearly and know Loopwise can fix it, but have nothing they could hand to someone else and build from. Sign off with "— The Loopwise Team" on its own line at the end.`;

    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({}));
      console.error('Groq error:', upstream.status, errBody);
      const code = upstream.status === 429 ? 'rate_limited' : 'upstream_error';
      return res.status(502).json({ error: errBody.error?.message || 'Upstream error', code });
    }

    const data = await upstream.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    if (!text) {
      return res.status(502).json({ error: 'Empty completion', code: 'empty_completion' });
    }

    res.json({ text });
  } catch (err) {
    console.error('Audit route error:', err);
    res.status(500).json({ error: 'Server error', code: 'upstream_error' });
  }
});

app.listen(PORT, () => {
  console.log(`Loopwise server running on port ${PORT}`);
});
