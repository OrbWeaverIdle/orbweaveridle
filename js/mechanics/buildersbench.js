/* ============================================================
   MECHANIC: CAMP (formerly Builder's Bench)
   Not a resource — no left-hand row. Visible from the very start of
   the game (first card, no reveal gate). One track:

   Construction list (bottom bar, one item at a time): cards Camp can
   build for the player. Each item needs its full cost paid up front
   (no partial auto-collection) and drops off the list for good once
   built. Everything below is available from the start.

   Camp no longer has a self-upgrade ladder or a renaming card name —
   the top bar is a reserved-but-unused stub (getUpgradeBarPct: () => 0)
   for a future mechanic to claim, same convention as every other card
   that doesn't use it.

   Card face: "Click to open" until first opened; once opened, idle
   reads "{n} to build" (Construction items still available) or blank
   once none remain; building reads "Building X – Ys".
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'buildersbench';

  const CONSTRUCTION_ITEMS = [
    { id: 'tents', name: 'Tents', desc: 'Pitch tents for more workers.', buildTime: 2, costRaw: '15 wood', startAvailable: true },
    { id: 'stonepit', name: 'Stone Pit', desc: 'Chisel for Stone.', buildTime: 3, costRaw: '20 wood', startAvailable: true },
    { id: 'market', name: 'Market Stall', desc: 'Sell goods for Gold.', buildTime: 10, costRaw: '50 wood, 20 stone', startAvailable: true },
    { id: 'scoutspen', name: "Scout's Pen", desc: 'Explore your surroundings.', buildTime: 45, costRaw: '225 wood, 50 stone', startAvailable: true },
    { id: 'academy', name: 'Academy', desc: 'Compile Research Papers.', buildTime: 120, costRaw: '550 wood, 550 stone', startAvailable: true }
  ];

  let opened = false;
  let paused = false;
  let goldStarved = false;

  // Worker contribution formula (see js/core/upgrades.js workerRate()).
  // Local to this card — a future tool changes only these three.
  let m = 1, p = 1, f = 0;

  function onConstructionComplete(id) {
    if (id === 'stonepit') {
      window.OrbWeaver.Resources.reveal('stone');
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('stone'));
    } else if (id === 'market') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('market'));
    } else if (id === 'tents') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('tents'));
    } else if (id === 'scoutspen') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('scoutspen'));
    } else if (id === 'academy') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('academy'));
      window.OrbWeaver.Resources.reveal('researchpapers');
      window.OrbWeaver.Resources.reveal('journals');
    }
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  const buildTrack = window.OrbWeaver.Upgrades.createChoiceTrack(CONSTRUCTION_ITEMS, onConstructionComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:build`, buildTrack);

  const mechanic = {
    id: ID,
    section: 'Camp',
    buildTrackKey: 'build',
    cardName: () => 'Camp',
    isBillable: () => buildTrack.isBuilding(),
    isBuildBarFaded: () => buildTrack.getQueuedItem() !== null && !buildTrack.isBuilding(),
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Click to open';
      if (buildTrack.isBuilding()) {
        const item = buildTrack.activeItem();
        const secs = Math.ceil(buildTrack.getRemaining());
        return (paused || goldStarved) ? `Stopped ${item.name} – ${secs}s` : `Building ${item.name} – ${secs}s`;
      }
      const queued = buildTrack.getQueuedItem();
      if (queued) return `Queued ${queued.name} – waiting`;
      const remaining = buildTrack.availableCount();
      if (remaining <= 0) return '';
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned > 0 ? `Stopped – ${remaining} to build` : `${remaining} to build`;
    },
    getUpgradeBarPct: () => 0,
    getBuildBarPct() {
      if (buildTrack.isBuilding()) return buildTrack.getProgressPct();
      if (buildTrack.getQueuedItem()) return buildTrack.getQueueFillPct();
      return 0;
    },
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Building ${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f))}/s`;
    },
    cheatCompleteAll() { buildTrack.completeAll(); },
    patchLiveTrack: () => buildTrack.patchModalRows(),
    renderModalHTML() {
      return `<div class="bench-modal">${buildTrack.renderModalRows(ID, 'build')}</div>`;
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);

      // Auto-start queued item when both a worker is assigned and resources are met.
      const queued = buildTrack.getQueuedItem();
      if (queued && assigned > 0 && goldAvailable) {
        buildTrack.start(queued.id);
        if (buildTrack.isBuilding()) buildTrack.dequeue();
      }

      if (buildTrack.isBuilding()) {
        paused = assigned === 0;
        if (!paused && goldAvailable) buildTrack.advanceTimer(tickRate, assigned, m, p, f);
      } else {
        paused = false;
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ----
     The construction track saves itself, and replays each completed
     item's onComplete on load — that is what re-reveals Stone, Market,
     Tents, Scout's Pen and Academy. `paused` and `goldStarved` are
     recomputed on the next tick, so neither is stored. */
  window.OrbWeaver.Save.register(ID,
    () => ({ o: opened ? 1 : 0 }),
    (d) => { opened = !!d.o; });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
