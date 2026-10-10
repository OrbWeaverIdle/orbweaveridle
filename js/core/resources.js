/* ============================================================
   CORE: RESOURCES REGISTRY
   Generic left-hand resource row system (name + current/cap format).
   displayType: 'integer' (Gold, currency) | 'decimal' (Wood, gathered).
   Each resource is one .res-band: its row, its crate's row, and a
   rate line that js/core/rates.js measures and writes — no mechanic
   writes rate text. Visible bands in a group alternate (.alt).
   Optional `hidden: true` at registration starts the row invisible;
   reveal(id) shows it permanently. `revealOnGain: true` reveals it on
   its first real gain (Wood). `noFull: true` keeps the rate line from
   ever reading "Full" (Gold).
   Once an amount touches its cap, it DISPLAYS the cap for CAP_HOLD
   seconds of game time, restarting on every touch, so a store being
   used and topped up each tick reads steady (1000/1000) instead of
   wobbling. Display only — get()/available() stay exact. clock(dt),
   called once per Loop.step, advances the timer and redraws an amount
   whose hold just ended.

   CRATES — a resource whose id is <parentId> + 'crate' (woodcrate,
   mtn_stonecrate) is a crate row: an uncapped overflow store for its
   parent. Three behaviours fall out of that naming convention alone,
   so no card needs per-crate wiring:
     * its row goes inside its parent's band, above the parent's
       rate line, instead of at the bottom of the group,
     * available(id) counts parent + crate, so every affordability
       check sees the combined total — a crate is how a cost above a
       resource's own cap gets paid,
     * spend(id) drains the parent first and only touches the crate
       once the parent is empty.
   Crates never chain (a crate has no crate of its own) and never
   reach across locations — mtn_woodcrate feeds mtn_wood only.
   spend(id, n, true) opts out of the crate fallback for the one
   caller that must not launder crates into loose goods: Scout
   Stable's cargo loading (a Wood run needs real Wood; crates travel
   by being picked as cargo themselves).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const registry = {}; // id -> { current, cap, displayType, valEl, rateEl, wrap }

  // Single owner for "which resources are conceptually whole units".
  // Matches the base id with any single location prefix stripped
  // ('mtn_goldbars', 'sd_copperingots', bare 'copperhead' at Camp all
  // match), so a resource shipped to a new location still displays
  // correctly without a fourth copy of this rule. Every ensureResource()
  // implementation (main.js/mountains.js/sanddunes.js) omits its own
  // displayType so this is the only place the list is kept.
  const WHOLE_NUMBER_RE = /^(?:[a-z]+_)?(tools\d+|goldbars|copperhead|copperingots|luxury|wheatbundle)$/;
  function defaultDisplayType(id) { return WHOLE_NUMBER_RE.test(id) ? 'integer' : 'decimal'; }

  const CAP_HOLD = 1;
  let now = 0;
  const held = (e) => e.cap != null && now - e.capAt < CAP_HOLD - 1e-9;

  function fmt(entry) {
    if (held(entry)) return `${Math.floor(entry.cap)}/${Math.floor(entry.cap)}`;
    const v = entry.displayType === 'integer' ? Math.floor(entry.current) : (entry.current % 1 === 0 ? Math.floor(entry.current) : entry.current.toFixed(1));
    const c = entry.cap != null ? Math.floor(entry.cap) : null;
    return c != null ? `${v}/${c}` : `${v}`;
  }

  /* Cards.setRenderEnabled covers card faces, but resource readouts are
     written by render() on EVERY add() — which during a bulk catch-up
     means one DOM write per resource per step, tens of thousands of
     them, none of which anyone sees. Suspend them the same way and do
     one pass at the end. */
  let renderEnabled = true;
  function setRenderEnabled(v) {
    renderEnabled = !!v;
    if (renderEnabled) { Object.keys(registry).forEach(render); if (window.OrbWeaver.Rates) window.OrbWeaver.Rates.render(); }
  }

  // Alternate visible bands within one group container.
  function stripe(box) {
    if (!box) return;
    let i = 0;
    Array.from(box.children).forEach((el) => {
      if (el.classList.contains('res-band') && el.style.display !== 'none') el.classList.toggle('alt', i++ % 2 === 1);
    });
  }

  function render(id) {
    const e = registry[id];
    if (!e) return;
    if (e.cap != null && e.current >= e.cap) e.capAt = now;
    if (!renderEnabled) return;
    e.shownHeld = held(e);
    e.valEl.textContent = fmt(e);
  }

  function clock(dt) {
    now += dt;
    Object.keys(registry).forEach((id) => { const e = registry[id]; if (e.shownHeld && !held(e)) render(id); });
  }

  /* ---- Crates ---- id conventions only; see the header note. */
  const CRATE = 'crate';
  function crateOf(id) { return id + CRATE; }
  // '' unless id names a crate whose parent is actually registered —
  // which also stops a crate ever being treated as having a crate.
  function parentOf(id) {
    const p = id.endsWith(CRATE) ? id.slice(0, -CRATE.length) : '';
    return p && registry[p] ? p : '';
  }
  // Parent + crate. The number every affordability check should read.
  function available(id) {
    const c = registry[crateOf(id)];
    return get(id) + (c ? c.current : 0);
  }
  // Creates (once) and reveals a resource's crate row. Named 'Crate'
  // because it renders directly beneath the parent that labels it.
  function ensureCrate(id, mount) {
    const e = registry[id];
    if (!e) return null;
    const cid = crateOf(id);
    if (!registry[cid]) register(cid, { name: 'Crate', mount: mount || e.wrap.parentNode, current: 0, displayType: e.displayType, dynamic: true });
    reveal(cid);
    return cid;
  }

  function register(id, { name, mount, current, cap, displayType = defaultDisplayType(id), hidden = false, dynamic = false, revealOnGain = false, noFull = false }) {
    const parent = registry[parentOf(id)];
    const wrap = document.createElement('div');
    if (!parent) { wrap.className = 'res-band'; wrap.dataset.res = id; }
    const row = document.createElement('div');
    row.className = 'resource-row';
    row.innerHTML = `<span class="res-name">${name}</span><span class="res-val"></span>`;

    const rateEl = document.createElement('div');
    rateEl.className = 'res-sub-rate';
    rateEl.style.display = 'none';

    wrap.appendChild(row);
    wrap.appendChild(rateEl);
    if (hidden) wrap.style.display = 'none';
    // A crate lives inside its parent's band, above the parent's rate.
    if (parent) parent.wrap.insertBefore(wrap, parent.rateEl);
    else mount.appendChild(wrap);
    registry[id] = { name, current, cap, displayType, hidden: !!hidden, dynamic: !!dynamic, revealOnGain, noFull, capAt: -Infinity, shownHeld: false, valEl: row.querySelector('.res-val'), rateEl, wrap };
    render(id);
    stripe(wrap.parentNode);
    return wrap;
  }

  // `hidden` is real state, not just a CSS property — the save system
  // needs to know what the player has unlocked, and the DOM is not a
  // place to keep game state.
  function reveal(id) {
    const e = registry[id];
    if (!e) return;
    e.hidden = false;
    if (e.wrap) { e.wrap.style.display = ''; stripe(e.wrap.parentNode); }
  }
  function conceal(id) {
    const e = registry[id];
    if (!e) return;
    e.hidden = true;
    if (e.wrap) { e.wrap.style.display = 'none'; stripe(e.wrap.parentNode); }
  }

  // Registers id if it doesn't exist yet (e.g. a destination receiving a
  // resource for the first time), otherwise just reveals it. Lets any
  // resource be routed to any destination without pre-declaring every
  // combination up front.
  function ensure(id, opts) {
    if (!registry[id]) register(id, Object.assign({ dynamic: true }, opts));
    else reveal(id);
    return registry[id];
  }

  function exists(id) { return !!registry[id]; }
  function isHidden(id) { const e = registry[id]; return e ? e.hidden : true; }
  function get(id) { return registry[id] ? registry[id].current : 0; }
  function getName(id) { return registry[id] ? registry[id].name : id; }
  function isWhole(id) { return !!registry[id] && registry[id].displayType === 'integer'; }
  function getCap(id) { return registry[id] ? registry[id].cap : null; }
  function isAtCap(id) { const e = registry[id]; return e && e.cap != null && e.current >= e.cap; }
  function all() { return Object.keys(registry).map((id) => ({ id, ...registry[id] })); }

  function add(id, amount) {
    const e = registry[id];
    if (!e) return 0;
    const absorbed = window.OrbWeaver.Upgrades ? window.OrbWeaver.Upgrades.collectIntoReservations(id, amount) : 0;
    const remainder = amount - absorbed;
    const before = e.current;
    e.current = e.cap != null ? Math.min(e.cap, e.current + remainder) : e.current + remainder;
    render(id);
    log(id, e.current - before);
    if (e.hidden && e.revealOnGain && e.current > before) reveal(id);
    return e.current - before;
  }

  // Loose stock drains first; the crate row only starts emptying once
  // the parent hits zero. noCrate=true keeps the fallback out of it.
  function spend(id, amount, noCrate) {
    const e = registry[id];
    if (!e) return 0;
    const took = Math.min(e.current, Math.max(0, amount));
    e.current -= took;
    render(id);
    log(id, -took);
    const short = amount - took;
    if (noCrate || short <= 1e-9) return took;
    const c = registry[crateOf(id)];
    if (!c) return took;
    const fromCrate = Math.min(c.current, short);
    c.current -= fromCrate;
    render(crateOf(id));
    log(id, -fromCrate);
    return took + fromCrate;
  }

  function setCap(id, newCap) {
    const e = registry[id];
    if (!e) return;
    e.cap = newCap;
    e.current = Math.min(e.current, newCap);
    render(id);
  }

  // Direct assignment, bypassing add()'s upgrade-reservation skimming —
  // used only when restoring a save, where the value is already final.
  function setRaw(id, value, cap) {
    const e = registry[id];
    if (!e) return;
    if (cap !== undefined) e.cap = cap;
    e.current = e.cap != null ? Math.min(e.cap, value) : value;
    render(id);
  }

  /* ---- Save/load ----
     Dynamic resources (created by a destination's ensureResource() the
     first time cargo delivered something) don't exist on a fresh boot,
     so their name and owning location travel with the save; Save
     recreates them through that location before restoring values. */
  function serialize() {
    const out = {};
    Object.keys(registry).forEach((id) => {
      const e = registry[id];
      out[id] = { v: e.current, cap: e.cap, h: e.hidden };
      if (e.dynamic) { out[id].dyn = 1; out[id].n = e.name; }
    });
    return out;
  }

  function log(id, n) { if (window.OrbWeaver.Rates) window.OrbWeaver.Rates.log(id, n); }

  window.OrbWeaver.Resources = { register, reveal, conceal, setRenderEnabled, ensure, exists, isHidden, get, getName, getCap, isAtCap, all, add, spend, setCap, setRaw, serialize, isWhole, isRenderEnabled: () => renderEnabled, clock, crateOf, parentOf, available, ensureCrate };
})();
