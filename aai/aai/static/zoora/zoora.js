/* ZOORA HUD client. Hand-written, no dependencies, no CDN.
   Every value on screen comes from /api/zoora/*. Data is rendered with textContent only (never innerHTML). */
(() => {
'use strict';

/* ------------------------------------------------------------ helpers */
const $ = (s) => document.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, cls, text, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  return n;
}
function sv(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) n.setAttribute(k, attrs[k]); return n; }
const isNum = (v) => typeof v === 'number' && isFinite(v);
function money(v, d = 2) {
  if (!isNum(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 ? '−$' : '$') + s;
}
function signed(v, d = 2) { return !isNum(v) ? '—' : (v > 0 ? '+' : '') + money(v, d); }
function pct(v, d = 1) { return isNum(v) ? (v * 100).toFixed(d) + '%' : '—'; }
function px(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (a === 0) return '0';
  return v.toPrecision(3);
}
function ago(sec) {
  if (!isNum(sec)) return '—';
  sec = Math.max(0, sec);
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.round(sec / 60) + 'm';
  if (sec < 172800) return (sec / 3600).toFixed(sec < 36000 ? 1 : 0) + 'h';
  return Math.round(sec / 86400) + 'd';
}
const STALE = 48 * 3600;
const TZ = 'America/Chicago';
const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtHM = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const SECTOR = { perps: 'Perps', forex: 'Forex', solana_meme: 'Memes', billy: 'Billy', stocks: 'Stocks', longterm: 'Long-term' };

/* ------------------------------------------------------------ state */
const S = {
  ov: null, lastOk: 0, fails: 0, seen: new Set(), firstAlerts: true, auditMax: 0,
  ideaTab: 'all', core: 'idle', history: [], hIdx: -1, booted: false,
  muted: localStorage.getItem('zoora.muted') === '1',
  sessionChime: localStorage.getItem('zoora.sessionChime') === '1',
  sessionOpen: Object.create(null),
  eqDays: (() => { const n = Number(localStorage.getItem('zoora.eqDays')); return [1, 7, 30].includes(n) ? n : 7; })(),
  eqCurve: null, eqFetch: 0,
  changeId: null, linkMode: 'poll', es: null,
};
// One-load ideas tab (?ideas=stocks) for screenshots / deep links; does not write localStorage.
(() => {
  const v = new URLSearchParams(location.search).get('ideas');
  const key = (v === 'memes' || v === 'meme') ? 'solana_meme' : v;
  if (key && Object.prototype.hasOwnProperty.call(SECTOR, key)) S.ideaTab = key;
})();

/* ------------------------------------------------------------ API */
async function api(path, body) {
  const opt = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    opt.method = 'POST';
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  if (r.status === 401) { location.href = '/zoora/login'; throw new Error('auth required'); }
  let data = null;
  try { data = await r.json(); } catch (_) { /* non-JSON */ }
  return { status: r.status, ok: r.ok, data };
}

/* ------------------------------------------------------------ clock */
function tickClock() {
  const d = new Date();
  $('#clockTime').textContent = fmtTime.format(d);
  $('#clockDate').textContent = fmtDate.format(d).toUpperCase();
  if (S.lastOk) $('#lastUpd').textContent = ago((Date.now() - S.lastOk) / 1000) + ' ago';
}

/* ------------------------------------------------------------ audio chime (WebAudio, generated) */
let actx = null;
function audioCtx() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => audioCtx(), { once: true, passive: true }));
function chime(kind) {
  if (S.muted || !actx || actx.state !== 'running') return;
  const now = actx.currentTime;
  const notes = kind === 'critical' ? [880, 660, 880, 660] : kind === 'wake' ? [660, 990] : [740, 988];
  notes.forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const t = now + i * 0.14;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(kind === 'critical' ? 0.09 : 0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + 0.55);
  });
}
function setMuted(m) {
  S.muted = m; localStorage.setItem('zoora.muted', m ? '1' : '0');
  $('#muteBtn').setAttribute('aria-pressed', String(m));
  $('#muteBtn').title = m ? 'Alert chime muted' : 'Alert chime on';
}

// High-contrast theme: explicit choice in localStorage `zoora.hc` ('1'/'0'); unset follows prefers-contrast: more.
const hcMQ = matchMedia('(prefers-contrast: more)');
function hcPref() { const v = localStorage.getItem('zoora.hc'); return v === '1' ? true : v === '0' ? false : hcMQ.matches; }
function applyHC(on) {
  document.documentElement.classList.toggle('hc', !!on);
  const b = $('#hcBtn'); if (b) { b.setAttribute('aria-pressed', String(!!on)); b.title = on ? 'High-contrast theme on (C)' : 'High-contrast theme off (C)'; }
}
function setHC(on) { try { localStorage.setItem('zoora.hc', on ? '1' : '0'); } catch (_) { /* private mode */ } applyHC(on); }
// ?hc=1 / ?hc=0 forces the theme for this page load only (headless screenshots), without saving a choice.
const hcQ = new URLSearchParams(location.search).get('hc');
applyHC(hcQ === '1' ? true : hcQ === '0' ? false : hcPref());
if (hcMQ.addEventListener) hcMQ.addEventListener('change', () => { if (localStorage.getItem('zoora.hc') === null) applyHC(hcMQ.matches); });

// Reduced-motion: explicit choice in localStorage `zoora.reduceMotion` ('1'/'0'); unset follows prefers-reduced-motion: reduce.
const rmMQ = matchMedia('(prefers-reduced-motion: reduce)');
function rmPref() { const v = localStorage.getItem('zoora.reduceMotion'); return v === '1' ? true : v === '0' ? false : rmMQ.matches; }
function applyRM(on) {
  document.documentElement.classList.toggle('rm', !!on);
  const b = $('#rmBtn'); if (b) { b.setAttribute('aria-pressed', String(!!on)); b.title = on ? 'Reduced motion on (R)' : 'Reduced motion off (R)'; }
}
function setRM(on) {
  try { localStorage.setItem('zoora.reduceMotion', on ? '1' : '0'); } catch (_) { /* private mode */ }
  applyRM(on);
  // user toggle: re-enter the rAF loop when motion is turned back on
  if (!on) try { Orb.resume(); } catch (_) { /* Orb not ready */ }
}
// ?rm=1 / ?rm=0 forces reduced motion for this page load only (headless screenshots), without saving a choice.
const rmQ = new URLSearchParams(location.search).get('rm');
applyRM(rmQ === '1' ? true : rmQ === '0' ? false : rmPref());
if (rmMQ.addEventListener) rmMQ.addEventListener('change', () => {
  if (localStorage.getItem('zoora.reduceMotion') === null) {
    applyRM(rmMQ.matches);
    if (!rmMQ.matches) try { Orb.resume(); } catch (_) { /* Orb not ready */ }
  }
});

// One-click bounded agent-guard audit (shared by the pipeline row button and the stale-audit alarm card).
async function runGuardAudit(b) {
  b.disabled = true; b.textContent = 'AUDITING…';
  try {
    const r = await api('/api/zoora/guard-audit/run', {});
    if (r.data && !r.data.started && r.data.reason) showReply('Audit not started: ' + String(r.data.reason).slice(0, 120), true);
  } catch (_) { /* surfaced on next poll */ }
  setTimeout(poll, 800);
}

// Screen-reader alarm announcements: the visible track is aria-live=off (it re-renders every frame);
// only alarms not announced before are spoken, critical/high via role=alert, others politely. Capped so a burst stays short.
const srSaid = new Set();
function announceAlarms(alerts, first) {
  const fresh = alerts.filter((a) => a.id && !srSaid.has(a.id));
  fresh.forEach((a) => srSaid.add(a.id));
  if (!fresh.length) return null;
  const urgent = fresh.filter((a) => a.sev === 'critical' || a.sev === 'high');
  const calm = fresh.filter((a) => !(a.sev === 'critical' || a.sev === 'high'));
  const say = (list) => {
    const head = list.slice(0, 3).map((a) => `${String(a.sev || '').toUpperCase()} alarm: ${a.title}`).join('. ');
    return list.length > 3 ? `${head}. Plus ${list.length - 3} more.` : head;
  };
  const out = { urgent: urgent.length ? say(urgent) : '', calm: '' };
  // on first paint only summarise non-urgent alarms instead of reading each one
  out.calm = calm.length ? (first ? `${calm.length} other active alarm${calm.length === 1 ? '' : 's'}.` : say(calm)) : '';
  const u = $('#srAlarmUrgent'), p = $('#srAlarm');
  if (u && out.urgent) u.textContent = out.urgent;
  if (p && out.calm) p.textContent = out.calm;
  return out;
}

/* ------------------------------------------------------------ orb */
const Orb = (() => {
  const cv = $('#orb'), ctx = cv.getContext('2d');
  let W = 0, t0 = performance.now(), amp = 0.15, target = 0.15, kick = 0, mode = 'idle', alarm = false;
  const wantReduce = () => document.documentElement.classList.contains('rm');
  const parts = Array.from({ length: 80 }, (_, i) => ({ a: Math.random() * Math.PI * 2, r: 0.5 + Math.random() * 0.42, s: (0.08 + Math.random() * 0.25) * (i % 2 ? 1 : -1), z: Math.random() }));
  function size() {
    const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(200, Math.round(r.width * d));
    if (w !== W) { W = w; cv.width = w; cv.height = w; }
  }
  function col(a) {
    if (alarm && mode === 'idle') return `rgba(255,96,120,${a})`;
    if (mode === 'thinking' || mode === 'speaking') return `rgba(255,190,90,${a})`;
    return `rgba(62,240,255,${a})`;
  }
  function frame(now) {
    size();
    const t = (now - t0) / 1000, c = W / 2, R = W * 0.46;
    target = { idle: 0.14, listening: 0.55, thinking: 0.35, speaking: 0.5 }[mode] || 0.14;
    amp += (target + kick - amp) * 0.08; kick *= 0.9;
    ctx.clearRect(0, 0, W, W);
    ctx.save(); ctx.translate(c, c);
    // outer tick ring
    ctx.rotate(t * 0.05);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2, long = i % 10 === 0;
      ctx.strokeStyle = col(long ? 0.7 : 0.22); ctx.lineWidth = W / 360 * (long ? 1.6 : 1);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R - (long ? R * 0.06 : R * 0.03)), Math.sin(a) * (R - (long ? R * 0.06 : R * 0.03))); ctx.stroke();
    }
    ctx.restore();
    // rotating arcs
    const arcs = [[0.86, 0.6, 1.4, 'amber'], [0.86, -0.4, 0.5, 'cyan'], [0.78, -1.1, 2.2, 'cyan'], [0.7, 0.9, 0.9, 'amber']];
    arcs.forEach(([rr, sp, len, k], i) => {
      ctx.beginPath(); ctx.lineWidth = W / (i % 2 ? 260 : 170); ctx.lineCap = 'round';
      ctx.strokeStyle = k === 'amber' && !(alarm && mode === 'idle') ? `rgba(255,181,71,${0.55 + amp * 0.4})` : col(0.55 + amp * 0.4);
      const a0 = t * sp * (mode === 'thinking' ? 2.6 : 1) + i;
      ctx.arc(c, c, R * rr, a0, a0 + len); ctx.stroke();
    });
    // dashed ring
    ctx.setLineDash([W / 90, W / 140]); ctx.lineWidth = 1; ctx.strokeStyle = col(0.35);
    ctx.beginPath(); ctx.arc(c, c, R * 0.62, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // particles
    parts.forEach((p) => {
      p.a += p.s * 0.01 * (1 + amp * 2);
      const r = R * p.r * (1 + Math.sin(t * 2 + p.z * 9) * 0.01);
      ctx.fillStyle = col(0.25 + p.z * 0.6);
      ctx.beginPath(); ctx.arc(c + Math.cos(p.a) * r, c + Math.sin(p.a) * r, W / 400 * (0.6 + p.z * 1.4), 0, Math.PI * 2); ctx.fill();
    });
    // waveform ring
    const base = R * 0.46, n = 160;
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const w = Math.sin(a * 6 + t * (2.2 + layer)) * 0.5 + Math.sin(a * 11 - t * 3.1) * 0.3 + Math.sin(a * 3 + t * 1.3 + layer) * 0.4;
        const r = base * (1 + w * amp * (0.11 - layer * 0.025));
        const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = col(0.75 - layer * 0.22); ctx.lineWidth = W / (220 + layer * 120); ctx.stroke();
    }
    // core sphere
    const cr = R * (0.26 + amp * 0.05 + Math.sin(t * 2.2) * 0.008);
    const g = ctx.createRadialGradient(c - cr * 0.3, c - cr * 0.35, cr * 0.1, c, c, cr * 1.6);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, col(0.95)); g.addColorStop(0.6, col(0.35)); g.addColorStop(1, col(0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, cr * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = W / 500;
    ctx.beginPath(); ctx.arc(c, c, cr * 0.82, 0, Math.PI * 2); ctx.stroke();
    if (!wantReduce()) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => { if (wantReduce()) requestAnimationFrame(frame); }, 1000);
  return {
    set(m) { mode = m; },
    alarm(on) { alarm = on; },
    kick(v = 0.35) { kick = Math.min(0.8, kick + v); },
    resume() { requestAnimationFrame(frame); },
  };
})();

const CORE_LABEL = { idle: 'STANDBY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING', wake: 'WAKE WORD ARMED' };
function setCore(m) {
  S.core = m;
  const core = $('#p-core');
  core.classList.remove('listening', 'thinking', 'speaking');
  if (m !== 'idle' && m !== 'wake') core.classList.add(m);
  Orb.set(m === 'wake' ? 'idle' : m);
  $('#coreState').textContent = CORE_LABEL[m] || m.toUpperCase();
  $('#micBtn').classList.toggle('live', m === 'listening');
  if (m === 'idle' && wake.on) $('#coreState').textContent = CORE_LABEL.wake;
}

/* ------------------------------------------------------------ captions + TTS */
let typeTimer = null;
function showReply(text, refused) {
  const n = $('#capZoora');
  n.classList.toggle('refused', !!refused);
  clearInterval(typeTimer);
  const full = String(text || '');
  let i = 0; const step = Math.max(1, Math.ceil(full.length / 60));
  n.textContent = '';
  typeTimer = setInterval(() => { i += step; n.textContent = full.slice(0, i); if (i >= full.length) clearInterval(typeTimer); }, 18);
}
/* TTS voice pick + barge-in. Saved voiceURI in localStorage `zoora.voice`; empty = Auto (preferred list).
 * stopTalking() is the barge-in: Esc / mic / Space / unchecking Voice replies cancels speech without sending a command. */
let voice = null;
let speaking = false;
function enVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
}
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = enVoices();
  const saved = (() => { try { return localStorage.getItem('zoora.voice') || ''; } catch (_) { return ''; } })();
  if (saved) {
    const hit = vs.find((x) => x.voiceURI === saved || x.name === saved);
    if (hit) { voice = hit; return; }
  }
  const prefs = [/Google UK English Female/i, /Samantha/i, /Serena/i, /(Aria|Jenny|Sonia|Libby).*Natural/i, /Microsoft (Aria|Jenny|Zira)/i, /Karen|Moira|Tessa|Fiona|Martha/i, /en-GB/i];
  for (const p of prefs) { const v = vs.find((x) => p.test(x.name) || p.test(x.lang)); if (v) { voice = v; return; } }
  voice = vs[0] || null;
}
function fillVoiceSelect() {
  const sel = $('#voiceSelect');
  if (!sel) return;
  if (!('speechSynthesis' in window)) { sel.disabled = true; return; }
  const vs = enVoices();
  const prev = sel.value;
  const saved = (() => { try { return localStorage.getItem('zoora.voice') || ''; } catch (_) { return ''; } })();
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = vs.length ? 'Auto (preferred)' : 'No English voices';
  sel.appendChild(auto);
  for (const v of vs) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = v.name + ' · ' + v.lang;
    sel.appendChild(o);
  }
  const want = saved || prev || '';
  sel.value = want && [...sel.options].some((o) => o.value === want) ? want : '';
  sel.disabled = vs.length === 0;
}
function stopTalking() {
  speaking = false;
  if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch (_) { /* ignore */ }
  if (S.core === 'speaking') { setCore('idle'); wake.resume(); }
}
if ('speechSynthesis' in window) {
  pickVoice(); fillVoiceSelect();
  speechSynthesis.onvoiceschanged = () => { pickVoice(); fillVoiceSelect(); };
}
function speak(text) {
  if (!text || !$('#speakToggle').checked || !('speechSynthesis' in window)) { speaking = false; setCore('idle'); wake.resume(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\$/g, ' dollars ').replace(/\bR\b/g, 'R').slice(0, 600));
  if (voice) u.voice = voice;
  u.rate = 1.0; u.pitch = 0.95; u.volume = 1;
  u.onstart = () => { speaking = true; setCore('speaking'); };
  u.onboundary = () => Orb.kick(0.25);
  u.onend = u.onerror = () => { speaking = false; setCore('idle'); wake.resume(); };
  wake.pause();
  speechSynthesis.speak(u);
}

/* ------------------------------------------------------------ commands */
const FOCUS = { risk: '#p-risk', positions: '#p-positions', ideas: '#p-ideas', memes: '#p-memes', security: '#p-security',
  longterm: '#p-longterm', pipelines: '#p-pipelines', alerts: '#alarm', fresh: '#p-fresh', audit: '#p-audit', economy: '#p-economy',
  intel: '#intel', macro: '#p-macro', calendar: '#p-calendar', derivs: '#p-derivs', cot: '#p-cot', filings: '#p-filings', fxdesk: '#p-fxdesk' };
