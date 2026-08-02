/* ============================================================
   MECHANIC: STONE
   Data + status glue only. All shared behavior from js/core/.
   Card stat states: empty (0 workers) | x/s (producing) | Stopped.
   Sub-rate label (+x/s) shown under the Stone resource row while
   producing; hidden when idle or stopped.
   Starts hidden — revealed only when Builder's Bench completes
   Stone Pit in its Construction list (see buildersbench.js).
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

  const track = window.OrbWeaver.Upgrades.create(UPGRADE_TABLE);
  window.OrbWeaver.Upgrades.registerTrack(ID, track);

  const mechanic = {
    id: ID,
    startHidden: true,
    cardName: () => cardName,
    getStatText() {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      const collecting = track.isCollecting();
      if (assigned === 0) return collecting ? 'Collecting' : '';
      if (status === 'stopped') return collecting ? 'Stopped – Collecting' : 'Stopped';
      return `${(assigned * gainPerWorker).toFixed(2)}/s${collecting ? ' – Collecting' : ''}`;
    },
    getUpgradeBarPct: () => track.getCardProgressPct(),
    getWorkerDesc: () => `Chisels ${gainPerWorker.toFixed(2)} stone`,
    patchUpgradeCost: () => track.getResourceTracker(),
    patchBuildStatus: () => track.getBuildStatusText(),
    renderModalHTML: () => track.renderModalHTML(ID, { cap: window.OrbWeaver.Resources.getCap(ID), rate: gainPerWorker }),
    tick(goldAvailable, tickRate) {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      const atCap = window.OrbWeaver.Resources.isAtCap(ID);
      if (assigned === 0) {
        status = 'idle';
        window.OrbWeaver.Resources.setSubRate(ID, null);
      } else if (!goldAvailable || atCap) {
        status = 'stopped';
        window.OrbWeaver.Resources.setSubRate(ID, atCap ? `+${(assigned * gainPerWorker).toFixed(2)}/s` : null);
      } else {
        status = 'producing';
        const perSec = assigned * gainPerWorker;
        window.OrbWeaver.Resources.add(ID, perSec * tickRate);
        window.OrbWeaver.Resources.setSubRate(ID, `+${perSec.toFixed(2)}/s`);
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

  window.OrbWeaver.Mechanics.register(mechanic);
})();
