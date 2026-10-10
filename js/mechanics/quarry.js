/* ============================================================
   MECHANIC: QUARRY (Mountains)
   Resource card producing mtn_stone. Mirrors Stone Pit but with a
   higher per-worker GAIN, real tool consumption (toolTier 2), and its
   own worker pool (Mountains'). No upgrade ladder — name/rate/cap are
   fixed; only m/p/f are this card's own saved state.
   Starts hidden — revealed when Mountains completes Stone Quarry.

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

  const ID = 'quarry';
  const RES = 'mtn_stone';
  const NAME = 'Quarry';
  const GAIN = 15.82; // stone per work-unit/s — this card's own balance number, never saved
  const pool = window.OrbWeaver.Mountains.workerPool;

  let status = 'idle';

  // Real, free worker-contribution dials. m starts at 1 (unlike the old
  // gainPerWorker-in-m shape) so an external buff source can move it
  // without also touching GAIN.
  let m = 1, p = 1, f = 0;
  function rate(assigned) { return window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f) * GAIN; }

  // Real tool consumption for toolTier: 2 (js/core/toolUse.js). Only
  // ever ticked from inside the "would otherwise produce" branch below —
  // there's no separate gold/starvation flag to pass in, since not
  // calling tick() at all on a gold-starved or at-cap tick IS the pause.
  const toolConsumer = window.OrbWeaver.ToolUse.createConsumer();

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    toolTier: 2,
    modalTheme: 'theme-mountains',
    resourceId: RES, // upkeep.js's isAtCap() gate — id 'quarry' != resource 'mtn_stone'
    workerPool: pool,
    toolConsumer, // upkeep.js: no tool in hand -> workers cost no gold
    isBillable: () => status !== 'stopped', // same rule as Tents/MPF Test — covers the gold and cap stops too
    cardName: () => NAME,
    getStatText() {
      const assigned = pool.getAssigned(ID);
      if (assigned === 0) return '';
      if (status === 'stopped') return 'Stopped';
      return `${window.OrbWeaver.Upgrades.formatRate(rate(assigned))}/s`;
    },
    getUpgradeBarPct: () => 0, // no ladder — permanent empty stub
    getWorkerDesc: () => {
      const assigned = pool.getAssigned(ID);
      return assigned === 0 ? '' : `Chisels ${window.OrbWeaver.Upgrades.formatRate(rate(assigned))} stone`;
    },
    // Cheat-only hooks (js/core/cheats.js rM/rP/rF buttons) — stack +0.1
    // onto this card's own local m/p/f, same rule as every other cheat.
    bumpLocalM: () => { m += 0.1; },
    bumpLocalP: () => { p += 0.1; },
    bumpLocalF: () => { f += 0.1; },
    getSubtitleHtml: () => window.OrbWeaver.ToolUse.getSubtitleHtml(2),
    renderModalHTML: () => '', // empty for now — content added in a later session
    tick(goldAvailable, tickRate) {
      const assigned = pool.getAssigned(ID);
      const atCap = window.OrbWeaver.Resources.isAtCap(RES);
      if (assigned === 0) {
        status = 'idle';
      } else if (!goldAvailable || atCap) {
        status = 'stopped';
      } else if (toolConsumer.tick('mtn_', 2, assigned, tickRate).starved) {
        // Tool-shortage status text is deliberately just 'Stopped' — same
        // generic string as the gold/cap cases, no differentiated message.
        status = 'stopped';
      } else {
        status = 'producing';
        window.OrbWeaver.Resources.add(RES, rate(assigned) * tickRate);
      }
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ---- Only the three dials + tool consumer state. */
  window.OrbWeaver.Save.register(ID,
    () => ({ m, p, f, tc: toolConsumer.serialize() }),
    (d) => {
      if (!d) return;
      m = d.m != null ? d.m : 1;
      p = d.p != null ? d.p : 1;
      f = d.f != null ? d.f : 0;
      toolConsumer.deserialize(d.tc || 0);
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
