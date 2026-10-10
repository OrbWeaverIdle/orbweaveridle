/* ============================================================
   CORE: TOOL USE
   Two independent pieces for the tool-tier system (see TOOLSHED-
   HANDOFF.md): a binary tool-consumption accumulator any future
   mechanic.toolTier card can use, and the modal header tier-pips
   generator (mechanic.getSubtitleHtml()).

   ---- Consumption ----
   createConsumer() hands back one accumulator a card holds onto for
   its own lifetime (same shape as js/core/cycles.js's create() —
   Gold Panning's stations each keep their own `cyc` the same way).
   tick(prefix, tier, workers, tickRate) derives the resource id
   (prefix + 'tools' + tier, e.g. 'mtn_' + 2 -> 'mtn_tools2'), banks
   workers' demand at the standard 1-tool-per-worker/s baseline
   (Upgrades.workerRate(workers,1,1,0)), and only ever spends WHOLE
   tools, billed as each one is worn through.

   Tool in hand: a worker must hold a whole tool to do any work at
   all, so every tick checks the live stock (via Cycles' own
   getProgress()/getCycleTime(), no changes needed to cycles.js
   itself) for at least one tool, plus enough to cover whatever whole
   tools this tick would finish off. An empty stock therefore starves
   the very first tick rather than letting a sub-whole-tool window of
   free work through first. A shortfall leaves the accumulator exactly
   where it was — no partial credit, no banked debt — and progress
   resumes from that frozen point once tools are available again. A
   fractional stock below one whole tool never satisfies the gate.

   isStarved() reports the verdict of the LAST tick() — deliberately a
   record, not a live stock re-check: immediately after a purchase the
   stock can read zero, and the worker who earned that consumption must
   still be billed for the second they worked. A mechanic exposes its
   consumer as mechanic.toolConsumer so upkeep.js can skip gold for
   tool-starved workers (see its header); that hook covers tool
   shortage only, so a card also stopping for gold or cap reasons keeps
   its own isBillable() for those.

   The caller decides whether to call tick() at all on a given tick —
   there's no goldAvailable parameter here. A card already branches on
   its own gold/cap state before deciding whether production would
   happen this tick (see quarry.js); tool consumption only needs to
   run inside that same branch, so skipping the call IS the pause.

   workers <= 0 is a no-op (no bank, no spend, not reported as
   starved) — same "workers ARE the clock" rule every other timer in
   the game follows.

   ---- Header tier-pips ----
   getSubtitleHtml(requiredTier) renders into mechanic.getSubtitleHtml()
   / #card-modal-header-sub (see market.js for the existing hook this
   reuses verbatim — no new plumbing). Crossed-out pills for every
   tier below the requirement, then the real (highlighted) pill reusing
   .card-tier-pill as-is so its color still cascades from the section's
   --tier, then the text label. Display-only, non-interactive — a
   future multi-tier-eligible card is a deliberately deferred reshape
   of mechanic.toolTier into an array (see not_yet_implemented), not
   something this generator needs to anticipate today.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const TIER_NUMS = ['I', 'II', 'III', 'IV', 'V'];

  function createConsumer() {
    const cyc = window.OrbWeaver.Cycles.create(1); // cycleTime 1 -> one bank = one whole tool
    let starved = false;
    const done = (s) => ({ starved: (starved = s) }); // record every verdict on the way out

    function tick(prefix, tier, workers, tickRate) {
      if (workers <= 0) return done(false);
      const resId = prefix + 'tools' + tier;
      const addAmount = window.OrbWeaver.Upgrades.workerRate(workers, 1, 1, 0) * tickRate;

      // Tool in hand: a worker needs a whole tool in stock to do any work
      // at all, on top of covering whatever whole tools this tick would
      // finish off (peeked via cyc's own getters, cycleTime fixed at 1).
      const wouldBe = Math.floor((cyc.getProgress() + addAmount) / cyc.getCycleTime());
      const have = window.OrbWeaver.Resources.exists(resId) ? window.OrbWeaver.Resources.available(resId) : 0;
      if (have < Math.max(1, wouldBe)) return done(true); // frozen: advance() never called, progress untouched
      if (wouldBe > 0) window.OrbWeaver.Resources.spend(resId, wouldBe);
      // Affordable — commit the real bank. Passing (addAmount, 1) banks
      // exactly addAmount, since addAmount already folds tickRate in.
      cyc.advance(addAmount, 1);
      return done(false);
    }

    return { tick, isStarved: () => starved, serialize: () => cyc.serialize(), deserialize: (v) => cyc.deserialize(v) };
  }

  function getSubtitleHtml(requiredTier) {
    const crossed = [];
    for (let t = 1; t < requiredTier; t++) {
      crossed.push(`<div class="card-tier-pill tier-pip-crossed">${TIER_NUMS[t - 1]}</div>`);
    }
    const real = `<div class="card-tier-pill">${TIER_NUMS[requiredTier - 1]}</div>`;
    return `<div class="tool-pips-row">${crossed.join('')}${real}<span class="tool-pips-label">Requires Tier ${TIER_NUMS[requiredTier - 1]} tools</span></div>`;
  }

  window.OrbWeaver.ToolUse = { createConsumer, getSubtitleHtml };
})();
