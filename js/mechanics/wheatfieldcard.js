/* ============================================================
   MECHANIC: WHEAT FIELD (Mountains)
   Revealed once Mountains' Wheat Field build completes (see
   js/mechanics/mountains.js). Self-contained card, same shape as
   mpftest.js: own live-patched modal, own save entry. A smaller
   sibling of the Mountains card's own sub-slot architecture
   (mountains_sub_slots) — the card-face/header stepper assigns
   workers to the CARD; two in-modal sub-slots (Wheat Bundle, Seed
   Bundle) each draw their own worker count from those free card
   workers, auto-promoting from the wider Mountain pool if none are
   free. No card-level getWorkerDesc() — each sub-slot shows its own
   rate next to its own stepper instead, exactly like Mountains.

   GROWTH (fields, passive): each field grows PER_FIELD wheat/sec via
   plain multiplication — fields are not workers, so growth never uses
   Upgrades.workerRate and is NOT gold-gated. Wheat is capped at CAP
   (flat, doesn't scale with fields); growth keeps running at the cap
   and the excess is lost. Wheat is modal-only — never a left-hand
   Resources row.

   WHEAT BUNDLE sub-slot (workers, gold-gated): turns wheat into a
   cumulative throughput counter (0..BUNDLE_CAP), not a pool snapshot,
   at Upgrades.workerRate(pm/pp/pf) — baseline 1/s/worker, global
   +M/+P/+F stacks in automatically. Each time it fills, +1 delivers to
   Mountains' left-hand group (mtn_wheatbundle) and the remainder
   carries into the next bundle (overflow, never holds at cap).

   SEED BUNDLE sub-slot (workers, gold-gated): turns wheat into a
   second counter (0..seedCap, starts at SEED_CAP_START) at its own
   Upgrades.workerRate(sm/sp/sf). Unlike Wheat Bundle, it HOLDS at cap
   — processing idles once full rather than overflowing — so it's only
   ever pressable at exactly cap, never past it. Pressing Seed empties
   it, adds one field (+PER_FIELD wheat/sec), and grows seedCap by
   SEED_GROWTH (rounded to an integer) for next time. Manual only,
   never auto-pressed.

   Both sub-slots pull from the SAME shared wheat pool in the SAME tick —
   when there's enough wheat for both, each gets its full ask; when there
   isn't, the shortfall splits proportionally to demand, so staffing both
   always makes both progress (never a first-come-first-served drain
   where one silently starves the other).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'wheatfieldcard';
  const CAP = 500;              // wheat pool cap (modal-only, flat regardless of fields)
  const PER_FIELD = 0.63;       // wheat/sec per field
  const BUNDLE_CAP = 5000;      // wheat per finished Wheat Bundle
  const SEED_CAP_START = 2500;  // Seed Bundle's starting cap
  const SEED_GROWTH = 1.09;     // Seed Bundle cap multiplier per Seed press
  const BLOCKS = 24;            // Concept-10 ASCII bar width (Wheat gauge)
  const SEED_BAG_BLOCKS = 16;   // Seed bag bar — 33% smaller than BLOCKS
  const WHEAT_BUNDLE_BLOCKS = 32; // Wheat bundle bar — 33% larger than BLOCKS
  const pool = window.OrbWeaver.Mountains.workerPool;

  let wheat = 0;
  let fields = 1;
  let bundle = 0;                        // Wheat Bundle throughput (overflows)
  let pm = 1, pp = 1, pf = 0;            // Wheat Bundle processing dials (local m/p/f)
  let seedBundle = 0;                    // Seed Bundle throughput (holds at seedCap)
  let seedCap = SEED_CAP_START;
  let sm = 1, sp = 1, sf = 0;            // Seed Bundle processing dials (local m/p/f)
  let wbWorkers = 0, sbWorkers = 0;      // sub-slot worker counts (subset of pool.getAssigned(ID))
  let RES = null;                        // 'mtn_wheatbundle' — created lazily on first delivery

  // A finished Wheat Bundle is delivered as +1 to Mountains' left-hand
  // group. The row is created on first delivery and rebuilt from the
  // save on load (dynamic mtn_-prefixed resource, restored through Mountains).
  function deliverBundle() {
    if (!RES) RES = window.OrbWeaver.Mountains.ensureResource('wheatbundle', 'Wheat Bundle');
    window.OrbWeaver.Resources.add(RES, 1);
  }

  const growthRate = () => fields * PER_FIELD;
  const wbRate = () => window.OrbWeaver.Upgrades.workerRate(wbWorkers, pm, pp, pf);
  const sbRate = () => window.OrbWeaver.Upgrades.workerRate(sbWorkers, sm, sp, sf);
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);

  // Sub-slot workers actually assigned right now vs. the card's total
  // assignment — the difference is idle-on-card-face, awaiting a slot.
  function freeCardWorkers() { return pool.getAssigned(ID) - wbWorkers - sbWorkers; }

  // Add/remove a worker to/from a sub-slot (wheatbundle | seedbundle).
  // Draws from the card's own free workers first; if none are free,
  // auto-promotes one from the wider Mountain pool onto this card, then
  // into the sub-slot, in the same click (mountains_sub_slots pattern).
  function subAssign(slot) {
    if (freeCardWorkers() <= 0) {
      if (!pool.assign(ID)) return; // Mountain pool empty — do nothing
    }
    if (slot === 'wheatbundle') wbWorkers++;
    else if (slot === 'seedbundle') sbWorkers++;
    else return;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  function subUnassign(slot) {
    if (slot === 'wheatbundle') { if (wbWorkers > 0) wbWorkers--; else return; }
    else if (slot === 'seedbundle') { if (sbWorkers > 0) sbWorkers--; else return; }
    else return;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  // Whenever the card's own assignment shrinks (e.g. the card-face
  // stepper removes a worker), clamp sub-slots so neither outlives its
  // backing assignment. Greedy: Wheat Bundle keeps priority.
  pool.onChange(() => {
    let budget = pool.getAssigned(ID);
    const keepWb = Math.min(wbWorkers, budget); wbWorkers = keepWb; budget -= keepWb;
    sbWorkers = Math.min(sbWorkers, budget);
  });

  function ascii(cur, cap, blocks) {
    blocks = blocks || BLOCKS;
    const pct = cap ? Math.min(100, (cur / cap) * 100) : 0;
    const filled = Math.round((pct / 100) * blocks);
    return `<span class="wf-bar">${'█'.repeat(filled)}</span><span class="wf-bar-empty">${'█'.repeat(blocks - filled)}</span> <span class="wf-tag">${Math.floor(pct)}%</span>`;
  }
  const wheatInfo = () => `Wheat <span class="wf-tag">${Math.floor(wheat)}/${CAP}</span> · Growth <span class="wf-tag">+${growthRate().toFixed(2)}/s</span>`;
  const bundleInfo = () => `Wheat bundle <span class="wf-tag">${Math.floor(bundle)}/${BUNDLE_CAP}</span>`;
  const seedInfo = () => `Seed bag <span class="wf-tag">${Math.floor(seedBundle)}/${seedCap}</span>`;

  // Seed button sits inline on the bar row. The bar content gets a
  // dedicated inner span ([data-wf-seed-bar-inner]) so patchLiveTrack
  // can update it without touching the Seed button beside it.
  function seedBarRowHtml() {
    return `<div class="wf-line wf-seed-row">
      <span data-wf-seed-bar-inner>${ascii(seedBundle, seedCap, SEED_BAG_BLOCKS)}</span>
      <span class="wf-seed-btn-wrap">
        <button class="wf-seed-btn" data-wf-action="seed" ${atSeedCap() ? '' : 'disabled'}>Seed</button>
      </span>
      <span class="wf-seed-hint">Growth +.63/s</span>
    </div>`;
  }

  function subStepperHtml(slot, count, rateText) {
    return `<div class="card-steppers visible" style="margin-top:4px">
      <button class="card-stepper-btn" data-wf-sub="${slot}" data-wf-sub-action="remove" ${count <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-wf-sub-val="${slot}">${count}</span>
      <button class="card-stepper-btn" data-wf-sub="${slot}" data-wf-sub-action="add">+</button>
      <span class="worker-desc" data-wf-rate="${slot}">${rateText}</span>
    </div>`;
  }

  // Live rate text for a sub-slot's stepper row. Verb defaults to
  // "Processing"; Seed bag uses "Threshing" instead (see call site).
  function subRateText(n, rate, verb) {
    return n === 0 ? '' : `${verb || 'Processing'} ${window.OrbWeaver.Upgrades.formatRate(rate)}/s`;
  }
  // Live-patches a sub-slot's count/disabled state in place.
  function patchSubSlot(slot, count) {
    const valEl = q(`[data-wf-sub-val="${slot}"]`);
    if (valEl) valEl.textContent = count;
    const minusBtn = q(`[data-wf-sub="${slot}"][data-wf-sub-action="remove"]`);
    if (minusBtn) minusBtn.disabled = count <= 0;
  }

  const atSeedCap = () => seedBundle >= seedCap;

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    workerPool: pool,
    cardName: () => 'Wheat Field',
    getStatText: () => atSeedCap() ? 'Seeding ready' : `Growing – ${Math.floor(wheat)}/${CAP} (+${growthRate().toFixed(2)}/s)`,
    // Top bar: Seed Bundle's progress toward its cap, in Mountains' blue
    // (upgradeBarTiered). Bottom bar: Wheat Bundle's progress toward its
    // cap. Both hide entirely at 0% and fade while their sub-slot has no
    // workers assigned, rather than staying a flat static-color fill.
    upgradeBarTiered: true,
    getUpgradeBarPct: () => (seedBundle / seedCap) * 100,
    getBuildBarPct: () => (bundle / BUNDLE_CAP) * 100,
    hideUpgradeBar: () => seedBundle <= 0,
    hideBuildBar: () => bundle <= 0,
    isUpgradeCollecting: () => sbWorkers === 0,
    isBuildBarFaded: () => wbWorkers === 0,
    // Seed Bundle workers stop billing gold the moment the bundle is at
    // cap (idle, waiting for the Seed press). Wheat Bundle bills normally.
    getBillableCount: () => wbWorkers + (atSeedCap() ? 0 : sbWorkers),
    renderModalHTML: () => `<div class="bench-modal">
      <div class="wf-block">
        <div class="wf-line" data-wf-bar>${ascii(wheat, CAP)}</div>
        <div class="wf-line" data-wf-info>${wheatInfo()}</div>
      </div>
      <div class="wf-block">
        ${seedBarRowHtml()}
        <div class="wf-line" data-wf-seed-info>${seedInfo()}</div>
        ${subStepperHtml('seedbundle', sbWorkers, subRateText(sbWorkers, sbRate(), 'Threshing'))}
      </div>
      <div class="wf-block">
        <div class="wf-line" data-wf-bundle-bar>${ascii(bundle, BUNDLE_CAP, WHEAT_BUNDLE_BLOCKS)}</div>
        <div class="wf-line" data-wf-bundle-info>${bundleInfo()}</div>
        ${subStepperHtml('wheatbundle', wbWorkers, subRateText(wbWorkers, wbRate()))}
      </div>
    </div>`,
    afterRender() {
      const body = document.getElementById('card-modal-body');
      if (!body) return;
      body.querySelectorAll('[data-wf-sub]').forEach((btn) => {
        const slot = btn.dataset.wfSub;
        const action = btn.dataset.wfSubAction;
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => {
          if (action === 'add') subAssign(slot); else subUnassign(slot);
        });
      });
    },
    patchLiveTrack() {
      const set = (sel, html) => { const e = q(sel); if (e) e.innerHTML = html; };
      set('[data-wf-bar]', ascii(wheat, CAP));
      set('[data-wf-info]', wheatInfo());
      set('[data-wf-bundle-bar]', ascii(bundle, BUNDLE_CAP, WHEAT_BUNDLE_BLOCKS));
      set('[data-wf-bundle-info]', bundleInfo());
      set('[data-wf-seed-bar-inner]', ascii(seedBundle, seedCap, SEED_BAG_BLOCKS));
      set('[data-wf-seed-info]', seedInfo());
      const seedBtn = q('[data-wf-action="seed"]');
      if (seedBtn) seedBtn.disabled = !atSeedCap();
      const wbRateEl = q('[data-wf-rate="wheatbundle"]');
      if (wbRateEl) wbRateEl.textContent = subRateText(wbWorkers, wbRate());
      const sbRateEl = q('[data-wf-rate="seedbundle"]');
      if (sbRateEl) sbRateEl.textContent = subRateText(sbWorkers, sbRate(), 'Threshing');
      patchSubSlot('wheatbundle', wbWorkers);
      patchSubSlot('seedbundle', sbWorkers);
    },
    // Cheat-only: instantly fills Seed Bundle to its current cap (see
    // cheats.js's Seed button) — same self-contained-mechanic pattern as
    // Wood/Stone/Quarry's bumpLocalP/bumpLocalF.
    cheatFillSeed: () => {
      seedBundle = seedCap;
      window.OrbWeaver.Cards.refresh(mechanic);
    },
    tick(goldAvailable, tickRate) {
      // Growth: passive, field-driven (not gold-gated). Excess above CAP lost.
      wheat = Math.min(CAP, wheat + growthRate() * tickRate);
      if (!goldAvailable) { window.OrbWeaver.Cards.refresh(mechanic); return; }
      // Both sub-slots draw from the SAME wheat pool in the SAME tick, so
      // staffing both actually splits the wheat between them. Each asks
      // for what it could use this tick (Wheat Bundle: uncapped/overflows;
      // Seed Bundle: capped at seedCap, so it stops asking once full).
      // When there's enough wheat for both, each gets its full ask; when
      // there isn't, the shortfall is split proportionally to demand —
      // never a first-come-first-served drain where one sub-slot silently
      // starves the other.
      const wbAsk = wbWorkers > 0 ? wbRate() * tickRate : 0;
      const sbAsk = sbWorkers > 0 ? Math.min(sbRate() * tickRate, seedCap - seedBundle) : 0;
      const totalAsk = wbAsk + sbAsk;
      const share = totalAsk > wheat ? wheat / totalAsk : 1;
      const wbGet = wbAsk * share;
      const sbGet = sbAsk * share;
      wheat -= wbGet + sbGet;
      bundle += wbGet;
      while (bundle >= BUNDLE_CAP) { bundle -= BUNDLE_CAP; deliverBundle(); }
      seedBundle += sbGet;
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wf-action="seed"]');
    if (!btn || seedBundle < seedCap) return;
    fields++;
    seedBundle = 0;
    seedCap = Math.round(seedCap * SEED_GROWTH);
    window.OrbWeaver.Footer.push('Seeded a new field.');
    window.OrbWeaver.Cards.refresh(mechanic);
  });

  // Seed: wheat, field count, both bundle throughputs, Seed Bundle's
  // current cap, both sub-slots' processing dials, and the sub-slot
  // worker split itself (a subset of what Mountains' pool already
  // saves — both must come back together or it silently drifts).
  window.OrbWeaver.Save.register(ID,
    () => ({
      w: wheat, fld: fields, b: bundle, pm, pp, pf,
      sb: seedBundle, sc: seedCap, sm, sp, sf,
      wbw: wbWorkers, sbw: sbWorkers
    }),
    (d) => {
      if (!d) return;
      wheat = d.w || 0;
      fields = d.fld != null ? d.fld : 1;
      bundle = d.b || 0;
      pm = d.pm != null ? d.pm : 1;
      pp = d.pp != null ? d.pp : 1;
      pf = d.pf != null ? d.pf : 0;
      seedBundle = d.sb || 0;
      seedCap = d.sc != null ? d.sc : SEED_CAP_START;
      sm = d.sm != null ? d.sm : 1;
      sp = d.sp != null ? d.sp : 1;
      sf = d.sf != null ? d.sf : 0;
      wbWorkers = d.wbw || 0;
      sbWorkers = d.sbw || 0;
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
