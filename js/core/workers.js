/* ============================================================
   CORE: WORKERS
   Generic worker pool shared by every mechanic. Cards ask to
   assign/unassign workers by their own id; this module tracks idle
   vs. total and notifies change listeners on every assign/unassign/
   recall, so every card's stepper state stays in sync globally.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  let total = 5;
  let idle = 5;
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
    total += count;
    idle += count;
    render();
    changeListeners.forEach((fn) => fn());
  }

  function onChange(fn) { changeListeners.push(fn); }

  window.OrbWeaver.Workers = { init, getAssigned, getActiveCount, getIdleCount, getTotal, assign, unassign, recallAll, addWorkers, onChange };
})();
