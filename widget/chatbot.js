// Floating chatbot widget. Framework-free: drop one <script> tag on any page.
//   <script src="chatbot.js" data-endpoint="https://your-worker.workers.dev"></script>
// Optional: data-accent="#cc7b57", data-greeting="Hi, I'm ...".
//
// The liquid-glass refraction is ported from github.com/archisvaze/liquid-glass.
(function () {
  const script = document.currentScript;
  const ENDPOINT = (script && script.dataset.endpoint) || window.CHATBOT_ENDPOINT;
  if (!ENDPOINT) { console.warn('chatbot: missing data-endpoint'); return; }
  const ACCENT = (script && script.dataset.accent) || '#cc7b57';
  const GREETING = (script && script.dataset.greeting) || "Hi, I'm Hamza. Ask me about my projects, skills, or background.";
  const speakUrl = ENDPOINT.replace(/\/$/, '') + '/speak';

  // ---- styles ----
  const css = `
.hfc-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.hfc-fab{width:54px;height:54px;display:grid;place-items:center;border:1px solid ${ACCENT};background:${ACCENT};color:#fff;border-radius:999px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.3);transition:transform .18s ease}
.hfc-fab:hover{transform:translateY(-2px) scale(1.05)}
.hfc-fab svg{width:26px;height:26px;display:block}
.hfc-panel{position:absolute;right:0;bottom:66px;width:min(360px,88vw);height:min(520px,70vh);display:flex;flex-direction:column;background:transparent;isolation:isolate;border:1px solid rgba(255,255,255,.18);border-radius:22px;overflow:hidden;color:#f2efec;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.hfc-panel::after{content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;backdrop-filter:url(#chatLiquidGlass) blur(2px);-webkit-backdrop-filter:blur(8px)}
.hfc-panel::before{content:'';position:absolute;inset:0;z-index:0;border-radius:inherit;pointer-events:none;background:rgba(14,12,11,.26);box-shadow:inset 0 0 26px -4px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.3)}
.hfc-panel>*{position:relative;z-index:1}
.hfc-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid rgba(255,255,255,.12);font-weight:600;color:#fff}
.hfc-close{background:none;border:none;font-size:1.4rem;line-height:1;color:rgba(255,255,255,.6);cursor:pointer}
.hfc-list{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.7rem}
.hfc-row{max-width:90%}
.hfc-row.user{align-self:flex-end;max-width:85%}
.hfc-row.bot{align-self:flex-start}
.hfc-bubble{padding:.6rem .85rem;border-radius:14px;font-size:.92rem;line-height:1.5;white-space:pre-wrap}
.hfc-row.user .hfc-bubble{background:${ACCENT};color:#fff;border-bottom-right-radius:4px}
.hfc-row.bot .hfc-bubble{background:rgba(255,255,255,.1);color:#f2efec;border:1px solid rgba(255,255,255,.12);border-bottom-left-radius:4px}
.hfc-inputrow{display:flex;gap:.5rem;padding:.7rem;border-top:1px solid rgba(255,255,255,.12)}
.hfc-input{flex:1;resize:none;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:.55rem .7rem;font-family:inherit;font-size:.92rem;background:rgba(0,0,0,.25);color:#fff;max-height:96px}
.hfc-input::placeholder{color:rgba(255,255,255,.45)}
.hfc-input:focus{outline:none;border-color:${ACCENT}}
.hfc-send{border:1px solid ${ACCENT};background:${ACCENT};color:#fff;border-radius:10px;padding:0 .9rem;font-weight:600;cursor:pointer}
.hfc-send:disabled{opacity:.5;cursor:default}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- liquid glass (Snell's-law refraction -> SVG displacement map -> backdrop-filter) ----
  const FILTER_ID = 'chatLiquidGlass';
  const SURFACE = (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);
  const GLASS_THICKNESS = 70, BEZEL = 60, IOR = 2.2, SCALE_RATIO = 1, BLUR = 0.4, SPEC_OPACITY = 0.5, SPEC_SAT = 4;

  function refractionProfile(thick, bezel, ior, samples = 128) {
    const eta = 1 / ior;
    const refract = (nx, ny) => {
      const k = 1 - eta * eta * (1 - ny * ny);
      if (k < 0) return null;
      const sq = Math.sqrt(k);
      return [-(eta * ny + sq) * nx, eta - (eta * ny + sq) * ny];
    };
    const p = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = i / samples, y = SURFACE(x), dx = x < 1 ? 0.0001 : -0.0001;
      const deriv = (SURFACE(x + dx) - y) / dx, mag = Math.sqrt(deriv * deriv + 1);
      const r = refract(-deriv / mag, -1 / mag);
      p[i] = r ? r[0] * ((y * bezel + thick) / r[1]) : 0;
    }
    return p;
  }
  function mapCanvas(w, h, radius, bezel, fill, write) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    fill(d);
    const r = radius, rSq = r * r, r1Sq = (r + 1) ** 2, rBSq = Math.max(r - bezel, 0) ** 2;
    const wB = w - r * 2, hB = h - r * 2;
    for (let y1 = 0; y1 < h; y1++) for (let x1 = 0; x1 < w; x1++) {
      const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
      const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
      const dSq = x * x + y * y;
      if (dSq > r1Sq || dSq < rBSq) continue;
      const dist = Math.sqrt(dSq), fromSide = r - dist;
      const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
      if (op <= 0 || dist === 0) continue;
      write(d, (y1 * w + x1) * 4, x / dist, y / dist, dist, fromSide, op);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }
  function displacementMap(w, h, radius, bezel, profile, maxDisp) {
    const S = profile.length;
    return mapCanvas(w, h, radius, bezel,
      (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 255; } },
      (d, idx, cos, sin, dist, fromSide, op) => {
        const disp = profile[Math.min(((fromSide / bezel) * S) | 0, S - 1)] || 0;
        d[idx] = (128 + (-cos * disp) / maxDisp * 127 * op + 0.5) | 0;
        d[idx + 1] = (128 + (-sin * disp) / maxDisp * 127 * op + 0.5) | 0;
      });
  }
  function specularMap(w, h, radius, bezel, angle = Math.PI / 3) {
    const sv = [Math.cos(angle), Math.sin(angle)];
    return mapCanvas(w, h, radius, bezel,
      (d) => d.fill(0),
      (d, idx, cos, sinRaw, dist, fromSide, op) => {
        const sin = -sinRaw;
        const dot = Math.abs(cos * sv[0] + sin * sv[1]);
        const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2));
        const coeff = dot * edge, col = (255 * coeff) | 0;
        d[idx] = col; d[idx + 1] = col; d[idx + 2] = col; d[idx + 3] = (col * coeff * op) | 0;
      });
  }
  const defsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defsSvg.setAttribute('aria-hidden', 'true');
  defsSvg.style.cssText = 'position:absolute;width:0;height:0';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defsSvg.appendChild(defs);
  document.body.appendChild(defsSvg);

  function buildGlass(panel, radius) {
    const w = panel.offsetWidth, h = panel.offsetHeight;
    if (w < 2 || h < 2) return;
    const bezel = Math.min(BEZEL, radius - 1, Math.min(w, h) / 2 - 1);
    const profile = refractionProfile(GLASS_THICKNESS, bezel, IOR);
    const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
    const dispUrl = displacementMap(w, h, radius, bezel, profile, maxDisp);
    const specUrl = specularMap(w, h, radius, bezel * 2.5);
    const scale = maxDisp * SCALE_RATIO;
    defs.innerHTML = `
      <filter id="${FILTER_ID}" x="0%" y="0%" width="100%" height="100%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${BLUR}" result="b"/>
        <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp"/>
        <feDisplacementMap in="b" in2="disp" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="dd"/>
        <feColorMatrix in="dd" type="saturate" values="${SPEC_SAT}" result="sat"/>
        <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="spec"/>
        <feComposite in="sat" in2="spec" operator="in" result="sm"/>
        <feComponentTransfer in="spec" result="sf"><feFuncA type="linear" slope="${SPEC_OPACITY}"/></feComponentTransfer>
        <feBlend in="sm" in2="dd" mode="normal" result="ws"/>
        <feBlend in="sf" in2="ws" mode="normal"/>
      </filter>`;
  }

  // ---- voice ----
  function browserSpeak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    speechSynthesis.speak(u);
  }
  async function speak(text) {
    try {
      const res = await fetch(speakUrl, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({text}),
      });
      if (!res.ok) throw new Error('tts');
      new Audio(URL.createObjectURL(await res.blob())).play();
    } catch { browserSpeak(text); }
  }

  // ---- DOM ----
  const root = document.createElement('div');
  root.className = 'hfc-root';
  root.innerHTML = `
    <div class="hfc-panel" role="dialog" aria-label="Chat" hidden>
      <div class="hfc-header"><span>Ask about Hamza</span><button class="hfc-close" aria-label="Close chat">&times;</button></div>
      <div class="hfc-list"></div>
      <div class="hfc-inputrow">
        <textarea class="hfc-input" rows="1" placeholder="Type a question..."></textarea>
        <button class="hfc-send" disabled>Send</button>
      </div>
    </div>
    <button class="hfc-fab" aria-label="Open chat">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.99 3 3 6.36 3 10.5c0 2.2 1.13 4.17 2.94 5.52-.13 1.06-.6 2.3-1.54 3.32-.2.22-.06.58.23.6 1.86.12 3.6-.5 4.86-1.4 1.06.3 2.2.46 3.5.46 5.01 0 9-3.36 9-7.5S17.01 3 12 3z"/></svg>
    </button>`;
  document.body.appendChild(root);

  const panel = root.querySelector('.hfc-panel');
  const fab = root.querySelector('.hfc-fab');
  const closeBtn = root.querySelector('.hfc-close');
  const list = root.querySelector('.hfc-list');
  const input = root.querySelector('.hfc-input');
  const sendBtn = root.querySelector('.hfc-send');
  const ICON_OPEN = fab.innerHTML;
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const history = [];        // user/assistant turns sent to the worker
  let open = false, loading = false, greeted = false;

  function addBubble(role, text) {
    const row = document.createElement('div');
    row.className = 'hfc-row ' + role;
    row.innerHTML = `<div class="hfc-bubble"></div>`;
    row.firstChild.textContent = text;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return row;
  }

  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    fab.innerHTML = v ? ICON_CLOSE : ICON_OPEN;
    fab.setAttribute('aria-label', v ? 'Close chat' : 'Open chat');
    if (v) {
      buildGlass(panel, 22);
      if (!greeted) { greeted = true; addBubble('bot', GREETING); speak(GREETING); }
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || loading) return;
    input.value = '';
    sendBtn.disabled = true;
    addBubble('user', text);
    history.push({role: 'user', content: text});
    loading = true;
    const thinking = addBubble('bot', '...');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({messages: history}),
      });
      const data = await res.json();
      const reply = data.reply || "Sorry, I couldn't answer that. Try the contact links on the site.";
      thinking.firstChild.textContent = reply;
      history.push({role: 'assistant', content: reply});
      speak(reply);
    } catch {
      thinking.firstChild.textContent = 'Network error, please try again.';
    } finally {
      loading = false;
      list.scrollTop = list.scrollHeight;
    }
  }

  fab.addEventListener('click', () => setOpen(!open));
  closeBtn.addEventListener('click', () => setOpen(false));
  sendBtn.addEventListener('click', send);
  input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  window.addEventListener('resize', () => { if (open) buildGlass(panel, 22); });
})();
