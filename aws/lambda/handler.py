"""Ask Hamza RAG Lambda: bedrock-agent-runtime RetrieveAndGenerate behind a Function URL.

POST {"question": "..."} -> {"answer": "...", "citations": ["s3://..."]}
"""
import json
import os

REGION = os.environ.get("AWS_REGION", "us-east-1")
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", "400"))
GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "")

# Lazy so the self-check below runs without boto3 / Lambda env present.
_agent = None


def _client():
    global _agent
    if _agent is None:
        import boto3
        from botocore.config import Config
        # Bounded retries + read timeout so a transient throttle is retried but a
        # hard one can't silently eat the whole Lambda timeout.
        cfg = Config(retries={"max_attempts": 3, "mode": "standard"},
                     connect_timeout=10, read_timeout=50)
        _agent = boto3.client("bedrock-agent-runtime", region_name=REGION, config=cfg)
    return _agent

# Orchestration prompt. $search_results$ and $output_format_instructions$ are
# substituted by Bedrock. Persona/style ported from the original Cloudflare Worker
# SYSTEM prompt; facts now come from retrieval instead of being hardcoded.
PROMPT_TEMPLATE = """You ARE Hamza Farooq, speaking in the first person on your own portfolio website. Talk as yourself: use "I", "me", "my" (e.g. "I built six projects", "I'm on a Graduate visa"). Never refer to "Hamza" in the third person, and never call yourself an assistant or AI unless directly asked.

STYLE
- Warm, friendly and concise, like chatting with a recruiter. Default to 2-4 sentences; go a little longer only when asked for detail on a specific project, then still keep it tight.
- Answer only — no preamble, no "great question", no visible reasoning, no bullet dumps unless asked.
- Refer to links by name ("my GitHub", "my LinkedIn", "just email me"), never paste a raw URL.

GROUND RULES
- Use ONLY the facts in the search results below. Never invent jobs, employers, dates, salaries, grades, certifications, or numbers. If a figure isn't there, don't make one up.
- The search results are written in the third person ("Hamza", "he") as reference notes. Convert them to first person when you answer.
- If the search results don't contain the answer, reply exactly: "I'm not sure off the top of my head — best to reach out via my LinkedIn or email and I'll get back to you."
- If asked whether you're a bot/AI: be honest in one breath, then carry on ("I'm an AI chat trained on Hamza's real background, answering as him — but everything I tell you about my experience is accurate.").
- Off-topic, personal, or inappropriate questions: politely steer back to my data/AI work.

Search results:
$search_results$

$output_format_instructions$
"""

# Optional shared secret. When set (via Terraform), the Worker must send it as the
# x-ask-hamza-key header — stops randoms from spending Bedrock budget on the public URL.
SHARED_SECRET = os.environ.get("SHARED_SECRET", "")

def _extract_citations(out):
    """Flatten RetrieveAndGenerate citations to a sorted, de-duped list of S3 URIs."""
    uris = set()
    for citation in out.get("citations", []):
        for ref in citation.get("retrievedReferences", []):
            uri = ref.get("location", {}).get("s3Location", {}).get("uri")
            if uri:
                uris.add(uri)
    return sorted(uris)


def _resp(status, body):
    # CORS headers are added by the Function URL config; we only set content type.
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _header(event, name):
    # Function URL lower-cases header keys.
    return (event.get("headers") or {}).get(name.lower(), "")


def handler(event, _context):
    if SHARED_SECRET and _header(event, "x-ask-hamza-key") != SHARED_SECRET:
        return _resp(403, {"error": "forbidden"})

    try:
        body = json.loads(event.get("body") or "{}")
    except (json.JSONDecodeError, TypeError):
        return _resp(400, {"error": "invalid JSON body"})

    question = (body.get("question") or "").strip()
    if not question:
        return _resp(400, {"error": "missing 'question'"})
    if len(question) > 1000:  # crude abuse / cost guard
        return _resp(400, {"error": "question too long"})

    gen_config = {
        "promptTemplate": {"textPromptTemplate": PROMPT_TEMPLATE},
        "inferenceConfig": {
            "textInferenceConfig": {"maxTokens": MAX_TOKENS, "temperature": 0.2}
        },
    }
    if GUARDRAIL_ID:
        gen_config["guardrailConfiguration"] = {
            "guardrailId": GUARDRAIL_ID,
            "guardrailVersion": GUARDRAIL_VERSION or "DRAFT",
        }

    out = _client().retrieve_and_generate(
        input={"text": question},
        retrieveAndGenerateConfiguration={
            "type": "KNOWLEDGE_BASE",
            "knowledgeBaseConfiguration": {
                "knowledgeBaseId": os.environ["KNOWLEDGE_BASE_ID"],
                "modelArn": os.environ["MODEL_ARN"],
                "retrievalConfiguration": {
                    "vectorSearchConfiguration": {"numberOfResults": 3}
                },
                "generationConfiguration": gen_config,
            },
        },
    )

    return _resp(200, {
        "answer": out.get("output", {}).get("text", ""),
        "citations": _extract_citations(out),
    })


if __name__ == "__main__":
    # ponytail: one self-check on the only non-trivial pure logic (citation parsing).
    sample = {
        "citations": [
            {"retrievedReferences": [
                {"location": {"s3Location": {"uri": "s3://b/projects.md"}}},
                {"location": {"s3Location": {"uri": "s3://b/cv.md"}}},
            ]},
            {"retrievedReferences": [
                {"location": {"s3Location": {"uri": "s3://b/cv.md"}}},  # dup
                {"location": {"type": "WEB"}},  # no s3 uri -> skipped
            ]},
        ]
    }
    assert _extract_citations(sample) == ["s3://b/cv.md", "s3://b/projects.md"]
    assert _extract_citations({}) == []
    print("ok")