function focusPanel(f) {
  const n = FOCUS[f] && $(FOCUS[f]);
  if (!n) return;
  n.classList.add('focus');
  setTimeout(() => n.classList.remove('focus'), 4500);
  if (innerWidth < 1281) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function ask(text, via) {
  text = String(text || '').trim();
  if (!text) return;
  S.history.unshift(text); S.history = S.history.slice(0, 40); S.hIdx = -1;
  $('#capYou').textContent = text;
  setCore('thinking');
  let d;
  try {
    const r = await api('/api/zoora', { text, via: via || 'typed' });
    d = r.data || { reply: `Request failed (HTTP ${r.status}).` };
  } catch (e) {
    d = { reply: 'I lost the link to the HUD server. Is it still running?' };
  }
  showReply(d.reply, d.refused);
  if (d.focus) focusPanel(d.focus);
  if (d.intent === 'economy') pollEconomy();
  if (['market_brief', 'calendar', 'funding', 'positioning', 'filings', 'rates'].includes(d.intent)) pollIntel();
  if (d.intent === 'ideas') {
    const m = text.toLowerCase().match(/\b(perps?|forex|fx|memes?|stocks?|billy)\b/);
    const map = { perp: 'perps', perps: 'perps', forex: 'forex', fx: 'forex', meme: 'solana_meme', memes: 'solana_meme', stock: 'stocks', stocks: 'stocks', billy: 'billy' };
    S.ideaTab = m ? map[m[1]] : 'all';
    if (S.ov) renderIdeas(S.ov);
  }
  speak(d.reply);
  if (d.job && d.job.id) pollJob(d.job.id);
  setTimeout(poll, 400);
}
async function pollJob(id) {
  const t0 = Date.now();
  const btn = $('#refreshHeavy');
  while (Date.now() - t0 < 180000) {
    await new Promise((r) => setTimeout(r, 1500));
    let j;
    try { const r = await api('/api/zoora/jobs/' + encodeURIComponent(id)); j = r.data && r.data.job; } catch (_) { return; }
    if (!j) return;
    if (j.status !== 'running') {
      showReply(j.reply || 'Done.', j.status === 'error');
      speak(j.reply);
      btn.disabled = false;
      poll();
      return;
    }
  }
}

/* ------------------------------------------------------------ speech recognition */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function note(t) { $('#voiceNote').textContent = t || ''; }
/* Push-to-talk:
 *  - hold mode (Space): ends on keyup (classic PTT)
 *  - tap mode (mic button): continuous recognition + silence VAD (end after ~1.2s with no new results)
 * Starting PTT always barge-in cancels a spoken reply. */
const ptt = {
  rec: null, active: false, final: '', mode: 'tap', silenceTimer: null, SILENCE_MS: 1200,
  clearSilence() { if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; } },
  armSilence() {
    if (this.mode !== 'tap') return;
    this.clearSilence();
    this.silenceTimer = setTimeout(() => { this.stop(); }, this.SILENCE_MS);
  },
  start(mode) {
    if (!SR) { note('Speech recognition is not available in this browser. Use Chrome or Edge on your own device, or type below.'); return; }
    if (this.active) return;
    this.mode = mode === 'hold' ? 'hold' : 'tap';
    stopTalking();  // barge-in: mic / Space stops Zoora mid-sentence
    wake.pause();
    audioCtx();
    const rec = new SR();
    // tap: continuous + silence timer acts as VAD end-of-utterance; hold: browser ends on stop()
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = this.mode === 'tap'; rec.maxAlternatives = 1;
    this.final = ''; this.rec = rec; this.active = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.final += r[0].transcript; else interim += r[0].transcript;
      }
      $('#capYou').textContent = (this.final + ' ' + interim).trim();
      Orb.kick(0.2);
      this.armSilence();
    };
    rec.onerror = (e) => {
      const msg = { 'not-allowed': 'Microphone permission denied. Allow the mic for this page (needs localhost or HTTPS).',
        'no-speech': 'I heard nothing. Hold Space or tap the mic and speak.', network: 'Speech service unreachable (the browser sends audio to its speech service).',
        'audio-capture': 'No microphone found.' }[e.error] || ('Speech error: ' + e.error);
      note(msg);
    };
    rec.onend = () => {
      this.clearSilence();
      this.active = false; this.rec = null;
      const text = this.final.trim();
      if (text) ask(text, 'voice'); else { setCore('idle'); wake.resume(); }
    };
    try {
      rec.start(); setCore('listening');
      note(this.mode === 'tap' ? 'Listening… pause ~1s when done (or tap mic / Esc).' : '');
      if (this.mode === 'tap') this.armSilence();  // end even if the user stays silent
    } catch (e) { this.active = false; this.clearSilence(); note('Mic busy: ' + e.message); }
  },
  stop() {
    this.clearSilence();
    if (this.rec) try { this.rec.stop(); } catch (_) { /* already stopped */ }
  },
  toggle() {
    if (this.active) this.stop();
    else if (speaking || S.core === 'speaking') stopTalking();
    else this.start('tap');
  },
};
const WAKE_RE = /\b(?:hey|hi|ok|okay)?\s*(zoora|zora|zorra|zura|sora|zoo ra|zoorah)\b[,.!?]?\s*(.*)$/i;
const wake = {
  on: false, rec: null, paused: false,
  enable(on) {
    this.on = on;
    localStorage.setItem('zoora.wake', on ? '1' : '0');
    if (on && !SR) { note('Wake word needs speech recognition (Chrome or Edge).'); $('#wakeToggle').checked = false; this.on = false; return; }
    on ? this.listen() : this.kill();
    setCore(S.core);
  },
  listen() {
    if (!this.on || this.paused || this.rec || ptt.active) return;
    const rec = new SR();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const m = e.results[i][0].transcript.match(WAKE_RE);
        if (!m) continue;
        const rest = (m[2] || '').trim();
        chime('wake'); Orb.kick(0.5);
        if (rest.split(/\s+/).filter(Boolean).length >= 2) { this.kill(); ask(rest, 'voice-wake'); }
        else { this.kill(); ptt.start(); }
        return;
      }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { note('Mic permission denied, wake word off.'); this.on = false; $('#wakeToggle').checked = false; } };
    rec.onend = () => { this.rec = null; if (this.on && !this.paused) setTimeout(() => this.listen(), 350); };
    try { rec.start(); this.rec = rec; } catch (_) { this.rec = null; }
  },
  kill() { const r = this.rec; this.rec = null; if (r) try { r.abort(); } catch (_) { /* ignore */ } },
  pause() { this.paused = true; this.kill(); },
  resume() { this.paused = false; if (this.on) setTimeout(() => this.listen(), 400); },
};

/* Narrow hook for zoora-voice.js (orb state + barge-in only). It exposes no API, command or state-changing call. */
window.ZooraHUD = Object.freeze({
  setCore: (m) => setCore(['idle', 'listening', 'thinking', 'speaking'].includes(m) ? m : 'idle'),
  kick: (v) => Orb.kick(Math.max(0, Math.min(0.5, Number(v) || 0))),
  stopTalking: () => stopTalking(),
  legacyPttActive: () => ptt.active,
});

/* ------------------------------------------------------------ renderers */
function setChip(id, text, cls, title) {
  const n = $(id);
  n.classList.remove('on', 'warn', 'bad');
  if (cls) n.classList.add(cls);
  const span = n.querySelector('span:not(.led)');
  if (span) span.textContent = text; else n.textContent = text;
  if (title) n.title = title;
}
function renderTop(ov) {
  const llm = ov.meta.llm || {};
  setChip('#chipLink', S.linkMode === 'sse' ? 'LIVE · SSE' : 'LIVE · POLL', 'on',
    S.linkMode === 'sse' ? 'Server-sent events from /api/zoora/stream (change_id push)' : 'Polling /api/zoora/overview (SSE unavailable or reconnecting)');
  setChip('#chipAuth', ov.meta.auth ? 'TOKEN AUTH' : 'NO TOKEN · LOCAL',
    ov.meta.auth ? 'on' : 'warn', ov.meta.auth ? 'AAI_HUD_TOKEN is set; every page and API call needs it.' : 'AAI_HUD_TOKEN is not set. Bound to 127.0.0.1 only. Set the token before any remote access.');
  setChip('#chipLLM', llm.present ? 'LLM · ' + String(llm.provider || '').toUpperCase() : 'LLM · NO KEY',
    llm.present ? 'on' : 'warn', llm.present ? `Free-form questions use ${llm.provider} (${llm.env}).` : 'No XAI_API_KEY or OPENAI_API_KEY in the HUD environment. Built-in intents still work; free-form questions need a key.');
  const g = ov.guard || {};
  setChip('#chipGuard', g.available ? 'AGENT-GUARD' : 'GUARD · FALLBACK', g.available ? 'on' : 'warn',
    g.available ? 'External text is sanitized with agent-guard helpers.' : 'agent-guard not importable; local sanitizer fallback in use.');
  $('#ver').textContent = 'v' + ov.version;
  $('#uptime').textContent = ago(ov.meta.uptime_sec);
}
const SEV_ORDER = { critical: 0, high: 1, warn: 2, info: 3 };
function renderAlarm(ov) {
  const gk = (ov.guard && ov.guard.global_kill) || {};
  const ak = ov.risk.kill_switch || {};
  const kg = $('#killGlobal'), ka = $('#killAAI');
  kg.classList.toggle('on', !!gk.engaged); kg.querySelector('b').textContent = gk.engaged ? 'ENGAGED' : 'OFF';
  kg.title = gk.engaged ? `Global kill ENGAGED: ${gk.reason || 'no reason given'}` : 'agent-guard global kill switch is off (bin/killswitch).';
  ka.classList.toggle('on', !!ak.on); ka.querySelector('b').textContent = ak.on ? 'TRIPPED' : 'ARMED';
  ka.title = ak.on ? `AAI kill switch ON: ${ak.reason || ''}` : 'AAI kill switch armed: trips at 5% daily loss or 15% drawdown.';

  const alerts = (ov.alerts || []).slice().sort((a, b) => (SEV_ORDER[a.sev] ?? 9) - (SEV_ORDER[b.sev] ?? 9));
  const counts = { critical: 0, high: 0, warn: 0, info: 0 };
  alerts.forEach((a) => { if (a.sev in counts) counts[a.sev]++; });
  const sc = $('#sevCounts'); sc.replaceChildren();
  [['critical', 'CRIT'], ['high', 'HIGH'], ['warn', 'WARN']].forEach(([k, l]) => {
    const s = el('span', counts[k] ? 'sev-' + k : '', `${l} ${counts[k]}`);
    if (!counts[k]) s.style.color = 'var(--dim2)';
    sc.append(s);
  });
  const track = $('#alarmTrack'); track.replaceChildren();
  if (!alerts.length) {
    const a = el('div', 'al sev-ok'); a.append(el('i'), el('span', '', 'All clear. No active alarms.')); track.append(a);
  }
  // runner state for alarm-card actions comes from the agent-guard pipeline row (same source as its RUN AUDIT button)
  const gaRow = (ov.pipelines || []).find((p) => p && p.id === 'agent_guard');
  const gaRun = gaRow && gaRow.guard_audit_run && typeof gaRow.guard_audit_run === 'object' ? gaRow.guard_audit_run : null;
  alerts.forEach((a) => {
    const n = el('div', 'al sev-' + a.sev, null, { title: `${a.title}${a.detail ? ' — ' + a.detail : ''} [${a.source || ''}]` });
    n.append(el('i'), el('span', '', a.title));
    if (a.detail) n.append(el('small', '', a.detail));
    // offered, never auto-started: a stale / timing-out audit alarm carries its own RUN AUDIT button
    if (a.action === 'guard_audit_run' && gaRun) {
      const cd = isNum(gaRun.cooldown_sec) ? gaRun.cooldown_sec : 0;
      const b = el('button', 'al-act' + (gaRun.running ? ' busy' : ''), gaRun.running ? 'AUDITING…' : cd > 0 ? `RUN AUDIT · ${Math.ceil(cd / 60)}m` : 'RUN AUDIT',
        { type: 'button', 'aria-label': 'run agent-guard audit from this alarm',
          title: gaRun.running ? 'agent-guard audit running' : cd > 0 ? `cooldown: next run allowed in ${Math.round(cd)}s` : 'Run Security\'s agent-guard audit now (bounded, background)' });
      b.disabled = !!gaRun.running || cd > 0;
      b.onclick = (ev) => { ev.stopPropagation(); runGuardAudit(b); };
      n.append(b);
    }
    track.append(n);
  });
  $('#alarm').classList.toggle('crit', counts.critical > 0);
  Orb.alarm(counts.critical > 0);
  // chime for new critical/high alarms (also once at load if something is critical)
  let fresh = null;
  alerts.forEach((a) => {
    // a.chime: calendar countdown alarms also chime at WARN (30 min) so a high-impact release is never missed
    const loud = a.sev === 'critical' || a.sev === 'high' || (a.chime && a.sev === 'warn');
    if (!S.seen.has(a.id) && loud && (!S.firstAlerts || a.sev === 'critical' || a.chime)) fresh = fresh === 'critical' ? fresh : fresh === 'high' && a.sev === 'warn' ? fresh : a.sev;
    S.seen.add(a.id);
  });
  announceAlarms(alerts, S.firstAlerts);
  S.firstAlerts = false;
  if (fresh) chime(fresh);
}

