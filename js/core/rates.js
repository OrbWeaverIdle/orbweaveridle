/* ============================================================
   CORE: RATES
   Measured gain/loss for every rail resource — no mechanic opts in.
   Resources.add()/spend() report the amount they ACTUALLY moved
   (after cap clamping) through log(); only moves made while
   Loop.step() has set a source count, so clicks, cheats, loads,
   deliveries and the paused preview tick are never recorded. A
   crate's moves count toward its parent.

   Every tick a source moves something is one lump. /s: STEADY sources
   (moved on 2+ consecutive ticks — Wood, wages, Smelter burn) show the
   largest per-tick rate they moved in the last PEAK_HOLD second, so a
   rise reads true at once and a source that flips tick to tick (wages
   while a card bounces off its cap) holds one number; one idle for
   PEAK_HOLD falls back to its lumps. Every other source (deliveries,
   dice, cycles, sales) reads its lumps from the last LUMP_SPAN seconds:
   their total, minus the first, over the time from first to last. One
   lump reads nothing; a source idle for over twice its usual gap reads
   0.

   /min and /hr: a long average per source, on the source's own clock
   (it pauses while the store is Full and the source is a gain, so a
   full store's refills don't drag its producer down). Every-tick
   sources look back MIN_WIN s; irregular ones CYCLES × their longest
   gap, up to SPAN. With 3+ bursts (runs of consecutive moving ticks)
   it averages whole cycles — start of the 2nd burst to start of the
   last — so load-then-travel or on/off reads its true average; else
   first to last tick. 0 once idle for over twice its longest gap. A
   card whose workers change (wages: any change; vehicles excepted,
   their workers are passengers) restarts its history — the old number
   shows until the new history spans twice the old longest gap — and a
   source that moved one amount every tick, then switches to another for
   STEADY ticks, restarts from the switch (a Wood upgrade shows at once;
   not wages, a total of many cards' billing that changes in blips).
   The line redraws only when it moves BAND or more.

   The unit (body data-rates, owned by script.js's display prefs) picks
   the method, then scales ×1, ×60 or ×3,600. Net = sum of sources; on
   /s minus any whose mechanic sets rateExcluded (too random to total —
   Gold Panning), which still list, greyed, in the breakdown. A mechanic
   may instead project its own line through rateFor(id) (per second, or
   undefined; every unit) — Market Stall's lump-sum sales use the
   card-face g/s — or rateExpect(id), its expected rate from its odds and
   staffing, used on /min and /hr only (Gold Panning, Dig Site), or offer
   rateHint(id), shown only while its source has under 2 lumps (an
   auto mule's cargo ÷ (load + travel) until its 2nd arrival).
   Nothing is saved; reset() clears after offline replay.

   Rail: one net line per band, redrawn every tick.
   Paused or gold-starved freezes the text and greys it (.frozen);
   a resource at its cap now, or at any point in the last FULL_HOLD
   seconds of game time, reads "Full", plus "< X/u" for what its
   counted users take ("Full < 1.2/s") — so a capped store being
   drained and refilled tick by tick doesn't flash red/green yet still
   shows it's in use. A real drain falls off the cap and turns red
   once the hold runs out. Clicking a band expands its
   per-source breakdown inside it.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver = window.OrbWeaver || {};

  const UNITS = [['s', 1], ['min', 60], ['hr', 3600]]; // label, multiplier
  const EPS = 1e-9, FULL_HOLD = 3, PEAK_HOLD = 1, LUMP_SPAN = 600;          // /s
  const SPAN = 1800, MIN_WIN = 60, CYCLES = 100, STEADY = 5, BAND = 0.01;   // /min, /hr
  let led = {};      // resourceId -> { sourceId -> entry (see blank()) }
  let now = 0, dt = 0.2, source = null;
  let capAt = {};    // resourceId -> game time it was last seen at cap
  let staff = {};    // poolId -> worker assignments last seen
  let shown = {};    // resourceId -> [unit, kind, per-second] last drawn on /min and /hr

  function log(id, delta, src) {
    const s = src || source, rid = OW.Resources.parentOf(id) || id;
    if (OW.Resources.isAtCap(rid)) capAt[rid] = now;
    if (!s || !delta) return;
    const byRes = led[rid] || (led[rid] = {});
    (byRes[s] || (byRes[s] = blank())).t += delta;
  }

  // t: this tick. /s — streak: moving ticks; idle: seconds since; peak: recent [time, per-second]; lumps: [time, amount] within LUMP_SPAN.
  // /min, /hr — clock: own time; hist: [clock, amount] within SPAN; sum: its total; burst: clock the current run of ticks began;
  // run/runAt/runLen/flat: the amount repeating now, since when, how often, and whether one amount filled the history before it;
  // seg/fresh/need: a pending restart — when, lumps since, and how long they must span to replace the old.
  const blank = () => ({ t: 0, streak: 0, idle: 0, peak: [], lumps: [],
    clock: 0, hist: [], sum: 0, burst: 0, run: NaN, runAt: 0, runLen: 0, flat: false, seg: null, fresh: 0, need: 0 });
  const steady = (e) => e.streak >= 2;

  // Per-tick bookkeeping for both methods; an entry with nothing left is dropped.
  function settle() {
    Object.keys(led).forEach((rid) => {
      const byRes = led[rid], full = OW.Resources.isAtCap(rid) || now - (capAt[rid] ?? -Infinity) < FULL_HOLD;
      Object.keys(byRes).forEach((s) => {
        const e = byRes[s];
        if (e.t) { e.streak++; e.idle = 0; e.peak.push([now, e.t / dt]); e.lumps.push([now, e.t]); }
        else if (steady(e)) { if ((e.idle += dt) >= PEAK_HOLD - EPS) { e.streak = 0; e.peak = []; } }
        else e.streak = 0;
        e.peak = e.peak.filter((p) => now - p[0] < PEAK_HOLD - EPS);
        while (e.lumps.length && now - e.lumps[0][0] > LUMP_SPAN + EPS) e.lumps.shift();
        track(e, s, full);
        e.t = 0;
        if (!e.lumps.length && !steady(e) && !e.hist.length && e.seg == null) delete byRes[s];
      });
    });
  }

  function cut(e, n) { e.hist.splice(0, n).forEach((l) => { e.sum -= l[1]; }); }

  // Longest gap between moving ticks (at least one tick) and the index each burst of consecutive ticks starts at.
  function shape(A) {
    let gap = dt; const starts = [0];
    for (let i = 1; i < A.length; i++) { const d = A[i][0] - A[i - 1][0]; if (d > gap) gap = d; if (d > dt + EPS) starts.push(i); }
    return { gap, starts };
  }

  // /min, /hr history for one tick.
  function track(e, s, full) {
    const H = e.hist;
    if (!(full && (e.t > 0 || (!e.t && e.sum > 0)))) {             // gains into a Full store neither count nor age
      e.clock += dt;
      if (e.t) {
        if (!H.length || e.clock - H[H.length - 1][0] > dt + EPS) e.burst = e.clock;
        H.push([e.clock, e.t]); e.sum += e.t;
        if (e.seg != null) e.fresh++;
        if (!(Math.abs(e.t - e.run) <= EPS * Math.max(1, Math.abs(e.t)))) { e.flat = e.runAt <= H[0][0] + EPS && e.burst <= H[0][0] + EPS; e.run = e.t; e.runAt = e.clock; e.runLen = 0; }
        if (++e.runLen === STEADY && e.flat && e.seg == null && H.length > STEADY && s !== 'upkeep') cut(e, H.length - STEADY);
      }
    }
    let k = 0, keep = e.burst <= (H[0] || [0])[0] + EPS ? MIN_WIN : SPAN;   // every-tick sources only need MIN_WIN
    while (k < H.length - e.fresh && e.clock - H[k][0] > keep + EPS) k++;
    if (k) cut(e, k);
    if (e.seg != null && e.clock - e.seg >= e.need - EPS && (e.fresh >= 2 || !e.fresh)) { cut(e, H.length - e.fresh); e.seg = null; e.fresh = 0; }
  }

  // A card whose workers changed starts a fresh history; wages follow any change. Vehicles carry passengers, not workers.
  function restaff() {
    Object.entries(OW.Workers.getPools()).forEach(([k, pool]) => {
      const a = pool.serialize().a, was = staff[k];
      staff[k] = a;
      if (!was) return;
      const ids = Object.keys(Object.assign({}, a, was)).filter((id) => (a[id] || 0) !== (was[id] || 0) && !(OW.Mechanics.get(id) || {}).isMule);
      if (!ids.length) return;
      ids.push('upkeep');
      Object.values(led).forEach((byRes) => ids.forEach((id) => {
        const e = byRes[id];
        if (e && e.seg == null && e.hist.length) { e.seg = e.clock; e.fresh = 0; e.need = 2 * shape(e.hist).gap; }
      }));
    });
  }

  // /s rate of one source: recent peak when steady, else its lump average.
  function perSec(e) {
    if (steady(e)) return e.peak.reduce((a, p) => (Math.abs(p[1]) > Math.abs(a) ? p[1] : a), 0);
    const L = e.lumps, n = L.length, span = n > 1 ? L[n - 1][0] - L[0][0] : 0;
    if (!span || now - L[n - 1][0] > 2 * span / (n - 1) + EPS) return 0;
    return L.reduce((a, l, i) => a + (i ? l[1] : 0), 0) / span;
  }

  // /min, /hr rate of one source (per second): its long average, whole cycles when it comes in bursts.
  function perLong(e) {
    let A = e.hist;
    if (A.length < 2) return 0;
    const { gap } = shape(A);
    if (e.clock - A[A.length - 1][0] > 2 * gap + EPS) return 0;
    const win = Math.min(SPAN, Math.max(MIN_WIN, CYCLES * gap)), i0 = A.findIndex((l) => e.clock - l[0] <= win + EPS);
    if (i0 > 0) A = A.slice(i0);
    const n = A.length, st = shape(A).starts, c = st.length >= 3;
    if (n < 2) return 0;
    const a = c ? st[1] : 1, b = c ? st[st.length - 1] : n;
    let s = 0; for (let i = a; i < b; i++) s += A[i][1];
    return s / (A[c ? b : n - 1][0] - A[c ? a : 0][0]);
  }

  // [sourceId, per-second] for every source of a resource in the current unit:
  // rateFor, else (/min, /hr) rateExpect, else rateHint under 2 lumps, else measured.
  function sources(id) {
    const m = (s) => OW.Mechanics.get(s) || {}, byRes = led[id] || {}, long = ui() > 0;
    const ids = new Set(Object.keys(byRes).concat(OW.Mechanics.all().filter((x) => x.rateFor || x.rateHint || x.rateExpect).map((x) => x.id)));
    return [...ids].map((s) => {
      const e = byRes[s], f = m(s).rateFor && m(s).rateFor(id), h = m(s).rateHint && m(s).rateHint(id);
      const x = long && m(s).rateExpect ? m(s).rateExpect(id) : undefined;
      return [s, f !== undefined ? f : x !== undefined ? x : h !== undefined && (!e || (long ? e.hist : e.lumps).length < 2) ? h : !e ? 0 : long ? perLong(e) : perSec(e)];
    }).filter((x) => Math.abs(x[1]) > EPS);
  }

  // On /min and /hr, keep the drawn value until the new one moves BAND or more (or changes sign, kind or unit).
  function hold(id, kind, v) {
    const u = ui(), p = shown[id];
    if (!u) return v;
    if (p && p[0] === u && p[1] === kind && v * p[2] > 0 && Math.abs(v - p[2]) < BAND * Math.abs(p[2])) return p[2];
    shown[id] = [u, kind, v];
    return v;
  }

  const ui = () => +document.body.dataset.rates || 0;
  const unit = () => UNITS[ui()];

  function label(src) {
    if (src === 'upkeep') return 'Worker wages';
    const m = OW.Mechanics.get(src);
    return m && m.cardName ? m.cardName() : src;
  }
  const excluded = (src) => { const m = OW.Mechanics.get(src); return !ui() && !!(m && m.rateExcluded); };   // /s only

  // [text, class] for a per-second value shown in the current unit.
  function fmt(id, ps) {
    const [u, mult] = unit(), x = ps * mult, abs = Math.abs(x), whole = OW.Resources.isWhole(id);
    if (abs < EPS) return ['', ''];
    const neg = x < 0 ? '−' : '';
    if (abs < (whole ? 1 : 0.05)) return [`${neg}<${whole ? 1 : 0.1}/${u}`, neg ? 'hint neg' : 'hint'];
    const d = whole ? 0 : 1;
    return [`${neg || '+'}${abs.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}/${u}`, neg ? 'neg' : ''];
  }

  function paint(r, frozen, force) {
    const band = r.wrap, bd = band.querySelector('.res-breakdown');
    band.classList.toggle('frozen', frozen);
    if (frozen && !force) {
      if (bd) bd.firstChild.textContent = OW.Loop.isRunning() ? 'Stopped — no gold' : 'Paused';
      return;
    }
    const srcs = sources(r.id);
    const sum = srcs.reduce((a, s) => a + (excluded(s[0]) ? 0 : s[1]), 0);
    const full = !r.noFull && (OW.Resources.isAtCap(r.id) || now - (capAt[r.id] ?? -Infinity) < FULL_HOLD);
    const counted = srcs.some((s) => !excluded(s[0]));
    const net = full ? sum : hold(r.id, 'net', sum);
    const [ut] = fmt(r.id, full ? hold(r.id, 'use', srcs.reduce((a, s) => a - (!excluded(s[0]) && s[1] < 0 ? s[1] : 0), 0)) : 0);
    const [t, c] = full ? [ut ? `Full ${ut[0] === '+' ? '< ' + ut.slice(1) : ut}` : 'Full', 'grey'] : Math.abs(net) < EPS && counted ? [`${OW.Resources.isWhole(r.id) ? 0 : '0.0'}/${unit()[0]}`, 'zero'] : fmt(r.id, net);
    r.rateEl.textContent = t;
    r.rateEl.style.display = t ? '' : 'none';
    r.rateEl.className = 'res-sub-rate res-rate ' + c;
    if (!bd) return;
    const row = (name, v, cls) => { const [vt, vc] = fmt(r.id, v); return `<div class="rb-row ${cls}"><span>${name}</span><span class="rb-val ${vc}">${vt || '0'}</span></div>`; };
    const tag = frozen ? (OW.Loop.isRunning() ? 'Stopped — no gold' : 'Paused') : full ? 'Full' : '';
    bd.innerHTML = `<div class="rb-state">${tag}</div>` + (srcs.length
      ? srcs.sort((a, b) => b[1] - a[1]).map(([s, v]) => excluded(s) ? '' : row(label(s), v, '')).join('') + row('', net, 'rb-net')
        + srcs.map(([s, v]) => excluded(s) ? row(`${label(s)} (not in total)`, v, 'rb-excl') : '').join('')
      : '<div class="rb-row"><span>No activity</span></div>');
  }

  const rows = () => OW.Resources.all().filter((r) => !OW.Resources.parentOf(r.id));
  const isFrozen = () => !OW.Loop.isRunning() || OW.Resources.get('gold') <= 0;
  function render() { const f = isFrozen(); rows().forEach((r) => paint(r, f)); }

  // Game time; called once per Loop.step after every mechanic and Upkeep.
  function tick(step) {
    now += step; dt = step;
    restaff();
    settle();
    if (OW.Resources.isRenderEnabled()) render();
  }

  // Game time keeps running so lump times recorded elsewhere (Scout Stable load starts) stay valid.
  function reset() { led = {}; capAt = {}; shown = {}; render(); }

  // Expand/collapse a band's breakdown in place.
  document.addEventListener('click', (ev) => {
    const band = ev.target.closest('#left-hand .res-band');
    if (!band || ev.target.closest('button')) return;
    const open = band.classList.toggle('open');
    const bd = band.querySelector('.res-breakdown');
    if (!open) { if (bd) bd.remove(); return; }
    band.insertAdjacentHTML('beforeend', '<div class="res-breakdown"><div class="rb-state"></div></div>');
    const r = rows().find((x) => x.wrap === band);
    if (r) paint(r, isFrozen(), true);
  });

  OW.Rates = { log, tick, render, reset, setSource: (s) => { source = s; }, now: () => now, perSecond: (id, src) => sources(id).reduce((a, s) => a + (!src || s[0] === src ? s[1] : 0), 0) };
})();
