/* ============================================================
   CORE: UPKEEP
   Gold drain tied to active workers. Camp workers: drain =
   assignedWorkers * TICK_RATE per tick. Mountains mechanics
   expose getMountainAssigned() to bill their workers the same way.
   Gold never goes negative.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  function tick(tickRate) {
    let billable = 0;
    window.OrbWeaver.Mechanics.all().forEach((m) => {
      // Camp workers
      if (!m.upkeepExempt) {
        if (!m.isBillable || m.isBillable()) {
          if (!window.OrbWeaver.Resources.isAtCap(m.id)) {
            billable += window.OrbWeaver.Workers.getAssigned(m.id);
          }
        }
      }
      // Mountains workers (separate pool, same gold rule)
      if (m.getMountainAssigned) billable += m.getMountainAssigned();
    });
    if (billable > 0) {
      window.OrbWeaver.Resources.spend('gold', billable * tickRate);
      window.OrbWeaver.Resources.setSubRate('gold', `-${billable}/s`);
    } else {
      window.OrbWeaver.Resources.setSubRate('gold', null);
    }
  }

  window.OrbWeaver.Upkeep = { tick };
})();
