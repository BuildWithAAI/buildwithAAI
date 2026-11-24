/* ZOORA FX session clocks. Pure, no DOM, no network: works out which of the four main FX sessions are open from the
   clock alone, using IANA time zones so daylight-saving shifts are handled by the browser. Hours are the usual retail
   convention (local wall time, Mon-Fri), and the whole market is shut from Fri 17:00 to Sun 17:00 New York time.
   Approximate by design: it is a context clock, not a signal. Loaded before zoora.js; Node can require() it for tests. */
(function (root) {
  'use strict';
  const SESSIONS = [
    { id: 'syd', city: 'Sydney', tz: 'Australia/Sydney', open: 7, close: 16 },
    { id: 'tyo', city: 'Tokyo', tz: 'Asia/Tokyo', open: 9, close: 18 },
    { id: 'ldn', city: 'London', tz: 'Europe/London', open: 8, close: 17 },
    { id: 'nyc', city: 'New York', tz: 'America/New_York', open: 8, close: 17 },
  ];
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const fmts = {};
  function parts(ms, tz) {
    const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    const o = {};
    f.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
    return { wd: WD[o.weekday], h: Number(o.hour) % 24, m: Number(o.minute) };
  }
  function weekendClosed(ms) {
    const n = parts(ms, 'America/New_York');
    return n.wd === 6 || (n.wd === 5 && n.h >= 17) || (n.wd === 0 && n.h < 17);
  }
  function isOpen(s, ms) {
    if (weekendClosed(ms)) return false;
    const p = parts(ms, s.tz);
    return p.wd >= 1 && p.wd <= 5 && p.h >= s.open && p.h < s.close;
  }
  // Every boundary falls on a whole local hour (all four zones have whole-hour offsets), so 15-minute UTC steps
  // land on it exactly. Searches at most 8 days ahead.
  const STEP = 15 * 60 * 1000;
  function nextChange(s, ms, state) {
    let t = Math.ceil((ms + 1) / STEP) * STEP;
    for (let i = 0; i < 8 * 96; i++, t += STEP) if (isOpen(s, t) !== state) return t;
    return null;
  }
  function fxSessions(ms) {
    if (typeof ms !== 'number') ms = Date.now();
    const rows = SESSIONS.map((s) => {
      const open = isOpen(s, ms), p = parts(ms, s.tz);
      return { id: s.id, city: s.city, tz: s.tz, open, local: String(p.h).padStart(2, '0') + ':' + String(p.m).padStart(2, '0'),
        hours: `${String(s.open).padStart(2, '0')}:00-${s.close}:00`, next_ms: nextChange(s, ms, open) };
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r.open]));
    const overlaps = [];
    if (by.ldn && by.nyc) overlaps.push('London + New York');
    if (by.tyo && by.ldn) overlaps.push('Tokyo + London');
    if (by.syd && by.tyo) overlaps.push('Sydney + Tokyo');
    return { now_ms: ms, weekend: weekendClosed(ms), rows, overlaps };
  }
  const api = { SESSIONS, fxSessions, isOpen, weekendClosed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ZooraSessions = api;
})(this);
