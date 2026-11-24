/* ZOORA VOICE — push-to-talk "ask anything" on the Zoora orb. Hand-written, no dependencies, no CDN.
   Talks ONLY to /api/voice/* (transcribe -> ask -> speak). It never calls /api/zoora or /api/command, so voice
   can never trade, spend or edit Zoora's world. All server text is rendered with textContent; links only if https:.
   The mic opens only while the orb or Space is held (hard 60 s cap) and nothing is kept: the clip lives in memory
   until it is sent, then the buffers are dropped. UI sounds are synthesized with WebAudio (no audio assets). */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const MAX_S = 60;            // hard cap, matches the server
const MIN_S = 0.35;          // shorter holds are treated as a tap
const RATE = 16000;          // WAV sent to STT: 16 kHz mono 16-bit (60 s = 1.9 MB, well under 10 MB)
const LS_MUTE = 'zoora.voiceSfxMuted';

function el(tag, cls, text, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  return n;
}
const hud = () => window.ZooraHUD || null;
const reduced = () => document.documentElement.classList.contains('rm');
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.tagName === 'BUTTON');

/* Only absolute https: URLs become links. Anything else (javascript:, data:, http:, relative) is shown as text. */
function safeHttps(u) {
  if (typeof u !== 'string' || u.length > 2048) return null;
  try { const x = new URL(u); return x.protocol === 'https:' && x.hostname ? x.href : null; } catch (_) { return null; }
}

/* ------------------------------------------------------------ state */
const V = {
  status: null, ready: false, state: 'checking',
  rec: null, busy: false, playing: null, muted: (() => { try { return localStorage.getItem(LS_MUTE) === '1'; } catch (_) { return false; } })(),
};

/* ------------------------------------------------------------ API (same-origin; the HttpOnly HUD cookie carries auth) */
async function vapi(path, opt) {
  const o = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opt || {});
  o.headers = Object.assign({ Accept: 'application/json' }, (opt && opt.headers) || {});
  const r = await fetch(path, o);
  return r;
}
async function vjson(r) { try { return await r.json(); } catch (_) { return null; } }

/* ------------------------------------------------------------ sounds (WebAudio, synthesized, original) */
let sfx = null;
function sfxCtx() {
  if (!sfx) { const C = window.AudioContext || window.webkitAudioContext; if (C) sfx = new C(); }
  if (sfx && sfx.state === 'suspended') sfx.resume();
  return sfx;
}
function tone(c, t, f0, f1, dur, type, peak, dest) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
function sound(kind) {
  if (V.muted) return;
  const c = sfxCtx(); if (!c) return;
  const t = c.currentTime + 0.01;
  const out = c.createGain(); out.gain.value = 0.9;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'error' ? 900 : 5200;
  out.connect(lp).connect(c.destination);
  if (kind === 'start') {          // rising twin blip: "channel open"
    tone(c, t, 420, 840, 0.09, 'sine', 0.05, out); tone(c, t + 0.08, 630, 1260, 0.11, 'triangle', 0.035, out);
  } else if (kind === 'stop') {    // falling blip: "channel closed"
    tone(c, t, 980, 520, 0.10, 'sine', 0.045, out); tone(c, t + 0.07, 640, 330, 0.12, 'triangle', 0.03, out);
  } else if (kind === 'answer') {  // soft glass shimmer, slight detune
    [659.3, 987.8, 1318.5].forEach((f, i) => {
      tone(c, t + i * 0.07, f, f * 1.003, 0.55, 'sine', 0.028, out);
      tone(c, t + i * 0.07, f * 2.01, f * 2.0, 0.25, 'sine', 0.008, out);
    });
  } else if (kind === 'error') {   // low double buzz
    tone(c, t, 240, 200, 0.14, 'square', 0.03, out); tone(c, t + 0.17, 200, 150, 0.2, 'square', 0.03, out);
  }
}
function setMute(m) {
  V.muted = !!m;
  try { localStorage.setItem(LS_MUTE, m ? '1' : '0'); } catch (_) { /* private mode */ }
  const b = $('#zvMute');
  if (b) { b.setAttribute('aria-pressed', String(V.muted)); b.title = V.muted ? 'Voice UI sounds muted' : 'Voice UI sounds on'; b.classList.toggle('off', V.muted); }
}

