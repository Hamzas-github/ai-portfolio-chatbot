# Talk to my portfolio

Most people skim a portfolio for ten seconds and leave with questions they never ask. So I built a little chat that answers them for me. It sits in the corner of my site, and when you open it you can ask anything about my work, my skills, or whether I need visa sponsorship. It replies in the first person, in my own voice, and it can read the answer out loud in a clone of my actual voice.

Live on my portfolio: https://hamzas-github.github.io

## What it does

- Answers questions about me in first person ("I built five projects", not "Hamza built").
- Speaks each reply out loud using a clone of my voice, with the browser voice as a fallback.
- Sticks to a fixed set of facts about me and admits when it does not know something instead of making things up.

## How it is wired up

A static site cannot hold an API key without leaking it, so the browser never talks to the AI directly. Instead it calls a small Cloudflare Worker that holds the keys server-side and does two jobs:

```
browser widget  ->  Cloudflare Worker  ->  Groq (chat)
                                       ->  ElevenLabs (voice)
```

- The widget is one plain JavaScript file. No framework, no build step, drop in a script tag.
- The Worker injects my bio as the system prompt, caps the history to ten turns, and only answers requests from my own domain so nobody else can spend the quota.
- Chat runs on Groq's free tier (Llama 3.3 70B). Voice runs on ElevenLabs.

I picked this stack so the whole thing costs me close to nothing to run.

## Repo layout

```
worker/    the Cloudflare Worker (keys, bio, chat + voice proxy)
widget/    the floating chat widget, one self-contained file
demo/      a standalone page to see it working
```

## Run the demo locally

```bash
cd ai-portfolio-chatbot
python -m http.server 3000
# open http://localhost:3000/demo/
```

The demo points at my deployed Worker, which allows `localhost:3000`, so the chat works straight away.

## Deploy your own Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GROQ_API_KEY        # free key from console.groq.com
npx wrangler secret put ELEVENLABS_API_KEY  # optional, only for cloned voice
npm run deploy
```

Then point the widget at it:

```html
<script src="widget/chatbot.js"
        data-endpoint="https://your-worker.workers.dev"
        data-accent="#cc7b57"></script>
```

Edit the bio and the allowed origins near the top of `worker/worker.js`. Swap `MODEL` for any model Groq lists if you want it lighter or smarter.

## Notes

- The liquid-glass refraction is a port of [archisvaze/liquid-glass](https://github.com/archisvaze/liquid-glass). The SVG displacement filter is Chromium-only, so other browsers fall back to a plain frosted blur.
- Keys live only as Worker secrets, never in the repo or the browser.
