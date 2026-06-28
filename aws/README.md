# AWS-native backend (Bedrock RAG)

The AWS variant of the chat brain. The widget and the Cloudflare Worker stay; this
replaces **only the text generation** (Groq → Amazon Bedrock RAG). Voice stays on
ElevenLabs via the Worker's `/speak` route.

```
  Browser widget (unchanged)
        │  POST {messages}                         POST {text}
        ▼                                              │
  Cloudflare Worker ──────────────┐                    ▼
        │ POST {question}          └──────────►  ElevenLabs  (your cloned voice)
        ▼  (x-ask-hamza-key)
  Lambda Function URL ──► Lambda (Python 3.12)
        │  bedrock-agent-runtime:RetrieveAndGenerate
        │    numberOfResults=3, capped maxTokens, first-person grounded prompt
        ▼
  Bedrock Knowledge Base ──► S3 Vectors index (1024-dim, cosine)
        │  embed query (Titan v2) · generate (Claude 3 Haiku)
        ▼
  {answer, citations}  →  Worker returns {reply}  →  widget renders + ElevenLabs reads it
```

Why this shape: the Worker must stay anyway (it holds the ElevenLabs key), so routing
chat through it keeps the existing domain-lock + keys-server-side model and means the
widget needs **zero changes**. The whole retrieval/generation pipeline is real AWS.

## Verified facts (checked before writing, not from memory)

- **Generation**: `anthropic.claude-3-haiku-20240307-v1:0` — cheapest Claude and supports
  on-demand in us-east-1, so **no inference profile needed**.
- **Embeddings**: `amazon.titan-embed-text-v2:0`, 1024-dim, cosine.
- **S3 Vectors**: GA since Dec 2025 (us-east-1 + 13 more, incl. eu-north-1). Metrics: cosine/euclidean.
- **Terraform path: fully native** — provider ships `aws_s3vectors_vector_bucket`,
  `aws_s3vectors_index`, and KB `s3_vectors_configuration { index_arn }`. Needs provider **≥ 6.27.0**.
- **Region**: defaults to **us-east-1** (widest Bedrock + S3 Vectors coverage; KB must
  live in the model's region). eu-north-1 now has S3 Vectors too but Claude access is patchier.

**Assumptions flagged:** index needs `AMAZON_BEDROCK_TEXT`/`AMAZON_BEDROCK_METADATA` as
non-filterable metadata keys (set in the index resource), else ingestion fails. Guardrail
arg names are new — it's the disabled stretch.

## Deploy

Prereqs: Terraform ≥ 1.6, AWS CLI v2, AWS account with free-tier credits.

1. **Enable Bedrock model access** (one-time, in the deploy region): Bedrock console →
   *Model access* → enable **Anthropic Claude 3 Haiku** and **Titan Text Embeddings V2**.
   Without this, apply + ingestion fail with AccessDenied.

2. **Provision:**
   ```bash
   cd aws/terraform
   terraform init
   terraform apply           # add: -var 'shared_secret=<random-string>'   (recommended)
   ```

3. **Load + index the corpus** (`aws/docs/*.md` — already filled with your real facts):
   ```bash
   aws s3 sync ../docs "s3://$(terraform output -raw docs_bucket)"
   eval "$(terraform output -raw ingestion_command)"   # start-ingestion-job
   ```
   Re-run both whenever you edit `aws/docs/`.

4. **Point the Worker at AWS:**
   ```bash
   terraform output -raw function_url        # paste into worker/wrangler.toml RAG_URL
   ```
   Then, in `worker/`:
   ```bash
   wrangler secret put ELEVENLABS_API_KEY    # your existing key
   wrangler secret put ASK_HAMZA_KEY         # only if you set shared_secret above
   wrangler deploy
   ```
   The widget already calls the Worker, so nothing else changes on the front-end.
   (You can retire the old `GROQ_API_KEY` secret.)

## Eval

```bash
python aws/eval/run_eval.py "$(terraform -chdir=aws/terraform output -raw function_url)"
```
Hits the Function URL directly with `eval/eval.jsonl` (~8 Q/fact pairs incl. a
"must refuse, don't invent" case) and prints a groundedness pass rate. If you set a
`shared_secret`, this direct call will be 403'd — that's expected; test through the Worker
instead, or temporarily `-var shared_secret=""`.

## Cost & teardown

S3 Vectors has ~no idle cost (vs OpenSearch Serverless ~$345/mo); Lambda + CloudWatch fit
free-tier at portfolio traffic; Claude 3 Haiku at `maxTokens=400` × `numberOfResults=3` is
fractions of a cent per question.

- **Set a $1 budget alarm first:** AWS Billing → Budgets → $1 monthly cost budget, 80% email alert.
- **Tear down when idle:** `cd aws/terraform && terraform destroy` (buckets use `force_destroy`).

## Single-turn note

RAG here is single-turn — the Worker sends only the latest question. For "tell me more"
follow-ups, thread a `sessionId` from the widget through the Worker into
`retrieve_and_generate(sessionId=...)`. Skipped for now (YAGNI for short portfolio Q&A).

## CLI fallback (only if pinned to provider < 6.27.0)

```bash
aws s3vectors create-vector-bucket --vector-bucket-name ask-hamza-vectors-<acct>
aws s3vectors create-index \
  --vector-bucket-name ask-hamza-vectors-<acct> --index-name ask-hamza-index \
  --data-type float32 --dimension 1024 --distance-metric cosine \
  --metadata-configuration '{"nonFilterableMetadataKeys":["AMAZON_BEDROCK_TEXT","AMAZON_BEDROCK_METADATA"]}'
```
Then replace `aws_s3vectors_index.this.index_arn` in `main.tf` with a `var.index_arn`.