/* ------------------------------------------------------------ orb + core state */
function core(mode) {
  const h = hud();
  if (h) h.setCore(mode);
  const stage = $('#p-core');
  if (stage) { stage.classList.toggle('zv-live', mode === 'listening'); stage.dataset.zv = mode; }
}
function kick(v) { const h = hud(); if (h) h.kick(v); }

/* ------------------------------------------------------------ status chip */
function renderStatus() {
  const s = V.status, chip = $('#zvStatus'), txt = $('#zvStatusText');
  if (!chip || !txt) return;
  chip.classList.remove('ok', 'warn', 'bad');
  let label = 'VOICE · CHECKING', cls = '';
  if (s) {
    if (s.state === 'ready') { label = 'ZOORA VOICE · READY'; cls = 'ok'; }
    else if (s.state === 'keys_missing') { label = 'VOICE KEYS NOT SET UP'; cls = 'warn'; }
    else if (s.state === 'unavailable') { label = 'VOICE UNAVAILABLE'; cls = 'bad'; }
    else if (s.state === 'locked') { label = 'VOICE LOCKED · NO HUD TOKEN'; cls = 'bad'; }
    else { label = 'VOICE OFFLINE'; cls = 'bad'; }
  }
  if (cls) chip.classList.add(cls);
  txt.textContent = label;
  chip.title = s && s.message ? String(s.message) : '';
  const hint = $('#zvHint');
  if (hint) hint.textContent = V.ready ? 'HOLD ORB · SPACE' : 'TAP ORB · SETUP';
}
async function loadStatus() {
  try {
    const r = await vapi('/api/voice/status');
    const d = await vjson(r);
    V.status = d && typeof d === 'object' ? d : { state: 'offline', message: 'Voice status unavailable (HTTP ' + r.status + ').' };
    if (r.status === 401) V.status = { state: 'locked', message: 'Unlock the HUD to use Zoora voice.' };
  } catch (_) {
    V.status = { state: 'offline', message: 'HUD server unreachable.' };
  }
  V.state = V.status.state || 'offline';
  V.ready = V.state === 'ready';
  renderStatus();
  return V.status;
}

/* ------------------------------------------------------------ holographic pop-ups */
function layer() { return $('#zvLayer'); }
function popupsOpen() { const l = layer(); return !!l && !l.hidden; }
function closePopups() {
  const l = layer(); if (!l || l.hidden) return;
  l.classList.remove('in'); l.hidden = true;
  ['#zvAnswer', '#zvSources', '#zvSetup'].forEach((id) => { const n = $(id); if (n) n.hidden = true; });
}
/* Pin the layer to the VISUAL viewport, so pop-ups stay on screen on phones even when other HUD content makes the
   layout viewport wider than the screen. */