const gaugeNodes = {};
function gauge(g) {
  const r = 40, C = 2 * Math.PI * r, arc = C * 0.75;
  let n = gaugeNodes[g.id];
  if (!n) {
    const wrap = el('div', 'gauge');
    const s = sv('svg', { viewBox: '0 0 100 92', role: 'img' });
    s.append(sv('circle', { cx: 50, cy: 50, r, class: 'track', 'stroke-dasharray': `${arc} ${C}`, transform: 'rotate(135 50 50)' }));
    const ticks = sv('circle', { cx: 50, cy: 50, r: r - 9, class: 'ticks', 'stroke-dasharray': `1 ${(2 * Math.PI * (r - 9) * 0.75) / 10 - 1}`, transform: 'rotate(135 50 50)' });
    s.append(ticks);
    const val = sv('circle', { cx: 50, cy: 50, r, class: 'val', 'stroke-dasharray': `${arc} ${C}`, 'stroke-dashoffset': arc, transform: 'rotate(135 50 50)' });
    const num = sv('text', { x: 50, y: 52, 'text-anchor': 'middle', class: 'num' });
    const cap = sv('text', { x: 50, y: 66, 'text-anchor': 'middle', class: 'cap' });
    s.append(val, num, cap);
    const lbl = el('div', 'lbl'), det = el('div', 'det');
    wrap.append(s, lbl, det);
    n = gaugeNodes[g.id] = { wrap, s, val, num, cap, lbl, det, arc };
  }
  const ratio = g.cap ? Math.min(1, Math.max(0, (g.value || 0) / g.cap)) : 0;
  const color = ratio >= 0.9 ? 'var(--red)' : ratio >= 0.6 ? 'var(--amber)' : 'var(--cyan)';
  n.val.style.stroke = color; n.val.style.color = color;
  requestAnimationFrame(() => n.val.setAttribute('stroke-dashoffset', String(n.arc * (1 - ratio))));
  n.num.textContent = pct(g.value, 2);
  n.cap.textContent = 'CAP ' + pct(g.cap, 0);
  n.lbl.textContent = g.label;
  n.det.textContent = g.detail || '';
  n.s.setAttribute('aria-label', `${g.label} ${pct(g.value, 2)} of ${pct(g.cap, 0)} cap`);
  return n.wrap;
}
function renderRisk(ov) {
  const rk = ov.risk;
  $('#riskEq').textContent = 'equity ' + money(rk.equity);
  const gs = $('#gauges');
  const nodes = (rk.gauges || []).map(gauge);
  if (gs.children.length !== nodes.length) gs.replaceChildren(...nodes);
  const sec = $('#sectors'); sec.replaceChildren();
  (rk.sectors || []).forEach((s) => {
    const ratio = s.cap ? Math.min(1, (s.used || 0) / s.cap) : 0;
    const row = el('div', 'bar');
    const t = el('div', 't'); const i = el('i', ratio >= 0.9 ? 'x' : ratio >= 0.6 ? 'w' : '');
    i.style.width = (ratio * 100).toFixed(1) + '%'; t.append(i);
    row.append(el('span', '', s.label), t, el('b', '', `${pct(s.used, 1)} / ${pct(s.cap, 0)}`));
    row.title = `${s.label}: ${pct(s.used, 2)} used of ${pct(s.cap, 0)} sector cap · per trade ${pct(s.per_trade, 0)}`;
    sec.append(row);
  });
  const pt = rk.per_trade || {};
  const rules = $('#rules'); rules.replaceChildren();
  [`PER TRADE ${pct(pt.min, 0)}–${pct(pt.max, 0)}`, `MEMES ${pct(pt.memes, 0)}`, `PERPS ${pct(pt.perps, 0)}`, 'OPEN ≤ 6%',
    'KILL: DAY −5% · DD −15%', `POSITIONS ${rk.open_positions}/${rk.max_open_positions}`].forEach((t) => rules.append(el('span', '', t)));
}
// Paper equity curve: hourly marks + live equity. 1D/7D/30D chips (localStorage zoora.eqDays); CT hover on the sparkline.
const fmtEqHover = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function setEqDays(d) {
  d = [1, 7, 30].includes(Number(d)) ? Number(d) : 7;
  if (S.eqDays === d) return;
  S.eqDays = d; localStorage.setItem('zoora.eqDays', String(d));
  fetchEquityCurve(true);
}
async function fetchEquityCurve(force) {
  const now = Date.now();
  if (!force && now - S.eqFetch < 1500) return;
  S.eqFetch = now;
  try {
    const r = await api('/api/zoora/equity-curve?days=' + encodeURIComponent(S.eqDays));
    if (r.ok && r.data && r.data.curve) {
      S.eqCurve = r.data.curve;
      renderEquityCurve(S.eqCurve);
    }
  } catch (_) { /* next poll retries */ }
}
function renderEquityCurve(c) {
  const box = $('#eqCurve'); if (!box) return; box.replaceChildren();
  c = c || {};
  const pts = c.points || [];
  const head = el('div', 'eqc-h');
  const lab = el('span', 'eqc-l', 'EQUITY');
  const chips = el('span', 'eqc-chips', null, { role: 'group', 'aria-label': 'Equity curve range' });
  [1, 7, 30].forEach((d) => {
    const b = el('button', 'eqc-chip' + (S.eqDays === d ? ' on' : ''), d + 'D', {
      type: 'button', 'aria-pressed': String(S.eqDays === d), title: 'Show last ' + d + ' day' + (d === 1 ? '' : 's')
    });
    b.addEventListener('click', () => setEqDays(d));
    chips.append(b);
  });
  head.append(lab, chips);
  if (c.error) { head.append(el('small', 'amb', 'curve unavailable')); box.append(head); box.title = c.error; return; }
  if (pts.length < 2 || !isNum(c.change)) {
    head.append(el('small', 'dim', `collecting hourly marks · ${c.n_total || 0} so far`)); box.append(head);
    box.title = 'The HUD records one paper equity mark per hour; the line appears after two points.'; return;
  }
  const up = c.change >= 0;
  head.append(el('b', up ? 'pos' : 'neg', `${signed(c.change)} (${sgn((c.change_pct || 0) * 100, 2, '%')})`),
    el('small', 'dim', `lo ${money(c.lo)} · hi ${money(c.hi)} · max DD ${pct(c.max_dd || 0, 2)}`));
  const tip = el('div', 'eqc-tip dim', 'hover the curve for a CT reading');
  const sp = spark(pts, 300, 34, up ? 'var(--green)' : 'var(--red)', { tip });
  box.append(head, sp, tip);
  const t0 = fmtEqHover.format(new Date(pts[0][0] * 1000));
  box.title = `${c.n_marks} marks since ${t0} CT (+ live equity) · paper ledger only · ${S.eqDays}D window`;
  box.setAttribute('aria-label', `Paper equity ${up ? 'up' : 'down'} ${money(Math.abs(c.change))} over ${c.days || S.eqDays} days, max drawdown ${pct(c.max_dd || 0, 2)}`);
}
function renderPositions(ov) {
  const p = ov.positions, rk = ov.risk;
  const k = $('#pnl'); k.replaceChildren();
  [['EQUITY', money(rk.equity), ''], ['UNREALIZED', signed(rk.unrealized_pnl), rk.unrealized_pnl >= 0 ? 'pos' : 'neg'],
    ['REALIZED', signed(rk.realized_pnl), rk.realized_pnl >= 0 ? 'pos' : 'neg']].forEach(([l, v, c]) => {
    const d = el('div', 'kpi'); d.append(el('span', '', l), el('b', c, v)); k.append(d);
  });
  if (S.eqCurve && Number(S.eqCurve.days) === S.eqDays) renderEquityCurve(S.eqCurve);
  else if (S.eqDays === 7) { S.eqCurve = p.curve || {}; renderEquityCurve(S.eqCurve); }
  else { renderEquityCurve(p.curve || {}); fetchEquityCurve(false); }
  const tb = $('#posTable tbody'); tb.replaceChildren();
  if (!p.open.length) {
    const tr = el('tr'); const td = el('td', 'empty', 'No open paper positions.', { colspan: 6 }); tr.append(td); tb.append(tr);
  }
  p.open.forEach((o) => {
    const tr = el('tr');
    const sym = el('td', 'sym', o.symbol); sym.append(el('small', '', `${o.venue || SECTOR[o.sector] || ''} · ${ago(ov.now - o.opened_at)}`));
    const side = el('td'); side.append(el('span', 'side ' + o.side, o.side.toUpperCase()));
    const stale = o.mark_age_sec > 6 * 3600;
    const mark = el('td', 'n' + (stale ? ' amb' : ''), px(o.mark), { title: `mark ${ago(o.mark_age_sec)} old${stale ? ' — stale, run aai ingest-perps' : ''}` });
    tr.append(sym, side, el('td', 'n hide-sm', px(o.entry)), mark, el('td', 'n ' + (o.upnl >= 0 ? 'pos' : 'neg'), signed(o.upnl)),
      el('td', 'n ' + (o.r >= 0 ? 'pos' : 'neg'), isNum(o.r) ? o.r.toFixed(2) + 'R' : '—'));
    tr.title = `stop ${px(o.stop)} · target ${px(o.target)} · risk ${money(o.risk_usd)} · qty ${o.qty}`;
    tb.append(tr);
  });
  const sb = $('#subBooks'); sb.replaceChildren();
  const pp = ov.ext.perps && ov.ext.perps.paper;
  if (pp && pp.kind === 'arena') {
    const arms = pp.arms || [];
    const b = el('div', 'book');
    b.append(el('span', '', `Perps arena · ${arms.length} arms · ${(pp.open || []).length} open${pp.killed ? ' · KILLED' : ''}`),
      el('b', pp.equity >= pp.start_equity ? 'pos' : 'neg', `${money(pp.equity)} / ${money(pp.start_equity, 0)}`));
    b.title = 'perps-pipeline arena: each arm is a separate $100 simulation\n' +
      arms.map((a) => `${a.id}: ${money(a.equity)} · ${a.closed} closed · ${a.open} open${a.killed ? ' · killed' : a.benched ? ' · benched' : ''}`).join('\n') +
      `\nupdated ${ago(ov.ext.perps.age_sec)} ago`;
    sb.append(b);
    if (arms.length) sb.append(arenaBoard(arms));
  } else if (pp && !pp.error) {
    const op = (pp.open || []).map((o) => `${o.symbol} ${o.side}`).join(', ') || 'flat';
    const b = el('div', 'book'); b.append(el('span', '', `Perps sim (Blofin) · ${op}`), el('b', pp.unrealized >= 0 ? 'pos' : 'neg', `${money(pp.equity)} / ${money(pp.start_equity, 0)}`));
    b.title = `perps-pipeline separate paper account${pp.killed ? ' · KILLED: ' + pp.kill_reason : ''} · updated ${ago(ov.ext.perps.age_sec)} ago`;
    sb.append(b);
  }
  const fx = ov.ext.forex && ov.ext.forex.paper;
  if (fx && fx.length) {
    const open = fx.reduce((a, x) => a + (x.open || 0), 0), eq = fx.reduce((a, x) => a + (x.equity || 0), 0);
    const b = el('div', 'book'); b.append(el('span', '', `Forex books ×${fx.length} · ${open} open`), el('b', '', money(eq, 0)));
    b.title = fx.map((x) => `${x.book}: ${money(x.equity, 0)}, ${x.open} open`).join('\n');
    sb.append(b);
  }
  (p.closed_recent || []).slice(0, 2).forEach((c) => {
    const b = el('div', 'book'); b.append(el('span', 'dim', `closed ${c.symbol} ${c.side} · ${c.reason}`), el('b', c.pnl >= 0 ? 'pos' : 'neg', signed(c.pnl)));
    sb.append(b);
  });
}
function stClass(s) {
  s = String(s || '').toUpperCase();
  if (s === 'OK' || s === 'PASS') return 'st-ok';
  if (s === 'PENDING' || s === 'CHECKING') return 'st-pend';
  if (s === 'NOT BUILT' || s === 'OFF' || s === 'ABSENT' || s === 'MISSING') return 'st-off';
  if (s === 'QUOTES') return 'st-ok';
  if (s === 'DEGRADED' || s === 'WARN' || s === 'STALE') return 'st-warn';
  return 'st-bad';
}
// guard-audit ring buffer (server keeps the last 20 compact runs); only known statuses are drawn.
const GA_GLYPH = { pass: '●', fail: '✕', timed_out: '◔', missing: '○' };
function gaHist(ga) {
  return Array.isArray(ga.history) ? ga.history.filter((e) => e && typeof e === 'object' && GA_GLYPH[e.status]).slice(-20) : [];
}
// guard-audit findings counts (CRITICAL/HIGH/MEDIUM/LOW integers parsed server-side from the audit summary line only).
const GA_SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
function gaFind(f) {
  return f && typeof f === 'object' && GA_SEV.every((k) => isNum(f[k]) && f[k] >= 0) ? f : null;
}
function renderPipes(ov) {
  const ul = $('#pipes'); ul.replaceChildren();
  (ov.pipelines || []).forEach((p) => {
    // Health facts shared with `aai healthcheck` (solana-meme-risk): passed/total, required failures, upstream block.
    const ck = p.checks && isNum(p.checks.passed) && isNum(p.checks.total) ? p.checks : null;
    const req = Array.isArray(p.failed_required) ? p.failed_required.map(String) : [];
    const opt = Array.isArray(p.failed_optional) ? p.failed_optional.map(String) : [];
    const up = p.upstream && typeof p.upstream === 'object' ? p.upstream : null;
    const tip = [`${p.name}: ${p.state}${p.detail ? ' — ' + p.detail : ''}`];
    if (ck) tip.push(`checks: ${ck.passed}/${ck.total} pass`);
    if (req.length) tip.push('required failing: ' + req.join(', '));
    if (opt.length) tip.push('optional failing: ' + opt.join(', '));
    if (up) tip.push(`upstream blocked (${up.source || '?'} ${up.code || ''}): ${(up.checks || []).join(', ')}${up.note ? ' — ' + up.note : ''}`);
    // Last bounded `aai guard-audit` run (agent-guard row only): status, runtime and when, in CT.
    const ga = p.guard_audit && typeof p.guard_audit === 'object' && typeof p.guard_audit.status === 'string' ? p.guard_audit : null;
    if (ga) {
      const when = isNum(ga.finished_at) ? new Date(ga.finished_at * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : '?';
      tip.push(`last guard-audit: ${ga.status.replace('_', ' ')} in ${isNum(ga.elapsed_sec) ? Math.round(ga.elapsed_sec) + 's' : '?'}` +
        `${ga.status === 'timed_out' && isNum(ga.timeout_sec) ? ' (limit ' + Math.round(ga.timeout_sec) + 's, stopped)' : ''} at ${when}`);
      const gh = gaHist(ga);
      if (gh.length > 1) {
        const n = (s) => gh.filter((e) => e.status === s).length;
        tip.push(`guard-audit trend, last ${gh.length} runs (oldest to newest): ${gh.map((e) => GA_GLYPH[e.status] || '?').join('')}` +
          ` · ${n('pass')} pass, ${n('fail')} fail, ${n('timed_out')} timed out`);
      }
      if (isNum(ga.timeout_streak) && ga.timeout_streak >= 2) tip.push(`${ga.timeout_streak} timeouts in a row`);
      const gf = gaFind(ga.findings);
      if (gf) {
        const pf = gaFind(ga.findings_prev);
        tip.push(`guard-audit findings: ${GA_SEV.map((k) => `${k} ${pf ? pf[k] + '→' : ''}${gf[k]}`).join(', ')}` +
          (pf ? ' (vs previous counted run)' : ''));
        const fh = gaHist(ga).filter((e) => gaFind(e.findings));
        if (fh.length > 1) tip.push(`CRITICAL/HIGH per run (oldest to newest): ${fh.map((e) => e.findings.CRITICAL + '/' + e.findings.HIGH).join(' ')}`);
      }
    }
    // Economy snapshot scheduler row: tick / error counts since HUD start (in-memory facts, read-only).
    const sc = p.id === 'econ_scheduler' && isNum(p.ticks) && isNum(p.errors) ? p : null;
    if (sc) tip.push(`scheduler: ${sc.ticks} ticks, ${sc.errors} errors since HUD start${isNum(sc.interval_sec) ? ` · every ${Math.round(sc.interval_sec / 60)} min` : ''}`);
    if (sc && typeof p.error === 'string' && p.error) tip.push('last error: ' + p.error);
    // HUD layout check row: per-layout grid-diff verdicts vs the blessed baselines (facts from aai.shotcheck, read-only).
    const lc = p.id === 'layout_check' && Array.isArray(p.layouts) ? p.layouts.filter((l) => l && typeof l.label === 'string').slice(0, 4) : null;
    if (lc) lc.forEach((l) => tip.push(`${l.label}: ${l.verdict || 'not checked'}` +
      (isNum(l.changed_frac) ? ` · ${Math.round(l.changed_frac * 100)}% of grid cells moved` : '') +
      (isNum(l.new_blank) && l.new_blank ? ` · ${l.new_blank} cells went blank` : '') +
      (Array.isArray(l.history) && l.history.length > 1 ? ` · last ${l.history.length}: ${l.history.map((v) => (v === 'PASS' ? '●' : '✕')).join('')}` : '') +
      (l.reason && l.verdict !== 'PASS' ? ` · ${l.reason}` : '')));
    const li = el('li', 'pipe ' + stClass(p.state), null, { title: tip.join('\n') });
    li.append(el('i'), el('span', 'nm', p.name), el('span', 'st', p.state),
      el('span', 'dt', (p.detail || '') + (isNum(p.age_sec) ? ` · ${ago(p.age_sec)} ago` : '')));
    if (sc) {
      const f = el('span', 'pf', null, { 'aria-label': 'scheduler facts' });
      f.append(el('span', 'pf-c ' + (sc.ticks > 0 ? 'ok' : 'warn'), `${sc.ticks} ticks`));
      if (sc.errors > 0) f.append(el('span', 'pf-c ' + (p.state === 'ERROR' ? 'bad' : 'warn'), `${sc.errors} tick error${sc.errors === 1 ? '' : 's'}`));
      li.append(f);
    }
    if (lc && lc.length) {
      const f = el('span', 'pf', null, { 'aria-label': 'layout check facts' });
      lc.forEach((l) => f.append(el('span', 'pf-c ' + (l.state === 'OK' ? 'ok' : l.state === 'FAIL' ? 'bad' : 'warn'),
        `${l.label} ${l.verdict || '—'}${isNum(l.changed_frac) ? ' · ' + Math.round(l.changed_frac * 100) + '%' : ''}`)));
      li.append(f);
    }
    if (ck || req.length || opt.length || up || ga) {
      const f = el('span', 'pf', null, { 'aria-label': 'health check facts' });
      if (ck) f.append(el('span', 'pf-c ' + (ck.passed === ck.total ? 'ok' : 'warn'), `${ck.passed}/${ck.total} checks`));
      if (req.length) f.append(el('span', 'pf-c bad', `${req.length} required failing`));
      if (opt.length) f.append(el('span', 'pf-c warn', `${opt.length} optional failing`));
      if (up) f.append(el('span', 'pf-c up', `UPSTREAM ${up.code || 'BLOCK'} · ${up.source || '?'} · not bypassed`));
      if (ga) {
        const gl = { pass: 'PASS', fail: 'FAIL', timed_out: 'TIMED OUT', missing: 'MISSING' }[ga.status] || ga.status.toUpperCase();
        const gc = ga.status === 'pass' ? 'ok' : ga.status === 'fail' ? 'bad' : 'warn';
        f.append(el('span', 'pf-c ' + gc, `AUDIT ${gl} · ${isNum(ga.elapsed_sec) ? Math.round(ga.elapsed_sec) + 's' : '?'}${isNum(ga.age_sec) ? ' · ' + ago(ga.age_sec) + ' ago' : ''}`));
        const gh = gaHist(ga);
        if (gh.length > 1) {
          const tr = el('span', 'pf-c ga-trend', null, { 'aria-label': `guard-audit trend: last ${gh.length} runs` });
          gh.forEach((e) => tr.append(el('i', 'ga-d ga-' + e.status)));
          if (isNum(ga.timeout_streak) && ga.timeout_streak >= 2) tr.append(el('b', null, `⏱×${ga.timeout_streak}`));
          f.append(tr);
        }
        const gf = gaFind(ga.findings);
        if (gf) {
          const d = ga.findings_delta && typeof ga.findings_delta === 'object' ? ga.findings_delta : null;
          const arrow = (k) => (d && isNum(d[k]) && d[k] !== 0 ? (d[k] > 0 ? `▲${d[k]}` : `▼${-d[k]}`) : '');
          const up = d && ((isNum(d.CRITICAL) && d.CRITICAL > 0) || (isNum(d.HIGH) && d.HIGH > 0));
          const down = d && !up && ((isNum(d.CRITICAL) && d.CRITICAL < 0) || (isNum(d.HIGH) && d.HIGH < 0));
          const fc = el('span', 'pf-c ga-find ' + (up ? 'bad' : down ? 'ok' : gf.CRITICAL ? 'bad' : gf.HIGH ? 'warn' : 'ok'), null,
            { 'aria-label': `guard-audit findings: ${gf.CRITICAL} critical, ${gf.HIGH} high` });
          fc.append(el('b', null, `${gf.CRITICAL}C`), document.createTextNode(arrow('CRITICAL') + ' · '),
            el('b', null, `${gf.HIGH}H`), document.createTextNode(arrow('HIGH')));
          f.append(fc);
        }
      }
      li.append(f);
    }
    // One-click bounded agent-guard audit (localhost POST; same runner as `aai guard-audit`, one in flight, cooldown).
    const gr = p.id === 'agent_guard' && p.guard_audit_run && typeof p.guard_audit_run === 'object' ? p.guard_audit_run : null;
    if (gr) {
      const cd = isNum(gr.cooldown_sec) ? gr.cooldown_sec : 0;
      const b = el('button', 'ga-run' + (gr.running ? ' busy' : ''), gr.running ? 'AUDITING…' : cd > 0 ? `RUN AUDIT · ${Math.ceil(cd / 60)}m` : 'RUN AUDIT',
        { type: 'button', title: gr.running ? `agent-guard audit running (limit ${isNum(gr.limit_sec) ? Math.round(gr.limit_sec) : '?'}s)` :
          cd > 0 ? `cooldown: next run allowed in ${Math.round(cd)}s` : 'Run Security\'s agent-guard audit now (bounded, background; records the result)',
          'aria-label': 'run agent-guard audit' });
      b.disabled = !!gr.running || cd > 0;
      b.onclick = () => runGuardAudit(b);
      if (gr.error) b.title += `\nlast run error: ${String(gr.error).slice(0, 60)}`;
      li.append(b);
    }
    ul.append(li);
  });
  const running = (ov.heavy && ov.heavy.running) || [];
  $('#refreshHeavy').disabled = running.length > 0;
  $('#refreshHeavy').textContent = running.length ? 'CHECKING…' : 'RE-CHECK';
  const ageEl = $('#healthAge');
  if (ageEl) {
    const hc = (ov.meta && ov.meta.health_cache) || null;
    ageEl.classList.remove('on', 'warn', 'bad');
    if (!hc) {
      ageEl.hidden = true; ageEl.textContent = ''; ageEl.removeAttribute('title');
    } else if (hc.source === 'warming' || (hc.age_sec == null && hc.refreshing)) {
      ageEl.hidden = false; ageEl.textContent = 'HEALTH · refreshing';
      ageEl.classList.add('on');
      ageEl.title = 'Health report cache is warming; first networked check takes about thirty seconds.';
    } else {
      const age = Number(hc.age_sec);
      const stale = !!hc.stale;
      const refreshing = !!hc.refreshing;
      let label;
      if (refreshing) label = 'HEALTH · refreshing';
      else if (stale) {
        const m = Number.isFinite(age) ? Math.max(1, Math.round(age / 60)) : '?';
        label = 'HEALTH · stale ' + m + 'm';
      } else if (Number.isFinite(age) && age < 90) label = 'HEALTH · ' + Math.round(age) + 's';
      else if (Number.isFinite(age)) label = 'HEALTH · ' + Math.round(age / 60) + 'm';
      else label = 'HEALTH · cached';
      ageEl.hidden = false; ageEl.textContent = label;
      ageEl.classList.add(stale ? 'warn' : (refreshing ? 'on' : 'on'));
      const tip = ['/api/health cache',
        'age: ' + (Number.isFinite(age) ? age.toFixed(1) + 's' : 'unknown'),
        'ttl: ' + (hc.ttl_sec != null ? hc.ttl_sec + 's' : '?'),
        'source: ' + (hc.source || '?'),
        stale ? 'stale' : 'fresh',
        refreshing ? 'refreshing in background' : 'idle'].join(' · ');
      ageEl.title = tip;
    }
  }
}
const TABS = [['all', 'ALL'], ['perps', 'PERPS'], ['forex', 'FOREX'], ['solana_meme', 'MEMES'], ['billy', 'BILLY'], ['stocks', 'STOCKS']];
function renderIdeas(ov) {
  const ideas = ov.ideas || [];
  const tabs = $('#ideaTabs'); tabs.replaceChildren();
  TABS.forEach(([k, l]) => {
    const n = k === 'all' ? ideas.length : ideas.filter((i) => i.sector === k).length;
    const b = el('button', '', l, { role: 'tab', 'aria-selected': String(S.ideaTab === k), type: 'button' });
    b.append(el('b', '', n)); b.onclick = () => { S.ideaTab = k; renderIdeas(S.ov); };
    tabs.append(b);
  });
  const ul = $('#ideas'); ul.replaceChildren();
  const list = S.ideaTab === 'all' ? ideas : ideas.filter((i) => i.sector === S.ideaTab);
  // Stocks desk: show read-only Yahoo equity quotes (SPY/QQQ/IWM) above the empty-ideas note. Never invent ideas.
  if (S.ideaTab === 'stocks') {
    const sq = ov.stocks || {};
    const qs = Array.isArray(sq.quotes) ? sq.quotes : [];
    if (qs.length) {
      const strip = el('li', 'stock-quotes', null, {
        title: [sq.source || 'Yahoo via intel', sq.note || '', sq.detail || ''].filter(Boolean).join(' · ')
      });
      const hd = el('div', 'sq-hd');
      hd.append(el('span', 'sq-lab', 'YAHOO QUOTES'),
        el('span', 'sq-st ' + String(sq.state || '').toLowerCase(), String(sq.state || '—')),
        el('span', 'sq-age', isNum(sq.age_sec) ? ago(sq.age_sec) + ' ago' : 'no idea agent'));
      strip.append(hd);
      const row = el('div', 'sq-row');
      qs.slice(0, 6).forEach((q) => {
        const cell = el('div', 'sq-q');
        const chg = isNum(q.chg) ? q.chg : null;
        cell.append(el('b', '', String(q.symbol || '?')),
          el('span', 'sq-px', isNum(q.last) ? px(q.last) : '—'),
          el('span', 'sq-chg ' + (chg == null ? 'dim' : chg >= 0 ? 'pos' : 'neg'),
            chg == null ? '—' : ((chg >= 0 ? '+' : '') + (chg * 100).toFixed(2) + '%')));
        row.append(cell);
      });
      strip.append(row);
      ul.append(strip);
    }
  }
  if (!list.length) {
    const empty = S.ideaTab === 'stocks'
      ? ((ov.stocks && (ov.stocks.quotes || []).length)
          ? 'No stock ideas — quotes above are read-only. No stocks idea agent; nothing invented.'
          : 'No stock ideas and no Yahoo equity quotes cached yet. Nothing invented.')
      : 'No ideas from this source right now.';
    ul.append(el('li', 'empty', empty));
    return;
  }
  list.slice(0, 40).forEach((i) => {
    const li = el('li', 'idea s-' + i.sector, null, { title: `${i.source}${i.note ? ' · ' + i.note : ''}` });
    const sym = String(i.symbol || '?');
    const hd = el('div', 'hd'); hd.append(el('b', '', sym.length > 16 ? sym.slice(0, 6) + '…' + sym.slice(-4) : sym, { title: sym }));
    if (i.side) hd.append(el('span', 'side ' + i.side, i.side.toUpperCase()));
    const bits = [];
    if (isNum(i.entry)) bits.push('entry ' + px(i.entry));
    if (isNum(i.stop)) bits.push('stop ' + px(i.stop));
    if (isNum(i.target)) bits.push('tgt ' + px(i.target));
    if (isNum(i.score)) bits.push('score ' + Math.round(i.score));
    bits.push(i.source);
    li.append(el('span', 'sec', SECTOR[i.sector] || i.sector), hd, el('span', 'stt', String(i.status || '?').toUpperCase()),
      el('span', 'px', bits.join(' · ')), el('span', 'age' + (i.stale || i.age_sec > STALE ? ' stale' : ''), isNum(i.age_sec) ? ago(i.age_sec) + ' ago' : ''));
    ul.append(li);
  });
}
function renderMemes(ov) {
  const h = (ov.memes && ov.memes.health) || {};
  const box = $('#memeHealth'); box.replaceChildren();
  const st = String(h.state || 'PENDING').toUpperCase();
  box.className = 'meme-health ' + (st === 'OK' ? 'ok' : st === 'PENDING' ? '' : 'deg');
  const left = el('div', 'big', st);
  const right = el('div');
  right.append(el('div', '', st === 'DEGRADED' ? 'pump.fun feed blocked' : st === 'OK' ? 'All live checks passing' : st === 'PENDING' ? 'Live check running in background…' : 'Health check failing'));
  const why = h.degraded_reason || h.detail || (h.failed && h.failed.map((f) => f.check).join(', ')) || '';
  right.append(el('p', '', (why ? why + ' ' : '') + (isNum(h.age_sec) ? `Checked ${ago(h.age_sec)} ago.` : '')));
  box.append(left, right);
  const ul = $('#scores'); ul.replaceChildren();
  const sc = (ov.memes && ov.memes.scores) || [];
  if (!sc.length) ul.append(el('li', 'empty', 'No mints scored yet. Paste one below or say “score <mint>”.'));
  sc.slice(0, 4).forEach((s) => {
    const bad = /SKIP|AVOID|REJECT/i.test(s.status || '');
    const li = el('li', 'score');
    li.style.setProperty('--c', bad ? 'var(--red)' : /WATCH|CAUTION/i.test(s.status || '') ? 'var(--amber)' : 'var(--green)');
    const ring = el('div', 'ring'); ring.style.setProperty('--v', String(Math.max(0, Math.min(100, s.score || 0)))); ring.append(el('span', '', Math.round(s.score || 0)));
    const mid = el('div'); mid.append(el('div', '', s.symbol), el('div', 'mint', s.mint || ''));
    const right = el('div'); right.style.textAlign = 'right';
    right.append(el('div', 'rec', String(s.status || '').toUpperCase()), el('div', 'mint' + (s.stale ? ' amb' : ''), ago(s.age_sec) + ' ago'));
    li.append(ring, mid, right); li.title = s.note || '';
    ul.append(li);
  });
}
function renderSecurity(ov) {
  const s = ov.security || {};
  $('#secMeta').textContent = s.generated_at ? `${ago(s.age_sec)} ago${(s.failed_sources || []).length ? ' · ' + s.failed_sources.length + ' src down' : ''}` : 'no report';
  $('#secMeta').title = s.generated_at ? `window ${s.window} · generated ${s.generated_at} · failed sources: ${(s.failed_sources || []).join(', ') || 'none'}` : '';
  const ul = $('#sec'); ul.replaceChildren();
  const al = s.alerts || [];
  if (!al.length) ul.append(el('li', 'empty', s.status === 'missing' ? 'Security pipeline report not found.' : 'No HIGH or CRITICAL items in the current window.'));
  al.forEach((a) => {
    const li = el('li', 'si' + (/CRIT/i.test(a.tier) ? ' crit' : ''));
    const t = el('div', 't');
    if (a.url && /^https:\/\//.test(a.url)) t.append(el('a', '', a.title, { href: a.url, target: '_blank', rel: 'noopener noreferrer' }));
    else t.textContent = a.title;
    const m = el('div', 'm');
    m.append(el('span', 'tag', a.tier));
    if (a.category) m.append(el('span', '', a.category.replace(/_/g, ' ')));
    if (isNum(a.loss_usd)) m.append(el('span', 'amb', money(a.loss_usd, 0)));
    (a.matched_exposure || []).forEach((x) => m.append(el('span', 'cy', '⚑ ' + x)));
    if (a.latest_utc) { const t2 = Date.parse(a.latest_utc); if (t2) m.append(el('span', '', ago((Date.now() - t2) / 1000) + ' ago')); }
    const rel = el('div', 'rel', null, { title: `relevance ${a.relevance}` }); const ri = el('i'); ri.style.width = Math.round((a.relevance || 0) * 100) + '%'; rel.append(ri);
    li.append(t, m, rel);
    ul.append(li);
  });
}
function renderLT(ov) {
  const l = ov.longterm || {}, r = l.roth || {};
  const box = $('#lt'); box.replaceChildren();
  const head = el('div', 'lt-head');
  const st = String(r.status || '—');
  const okish = st === 'OK' || st === 'PASS' || st === 'VERIFIED';
  head.append(el('span', 'badge ' + (okish ? 'ok' : 'unv'), st));
  const issues = (r.data_issues || []).join(' ');
  const feedSt = (l.feed && l.feed.state) || (l.holdings_source === 'none' ? 'MISSING' : 'OK');
  const tot = isNum(r.total_value_usd) ? ` · ${money(r.total_value_usd, 0)}` : '';
  head.append(el('p', '', (`OnePay Roth: audit only, you execute it.${tot} ${issues || ''}`).trim()));
  box.append(head);
  // Holdings table (manual CSV import) or CLI hint when empty. textContent only.
  const holds = Array.isArray(l.holdings) ? l.holdings : [];
  if (holds.length) {
    const meta = el('div', 'lt-hold-meta');
    meta.append(el('span', 'tag ' + (feedSt === 'OK' ? 'cy' : feedSt === 'STALE' ? 'amb' : 'dim'), String(feedSt)),
      el('span', 'dim', `${holds.length} holding${holds.length === 1 ? '' : 's'}`),
      el('span', 'dim', `source ${l.holdings_source || '?'}`));
    if (isNum(l.holdings_as_of) || isNum(r.holdings_as_of)) {
      const ts = l.holdings_as_of || r.holdings_as_of;
      meta.append(el('span', 'dim', `as of ${ago((Date.now() / 1000) - ts)}`));
    }
    box.append(meta);
    const tw = el('div', 'table-wrap lt-holds');
    const tb = el('table', 'tbl');
    const thead = el('thead'); const hr = el('tr');
    ['Symbol', 'Qty', 'Value', 'Weight', 'Plan'].forEach((h, i) => hr.append(el('th', i ? 'n' : '', h)));
    thead.append(hr); tb.append(thead);
    const body = el('tbody');
    holds.forEach((h) => {
      const tr = el('tr');
      tr.append(el('td', 'sym', String(h.symbol || '?')),
        el('td', 'n', isNum(h.quantity) ? String(h.quantity) : '—'),
        el('td', 'n', isNum(h.value_usd) ? money(h.value_usd, 0) : '—'),
        el('td', 'n', isNum(h.actual_pct) ? h.actual_pct.toFixed(1) + '%' : '—'),
        el('td', 'n ' + (h.on_plan ? 'pos' : 'amb'), h.on_plan ? 'on' : 'off'));
      body.append(tr);
    });
    tb.append(body); tw.append(tb); box.append(tw);
    const caps = (r.cap_breaches || []).slice(0, 4);
    const off = (r.off_plan || []).slice(0, 6);
    if (caps.length || off.length) {
      const warn = el('div', 'lt-warn');
      if (off.length) warn.append(el('span', 'tag amb', `OFF PLAN ${off.join(', ')}`));
      caps.forEach((c) => warn.append(el('span', 'tag amb', `${c.key || c.scope} ${c.breach}`)));
      box.append(warn);
    }
  } else {
    const hint = el('div', 'lt-import');
    hint.append(el('p', '', 'No holdings snapshot yet. Import a CSV from the CLI (audit only — never tickets):'));
    hint.append(el('code', '', String(l.import_hint || 'aai lt-holdings-import FILE --account onepay_roth')));
    hint.append(el('p', 'dim', 'Columns: symbol, quantity[, cost_basis_usd, price_usd, value_usd, verified]'));
    box.append(hint);
  }
  const sl = (l.sleeves || []).filter((s) => s.id !== 'crypto_core');
  const cc = (l.sleeves || []).find((s) => s.id === 'crypto_core');
  const max = Math.max(10, ...sl.map((s) => s.hi || 0)) * 1.08;
  const wrap = el('div', 'sleeves');
  // Build sleeve actual % from holdings when present (sleeve id on each holding is not in overview; use targets only).
  sl.forEach((s) => {
    const title = `${s.id}: target ${s.target}% (band ${s.lo}–${s.hi}%).`
      + (holds.length ? '' : ' No holdings feed, so actual weight is unknown.');
    const row = el('div', 'sl', null, { title });
    const t = el('div', 't'); const band = el('i', 'band'); band.style.left = (s.lo / max * 100) + '%'; band.style.width = ((s.hi - s.lo) / max * 100) + '%';
    const tg = el('i', 'tgt'); tg.style.left = (s.target / max * 100) + '%'; t.append(band, tg);
    row.append(el('span', '', s.id.replace(/_/g, ' ')), t, el('b', '', s.target + '%'));
    wrap.append(row);
  });
  box.append(wrap);
  const f = el('div', 'lt-foot');
  f.append(el('span', '', String(l.mode || '').replace(/_/g, ' ')), el('span', '', `drafts ${l.open_drafts ?? 0}`),
    el('span', '', `feeds ${(l.accounts || []).filter((a) => a.connected).length}/${(l.accounts || []).length}`),
    el('span', feedSt === 'OK' ? 'cy' : '', `holdings ${feedSt}`));
  if (cc) f.append(el('span', '', `crypto core ${(l.crypto_core || []).length} coins · separate bucket`));
  (l.decisions_needed || []).forEach((d) => f.append(el('span', 'd', d + ' decision')));
  box.append(f);
}
function renderFresh(ov) {
  const ul = $('#fresh'); ul.replaceChildren();
  (ov.freshness || []).forEach((f) => {
    const li = el('li', 'fr', null, { title: f.note || '' });
    const known = isNum(f.age_sec);
    const ratio = known ? Math.min(1, f.age_sec / STALE) : 1;
    const c = !known ? 'var(--dim2)' : f.stale ? 'var(--red)' : f.age_sec > 24 * 3600 ? 'var(--amber)' : 'var(--green)';
    const t = el('div', 't'); const i = el('i'); i.style.width = (known ? Math.max(3, ratio * 100) : 100) + '%'; i.style.background = c; t.append(i);
    const b = el('b', '', known ? ago(f.age_sec) : 'n/a'); b.style.color = c;
    li.append(el('span', 'nm', f.source), t, b);
    ul.append(li);
  });
}
function renderAudit(ov) {
  const a = ov.audit || {}, v = a.verify || {};
  const meta = $('#auditMeta'); meta.textContent = v.ok ? `chain OK · ${v.entries}` : `CHAIN BROKEN at #${v.broken_at}`;
  meta.className = v.ok ? 'chain-ok' : 'chain-bad';
  const ol = $('#audit'); ol.replaceChildren();
  const prevMax = S.auditMax;
  (a.tail || []).slice(0, 10).forEach((e) => {
    const li = el('li', 'au' + (prevMax && e.seq > prevMax ? ' new' : ''), null, { title: `actor ${e.actor} · ref ${e.ref || '—'} · hash ${e.hash} ← ${e.prev}` });
    const ev = el('span', 'ev'); ev.append(el('b', '', e.event), document.createTextNode(` ${e.outcome || ''} · ${e.actor}`));
    li.append(el('span', 'q', '#' + e.seq), el('span', 'tm', fmtHM.format(new Date(e.ts * 1000))), ev, el('span', 'h', e.hash));
    ol.append(li);
    S.auditMax = Math.max(S.auditMax, e.seq);
  });
}
function render(ov) {
  const parts = [renderTop, renderAlarm, renderRisk, renderPositions, renderPipes, renderIdeas, renderMemes, renderSecurity, renderLT, renderFresh, renderAudit];
  parts.forEach((fn) => { try { fn(ov); } catch (e) { console.error(fn.name, e); } });
}

/* ------------------------------------------------------------ link: SSE with poll fallback */
let pollTimer = null, inflight = false, sseRetry = null;
function applyOverview(ov, via) {
  if (S.fails) { S.fails = 0; }
  syncOnlineState();
  if (!ov) return;
  const cid = ov.meta && ov.meta.change_id;
  S.lastOk = Date.now();
  S.fails = 0;
  if (cid && cid === S.changeId && S.ov) return;  // last-change: skip re-render / re-chime
  S.changeId = cid || S.changeId;
  S.ov = ov;
  render(ov);
  if (via) S.linkMode = via;
}
async function poll(once) {
  clearTimeout(pollTimer);
  if (inflight) return;
  inflight = true;
  try {
    const r = await api('/api/zoora/overview');
    if (!r.ok || !r.data) throw new Error('HTTP ' + r.status);
    applyOverview(r.data, S.es ? 'sse' : 'poll');
    if (!S.es) setChip('#chipLink', 'LIVE · POLL', 'on', 'Polling /api/zoora/overview (SSE unavailable or reconnecting)');
  } catch (e) {
    S.fails++;
    setChip('#chipLink', S.fails > 1 ? 'LINK LOST' : 'RETRYING', 'bad', 'Cannot reach the HUD server: ' + e.message);
    syncOnlineState();
  } finally {
    inflight = false;
    if (!once) {
      // While SSE is live, only a slow safety poll; otherwise the classic 5 s cadence.
      const ms = document.hidden ? 20000 : (S.es ? 60000 : (S.fails ? 8000 : 5000));
      pollTimer = setTimeout(() => poll(false), ms);
    }
  }
}
function stopSSE() {
  if (S.es) { try { S.es.close(); } catch (_) {} S.es = null; }
  if (sseRetry) { clearTimeout(sseRetry); sseRetry = null; }
}
function startSSE() {
  if (typeof EventSource === 'undefined') return;
  stopSSE();
  const q = S.changeId ? ('?since=' + encodeURIComponent(S.changeId)) : '';
  let es;
  try { es = new EventSource('/api/zoora/stream' + q); } catch (_) { return; }
  S.es = es;
  let opened = false;
  es.addEventListener('overview', (ev) => {
    try {
      const d = JSON.parse(ev.data);
      opened = true;
      applyOverview(d, 'sse');
      setChip('#chipLink', 'LIVE · SSE', 'on', 'Server-sent events from /api/zoora/stream (change_id push)');
    } catch (e) { console.error('sse overview', e); }
  });
  es.addEventListener('ping', (ev) => {
    opened = true;
    S.lastOk = Date.now();
    S.linkMode = 'sse';
    try {
      const d = JSON.parse(ev.data);
      if (d.change_id) S.changeId = d.change_id;
    } catch (_) { /* ignore */ }
    setChip('#chipLink', 'LIVE · SSE', 'on', 'Server-sent events from /api/zoora/stream (heartbeat)');
  });
  es.addEventListener('reconnect', () => { /* server ended the stream on purpose; EventSource will retry */ });
  es.onerror = () => {
    // Browser will auto-retry EventSource; if it never opened, drop to poll and retry SSE later.
    if (!opened) {
      stopSSE();
      S.linkMode = 'poll';
      setChip('#chipLink', 'LIVE · POLL', 'on', 'SSE failed to open; polling /api/zoora/overview');
      sseRetry = setTimeout(startSSE, 15000);
    }
  };
}
function startLink() {
  poll(false);
  // Headless screenshots use ?noboot (and optional ?nosse); EventSource keeps network
  // activity alive and can hang Chrome's virtual-time-budget screenshot path.
  if (!/[?&](noboot|nosse)(?:&|=|$)/.test(location.search)) startSSE();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    poll(true);
    if (!S.es) startSSE();
  }
});

