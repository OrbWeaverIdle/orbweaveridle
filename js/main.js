/* ============================================================
   MECHANIC: WOOD
   Data + status glue only. All shared behavior from js/core/.
   Card stat states: empty (0 workers) | x/s (producing) | Stopped.
   Sub-rate label (+x/s) shown under the Wood resource row while
   producing; hidden when idle or stopped.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'wood';

  const UPGRADE_TABLE = [
    { name: 'Wood Pile',        gainPerWorker: 2,  buildTime: 60,  costRaw: '200 wood',               newCap: 400  },
    { name: 'Wood Shed',        gainPerWorker: 3,  buildTime: 120, costRaw: '400 wood, 50 stone',      newCap: 600  },
    { name: 'Wood Hut',         gainPerWorker: 4,  buildTime: 180, costRaw: '600 wood, 100 stone',     newCap: 800  },
    { name: 'Wood Store',       gainPerWorker: 5,  buildTime: 240, costRaw: '800 wood, 150 stone',     newCap: 1000 },
    { name: 'Lumber Yard',      gainPerWorker: 6,  buildTime: 420, costRaw: '100 plywood, 300 stone',  newCap: 2000 },
    { name: 'Lumber Lodge',     gainPerWorker: 7,  buildTime: 540, costRaw: '200 plywood, 400 stone',  newCap: 3000 },
    { name: 'Lumber Hall',      gainPerWorker: 8,  buildTime: 720, costRaw: '300 plywood, 100 brick',  newCap: 4000 },
    { name: 'Lumber Depot',     gainPerWorker: 9,  buildTime: 840, costRaw: '400 plywood, 200 brick',  newCap: 7000 },
    { name: 'Lumber Warehouse', gainPerWorker: 10, buildTime: 960, costRaw: '500 plywood, 300 brick',  newCap: 9000 }
  ];

  let cardName = 'Wood';
  let gainPerWorker = 0.65;
  let status = 'idle'; // idle | producing | stopped

  const track = window.OrbWeaver.Upgrades.create(UPGRADE_TABLE);
  window.OrbWeaver.Upgrades.registerTrack(ID, track);

  const mechanic = {
    id: ID,
    cardName: () => cardName,
    getStatText() {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      const collecting = track.isCollecting();
      if (assigned === 0) return collecting ? '– Collecting' : '';
      if (status === 'stopped') return collecting ? 'Stopped – Collecting' : 'Stopped';
      return `${(assigned * gainPerWorker).toFixed(2)}/s${collecting ? ' – Collecting' : ''}`;
    },
    getUpgradeBarPct: () => track.getCardProgressPct(),
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
