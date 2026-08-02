/* ============================================================
   MECHANIC: BUILDER'S BENCH (Camp)
   Not a resource — no left-hand row. Two independent tracks:

   1) Self-upgrade ladder (top bar, collapsed by default): raises
      secondsPerWorker (how much each assigned worker speeds up
      whatever the Bench is building) and, at Builder's Shed,
      unlocks Scout's Pen + Gambler's Mat in the Construction list.

   2) Construction list (bottom bar, one item at a time): cards the
      Bench can build for the player. Each item needs its full cost
      paid up front (no partial auto-collection) and drops off the
      list for good once built. Scout's Pen starts hidden behind a
      gold-cost early reveal, or unlocks naturally at Builder's Shed.

   Workers assigned to this card contribute to BOTH tracks at once.
   Card face: "Click to open" until first opened, then blank or
   "Building X – Ys" tied only to the Construction track.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'buildersbench';

  // Self-upgrade ladder. Starting tier ("Builder's Bench") is free/instant
  // on reveal; this table is the *upgrades* beyond that starting tier.
  const SELF_TABLE = [
    { name: "Builder's Shed",        gainPerWorker: 1, buildTime: 40,   costRaw: '100 wood, 75 stone' },
    { name: "Builder's Hut",         gainPerWorker: 1, buildTime: 150,  costRaw: '200 wood, 200 stone' },
    { name: "Builder's Cabin",       gainPerWorker: 1, buildTime: 250,  costRaw: '100 plywood, 100 brick' },
    { name: "Builder's Hall",        gainPerWorker: 1, buildTime: 400,  costRaw: '300 plywood, 300 brick' },
    { name: 'Construction Yard',     gainPerWorker: 2, buildTime: 600,  costRaw: '400 iron, 500 brick' },
    { name: 'Construction House',    gainPerWorker: 2, buildTime: 900,  costRaw: '1000 iron, 1000 brick' },
    { name: 'Construction Centre',   gainPerWorker: 2, buildTime: 1300, costRaw: '300 wrought iron, 2000 brick' },
    { name: 'Construction Facility', gainPerWorker: 2, buildTime: 1700, costRaw: '500 wrought iron, 3000 brick' },
    { name: 'Construction Works',    gainPerWorker: 2, buildTime: 2000, costRaw: '1000 wrought iron, 4000 brick' }
  ];
  const UNLOCK_TEXT = { "Builder's Shed": "Gambler's Mat, Scout's Pen" };
  function renderSelfEffect(row) { return `Unlocks: ${UNLOCK_TEXT[row.name] || 'TBD'}`; }

  const CONSTRUCTION_ITEMS = [
    { id: 'stonepit', name: 'Stone Pit', buildTime: 3, costRaw: '20 wood', startAvailable: true },
    { id: 'market', name: 'Market Stall', buildTime: 10, costRaw: '50 wood, 20 stone', startAvailable: true },
    { id: 'scoutspen', name: "Scout's Pen", buildTime: 45, costRaw: '225 wood, 50 stone', startAvailable: true, startHidden: true, revealCost: { gold: 1000 }, revealCostRaw: '1000 gold' },
    { id: 'gamblersmat', name: "Gambler's Mat", buildTime: 60, costRaw: '25 wood', startAvailable: false }
  ];

  let cardName = "Builder's Bench";
  let secondsPerWorker = 1;
  let revealed = false;
  let opened = false;

  function onSelfComplete(row) {
    cardName = row.name;
    secondsPerWorker = row.gainPerWorker;
    if (row.name === "Builder's Shed") {
      buildTrack.unlock('scoutspen');
      buildTrack.unlock('gamblersmat');
    }
  }

  function onConstructionComplete(id) {
    if (id === 'stonepit') {
      window.OrbWeaver.Resources.reveal('stone');
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('stone'));
    } else if (id === 'market') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('market'));
    }
    // gamblersmat / scoutspen: appear built but inert for now.
  }

  const selfTrack = window.OrbWeaver.Upgrades.create(SELF_TABLE, renderSelfEffect, true);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:self`, selfTrack);

  const buildTrack = window.OrbWeaver.Upgrades.createChoiceTrack(CONSTRUCTION_ITEMS, onConstructionComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:build`, buildTrack);

  const mechanic = {
    id: ID,
    startHidden: true,
    upgradeTrackKey: 'self',
    buildTrackKey: 'build',
    cardName: () => cardName,
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Click to open';
      const collecting = selfTrack.isCollecting();
      const building = buildTrack.isBuilding();
      if (building) {
        const item = buildTrack.activeItem();
        const base = `Building ${item.name} – ${Math.ceil(buildTrack.getRemaining())}s`;
        return collecting ? `${base} – Collecting` : base;
      }
      return collecting ? 'Collecting' : '';
    },
    getUpgradeBarPct: () => selfTrack.getCardProgressPct(),
    getWorkerDesc: () => `Builds ${secondsPerWorker}s faster`,
    getBuildBarPct: () => buildTrack.getProgressPct(),
    renderModalHTML() {
      const arrow = `<span class="section-collapse-arrow${selfTrack.isCollapsed() ? ' collapsed' : ''}" data-upgrade-action="toggle-collapse" data-mechanic="${ID}" data-track="self">▾</span>`;
      return `<div class="bench-modal">` +
        `<div class="modal-subsection-label has-arrow"><span>Upgrades</span>${arrow}</div>${selfTrack.renderModalHTML(ID, {}, 'self')}` +
        `<div class="modal-subsection-label divider-top">Construction</div>${buildTrack.renderModalRows(ID, 'build')}` +
      `</div>`;
    },
    tick(goldAvailable, tickRate) {
      if (!revealed && window.OrbWeaver.Resources.get('wood') >= 8) {
        revealed = true;
        window.OrbWeaver.Cards.reveal(mechanic);
        window.OrbWeaver.Footer.push("Builder's Bench discovered!");
      }
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (selfTrack.isBuilding()) selfTrack.advanceTimer(tickRate, assigned, onSelfComplete, secondsPerWorker);
      if (buildTrack.isBuilding()) buildTrack.advanceTimer(tickRate, assigned);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
