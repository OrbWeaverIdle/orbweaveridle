/* ============================================================
   MECHANIC: STONE
   Data + status glue only. All shared behavior from js/core/.
   Card stat states: empty (0 workers) | x/s (producing) | Stopped.
   Sub-rate label (+x/s) shown under the Stone resource row while
   producing; hidden when idle or stopped.
   Starts hidden — revealed only when Builder's Bench completes
   Stone Pit in its Construction list (see buildersbench.js).

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

  const ID = 'stone';

  const UPGRADE_TABLE = [
    { name: 'Stone Pile',       gainPerWorker: 2.26,  buildTime: 60,  costRaw: '450 stone',                   newCap: 600   },
    { name: 'Stone Shed',       gainPerWorker: 3.39,  buildTime: 120, costRaw: '600 stone, 50 wood',           newCap: 700   },
    { name: 'Quarry Pit',       gainPerWorker: 9.04,  buildTime: 180, costRaw: '100 bricks, 100 wood',         newCap: 800   },
    { name: 'Quarry Shed',      gainPerWorker: 10.17, buildTime: 240, costRaw: '300 bricks, 200 wood',         newCap: 900   },
    { name: 'Quarry Yard',      gainPerWorker: 11.3,  buildTime: 420, costRaw: '500 bricks, 1000 wood',        newCap: 1000  },
    { name: 'Mason Hall',       gainPerWorker: 18.08, buildTime: 540, costRaw: '700 bricks, 300 plywood',      newCap: 2000  },
    { name: 'Mason Lodge',      gainPerWorker: 19.21, buildTime: 720, costRaw: '800 bricks, 350 plywood',      newCap: 3000  },
    { name: 'Mason Warehouse',  gainPerWorker: 20.34, buildTime: 840, costRaw: '1000 bricks, 500 plywood',     newCap: 10000 },
    { name: 'Stoneworks',       gainPerWorker: 29.38, buildTime: 960, costRaw: '2000 bricks, 1000 plywood',    newCap: 20000 }
  ];

  let cardName = 'Stone Pit';
  let gainPerWorker = 1.13;
  let status = 'idle'; // idle | producing | stopped

  // Local p/f only — no local m (gainPerWorker already plays that role
  // and is owned by the ladder, which this doesn't touch).
  let p = 1, f = 0;
  function rate(assigned) { return window.OrbWeaver.Upgrades.workerRate(assigned, gainPerWorker, p, f); }

  const track = window.OrbWeaver.Upgrades.create(UPGRADE_TABLE);
  window.OrbWeaver.Upgrades.registerTrack(ID, track);

  const mechanic = {
    id: ID,
    startHidden: true,
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
      return assigned === 0 ? '' : `Chisels ${window.OrbWeaver.Upgrades.formatRate(rate(assigned))} stone`;
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
