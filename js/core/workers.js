/* ============================================================
   CORE: WORKERS
   createPool(startTotal) builds one independent worker pool: idle vs.
   total, per-mechanic assignment counts, and change listeners so every
   card's stepper state stays in sync. Every location gets its own pool
   (Camp's is the default export below; Mountains/Sand Dunes/Plains each
   call createPool() for their own) — pools never share workers with
   each other. A mechanic on a non-Camp pool sets `mechanic.workerPool`
   to that pool instance; cards.js and upkeep.js fall back to the
   default Camp pool when it's absent, so every existing Camp mechanic
   needs no changes.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const pools = {}; // poolId -> pool, so the save system can find them all

  function createPool(startTotal, poolId) {
    let total = startTotal, idle = startTotal;
    const assignments = {}; // mechanicId -> count
    const changeListeners = [];
    let valEl, recallBtn;

    function render() {
      if (valEl) valEl.textContent = `${idle}/${total}`;
      if (recallBtn) recallBtn.disabled = getActiveCount() === 0;
    }

    function init(mount) {
      const row = document.createElement('div');
      row.className = 'resource-row worker-row';
      row.innerHTML = `
        <span class="res-name">Workers</span>
        <button class="worker-recall-btn" title="Recall all workers to idle">–</button>
        <span class="res-val"></span>
      `;
      mount.appendChild(row);
      recallBtn = row.querySelector('.worker-recall-btn');
      valEl = row.querySelector('.res-val');
      recallBtn.addEventListener('click', recallAll);
      render();
    }

    function getAssigned(id) { return assignments[id] || 0; }
    function getActiveCount() { return total - idle; }
    function getIdleCount() { return idle; }
    function getTotal() { return total; }

    function assign(id) {
      if (idle <= 0) return false;
      idle--;
      assignments[id] = (assignments[id] || 0) + 1;
      render();
      changeListeners.forEach((fn) => fn());
      return true;
    }

    function unassign(id) {
      if (!assignments[id]) return false;
      assignments[id]--;
      idle++;
      render();
      changeListeners.forEach((fn) => fn());
      return true;
    }

    function recallAll() {
      if (getActiveCount() === 0) return;
      const locked = new Set(
        window.OrbWeaver.Mechanics.all().filter((m) => m.locked).map((m) => m.id)
      );
      Object.keys(assignments).forEach((id) => {
        if (!locked.has(id)) { idle += assignments[id]; assignments[id] = 0; }
      });
      render();
      changeListeners.forEach((fn) => fn());
      window.OrbWeaver.Footer.push('Workers recalled to idle.');
    }

    function addWorkers(count) {
      if (count <= 0) return;
      total += count;
      idle += count;
      render();
      changeListeners.forEach((fn) => fn());
    }

    // Moves workers directly between two mechanics' assignments (same
    // pool), bypassing idle entirely (e.g. Scout Stable auto-staffing a
    // freshly-built mule).
    function transferAssignment(fromId, toId, count) {
      const n = Math.min(assignments[fromId] || 0, count);
      if (n <= 0) return 0;
      assignments[fromId] -= n;
      assignments[toId] = (assignments[toId] || 0) + n;
      render();
      changeListeners.forEach((fn) => fn());
      return n;
    }

    // Fully removes a mechanic's assigned workers from the pool — not
    // idle, not active, uncountable and unrecallable (e.g. a mule's crew
    // away on a trip). Returns the count removed so the caller can
    // restore or permanently relocate them later.
    function sequester(id) {
      const n = assignments[id] || 0;
      if (n <= 0) return 0;
      assignments[id] = 0;
      total -= n;
      render();
      changeListeners.forEach((fn) => fn());
      return n;
    }

    function onChange(fn) { changeListeners.push(fn); }

    /* ---- Save/load ----
       total/idle/assignments restore verbatim, which is exactly right
       even mid-trip: sequester() has ALREADY subtracted riders from
       `total`, and the Scout Stable separately saves its ridersAway
       counters. Restore both and the workers come home as normal. Save
       one without the other and they are silently deleted forever. */
    function serialize() { return { total, idle, a: Object.assign({}, assignments) }; }
    function deserialize(d) {
      if (!d) return;
      total = d.total || 0;
      idle = d.idle || 0;
      Object.keys(assignments).forEach((k) => delete assignments[k]);
      Object.keys(d.a || {}).forEach((k) => { assignments[k] = d.a[k]; });
      render();
      changeListeners.forEach((fn) => fn());
    }

    const pool = { init, getAssigned, getActiveCount, getIdleCount, getTotal, assign, unassign, recallAll, addWorkers, transferAssignment, sequester, onChange, serialize, deserialize };
    if (poolId) pools[poolId] = pool;
    return pool;
  }

  window.OrbWeaver.Workers = createPool(5, 'camp');
  window.OrbWeaver.Workers.createPool = createPool;
  window.OrbWeaver.Workers.getPools = () => pools;
})();
