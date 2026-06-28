# Talk to my portfolio

Most people skim a portfolio for ten seconds and leave with questions they never ask. So I built a little chat that answers them for me. It sits in the corner of my site, and when you open it you can ask anything about my work, my skills, or whether I need visa sponsorship. It replies in the first person, in my own voice, and it can read the answer out loud in a clone of my actual voice.

Live on my portfolio: https://hamzas-github.github.io

## What it does

- Answers questions about me in first person ("I built six projects", not "Hamza built").
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
worker/    the Cloudflare Worker (keys, chat + voice proxy)
widget/    the floating chat widget, one self-contained file
demo/      a standalone page to see it working
aws/       AWS-native backend: terraform / lambda / docs corpus / eval
```

## AWS-native version (Bedrock + RAG + Terraform)

There's a second backend under [`aws/`](aws/README.md) that swaps the chat brain from
Groq to **Amazon Bedrock with a RAG Knowledge Base** — Titan v2 embeddings, **S3 Vectors**
as the near-free vector store, Claude 3 Haiku for generation, a Lambda behind a Function
URL, all in Terraform. The Worker stays as the front door and still does ElevenLabs voice;
it just calls AWS instead of Groq for the words, so the widget is unchanged. My real facts
now live as a retrieval corpus in `aws/docs/` instead of a hardcoded prompt.

```
browser widget  ->  Cloudflare Worker  ->  AWS Lambda  ->  Bedrock KB -> S3 Vectors
                                       ->  ElevenLabs (voice)
```

See [`aws/README.md`](aws/README.md) for deploy, ingestion, eval, cost and teardown.