function fitLayer() {
  const l = layer(), vv = window.visualViewport;
  if (!l || l.hidden || !vv) return;
  l.style.left = vv.offsetLeft + 'px'; l.style.top = vv.offsetTop + 'px';
  l.style.width = vv.width + 'px'; l.style.height = vv.height + 'px';
}
function openLayer() {
  const l = layer(); if (!l) return;
  l.hidden = false; fitLayer(); void l.offsetWidth; l.classList.add('in');
}
if (window.visualViewport) { visualViewport.addEventListener('resize', fitLayer); visualViewport.addEventListener('scroll', fitLayer); }
let typeTimer = null;
function typeInto(n, text) {
  clearInterval(typeTimer);
  const full = String(text || '');
  if (reduced()) { n.textContent = full; return; }
  let i = 0; const step = Math.max(1, Math.ceil(full.length / 90));
  n.textContent = '';
  typeTimer = setInterval(() => { i += step; n.textContent = full.slice(0, i); if (i >= full.length) clearInterval(typeTimer); }, 16);
}
function showAnswer(question, answer, sources, isError) {
  const a = $('#zvAnswer'), src = $('#zvSources'), setup = $('#zvSetup');
  if (!a || !src) return;
  if (setup) setup.hidden = true;
  a.hidden = false; a.classList.toggle('err', !!isError);
  $('#zvQ').textContent = question ? '“' + String(question).slice(0, 300) + '”' : '';
  typeInto($('#zvA'), answer);
  $('#zvAnswerTag').textContent = isError ? 'ZV · FAULT' : 'ZV · RESPONSE';
  const list = $('#zvSrcList');
  while (list.firstChild) list.removeChild(list.firstChild);
  const items = Array.isArray(sources) ? sources.slice(0, 8) : [];
  items.forEach((s, i) => {
    const li = el('li', 'zv-src');
    li.append(el('span', 'zv-src-n', String(i + 1).padStart(2, '0')));
    const title = String((s && s.title) || (s && s.url) || 'source').slice(0, 200);
    const href = safeHttps(s && s.url);
    if (href) {
      const link = el('a', 'zv-src-a', title, { href, target: '_blank', rel: 'noopener noreferrer' });
      const host = (() => { try { return new URL(href).hostname; } catch (_) { return ''; } })();
      li.append(link, el('span', 'zv-src-host', host));
    } else {
      li.append(el('span', 'zv-src-a blocked', title), el('span', 'zv-src-host', 'link blocked (not https)'));
    }
    list.append(li);
  });
  src.hidden = items.length === 0;
  $('#zvSrcCount').textContent = items.length ? String(items.length).padStart(2, '0') : '';
  openLayer();
}
function showSetup() {
  const s = V.status || {};
  const p = $('#zvSetup'); if (!p) return;
  $('#zvAnswer').hidden = true; $('#zvSources').hidden = true;
  p.hidden = false;
  $('#zvSetupMsg').textContent = String(s.message || 'Zoora voice is not ready on this HUD.');
  const ul = $('#zvSlots');
  while (ul.firstChild) ul.removeChild(ul.firstChild);
  const req = Array.isArray(s.required) ? s.required : [];
  const opt = Array.isArray(s.optional) ? s.optional : [];
  const slots = (s.slots && typeof s.slots === 'object') ? s.slots : {};
  req.concat(opt).forEach((name) => {
    const ok = slots[name] === true;
    const li = el('li', 'zv-slot ' + (ok ? 'ok' : 'miss'));
    li.append(el('span', 'zv-slot-mark', ok ? '◆' : '◇'), el('code', '', String(name)),
      el('span', 'zv-slot-st', (ok ? 'SET' : 'MISSING') + (opt.includes(name) ? ' · optional (web search)' : '')));
    ul.append(li);
  });
  if (!req.length && !opt.length) ul.append(el('li', 'zv-slot miss', s.state === 'unavailable' ? 'Voice packages are not installed in the HUD’s Python.' : 'Status unavailable.'));
  openLayer();
}

/* ------------------------------------------------------------ countdown ring */
function ring(on, left) {
  const r = $('#zvRing'); if (!r) return;
  r.hidden = !on;
  if (!on) return;
  const frac = Math.max(0, Math.min(1, left / MAX_S));
  r.style.setProperty('--zv-frac', frac.toFixed(4));
  const n = Math.ceil(left);
  $('#zvCount').textContent = '0:' + String(Math.max(0, n)).padStart(2, '0');
  r.classList.toggle('low', left <= 10);
}

