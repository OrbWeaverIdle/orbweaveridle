/* ============================================================
   CORE: UPKEEP
   Gold drain tied to active workers. Drain = activeWorkers * TICK_RATE
   per tick. Gold never goes negative. Rate shown as sub-label under
   Gold row (red, only visible while at least 1 worker assigned).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  function init() { /* gold row already created by Resources.register */ }

  function tick(tickRate) {
    // Workers on a card whose resource is at cap are blocked — no drain.
    const billable = window.OrbWeaver.Mechanics.all().reduce((sum, m) => {
      if (m.upkeepExempt) return sum; // e.g. Market — workers never cost gold
      if (window.OrbWeaver.Resources.isAtCap(m.id)) return sum;
      return sum + window.OrbWeaver.Workers.getAssigned(m.id);
    }, 0);
    if (billable > 0) {
      window.OrbWeaver.Resources.spend('gold', billable * tickRate);
      window.OrbWeaver.Resources.setSubRate('gold', `-${billable}/s`);
    } else {
      window.OrbWeaver.Resources.setSubRate('gold', null);
    }
  }

  window.OrbWeaver.Upkeep = { init, tick };
})();
