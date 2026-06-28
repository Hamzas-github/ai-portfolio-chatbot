// AWS-native chat: the Worker now proxies the question to an Amazon Bedrock RAG
// Lambda (Function URL) instead of Groq. Facts live in the Bedrock Knowledge Base
// and the persona prompt lives in the Lambda, so the big SYSTEM bio moved out of here.
// Voice is unchanged: /speak still streams ElevenLabs in Hamza's cloned voice.
//
// browser widget  ->  Cloudflare Worker  ->  AWS Lambda (Bedrock RetrieveAndGenerate)
//                                        ->  ElevenLabs (voice)
//
// Required env:
//   RAG_URL          the Lambda Function URL (terraform output `function_url`)
//   ELEVENLABS_API_KEY
// Optional env:
//   ASK_HAMZA_KEY    shared secret; must equal the Lambda's SHARED_SECRET if you set one

// ElevenLabs voice clone for the "Read aloud" button.
const VOICE_ID = 'TOrpR7xV0OQKJ6vL4TfO';
const TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

// Only these origins may use this worker (so nobody else can spend your quota).
const ALLOWED_ORIGINS = [
  'https://hamzas-github.github.io',
  'http://localhost:3000',
];

// Make links speakable: say what a link IS, not its raw characters.
function speakable(text) {
  return text
    .replace(/[\s,]*(?:\b(?:at|on|via)\b|:|-)?\s*\(?(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|hamzas-github\.github\.io)\/?\S*\)?/gi, '')
    .replace(/[\s,]*(?:\b(?:at|on|via)\b|:)?\s*\(?[^\s@]+@[^\s@]+\.[^\s@]+\)?/gi, '')
    .replace(/[\s,]*\(?https?:\/\/\S+\)?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {'content-type': 'application/json', ...headers},
  });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (req.method === 'OPTIONS') return new Response(null, {headers});
    if (req.method !== 'POST') return json({error: 'POST only'}, 405, headers);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({error: 'forbidden'}, 403, headers);

    // Text-to-speech with Hamza's cloned voice (unchanged).
    if (new URL(req.url).pathname === '/speak') {
      let text;
      try { text = (await req.json()).text; } catch { return json({error: 'bad json'}, 400, headers); }
      if (typeof text !== 'string' || !text.trim()) return json({error: 'no text'}, 400, headers);
      const tts = await fetch(TTS_URL, {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({text: speakable(text).slice(0, 1200), model_id: 'eleven_multilingual_v2'}),
      });
      if (!tts.ok) return json({error: 'tts', detail: await tts.text()}, 502, headers);
      return new Response(tts.body, {headers: {...headers, 'content-type': 'audio/mpeg'}});
    }

    // Chat: forward the latest question to the AWS Bedrock RAG Lambda.
    let body;
    try { body = await req.json(); } catch { return json({error: 'bad json'}, 400, headers); }

    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') {
      return json({error: 'expected a user message'}, 400, headers);
    }
    // RAG (RetrieveAndGenerate) is single-turn here: we send only the latest question.
    // For follow-ups, pass a sessionId through to the Lambda — see aws/README.md.
    const question = last.content.slice(0, 1000);

    try {
      const upstream = await fetch(env.RAG_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(env.ASK_HAMZA_KEY ? {'x-ask-hamza-key': env.ASK_HAMZA_KEY} : {}),
        },
        body: JSON.stringify({question}),
      });
      if (!upstream.ok) {
        return json({error: 'upstream', detail: await upstream.text()}, 502, headers);
      }
      const data = await upstream.json();
      return json({reply: (data.answer || '').trim()}, 200, headers);
    } catch (e) {
      return json({error: 'upstream', detail: String(e?.message || e)}, 502, headers);
    }
  },
};