/* ------------------------------------------------------------ economy ladder (GET /api/economy, read-only, ECONOMY.md E1) */
// One row per strategy: stage chip, trades, expectancy R, max DD, paper weight, top next-stage blocker.
// Killed / demoted rows are flagged. Every string is sanitised server-side (agent_guard) and rendered as textContent only.
let econTimer = null, econInflight = false;
async function pollEconomy() {
  clearTimeout(econTimer);
  if (econInflight) return;
  econInflight = true;
  try {
    const r = await api('/api/economy');
    if (!r.ok || !r.data) throw new Error('HTTP ' + r.status);
    // history first so each ladder row can carry its 14-day stage/expectancy sparkline; a failed history only drops the column
    let h = null;
    try { h = await api(`/api/economy/history?n=6&days=${ECON_DAYS}`); } catch (_) { h = null; }
    renderEconomy(r.data, h && h.ok && h.data ? h.data.series : null);
    if (h && h.ok && h.data) renderEconFeed(h.data);
  } catch (e) {
    $('#econMeta').textContent = 'scorecard unavailable';
  } finally {
    econInflight = false;
    econTimer = setTimeout(pollEconomy, document.hidden ? 120000 : 30000);
  }
}
// Stage history sparkline (backlog P3): one point per daily snapshot (newest per CT day, server aai/snapshots.series).
// Cyan steps behind the line = computed stage S0-S3 that day; the line = expectancy R around a dashed 0R line;
// a ring marks a day the stage changed, a red tick a killed/benched day. A missing day is a gap, never interpolated.
const ECON_DAYS = 14;
function econHist(sr, sid) {
  const td = el('div', 'econ-h');  // sits under the Exp R value (no extra column: panel 10 is narrow)
  const s = sr && sr.strategies ? sr.strategies[sid] : null;
  const days = sr && Array.isArray(sr.days) ? sr.days : [];
  const pts = s && Array.isArray(s.points) ? s.points : [];
  if (!s || (s.n | 0) < 2 || pts.length !== days.length) {
    td.title = s ? 'Only one daily snapshot so far; the trend starts with the second.' : 'No daily snapshots for this strategy yet.';
    return td;
  }
  const W = 46, H = 15, n = pts.length, bw = W / n;  // compact: panel 10 sits in a narrow column
  const ys = pts.map((p) => p && isNum(p.expectancy_r) ? p.expectancy_r : null);
  const fin = ys.filter(isNum), lo = Math.min(0, ...fin), hi = Math.max(0, ...fin), rg = hi - lo || 1;
  const y = (v) => (H - 1.5 - (v - lo) / rg * (H - 3)).toFixed(1), x = (i) => (bw * i + bw / 2).toFixed(1);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spk econ-spk', width: W, height: H, 'aria-hidden': 'true' });
  pts.forEach((p, i) => {
    if (!p) return;
    if (p.stage > 0) svg.append(sv('rect', { class: 'econ-st', x: (bw * i + 0.4).toFixed(1), width: Math.max(0.6, bw - 0.8).toFixed(1),
      y: (H - p.stage / 3 * H).toFixed(1), height: (p.stage / 3 * H).toFixed(1) }));
    if (p.killed) svg.append(sv('rect', { class: 'econ-kd', x: (bw * i + 0.4).toFixed(1), width: Math.max(0.6, bw - 0.8).toFixed(1), y: H - 1.6, height: 1.6 }));
  });
  svg.append(sv('line', { x1: 0, x2: W, y1: y(0), y2: y(0), stroke: 'var(--dim)', 'stroke-width': '0.8', 'stroke-dasharray': '2 2', opacity: '.6' }));
  // Snapshot gap note (backlog P3): calendar days with no snapshot at all (HUD down) get a dim dashed divider and break
  // the line, so a jump across a missing week is never drawn as one smooth step.
  const gb = Array.isArray(sr.gap_before) && sr.gap_before.length === n ? sr.gap_before : [];
  gb.forEach((g, i) => { if (i > 0 && g > 0) svg.append(sv('line', { class: 'econ-gap', x1: (bw * i).toFixed(1), x2: (bw * i).toFixed(1), y1: 0, y2: H })); });
  let d = '', pen = false;
  ys.forEach((v, i) => { if (gb[i] > 0) pen = false; if (isNum(v)) { d += `${pen ? 'L' : 'M'}${x(i)},${y(v)}`; pen = true; } else pen = false; });
  const lastI = ys.map((v, i) => isNum(v) ? i : -1).filter((i) => i >= 0).pop();
  const col = isNum(s.expectancy_last) && s.expectancy_last >= 0 ? 'var(--green)' : 'var(--red)';
  if (d) svg.append(sv('path', { d, fill: 'none', stroke: col, 'stroke-width': '1.3' }));
  let prev = null;
  pts.forEach((p, i) => {
    if (!p) return;
    if (prev && p.stage !== prev.stage && isNum(ys[i])) svg.append(sv('circle', { class: 'econ-chg', cx: x(i), cy: y(ys[i]), r: '2.4', fill: 'none',
      stroke: p.stage > prev.stage ? 'var(--cyan)' : 'var(--amber)', 'stroke-width': '1' }));
    prev = p;
  });
  if (lastI !== undefined) svg.append(sv('circle', { cx: x(lastI), cy: y(ys[lastI]), r: '1.8', fill: col }));
  td.append(svg);
  const dl = s.expectancy_delta;
  if (isNum(dl)) td.append(el('span', 'econ-dl ' + (dl > 0.005 ? 'pos' : dl < -0.005 ? 'neg' : 'dim'), (dl > 0.005 ? '▲' : dl < -0.005 ? '▼' : '·') + Math.abs(dl).toFixed(2)));
  const nMiss = sr.n_missing | 0, overdue = sr.overdue_days | 0;
  if (nMiss > 0) td.append(el('span', 'econ-miss', `⋯${nMiss}d`));
  const span = (a, b) => a === b ? a.slice(5) : `${a.slice(5)}..${b.slice(5)}`;
  const skipped = (i) => { const g = gb[i] | 0; if (g <= 0 || i <= 0) return null;
    const a = new Date(days[i - 1] + 'T12:00:00Z'), b = new Date(days[i] + 'T12:00:00Z');
    const f = (dt) => dt.toISOString().slice(0, 10);
    return `   ⋯ ${span(f(new Date(+a + 864e5)), f(new Date(+b - 864e5)))} no snapshot (${g}d, HUD down)`; };
  const first = pts.find(Boolean), last = [...pts].reverse().find(Boolean);
  td.title = `${sid} · ${s.n} daily snapshot${s.n === 1 ? '' : 's'} ${first.day} → ${last.day}` +
    ` · stage S${s.first_stage}→S${s.last_stage}${s.stage_changes ? ` (${s.stage_changes} change${s.stage_changes === 1 ? '' : 's'}, max S${s.max_stage})` : ', unchanged'}` +
    (isNum(dl) ? ` · exp R ${dl >= 0 ? '+' : ''}${dl.toFixed(2)}` : '') + (isNum(s.trades_delta) ? ` · +${s.trades_delta} trades` : '') +
    (s.killed_days ? ` · killed ${s.killed_days}d` : '') +
    (nMiss > 0 ? `\n${nMiss} of ${sr.span_days | 0} days missing (no snapshot) — a gap, not a flat stretch` : '') +
    (overdue > 0 ? `\nno snapshot for the last ${overdue} due day${overdue === 1 ? '' : 's'}` : '') + '\n' +
    pts.map((p, i) => [skipped(i), p ? `${p.day.slice(5)} S${p.stage}/G${p.granted_stage}${p.killed ? ' KILLED' : ''} ${isNum(p.expectancy_r) ? (p.expectancy_r >= 0 ? '+' : '') + p.expectancy_r.toFixed(2) + 'R' : '—'} ${p.trades}tr`
      : `${days[i].slice(5)} not reported`].filter(Boolean).join('\n')).join('\n');
  td.setAttribute('aria-label', `${sid.split(':').pop().replace(/_/g, ' ')}: ${s.n}-day history, stage S${s.first_stage} to S${s.last_stage}` +
    (isNum(dl) ? `, expectancy ${dl >= 0 ? 'up' : 'down'} ${Math.abs(dl).toFixed(2)} R` : '') +
    (nMiss > 0 ? `, ${nMiss} of ${sr.span_days | 0} days missing` : ''));
  return td;
}
function renderEconomy(ec, series) {
  const rows = Array.isArray(ec.panel) ? ec.panel : [];
  const sm = ec.summary || {};
  const bs = sm.by_stage || {};
  $('#econMeta').textContent = `paper · ${rows.length} strateg${rows.length === 1 ? 'y' : 'ies'}${ec.global_kill ? ' · GLOBAL KILL' : ''}`;
  const sum = $('#econSum'); sum.replaceChildren();
  [0, 1, 2, 3].forEach((st) => {
    const c = el('span', 'stage s' + st, `S${st} ${bs[st] ?? bs[String(st)] ?? 0}`, { title: (ec.stages || {})[st] || '' });
    sum.append(c);
  });
  if (sm.demoted) sum.append(el('span', 'tag amb', `${sm.demoted} DEMOTED`));
  if (sm.killed) sum.append(el('span', 'tag neg', `${sm.killed} KILLED`));
  // granted-stage registry (ECONOMY.md E2): grants are written only by a human CLI command, never from the HUD
  sum.append(el('span', 'tag ' + (sm.granted ? 'cy' : 'dim'), `${sm.granted | 0} GRANTED`,
    { title: 'Stages a human granted with aai economy-grant (paper only). The HUD cannot grant.' }));
  if (sm.pending_demotion) sum.append(el('span', 'tag amb', `${sm.pending_demotion} GRANT CAPPED`,
    { title: 'Granted stage is above current eligibility; effective stage is capped until aai economy-reconcile logs the demotion.' }));
  sum.append(el('span', 'dim econ-cash', `cash ${pct(isNum(sm.unallocated_weight) ? sm.unallocated_weight : ec.unallocated_weight, 0)}`,
    { title: 'Unallocated paper weight. Weights are advice for the paper book only.' }));
  const tb = $('#econTable tbody'); tb.replaceChildren();
  if (!rows.length) {
    const tr = el('tr'); tr.append(el('td', 'empty', 'No strategies scored yet. Everything starts at stage 0, human-run.', { colspan: 6 })); tb.append(tr);
    return;
  }
  rows.forEach((r) => {
    const id = String(r.id || '?');
    const tr = el('tr', 'econ-row' + (r.flag ? ' econ-' + r.flag : ''));
    const nm = el('td', 'sym');
    if (r.flag) nm.append(el('span', 'tag ' + (r.flag === 'killed' ? 'neg' : 'amb'), String(r.flag).toUpperCase()), ' ');
    nm.append(document.createTextNode(id.split(':').slice(1).join(':').replace(/_/g, ' ') || id));
    const why = r.flag === 'killed' ? 'kill switch / killed or benched' : r.flag === 'demoted' ? (r.demotion_reasons || [])[0] || 'auto-demoted' : '';
    const blk = r.top_blocker ? `next S${r.next_stage}: ${r.top_blocker}${r.n_blockers > 1 ? ` (+${r.n_blockers - 1})` : ''}` : r.next_stage == null ? 'top paper stage' : '';
    nm.append(el('small', '', [String(r.origin || '').replace(/ \(.*\)$/, ''), why, blk].filter(Boolean).join(' · ')));
    nm.title = `${id} · ${r.stage_name || ''}${r.eligible_stage !== r.stage ? ` · eligible S${r.eligible_stage}` : ''}${blk ? ' · ' + blk : ''}`;
    const st = el('td', 'econ-stage');
    st.append(el('span', 'stage s' + (r.stage | 0), 'S' + (r.stage | 0), { title: 'eligible: ' + (r.stage_name || '') }));
    const gs = r.granted_stage | 0, gst = String(r.grant_status || 'none');
    st.append(el('span', 'grant g-' + gst, 'G' + gs, { title:
      gst === 'pending_demotion' ? `granted S${gs}, capped to S${r.effective_stage | 0} (above eligibility)` :
      gst === 'eligible_above_grant' ? `granted S${gs}; eligible for S${r.stage | 0}, promotion needs a human CLI grant` :
      gst === 'ok' ? `granted S${gs}${r.granted_by ? ' by ' + r.granted_by : ''}` : 'never granted: runs human-run (S0)' }));
    const e = r.expectancy_r, dd = r.max_drawdown;
    const expTd = el('td', 'n econ-exp ' + (isNum(e) ? (e >= 0 ? 'pos' : 'neg') : ''), isNum(e) ? (e > 0 ? '+' : '') + e.toFixed(2) + 'R' : '—');
    expTd.append(econHist(series, id));
    tr.append(nm, st, el('td', 'n', String(r.trades | 0)),
      expTd,
      el('td', 'n hide-sm ' + (isNum(dd) ? (dd > 0.10 ? 'neg' : dd > 0.03 ? 'amb' : '') : ''), isNum(dd) ? pct(dd, 1) : '—'),
      el('td', 'n ' + (isNum(r.weight) && r.weight > 0 ? 'cy' : 'dim'), isNum(r.weight) ? pct(r.weight, 0) : '—'));
    tb.append(tr);
  });
}

