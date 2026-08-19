/* ============================================================
   CORE: RESOURCES REGISTRY
   Generic left-hand resource row system (name + current/cap format).
   displayType: 'integer' (Gold, currency) | 'decimal' (Wood, gathered).
   Sub-rate labels (e.g. +x/s under Wood, -x/s under Gold) are
   registered separately and updated by each mechanic/upkeep.
   Optional `hidden: true` at registration starts the row invisible;
   reveal(id) shows it permanently.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const registry = {}; // id -> { current, cap, displayType, valEl, rateEl, wrap }

  function fmt(entry) {
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
    if (renderEnabled) Object.keys(registry).forEach(render);
  }

  function render(id) {
    if (!renderEnabled) return;
    const e = registry[id];
    if (e) e.valEl.textContent = fmt(e);
  }

  function register(id, { name, mount, current, cap, displayType = 'decimal', hidden = false, dynamic = false }) {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'resource-row';
    row.innerHTML = `<span class="res-name">${name}</span><span class="res-val"></span>`;

    const rateEl = document.createElement('div');
    rateEl.className = 'res-sub-rate';
    rateEl.style.display = 'none';

    wrap.appendChild(row);
    wrap.appendChild(rateEl);
    if (hidden) wrap.style.display = 'none';
    mount.appendChild(wrap);
    registry[id] = { name, current, cap, displayType, hidden: !!hidden, dynamic: !!dynamic, valEl: row.querySelector('.res-val'), rateEl, wrap };
    render(id);
    return wrap;
  }

  // `hidden` is real state, not just a CSS property — the save system
  // needs to know what the player has unlocked, and the DOM is not a
  // place to keep game state.
  function reveal(id) {
    const e = registry[id];
    if (!e) return;
    e.hidden = false;
    if (e.wrap) e.wrap.style.display = '';
  }
  function conceal(id) {
    const e = registry[id];
    if (!e) return;
    e.hidden = true;
    if (e.wrap) e.wrap.style.display = 'none';
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
  function get(id) { return registry[id] ? registry[id].current : 0; }
  function getName(id) { return registry[id] ? registry[id].name : id; }
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
    return e.current - before;
  }

  function spend(id, amount) {
    const e = registry[id];
    if (!e) return 0;
    const before = e.current;
    e.current = Math.max(0, e.current - amount);
    render(id);
    return before - e.current;
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

  function setSubRate(id, rateText) {
    const e = registry[id];
    if (!e) return;
    if (rateText) {
      e.rateEl.textContent = rateText;
      e.rateEl.style.display = '';
      e.rateEl.className = 'res-sub-rate res-rate' + (rateText.startsWith('-') ? ' neg' : '');
    } else {
      e.rateEl.style.display = 'none';
    }
  }

  window.OrbWeaver.Resources = { register, reveal, conceal, setRenderEnabled, ensure, exists, get, getName, getCap, isAtCap, all, add, spend, setCap, setRaw, setSubRate, serialize };
})();
