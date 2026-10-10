/* Camp's Dig Site: one shared roll and a wood-fed research bonus.
   Balance stays here; cards, workers, cycles and saves use the shared engine. */
(function () {
  'use strict';
  const OW = window.OrbWeaver, R = OW.Resources, pool = OW.Workers;
  const ID = 'digsite', ROLL_TIME = 5, WOOD_CAP = 50, FILL_RATE = 1, BURN_RATE = 2;
  const HISTORY_MS = 3600000;
  const workers = { dig: 0, brazier: 0 }, cycle = OW.Cycles.create(ROLL_TIME);
  let introDone = false, wood = 0, burning = false, loadedWood = false;
  let history = [], head = 0, lastReward = null;
  const totals = { stone: 0, research: 0 };
  const fmt = OW.Upgrades.formatRate;
  const rate = (slot) => workers[slot] > 0 ? OW.Upgrades.workerRate(workers[slot], 1, 1, 0) : 0;
  const used = () => workers.dig + workers.brazier;
  const free = () => pool.getAssigned(ID) - used();
  const researchChance = () => Math.min(100, workers.dig + (burning ? wood : 0));
  const canStoke = () => introDone && R.get('gold') > 0 && workers.brazier > 0 && wood < WOOD_CAP && R.available('wood') > 0;
  const rewardText = (type) => type === 'stone' ? '1 Stone' : type === 'research' ? '1 Research Paper' : '—';

  // Exact individual outcomes, with a moving head and cached totals to avoid
  // scanning/shifting a large hour of rolls on every tick. Saves omit the dead prefix.
  function prune(now = Date.now()) {
    while (head < history.length && history[head].time < now - HISTORY_MS) totals[history[head++].type]--;
    if (head > 1024 && head * 2 >= history.length) { history = history.slice(head); head = 0; }
  }
  function rollReward() {
    const type = Math.random() * 100 < 100 - researchChance() ? 'stone' : 'research';
    const id = type === 'stone' ? 'stone' : 'researchpapers';
    if (type === 'research') R.reveal(id);
    R.add(id, 1);
    const time = Date.now();
    prune(time);
    history.push({ type, time });
    totals[type]++;
    lastReward = type;
  }

  // Expected per second for /min and /hr (js/core/rates.js): rolls × the research chance averaged over a
  // whole Brazier heat-and-burn cycle, so it doesn't swing as the wood burns. Stone gets the rest.
  function expected(id) {
    if (id !== 'stone' && id !== 'researchpapers') return undefined;
    if (!introDone || !workers.dig) return 0;
    const fill = workers.brazier > 0 && R.available('wood') > 0 ? rate('brazier') * FILL_RATE : 0;
    const chance = (w) => Math.min(100, workers.dig + w) / 100;
    let p = chance(fill >= BURN_RATE ? WOOD_CAP : 0);                    // no crew or no wood: no bonus; fast crew: always full
    if (fill > 0 && fill < BURN_RATE) {                                   // heat 0→cap at fill, then burn cap→0 at BURN_RATE − fill
      const heat = WOOD_CAP / fill, burn = WOOD_CAP / (BURN_RATE - fill);
      let avg = 0; for (let i = 0; i < 50; i++) avg += chance((i + 0.5) / 50 * WOOD_CAP) / 50;
      p = (p * heat + avg * burn) / (heat + burn);
    }
    return rate('dig') / ROLL_TIME * (id === 'stone' ? 1 - p : p);
  }

  function clampWorkers() {
    let budget = pool.getAssigned(ID);
    Object.keys(workers).forEach((slot) => { workers[slot] = Math.min(workers[slot], budget); budget -= workers[slot]; });
  }
  function subAssign(slot) {
    if (!introDone || !(slot in workers)) return;
    if (free() <= 0 && !pool.assign(ID)) return;
    workers[slot]++;
    mechanic.lastSub = slot;
    OW.Cards.refresh(mechanic);
  }
  function subUnassign(slot) {
    if (!(slot in workers) || workers[slot] <= 0) return;
    workers[slot]--;
    pool.unassign(ID); // a modal − returns the worker to idle (fires the card refresh)
  }
  pool.onChange(clampWorkers);

  function completeIntro() {
    if (introDone || !mechanic.revealed) return;
    introDone = true;
    OW.Cards.closeModal();
    OW.Cards.refresh(mechanic);
    OW.StrangeShard.start();
  }
  function rateText(slot) {
    if (!workers[slot]) return '';
    if (R.get('gold') <= 0 || (slot === 'brazier' && !canStoke())) return 'Stopped';
    return `${slot === 'dig' ? 'Digging' : 'Stoking'} ${fmt(rate(slot) * (slot === 'dig' ? 1 / ROLL_TIME : FILL_RATE))}/s`;
  }
  function detail(slot, title) {
    const isWood = slot === 'brazier';
    return `<div class="hs-card">
      <div class="hs-head"><div class="ds-head-left"><div class="card-steppers visible">
          <button class="card-stepper-btn" data-ds-minus="${slot}" aria-label="Remove ${title} worker">–</button>
          <span class="card-stepper-val" data-ds-count="${slot}">${workers[slot]}</span>
          <button class="card-stepper-btn" data-ds-plus="${slot}" aria-label="Add ${title} worker">+</button>
        </div><span class="hs-title">${title}</span></div>${isWood ? '<span class="ds-wood-info"><span data-ds-state></span><span class="sm-wood-active" data-ds-wood></span></span>' : ''}</div>
      <div class="hs-body">
        <span class="ds-rate" data-ds-rate="${slot}"></span>
        <div class="detail-progress-wrap"><div class="detail-progress-bar${isWood ? ' sm-molten-bar ds-brazier-bar' : ''}" data-extra-track="ds-${slot}"></div></div>
      </div>
    </div>`;
  }

  const mechanic = {
    id: ID, section: 'Camp', startHidden: true, cardThemeClass: 'ds-card',
    cardName: () => 'Dig Site',
    rateExpect: expected,
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots: () => (introDone ? Object.keys(workers) : []), subAdd: subAssign,
    stepperReady: () => introDone,
    reserveStepperSpace: true,
    canAssign: () => introDone,
    getUpgradeBarPct: () => 0,
    hideUpgradeBar: () => true,
    getBuildBarPct: () => wood / WOOD_CAP * 100,
    hideBuildBar: () => !introDone,
    isBuildBarFaded: () => !burning,
    // Modal bars have their own smoothing targets; the face mirrors Brazier wood.
    upgradeTrackKey: 'ds-none', buildTrackKey: 'ds-none',
    getExtraBars: () => introDone ? [{ id: 'ds-dig', pct: cycle.getPct() }, { id: 'ds-brazier', pct: wood / WOOD_CAP * 100 }] : [],
    getStatText() {
      if (!introDone) return 'Strange Shard';
      if (!used()) return pool.getAssigned(ID) > 0 ? 'Dark' : '';
      if (R.get('gold') <= 0) return 'Stopped';
      if (workers.dig) return rateText('dig');
      return burning ? 'Burning' : canStoke() ? 'Heating' : 'Stopped';
    },
    getBillableCount: () => introDone && R.get('gold') > 0 ? workers.dig + (loadedWood ? workers.brazier : 0) : 0,
    renderModalHTML() {
      if (!introDone) return '<button class="action-btn" data-ds-intro>Show your future</button>';
      return `<div class="bench-modal ds-modal">
        <div class="ds-stats">
          <div class="ds-chance">Research paper chance <strong data-ds-chance></strong></div>
          <div class="ds-history"><span>Last dig <span data-ds-last></span></span><span>Last hour <span data-ds-hour></span></span></div>
        </div>${detail('dig', 'Dig')}${detail('brazier', 'Brazier')}
      </div>`;
    },
    afterRender() {
      const body = document.getElementById('card-modal-body');
      const intro = body.querySelector('[data-ds-intro]');
      if (intro) intro.addEventListener('click', completeIntro);
      ['plus', 'minus'].forEach((action) => body.querySelectorAll(`[data-ds-${action}]`).forEach((button) => {
        const run = () => (action === 'plus' ? subAssign : subUnassign)(button.getAttribute('data-ds-' + action));
        OW.Cards.addHoldBehavior(button, run);
        // Pointer input is handled by hold-to-repeat; keyboard clicks have no detail.
        button.addEventListener('click', (e) => { if (!e.detail && !button.disabled) run(); });
      }));
      mechanic.patchLiveTrack();
    },
    patchLiveTrack() {
      if (!introDone) return;
      prune();
      const body = document.getElementById('card-modal-body');
      const text = (key, value) => { const el = body.querySelector(`[data-ds-${key}]`); if (el) el.textContent = value; };
      text('chance', `${Number(researchChance().toFixed(1))}%`);
      text('last', rewardText(lastReward));
      text('hour', `${totals.research} Research Papers · ${totals.stone} Stone`);
      text('state', burning ? 'Burning' : 'Heating');
      text('wood', `${Number(wood.toFixed(1))}/${WOOD_CAP} Wood`);
      const bar = body.querySelector('[data-extra-track="ds-brazier"]');
      if (bar) bar.classList.toggle('ds-burning', burning);
      Object.keys(workers).forEach((slot) => {
        const count = body.querySelector(`[data-ds-count="${slot}"]`);
        if (count) count.textContent = workers[slot];
        const line = body.querySelector(`[data-ds-rate="${slot}"]`);
        if (line) line.textContent = rateText(slot);
        const minus = body.querySelector(`[data-ds-minus="${slot}"]`);
        if (minus) minus.disabled = workers[slot] <= 0;
        const plus = body.querySelector(`[data-ds-plus="${slot}"]`);
        if (plus) plus.disabled = free() <= 0 && pool.getIdleCount() <= 0;
      });
    },
    tick(goldAvailable, tickRate) {
      if (!mechanic.revealed && R.get('stone') > 0) OW.Cards.reveal(mechanic);
      loadedWood = false;
      if (introDone && tickRate > 0) {
        if (goldAvailable && workers.brazier > 0) {
          // Request only what fits; shared spend already handles loose wood + crates.
          const gained = R.spend('wood', Math.min(WOOD_CAP - wood, rate('brazier') * FILL_RATE * tickRate));
          wood = Math.min(WOOD_CAP, wood + gained);
          loadedWood = gained > 0;
        }
        if (wood >= WOOD_CAP) burning = true;
        if (burning) {
          wood = Math.max(0, wood - BURN_RATE * tickRate);
          if (wood < 1e-9) { wood = 0; burning = false; }
        }
        if (goldAvailable && workers.dig > 0) {
          const rolls = cycle.advance(rate('dig'), tickRate);
          for (let i = 0; i < rolls; i++) rollReward();
        }
      }
      prune();
      OW.Cards.refresh(mechanic);
    }
  };

  OW.Save.register(ID,
    () => { prune(); return { introDone, workers: { ...workers }, progress: cycle.serialize(), wood, burning, lastReward, history: history.slice(head) }; },
    (d) => {
      const number = (v) => Number.isFinite(v) && v > 0 ? v : 0;
      introDone = !!d.introDone;
      Object.keys(workers).forEach((slot) => { workers[slot] = introDone ? Math.floor(number(d.workers && d.workers[slot])) : 0; });
      clampWorkers();
      cycle.deserialize(number(d.progress) % ROLL_TIME);
      wood = Math.min(WOOD_CAP, number(d.wood));
      burning = !!d.burning && wood > 0;
      loadedWood = false;
      history = (Array.isArray(d.history) ? d.history : []).filter((e) => e && (e.type === 'stone' || e.type === 'research') && Number.isFinite(e.time)).map((e) => ({ type: e.type, time: e.time })).sort((a, b) => a.time - b.time);
      head = 0; totals.stone = totals.research = 0;
      history.forEach((e) => totals[e.type]++);
      lastReward = d.lastReward === 'stone' || d.lastReward === 'research' ? d.lastReward : null;
      prune();
    });
  OW.Mechanics.register(mechanic);
  OW.DigSite = { subAssign, subUnassign, completeIntro, researchChance };
})();
