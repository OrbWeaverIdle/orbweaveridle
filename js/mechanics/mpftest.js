/* ============================================================
   MECHANIC: MPF TEST (Camp, debug only)
   Cheat-only card (startHidden, revealed by the "Test Card" cheat
   button — see js/core/cheats.js). Flat, non-escalating version of
   Tents' single-timer pattern: costs 1000 wood + 1000 stone, 10 min
   build, does nothing on completion, then is free to start again —
   exists to show the live worker-rate line move as m/p/f change. Its
   modal has its own +M/+P/+F buttons (local to this card only) plus
   the global M/P/F cheat buttons (js/core/cheats.js) both feed the
   same workerRate() formula, so the Current Rate line reflects both.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'mpftest';
  const COST = { wood: 1000, stone: 1000 };
  const BUILD_TIME = 600; // 10 min

  // Local m/p/f — starts at baseline, but this card's own +M/+P/+F
  // modal buttons (below) stack 0.1 onto these directly, independent
  // of the global cheat layer. workerRate() combines both automatically.
  let m = 1, p = 1, f = 0;

  let status = 'idle'; // idle | stopped | producing
  let timeRemaining = null;
  let goldStarved = false;

  function canAfford() {
    return Object.keys(COST).every((id) => window.OrbWeaver.Resources.get(id) >= COST[id]);
  }

  function tryStart() {
    if (canAfford()) {
      Object.keys(COST).forEach((id) => window.OrbWeaver.Resources.spend(id, COST[id]));
      timeRemaining = BUILD_TIME;
      status = 'producing';
    } else {
      status = 'stopped';
    }
  }

  function complete() {
    timeRemaining = null;
    status = 'idle';
    window.OrbWeaver.Footer.push('MPF Test complete.');
  }

  function statsData() {
    const g = window.OrbWeaver.Upgrades.getGlobalMods();
    const assigned = window.OrbWeaver.Workers.getAssigned(ID);
    return {
      local: `m=${m.toFixed(2)} p=${p.toFixed(2)} f=${f.toFixed(2)}`,
      global: `m=${g.m.toFixed(2)} p=${g.p.toFixed(2)} f=${g.f.toFixed(2)}`,
      rate: assigned === 0 ? '0.00/s (no workers)' : `${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f))}/s (${assigned} worker${assigned === 1 ? '' : 's'})`
    };
  }

  function renderStatsBlock() {
    const s = statsData();
    const row = (label, key) => `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-val" data-stat="${key}">${s[key]}</span></div>`;
    return `<div class="stats-block">` +
      row('Local m/p/f', 'local') +
      row('Global m/p/f', 'global') +
      row('Current Rate', 'rate') +
    `</div>` +
    `<div class="mpf-local-btns">
      <button class="action-btn" data-mpf-action="bump-local-m">+M</button>
      <button class="action-btn" data-mpf-action="bump-local-p">+P</button>
      <button class="action-btn" data-mpf-action="bump-local-f">+F</button>
    </div>`;
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
    cardName: () => 'MPF Test',
    isBillable: () => status !== 'stopped',
    getStatText() {
      if (status === 'producing') return goldStarved ? 'Stopped – testing' : `Testing – ${Math.max(0, timeRemaining).toFixed(1)}s remaining`;
      if (status === 'stopped') return `Stopped – ${COST.wood} wood, ${COST.stone} stone, ${BUILD_TIME}s`;
      if (goldStarved && window.OrbWeaver.Workers.getAssigned(ID) > 0) return 'Stopped';
      return `Next – ${COST.wood} wood, ${COST.stone} stone, ${BUILD_TIME}s`;
    },
    getUpgradeBarPct: () => 0,
    isBuildBarFaded: () => status === 'stopped',
    getBuildBarPct() {
      if (status === 'producing' && timeRemaining != null) return Math.min(100, ((BUILD_TIME - timeRemaining) / BUILD_TIME) * 100);
      if (status === 'stopped') {
        const pct = Math.min(
          window.OrbWeaver.Resources.get('wood') / COST.wood,
          window.OrbWeaver.Resources.get('stone') / COST.stone
        );
        return Math.min(100, pct * 100);
      }
      return 0;
    },
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Testing ${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f))}/s`;
    },
    patchLiveTrack: () => patchStatsBlock(),
    renderModalHTML() {
      return `<div class="mpftest-modal"><div class="modal-subsection-label">Stats</div>${renderStatsBlock()}</div>`;
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);

      if (status !== 'producing' && assigned > 0 && goldAvailable) tryStart();
      else if (status !== 'producing' && assigned === 0) status = 'idle';

      if (status === 'producing' && goldAvailable) {
        timeRemaining -= window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f) * tickRate;
        if (timeRemaining <= 0) complete();
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  // Save the seed only: status + remaining time + the stacked local
  // m/p/f deltas (baseline 1/1/0, so a fresh save needs nothing extra).
  window.OrbWeaver.Save.register(ID,
    () => ({ st: status, t: timeRemaining, m, p, f }),
    (d) => {
      status = d.st || 'idle';
      timeRemaining = d.t != null ? d.t : null;
      m = d.m != null ? d.m : 1;
      p = d.p != null ? d.p : 1;
      f = d.f != null ? d.f : 0;
    });

  window.OrbWeaver.Mechanics.register(mechanic);

  // Local M/P/F buttons live only in this card's own modal — same
  // stacking rule as the global cheat buttons (+0.1 per click), but
  // scoped to this card's own m/p/f rather than every card's rate.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mpf-action]');
    if (!btn) return;
    if (btn.dataset.mpfAction === 'bump-local-m') m += 0.1;
    else if (btn.dataset.mpfAction === 'bump-local-p') p += 0.1;
    else if (btn.dataset.mpfAction === 'bump-local-f') f += 0.1;
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  });
})();