/* ------------------------------------------------------------ WAV encoding (in memory only) */
function encodeWav(chunks, inRate, maxSamples) {
  let total = 0; for (const c of chunks) total += c.length;
  const ratio = inRate / RATE;
  let outLen = Math.min(Math.floor(total / ratio), maxSamples);
  const flat = new Float32Array(total); let o = 0; for (const c of chunks) { flat.set(c, o); o += c.length; }
  const buf = new ArrayBuffer(44 + outLen * 2), v = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + outLen * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, outLen * 2, true);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), f = pos - i0;
    const s = (flat[i0] || 0) * (1 - f) + (flat[i0 + 1] || 0) * f;
    const x = Math.max(-1, Math.min(1, s));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  flat.fill(0);
  return { blob: new Blob([buf], { type: 'audio/wav' }), seconds: outLen / RATE };
}

/* ------------------------------------------------------------ push-to-talk */
function stopPlayback() {
  const p = V.playing; V.playing = null;
  if (p) { try { p.src.onended = null; p.src.stop(); } catch (_) { /* done */ } try { p.ctx.close(); } catch (_) { /* done */ } }
}
async function pttStart() {
  if (V.rec || V.busy) return;
  if (!V.ready) { sound('error'); await loadStatus(); if (!V.ready) { showSetup(); return; } }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { sound('error'); showAnswer('', 'This browser cannot open a microphone here. Use the typed “Ask Zoora anything” box.', [], true); return; }
  stopPlayback(); const h = hud(); if (h) h.stopTalking();
  closePopups();
  const rec = { held: true, chunks: [], samples: 0, t0: performance.now(), stream: null, ctx: null, timer: null, rate: 48000 };
  V.rec = rec;
  core('listening'); micFlag(false); ring(true, MAX_S); sound('start');
  // Create the capture context inside the user gesture so autoplay policy never leaves it suspended.
  const C = window.AudioContext || window.webkitAudioContext;
  try { rec.ctx = new C(); if (rec.ctx.state === 'suspended') rec.ctx.resume(); } catch (_) { rec.ctx = null; }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    closeMic(rec); V.rec = null; ring(false); core('idle'); sound('error');
    showAnswer('', e && e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow the mic for this page (localhost) and hold the orb again.' : 'No microphone is available.', [], true);
    return;
  }
  if (!rec.held) {  // released before the mic opened: close it, tell the user
    closeMic(rec); V.rec = null; ring(false); core('idle'); showHint('Keep holding until the ring says MIC OPEN.'); return;
  }
  rec.t0 = performance.now();   // the 60 s cap counts from the moment the mic is actually open
  micFlag(true);
  if (!rec.ctx) rec.ctx = new C();
  if (rec.ctx.state === 'suspended') try { await rec.ctx.resume(); } catch (_) { /* resumes on next gesture */ }
  rec.rate = rec.ctx.sampleRate;
  const srcNode = rec.ctx.createMediaStreamSource(rec.stream);
  const proc = rec.ctx.createScriptProcessor(4096, 1, 1);
  const mute = rec.ctx.createGain(); mute.gain.value = 0;
  const cap = Math.floor(rec.rate * MAX_S);
  proc.onaudioprocess = (ev) => {
    if (!V.rec || V.rec !== rec || !rec.held) return;
    const d = ev.inputBuffer.getChannelData(0);
    const room = cap - rec.samples; if (room <= 0) return;
    const part = d.length > room ? d.slice(0, room) : new Float32Array(d);
    rec.chunks.push(part); rec.samples += part.length;
    if (!rec.heard) { rec.heard = true; const pc = $('#p-core'); if (pc) pc.dataset.heard = '1'; }
    let e = 0; for (let i = 0; i < part.length; i += 16) e += part[i] * part[i];
    kick(Math.min(0.3, Math.sqrt(e / (part.length / 16)) * 3));
  };
  srcNode.connect(proc); proc.connect(mute); mute.connect(rec.ctx.destination);
  rec.nodes = [srcNode, proc, mute];
  rec.timer = setInterval(() => {
    const el2 = (performance.now() - rec.t0) / 1000;
    ring(true, MAX_S - el2);
    if (el2 >= MAX_S) pttStop();   // hard 60 s cap
  }, 100);
}
function micFlag(open) {
  const p = $('#p-core'); if (p) { p.dataset.mic = open ? 'open' : 'closed'; if (!open) delete p.dataset.heard; }
  const l = $('#zvRecLabel'); if (l) l.textContent = open ? 'REC · MIC OPEN' : 'CONNECTING MIC…';
}
function closeMic(rec) {
  micFlag(false);
  if (rec.timer) clearInterval(rec.timer);
  if (rec.nodes) rec.nodes.forEach((n) => { try { n.disconnect(); } catch (_) { /* gone */ } });
  if (rec.nodes && rec.nodes[1]) rec.nodes[1].onaudioprocess = null;
  if (rec.stream) rec.stream.getTracks().forEach((t) => t.stop());   // the mic is closed here
  if (rec.ctx) try { rec.ctx.close(); } catch (_) { /* closed */ }
  rec.stream = null; rec.ctx = null; rec.nodes = null;
}
async function pttStop(cancel) {
  const rec = V.rec; if (!rec) return;
  rec.held = false;
  if (!rec.stream) return;  // still waiting for permission; pttStart cleans up
  V.rec = null;
  closeMic(rec); ring(false);
  const secs = rec.samples / rec.rate;
  if (cancel || secs < MIN_S) {
    rec.chunks = []; core('idle'); sound('stop');
    if (!cancel) showHint(rec.samples ? 'Hold the orb (or Space) while you speak.' : 'No audio came from the microphone. Check the input device and try again.');
    return;
  }
  sound('stop');
  const wav = encodeWav(rec.chunks, rec.rate, Math.floor(RATE * MAX_S) - 1);
  rec.chunks.forEach((c) => c.fill(0)); rec.chunks = [];   // nothing kept
  await converse(wav);
}
function showHint(t) { const n = $('#zvNote'); if (n) { n.textContent = t || ''; clearTimeout(showHint.t); showHint.t = setTimeout(() => { n.textContent = ''; }, 5000); } }

