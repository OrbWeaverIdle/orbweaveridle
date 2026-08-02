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
    const v = entry.displayType === 'integer' ? Math.floor(entry.current) : entry.current.toFixed(1);
    const c = entry.cap != null
      ? (entry.displayType === 'integer' ? Math.floor(entry.cap) : entry.cap.toFixed(1))
      : null;
    return c != null ? `${v}/${c}` : `${v}`;
  }

  function render(id) {
    const e = registry[id];
    if (e) e.valEl.textContent = fmt(e);
  }

  function register(id, { name, mount, current, cap, displayType = 'decimal', hidden = false }) {
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
    registry[id] = { current, cap, displayType, valEl: row.querySelector('.res-val'), rateEl, wrap };
    render(id);
    return wrap;
  }

  function reveal(id) {
    const e = registry[id];
    if (e && e.wrap) e.wrap.style.display = '';
  }

  function exists(id) { return !!registry[id]; }
  function get(id) { return registry[id] ? registry[id].current : 0; }
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

  window.OrbWeaver.Resources = { register, reveal, exists, get, getCap, isAtCap, all, add, spend, setCap, setSubRate };
})();
