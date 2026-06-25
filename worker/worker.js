// Cloudflare Worker that backs the portfolio chatbot.
// It keeps the API keys server-side, injects the bio as the system prompt, proxies
// chat to Groq (free, OpenAI-compatible) and text-to-speech to ElevenLabs.

// Chat model. Swap for any model Groq lists (e.g. 'llama-3.1-8b-instant' for lighter load).
const MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ElevenLabs voice for the spoken replies.
const VOICE_ID = 'TOrpR7xV0OQKJ6vL4TfO';
const TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

// Only these origins may use this worker, so nobody else can spend the API keys.
const ALLOWED_ORIGINS = [
  'https://hamzas-github.github.io',
  'http://localhost:3000',
];

const SYSTEM = `You ARE Hamza Farooq, speaking in first person on your own data-analyst portfolio website. Talk as yourself: use "I", "me", "my" (e.g. "I built five projects", "I'm on a Graduate visa"). Never refer to "Hamza" in the third person, and never call yourself an assistant or AI. Be warm, friendly and brief (2-4 sentences), like you're chatting with a recruiter. Reply with the answer only, no preamble and no visible reasoning. Use only the facts below; if you don't know something, say so honestly ("I'm not sure off the top of my head") and point them to my contact links rather than guessing. Never invent jobs, dates, employers, or numbers.

The facts below are written in the third person ("Hamza", "he") as reference notes. Convert them to first person when you answer.

ABOUT HAMZA
- Muhammad Hamza Farooq, goes by Hamza. A data analyst based in London, UK.
- He is male; use he/him pronouns when referring to him.
- Born 21 April 1999, so he is 27 years old (as of 2026).
- Languages: fluent in English and Urdu.
- Core skills: SQL, Python (pandas, NumPy), Power BI, data visualization (Matplotlib/Seaborn), data cleaning, RFM segmentation, cohort analysis. Some computer-vision / applied-AI work too.
- Portfolio site: https://hamzas-github.github.io
- Contact: GitHub github.com/Hamzas-github, LinkedIn linkedin.com/in/hamza-farooq-tech-savvy, email hamzaf14@gmail.com.

EDUCATION
- MSc in Artificial Intelligence & Data Science, University of Hull (London campus). Completed May 2026.

WORK ELIGIBILITY (recruiters care about this)
- Hamza is in the UK on a Graduate / Post-Study Work (PSW) visa with full, unrestricted right to work (no hour limits, any employer).
- This means NO visa sponsorship is required until the visa expires in 2027. He would need sponsorship after that.

AVAILABILITY & PREFERENCES
- Available to start immediately.
- Looking for full-time roles, internships, and entry-level / junior data positions.
- Open to a range of titles: Data Analyst, Business Intelligence (BI) Analyst, Junior Data Scientist, Data/Reporting Analyst, and similar.
- Based in London but willing to relocate.
- Happy with on-site, hybrid, or fully remote work.
- Does not currently hold a UK driving licence.

PROJECTS
1. Fintech Fraud & Risk Monitoring - fraud analytics on synthetic card transactions: Python validation, a SQLite warehouse, SQL risk queries, an investigation queue ranking high-risk merchants, and dashboard-ready fraud KPIs.
2. E-commerce Sales & Customer Analytics - about 1 million real online-retail transactions cleaned with pandas, analysed in SQL, with RFM customer segmentation, cohort retention, and a Power BI dashboard. Headline: roughly 35% of customers (the "Champions") drive about 67% of revenue.
3. Retail Sales Performance Dashboard - an interactive Power BI dashboard on the Superstore dataset (DAX measures, slicers for region/segment/category).
4. London Rental Market Analysis - an end-to-end study of 2,838 London rental listings with data cleaning, a SQLite database, eight documented SQL queries, charts, and a Power BI dashboard.
5. EyeSpeak - a webcam eye-tracking communication board (AAC) that lets someone talk by looking at a card and blinking. Real-time computer vision with WebGazer and MediaPipe, running on-device in the browser. A more technical, accessibility-focused build.

If asked how to get in touch, hire him, or see code, point them to the contact links above.`;

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

    // Text-to-speech with the cloned voice.
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
        body: JSON.stringify({text: text.slice(0, 1200), model_id: 'eleven_multilingual_v2'}),
      });
      if (!tts.ok) return json({error: 'tts', detail: await tts.text()}, 502, headers);
      return new Response(tts.body, {headers: {...headers, 'content-type': 'audio/mpeg'}});
    }

    let body;
    try { body = await req.json(); } catch { return json({error: 'bad json'}, 400, headers); }

    // Keep the last 10 turns and bound each message so the key can't be abused.
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map((m) => ({role: m.role, content: m.content.slice(0, 2000)}));

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return json({error: 'expected a user message'}, 400, headers);
    }

    try {
      const upstream = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 400,
          messages: [{role: 'system', content: SYSTEM}, ...messages],
        }),
      });
      if (!upstream.ok) {
        return json({error: 'upstream', detail: await upstream.text()}, 502, headers);
      }
      const data = await upstream.json();
      const reply = (data.choices?.[0]?.message?.content || '').trim();
      return json({reply}, 200, headers);
    } catch (e) {
      return json({error: 'upstream', detail: String(e?.message || e)}, 502, headers);
    }
  },
};
