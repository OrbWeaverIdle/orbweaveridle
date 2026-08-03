/* ============================================================
   MECHANIC: SCOUT'S PEN (Camp)
   Two independent mule operations:

   EXPLORE: Workers consume 200 wood (1/s each). When ready,
   Explore button spawns Mule for Exploration card (green).
   Assign workers → Disembark → 30s → Mountains revealed.

   RESUPPLY (Mountains must be revealed first): Slider lets player
   choose up to 200 total resources (wood + stone). Resources spent
   immediately on Resupply click → Resupply Mule card spawned.
   Assign workers → Disembark → 30s → resources arrive at Mountains,
   workers transfer to Mountains idle, Return Mule spawned if none.

   SCOUT'S LODGE upgrade (20 wood, 8s) → Auto-Mule toggle.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'scoutspen';
  const EXPLORE_WOOD_NEED = 200;
  const RESUPPLY_TOTAL    = 200;
  const MULE_TRIP_TIME    = 30;
  const RETURN_TRIP_TIME  = 15;

  // ── Mountains idle pool ───────────────────────────────────────
  let mountainsIdle = 0;
  function getMountainsIdle() { return mountainsIdle; }
  function addMountainsIdle(n) { mountainsIdle += n; renderMountainsLeft(); }
  function takeMountainsIdle(n) {
    const took = Math.min(n, mountainsIdle);
    mountainsIdle -= took;
    renderMountainsLeft();
    return took;
  }

  // Expedition resource pools (fed by Resupply mules)
  let expWood = 0, expStone = 0;
  function addExpWood(n)  { expWood  += n; renderMountainsLeft(); }
  function addExpStone(n) { expStone += n; renderMountainsLeft(); }

  // ── Left-hand Mountains section ──────────────────────────────
  let leftMountainsMount = null;
  let leftIdleEl = null, leftExpWoodEl = null, leftExpStoneEl = null;
  let leftIronWrap = null;

  function buildLeftMountains() {
    const mount = document.getElementById('left-hand-mountains');
    if (!mount || leftMountainsMount) return;
    leftMountainsMount = mount;

    const label = document.createElement('div');
    label.className = 'side-label mountains-label';
    label.textContent = 'Mountains';

    function makeRow(name, id) {
      const row = document.createElement('div');
      row.className = 'resource-row';
      row.innerHTML = `<span class="res-name">${name}</span><span class="res-val" id="${id}">0</span>`;
      return row;
    }

    const idleRow  = makeRow('Idle',       'left-mtn-idle');
    const woodRow  = makeRow('Exp. Wood',  'left-exp-wood');
    const stoneRow = makeRow('Exp. Stone', 'left-exp-stone');

    leftIdleEl      = idleRow.querySelector('.res-val');
    leftExpWoodEl   = woodRow.querySelector('.res-val');
    leftExpStoneEl  = stoneRow.querySelector('.res-val');

    leftIronWrap = document.createElement('div');
    leftIronWrap.style.display = 'none';
    leftIronWrap.innerHTML = `
      <div class="resource-row"><span class="res-name">Iron</span><span class="res-val" id="left-iron-val">0/0</span></div>
      <div class="res-sub-rate" id="left-iron-rate" style="display:none"></div>`;

    mount.appendChild(label);
    mount.appendChild(idleRow);
    mount.appendChild(woodRow);
    mount.appendChild(stoneRow);
    mount.appendChild(leftIronWrap);
  }

  function renderMountainsLeft() {
    if (leftIdleEl)     leftIdleEl.textContent     = mountainsIdle;
    if (leftExpWoodEl)  leftExpWoodEl.textContent  = Math.floor(expWood);
    if (leftExpStoneEl) leftExpStoneEl.textContent = Math.floor(expStone);
  }
  function revealIronLeft() { if (leftIronWrap) leftIronWrap.style.display = ''; }

  // ── Right-hand Mountains section ─────────────────────────────
  let mountainsSectionBuilt = false;

  function buildMountainsSection(arrivedWorkers) {
    if (mountainsSectionBuilt) return;
    mountainsSectionBuilt = true;
    buildLeftMountains();
    mountainsIdle = arrivedWorkers;
    renderMountainsLeft();

    const mount = document.getElementById('right-hand-mountains');
    const label = document.createElement('div');
    label.className = 'section-label mountains-section-label';
    label.innerHTML = 'Mountains <span class="section-collapse-arrow">▾</span>';
    const grid = document.createElement('div');
    grid.className = 'card-grid mountains-card-grid';
    grid.id = 'grid-mountains';
    mount.appendChild(label);
    mount.appendChild(grid);
    if (window.OrbWeaver.setupSectionCollapse) window.OrbWeaver.setupSectionCollapse(label);

    const mb = window.OrbWeaver.Mechanics.get('mountainsbench');
    if (mb) grid.appendChild(window.OrbWeaver.Cards.build(mb));
    const mt = window.OrbWeaver.Mechanics.get('mountains');
    if (mt) grid.appendChild(window.OrbWeaver.Cards.build(mt));

    spawnReturnMule();
    window.OrbWeaver.Footer.push('Mountains discovered! Explorers have arrived.');
  }

  // ── Shared mule card DOM builder ──────────────────────────────
  function buildMuleCardDOM(name, extraClass, prefix, parentEl, onPlus, onMinus, onCardClick) {
    const wrap = document.createElement('div');
    wrap.className = `card-wrap mule-card ${extraClass}`;
    const card = document.createElement('div');
    card.className = 'card mule-inner-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="card-body">
        <div class="card-name mule-card-name">${name}</div>
        <div class="card-stat mule-card-stat"></div>
      </div>
      <div class="card-steppers visible">
        <button class="card-stepper-btn ${prefix}-minus">–</button>
        <span class="card-stepper-val ${prefix}-val">0</span>
        <button class="card-stepper-btn ${prefix}-plus">+</button>
      </div>
      <div class="card-progress-bar mule-travel-bar"></div>`;
    wrap.appendChild(card);
    parentEl.appendChild(wrap);
    card.querySelector(`.${prefix}-plus`).addEventListener('pointerdown', onPlus);
    card.querySelector(`.${prefix}-minus`).addEventListener('pointerdown', onMinus);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-steppers')) return;
      if (window.OrbWeaver.Cards.isGhostClick && window.OrbWeaver.Cards.isGhostClick()) return;
      onCardClick();
    });
    return wrap;
  }

  function openMuleModal(title, html) {
    document.getElementById('card-modal-win')?.classList.add('mule-modal-win');
    window.OrbWeaver.openCardModal(title, html, null, '');
  }

  // ── Return Mule ───────────────────────────────────────────────
  let returnMuleWrap = null, returnMuleWorkers = 0, returnMuleTimer = null;

  function spawnReturnMule() {
    if (returnMuleWrap) return;
    const grid = document.getElementById('grid-mountains');
    if (!grid) return;
    returnMuleWorkers = 0; returnMuleTimer = null;
    returnMuleWrap = buildMuleCardDOM('Return Mule', 'return-mule-card', 'rm', grid,
      () => { if (returnMuleTimer !== null || mountainsIdle <= 0) return; takeMountainsIdle(1); returnMuleWorkers++; refreshReturnMule(); },
      () => { if (returnMuleTimer !== null || returnMuleWorkers <= 0) return; returnMuleWorkers--; addMountainsIdle(1); refreshReturnMule(); },
      openReturnMuleModal);
    refreshReturnMule();
  }

  function refreshReturnMule() {
    if (!returnMuleWrap) return;
    const t = returnMuleTimer;
    returnMuleWrap.querySelector('.mule-card-stat').textContent = t !== null ? `Returning – ${Math.ceil(t)}s` : `${returnMuleWorkers} worker${returnMuleWorkers !== 1 ? 's' : ''}`;
    returnMuleWrap.querySelector('.rm-val').textContent   = returnMuleWorkers;
    returnMuleWrap.querySelector('.rm-plus').disabled     = t !== null || mountainsIdle <= 0;
    returnMuleWrap.querySelector('.rm-minus').disabled    = t !== null || returnMuleWorkers <= 0;
    returnMuleWrap.querySelector('.mule-travel-bar').style.width = t !== null ? ((RETURN_TRIP_TIME - t) / RETURN_TRIP_TIME * 100) + '%' : '0%';
  }

  function openReturnMuleModal() {
    const d = returnMuleWorkers < 1 || returnMuleTimer !== null;
    openMuleModal('Return Mule', `<div class="mule-modal">
      <p class="mule-modal-desc">Send workers back to Camp. Workers return to the global idle pool on arrival.</p>
      <p class="mule-modal-stat">${returnMuleWorkers} worker${returnMuleWorkers !== 1 ? 's' : ''} assigned</p>
      <button class="action-btn mule-action-btn" id="return-disembark-btn" ${d ? 'disabled' : ''}>Disembark</button>
    </div>`);
    document.getElementById('return-disembark-btn')?.addEventListener('click', () => {
      if (returnMuleWorkers < 1 || returnMuleTimer !== null) return;
      returnMuleTimer = RETURN_TRIP_TIME;
      window.OrbWeaver.Cards.closeModal();
      window.OrbWeaver.Footer.push('Return Mule disembarked — 15s journey.');
    });
  }

  function tickReturnMule(tickRate) {
    if (returnMuleTimer === null) return;
    returnMuleTimer -= tickRate;
    if (returnMuleTimer <= 0) {
      returnMuleTimer = null;
      const n = returnMuleWorkers; returnMuleWorkers = 0;
      window.OrbWeaver.Workers.addWorkers(n);
      if (returnMuleWrap) { returnMuleWrap.remove(); returnMuleWrap = null; }
      window.OrbWeaver.Footer.push(`Return Mule arrived — ${n} worker${n !== 1 ? 's' : ''} back in Camp.`);
    } else { refreshReturnMule(); }
  }

  // ── Resupply Mule ─────────────────────────────────────────────
  // Slider state (persists between modal opens)
  let resupplySliderWood = 100; // 0–200, stone = 200 - wood
  let resupplyCardWrap = null, resupplyWorkers = 0, resupplyTimer = null;
  let resupplyPayload = { wood: 0, stone: 0 }; // captured at Disembark

  function canAffordResupply() {
    const w = resupplySliderWood, s = RESUPPLY_TOTAL - w;
    return window.OrbWeaver.Resources.get('wood')  >= w
        && window.OrbWeaver.Resources.get('stone') >= s;
  }

  function buildResupplyCard(payload) {
    if (resupplyCardWrap) return;
    const campGrid = document.getElementById('grid-camp');
    if (!campGrid) return;
    resupplyPayload = payload;
    resupplyWorkers = 0; resupplyTimer = null;
    resupplyCardWrap = buildMuleCardDOM('Resupply Mule', 'resupply-mule-card', 'rs', campGrid,
      () => { if (resupplyTimer !== null || window.OrbWeaver.Workers.getIdleCount() <= 0) return; window.OrbWeaver.Workers.assign('__mule_resupply__'); resupplyWorkers++; refreshResupplyCard(); },
      () => { if (resupplyTimer !== null || resupplyWorkers <= 0) return; window.OrbWeaver.Workers.unassign('__mule_resupply__'); resupplyWorkers--; refreshResupplyCard(); },
      openResupplyCardModal);
    refreshResupplyCard();
  }

  function refreshResupplyCard() {
    if (!resupplyCardWrap) return;
    const t = resupplyTimer;
    const p = resupplyPayload;
    resupplyCardWrap.querySelector('.mule-card-stat').textContent = t !== null ? `En route – ${Math.ceil(t)}s` : (resupplyWorkers > 0 ? 'Ready to disembark' : `${p.wood}w ${p.stone}s`);
    resupplyCardWrap.querySelector('.rs-val').textContent  = resupplyWorkers;
    resupplyCardWrap.querySelector('.rs-plus').disabled    = t !== null || window.OrbWeaver.Workers.getIdleCount() <= 0;
    resupplyCardWrap.querySelector('.rs-minus').disabled   = t !== null || resupplyWorkers <= 0;
    resupplyCardWrap.querySelector('.mule-travel-bar').style.width = t !== null ? ((MULE_TRIP_TIME - t) / MULE_TRIP_TIME * 100) + '%' : '0%';
  }

  function openResupplyCardModal() {
    const d = resupplyWorkers < 1 || resupplyTimer !== null;
    const p = resupplyPayload;
    openMuleModal('Resupply Mule', `<div class="mule-modal">
      <p class="mule-modal-desc">Workers who ride the mule transfer to the Mountains idle pool on arrival.</p>
      <p class="mule-modal-stat">${resupplyWorkers} worker${resupplyWorkers !== 1 ? 's' : ''} assigned · Cargo: ${p.wood} Wood, ${p.stone} Stone</p>
      <button class="action-btn mule-action-btn" id="resupply-disembark-btn" ${d ? 'disabled' : ''}>Disembark</button>
    </div>`);
    document.getElementById('resupply-disembark-btn')?.addEventListener('click', () => {
      if (resupplyWorkers < 1 || resupplyTimer !== null) return;
      resupplyTimer = MULE_TRIP_TIME;
      window.OrbWeaver.Cards.closeModal();
      window.OrbWeaver.Footer.push(`Resupply Mule disembarked! Carrying ${p.wood} Wood, ${p.stone} Stone.`);
    });
  }

  function tickResupplyCard(tickRate) {
    if (resupplyTimer === null) return;
    resupplyTimer -= tickRate;
    if (resupplyTimer <= 0) {
      resupplyTimer = null;
      const n = resupplyWorkers; resupplyWorkers = 0;
      const p = resupplyPayload;
      for (let i = 0; i < n; i++) window.OrbWeaver.Workers.unassign('__mule_resupply__');
      if (resupplyCardWrap) { resupplyCardWrap.remove(); resupplyCardWrap = null; }
      addExpWood(p.wood);
      addExpStone(p.stone);
      addMountainsIdle(n);
      if (mountainsSectionBuilt && !returnMuleWrap) spawnReturnMule();
      window.OrbWeaver.Footer.push(`Resupply arrived! +${p.wood} Exp.Wood, +${p.stone} Exp.Stone, ${n} worker${n !== 1 ? 's' : ''} at Mountains.`);
    } else { refreshResupplyCard(); }
  }

  // ── Explore Mule ─────────────────────────────────────────────
  let muleWood = 0, muleReady = false;
  let exploreCardWrap = null, exploreWorkers = 0, exploringTimer = null;

  function getExplorePct() { return Math.min(100, (muleWood / EXPLORE_WOOD_NEED) * 100); }

  function buildExploreCard() {
    if (exploreCardWrap) return;
    const campGrid = document.getElementById('grid-camp');
    if (!campGrid) return;
    exploreWorkers = 0; exploringTimer = null;
    exploreCardWrap = buildMuleCardDOM('Mule for Exploration', 'explore-mule-card', 'em', campGrid,
      () => { if (exploringTimer !== null || window.OrbWeaver.Workers.getIdleCount() <= 0) return; window.OrbWeaver.Workers.assign('__mule_explore__'); exploreWorkers++; refreshExploreCard(); },
      () => { if (exploringTimer !== null || exploreWorkers <= 0) return; window.OrbWeaver.Workers.unassign('__mule_explore__'); exploreWorkers--; refreshExploreCard(); },
      openExploreModal);
    refreshExploreCard();
  }

  function refreshExploreCard() {
    if (!exploreCardWrap) return;
    const t = exploringTimer;
    exploreCardWrap.querySelector('.mule-card-stat').textContent = t !== null ? `Exploring – ${Math.ceil(t)}s` : (exploreWorkers > 0 ? 'Ready to disembark' : 'Assign workers');
    exploreCardWrap.querySelector('.em-val').textContent  = exploreWorkers;
    exploreCardWrap.querySelector('.em-plus').disabled    = t !== null || window.OrbWeaver.Workers.getIdleCount() <= 0;
    exploreCardWrap.querySelector('.em-minus').disabled   = t !== null || exploreWorkers <= 0;
    exploreCardWrap.querySelector('.mule-travel-bar').style.width = t !== null ? ((MULE_TRIP_TIME - t) / MULE_TRIP_TIME * 100) + '%' : '0%';
  }

  function openExploreModal() {
    const d = exploreWorkers < 1 || exploringTimer !== null;
    openMuleModal('Mule for Exploration', `<div class="mule-modal">
      <p class="mule-modal-desc">Embark on an exploration of the surrounding lands. Any workers sent with the Mule cannot return until they are sent back.</p>
      <p class="mule-modal-stat">${exploreWorkers} worker${exploreWorkers !== 1 ? 's' : ''} assigned</p>
      <button class="action-btn mule-action-btn" id="explore-disembark-btn" ${d ? 'disabled' : ''}>Disembark</button>
    </div>`);
    document.getElementById('explore-disembark-btn')?.addEventListener('click', () => {
      if (exploreWorkers < 1 || exploringTimer !== null) return;
      exploringTimer = MULE_TRIP_TIME;
      muleReady = false; muleWood = 0;
      window.OrbWeaver.Cards.closeModal();
      window.OrbWeaver.Footer.push('Mule for Exploration disembarked! 30s journey.');
    });
  }

  function tickExploreCard(tickRate) {
    if (exploringTimer === null) return;
    exploringTimer -= tickRate;
    if (exploringTimer <= 0) {
      exploringTimer = null;
      const n = exploreWorkers; exploreWorkers = 0;
      for (let i = 0; i < n; i++) window.OrbWeaver.Workers.unassign('__mule_explore__');
      if (exploreCardWrap) { exploreCardWrap.remove(); exploreCardWrap = null; }
      buildMountainsSection(n);
    } else { refreshExploreCard(); }
  }

  // ── Scout's Lodge upgrade track ───────────────────────────────
  const LODGE_TABLE = [{ name: "Scout's Lodge", gainPerWorker: 0, buildTime: 8, costRaw: '20 wood', newCap: 0 }];
  const lodgeTrack = window.OrbWeaver.Upgrades.create(LODGE_TABLE, () => 'Unlocks: Auto-Mule toggle', true);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:lodge`, lodgeTrack);

  let cardName = "Scout's Pen", autoMuleOn = false, lodgeBuilt = false;

  // ── Scout's Pen modal ─────────────────────────────────────────
  function renderResupplySection() {
    if (!mountainsSectionBuilt) {
      return `<div class="resupply-section resupply-locked">
        <div class="resupply-header">Resupply</div>
        <p class="resupply-hint">Reach Mountains first to unlock Resupply.</p>
      </div>`;
    }
    const w = resupplySliderWood, s = RESUPPLY_TOTAL - w;
    const canAfford = canAffordResupply();
    const hasCard = !!resupplyCardWrap;
    return `<div class="resupply-section">
      <div class="resupply-header">Resupply</div>
      <div class="resupply-slider-row">
        <span class="resupply-res-label">Wood</span>
        <input type="range" class="resupply-slider" id="resupply-slider"
          min="0" max="${RESUPPLY_TOTAL}" value="${w}" step="10">
        <span class="resupply-res-label">Stone</span>
      </div>
      <div class="resupply-amounts">
        <span id="resupply-wood-amt">${w} Wood</span>
        <span class="resupply-divider">·</span>
        <span id="resupply-stone-amt">${s} Stone</span>
      </div>
      <div class="resupply-afford" id="resupply-afford">
        Have: ${Math.floor(window.OrbWeaver.Resources.get('wood'))} Wood, ${Math.floor(window.OrbWeaver.Resources.get('stone'))} Stone
      </div>
      <button class="action-btn resupply-btn" id="scout-resupply-btn" ${canAfford && !hasCard ? '' : 'disabled'}>
        Resupply (${w}w + ${s}s)
      </button>
    </div>`;
  }

  function renderModal() {
    const pct = getExplorePct().toFixed(1);
    const lodgeArrow = `<span class="section-collapse-arrow${lodgeTrack.isCollapsed() ? ' collapsed' : ''}" data-upgrade-action="toggle-collapse" data-mechanic="${ID}" data-track="lodge">▾</span>`;
    const lodgeHtml = lodgeBuilt ? '' : lodgeTrack.renderModalHTML(ID, {}, 'lodge', lodgeArrow);
    const autoRow = lodgeBuilt ? `<div class="mule-auto-row"><span>Auto-Mule</span><div class="toggle-switch${autoMuleOn ? ' on' : ''}" id="scout-auto-toggle"></div></div>` : '';
    const exploreDisabled = !muleReady || !!exploreCardWrap ? 'disabled' : '';
    return `<div class="scoutspen-modal">
      ${lodgeHtml ? `${lodgeHtml}<div class="modal-subsection-label divider-only"></div>` : ''}
      <div class="explore-section">
        <div class="resupply-header">Explore</div>
        <div class="mule-prep-label">Prepare Mule <span class="mule-prep-val">${Math.floor(muleWood)}/${EXPLORE_WOOD_NEED} Wood</span></div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar mule-prep-bar" data-track="muleprepbar" style="width:${pct}%"></div></div>
        ${autoRow}
        <button class="action-btn" id="scout-explore-btn" ${exploreDisabled}>Explore</button>
      </div>
      <div class="modal-subsection-label divider-only"></div>
      ${renderResupplySection()}
    </div>`;
  }

  function patchModal() {
    // Explore section
    const bar = document.querySelector('#card-modal-body .mule-prep-bar');
    if (bar) bar.style.width = getExplorePct().toFixed(1) + '%';
    const valEl = document.querySelector('#card-modal-body .mule-prep-val');
    if (valEl) valEl.textContent = `${Math.floor(muleWood)}/${EXPLORE_WOOD_NEED} Wood`;
    const exploreBtn = document.getElementById('scout-explore-btn');
    if (exploreBtn) exploreBtn.disabled = !muleReady || !!exploreCardWrap;
    // Lodge cost
    if (!lodgeBuilt) {
      const costEl = document.querySelector('#card-modal-body .upgrade-row:not(.locked) .upgrade-cost');
      if (costEl) costEl.innerHTML = lodgeTrack.getResourceTracker() || '';
    }
    // Resupply: patch afford line + button — don't rebuild slider
    const affordEl = document.getElementById('resupply-afford');
    if (affordEl) affordEl.textContent = `Have: ${Math.floor(window.OrbWeaver.Resources.get('wood'))} Wood, ${Math.floor(window.OrbWeaver.Resources.get('stone'))} Stone`;
    const rsBtn = document.getElementById('scout-resupply-btn');
    if (rsBtn) rsBtn.disabled = !canAffordResupply() || !!resupplyCardWrap;
  }

  function wireModalButtons() {
    document.getElementById('scout-auto-toggle')?.addEventListener('click', () => {
      autoMuleOn = !autoMuleOn;
      document.getElementById('scout-auto-toggle')?.classList.toggle('on', autoMuleOn);
    });
    document.getElementById('scout-explore-btn')?.addEventListener('click', () => {
      if (!muleReady || exploreCardWrap) return;
      buildExploreCard();
      muleReady = false;
      window.OrbWeaver.Cards.closeModal();
      window.OrbWeaver.Footer.push('Mule for Exploration ready — assign workers and Disembark.');
    });
    // Resupply slider
    const slider = document.getElementById('resupply-slider');
    if (slider) {
      const updateSlider = () => {
        resupplySliderWood = parseInt(slider.value, 10);
        const s = RESUPPLY_TOTAL - resupplySliderWood;
        const woodAmt  = document.getElementById('resupply-wood-amt');
        const stoneAmt = document.getElementById('resupply-stone-amt');
        const rsBtn    = document.getElementById('scout-resupply-btn');
        const affordEl = document.getElementById('resupply-afford');
        if (woodAmt)  woodAmt.textContent  = `${resupplySliderWood} Wood`;
        if (stoneAmt) stoneAmt.textContent = `${s} Stone`;
        if (rsBtn) {
          rsBtn.disabled    = !canAffordResupply() || !!resupplyCardWrap;
          rsBtn.textContent = `Resupply (${resupplySliderWood}w + ${s}s)`;
        }
        if (affordEl) affordEl.textContent = `Have: ${Math.floor(window.OrbWeaver.Resources.get('wood'))} Wood, ${Math.floor(window.OrbWeaver.Resources.get('stone'))} Stone`;
      };
      slider.addEventListener('input', updateSlider);
    }
    document.getElementById('scout-resupply-btn')?.addEventListener('click', () => {
      const w = resupplySliderWood, s = RESUPPLY_TOTAL - w;
      if (!canAffordResupply() || resupplyCardWrap) return;
      window.OrbWeaver.Resources.spend('wood',  w);
      window.OrbWeaver.Resources.spend('stone', s);
      buildResupplyCard({ wood: w, stone: s });
      window.OrbWeaver.Cards.closeModal();
      window.OrbWeaver.Footer.push(`Resupply Mule ready — ${w} Wood, ${s} Stone loaded.`);
    });
  }

  function onOpen() { setTimeout(wireModalButtons, 0); }

  // ── Mechanic ──────────────────────────────────────────────────
  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Camp',
    upgradeTrackKey: 'lodge',
    cardName: () => cardName,
    getStatText() {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (lodgeTrack.isCollecting()) return assigned > 0 ? `${assigned} workers – Collecting` : 'Collecting';
      if (lodgeTrack.isBuilding())   return 'Upgrading…';
      if (muleReady)                 return 'Mule Ready – Explore!';
      if (assigned > 0)              return `Preparing – ${Math.floor(muleWood)}/${EXPLORE_WOOD_NEED} wood`;
      return 'Assign workers';
    },
    getUpgradeBarPct() {
      if (lodgeTrack.isCollecting() || lodgeTrack.isBuilding()) return lodgeTrack.getBarPct();
      return getExplorePct();
    },
    isUpgradeCollecting: () => lodgeTrack.isCollecting(),
    patchUpgradeCost:  () => lodgeBuilt ? null : lodgeTrack.getResourceTracker(),
    patchBuildStatus:  () => lodgeBuilt ? null : lodgeTrack.getBuildStatusText(),
    patchLiveTrack: patchModal,
    getWorkerDesc: () => 'Prepares mule 1 wood/s',
    renderModalHTML: renderModal,
    onOpen,
    tick(goldAvailable, tickRate) {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);

      // Explore prep: workers consume wood toward 200
      if (assigned > 0 && !muleReady && muleWood < EXPLORE_WOOD_NEED && goldAvailable) {
        const take = Math.min(assigned * tickRate, window.OrbWeaver.Resources.get('wood'), EXPLORE_WOOD_NEED - muleWood);
        if (take > 0) {
          window.OrbWeaver.Resources.spend('wood', take);
          muleWood += take;
          if (muleWood >= EXPLORE_WOOD_NEED) {
            muleReady = true; muleWood = EXPLORE_WOOD_NEED;
            window.OrbWeaver.Footer.push("Mule prepared! Open Scout's Pen to Explore or Resupply.");
          }
        }
      }

      if (!lodgeBuilt && lodgeTrack.isBuilding()) {
        lodgeTrack.advanceTimer(tickRate, assigned, () => {
          lodgeBuilt = true; cardName = "Scout's Lodge";
          window.OrbWeaver.Footer.push("Scout's Lodge built!");
        });
      }

      tickExploreCard(tickRate);
      tickResupplyCard(tickRate);
      tickReturnMule(tickRate);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  window.OrbWeaver.Mountains = {
    getIdle: getMountainsIdle, addIdle: addMountainsIdle, takeIdle: takeMountainsIdle,
    revealIron: revealIronLeft, isRevealed: () => mountainsSectionBuilt,
    onResupplyArrived: () => { if (mountainsSectionBuilt && !returnMuleWrap) spawnReturnMule(); }
  };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
