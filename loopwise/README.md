# Loopwise — site + AI audit tool

A small Express server serves the static site (`public/index.html`) and
exposes one API route, `POST /api/audit`, which calls OpenAI's Chat
Completions API using a key stored **server-side only**. Your key never
reaches the browser, so this works the same from any device — phone,
laptop, whatever.

## Deploying on Replit

1. Go to replit.com → **Create App** → **Import from a folder / zip**
   (or "Blank Repl" → Node.js, then upload these files).
2. Once imported, open the **Secrets** tool (padlock icon in the left
   sidebar) and add:
   - `OPENAI_API_KEY` → your OpenAI API key (starts with `sk-`)
   - optionally `OPENAI_MODEL` → e.g. `gpt-4o-mini` (this is the default
     if you don't set it)
3. Click **Run**. Replit will run `npm install && npm start`
   automatically (see `.replit`).
4. Replit gives you a public URL (something like
   `https://loopwise-site.yourname.repl.co`) — that's your live site,
   reachable from any device, no local setup needed.

That's it — the "Generate my free audit" button on the page will now
call your backend, which calls OpenAI, and streams the text back.

## Running locally (optional)

```bash
npm install
cp .env.example .env   # then edit .env and add your real key
node -r dotenv/config server.js   # or: npm i dotenv, then `require('dotenv').config()` at the top of server.js
```

(Replit's Secrets tool injects env vars automatically, so you don't need
`dotenv` there — it's only useful if you want to test on your own machine
first.)

## Files

- `server.js` — Express app: serves `public/`, handles `POST /api/audit`
- `public/index.html` — the site (same design as the original, but the
  audit button now calls `/api/audit` instead of `claude.use('sample')`)
- `package.json` — dependencies (just `express`)
- `.replit` / `replit.nix` — tells Replit how to run the Node app
- `.env.example` — shows what secret to set (don't commit a real `.env`)

## Notes / things you may want to tweak

- **Rate limiting**: `server.js` has a very basic in-memory limiter (5
  requests/minute per IP) so a bot can't burn through your OpenAI
  credits. It resets whenever the server restarts — fine for a small
  site, not bulletproof. Swap in Redis or similar if traffic grows.
- **Model**: defaults to `gpt-4o-mini` (cheap and fast). Change
  `OPENAI_MODEL` in Secrets to use `gpt-4o` or another model if you want
  higher quality answers.
- **Custom domain**: Replit lets you point your own domain at the
  deployment from the "Deployments" tab if you want `loopwise.com`
  instead of the `.repl.co` URL.
