/* ============================================================
   CORE: UPKEEP
   Gold drain tied to active workers, across every location's worker
   pool at once — Gold is the one resource every location shares, so a
   worker assigned anywhere (Camp, Mountains, ...) drains the same
   pool. Drain = activeWorkers * TICK_RATE per tick. Gold never goes
   negative. Rate shown as sub-label under Gold row (red, only visible
   while at least 1 worker assigned anywhere).

   Optional mechanic.getBillableCount() hook: a mechanic whose card
   holds MORE assigned workers than are actually doing something (sub-
   slots — e.g. Mountains, where Outpost/Quarry/each travel path only
   draws some of the card's assigned workers) implements this to
   return the true working count instead of every worker parked on
   the card. Falls back to the full pool-assigned count for every
   mechanic without sub-slots, so this is a no-op unless opted in.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  function init() { /* gold row already created by Resources.register */ }

  function tick(tickRate) {
    // Workers on a card whose resource is at cap are blocked — no drain.
    const billable = window.OrbWeaver.Mechanics.all().reduce((sum, m) => {
      if (m.upkeepExempt) return sum; // e.g. Market — workers never cost gold
      if (m.isBillable && !m.isBillable()) return sum; // e.g. Tents — stopped workers are free
      if (window.OrbWeaver.Resources.isAtCap(m.id)) return sum;
      const pool = m.workerPool || window.OrbWeaver.Workers;
      const count = m.getBillableCount ? m.getBillableCount() : pool.getAssigned(m.id);
      return sum + count;
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
