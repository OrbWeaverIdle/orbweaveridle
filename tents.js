/* ============================================================
   MECHANIC: TENTS (Camp) — formerly Campsite
   Not a resource — no left-hand row. One worker pool drives the Tent
   Track (bottom bar):
     - Starts automatically the moment ≥1 worker is assigned — no
       button, same instinct as Wood/Stone's auto-production.
     - Full tent cost is paid up front when a tent starts (no partial
       collection, mirrors Construction's up-front rule).
     - Can't afford the next tent → status 'stopped' (Wood/Stone-style);
       stopped workers here are exempt from gold upkeep via the generic
       mechanic.isBillable() hook.
     - Once started, the timer counts down at a 1s/s base pace plus the
       shared base rate per assigned worker (assigned may drop to 0
       mid-build without canceling it — same as every other timer in
       this codebase).
     - Every completed tent: cost ×1.15, time ×1.05, +1 idle worker to
       the global pool.

   This stays its own bespoke pattern rather than sharing Academy's new
   Upgrades.createConversionTrack() factory — Tents is single-resource,
   auto-repeating, escalating, and needs zero player interaction, while
   Academy's conversion needs multiple recipes, player-picked, flat
   cost, with real modal interaction. Different enough shapes that
   forcing them together would either bloat Tents with UI it doesn't
   need or under-serve Academy.

   Card name is static ("Tents") — no self-upgrade ladder renames it
   anymore. The top bar is a reserved-but-unused stub
   (getUpgradeBarPct: () => 0), same convention as every other card
   that doesn't use it.

   Stats block: a vertically-stacked section, patched every tick via
   patchLiveTrack() (same "patch, don't rebuild" rule as everything
   else with live modal content). Worker Locations groups by
   mechanic.section (see workers.js/every mechanic file) — today every
   mechanic hard-codes 'Camp', but the block itself is already generic
   per-section grouping.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'tents';
  const TENT_RESOURCE = 'wood';
  const TENT_BASE_COST = 20;
  const TENT_COST_GROWTH = 1.66;
  const TENT_BASE_TIME = 3;
  const TENT_TIME_GROWTH = 1.33;

  // Worker contribution formula (see js/core/upgrades.js workerRate()).
  // Local to this card — a future tool changes only these three.
  let m = 1, p = 1, f = 0;

  let tentsBuilt = 0;
  let status = 'idle'; // idle | stopped | producing
  let timeRemaining = null;
  let currentTentTime = null; // total build time for the tent currently in progress
  let goldStarved = false;

  function tentCost() { return TENT_BASE_COST * Math.pow(TENT_COST_GROWTH, tentsBuilt); }
  function tentTime() { return TENT_BASE_TIME * Math.pow(TENT_TIME_GROWTH, tentsBuilt); }

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
    window.OrbWeaver.Footer.push('Tent built. +1 idle worker.');
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
    cardName: () => 'Tents',
    isBillable: () => status !== 'stopped',
    getStatText() {
      if (status === 'producing') return goldStarved ? `Stopped – pitching tent` : `Pitching Tent – ${Math.round(tentCost())} wood, ${Math.max(0, timeRemaining).toFixed(1)}s remaining`;
      if (status === 'stopped') return `Stopped – ${Math.round(tentCost())} wood, ${tentTime().toFixed(1)}s`;
      if (goldStarved && window.OrbWeaver.Workers.getAssigned(ID) > 0) return 'Stopped';
      return `Next – ${Math.round(tentCost())} wood, ${tentTime().toFixed(1)}s`;
    },
    getUpgradeBarPct: () => 0,
    isBuildBarFaded: () => status === 'stopped',
    getBuildBarPct() {
      if (status === 'producing' && timeRemaining != null && currentTentTime)
        return Math.min(100, ((currentTentTime - timeRemaining) / currentTentTime) * 100);
      if (status === 'stopped') {
        const wood = window.OrbWeaver.Resources.get(TENT_RESOURCE);
        return Math.min(100, (wood / tentCost()) * 100);
      }
      return 0;
    },
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Pitching ${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f))}/s`;
    },
    patchLiveTrack: () => patchStatsBlock(),
    renderModalHTML() {
      return `<div class="tents-modal"><div class="modal-subsection-label">Stats</div>${renderStatsBlock()}</div>`;
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);

      if (status === 'producing' && assigned === 0) {
        window.OrbWeaver.Resources.add(TENT_RESOURCE, Math.round(tentCost()));
        status = 'idle'; timeRemaining = null; currentTentTime = null;
      } else if (status !== 'producing' && assigned > 0 && goldAvailable) tryStartTent();
      else if (status !== 'producing' && assigned === 0) status = 'idle';

      if (status === 'producing' && goldAvailable) {
        timeRemaining -= window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f) * tickRate;
        if (timeRemaining <= 0) completeTent();
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ----
     tentsBuilt is the seed: the next tent's cost and time are always
     recomputed from it, so rebalancing the growth curve later reaches
     existing saves. The in-progress tent's timer is preserved as-is. */
  window.OrbWeaver.Save.register(ID,
    () => ({ n: tentsBuilt, st: status, t: timeRemaining, ct: currentTentTime }),
    (d) => {
      tentsBuilt = d.n || 0;
      status = d.st || 'idle';
      timeRemaining = d.t != null ? d.t : null;
      currentTentTime = d.ct != null ? d.ct : null;
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