// Stage-change feed (GET /api/economy/history, read-only, ECONOMY.md E6). Snapshots are taken once a day at/after 07:00 CT
// by the HUD server or `aai economy-snapshot`; the browser never triggers one. textContent only.
const ECON_KIND = { promoted: ['ELIGIBLE UP', 'cy'], demoted: ['DEMOTED', 'amb'], killed: ['KILLED', 'neg'], grant_demoted: ['GRANT DOWN', 'amb'],
  granted: ['GRANTED', 'cy'], revived: ['REVIVED', 'dim'], new: ['NEW', 'dim'], removed: ['REMOVED', 'dim'] };
function renderEconFeed(h) {
  const ls = h.last_snapshot;
  $('#econSnap').textContent = ls ? `last snapshot ${ls.day}${h.stale ? ' · STALE' : ''}` : `no snapshot yet · first one at ${h.due_hour_ct | 0}:00 CT`;
  $('#econSnap').className = h.stale ? 'amb' : '';
  const ul = $('#econEvents'); ul.replaceChildren();
  const evs = Array.isArray(h.events) ? h.events.slice(0, 5) : [];
  if (!evs.length) {
    ul.append(el('li', 'empty', ls ? `No stage changes across ${(h.snapshots || []).length} daily snapshot${(h.snapshots || []).length === 1 ? '' : 's'}.` :
      'Stage history starts with the first daily snapshot.'));
    return;
  }
  evs.forEach((e) => {
    const [lab, cls] = ECON_KIND[e.kind] || [String(e.kind || '?').toUpperCase(), 'dim'];
    const li = el('li', 'sev-' + (e.sev || 'info'), null, { title: String(e.detail || '') });
    const nm = String(e.strategy || '?'); const short = nm.split(':').slice(1).join(':').replace(/_/g, ' ') || nm;
    const mv = (e.from_stage != null && e.to_stage != null) ? `S${e.from_stage}→S${e.to_stage}` : e.to_stage != null ? `S${e.to_stage}` : '';
    li.append(el('span', 'tag ' + cls, lab), el('b', '', short), el('span', 'mv', mv), el('time', 'dim', String(e.day || '')));
    ul.append(li);
  });
}

/* ------------------------------------------------------------ INTEL (GET /api/intel, read-only) */
// Institutional market intel from keyless public sources, cached server-side in SQLite and refreshed by the HUD
// process. Every panel shows its source, last update (CT) and a LIVE / STALE / UNAVAILABLE badge. Nothing is
// invented client-side: a missing value renders as a dash. All strings are textContent only.
const I = { d: null, highOnly: localStorage.getItem('zoora.calAll') !== '1', timer: null, inflight: false };
const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtMD = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const fx = (v, d = 2) => isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const sgn = (v, d = 2, u = '') => isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + u : '—';
const cls = (v) => !isNum(v) ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const big = (v) => !isNum(v) ? '—' : Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(2) + 'T' : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B'
  : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
function countdown(sec) {
  if (!isNum(sec)) return '—';
  if (sec <= 0) return sec > -120 ? 'NOW' : 'done';
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function spark(points, w = 64, h = 18, c = 'var(--cyan)', opts) {
  const svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spk', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const raw = points || [];
  const ys = raw.map((p) => Array.isArray(p) ? p[1] : p).filter(isNum);
  if (ys.length < 2) return svg;
  const lo = Math.min(...ys), hi = Math.max(...ys), r = hi - lo || 1;
  const yp = (y) => hi === lo ? h / 2 : h - 1 - (y - lo) / r * (h - 2);  // a flat series sits mid-height, not on the floor
  const d = ys.map((y, i) => `${i ? 'L' : 'M'}${(i / (ys.length - 1) * w).toFixed(1)},${yp(y).toFixed(1)}`).join('');
  svg.append(sv('path', { d, fill: 'none', stroke: c, 'stroke-width': '1.2', 'vector-effect': 'non-scaling-stroke' }));
  // Optional CT hover tip (equity curve only). Other call sites pass no opts and get the bare svg.
  if (opts && opts.tip && raw.length >= 2 && Array.isArray(raw[0])) {
    const mark = sv('circle', { r: '2.2', fill: c, opacity: '0', class: 'spk-mark' });
    svg.append(mark);
    const tip = opts.tip;
    svg.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const i = Math.round(x * (raw.length - 1));
      const pt = raw[i];
      if (!pt || !isNum(pt[0]) || !isNum(pt[1])) return;
      mark.setAttribute('cx', (i / (raw.length - 1) * w).toFixed(1));
      mark.setAttribute('cy', yp(pt[1]).toFixed(1));
      mark.setAttribute('opacity', '1');
      tip.textContent = `${fmtEqHover.format(new Date(pt[0] * 1000))} CT · ${money(pt[1])}`;
      tip.classList.remove('dim');
    });
    svg.addEventListener('mouseleave', () => {
      mark.setAttribute('opacity', '0');
      tip.textContent = 'hover the curve for a CT reading';
      tip.classList.add('dim');
    });
    svg.style.cursor = 'crosshair';
  }
  return svg;
}
function feedMeta(box) {
  const feeds = (box.dataset.feeds || '').split(',').filter(Boolean);
  box.replaceChildren();
  feeds.forEach((f) => {
    const v = I.d && I.d.feeds && I.d.feeds[f];
    if (!v) return;
    const st = v.status || 'unavailable';
    const b = el('span', 'fm fm-' + st, null, {
      title: `${v.label} — ${v.source}${v.note ? '. ' + v.note : ''}${v.stale_reason ? '\n' + st.toUpperCase() + ': ' + v.stale_reason : ''}${v.last_error ? '\nlast error: ' + v.last_error : ''}`,
    });
    b.append(el('b', '', st === 'live' ? 'LIVE' : st === 'stale' ? 'STALE' : 'N/A'), el('span', 'fm-src', v.source.split(' (')[0]),
      el('span', 'fm-t', v.fetched_at ? fmtTime.format(new Date(v.fetched_at * 1000)) + ' CT' : (v.stale_reason || 'no data')));
    box.append(b);
  });
}
const P = (f) => (I.d && I.d.feeds && I.d.feeds[f] && I.d.feeds[f].payload) || null;