async function errorFrom(r, fallback) {
  const d = await vjson(r);
  if (d && d.state === 'keys_missing') { V.ready = false; V.state = 'keys_missing'; loadStatus(); }
  if (r.status === 401) return 'The HUD session is locked. Reload and unlock the HUD, then try again.';
  return String((d && d.error) || fallback + ' (HTTP ' + r.status + ')').slice(0, 300);
}

async function converse(wav) {
  V.busy = true; core('thinking');
  let text = '';
  try {
    const r = await vapi('/api/voice/transcribe?duration_s=' + encodeURIComponent(Math.max(0.01, wav.seconds).toFixed(2)),
      { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav.blob });
    if (!r.ok) throw new Error(await errorFrom(r, 'Transcription failed'));
    const d = await vjson(r);
    text = String((d && d.text) || '').trim();
  } catch (e) {
    V.busy = false; core('idle'); sound('error'); showAnswer('', String(e.message || e), [], true); return;
  }
  V.busy = false;
  if (!text) { core('idle'); sound('error'); showAnswer('', 'I didn’t catch any words. Hold the orb and try again.', [], true); return; }
  const you = $('#capYou'); if (you) you.textContent = text;
  await askZoora(text);
}

async function askZoora(text) {
  text = String(text || '').trim().slice(0, 2000);
  if (!text || V.busy) return;
  V.busy = true; core('thinking'); closePopups();
  let d = null;
  try {
    const r = await vapi('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error(await errorFrom(r, 'Zoora could not answer'));
    d = await vjson(r);
  } catch (e) {
    V.busy = false; core('idle'); sound('error');
    if (V.state === 'keys_missing') showSetup(); else showAnswer(text, String(e.message || e), [], true);
    return;
  }
  V.busy = false;
  const answer = String((d && d.answer) || '');
  showAnswer(text, answer, d && d.sources, false);
  sound('answer');
  const cz = $('#capZoora'); if (cz) cz.textContent = answer.slice(0, 600);
  const speakOn = !$('#speakToggle') || $('#speakToggle').checked;
  if (speakOn && d && d.speak_text) await speakText(String(d.speak_text)); else core('idle');
}

async function speakText(t) {
  core('thinking');
  try {
    const r = await vapi('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/*' }, body: JSON.stringify({ text: t.slice(0, 1000) }) });
    if (!r.ok) { showHint(await errorFrom(r, 'Voice playback failed')); core('idle'); return; }
    const ab = await r.arrayBuffer();
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = new C();
    const buf = await ctx.decodeAudioData(ab);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const an = ctx.createAnalyser(); an.fftSize = 256;
    src.connect(an); an.connect(ctx.destination);
    const data = new Uint8Array(an.frequencyBinCount);
    V.playing = { src, ctx };
    core('speaking');
    const tick = () => {
      if (!V.playing || V.playing.src !== src) return;
      an.getByteFrequencyData(data); let s = 0; for (let i = 0; i < data.length; i++) s += data[i];
      kick(Math.min(0.25, s / data.length / 400)); requestAnimationFrame(tick);
    };
    src.onended = () => { if (V.playing && V.playing.src === src) { V.playing = null; try { ctx.close(); } catch (_) { /* closed */ } core('idle'); } };
    src.start(); tick();
  } catch (_) {
    showHint('Could not play Zoora’s voice in this browser.'); core('idle');
  }
}

