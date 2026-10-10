/* ============================================================
   CORE: UPKEEP
   Gold drain tied to active workers, across every location's worker
   pool at once — Gold is the one resource every location shares, so a
   worker assigned anywhere (Camp, Mountains, ...) drains the same
   pool. Drain = activeWorkers * TICK_RATE per tick. Gold never goes
   negative. Its rate line is measured by js/core/rates.js.

   Optional mechanic.getBillableCount() hook: a mechanic whose card
   holds MORE assigned workers than are actually doing something (sub-
   slots — e.g. Mountains, where Outpost/Quarry/each travel path only
   draws some of the card's assigned workers) implements this to
   return the true working count instead of every worker parked on
   the card. Falls back to the full pool-assigned count for every
   mechanic without sub-slots, so this is a no-op unless opted in.

   Optional mechanic.toolConsumer hook: a mechanic exposing its
   js/core/toolUse.js consumer gets its workers billed nothing on any
   tick that consumer reported starved — no tool in hand means no work
   happened, so no wage is owed. Merely exposing the property opts in;
   nothing else is needed, so a future tool card cannot ship this bug
   by forgetting a line. It covers TOOL shortage only — a card that
   also stops for gold or cap reasons still needs its own isBillable().

   Optional mechanic.resourceId hook: the isAtCap() gate below only
   works when a mechanic's own id happens to match the resource id it
   produces (true for Wood/Stone by coincidence). Any mechanic whose
   resource id differs (Quarry: id 'quarry', resource 'mtn_stone') sets
   this so the cap check looks at the right row. Falls back to m.id.
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
      if (m.toolConsumer && m.toolConsumer.isStarved()) return sum; // no tool in hand — no work, no wage
      if (window.OrbWeaver.Resources.isAtCap(m.resourceId || m.id)) return sum;
      const pool = m.workerPool || window.OrbWeaver.Workers;
      const count = m.getBillableCount ? m.getBillableCount() : pool.getAssigned(m.id);
      return sum + count;
    }, 0);
    if (billable > 0) window.OrbWeaver.Resources.spend('gold', billable * tickRate);
  }

  window.OrbWeaver.Upkeep = { init, tick };
})();