function renderIntelSum() {
  const d = I.d, s = d.summary || {}, rg = d.regime || {};
  const box = $('#intelSum'); box.replaceChildren();
  box.append(el('span', 'is-reg is-' + String(rg.label || '').toLowerCase().replace(/[^a-z]+/g, '-'), rg.label || '—', { title: rg.disclaimer || '' }),
    el('span', 'is-f', `${s.live || 0} LIVE`), el('span', s.stale ? 'is-f amb' : 'is-f dim', `${s.stale || 0} STALE`),
    el('span', s.unavailable ? 'is-f neg' : 'is-f dim', `${s.unavailable || 0} N/A`), el('span', 'is-t', d.generated_ct || ''));
}
function renderTape() {
  const t = $('#intelTape'); t.replaceChildren();
  const rows = (P('markets') || {}).rows || [];
  const order = ['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', 'TNX', 'GOLD', 'WTI', 'EURUSD', 'USDJPY', 'AUDUSD', 'BTCUSD'];
  const m = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  if (!rows.length) { t.append(el('span', 'tk dim', 'Cross-asset quotes unavailable: ' + (((I.d.feeds || {}).markets || {}).stale_reason || 'no data'))); return; }
  order.filter((k) => m[k]).forEach((k) => {
    const r = m[k], up = isNum(r.chg) ? r.chg : null;
    const n = el('span', 'tk', null, { title: `${r.name} · ${r.yahoo} · ${r.ts ? fmtDay.format(new Date(r.ts * 1000)) + ' CT' : ''} · 20d ${pct(r.chg_20d, 1)}` });
    n.append(el('b', '', k), el('span', '', r.symbol.length === 6 && r.class === 'fx' ? fx(r.last, 4) : fx(r.last, r.last > 1000 ? 0 : 2)),
      el('i', cls(up), up === null ? '—' : sgn(up * 100, 2, '%')), spark(r.spark, 40, 14, up < 0 ? 'var(--red)' : 'var(--green)'));
    t.append(n);
  });
}
function renderRegime() {
  const rg = I.d.regime || {}, box = $('#regimeBody'); box.replaceChildren();
  const head = el('div', 'rg-head');
  const lab = el('div', 'rg-label rg-' + String(rg.label || '').toLowerCase().replace(/[^a-z]+/g, '-'), rg.label || '—');
  const meter = el('div', 'rg-meter', null, { role: 'img', 'aria-label': `score ${rg.score} of ${rg.n_inputs}` });
  const pos = isNum(rg.norm) ? (rg.norm + 1) / 2 * 100 : 50;
  const pin = el('i'); pin.style.left = pos.toFixed(1) + '%'; meter.append(pin);
  head.append(lab, el('div', 'rg-score', isNum(rg.score) ? `score ${rg.score > 0 ? '+' : ''}${rg.score} / ${rg.n_inputs} inputs` : `${rg.n_inputs || 0} inputs`), meter);
  box.append(head);
  const tb = el('table', 'tbl rg-tbl'), th = el('thead'), tr = el('tr');
  ['Input', 'Value', 'Rule', ''].forEach((h, i) => tr.append(el('th', i === 1 ? 'n' : i === 2 ? 'hide-sm' : '', h)));
  th.append(tr); tb.append(th);
  const tbody = el('tbody');
  (rg.rows || []).forEach((r) => {
    const row = el('tr');
    row.append(el('td', '', r.input, { title: r.source }), el('td', 'n', `${isNum(r.value) ? fx(r.value, Math.abs(r.value) >= 100 ? 0 : 2) : '—'}${r.unit ? ' ' + r.unit : ''}`),
      el('td', 'hide-sm dim', r.rule), el('td', 'n rg-s rg-s' + r.score, r.score > 0 ? 'ON' : r.score < 0 ? 'OFF' : '·'));
    tbody.append(row);
  });
  tb.append(tbody);
  box.append(el('div', 'table-wrap', null), el('div', 'rg-disc', (rg.disclaimer || '') + (rg.rule ? ' Rule: ' + rg.rule + '.' : '')));
  box.children[1].append(tb);
}
function renderMacro() {
  const r = P('rates'), fr = (P('fred') || {}).series || {};
  const svg = $('#curveSvg'); svg.replaceChildren();
  const kv = $('#ratesKv'); kv.replaceChildren();
  $('#macroMeta').textContent = r ? `UST curve ${r.as_of}` : '';
  if (r && (r.curve || []).length > 2) {
    const W = 320, H = 120, padL = 26, padB = 16, padT = 8;
    const all = r.curve.concat(r.prev_curve || []).map((p) => p.y).filter(isNum);
    const lo = Math.floor((Math.min(...all) - 0.1) * 4) / 4, hi = Math.ceil((Math.max(...all) + 0.1) * 4) / 4;
    const xs = (yrs) => padL + Math.log(1 + yrs * 4) / Math.log(1 + 30 * 4) * (W - padL - 6);
    const ys = (y) => padT + (1 - (y - lo) / (hi - lo || 1)) * (H - padT - padB);
    for (let g = lo; g <= hi + 1e-9; g += (hi - lo) > 1.5 ? 0.5 : 0.25) {
      svg.append(sv('line', { x1: padL, x2: W - 4, y1: ys(g), y2: ys(g), class: 'cg' }));
      const t = sv('text', { x: 2, y: ys(g) + 3, class: 'ct' }); t.textContent = g.toFixed(2); svg.append(t);
    }
    const path = (pts) => pts.filter((p) => isNum(p.y)).map((p, i) => `${i ? 'L' : 'M'}${xs(p.years).toFixed(1)},${ys(p.y).toFixed(1)}`).join('');
    if ((r.prev_curve || []).length) svg.append(sv('path', { d: path(r.prev_curve), class: 'cprev' }));
    svg.append(sv('path', { d: path(r.curve), class: 'cnow' }));
    r.curve.forEach((p) => {
      if (!isNum(p.y)) return;
      svg.append(sv('circle', { cx: xs(p.years), cy: ys(p.y), r: 1.8, class: 'cdot' }));
      if (['3M', '2Y', '5Y', '10Y', '30Y'].includes(p.tenor)) { const t = sv('text', { x: xs(p.years), y: H - 3, class: 'ct cx' }); t.textContent = p.tenor; svg.append(t); }
    });
  } else {
    const t = sv('text', { x: 160, y: 60, class: 'ct cna' }); t.textContent = 'Treasury curve unavailable'; svg.append(t);
  }
  const add = (k, v, sub, c) => { const n = el('div', 'kv'); n.append(el('span', '', k), el('b', c || '', v), el('small', '', sub || '')); kv.append(n); };
  if (r) {
    add('2Y', fx(r.y2) + '%', '');
    add('10Y', fx(r.y10) + '%', isNum(r.d10_bp) ? sgn(r.d10_bp, 0, ' bp d/d') : '', '');
    add('2s10s', sgn(r.s2s10_bp, 0, ' bp'), isNum(r.s2s10_bp_1w) ? `1w ago ${sgn(r.s2s10_bp_1w, 0)}` : '', r.inverted_2s10s ? 'neg' : 'pos');
    add('3m10y', sgn(r.s3m10y_bp, 0, ' bp'), isNum(r.s3m10y_bp_1w) ? `1w ago ${sgn(r.s3m10y_bp_1w, 0)}` : '', r.inverted_3m10y ? 'neg' : 'pos');
  }
  const tb = $('#fredTable tbody'); tb.replaceChildren();
  const ids = Object.keys(fr);
  if (!ids.length) { tb.append(noteRow('FRED', ((I.d.feeds.fred || {}).stale_reason) || 'unavailable', 5)); return; }
  ids.forEach((id) => {
    const s = fr[id], tr = el('tr', null, null, { title: `${id} · ${s.name || ''}` });
    const unitPct = s.unit === '%';
    const d = (v) => !isNum(v) ? '—' : unitPct ? sgn(v * 100, 0, 'bp') : sgn(v, 2);
    const td0 = el('td', ''); td0.append(el('span', '', s.name || id), spark(s.spark, 46, 12));
    tr.append(td0, el('td', 'n', isNum(s.value) ? fx(s.value, s.value > 50 ? 1 : 2) + (unitPct ? '%' : '') : '—'),
      el('td', 'n ' + cls(s.chg_1w), d(s.chg_1w)), el('td', 'n hide-sm ' + cls(s.chg_1m), d(s.chg_1m)), el('td', 'n dim', s.date ? s.date.slice(5) : '—'));
    tb.append(tr);
  });
}
function renderCalendar() {
  const c = P('calendar'), tb = $('#calTable tbody'), nx = $('#calNext');
  tb.replaceChildren(); nx.replaceChildren();
  const btn = $('#calFilter'); btn.textContent = I.highOnly ? 'HIGH ONLY' : 'ALL'; btn.setAttribute('aria-pressed', String(I.highOnly));
  if (!c) { tb.append(noteRow('Calendar', ((I.d.feeds.calendar || {}).stale_reason) || 'unavailable', 7)); return; }
  const now = Date.now() / 1000, ccy = I.d.calendar_countries || ['USD', 'AUD'];
  const nh = (I.d.next_high || [])[0];
  if (nh) {
    const b = el('div', 'cn');
    b.append(el('span', 'cn-l', 'NEXT HIGH-IMPACT'), el('b', 'cn-e', `${nh.country} ${nh.title}`),
      el('span', 'cn-w', fmtDay.format(new Date(nh.ts * 1000)) + ' CT'), el('span', 'cn-cd', countdown(nh.ts - now), { 'data-ts': nh.ts }));
    nx.append(b);
  } else nx.append(el('div', 'cn dim', `No more high-impact ${ccy.join('/')} events this week.`));
  const ev = (c.events || []).filter((e) => (I.highOnly ? e.rank === 3 : e.rank >= 1) && e.ts > now - 6 * 3600);
  if (!ev.length) tb.append(noteRow('', I.highOnly ? 'No upcoming high-impact events this week.' : 'No upcoming events this week.', 7));
  ev.slice(0, 40).forEach((e) => {
    const watch = ccy.includes(e.country) && e.rank === 3;
    const tr = el('tr', (watch ? 'cal-watch ' : '') + (e.ts < now ? 'cal-past' : ''));
    tr.append(el('td', 'dim', fmtDay.format(new Date(e.ts * 1000))), el('td', '', null), el('td', 'ccy', e.country),
      el('td', 'ev', e.title), el('td', 'n', e.forecast || '—'), el('td', 'n hide-sm dim', e.previous || '—'),
      el('td', 'n cd', e.ts < now ? 'done' : countdown(e.ts - now), { 'data-ts': e.ts }));
    tr.children[1].append(el('i', 'imp imp' + e.rank, null, { title: e.impact }));
    tb.append(tr);
  });
}
// FX session clocks (sessions.js, clock-only, no feed): Sydney/Tokyo/London/New York open state, local time,
// time to the next open/close, and the overlap that is live. Re-rendered every 30 s; countdowns tick with the rest.
function renderSessions() {
  const box = $('#fxSess'); if (!box || !window.ZooraSessions) return;
  const r = window.ZooraSessions.fxSessions(Date.now());
  maybeSessionChime(r);
  box.replaceChildren();
  r.rows.forEach((x) => {
    const c = el('div', 'fs ' + (x.open ? 'fs-open' : 'fs-shut'), null,
      { title: `${x.city} session ${x.hours} local (${x.tz})${r.weekend ? ' · FX weekend: closed Fri 17:00 to Sun 17:00 New York' : ''}` });
    c.append(el('span', 'fs-c', x.city.toUpperCase()), el('b', 'fs-t', x.local),
      el('span', 'fs-s', x.open ? 'OPEN' : 'CLOSED'));
    const nx = el('span', 'fs-n', null);
    nx.append(document.createTextNode(x.open ? 'closes ' : 'opens '));
    if (x.next_ms) nx.append(el('span', '', countdown(x.next_ms / 1000 - Date.now() / 1000), { 'data-ts': Math.round(x.next_ms / 1000) }));
    else nx.append(document.createTextNode('—'));
    c.append(nx); box.append(c);
  });
  const ovLabel = r.weekend ? 'FX WEEKEND · markets shut' :
    r.overlaps.length ? 'OVERLAP · ' + r.overlaps.join(' · ') : 'no session overlap';
  const ov = el('div', 'fs-ov' + (r.overlaps.length ? ' on' : ''), ovLabel);
  ov.title = S.sessionChime
    ? 'Session-open chime ON (London/New York). Press S to disable. Soft chime, once per session per CT day.'
    : 'Session-open chime OFF (default). Press S to enable a soft chime when London or New York opens.';
  box.append(ov);
}
/* Soft, optional London/NY open chime (P3). Off by default; deduped per session per CT day. Mute still silences it. */
function maybeSessionChime(snap) {
  const watch = { ldn: 1, nyc: 1 };
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(snap.now_ms));
  let seen;
  try { seen = JSON.parse(localStorage.getItem('zoora.sessionChimeSeen') || '{}'); } catch (_) { seen = {}; }
  if (seen.day !== day) seen = { day, ids: [] };
  if (!Array.isArray(seen.ids)) seen.ids = [];
  snap.rows.forEach((row) => {
    const was = S.sessionOpen[row.id];
    S.sessionOpen[row.id] = row.open;
    if (!S.sessionChime || snap.weekend || !watch[row.id]) return;
    if (row.open && was === false && !seen.ids.includes(row.id)) {
      seen.ids.push(row.id);
      try { localStorage.setItem('zoora.sessionChimeSeen', JSON.stringify(seen)); } catch (_) { /* private mode */ }
      chime('info');
    }
  });
}
function setSessionChime(on) {
  S.sessionChime = !!on;
  try { localStorage.setItem('zoora.sessionChime', on ? '1' : '0'); } catch (_) { /* ignore */ }
}
function tickCountdowns() {
  const now = Date.now() / 1000;
  document.querySelectorAll('#intel [data-ts]').forEach((n) => {
    const dt = Number(n.dataset.ts) - now;
    n.textContent = dt < -120 && n.classList.contains('cd') ? 'done' : countdown(dt);
    n.classList.toggle('cd-warn', dt > 300 && dt <= 1800);
    n.classList.toggle('cd-high', dt > -120 && dt <= 300);
  });
}
function renderDerivs() {
  const tb = $('#derivTable tbody'); tb.replaceChildren();
  const rows = [].concat((P('deriv_blofin') || {}).rows || [], (P('deriv_okx') || {}).rows || []);
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.venue.localeCompare(b.venue));
  if (!rows.length) tb.append(noteRow('Perps', 'Blofin and OKX derivatives feeds unavailable', 7));
  rows.forEach((r) => {
    const f = r.funding_8h, hot = isNum(f) && Math.abs(f) >= 0.0005;
    const tr = el('tr', hot ? 'hot' : '', null, { title: `next funding ${r.next_funding_ts ? fmtHM.format(new Date(r.next_funding_ts * 1000)) + ' CT' : '—'} · interval ${r.funding_interval_h || '?'}h · 24h ${pct(r.chg_24h, 2)}` });
    tr.append(el('td', 'sym', r.symbol), el('td', 'dim', r.venue.toUpperCase()), el('td', 'n', px(r.mark)),
      el('td', 'n ' + cls(f), isNum(f) ? sgn(f * 100, 4, '%') : '—'), el('td', 'n hide-sm ' + cls(r.funding_apr), pct(r.funding_apr, 1)),
      el('td', 'n', isNum(r.oi_usd) ? '$' + big(r.oi_usd) : '—'), el('td', 'n ' + cls(r.basis_bp), sgn(r.basis_bp, 1, 'bp')));
    tb.append(tr);
  });
  const kv = $('#optKv'); kv.replaceChildren();
  const add = (k, v, sub, c, sp) => { const n = el('div', 'kv'); n.append(el('span', '', k), el('b', c || '', v), el('small', '', sub || '')); if (sp) n.append(sp); kv.append(n); };
  const o = (P('options_deribit') || {}).assets || {};
  Object.keys(o).forEach((a) => {
    const v = o[a];
    add(`${a} DVOL`, fx(v.dvol, 1), `24h ${sgn(v.chg_24h, 2)} · hi ${fx(v.hi_24h, 1)} lo ${fx(v.lo_24h, 1)}`, '', spark(v.spark, 60, 14));
    add(`${a} put/call OI`, fx(v.pc_oi, 2), `vol 24h ${fx(v.pc_vol_24h, 2)} · ${v.n_instruments || '—'} strikes`, v.pc_oi > 1 ? 'neg' : 'pos');
  });
  const fg = P('fear_greed');
  if (fg) add('Fear & Greed', fx(fg.value, 0), `${fg.label} · prev ${fx(fg.prev, 0)} · 1w ${fx(fg.week_ago, 0)}`, fg.value <= 30 ? 'neg' : fg.value >= 60 ? 'pos' : 'amb', spark(fg.spark, 60, 14, 'var(--amber)'));
  const st = P('stablecoins');
  if (st) add('Stablecoins', '$' + big(st.total_usd), `7d ${st.chg_7d_usd >= 0 ? '+' : '−'}$${big(Math.abs(st.chg_7d_usd))} (${sgn(st.chg_7d_pct * 100, 2, '%')})`, cls(st.chg_7d_usd));
}
function renderCot() {
  const c = P('cot'), box = $('#cotBody'); box.replaceChildren();
  $('#cotMeta').textContent = c ? `report ${c.report_date}` : '';
  if (!c) { box.append(el('div', 'dim', 'COT unavailable: ' + (((I.d.feeds.cot || {}).stale_reason) || 'no data'))); return; }
  (c.rows || []).forEach((r) => {
    const lev = isNum(r.lev_net) && r.class !== 'commodity';
    const net = lev ? r.lev_net : r.nc_net, chg = lev ? r.lev_net_chg : r.nc_net_chg;
    const p = isNum(net) && isNum(r.oi) && r.oi ? net / r.oi * 100 : null;
    const row = el('div', 'cot-r', null, { title: `${r.name} · ${lev ? 'leveraged funds (TFF)' : 'non-commercial (legacy)'} · OI ${big(r.oi)} · specs net ${big(r.nc_net)}${isNum(r.am_net) ? ' · asset mgrs net ' + big(r.am_net) : ''}` });
    const bar = el('div', 'cot-bar'), fill = el('i', p >= 0 ? 'pos' : 'neg');
    const w = Math.min(50, Math.abs(p || 0) * 50 / 40);
    fill.style.left = (p >= 0 ? 50 : 50 - w) + '%'; fill.style.width = w + '%';
    bar.append(fill);
    row.append(el('b', 'cot-s', r.symbol), el('span', 'cot-w dim', lev ? 'LEV' : 'SPEC'), bar,
      el('span', 'n cot-n ' + cls(net), big(net)), el('span', 'n cot-c ' + cls(chg), isNum(chg) ? (chg > 0 ? '+' : chg < 0 ? '−' : '') + big(Math.abs(chg)) : '—'),
      el('span', 'n cot-i hide-sm dim', isNum(r.nc_index_26w) ? r.nc_index_26w + '' : '—'));
    box.append(row);
  });
  const hd = el('div', 'cot-r cot-h');
  hd.append(el('b', 'cot-s', 'MKT'), el('span', 'cot-w', ''), el('span', 'cot-bar-h', 'short ◂ net % OI ▸ long'), el('span', 'n cot-n', 'NET'), el('span', 'n cot-c', 'Δ W/W'), el('span', 'n cot-i hide-sm', '26W'));
  box.prepend(hd);
}
// T8 FX pair desk: server-computed (aai/intel/fxdesk.py) per-pair overlay. COT net % OI in pair terms, crowding,
// the next medium/high calendar event for either leg with a live countdown, and the cached quote. Read-only context.
// 12-week specs bias sparkline in pair terms, drawn around a dashed zero line so long/short reads at a glance.
function fxdHist(c, pair) {
  const td = el('td', 'hide-sm fxd-h');
  const h = (c && c.pair_pct_hist || []).filter((p) => Array.isArray(p) && isNum(p[1]));
  if (h.length < 2) { td.append(el('span', 'dim', '—')); return td; }
  const W = 72, H = 18, ys = h.map((p) => p[1]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), rg = hi - lo || 1;
  const y = (v) => (H - 1 - (v - lo) / rg * (H - 2)).toFixed(1), x = (i) => (i / (h.length - 1) * (W - 3)).toFixed(1);
  const last = ys[ys.length - 1], col = last >= 0 ? 'var(--green)' : 'var(--red)';
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spk fxd-spk', width: W, height: H, 'aria-hidden': 'true' });
  svg.append(sv('line', { x1: 0, x2: W, y1: y(0), y2: y(0), stroke: 'var(--dim)', 'stroke-width': '0.8', 'stroke-dasharray': '2 2', opacity: '.6' }),
    sv('path', { d: ys.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(''), fill: 'none', stroke: col, 'stroke-width': '1.3' }),
    sv('circle', { cx: x(h.length - 1), cy: y(last), r: '1.8', fill: col }));
  // Zero-crossings (server fxdesk.flips, newest first): hollow ring at the week the bias changed side.
  const fl = (Array.isArray(c.flips_12w) ? c.flips_12w : []).filter((f) => f && Number.isInteger(f.idx) && f.idx > 0 && f.idx < h.length);
  fl.forEach((f) => svg.append(sv('circle', { class: 'fxd-flip', cx: x(f.idx), cy: y(h[f.idx][1]), r: '2.4', fill: 'none',
    stroke: f.to === 'long' ? 'var(--green)' : 'var(--red)', 'stroke-width': '1' })));
  td.append(svg);
  if (fl.length) td.append(el('span', 'fxd-fc', `⇄${fl.length}`, { 'aria-hidden': 'true' }));
  const chg = c.pct_chg_hist;
  td.title = `${pair} specs net % OI, ${h.length} weekly reports ${h[0][0]} → ${h[h.length - 1][0]}: ` +
    h.map((p) => `${p[0].slice(5)} ${sgn(p[1], 1, '%')}`).join(' · ') + (isNum(chg) ? ` · change ${sgn(chg, 1, ' pts')}` : '') +
    (fl.length ? '\nflips (newest first): ' + fl.map((f) => `${f.date} to net ${f.to} (${sgn(f.from_pct, 1, '%')} → ${sgn(f.to_pct, 1, '%')})`).join(' · ')
      : '\nno bias flips in this window');
  td.setAttribute('aria-label', `${pair} 12-week specs bias ${sgn(h[0][1], 1, '%')} to ${sgn(last, 1, '%')}`);
  return td;
}
function renderFxDesk() {
  const d = I.d && I.d.fx_desk, tb = $('#fxdTable tbody'); if (!tb) return;
  tb.replaceChildren();
  const meta = $('#fxdMeta');
  if (!d || !(d.rows || []).length) { tb.append(noteRow('FX desk', 'waiting for markets/COT/calendar feeds', 9)); return; }
  meta.textContent = `COT ${d.cot_report_date || '—'} · ${d.n_event_risk} pair${d.n_event_risk === 1 ? '' : 's'} with event risk <24h` +
    (d.extremes && d.extremes.length ? ` · ${d.extremes.length} at 26W extreme` : '');
  const now = Date.now() / 1000;
  d.rows.forEach((r) => {
    const tr = el('tr', r.event_risk ? 'fxd-risk' : '');
    const q = r.quote_px, c = r.cot, e = r.next_high || r.next_event;
    const dp = r.pair.includes('JPY') ? 3 : r.pair.startsWith('XAU') ? 1 : 4;
    tr.append(el('td', 'pr', r.pair, { title: `${r.base}/${r.quote}` }),
      el('td', 'n', q ? fx(q.last, dp) : '—'), el('td', 'n ' + cls(q && q.chg), q ? sgn(q.chg * 100, 2, '%') : '—'));
    const tdc = el('td', '');
    if (c && isNum(c.pair_net_pct_oi)) {
      const fb = el('div', 'fb', null, { title: `${c.leg} futures, non-commercial specs: net ${big(c.leg_net)} (Δ ${big(c.leg_net_chg)}) · ${sgn(c.pair_net_pct_oi, 1, '%')} of OI in ${r.pair} terms${isNum(c.pair_lev_net) ? ' · lev funds ' + (c.pair_lev_net >= 0 ? 'long ' : 'short ') + r.pair + ' ' + big(Math.abs(c.pair_lev_net)) : ''} · report ${c.report_date}` });
      const bar = el('div', 'cot-bar'), p = c.pair_net_pct_oi, w = Math.min(50, Math.abs(p) * 50 / 40), f = el('i', p >= 0 ? 'pos' : 'neg');
      f.style.left = (p >= 0 ? 50 : 50 - w) + '%'; f.style.width = w + '%'; bar.append(f);
      fb.append(el('b', c.bias === 'LONG' ? 'pos' : c.bias === 'SHORT' ? 'neg' : 'dim', c.bias), bar,
        c.extreme ? el('span', 'crowd', c.extreme) : el('span', 'n dim', sgn(p, 1, '%')));
      tdc.append(fb);
    } else tdc.append(el('span', 'dim', 'no COT'));
    tr.append(tdc, fxdHist(c, r.pair), el('td', 'n hide-sm dim', c && isNum(c.pair_index_26w) ? String(c.pair_index_26w) : '—'),
      el('td', 'hide-sm ' + (c && c.flow === 'TO LONG' ? 'pos' : c && c.flow === 'TO SHORT' ? 'neg' : 'dim'), c && c.flow ? c.flow : '—'));
    const te = el('td', 'ev');
    if (e) {
      te.append(el('i', 'imp imp' + e.rank, null, { title: e.impact }), el('span', 'ccy', e.country), document.createTextNode(e.title));
      te.title = `${e.country} ${e.title} · ${fmtDay.format(new Date(e.ts * 1000))} CT · fcst ${e.forecast || '—'} · prev ${e.previous || '—'}`;
    } else te.append(el('span', 'dim', 'nothing medium/high left this week'));
    tr.append(te, el('td', 'n cd', e ? countdown(e.ts - now) : '—', e ? { 'data-ts': e.ts } : undefined));
    tb.append(tr);
  });
}
function renderFilings() {
  const p = P('filings'), tb = $('#filTable tbody'), bx = $('#filBuys');
  tb.replaceChildren(); bx.replaceChildren();
  $('#filMeta').textContent = p ? `${(p.watchlist || []).length} tickers · ${p.lookback_days}d` : '';
  if (!p) { tb.append(noteRow('EDGAR', ((I.d.feeds.filings || {}).stale_reason) || 'unavailable', 4)); return; }
  const buys = p.insider_buys || [];
  bx.append(el('span', buys.length ? 'fb pos' : 'fb dim', buys.length ? `${buys.length} OPEN-MARKET INSIDER BUY${buys.length > 1 ? 'S' : ''}` : 'No open-market insider buys (code P) in parsed Form 4s'),
    el('span', 'fb dim', `${p.n_8k} 8-K · ${p.n_form4} Form 4`));
  (p.filings || []).slice(0, 30).forEach((f) => {
    const ins = f.insider || {};
    let det = '';
    if (f.form === '8-K') det = (f.items_text || []).join(' · ') || 'current report';
    else if (ins.owner) det = `${ins.owner} (${ins.role}) ${ins.is_buy ? 'BUY $' + big(ins.buy_usd) : ins.sell_usd ? 'sell $' + big(ins.sell_usd) : (ins.codes || []).join('/') || '—'}${ins.plan_10b5_1 ? ' · 10b5-1' : ''}`;
    else det = ins.error ? 'Form 4 (parse failed)' : 'Form 4 (queued for parse)';
    const tr = el('tr', ins.is_buy ? 'fil-buy' : '');
    const a = f.url ? el('a', '', det, { href: f.url, target: '_blank', rel: 'noopener noreferrer nofollow' }) : el('span', '', det);
    const td = el('td', 'fd'); td.append(a);
    tr.append(el('td', 'dim', fmtMD.format(new Date(f.accepted_ts * 1000))), el('td', 'sym', f.ticker), el('td', f.form === '8-K' ? 'cy' : 'amb', f.form), td);
    tb.append(tr);
  });
}
function renderIntel(d) {
  I.d = d;
  [renderIntelSum, renderTape, renderRegime, renderMacro, renderCalendar, renderDerivs, renderCot, renderFilings, renderFxDesk].forEach((fn) => {
    try { fn(); } catch (e) { console.error(fn.name, e); }
  });
  document.querySelectorAll('#intel .fmeta').forEach(feedMeta);
}
async function pollIntel() {
  clearTimeout(I.timer);
  if (I.inflight) return;
  I.inflight = true;
  try {
    const r = await api('/api/intel');
    if (!r.ok || !r.data) throw new Error('HTTP ' + r.status);
    renderIntel(r.data);
  } catch (e) {
    $('#intelSum').textContent = 'intel bus unavailable: ' + e.message;
  } finally {
    I.inflight = false;
    I.timer = setTimeout(pollIntel, document.hidden ? 120000 : 15000);
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollIntel(); });
setInterval(tickCountdowns, 1000);
renderSessions(); setInterval(renderSessions, 30000);