/* ------------------------------------------------------------ wiring */
function wire() {
  setMute(V.muted);
  const stage = $('#p-core .core-stage');
  if (stage) {
    stage.setAttribute('role', 'button'); stage.setAttribute('tabindex', '0');
    stage.setAttribute('aria-label', 'Hold to talk to Zoora');
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); sfxCtx();
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* old browser */ }
      pttStart();
    });
    const up = () => { if (V.rec) pttStop(); };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('lostpointercapture', up);
    stage.addEventListener('keydown', (e) => { if ((e.key === 'Enter') && !e.repeat) { e.preventDefault(); if (!V.ready) showSetup(); } });
  }
  // Space push-to-talk goes to Zoora voice when it's ready (capture phase, before the HUD's legacy browser PTT).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (V.rec) { e.preventDefault(); e.stopImmediatePropagation(); pttStop(true); return; }
      if (V.playing) { stopPlayback(); core('idle'); }
      if (popupsOpen()) { e.preventDefault(); closePopups(); }
      return;
    }
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (!V.ready) return;
    const h = hud(); if (h && h.legacyPttActive()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) { sfxCtx(); pttStart(); }
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && V.rec) { e.preventDefault(); e.stopImmediatePropagation(); pttStop(); }
  }, true);
  window.addEventListener('blur', () => { if (V.rec) pttStop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && V.rec) pttStop(true); });
  const l = layer();
  if (l) l.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) return;              // let source links open
    if (e.target.closest('.zv-close') || !e.target.closest('.zv-holo')) closePopups();
  });
  const f = $('#zvAskForm');
  if (f) f.addEventListener('submit', (e) => {
    e.preventDefault(); const i = $('#zvAskInput'); const v = i.value; i.value = '';
    if (!V.ready) { loadStatus().then(() => { if (V.ready) askZoora(v); else { sound('error'); showSetup(); } }); return; }
    askZoora(v);
  });
  const m = $('#zvMute'); if (m) m.onclick = () => { setMute(!V.muted); if (!V.muted) { sfxCtx(); sound('answer'); } };
  const chip = $('#zvStatus'); if (chip) chip.onclick = () => { loadStatus().then(() => { if (!V.ready) showSetup(); }); };
  loadStatus();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
