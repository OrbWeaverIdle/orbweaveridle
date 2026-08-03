/* ============================================================
   MECHANIC: IRON (Mountains)
   Resource card. Stone's values, different name. Workers drawn
   from Mountains idle pool. Starts hidden — revealed when
   Mountains Builder's Bench completes Mine.
   getMountainAssigned() bills workers to gold upkeep.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'iron';

  const UPGRADE_TABLE = [
    { name: 'Iron Cache',      gainPerWorker: 2.26,  buildTime: 60,  costRaw: '450 iron',                  newCap: 600   },
    { name: 'Iron Shed',       gainPerWorker: 3.39,  buildTime: 120, costRaw: '600 iron, 50 wood',          newCap: 700   },
    { name: 'Iron Pit',        gainPerWorker: 9.04,  buildTime: 180, costRaw: '100 bricks, 100 wood',       newCap: 800   },
    { name: 'Iron Shed II',    gainPerWorker: 10.17, buildTime: 240, costRaw: '300 bricks, 200 wood',       newCap: 900   },
    { name: 'Iron Yard',       gainPerWorker: 11.3,  buildTime: 420, costRaw: '500 bricks, 1000 wood',      newCap: 1000  },
    { name: 'Iron Hall',       gainPerWorker: 18.08, buildTime: 540, costRaw: '700 bricks, 300 plywood',    newCap: 2000  },
    { name: 'Iron Lodge',      gainPerWorker: 19.21, buildTime: 720, costRaw: '800 bricks, 350 plywood',    newCap: 3000  },
    { name: 'Iron Warehouse',  gainPerWorker: 20.34, buildTime: 840, costRaw: '1000 bricks, 500 plywood',   newCap: 10000 },
    { name: 'Ironworks',       gainPerWorker: 29.38, buildTime: 960, costRaw: '2000 bricks, 1000 plywood',  newCap: 20000 }
  ];

  let cardName = 'Mine';
  let gainPerWorker = 1.13;
  let status = 'idle';
  let assigned = 0; // workers from Mountains idle pool

  const track = window.OrbWeaver.Upgrades.create(UPGRADE_TABLE);
  window.OrbWeaver.Upgrades.registerTrack(ID, track);

  // Iron resource row managed manually in left-hand Mountains section
  let ironCurrent = 0;
  const ironCap = 500;

  function addIron(amount) {
    ironCurrent = Math.min(ironCap, ironCurrent + amount);
    renderIronLeft();
  }
  function getIron() { return ironCurrent; }
  function renderIronLeft() {
    const el = document.getElementById('left-iron-val');
    if (el) el.textContent = `${ironCurrent.toFixed(1)}/${ironCap}`;
  }
  window.OrbWeaver.Iron = { get: getIron, add: addIron };

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    cardName: () => cardName,
    getMountainAssigned: () => assigned,
    getStatText() {
      if (assigned === 0) return track.isCollecting() ? 'Collecting' : '';
      if (status === 'stopped') return track.isCollecting() ? 'Stopped – Collecting' : 'Stopped';
      return `${(assigned * gainPerWorker).toFixed(2)}/s${track.isCollecting() ? ' – Collecting' : ''}`;
    },
    getUpgradeBarPct: () => track.getBarPct(),
    isUpgradeCollecting: () => track.isCollecting(),
    getWorkerDesc: () => `Mines ${gainPerWorker.toFixed(2)} iron`,
    patchUpgradeCost: () => track.getResourceTracker(),
    patchBuildStatus: () => track.getBuildStatusText(),
    renderModalHTML: () => track.renderModalHTML(ID, { cap: ironCap, rate: gainPerWorker }),
    tick(goldAvailable, tickRate) {
      // Steppers on this card pull from Mountains idle pool
      const goldOk = goldAvailable;
      const atCap = ironCurrent >= ironCap;

      if (assigned === 0) {
        status = 'idle';
      } else if (!goldOk || atCap) {
        status = 'stopped';
      } else {
        status = 'producing';
        addIron(assigned * gainPerWorker * tickRate);
      }

      if (track.isBuilding()) {
        track.advanceTimer(tickRate, assigned, (row) => {
          cardName = row.name;
          gainPerWorker = row.gainPerWorker;
        });
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  // Override Cards.build steppers to use Mountains idle pool
  // We do this by patching the mechanic's card after build via a flag.
  mechanic._mountainsWorkerCard = true;
  mechanic._getAssigned = () => assigned;
  mechanic._assign = () => {
    if (window.OrbWeaver.Mountains.getIdle() <= 0) return false;
    window.OrbWeaver.Mountains.takeIdle(1);
    assigned++;
    return true;
  };
  mechanic._unassign = () => {
    if (assigned <= 0) return false;
    assigned--;
    window.OrbWeaver.Mountains.addIdle(1);
    return true;
  };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
