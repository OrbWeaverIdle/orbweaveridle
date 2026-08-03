/* ============================================================
   MECHANIC: CAMPSITE (Camp)
   Not a resource — no left-hand row. One worker pool drives two
   things at once:

   1) Self-upgrade ladder (top bar, collapsible, same pattern as
      Bench/Market) — currently one placeholder tier, "Cabins",
      with invented numbers and a "TBD" effect. It does NOT affect
      tent speed (that's Tent Track's own fixed rate below) — if a
      future tier should, wire it the same way Bench/Market's
      onSelfComplete adjusts their own build-track rate.

   2) Tent Track (new pattern — not a core/upgrades.js track type,
      since nothing else needs "auto-repeat, cost/time escalating
      forever" yet; kept as local glue here per the mechanic-file
      rule. If a second mechanic ever needs this same shape, promote
      it into js/core/upgrades.js as a fourth track factory rather
      than duplicating it):
        - Starts automatically the moment ≥1 worker is assigned —
          no button, same instinct as Wood/Stone's auto-production.
        - Full tent cost is paid up front when a tent starts (no
          partial collection, mirrors Construction's up-front rule).
        - Can't afford the next tent → status 'stopped' (Wood/Stone-
          style); stopped workers here are exempt from gold upkeep
          via the generic mechanic.isBillable() hook.
        - Once started, the timer counts down at a 1s/s base pace
          plus TENT_SPW per assigned worker (assigned may drop to 0
          mid-build without canceling it — same as every other
          timer in this codebase).
        - Every completed tent: cost ×1.15, time ×1.05, +1 idle
          worker to the global pool.

   Stats block: a new vertically-stacked section below the upgrade
   ladder, patched every tick via patchLiveTrack() (same "patch,
   don't rebuild" rule as everything else with live modal content).
   Worker Locations groups by mechanic.section (see workers.js/
   every mechanic file) — today every mechanic hard-codes 'Camp',
   but the block itself is already generic per-section grouping.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'campsite';
  const TENT_RESOURCE = 'wood';
  const TENT_BASE_COST = 20;
  const TENT_COST_GROWTH = 1.66;
  const TENT_BASE_TIME = 3;
  const TENT_TIME_GROWTH = 1.33;
  const TENT_SPW = 2.0;

  // Placeholder-only self-upgrade tier. Numbers and effect are
  // invented and meant to be edited directly, same as every other
  // "TBD" tier in this project (see buildersbench.js).
  const SELF_TABLE = [
    { name: 'Cabins', gainPerWorker: 1, buildTime: 60, costRaw: '150 wood, 50 stone', desc: 'TBD' }
  ];

  let cardName = 'Campsite';
  let opened = false;
  let tentsBuilt = 0;
  let status = 'idle'; // idle | stopped | producing
  let timeRemaining = null;
  let currentTentTime = null; // total build time for the tent currently in progress

  const selfTrack = window.OrbWeaver.Upgrades.create(SELF_TABLE, (row) => row.desc || 'TBD', true);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:self`, selfTrack);

  function tentCost() { return TENT_BASE_COST * Math.pow(TENT_COST_GROWTH, tentsBuilt); }
  function tentTime() { return TENT_BASE_TIME * Math.pow(TENT_TIME_GROWTH, tentsBuilt); }

  function onSelfComplete(row) { cardName = row.name; }

  function tryStartTent() {
    const cost = tentCost();
    if (window.OrbWeaver.Resources.get(TENT_RESOURCE) >= cost) {
      window.OrbWeaver.Resources.spend(TENT_RESOURCE, cost);
      currentTentTime = tentTime();
      timeRemaining = currentTentTime;
      status = 'producing';
    } else {
      status = 'stopped';
    }
  }

  function completeTent() {
    tentsBuilt++;
    timeRemaining = null;
    currentTentTime = null;
    status = 'idle';
    window.OrbWeaver.Workers.addWorkers(1);
    window.OrbWeaver.Footer.push('A tent was built! +1 idle worker.');
  }

  function statsData() {
    const population = window.OrbWeaver.Workers.getTotal();
    const idle = window.OrbWeaver.Workers.getIdleCount();
    const assignedParts = [];
    const locationTotals = {};
    window.OrbWeaver.Mechanics.all().forEach((m) => {
      const a = window.OrbWeaver.Workers.getAssigned(m.id);
      if (a <= 0) return;
      assignedParts.push(`${a} ${m.cardName()}`);
      const sec = m.section || 'Camp';
      locationTotals[sec] = (locationTotals[sec] || 0) + a;
    });
    return {
      tents: String(tentsBuilt),
      population: String(population),
      idle: String(idle),
      assigned: assignedParts.length ? assignedParts.join(', ') : 'None',
      locations: Object.entries(locationTotals).map(([s, n]) => `${s}: ${n}`).join(', ') || 'Camp: 0',
      nextTent: `${Math.round(tentCost())} wood, ${tentTime().toFixed(1)}s`
    };
  }

  function renderStatsBlock() {
    const s = statsData();
    const row = (label, key) => `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-val" data-stat="${key}">${s[key]}</span></div>`;
    return `<div class="stats-block">` +
      row('Tents Built', 'tents') +
      row('Total Population', 'population') +
      row('Idle Workers', 'idle') +
      row('Workers Assigned', 'assigned') +
      row('Worker Locations', 'locations') +
      row('Next Tent', 'nextTent') +
    `</div>`;
  }

  function patchStatsBlock() {
    const s = statsData();
    Object.keys(s).forEach((key) => {
      const el = document.querySelector(`#card-modal-body [data-stat="${key}"]`);
      if (el) el.textContent = s[key];
    });
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Camp',
    upgradeTrackKey: 'self',
    cardName: () => cardName,
    onOpen() { opened = true; },
    isBillable: () => status !== 'stopped',
    getStatText() {
      if (!opened) return 'More Workers';
      const collecting = selfTrack.isCollecting();
      if (status === 'producing') {
        const base = `Building Tent – ${Math.round(tentCost())} wood, ${Math.max(0, timeRemaining).toFixed(1)}s remaining`;
        return collecting ? `${base} – Collecting` : base;
      }
      if (status === 'stopped') {
        const stopInfo = `Stopped – ${Math.round(tentCost())} wood, ${tentTime().toFixed(1)}s`;
        return collecting ? `${stopInfo} – Collecting` : stopInfo;
      }
      const nextInfo = `Next tent: ${Math.round(tentCost())} wood, ${tentTime().toFixed(1)}s`;
      return collecting ? `${nextInfo} – Collecting` : nextInfo;
    },
    getUpgradeBarPct: () => selfTrack.getBarPct(),
    isUpgradeCollecting: () => selfTrack.isCollecting(),
    getBuildBarPct() {
      if (status !== 'producing' || timeRemaining == null || !currentTentTime) return 0;
      return Math.min(100, ((currentTentTime - timeRemaining) / currentTentTime) * 100);
    },
    buildTrackKey: null,
    getWorkerDesc: () => {
      const a = window.OrbWeaver.Workers.getAssigned(ID);
      return a <= 1 ? `1 worker — tents 2s/s faster` : `${a} workers — tents ${(a * TENT_SPW).toFixed(0)}s/s faster`;
    },
    patchUpgradeCost: () => selfTrack.getResourceTracker(),
    patchBuildStatus: () => selfTrack.getBuildStatusText(),
    patchCollectPct: () => selfTrack.getCollectPct(),
    patchLiveTrack: () => patchStatsBlock(),
    renderModalHTML() {
      const arrow = `<span class="section-collapse-arrow${selfTrack.isCollapsed() ? ' collapsed' : ''}" data-upgrade-action="toggle-collapse" data-mechanic="${ID}" data-track="self">▾</span>`;
      return `<div class="campsite-modal">` +
        selfTrack.renderModalHTML(ID, {}, 'self', arrow) +
        `<div class="modal-subsection-label divider-top">Stats</div>` +
        renderStatsBlock() +
      `</div>`;
    },
    tick(goldAvailable, tickRate) {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (status !== 'producing' && assigned > 0) tryStartTent();
      else if (status !== 'producing' && assigned === 0) status = 'idle';

      if (status === 'producing') {
        timeRemaining -= tickRate + (assigned * TENT_SPW * tickRate);
        if (timeRemaining <= 0) completeTent();
      }

      if (selfTrack.isBuilding()) selfTrack.advanceTimer(tickRate, assigned, onSelfComplete);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
