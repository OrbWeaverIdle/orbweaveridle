/* ============================================================
   MECHANIC: MOUNTAINS (Expedition section)
   Multi-stage progression card. Workers drawn from Mountains idle
   pool. Three stages:
     1) Workers produce 1 wood-progress/s each → 200 needed
     2) Auto-drains Simple Tools (50) — stuck until resource exists
     3) Auto-drains Iron Tools (50)   — stuck until resource exists
   getMountainAssigned() bills assigned workers to gold upkeep.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'mountains';
  const STAGES = [
    { stage: 1, target: 200, resourceLabel: 'Wood', title: 'Setup to Explore the Mountains', desc: 'Assign explorers to extract 1 Wood/s each. Costs 1 Gold/s per working explorer.' },
    { stage: 2, target: 50,  resourceLabel: 'Simple Tools', title: 'An Ancient Cave Network', desc: 'An ancient cave network has caved in. 50 Simple Tools are needed to clear the collapse. They drain automatically from your stockpile.' },
    { stage: 3, target: 50,  resourceLabel: 'Iron Tools', title: 'Hard Rock', desc: 'Hard rock prevents you from digging further. 50 Iron Tools needed. They drain automatically from your stockpile.' }
  ];

  let stage = 1;
  let progress = [0, 0, 0]; // index 0 = stage 1 progress, etc.
  let assigned = 0;

  function getStageData() { return STAGES[stage - 1] || null; }
  function getStagePct() {
    const s = getStageData();
    if (!s) return 100;
    return Math.min(100, (progress[stage - 1] / s.target) * 100);
  }

  const mechanic = {
    id: ID,
    section: 'Mountains',
    cardName: () => 'Mountains',
    getMountainAssigned: () => assigned,
    getStatText() {
      const s = getStageData();
      if (!s) return 'Complete!';
      return `Stage ${stage}: ${Math.floor(progress[stage - 1])}/${s.target} ${s.resourceLabel}${assigned > 0 ? ` · ${assigned} explorer${assigned !== 1 ? 's' : ''}` : ''}`;
    },
    getUpgradeBarPct: () => getStagePct(),
    isUpgradeCollecting: () => false,
    getWorkerDesc: () => 'Explores at 1/s',
    renderModalHTML() {
      const s = getStageData();
      if (!s) return `<div class="mule-modal"><h3 class="mule-modal-title">Breakthrough!</h3><p class="mule-modal-desc">You break through the hard rock. More to come soon.</p></div>`;
      const pct = getStagePct().toFixed(1);
      return `<div class="mule-modal mountains-modal">
        <div class="mountains-stage-label">Stage ${stage} of ${STAGES.length}</div>
        <h3 class="mule-modal-title">${s.title}</h3>
        <p class="mule-modal-desc">${s.desc}</p>
        <div class="detail-progress-wrap mountains-progress"><div class="detail-progress-bar mountains-bar" style="width:${pct}%"></div></div>
        <div class="mule-modal-stat">${Math.floor(progress[stage - 1])} / ${s.target} ${s.resourceLabel}</div>
        <div class="mountains-worker-row">
          <button class="card-stepper-btn mountains-minus">–</button>
          <span>${assigned} explorer${assigned !== 1 ? 's' : ''}</span>
          <button class="card-stepper-btn mountains-plus">+</button>
        </div>
      </div>`;
    },
    patchLiveTrack() {
      const bar = document.querySelector('#card-modal-body .mountains-bar');
      if (bar) bar.style.width = getStagePct().toFixed(1) + '%';
      const stat = document.querySelector('#card-modal-body .mule-modal-stat');
      const s = getStageData();
      if (stat && s) stat.textContent = `${Math.floor(progress[stage - 1])} / ${s.target} ${s.resourceLabel}`;
      const workerSpan = document.querySelector('#card-modal-body .mountains-worker-row span');
      if (workerSpan) workerSpan.textContent = `${assigned} explorer${assigned !== 1 ? 's' : ''}`;
      const minusBtn = document.querySelector('#card-modal-body .mountains-minus');
      const plusBtn = document.querySelector('#card-modal-body .mountains-plus');
      if (minusBtn) minusBtn.disabled = assigned <= 0;
      if (plusBtn) plusBtn.disabled = window.OrbWeaver.Mountains.getIdle() <= 0;
    },
    onOpen() {
      setTimeout(() => {
        document.querySelector('#card-modal-body .mountains-plus')?.addEventListener('click', () => {
          if (window.OrbWeaver.Mountains.getIdle() <= 0) return;
          window.OrbWeaver.Mountains.takeIdle(1);
          assigned++;
          window.OrbWeaver.Cards.refresh(mechanic);
        });
        document.querySelector('#card-modal-body .mountains-minus')?.addEventListener('click', () => {
          if (assigned <= 0) return;
          assigned--;
          window.OrbWeaver.Mountains.addIdle(1);
          window.OrbWeaver.Cards.refresh(mechanic);
        });
      }, 0);
    },
    tick(goldAvailable, tickRate) {
      if (stage === 1 && assigned > 0 && progress[0] < 200) {
        progress[0] = Math.min(200, progress[0] + assigned * tickRate);
        if (progress[0] >= 200) {
          stage = 2;
          window.OrbWeaver.Footer.push('Mountains Stage 1 complete! An ancient cave network discovered.');
        }
      } else if (stage === 2) {
        const have = window.OrbWeaver.Resources.get('simpletools');
        if (have > 0 && progress[1] < 50) {
          const take = Math.min(have, 50 - progress[1]);
          window.OrbWeaver.Resources.spend('simpletools', take);
          progress[1] += take;
          if (progress[1] >= 50) { stage = 3; window.OrbWeaver.Footer.push('Cave cleared! Hard rock blocks the way.'); }
        }
      } else if (stage === 3) {
        const have = window.OrbWeaver.Resources.get('irontools');
        if (have > 0 && progress[2] < 50) {
          const take = Math.min(have, 50 - progress[2]);
          window.OrbWeaver.Resources.spend('irontools', take);
          progress[2] += take;
          if (progress[2] >= 50) { stage = 4; window.OrbWeaver.Footer.push('You break through! Mountains fully explored.'); }
        }
      }
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