/* ------------------------------------------------------------ boot */
async function boot() {
  const log = $('#bootLog'), bar = $('#bootBar');
  const skip = new URLSearchParams(location.search).has('noboot') || document.documentElement.classList.contains('rm');
  let done = false;
  const finish = () => {
    if (done) return; done = true; document.body.classList.remove('booting'); S.booted = true;
    setTimeout(() => $('#boot').remove(), skip ? 0 : 800);
  };
  const skipper = () => finish();
  window.addEventListener('keydown', skipper, { once: true });
  $('#boot').addEventListener('click', skipper, { once: true });
  const t0 = performance.now();
  const ovP = api('/api/zoora/overview').then((r) => r.data).catch(() => null);
  const line = (txt, val, cls) => { const li = el('li'); li.append(el('span', '', '› ' + txt), el('b', cls || 'ok', val)); log.append(li); };
  const wait = (ms) => new Promise((r) => setTimeout(r, skip ? 0 : ms));
  line('Initialising Zoora core', 'OK'); bar.style.width = '10%'; await wait(160);
  line('Network bind', location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'LOCALHOST' : location.hostname,
    location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'ok' : 'warn'); bar.style.width = '20%'; await wait(160);
  const ov = await ovP;
  const ms = Math.round(performance.now() - t0);
  if (!ov) { line('Linking AAI data plane', 'FAILED', 'bad'); bar.style.width = '100%'; await wait(900); finish(); startLink(); pollEconomy(); return; }
  applyOverview(ov, 'poll');
  line('Linking AAI data plane', `${ms} ms`); bar.style.width = '32%'; await wait(140);
  line('Execution mode', 'PAPER ONLY'); await wait(120);
  const og = ov.risk.gauges.find((g) => g.id === 'open_risk');
  line('Risk engine · open risk', `${pct(og && og.value, 2)} / 6%`, og && og.value > 0.045 ? 'warn' : 'ok'); bar.style.width = '45%'; await wait(140);
  const gk = ov.guard.global_kill || {};
  line('Kill switches · global / AAI', `${gk.engaged ? 'ENGAGED' : 'OFF'} / ${ov.risk.kill_switch.on ? 'TRIPPED' : 'ARMED'}`, gk.engaged || ov.risk.kill_switch.on ? 'bad' : 'ok'); await wait(140);
  const pl = ov.pipelines || [];
  const okN = pl.filter((p) => p.state === 'OK').length, degN = pl.filter((p) => /DEGRADED|FAIL|ERROR/.test(p.state)).length;
  line('Pipelines', `${okN}/${pl.length} OK${degN ? ` · ${degN} degraded` : ''}`, degN ? 'warn' : 'ok'); bar.style.width = '62%'; await wait(140);
  const crit = (ov.alerts || []).filter((a) => a.sev === 'critical').length, high = (ov.alerts || []).filter((a) => a.sev === 'high').length;
  line('Alarm bus', `${crit} critical · ${high} high`, crit ? 'bad' : high ? 'warn' : 'ok'); await wait(140);
  line('Audit hash chain', ov.audit.verify.ok ? `${ov.audit.verify.entries} entries verified` : 'BROKEN', ov.audit.verify.ok ? 'ok' : 'bad'); bar.style.width = '80%'; await wait(140);
  line('Voice input', SR ? 'READY' : 'UNAVAILABLE', SR ? 'ok' : 'warn'); await wait(120);
  line('Language model', ov.meta.llm.present ? String(ov.meta.llm.provider).toUpperCase() : 'NO KEY · intents only', ov.meta.llm.present ? 'ok' : 'warn');
  bar.style.width = '100%'; await wait(650);
  finish();
  startLink();
  pollEconomy();
}

/* ------------------------------------------------------------ wiring */
function wire() {
  setMuted(S.muted);
  $('#muteBtn').onclick = () => { audioCtx(); setMuted(!S.muted); if (!S.muted) chime('info'); };
  $('#cmdForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#cmdInput'); const v = i.value; i.value = ''; ask(v, 'typed'); });
  $('#cmdInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && S.history.length) { S.hIdx = Math.min(S.history.length - 1, S.hIdx + 1); e.target.value = S.history[S.hIdx]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { S.hIdx = Math.max(-1, S.hIdx - 1); e.target.value = S.hIdx >= 0 ? S.history[S.hIdx] : ''; e.preventDefault(); }
    if (e.key === 'Escape') e.target.blur();
  });
  $('#quick').addEventListener('click', (e) => { const b = e.target.closest('button[data-q]'); if (b) ask(b.dataset.q, 'button'); });
  $('#micBtn').onclick = () => ptt.toggle();
  if (!SR) { $('#micBtn').classList.add('unsupported'); note('Voice input needs Chrome or Edge on your own device. Typing works everywhere.'); }
  else note('Hold Space to talk · tap the mic (pause ~1s to send) · Esc stops Zoora talking. Audio goes to your browser’s speech service.');
  const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.tagName === 'BUTTON');
  // Keyboard shortcuts help (`?`) and panel jumps. Navigation only: no shortcut can change state.
  const dlg = $('#keysDlg');
  let keysPrev = null;
  const keysOpen = () => !dlg.hidden;
  const showKeys = (on) => {
    if (on === keysOpen()) return;
    if (on) { keysPrev = document.activeElement; dlg.hidden = false; $('#keysClose').focus(); }
    else { dlg.hidden = true; if (keysPrev && keysPrev.focus) keysPrev.focus(); }
    $('#keysBtn').setAttribute('aria-expanded', String(on));
  };
  $('#keysBtn').onclick = () => showKeys(!keysOpen());
  if (/(?:^#|&)keys(?:&|$)/.test(location.hash)) setTimeout(() => showKeys(true), 0);  // /zoora#keys deep link
  $('#keysClose').onclick = () => showKeys(false);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) showKeys(false); });
  const jumpPanel = (n) => {
    const p = [...document.querySelectorAll('section.panel')].find((s) => (s.querySelector('h2 em') || {}).textContent === String(n));
    if (!p) return;
    if (!p.hasAttribute('tabindex')) p.setAttribute('tabindex', '-1');
    p.scrollIntoView({ behavior: 'smooth', block: 'start' }); p.focus({ preventScroll: true });
    p.classList.remove('jumped'); void p.offsetWidth; p.classList.add('jumped');
  };
  window.addEventListener('keydown', (e) => {
    if (keysOpen()) {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); showKeys(false); }
      else if (e.key === 'Tab') { e.preventDefault(); $('#keysClose').focus(); }  // single control: keep focus inside
      return;
    }
    // Esc barge-in: stop Zoora talking when not typing in an input and keys help is closed.
    if (e.key === 'Escape' && !e.repeat && (speaking || S.core === 'speaking' || ptt.active)) {
      const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (!inField) {
        e.preventDefault();
        if (ptt.active) ptt.stop();
        stopTalking();
        note('Stopped.');
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && !e.repeat && !typing(e.target) && S.booted) { e.preventDefault(); ptt.start('hold'); }
    if (typing(e.target) && e.target.tagName !== 'BUTTON') return;
    if (e.key === '/') { e.preventDefault(); $('#cmdInput').focus(); }
    else if (e.key === '?') { e.preventDefault(); showKeys(true); }
    else if ((e.key === 'c' || e.key === 'C') && !e.repeat) { setHC(!document.documentElement.classList.contains('hc')); }
    else if ((e.key === 'r' || e.key === 'R') && !e.repeat) { setRM(!document.documentElement.classList.contains('rm')); }
    else if (e.key === 'm' || e.key === 'M') { audioCtx(); setMuted(!S.muted); if (!S.muted) chime('info'); }
    else if ((e.key === 's' || e.key === 'S') && !e.repeat) {
      audioCtx(); setSessionChime(!S.sessionChime);
      if (S.sessionChime && !S.muted) chime('info');
      renderSessions();
    }
    else if ((e.key === 'i' || e.key === 'I') && !e.repeat) { const n = $('#intel'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (/^[0-9]$/.test(e.key) && !e.repeat) { e.preventDefault(); jumpPanel(e.key === '0' ? 10 : Number(e.key)); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space' && !typing(e.target) && ptt.active) { e.preventDefault(); ptt.stop(); } });
  $('#hcBtn').onclick = () => setHC(!document.documentElement.classList.contains('hc'));
  $('#rmBtn').onclick = () => setRM(!document.documentElement.classList.contains('rm'));
  $('#wakeToggle').checked = localStorage.getItem('zoora.wake') === '1' && !!SR;
  $('#wakeToggle').onchange = (e) => wake.enable(e.target.checked);
  if ($('#wakeToggle').checked) wake.enable(true);
  $('#speakToggle').checked = localStorage.getItem('zoora.speak') !== '0';
  $('#speakToggle').onchange = (e) => { localStorage.setItem('zoora.speak', e.target.checked ? '1' : '0'); if (!e.target.checked) stopTalking(); };
  fillVoiceSelect();
  const vsel = $('#voiceSelect');
  if (vsel) vsel.onchange = (e) => {
    try { localStorage.setItem('zoora.voice', e.target.value || ''); } catch (_) { /* private mode */ }
    pickVoice();
  };
  $('#refreshHeavy').onclick = async () => {
    $('#refreshHeavy').disabled = true; $('#refreshHeavy').textContent = 'CHECKING…';
    try { await api('/api/zoora/refresh', {}); } catch (_) { /* surfaced via link chip */ }
    setTimeout(poll, 800);
  };
  $('#scoreForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = $('#mintInput').value.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) { showReply('That is not a valid Solana mint address (base58, 32 to 44 characters).', true); return; }
    $('#mintInput').value = '';
    ask('score ' + m, 'score-form');
  });
  $('#calFilter').onclick = () => { I.highOnly = !I.highOnly; localStorage.setItem('zoora.calAll', I.highOnly ? '0' : '1'); if (I.d) renderCalendar(); };
  tickClock(); setInterval(tickClock, 1000);
  setCore('idle');
}


/* ------------------------------------------------------------ PWA offline shell (localhost installable)
 * Registers /sw.js (scope /). Caches Zoora HTML/CSS/JS/fonts/icons only — never /api/*.
 * Offline banner + OFFLINE chip when navigator is offline or link is lost after retries.
 */
function setOfflineUI(off, why) {
  const ban = $('#offlineBanner');
  const chip = $('#chipOffline');
  if (ban) {
    if (off) { ban.hidden = false; ban.textContent = why || 'OFFLINE · shell cached · live data needs local aai hud'; }
    else ban.hidden = true;
  }
  if (chip) {
    // .chip { display:inline-flex } beats UA [hidden]; toggle attribute + class explicitly.
    if (off) {
      chip.hidden = false; chip.removeAttribute('hidden');
      chip.textContent = 'OFFLINE'; chip.className = 'chip bad';
      chip.title = why || 'Browser offline or HUD unreachable';
    } else {
      chip.hidden = true; chip.setAttribute('hidden', '');
      chip.className = 'chip'; chip.textContent = 'OFFLINE';
    }
  }
}
function syncOnlineState() {
  // OFFLINE chip/banner only from the browser offline event — never from a startup navigator.onLine
  // probe (headless/embeds often lie) and never as a mirror of LINK LOST (#chipLink owns that).
  const off = typeof navigator !== 'undefined' && navigator.onLine === false && S._browserOffline === true;
  setOfflineUI(off, off ? 'OFFLINE · shell cached · reconnect to reach local aai hud' : '');
}
function registerZooraSW() {
  if (!('serviceWorker' in navigator)) return;
  // Localhost / loopback only — never register on a non-local host (defense in depth; HUD binds 127.0.0.1).
  const h = location.hostname;
  if (h !== '127.0.0.1' && h !== 'localhost' && h !== '[::1]') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      S.sw = !!reg;
    }).catch(() => { /* private mode / blocked — HUD still works online */ });
  });
  window.addEventListener('online', () => {
    S._browserOffline = false;
    syncOnlineState();
    if (S.booted) poll();
  });
  window.addEventListener('offline', () => {
    S._browserOffline = true;
    syncOnlineState();
  });
}

