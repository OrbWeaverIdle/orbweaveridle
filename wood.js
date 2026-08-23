/* ============================================================
   MECHANIC: WOOD
   Data + status glue only. All shared behavior from js/core/.
   Card stat states: empty (0 workers) | x/s (producing) | Stopped.
   Sub-rate label (+x/s) shown under the Wood resource row while
   producing; hidden when idle or stopped.

   Production uses the shared worker-contribution formula
   (js/core/upgrades.js workerRate()): gainPerWorker feeds in as m
   (it already varies by ladder tier — the ladder itself is untouched
   by this), with local p/f as the only new tunable dials here.
   Baseline p=1, f=0 reproduces the old flat assigned*gainPerWorker
   exactly. The ladder's own build timer is unrelated and unchanged.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'wood';

  const UPGRADE_TABLE = [
    { name: 'Wood Pile',        gainPerWorker: 1.3,  buildTime: 60,  costRaw: '200 wood',               newCap: 400  },
    { name: 'Wood Shed',        gainPerWorker: 1.95, buildTime: 120, costRaw: '400 wood, 50 stone',      newCap: 600  },
    { name: 'Wood Hut',         gainPerWorker: 2.6,  buildTime: 180, costRaw: '600 wood, 100 stone',     newCap: 800  },
    { name: 'Wood Store',       gainPerWorker: 5.0,  buildTime: 240, costRaw: '800 wood, 150 stone',     newCap: 1000 },
    { name: 'Lumber Yard',      gainPerWorker: 3.25, buildTime: 420, costRaw: '100 plywood, 300 stone',  newCap: 2000 },
    { name: 'Lumber Lodge',     gainPerWorker: 3.9,  buildTime: 540, costRaw: '200 plywood, 400 stone',  newCap: 3000 },
    { name: 'Lumber Hall',      gainPerWorker: 4.55, buildTime: 720, costRaw: '300 plywood, 100 brick',  newCap: 4000 },
    { name: 'Lumber Depot',     gainPerWorker: 5.2,  buildTime: 840, costRaw: '400 plywood, 200 brick',  newCap: 7000 },
    { name: 'Lumber Warehouse', gainPerWorker: 5.85, buildTime: 960, costRaw: '500 plywood, 300 brick',  newCap: 9000 }
  ];

  let cardName = 'Wood';
  let gainPerWorker = 0.65;
  let status = 'idle'; // idle | producing | stopped

  // Local p/f only — no local m (gainPerWorker already plays that role
  // and is owned by the ladder, which this doesn't touch).
  let p = 1, f = 0;
  function rate(assigned) { return window.OrbWeaver.Upgrades.workerRate(assigned, gainPerWorker, p, f); }

  const track = window.OrbWeaver.Upgrades.create(UPGRADE_TABLE);
  window.OrbWeaver.Upgrades.registerTrack(ID, track);

  const mechanic = {
    id: ID,
    section: 'Camp',
    cardName: () => cardName,
    getStatText() {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      const collecting = track.isCollecting();
      if (assigned === 0) return collecting ? 'Collecting' : '';
      if (status === 'stopped') return collecting ? 'Stopped – Collecting' : 'Stopped';
      return `${window.OrbWeaver.Upgrades.formatRate(rate(assigned))}/s${collecting ? ' – Collecting' : ''}`;
    },
    getUpgradeBarPct: () => track.getBarPct(),
    isUpgradeCollecting: () => track.isCollecting(),
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Chops ${window.OrbWeaver.Upgrades.formatRate(rate(assigned))} wood`;
    },
    // Cheat-only hooks (js/core/cheats.js rP/rF buttons) — stack +0.1
    // onto this card's own local p/f, same rule as every other cheat.
    bumpLocalP: () => { p += 0.1; },
    bumpLocalF: () => { f += 0.1; },
    patchUpgradeCost: () => track.getResourceTracker(),
    patchCollectPct: () => track.getCollectPct(),
    patchBuildStatus: () => track.getBuildStatusText(),
    cheatCompleteAll() {
      track.skipAll((row) => { cardName = row.name; gainPerWorker = row.gainPerWorker; window.OrbWeaver.Resources.setCap(ID, row.newCap); });
    },
    renderModalHTML: () => track.renderModalHTML(ID, { cap: window.OrbWeaver.Resources.getCap(ID), rate: gainPerWorker }),
    tick(goldAvailable, tickRate) {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      const atCap = window.OrbWeaver.Resources.isAtCap(ID);
      if (assigned === 0) {
        status = 'idle';
        window.OrbWeaver.Resources.setSubRate(ID, null);
      } else if (!goldAvailable || atCap) {
        status = 'stopped';
        window.OrbWeaver.Resources.setSubRate(ID, atCap ? `+${window.OrbWeaver.Upgrades.formatRate(rate(assigned))}/s` : null);
      } else {
        status = 'producing';
        const perSec = rate(assigned);
        window.OrbWeaver.Resources.add(ID, perSec * tickRate);
        window.OrbWeaver.Resources.setSubRate(ID, `+${window.OrbWeaver.Upgrades.formatRate(perSec)}/s`);
      }

      if (track.isBuilding()) {
        track.advanceTimer(tickRate, assigned, (row) => {
          cardName = row.name;
          gainPerWorker = row.gainPerWorker;
          window.OrbWeaver.Resources.setCap(ID, row.newCap);
        });
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ----
     cardName, gainPerWorker and the resource cap are still DERIVED
     from the ladder's saved index (untouched). The only new state of
     this card's own is the local p/f production dials. */
  window.OrbWeaver.Save.register(ID,
    () => ({ p, f }),
    (d) => {
      if (d) { p = d.p != null ? d.p : 1; f = d.f != null ? d.f : 0; }
      // Only the LAST completed row is applied. Walking the table row by
      // row would call setCap() with each tier's smaller cap in turn, and
      // setCap clamps current down to the new cap — which silently robbed
      // the player of everything above tier one's cap on every load.
      const reached = Math.min(track.getIndex(), UPGRADE_TABLE.length);
      if (reached <= 0) return;
      const row = UPGRADE_TABLE[reached - 1];
      if (!row) return;
      cardName = row.name;
      gainPerWorker = row.gainPerWorker;
      window.OrbWeaver.Resources.setCap(ID, row.newCap);
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
