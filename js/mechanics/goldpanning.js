/* ============================================================
   MECHANIC: GOLD PANNING (Mountains section)
   Revealed when Mountains' Gold Panning build completes. A station
   card: a growable list of stations, each running a repeating dice
   roll on its own timer, staffed from Gold Panning's slice of
   Mountains' worker pool (same sub-slot pattern as Mountains/Wheat
   Field). Two station kinds exist — Sluice Box (2s) and Panning (3s) —
   but only Panning can be bought for now (2000 Mountains wood each,
   capped at 10 stations total). The card opens with one Sluice Box and
   two Panning already present and staffable.

   Each completed cycle rolls d100 against DICE_TABLE and pays out via
   the shared cycles engine (js/core/cycles.js), which carries sub-tick
   overshoot forward and batches statistically past 300 rolls/tick so a
   heavily-buffed station can't stall on the 200ms tick or blow up
   offline catch-up. Gold Dust and Nuggets are internal, isolated
   resources (js/core/hiddenRes.js) shared only with the future Gold
   Mine and Smelting Hut — never the left-hand sidebar or Scout Stable.
   Gold payouts route to the shared 'gold' pool like any other.

   Workers here never cost gold (upkeepExempt) and never pause on gold
   starvation — this card MAKES money, same rule as Market.

   [Steps 3-4 built: config, state, sub-slots, add-station, dice table,
    reward resolver, tick. Modal UI (5-6), stepper wiring (7),
    Last Reward/Hour (9) and save (11) land in later steps.]
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'goldpanning';
  const STATION_CAP = 10;          // total stations of any kind
  const ADD_COST = 2000;           // Mountains wood per bought station

  // Station kinds — name is the on-screen label (duplicates are fine),
  // cycle is seconds-per-roll at rate 1 (one worker, baseline dials).
  const KINDS = {
    sluice:  { name: 'Sluice Box', cycle: 2 },
    panning: { name: 'Panning',    cycle: 3 }
  };
  const STARTING = ['sluice', 'panning', 'panning'];

  // d100 reward table (weights sum to 100). kind: 'golddust'|'nugget'
  // (internal, HiddenRes) or 'gold' (shared pool). Handed to the
  // generic resolver in js/core/cycles.js — the numbers live here.
  const DICE_TABLE = [
    { weight: 30, kind: 'golddust', amount: 1 },   //  1-30
    { weight: 30, kind: 'gold',     amount: 1 },    // 31-60
    { weight: 10, kind: 'golddust', amount: 5 },    // 61-70
    { weight: 10, kind: 'gold',     amount: 3 },    // 71-80
    { weight: 10, kind: 'nugget',   amount: 1 },    // 81-90
    { weight: 5,  kind: 'nugget',   amount: 2 },    // 91-95
    { weight: 5,  kind: 'gold',     amount: 30 }     // 96-100
  ];
  const dice = window.OrbWeaver.Cycles.roll(DICE_TABLE);

  // Worker contribution formula dials, local to this card (see
  // js/core/upgrades.js workerRate()). Baseline 1 worker -> rate 1.
  let m = 1, p = 1, f = 0;

  // Live station list. Each: { id, kind, workers, cyc } where cyc is a
  // cycles accumulator. seq tracks the next unique suffix per kind so
  // two 'Panning' stations never share an id.
  let stations = [];
  const seq = { sluice: 0, panning: 0 };

  function pool() { return window.OrbWeaver.Mountains.workerPool; }
  function woodId() { return window.OrbWeaver.Mountains.woodId; }
  const rate = (n) => window.OrbWeaver.Upgrades.workerRate(n, m, p, f);

  function makeStation(kind) {
    seq[kind] = (seq[kind] || 0) + 1;
    return { id: `${kind}-${seq[kind]}`, kind, workers: 0, cyc: window.OrbWeaver.Cycles.create(KINDS[kind].cycle),
             lastReward: '', buckets: [], bucketClock: 0 };
  }
  function seed() { seq.sluice = 0; seq.panning = 0; stations = STARTING.map(makeStation); }
  function byId(id) { return stations.find((s) => s.id === id); }

  /* ---- Worker sub-slots (same rules as Mountains/Wheat Field) ----
     Each station draws its own workers from Gold Panning's free card
     workers; if none are free, auto-promote one from Mountains' pool
     onto the card, then into the station (never the global/Camp pool).
     Uncapped per station. */
  function usedWorkers() { return stations.reduce((sum, s) => sum + s.workers, 0); }
  function freeCardWorkers() { return pool().getAssigned(ID) - usedWorkers(); }

  function subAssign(id) {
    const s = byId(id);
    if (!s) return;
    if (freeCardWorkers() <= 0) { if (!pool().assign(ID)) return; }
    s.workers++;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  function subUnassign(id) {
    const s = byId(id);
    if (!s || s.workers <= 0) return;
    s.workers--;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  // Card-face stepper shrinking below sum-of-stations: clamp greedily
  // (earlier stations keep priority) so no station outlives its backing
  // card assignment.
  pool().onChange(() => {
    let budget = pool().getAssigned(ID);
    stations.forEach((s) => { const keep = Math.min(s.workers, budget); s.workers = keep; budget -= keep; });
  });

  /* ---- Add-station ---- Buys one Panning for 2000 Mountains wood,
     until STATION_CAP total stations exist. */
  function canAdd() { return stations.length < STATION_CAP && window.OrbWeaver.Resources.get(woodId()) >= ADD_COST; }
  function atCap() { return stations.length >= STATION_CAP; }
  function addStation() {
    if (!canAdd()) return;
    window.OrbWeaver.Resources.spend(woodId(), ADD_COST);
    stations.push(makeStation('panning'));
    window.OrbWeaver.Footer.push('New panning station added.');
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  /* ---- Reward resolver ---- Applies a cycles tally {bucketIndex:count}
     to the world: internal kinds to HiddenRes, gold to the shared pool.
     Returns this batch's totals per kind so Last Reward / Last Hour
     (Step 9) can display them without re-deriving. */
  function applyTally(tally) {
    const got = { golddust: 0, gold: 0, nugget: 0 };
    Object.keys(tally).forEach((idx) => {
      const row = DICE_TABLE[idx], n = tally[idx];
      const total = row.amount * n;
      got[row.kind] += total;
    });
    if (got.golddust) window.OrbWeaver.HiddenRes.add('golddust', got.golddust);
    if (got.nugget)   window.OrbWeaver.HiddenRes.add('nugget', got.nugget);
    if (got.gold)     window.OrbWeaver.Resources.add('gold', got.gold);
    return got;
  }

  /* ---- Last Reward / Last Hour ----
     lastReward is the most recent payout event's totals (one roll, or a
     whole tick's batch if several completed at once). The hour is a
     rolling window of up to 60 one-minute buckets, rotated off each
     station's OWN accumulated worked-time clock (bucketClock) so it
     stays correct through offline catch-up's coarse steps, not just live
     play. A station at 0 workers clears both — displays blank and the
     hour restarts fresh when it's re-staffed (the cycle timer itself is
     left untouched, pausing in place like every other mechanic). */
  function fmtTotals(t) {
    const parts = [];
    if (t.golddust) parts.push(`${t.golddust} Gold Dust`);
    if (t.nugget)   parts.push(`${t.nugget} Nugget${t.nugget > 1 ? 's' : ''}`);
    if (t.gold)     parts.push(`${t.gold} Gold`);
    return parts.join(', ');
  }
  function recordHour(s, got, tickRate) {
    if (!s.buckets.length) s.buckets.push({ gd: 0, g: 0, n: 0 });
    const cur = s.buckets[s.buckets.length - 1];
    cur.gd += got.golddust; cur.g += got.gold; cur.n += got.nugget;
    s.bucketClock += tickRate;
    while (s.bucketClock >= 60) {
      s.bucketClock -= 60;
      s.buckets.push({ gd: 0, g: 0, n: 0 });
      if (s.buckets.length > 60) s.buckets.shift();
    }
  }
  function hourTotals(s) {
    return s.buckets.reduce((a, b) => ({ golddust: a.golddust + b.gd, gold: a.gold + b.g, nugget: a.nugget + b.n }),
      { golddust: 0, gold: 0, nugget: 0 });
  }
  function clearStats(s) { s.lastReward = ''; s.buckets = []; s.bucketClock = 0; }

  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  const kindName = (s) => KINDS[s.kind].name;

  // Blank at 0 workers; a dash until the first reward lands, then the
  // actual figures. Underlying data is cleared on idle (see tick).
  function lastRewardText(s) { return s.workers > 0 ? (s.lastReward || '—') : ''; }
  function lastHourText(s) { return s.workers > 0 ? (fmtTotals(hourTotals(s)) || '—') : ''; }

  function rateText(s) {
    return s.workers === 0 ? '' : `Panning ${window.OrbWeaver.Upgrades.formatRate(rate(s.workers))}/s`;
  }

  // One station row — an hs-card: header (name + cycle), body with Last
  // Reward / Last Hour lines, an eased progress bar (data-extra-track,
  // driven by getExtraBars()), and its own sub-slot stepper.
  function stationCard(s) {
    return `<div class="hs-card" data-gp-card="${s.id}">
      <div class="hs-head">
        <span class="hs-title">${kindName(s)}</span>
        <span class="upgrade-costtime">${KINDS[s.kind].cycle}s</span>
      </div>
      <div class="hs-body">
        <div class="wf-line">Last reward <span class="wf-tag" data-gp-last="${s.id}">${lastRewardText(s)}</span></div>
        <div class="wf-line">Last hour <span class="wf-tag" data-gp-hour="${s.id}">${lastHourText(s)}</span></div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar" data-extra-track="${s.id}"></div></div>
        <div class="card-steppers visible">
          <button class="card-stepper-btn" data-gp-sub="${s.id}" data-gp-act="remove" ${s.workers <= 0 ? 'disabled' : ''}>−</button>
          <span class="card-stepper-val" data-gp-val="${s.id}">${s.workers}</span>
          <button class="card-stepper-btn" data-gp-sub="${s.id}" data-gp-act="add">+</button>
          <span class="worker-desc" data-gp-rate="${s.id}">${rateText(s)}</span>
        </div>
      </div>
    </div>`;
  }

  // Add-station prompt — an hs-card reading the wood cost; disappears
  // entirely at the station cap.
  function addCard() {
    if (atCap()) return '';
    const have = Math.round(window.OrbWeaver.Resources.get(woodId()));
    const affordable = canAdd();
    return `<div class="hs-card${affordable ? '' : ' hs-card-dim'}" data-gp-add>
      <div class="hs-head">
        <span class="hs-title">New Panning Station</span>
        <span class="upgrade-costtime" data-gp-addcost>${have}/${ADD_COST} Wood</span>
      </div>
      <div class="hs-body">
        <div class="hs-desc-build-row">
          <span class="upgrade-desc${affordable ? ' upgrade-desc-affordable' : ''}">Expand the claim with another panning station.</span>
          <button class="action-btn hs-btn-right" data-gp-add-btn ${affordable ? '' : 'disabled'}>${ADD_COST} wood</button>
        </div>
      </div>
    </div>`;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    upkeepExempt: true,             // this card makes gold; workers are free
    workerPool: null,               // set to Mountains' pool in main.js after Mountains loads
    cardName: () => 'Gold Panning',
    getStatText() {
      const w = usedWorkers();
      return w > 0 ? `Panning – ${stations.length} station${stations.length > 1 ? 's' : ''}` : '';
    },
    getUpgradeBarPct: () => 0,
    // Each station's bar is a modal-only extra bar, eased by the shared
    // smoothing engine (cards.js getExtraBars) — same as Mountains' paths.
    getExtraBars: () => stations.map((s) => ({ id: s.id, pct: s.cyc.getPct() })),
    getBillableCount: () => usedWorkers(),
    renderModalHTML() {
      const cards = stations.map(stationCard).join('<div class="bench-modal-divider"></div>');
      const add = addCard();
      return `<div class="bench-modal">${cards}${add ? '<div class="bench-modal-divider"></div>' + add : ''}</div>`;
    },
    // Re-wire hold-to-repeat onto every stepper button after each render.
    afterRender() {
      const body = document.getElementById('card-modal-body');
      if (!body) return;
      body.querySelectorAll('[data-gp-sub]').forEach((btn) => {
        const id = btn.dataset.gpSub, act = btn.dataset.gpAct;
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => { act === 'add' ? subAssign(id) : subUnassign(id); });
      });
    },
    // Patch live values in place (never rebuild — that orphans held
    // stepper timers). Structural changes (add station) call
    // refreshOpenModal explicitly instead.
    patchLiveTrack() {
      stations.forEach((s) => {
        const val = q(`[data-gp-val="${s.id}"]`); if (val) val.textContent = s.workers;
        const minus = q(`[data-gp-sub="${s.id}"][data-gp-act="remove"]`); if (minus) minus.disabled = s.workers <= 0;
        const rt = q(`[data-gp-rate="${s.id}"]`); if (rt) rt.textContent = rateText(s);
        const lr = q(`[data-gp-last="${s.id}"]`); if (lr) lr.textContent = lastRewardText(s);
        const lh = q(`[data-gp-hour="${s.id}"]`); if (lh) lh.textContent = lastHourText(s);
      });
      const addCost = q('[data-gp-addcost]');
      if (addCost) addCost.textContent = `${Math.round(window.OrbWeaver.Resources.get(woodId()))}/${ADD_COST} Wood`;
      const addBtn = q('[data-gp-add-btn]');
      if (addBtn) {
        const aff = canAdd();
        addBtn.disabled = !aff;
        const card = q('[data-gp-add]'); if (card) card.classList.toggle('hs-card-dim', !aff);
        const desc = card && card.querySelector('.upgrade-desc'); if (desc) desc.classList.toggle('upgrade-desc-affordable', aff);
      }
    },
    tick(goldAvailable, tickRate) {
      // Gold-exempt: ignore goldAvailable entirely (like Market).
      stations.forEach((s) => {
        if (s.workers <= 0) { clearStats(s); return; }
        const done = s.cyc.advance(rate(s.workers), tickRate);
        const got = done > 0 ? applyTally(dice.sample(done)) : { golddust: 0, gold: 0, nugget: 0 };
        if (done > 0) s.lastReward = fmtTotals(got);
        recordHour(s, got, tickRate);
      });
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  // Add-station click (delegated — the button is rebuilt each render).
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-gp-add-btn]')) addStation();
  });

  // Test-only surface (node harness); harmless in the browser.
  mechanic._debug = { seed, stations: () => stations, subAssign, subUnassign, addStation, canAdd, atCap, applyTally, DICE_TABLE, freeCardWorkers, fmtTotals, hourTotals, clearStats, tick: mechanic.tick };

  /* ---- Save/load ----
     Per station: kind, worker count, cycle progress, last-reward text,
     and the hour buckets + clock. Station ids are derived, not stored —
     the seq counters replay in list order. A fresh game with no save
     seeds the three starting stations instead. */
  window.OrbWeaver.Save.register(ID,
    () => ({
      st: stations.map((s) => ({
        k: s.kind, w: s.workers, cp: s.cyc.serialize(), lr: s.lastReward,
        bc: s.bucketClock, bk: s.buckets.map((b) => [b.gd, b.g, b.n])
      }))
    }),
    (d) => {
      if (!d || !d.st || !d.st.length) { if (!stations.length) seed(); return; }
      seq.sluice = 0; seq.panning = 0;
      stations = d.st.map((sv) => {
        const s = makeStation(sv.k);
        s.workers = sv.w || 0;
        s.cyc.deserialize(sv.cp || 0);
        s.lastReward = sv.lr || '';
        s.bucketClock = sv.bc || 0;
        s.buckets = (sv.bk || []).map((b) => ({ gd: b[0], g: b[1], n: b[2] }));
        return s;
      });
    });
  window.OrbWeaver.Mechanics.register(mechanic);

  // Seed the starting stations at load (a fresh game); a save load
  // replaces them in Step 11.
  seed();
})();
