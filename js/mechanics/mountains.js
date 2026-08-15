/* ============================================================
   MECHANIC: MOUNTAINS (Section B, blue theme)
   Discovered once by Scout Stable's first Expedition Mule (see
   js/mechanics/scoutspen.js), which calls Mountains.reveal() and
   Mountains.addWorkers(n) directly. Mountains has its own resource
   pool (mtn_ prefix, never mixes with Camp's) and its own assignable
   worker pool (own idle/total, separate from Camp's) — riders who
   travel here join this pool, not Camp's.

   Workers assigned to the Mountains card can be sub-allocated to
   Hike the Lower Range and Prepare Stone Quarry via in-modal steppers.
   Sub-slot workers are drawn from the Mountains card's assigned count.
   If no free Mountains card workers exist, adding to a sub-slot will
   auto-promote one from the Mountain category pool (do nothing if
   category pool is also empty).

   Workers assigned here still drain Camp's shared Gold (see
   js/core/upkeep.js) — Gold is the one resource every location draws
   from together.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'mountains';
  const PREFIX = 'mtn_';
  const WOOD_ID = PREFIX + 'wood';
  const STONE_ID = PREFIX + 'stone';
  let discovered = false;
  let opened = false;
  let mtnMount = null;
  const pool = window.OrbWeaver.Workers.createPool(0, 'mountains');

  const OUTPOST_ITEMS = [
    { id: 'outpost', name: 'Outpost on the Frontier', desc: 'Building beneath the Mountain\'s Lower Range.', buildTime: 45, costRaw: `200 ${WOOD_ID}`, startAvailable: true }
  ];

  // Quarry build — gradual resource drain over 45s, stalls if resources run out
  const QUARRY_WOOD_COST = 500, QUARRY_STONE_COST = 100, QUARRY_BUILD_TIME = 45;
  let quarryPhase = 'idle'; // idle | building | done
  let quarryWoodDrained = 0, quarryStoneDrained = 0, quarryTimeRemaining = QUARRY_BUILD_TIME;
  let quarryStalled = false;
  let quarryWorkers = 0;

  // Hike the Lower Range — pure timer, workers only
  const HIKE_TIME = 120;
  let hikePhase = 'idle'; // idle | exploring | done
  let hikeProgress = 0; // seconds elapsed
  let hikeWorkers = 0;

  // Free workers on the Mountains card available for sub-slot assignment
  function freeCardWorkers() { return pool.getAssigned(ID) - hikeWorkers - quarryWorkers; }

  // Add a worker to a sub-slot. Promotes from category pool if card has none free.
  function subAssign(subSlot) {
    if (freeCardWorkers() <= 0) {
      if (!pool.assign(ID)) return; // category pool empty — do nothing
    }
    if (subSlot === 'hike') hikeWorkers++;
    else quarryWorkers++;
    window.OrbWeaver.Cards.refreshOpenModal(ID);
    window.OrbWeaver.Cards.refresh(mechanic);
  }

  // Remove a worker from a sub-slot, returning it to Mountains card free pool.
  function subUnassign(subSlot) {
    if (subSlot === 'hike' && hikeWorkers > 0) hikeWorkers--;
    else if (subSlot === 'quarry' && quarryWorkers > 0) quarryWorkers--;
    else return;
    window.OrbWeaver.Cards.refreshOpenModal(ID);
    window.OrbWeaver.Cards.refresh(mechanic);
  }

  function onStageComplete(id) {
    if (id === 'outpost') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('mtn_scoutstable'));
      quarryPhase = 'idle';
    }
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  const stageTrack = window.OrbWeaver.Upgrades.createChoiceTrack(OUTPOST_ITEMS, onStageComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:stage`, stageTrack);

  function ensureResource(baseId, name) {
    const id = PREFIX + baseId;
    window.OrbWeaver.Resources.ensure(id, { name, mount: mtnMount, current: 0, displayType: 'decimal', hidden: false });
    return id;
  }

  function initWorkersRow(mount) { mtnMount = mount; pool.init(mount); }

  // Renders a sub-slot stepper row for use inside the modal detail cards
  function stepperHtml(slot, count, label) {
    return `<div class="card-steppers visible" style="margin-top:4px">
      <button class="card-stepper-btn" data-mtn-sub="${slot}" data-mtn-sub-action="remove" ${count <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val">${count}</span>
      <button class="card-stepper-btn" data-mtn-sub="${slot}" data-mtn-sub-action="add">+</button>
      <span class="detail-card-desc" style="margin-left:4px">${label}</span>
    </div>`;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    buildTrackKey: 'quarry',
    getBuildBarTrackKey: () => (stageTrack.isBuilding() || stageTrack.getQueuedItem()) ? 'stage' : 'quarry',
    upgradeTrackKey: 'hike',
    workerPool: pool,
    cardName: () => 'Mountains',
    isBillable: () => stageTrack.isBuilding() || quarryPhase === 'building' || hikePhase === 'exploring',
    isBuildBarFaded: () => stageTrack.getQueuedItem() !== null && !stageTrack.isBuilding(),
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return '';
      // Stopped only when BOTH active sub-tasks have workers but neither is progressing
      const hikeStopped = hikeWorkers > 0 && hikePhase !== 'exploring' && hikePhase !== 'done';
      const quarryStopped = quarryWorkers > 0 && quarryPhase !== 'building' && quarryPhase !== 'done';
      if (hikeStopped && quarryStopped) return 'Stopped';
      if (stageTrack.isBuilding()) {
        const item = stageTrack.activeItem();
        const secs = Math.ceil(stageTrack.getRemaining());
        return pool.getAssigned(ID) === 0 ? `Stopped ${item.name} – ${secs}s` : `Building ${item.name} – ${secs}s`;
      }
      const queued = stageTrack.getQueuedItem();
      if (queued) return `Queued ${queued.name} – waiting`;
      const remaining = stageTrack.availableCount();
      if (remaining <= 0) return '';
      return pool.getAssigned(ID) > 0 ? `Stopped – ${remaining} to build` : `${remaining} to build`;
    },
    getUpgradeBarPct: () => hikePhase === 'done' ? 100 : Math.min(100, (hikeProgress / HIKE_TIME) * 100),
    getBuildBarPct() {
      if (stageTrack.isBuilding()) return stageTrack.getProgressPct();
      if (stageTrack.getQueuedItem()) return stageTrack.getQueueFillPct();
      if (quarryPhase === 'done') return 100;
      if (quarryPhase === 'building') {
        const woodPct = Math.min(100, (quarryWoodDrained / QUARRY_WOOD_COST) * 100);
        const stonePct = Math.min(100, (quarryStoneDrained / QUARRY_STONE_COST) * 100);
        return (woodPct + stonePct) / 2;
      }
      return 0;
    },
    getWorkerDesc: () => {
      const assigned = pool.getAssigned(ID);
      return assigned === 0 ? '' : `Builds ${window.OrbWeaver.Upgrades.formatRate(assigned * window.OrbWeaver.Upgrades.getBaseSPW())}s faster`;
    },
    hideUpgradeBar: () => hikePhase === 'done',
    hideBuildBar: () => quarryPhase === 'done' && !stageTrack.isBuilding() && !stageTrack.getQueuedItem(),
    patchLiveTrack() {
      stageTrack.patchModalRows();
      if (quarryPhase === 'building') {
        const secs = Math.ceil(quarryTimeRemaining);
        const headerTimer = document.querySelector('#card-modal-body [data-quarry-timer]');
        if (headerTimer) headerTimer.textContent = `${secs}s`;
        const statusEl = document.querySelector('#card-modal-body .detail-status span');
        if (statusEl) statusEl.textContent = quarryStalled ? 'Stopped – waiting for resources' : `Building — ${secs}s remaining`;
        const descEl = document.querySelector('#card-modal-body .quarry-desc');
        if (descEl) descEl.textContent = `Wood: ${quarryWoodDrained.toFixed(1)}/${QUARRY_WOOD_COST} | Stone: ${quarryStoneDrained.toFixed(1)}/${QUARRY_STONE_COST} | ${secs}s remaining`;
      }
      if (quarryPhase === 'idle') {
        const card = document.querySelector('#card-modal-body [data-quarry-card]');
        if (card) {
          const qw = window.OrbWeaver.Resources.get(WOOD_ID);
          const qs = window.OrbWeaver.Resources.get(STONE_ID);
          const affordable = qw >= QUARRY_WOOD_COST && qs >= QUARRY_STONE_COST;
          card.classList.toggle('hs-card-dim', !affordable);
          const costLbl = card.querySelector('.quarry-cost-label');
          if (costLbl) costLbl.textContent = `${Math.round(qw)}/${QUARRY_WOOD_COST} Wood, ${Math.round(qs)}/${QUARRY_STONE_COST} Stone – 45s`;
          const desc = card.querySelector('.upgrade-desc');
          if (desc) desc.classList.toggle('upgrade-desc-affordable', affordable);
          const btn = card.querySelector('[data-mtn-action="start-quarry"]');
          if (btn) btn.disabled = !affordable;
        }
      }
      if (hikePhase === 'exploring') {
        const hikeDescEl = document.querySelector('#card-modal-body .detail-status');
        if (hikeDescEl) hikeDescEl.textContent = `${Math.ceil(Math.max(0, HIKE_TIME - hikeProgress))}s`;
      }
    },
    renderModalHTML() {
      const outpostDone = stageTrack.availableCount() === 0 && !stageTrack.isBuilding();
      let postOutpost = '';
      if (outpostDone) {
        // Quarry section
        let quarrySection = '';
        if (quarryPhase === 'done') {
          quarrySection = '';
        } else if (quarryPhase === 'building') {
          const secs = Math.ceil(quarryTimeRemaining);
          const stallText = quarryStalled ? '<div class="detail-status"><span>Stopped – waiting for resources</span></div>' : '';
          quarrySection = `<div class="hs-card">
            <div class="hs-head"><span class="hs-title">Prepare Stone Quarry</span><span class="detail-status" data-quarry-timer>${secs}s</span></div>
            <div class="hs-body">
              ${stallText}
              <div class="detail-card-desc quarry-desc">Wood: ${quarryWoodDrained.toFixed(1)}/${QUARRY_WOOD_COST} | Stone: ${quarryStoneDrained.toFixed(1)}/${QUARRY_STONE_COST} | ${secs}s remaining</div>
              <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="quarry"></div></div>
              ${stepperHtml('quarry', quarryWorkers, 'workers')}
              <button class="action-btn" data-mtn-action="cancel-quarry">Cancel</button>
            </div></div>`;
        } else {
          const quarryWood = window.OrbWeaver.Resources.get(WOOD_ID);
          const quarryStone = window.OrbWeaver.Resources.get(STONE_ID);
          const quarryAffordable = quarryWood >= QUARRY_WOOD_COST && quarryStone >= QUARRY_STONE_COST;
          quarrySection = `<div class="hs-card${quarryAffordable ? '' : ' hs-card-dim'}" data-quarry-card>
            <div class="hs-head">
              <span class="hs-title">Prepare Stone Quarry</span>
              <span class="upgrade-costtime quarry-cost-label">${Math.round(quarryWood)}/${QUARRY_WOOD_COST} Wood, ${Math.round(quarryStone)}/${QUARRY_STONE_COST} Stone – 45s</span>
            </div>
            <div class="hs-body">
              <div class="hs-desc-build-row">
                <span class="upgrade-desc${quarryAffordable ? ' upgrade-desc-affordable' : ''}">A Quarry provides more stone than a Pit.</span>
                <button class="action-btn hs-btn-right" data-mtn-action="start-quarry" ${quarryAffordable ? '' : 'disabled'}>Build</button>
              </div>
            </div></div>`;
        }

        // Hike section
        let hikeSection = '';
        if (hikePhase === 'done') {
          hikeSection = `<div class="bare-section">
            <div class="bare-row"><span class="bare-label">Hike the Lower Range</span></div>
            <div class="detail-card-desc">TBD</div>
          </div>`;
        } else {
          const hikeRemaining = Math.ceil(Math.max(0, HIKE_TIME - hikeProgress));
          hikeSection = `<div class="bare-section">
            <div class="bare-row">
              <span class="bare-label">Hike the Lower Range</span>
              <span class="detail-status">${hikePhase === 'exploring' ? `${hikeRemaining}s` : ''}</span>
            </div>
            <div class="detail-card-desc">A winding river path into the Mountains.</div>
            <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="hike"></div></div>
            ${stepperHtml('hike', hikeWorkers, 'workers')}
          </div>`;
        }

        postOutpost = `
          <div class="bench-modal-divider"></div>
          ${hikeSection}
          ${quarrySection ? `<div class="bench-modal-divider"></div>${quarrySection}` : ''}`;
      }
      return `<div class="bench-modal">${stageTrack.renderModalRows(ID, 'stage')}${postOutpost}</div>`;
    },
    tick(goldAvailable, tickRate) {
      const assigned = pool.getAssigned(ID);
      const spw = window.OrbWeaver.Upgrades.getBaseSPW();

      const queued = stageTrack.getQueuedItem();
      const freeWorkers = freeCardWorkers();
      if (queued && freeWorkers > 0) {
        stageTrack.start(queued.id);
        if (stageTrack.isBuilding()) stageTrack.dequeue();
      }
      if (stageTrack.isBuilding() && freeWorkers > 0) stageTrack.advanceTimer(tickRate, freeWorkers, spw);

      // Quarry gradual build
      if (quarryPhase === 'building' && quarryWorkers > 0) {
        const woodNeeded = QUARRY_WOOD_COST - quarryWoodDrained;
        const stoneNeeded = QUARRY_STONE_COST - quarryStoneDrained;
        const woodAvail = window.OrbWeaver.Resources.get(WOOD_ID);
        const stoneAvail = window.OrbWeaver.Resources.get(STONE_ID);
        quarryStalled = (woodNeeded > 0 && woodAvail <= 0) || (stoneNeeded > 0 && stoneAvail <= 0);
        if (!quarryStalled) {
          const rate = tickRate / QUARRY_BUILD_TIME;
          const woodTick = Math.min(woodNeeded, QUARRY_WOOD_COST * rate);
          const stoneTick = Math.min(stoneNeeded, QUARRY_STONE_COST * rate);
          quarryWoodDrained += window.OrbWeaver.Resources.spend(WOOD_ID, woodTick);
          quarryStoneDrained += window.OrbWeaver.Resources.spend(STONE_ID, stoneTick);
          quarryTimeRemaining -= tickRate + (quarryWorkers * spw * tickRate);
          if (quarryWoodDrained >= QUARRY_WOOD_COST && quarryStoneDrained >= QUARRY_STONE_COST || quarryTimeRemaining <= 0) {
            quarryPhase = 'done';
            quarryTimeRemaining = 0;
            window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('quarry'));
            window.OrbWeaver.Footer.push('Stone Quarry established.');
            window.OrbWeaver.Cards.refreshOpenModal(ID);
          }
        }
      }

      // Hike — pure timer, workers only
      if (hikePhase !== 'done' && hikeWorkers > 0) {
        hikePhase = 'exploring';
        hikeProgress += tickRate + (hikeWorkers * spw * tickRate);
        if (hikeProgress >= HIKE_TIME) {
          hikeProgress = HIKE_TIME;
          hikePhase = 'done';
          window.OrbWeaver.Footer.push("You've hiked the Lower Range.");
          window.OrbWeaver.Cards.refreshOpenModal(ID);
        }
      } else if (hikePhase === 'exploring' && hikeWorkers === 0) {
        hikePhase = 'idle';
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  function reveal() {
    if (discovered) return;
    discovered = true;
    document.getElementById('mountains-section').style.display = '';
    document.getElementById('left-hand-mountains-group').style.display = '';
    document.getElementById('camp-section-label').style.display = '';
    window.OrbWeaver.Resources.reveal(WOOD_ID);
    window.OrbWeaver.Resources.reveal(STONE_ID);
    window.OrbWeaver.Cards.reveal(mechanic);
  }

  /* ---- Save/load ----
     The Outpost stage track saves itself. What lives here is the two
     hand-rolled sub-tasks and their sub-slot worker counts, which are a
     SUBSET of the workers already assigned to the Mountains card — the
     pool records the assignment, these record how it is divided, and
     both must come back or the split silently drifts. Quarry's drained
     totals are real spent resources and are preserved exactly, so a
     cancel after loading still refunds the right amount. */
  window.OrbWeaver.Save.register(ID,
    () => ({
      d: discovered ? 1 : 0, o: opened ? 1 : 0,
      qp: quarryPhase, qw: quarryWoodDrained, qs: quarryStoneDrained,
      qt: quarryTimeRemaining, qn: quarryWorkers,
      hp: hikePhase, hg: hikeProgress, hn: hikeWorkers
    }),
    (d) => {
      opened = !!d.o;
      quarryPhase = d.qp || 'idle';
      quarryWoodDrained = d.qw || 0;
      quarryStoneDrained = d.qs || 0;
      quarryTimeRemaining = d.qt != null ? d.qt : QUARRY_BUILD_TIME;
      quarryWorkers = d.qn || 0;
      hikePhase = d.hp || 'idle';
      hikeProgress = d.hg || 0;
      hikeWorkers = d.hn || 0;
      if (d.d) reveal();
    });

  window.OrbWeaver.Mechanics.register(mechanic);

  document.addEventListener('click', (e) => {
    // Sub-slot stepper buttons
    const subBtn = e.target.closest('[data-mtn-sub]');
    if (subBtn) {
      const slot = subBtn.dataset.mtnSub;
      const action = subBtn.dataset.mtnSubAction;
      if (action === 'add') subAssign(slot);
      else if (action === 'remove') subUnassign(slot);
      return;
    }
    const btn = e.target.closest('[data-mtn-action]');
    if (!btn) return;
    if (btn.dataset.mtnAction === 'start-quarry' && quarryPhase === 'idle') {
      quarryPhase = 'building';
      quarryWoodDrained = 0; quarryStoneDrained = 0;
      quarryTimeRemaining = QUARRY_BUILD_TIME; quarryStalled = false;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'cancel-quarry' && quarryPhase === 'building') {
      window.OrbWeaver.Resources.add(WOOD_ID, quarryWoodDrained);
      window.OrbWeaver.Resources.add(STONE_ID, quarryStoneDrained);
      quarryPhase = 'idle';
      quarryWoodDrained = 0; quarryStoneDrained = 0;
      quarryTimeRemaining = QUARRY_BUILD_TIME; quarryStalled = false;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    }
  });

  window.OrbWeaver.Mountains = {
    id: ID, label: 'Mountains', prefix: PREFIX, woodId: WOOD_ID, stoneId: STONE_ID, workerPool: pool,
    initWorkersRow, addWorkers: (n) => pool.addWorkers(n), ensureResource, reveal, isDiscovered: () => discovered
  };
  window.OrbWeaver.Locations.register(window.OrbWeaver.Mountains);
})();
