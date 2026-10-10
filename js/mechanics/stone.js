/* ============================================================
   MECHANIC: STONE
   Data + status glue only. All shared behavior from js/core/.
   Card stat states: empty (0 workers) | x/s (producing) | Stopped.
   Its rail rate line is measured by js/core/rates.js. No upgrade ladder — the
   card is a flat producer at a fixed cap; name/rate/cap don't change.
   Starts hidden — revealed only when Builder's Bench completes
   Stone Pit in its Construction list (see buildersbench.js).

   Production uses the shared worker-contribution formula
   (js/core/upgrades.js workerRate()): GAIN is a card-balance constant
   OUTSIDE the formula (stone per work-unit), while m/p/f are real,
   free dials at baseline (1,1,0) — any future system (e.g. a tool)
   can move m/p/f without also fighting GAIN for the same slot. The
   modal has no content yet (added in a later session); the top bar
   is a permanent empty stub (no ladder drives it).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'stone';
  const NAME = 'Stone Pit';
  const GAIN = 1.13; // stone per work-unit/s — this card's own balance number, never saved

  let status = 'idle'; // idle | producing | stopped

  // Real, free worker-contribution dials. m starts at 1 (unlike the old
  // gainPerWorker-in-m shape) so an external buff source can move it
  // without also touching GAIN.
  let m = 1, p = 1, f = 0;
  function rate(assigned) { return window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f) * GAIN; }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Camp',
    cardName: () => NAME,
    getStatText() {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (assigned === 0) return '';
      if (status === 'stopped') return 'Stopped';
      return `${window.OrbWeaver.Upgrades.formatRate(rate(assigned))}/s`;
    },
    getUpgradeBarPct: () => 0, // no ladder — permanent empty stub
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Chisels ${window.OrbWeaver.Upgrades.formatRate(rate(assigned))} stone`;
    },
    // Cheat-only hooks (js/core/cheats.js rM/rP/rF buttons) — stack +0.1
    // onto this card's own local m/p/f, same rule as every other cheat.
    bumpLocalM: () => { m += 0.1; },
    bumpLocalP: () => { p += 0.1; },
    bumpLocalF: () => { f += 0.1; },
    renderModalHTML: () => '', // empty for now — content added in a later session
    tick(goldAvailable, tickRate) {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      const atCap = window.OrbWeaver.Resources.isAtCap(ID);
      if (assigned === 0) {
        status = 'idle';
      } else if (!goldAvailable || atCap) {
        status = 'stopped';
      } else {
        status = 'producing';
        window.OrbWeaver.Resources.add(ID, rate(assigned) * tickRate);
      }
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ---- Only the three dials are this card's own state. */
  window.OrbWeaver.Save.register(ID,
    () => ({ m, p, f }),
    (d) => {
      if (!d) return;
      m = d.m != null ? d.m : 1;
      p = d.p != null ? d.p : 1;
      f = d.f != null ? d.f : 0;
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
