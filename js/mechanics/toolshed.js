/* ============================================================
   MECHANIC: TOOL SHED (Camp)
   Built via Camp's Construction list (see buildersbench.js). One
   bench per tool tier, fixed at load: BENCHES lists the tiers in
   display order and each bench is permanently bound to its tool. The
   bench count is not player-facing state — there is nothing to buy
   and nothing to configure, so a bench's tool never appears in the
   save (see Save/load at the bottom: seed, not fruit).

   Tiers IV and V are deliberately NOT derived from RECIPES — adding a
   recipe should not silently grow the shed. Give a new tier an entry
   in both RECIPES and BENCHES when it is actually wanted.

   Each bench has exactly one worker slot, stepped from its header
   alongside the tier pill and title. Workers can be assigned
   immediately; there is no output to pick first and therefore nothing
   to lock.

   Every bench is visible from the moment the shed is built, including
   tiers whose inputs the player cannot obtain yet. Such a bench
   accumulates progress until a whole tool comes due, then freezes on
   the input shortfall and stays frozen — and, per billableWorkers()
   below, its workers stop being billed while frozen. Parking workers
   on an unusable bench is therefore free, and intentionally so.

   Input rows are read-only and fully derived from RECIPES[bench.res] —
   no worker assignment of their own, just a live rate display scaling
   with the bench's worker count.

   Production: one Cycles.create(1) accumulator per bench (Gold
   Panning's per-station shape). Each tick, rather than calling
   cyc.advance() blindly, we peek at how many whole completions this
   tick's bank WOULD produce (via Cycles' existing getProgress()/
   getCycleTime(), no core changes needed) and check the recipe's full
   cost against live stock before committing — short on either input
   spends nothing and leaves progress exactly where it was (same
   binary/frozen rule as js/core/toolUse.js's tool consumer; the two
   are independent implementations of the same rule since one is a
   single derived resource id and the other is a multi-resource
   recipe, not worth a shared abstraction for ~8 lines each).

   Gold starvation is a FULL stop here (unlike Smelter's partial
   burn-through) — a starved bench's cycle simply doesn't advance.

   Billing: a bench with workers present but currently frozen on an
   input shortfall is exempt from gold upkeep for that tick (same
   "don't pay for standing around doing nothing" rule Tents and
   Smelter Shack already both apply) — see billableWorkers().
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'toolshed';
  const INPUT_CAP = 3;      // structural cap on derived input rows per bench

  // One recipe per tool tier. cycleTime is seconds of accumulated
  // worker progress per tool; tier is the roman numeral shown in the
  // bench header's pill and title. Carried as data rather than derived
  // from an ['I','II',...] table because three such tables already
  // exist (cards.js, marketstall.js, toolUse.js) and a fourth copy
  // isn't worth two known values.
  const RECIPES = {
    tools2: { name: 'Tools II', tier: 'II', cycleTime: 2, inputs: [{ id: 'wood', amt: 1 }, { id: 'stone', amt: 2 }] },
    tools3: { name: 'Tools III', tier: 'III', cycleTime: 10, inputs: [{ id: 'wood', amt: 1 }, { id: 'copperhead', amt: 1 }] }
  };
  // The shed's benches, in display order. One per tool, fixed.
  const BENCHES = ['tools2', 'tools3'];

  let benches = [];
  let goldStarved = false;

  function pool() { return window.OrbWeaver.Workers; } // Camp's default pool

  function makeBench(res) {
    const cyc = window.OrbWeaver.Cycles.create(RECIPES[res].cycleTime || 1);
    return { workers: 0, res, cyc, starved: false };
  }
  function seed() { benches = BENCHES.map(makeBench); }

  /* ---- Worker sub-slots (same rules as Smelter Shack/Gold Panning,
     adapted to Camp's default pool instead of Mountains') ---- */
  function usedWorkers() { return benches.reduce((sum, b) => sum + b.workers, 0); }
  function billableWorkers() { return benches.reduce((sum, b) => sum + (b.starved ? 0 : b.workers), 0); }
  function freeCardWorkers() { return pool().getAssigned(ID) - usedWorkers(); }

  function subAssign(idx) {
    const b = benches[idx];
    if (!b) return;
    if (freeCardWorkers() <= 0) { if (!pool().assign(ID)) return; }
    b.workers++;
    mechanic.lastSub = idx;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  function subUnassign(idx) {
    const b = benches[idx];
    if (!b || b.workers <= 0) return;
    b.workers--;
    pool().unassign(ID); // a modal − returns the worker to idle (fires the card refresh)
  }
  // Card-face stepper shrinking below sum-of-benches: clamp greedily,
  // earlier benches keep priority (same convention as every other
  // sub-slot card in the game).
  pool().onChange(() => {
    let budget = pool().getAssigned(ID);
    benches.forEach((b) => { const keep = Math.min(b.workers, budget); b.workers = keep; budget -= keep; });
  });

  /* ---- Per-bench tick: binary recipe gate, peek-before-commit ---- */
  function tickBench(b, tickRate, goldAvailable) {
    if (b.workers <= 0) { b.starved = false; return; }
    if (!goldAvailable) return; // full stop: frozen exactly where it is

    const recipe = RECIPES[b.res];
    const addAmount = window.OrbWeaver.Upgrades.workerRate(b.workers, 1, 1, 0) * tickRate;
    const wouldBe = Math.floor((b.cyc.getProgress() + addAmount) / b.cyc.getCycleTime());
    if (wouldBe <= 0) { b.cyc.advance(addAmount, 1); b.starved = false; return; }

    const affordable = recipe.inputs.every((inp) => window.OrbWeaver.Resources.available(inp.id) >= inp.amt * wouldBe);
    if (!affordable) { b.starved = true; return; } // frozen: advance() never called

    recipe.inputs.forEach((inp) => window.OrbWeaver.Resources.spend(inp.id, inp.amt * wouldBe));
    b.cyc.advance(addAmount, 1);
    window.OrbWeaver.Resources.add(b.res, wouldBe);
    window.OrbWeaver.Resources.reveal(b.res); // stays hidden until the player has actually acquired one
    b.starved = false;
  }

  /* ---- Card face ---- */
  function activeBenchCount() { return benches.filter((b) => b.workers > 0 && b.res && !b.starved).length; }

  /* ---- Modal ---- */
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  const fmt = (v) => window.OrbWeaver.Upgrades.formatRate(v);

  /* An input the player can't cover even one tool's worth of. This is a
     display-level test; the tick's own gate above is per-completion
     (inp.amt * wouldBe), so a bench can briefly be starved with no row
     flagged when several completions come due at once. The rows still
     read correctly in that case — nothing is actually exhausted. */
  function isShort(inp) { return window.OrbWeaver.Resources.available(inp.id) < inp.amt; }

  function outputRateText(b) {
    if (b.workers <= 0) return '';
    if (goldStarved) return 'Stopped – Missing Gold Coins';
    if (b.starved) return 'Stopped – Missing resource';
    const cycleTime = RECIPES[b.res].cycleTime || 1;
    const toolsPerSec = window.OrbWeaver.Upgrades.workerRate(b.workers, 1, 1, 0) / cycleTime;
    return `${fmt(toolsPerSec)} tools/s`;
  }
  /* Input rows never say 'Stopped' — the player has to be able to read
     what a bench needs while it is stopped, which is exactly when that
     matters most. A row short of its own resource flags itself; the
     progress box below names the stop cause. */
  function inputRateText(b, inp) {
    const name = window.OrbWeaver.Resources.getName(inp.id);
    if (b.workers <= 0) return `${inp.amt} ${name}`;
    if (b.starved && isShort(inp)) return `${inp.amt} ${name} – Missing`;
    return `${fmt(window.OrbWeaver.Upgrades.workerRate(b.workers, 1, 1, 0) * inp.amt)} ${name.toLowerCase()}/s`;
  }

  function stepperRow(idx, workers) {
    return `<div class="card-steppers visible">
      <button class="card-stepper-btn" data-ts-minus="${idx}" ${workers <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-ts-val="${idx}">${workers}</span>
      <button class="card-stepper-btn" data-ts-plus="${idx}">+</button>
    </div>`;
  }
  function inputRow(b, idx, inp) {
    return `<div class="ts-input-row">
      <span class="ts-rate-line" data-ts-input-rate="${idx}:${inp.id}">${inputRateText(b, inp)}</span>
    </div>`;
  }
  // Rate readout + cycle progress bar, its own box below the input
  // resources — hidden until a tier is chosen, same as the input box.
  // The bar itself uses data-extra-track (Gold Panning's own idiom) so
  // the shared rAF smoothing engine drives it via getExtraBars() below
  // — a manually-patched width here would collide with the smoothing
  // loop's own top-bar selector (Tool Shed's top bar is a fixed 0%
  // stub with no data-track, and that loop's fallback selector matches
  // ANY untracked .detail-progress-bar, so a hand-set width keeps
  // getting reset to 0 moments later).
  function progressBox(b, idx) {
    return `<div class="ts-box ts-box-progress">
      <div class="ts-rate-line" data-ts-rate="${idx}">${outputRateText(b)}</div>
      <div class="detail-progress-wrap"><div class="detail-progress-bar ts-progress-bar" data-extra-track="ts-bench-${idx}"></div></div>
    </div>`;
  }
  // The header is the only thing naming a bench now, so it carries the
  // stepper, the tier pill and the title in that order. They share one
  // wrapper because .hs-head is justify-content:space-between — three
  // bare children would spread across the full width instead of
  // grouping left.
  function benchCard(b, idx) {
    const recipe = RECIPES[b.res];
    return `<div class="hs-card ts-bench" data-ts-bench="${idx}">
      <div class="hs-head">
        <div class="ts-head-controls">
          ${stepperRow(idx, b.workers)}
          <span class="card-tier-pill">${recipe.tier}</span>
          <span class="hs-title">Tier ${recipe.tier} tools</span>
        </div>
      </div>
      <div class="hs-body">
        <div class="ts-box ts-box-input">${recipe.inputs.slice(0, INPUT_CAP).map((inp) => inputRow(b, idx, inp)).join('')}</div>
        ${progressBox(b, idx)}
      </div>
    </div>`;
  }

  /* ---- Resource tracker strip (top of modal, Smelter Shack's own
     idiom) — Wood, Stone, and Copper Tool Head stock, live every tick via
     patchLiveTrack(). Unlike Smelter's strip (always all 3 rows),
     each row here only appears once the player has actually revealed
     that resource elsewhere (Copper Tool Head stays out until acquired,
     same rule as the sidebar) — so the visible set can change mid-game
     (e.g. a cheat revealing it while the modal's open).
     resBarKeysAtRender tracks what was last rendered so patchLiveTrack
     can detect that and trigger a structural rebuild instead of
     patching values into rows that don't exist yet. */
  const RES_BAR = [
    { key: 'wood', label: 'Wood' },
    { key: 'stone', label: 'Stone' },
    { key: 'copperhead', label: 'Copper Tool Head' }
  ];
  let resBarKeysAtRender = null;
  function resBarVisible() { return RES_BAR.filter((r) => !window.OrbWeaver.Resources.isHidden(r.key)); }
  function resBar() {
    const rows = resBarVisible();
    resBarKeysAtRender = rows.map((r) => r.key).join(',');
    if (!rows.length) return '';
    return `<div class="ts-resbar"><div class="ts-resbar-item">${rows.map((r) => `<div class="ts-resbar-stat">
      <span class="ts-resbar-label">${r.label}</span>
      <span class="ts-resbar-amt" data-ts-res-amt="${r.key}">${Math.round(window.OrbWeaver.Resources.get(r.key))}</span>
    </div>`).join('')}</div></div>`;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Camp',
    modalWide: true, // two benches per row, same as Smelter Shack/Scout Stable
    cardName: () => 'Tool Shed',
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots: () => benches.map((b, i) => i), subAdd: subAssign,
    getStatText() {
      if (pool().getAssigned(ID) === 0) return '';
      if (goldStarved) return 'Stopped';
      const n = activeBenchCount();
      return n > 0 ? `Crafting – ${n} bench${n > 1 ? 'es' : ''}` : 'Stopped';
    },
    getUpgradeBarPct: () => 0,
    // Each bench's own cycle progress is a modal-only extra bar (Gold
    // Panning's per-station idiom) — no single card-face bottom bar
    // would represent one bench per tool tier well.
    getExtraBars: () => benches.map((b, i) => ({ id: `ts-bench-${i}`, pct: b.cyc.getPct() })),
    getBillableCount: () => billableWorkers(),
    renderModalHTML: () => `<div class="bench-modal">${resBar()}<div class="ts-grid">${benches.map(benchCard).join('')}</div></div>`,
    // Re-wire hold-to-repeat onto every bench's stepper after each render.
    afterRender() {
      const body = document.getElementById('card-modal-body');
      if (!body) return;
      body.querySelectorAll('[data-ts-minus]').forEach((btn) => {
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => subUnassign(+btn.dataset.tsMinus));
      });
      body.querySelectorAll('[data-ts-plus]').forEach((btn) => {
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => subAssign(+btn.dataset.tsPlus));
      });
    },
    // Patch live values in place every tick. The only structural change
    // left is the resource strip gaining a row, handled below.
    patchLiveTrack() {
      const liveKeys = resBarVisible().map((r) => r.key).join(',');
      if (liveKeys !== resBarKeysAtRender) { window.OrbWeaver.Cards.refreshOpenModal(ID); return; }
      RES_BAR.forEach((r) => {
        const el = q(`[data-ts-res-amt="${r.key}"]`);
        if (el) el.textContent = Math.round(window.OrbWeaver.Resources.get(r.key));
      });
      benches.forEach((b, idx) => {
        const val = q(`[data-ts-val="${idx}"]`); if (val) val.textContent = b.workers;
        const minus = q(`[data-ts-minus="${idx}"]`); if (minus) minus.disabled = b.workers <= 0;
        const rate = q(`[data-ts-rate="${idx}"]`); if (rate) rate.textContent = outputRateText(b);
        RECIPES[b.res].inputs.forEach((inp) => {
          const el = q(`[data-ts-input-rate="${idx}:${inp.id}"]`);
          if (el) el.textContent = inputRateText(b, inp);
        });
      });
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      benches.forEach((b) => tickBench(b, tickRate, goldAvailable));
      window.OrbWeaver.Cards.refresh(mechanic);
    },
    _debug: { seed, benches: () => benches, subAssign, subUnassign, freeCardWorkers, RECIPES, BENCHES, inputRateText, outputRateText }
  };

  /* ---- Save/load ---- Seed only: worker count and cycle progress per
     bench. A bench's tool is NOT saved — it is a constant of BENCHES,
     not player state, so it replays from source and a later reorder or
     rebalance reaches existing saves on next load.
     The bench list is always rebuilt from BENCHES rather than from the
     save's own length, so no save shape can produce a bench without a
     tool; extra entries are simply ignored. */
  window.OrbWeaver.Save.register(ID,
    () => ({ bn: benches.map((b) => ({ w: b.workers, cp: b.cyc.serialize() })) }),
    (d) => {
      seed();
      if (!d || !d.bn) return;
      benches.forEach((b, i) => {
        const bv = d.bn[i];
        if (!bv) return;
        b.workers = bv.w || 0;
        b.cyc.deserialize(bv.cp || 0);
      });
    });
  window.OrbWeaver.Mechanics.register(mechanic);

  // Seed the starting benches at load (a fresh game); a save load
  // replaces them above.
  seed();
})();