registerZooraSW();
wire();
boot();
syncOnlineState();
pollIntel();
// Perps arena leaderboard: each arm is its own $100 paper simulation (perps-pipeline, read-only here).
// Each row has an equity sparkline (arena.sqlite `equity`, downsampled server-side); click or Enter opens its closed trades.
const openArms = new Set();
// deep link: /zoora#arm=maker_scalp opens that arm's trades on load
(location.hash.match(/(?:^#|&)arm=([\w-]{1,40})/) || [])[1] && openArms.add(location.hash.match(/(?:^#|&)arm=([\w-]{1,40})/)[1]);
function armSpark(curve, initial) {
  const W = 52, H = 18, P = 2;
  const svg = sv('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
  const pts = (curve || []).filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (pts.length < 2) { svg.append(sv('line', { x1: P, x2: W - P, y1: H / 2, y2: H / 2, class: 'sp-flat' })); return svg; }
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const ys = pts.map((p) => p[1]).concat(isNum(initial) ? [initial] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const X = (t) => P + (W - 2 * P) * ((t - t0) / ((t1 - t0) || 1));
  const Y = (v) => H - P - (H - 2 * P) * ((v - lo) / (hi - lo));
  if (isNum(initial)) svg.append(sv('line', { x1: P, x2: W - P, y1: Y(initial), y2: Y(initial), class: 'sp-base' }));
  const last = pts[pts.length - 1][1];
  const cls = !isNum(initial) || Math.abs(last - initial) < 1e-9 ? 'sp-flat' : last > initial ? 'sp-up' : 'sp-dn';
  svg.append(sv('polyline', { points: pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' '), class: 'sp-line ' + cls }));
  svg.append(sv('circle', { cx: X(pts[pts.length - 1][0]).toFixed(1), cy: Y(last).toFixed(1), r: 1.8, class: 'sp-dot ' + cls }));
  return svg;
}
const ctTime = (ts) => isNum(ts) ? new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT' : '—';
const drPx = (v) => !isNum(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
const sideTd = (side) => el('td', side === 'long' ? 'pos' : side === 'short' ? 'neg' : '', String(side || '?').toUpperCase());
// Agent-written thesis / postmortem: sanitised server-side (agent_guard) and rendered only as textContent.
function noteRow(label, text, ncol) {
  const r = el('tr', 'drill-note'); const td = el('td', '', null, { colspan: ncol });
  const d = el('div', 'note'); d.append(el('b', '', label + ' '), el('span', '', String(text))); d.title = String(text);
  td.append(d);
  r.append(td); return r;
}
function drillSection(title, n, cols, rows) {
  const box = el('div', 'drill-sec');
  box.append(el('div', 'drill-h', `${title} · ${n}`));
  if (!n) { box.append(el('div', 'dim drill-empty', 'none')); return box; }
  const t = el('table', 'tbl drill'); const hr = el('tr');
  cols.forEach(([h, c]) => hr.append(el('th', c, h)));
  const th = el('thead'); th.append(hr); t.append(th);
  const tb = el('tbody'); rows.forEach((r) => tb.append(r)); t.append(tb);
  const w = el('div', 'drill-wrap'); w.append(t); box.append(w);
  return box;
}
// Arm detail drawer: open simulated positions (with thesis), resting simulated limit orders, last closed trades (with postmortem).
function armTrades(a, ncol) {
  const tr = el('tr', 'arm-drill'); const td = el('td', '', null, { colspan: ncol });
  const now = Date.now() / 1000;
  const opens = a.open_trades || [], rest = a.resting || [], list = a.trades || [];
  const oCols = [['Pair', ''], ['Side', ''], ['Entry', 'n'], ['Stop', 'n'], ['Target', 'n hide-sm'], ['uP&L', 'n']];
  const oRows = [];
  opens.forEach((x) => {
    const r = el('tr');
    r.append(el('td', 'sym', x.symbol || '?'), sideTd(x.side), el('td', 'n', drPx(x.entry)), el('td', 'n neg', drPx(x.stop)),
      el('td', 'n pos hide-sm', drPx(x.target)),
      el('td', 'n ' + (isNum(x.unrealized) ? (x.unrealized >= 0 ? 'pos' : 'neg') : ''), signed(x.unrealized)));
    oRows.push(r);
    if (x.thesis) oRows.push(noteRow('Thesis', x.thesis, oCols.length));
  });
  const rCols = [['Pair', ''], ['Side', ''], ['Limit', 'n'], ['Placed', 'hide-sm'], ['Expires', 'n']];
  const rRows = rest.map((x) => {
    const r = el('tr');
    const left = isNum(x.expires_ts) ? x.expires_ts - now : null;
    r.append(el('td', 'sym', x.symbol || '?'), sideTd(x.side), el('td', 'n', drPx(x.limit)), el('td', 'dim hide-sm', ctTime(x.created_ts)),
      el('td', 'n ' + (left != null && left < 0 ? 'dim' : ''), left == null ? '—' : left < 0 ? 'expired' : `in ${Math.max(1, Math.round(left / 60))}m`));
    return r;
  });
  const cCols = [['Closed', ''], ['Pair', ''], ['Side', ''], ['Net', 'n'], ['R', 'n'], ['Exit', 'hide-sm'], ['Held', 'n drill-held']];
  const cRows = [];
  list.forEach((x) => {
    const r = el('tr');
    r.append(el('td', 'dim', ctTime(x.exit_ts)), el('td', 'sym', x.symbol || '?'), sideTd(x.side),
      el('td', 'n ' + (isNum(x.net_pnl) ? (x.net_pnl >= 0 ? 'pos' : 'neg') : ''), signed(x.net_pnl)),
      el('td', 'n ' + (isNum(x.r) ? (x.r >= 0 ? 'pos' : 'neg') : ''), isNum(x.r) ? (x.r > 0 ? '+' : '') + x.r.toFixed(2) + 'R' : '—'),
      el('td', 'hide-sm', String(x.exit_reason || '—').replace(/_/g, ' ')),
      el('td', 'n drill-held', isNum(x.duration_min) ? Math.round(x.duration_min) + 'm' : '—'));
    cRows.push(r);
    if (x.postmortem) cRows.push(noteRow('Postmortem', x.postmortem, cCols.length));
    else if (x.thesis) cRows.push(noteRow('Thesis', x.thesis, cCols.length));
  });
  // Arena event log (arena.sqlite `events`): newest fills, orders, skips and kills for this arm. Agent text, textContent only.
  // Filter chips (client-only, localStorage zoora.evKind): ALL (mixed), NO SKIPS (server actions), or one kind from by_kind.
  const allEvs = a.events || [];
  const byKind = (a.by_kind && typeof a.by_kind === 'object') ? a.by_kind : {};
  const mode = evFilter.kind; // 'all' | 'noskip' | 'order' | 'open' | 'close' | 'kill'
  let evs;
  if (mode === 'noskip') {
    evs = Array.isArray(a.actions) ? a.actions : allEvs.filter((x) => String(x.kind || '').toLowerCase() !== 'skip');
  } else if (mode !== 'all' && Array.isArray(byKind[mode])) {
    evs = byKind[mode];
  } else if (mode !== 'all') {
    evs = allEvs.filter((x) => String(x.kind || '').toLowerCase() === mode);
  } else {
    evs = allEvs;
  }
  const nSkip = allEvs.filter((x) => String(x.kind || '').toLowerCase() === 'skip').reduce((n, x) => n + (isNum(x.count) ? x.count : 1), 0);
  const eCols = [['When', ''], ['Event', ''], ['Detail', 'drill-ev-msg']];
  const eRows = evs.map((x) => {
    const r = el('tr');
    const k = String(x.kind || '?').toLowerCase();
    const cls = /kill|stop|error/.test(k) ? 'neg' : k === 'skip' ? 'amb' : k === 'close' ? 'cy' : k === 'open' ? 'pos' : 'dim';
    const n = isNum(x.count) && x.count > 1 ? Math.round(x.count) : 1;
    const msg = el('td', 'drill-ev-msg', String(x.message || '—'));
    msg.title = String(x.message || '') + (n > 1 ? ' (repeated ' + n + '×, ' + ctTime(x.first_ts).replace(' CT', '') + '–' + ctTime(x.ts) + ')' : '');
    // Collapsed repeats (server folds identical consecutive skips): "×N" chip + the span's first time.
    const when = el('td', 'dim', n > 1 && isNum(x.first_ts) ? ctTime(x.first_ts).replace(' CT', '') + '–' + ctTime(x.ts) : ctTime(x.ts));
    const kc = el('td'); kc.append(el('span', 'ev-kind ' + cls, k.toUpperCase()));
    if (n > 1) kc.append(el('span', 'ev-count', '×' + n, { 'aria-label': 'repeated ' + n + ' times' }));
    r.append(when, kc, msg);
    return r;
  });
  td.append(el('div', 'drill-sim', 'SIMULATED · paper only · read-only'),
    drillSection('Open', opens.length, oCols, oRows), drillSection('Resting orders', rest.length, rCols, rRows),
    drillSection('Last closed', list.length, cCols, cRows),
    evSection(drillSection('Recent events', evs.length, eCols, eRows), mode, nSkip, byKind));
  tr.append(td); return tr;
}
function _evKindInit() {
  // Prefer zoora.evKind; migrate the older zoora.evHideSkips boolean once.
  // ?ev=order|open|close|kill|noskip|all forces the filter for this load only (screenshots), without saving.
  const allowed = new Set(['all', 'noskip', 'order', 'open', 'close', 'kill']);
  const q = (new URLSearchParams(location.search).get('ev') || '').toLowerCase();
  if (allowed.has(q)) return q;
  let k = localStorage.getItem('zoora.evKind') || '';
  if (!allowed.has(k)) {
    k = localStorage.getItem('zoora.evHideSkips') === '1' ? 'noskip' : 'all';
    try { localStorage.setItem('zoora.evKind', k); } catch (_) {}
  }
  return k;
}
const evFilter = { kind: _evKindInit() };
// Filter chips for the arm drawer's event log: ALL / NO SKIPS / ORDER / OPEN / CLOSE / KILL. Navigation-only.
function evSection(box, mode, nSkip, byKind) {
  const bar = el('div', 'ev-filter', null, { role: 'group', 'aria-label': 'Event filter' });
  const chips = [['ALL', 'all'], ['NO SKIPS', 'noskip'], ['ORDER', 'order'], ['OPEN', 'open'], ['CLOSE', 'close'], ['KILL', 'kill']];
  chips.forEach(([label, v]) => {
    const n = v === 'all' || v === 'noskip' ? null : (Array.isArray(byKind && byKind[v]) ? byKind[v].length : 0);
    const b = el('button', 'ev-chip' + (mode === v ? ' on' : ''), label, {
      type: 'button', 'aria-pressed': String(mode === v),
      title: n == null ? label : (n ? (n + ' recent ' + v + (n === 1 ? '' : 's')) : ('no recent ' + v + ' events'))
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (evFilter.kind === v) return;
      evFilter.kind = v;
      try {
        localStorage.setItem('zoora.evKind', v);
        // Keep the legacy flag in sync so older tests/docs stay meaningful.
        localStorage.setItem('zoora.evHideSkips', v === 'noskip' ? '1' : '0');
      } catch (_) {}
      if (S.ov) renderPositions(S.ov);
    });
    bar.append(b);
  });
  if (mode === 'noskip' && nSkip) bar.append(el('span', 'ev-hidden', `${nSkip} recent skip event${nSkip === 1 ? '' : 's'} hidden`));
  if (mode !== 'all' && mode !== 'noskip') {
    const n = Array.isArray(byKind && byKind[mode]) ? byKind[mode].length : 0;
    if (!n) bar.append(el('span', 'ev-hidden', `no recent ${mode} events`));
  }
  const h = box.querySelector('.drill-h');
  if (h) h.after(bar); else box.prepend(bar);
  return box;
}
function arenaBoard(arms) {
  const wrap = el('div', 'arena-board', '', { role: 'table', 'aria-label': 'Perps arena leaderboard' });
  const t = el('table', 'tbl arena');
  const hr = el('tr');
  const cols = [['#', ''], ['Arm', ''], ['Curve', 'hide-sm'], ['Equity', 'n'], ['Win', 'n'], ['Exp R', 'n hide-sm'], ['DD', 'n']];
  cols.forEach(([h, c]) => hr.append(el('th', c, h)));
  const th = el('thead'); th.append(hr); t.append(th);
  const tb = el('tbody');
  arms.forEach((a, i) => {
    const id = String(a.id || '?');
    const isOpen = openArms.has(id);
    const tr = el('tr', (a.killed ? 'arm-killed' : a.benched ? 'arm-benched' : '') + ' arm-row' + (isOpen ? ' open' : ''),
      null, { tabindex: '0', 'aria-expanded': String(isOpen), 'aria-label': `${id.replace(/_/g, ' ')}: show open, resting and closed trades` });
    const ret = isNum(a.equity) && isNum(a.initial) && a.initial ? a.equity / a.initial - 1 : null;
    const name = el('td', 'sym', id.replace(/_/g, ' '));
    name.title = `${a.closed || 0} closed · ${a.open || 0} open${isNum(a.wins) ? ` · ${a.wins}W/${a.losses || 0}L` : ''}`;
    if ((a.closed || 0) + (a.open || 0)) name.append(el('small', '', `${a.closed || 0}c · ${a.open || 0}o${a.closed ? ` · ${a.wins || 0}W/${a.losses || 0}L` : ''}`));
    // status: SIM is the default and implied; only KILLED / BENCH get a tag (saves a column in the narrow panel)
    if (a.killed || a.benched) name.prepend(el('span', 'tag ' + (a.killed ? 'neg' : 'amb'), a.killed ? 'KILLED' : 'BENCH'), ' ');
    const sp = el('td', 'spark-cell hide-sm'); sp.append(armSpark(a.curve, a.initial));
    const dd = isNum(a.drawdown_pct) ? a.drawdown_pct : null;
    tr.append(el('td', 'dim', String(i + 1)), name, sp,
      el('td', 'n ' + (ret == null || Math.abs(ret) < 1e-9 ? '' : ret > 0 ? 'pos' : 'neg'), money(a.equity), { title: ret == null ? '' : `${(ret * 100).toFixed(2)}% vs ${money(a.initial, 0)}` }),
      el('td', 'n', isNum(a.win_rate) ? pct(a.win_rate, 0) : '—'),
      el('td', 'n hide-sm ' + (isNum(a.expectancy_r) ? (a.expectancy_r >= 0 ? 'pos' : 'neg') : ''), isNum(a.expectancy_r) ? a.expectancy_r.toFixed(2) + 'R' : '—'),
      el('td', 'n ' + (dd == null ? '' : dd > 0.10 ? 'neg' : dd > 0.03 ? 'amb' : ''), dd == null ? '—' : pct(dd, 1)));  // fraction (1 - eq/peak)
    if (a.kill_reason) tr.title = 'kill: ' + a.kill_reason;
    const toggle = () => {
      if (openArms.has(id)) openArms.delete(id); else openArms.add(id);
      const nowOpen = openArms.has(id);
      tr.classList.toggle('open', nowOpen); tr.setAttribute('aria-expanded', String(nowOpen));
      const nx = tr.nextElementSibling;
      if (nx && nx.classList.contains('arm-drill')) nx.remove();
      if (nowOpen) tr.after(armTrades(a, cols.length));
    };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    tb.append(tr);
    if (isOpen) tb.append(armTrades(a, cols.length));
  });
  t.append(tb); wrap.append(t);
  return wrap;
}

})();

