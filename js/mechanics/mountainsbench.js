/* ============================================================
   MECHANIC: MOUNTAINS BUILDER'S BENCH
   Same architecture as Builder's Bench. Workers drawn from
   Mountains idle pool. getMountainAssigned() bills them to gold.
   Construction list: Mine (30 wood + 10 stone, 8s).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'mountainsbench';

  const SELF_TABLE = [
    { name: "Mountains Workshop",  gainPerWorker: 1, buildTime: 60,  costRaw: '200 wood, 100 stone' },
    { name: "Mountains Hall",      gainPerWorker: 1, buildTime: 150, costRaw: '400 wood, 300 stone' }
  ];
  function renderSelfEffect() { return 'Unlocks: TBD'; }

  const CONSTRUCTION_ITEMS = [
    { id: 'mine', name: 'Mine', buildTime: 8, costRaw: '30 wood, 10 stone', startAvailable: true }
  ];

  let cardName = "Builder's Bench";
  let secondsPerWorker = 1;
  let opened = false;
  let assigned = 0; // Mountains idle pool

  function onConstructionComplete(id) {
    if (id === 'mine') {
      // Reveal Mine card and Iron row in Mountains
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('iron'));
      if (window.OrbWeaver.Mountains) window.OrbWeaver.Mountains.revealIron();
      window.OrbWeaver.Footer.push('Mine built! Iron now available.');
    }
  }

  const selfTrack = window.OrbWeaver.Upgrades.create(SELF_TABLE, renderSelfEffect, true);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:self`, selfTrack);

  const buildTrack = window.OrbWeaver.Upgrades.createChoiceTrack(CONSTRUCTION_ITEMS, onConstructionComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:build`, buildTrack);

  const mechanic = {
    id: ID,
    section: 'Mountains',
    getMountainAssigned: () => assigned,
    cardName: () => cardName,
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Click to open';
      if (buildTrack.isBuilding()) {
        const item = buildTrack.activeItem();
        return `Building ${item.name} – ${Math.ceil(buildTrack.getRemaining())}s`;
      }
      const rem = buildTrack.availableCount();
      return rem > 0 ? `${rem} to build` : (selfTrack.current() ? `Next upgrade – ${selfTrack.current().costRaw}` : 'Complete');
    },
    getUpgradeBarPct: () => selfTrack.getBarPct(),
    isUpgradeCollecting: () => selfTrack.isCollecting(),
    getWorkerDesc: () => `Builds ${secondsPerWorker}s faster`,
    patchUpgradeCost: () => selfTrack.getResourceTracker(),
    patchCollectPct: () => selfTrack.getCollectPct(),
    patchBuildStatus: () => selfTrack.getBuildStatusText(),
    getBuildBarPct: () => buildTrack.getProgressPct(),
    patchLiveTrack: () => buildTrack.patchModalRows(),
    renderModalHTML() {
      const arrow = `<span class="section-collapse-arrow${selfTrack.isCollapsed() ? ' collapsed' : ''}" data-upgrade-action="toggle-collapse" data-mechanic="${ID}" data-track="self">▾</span>`;
      return `<div class="bench-modal">` +
        selfTrack.renderModalHTML(ID, {}, 'self', arrow) +
        `<div class="modal-subsection-label divider-only"></div>${buildTrack.renderModalRows(ID, 'build')}` +
      `</div>`;
    },
    tick(goldAvailable, tickRate) {
      if (selfTrack.isBuilding()) selfTrack.advanceTimer(tickRate, assigned, (row) => {
        cardName = row.name;
        secondsPerWorker = row.gainPerWorker;
      });
      if (buildTrack.isBuilding()) buildTrack.advanceTimer(tickRate, assigned);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  // Mountains pool stepper flags (same as iron.js)
  mechanic._mountainsWorkerCard = true;
  mechanic._getAssigned = () => assigned;
  mechanic._assign = () => {
    if (!window.OrbWeaver.Mountains || window.OrbWeaver.Mountains.getIdle() <= 0) return false;
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
