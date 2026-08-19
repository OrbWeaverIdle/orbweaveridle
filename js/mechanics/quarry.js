/* ============================================================
   MECHANIC: QUARRY (Mountains)
   Resource card producing mtn_stone. Mirrors stone.js but with
   doubled worker contribution, upgrade costs, and rewards.
   Starts hidden — revealed when Mountains completes Prepare Stone Quarry.
   Uses Mountains' own worker pool (mtn_ prefix throughout).

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

  const ID = 'quarry';
  const RES = 'mtn_stone';
  const pool = window.OrbWeaver.Mountains.workerPool;

  const UPGRADE_TABLE = [
    { name: 'TBD1', gainPerWorker: 4.52,  buildTime: 120, costRaw: '900 mtn_stone',                newCap: 1200  },
    { name: 'TBD2', gainPerWorker: 6.78,  buildTime: 240, costRaw: '1200 mtn_stone, 100 mtn_wood', newCap: 1400  },
  ];

  let cardName = 'Quarry';
  let gainPerWorker = 2.26;
  let status = 'idle';

  // Local p/f only — no local m (gainPerWorker already plays that role
  // and is owned by the ladder, which this doesn't touch).
  let p = 1, f = 0;
  function rate(assigned) { return window.OrbWeaver.Upgrades.workerRate(assigned, gainPerWorker, p, f); }

  const track = window.OrbWeaver.Upgrades.create(UPGRADE_TABLE);
  window.OrbWeaver.Upgrades.registerTrack(ID, track);

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    workerPool: pool,
    cardName: () => cardName,
    getStatText() {
      const assigned = pool.getAssigned(ID);
      const collecting = track.isCollecting();
      if (assigned === 0) return collecting ? 'Collecting' : '';
      if (status === 'stopped') return collecting ? 'Stopped – Collecting' : 'Stopped';
      return `${window.OrbWeaver.Upgrades.formatRate(rate(assigned))}/s${collecting ? ' – Collecting' : ''}`;
    },
    getUpgradeBarPct: () => track.getBarPct(),
    isUpgradeCollecting: () => track.isCollecting(),
    getWorkerDesc: () => {
      const assigned = pool.getAssigned(ID);
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
      track.skipAll((row) => { cardName = row.name; gainPerWorker = row.gainPerWorker; window.OrbWeaver.Resources.setCap(RES, row.newCap); });
    },
    renderModalHTML: () => track.renderModalHTML(ID, { cap: window.OrbWeaver.Resources.getCap(RES), rate: gainPerWorker }),
    tick(goldAvailable, tickRate) {
      const assigned = pool.getAssigned(ID);
      const atCap = window.OrbWeaver.Resources.isAtCap(RES);
      if (assigned === 0) {
        status = 'idle';
        window.OrbWeaver.Resources.setSubRate(RES, null);
      } else if (!goldAvailable || atCap) {
        status = 'stopped';
        window.OrbWeaver.Resources.setSubRate(RES, atCap ? `+${window.OrbWeaver.Upgrades.formatRate(rate(assigned))}/s` : null);
      } else {
        status = 'producing';
        const perSec = rate(assigned);
        window.OrbWeaver.Resources.add(RES, perSec * tickRate);
        window.OrbWeaver.Resources.setSubRate(RES, `+${window.OrbWeaver.Upgrades.formatRate(perSec)}/s`);
      }
      if (track.isBuilding()) {
        track.advanceTimer(tickRate, assigned, (row) => {
          cardName = row.name;
          gainPerWorker = row.gainPerWorker;
          window.OrbWeaver.Resources.setCap(RES, row.newCap);
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
      window.OrbWeaver.Resources.setCap(RES, row.newCap);
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
