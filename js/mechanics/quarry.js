/* ============================================================
   MECHANIC: QUARRY (Mountains)
   Resource card producing mtn_stone. Mirrors stone.js but with
   doubled worker contribution, upgrade costs, and rewards.
   Starts hidden — revealed when Mountains completes Prepare Stone Quarry.
   Uses Mountains' own worker pool (mtn_ prefix throughout).
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
      return `${(assigned * gainPerWorker).toFixed(2)}/s${collecting ? ' – Collecting' : ''}`;
    },
    getUpgradeBarPct: () => track.getBarPct(),
    isUpgradeCollecting: () => track.isCollecting(),
    getWorkerDesc: () => {
      const assigned = pool.getAssigned(ID);
      return assigned === 0 ? '' : `Chisels ${window.OrbWeaver.Upgrades.formatRate(assigned * gainPerWorker)} stone`;
    },
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
        window.OrbWeaver.Resources.setSubRate(RES, atCap ? `+${(assigned * gainPerWorker).toFixed(2)}/s` : null);
      } else {
        status = 'producing';
        const perSec = assigned * gainPerWorker;
        window.OrbWeaver.Resources.add(RES, perSec * tickRate);
        window.OrbWeaver.Resources.setSubRate(RES, `+${perSec.toFixed(2)}/s`);
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
     Nothing of this card's own is stored. cardName, gainPerWorker and
     the resource cap are all DERIVED from how far up the ladder the
     player is, so the track's index (saved by the track itself) is the
     entire state. Replaying the table on load means editing these
     numbers later reaches existing saves instead of stranding players
     on whatever values they last played with. */
  window.OrbWeaver.Save.register(ID, null, () => {
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
