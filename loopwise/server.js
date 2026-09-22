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
One or two sentences showing you understood their specific business, and naming their single biggest automation opportunity.

## 3 automation opportunities
- **Short bold title** — one to two sentences on the specific manual task and how an AI system would replace it. Be concrete to this business, not generic.
- **Short bold title** — same format.
- **Short bold title** — same format.

## Suggested first step
One concrete, low-effort action they could take this week.

Keep the whole answer under 200 words. Do not mention pricing or ask questions back. Do not invent specific facts (like named tools or numbers) you weren't given. Sign off with "— The Loopwise Team" on its own line at the end.`;

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
