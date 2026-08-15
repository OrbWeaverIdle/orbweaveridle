/* ============================================================
   MECHANIC: ACADEMY (Camp)
   Built via Camp's Construction list (550 wood, 550 stone). Two
   independent tracks off one worker pool — deliberately the reverse
   of the usual top/bottom convention:

   1) Research Progress (TOP bar, choice track) — one-time Research
      Topics, costed in Journals, each with a cross-mechanic effect
      (growing Market's bundle sizes, raising its concurrent sale
      slots, and — later — unlocking higher-tier conversion recipes
      below). Reuses the same choice-track factory Camp's own
      Construction list uses, just costed in Journals instead of camp
      resources.

   2) Papers → Journals (BOTTOM bar, conversion track) — Research
      Papers convert into Journals on a timer, via the shared
      Upgrades.createConversionTrack() factory (js/core/upgrades.js).
      Flat cost/time — no escalation. Recipes start locked except the
      first; Research Topics above can unlock further tiers later
      (e.g. a higher-grade Papers type → more Journals per batch).
      Auto-toggle and the concurrent-slot count are inherited from the
      factory for free, same as Market's sell cards.

   Research Papers has no producer yet — Mountains and the upcoming
   pyramid card will add one in a later session. The resource exists
   now (hidden until Academy is built) purely so this card's recipe
   has something to check against; cheat buttons (Journals, Research
   Papers) exist in the meantime so Academy is testable on its own.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'academy';

  // Research Topics — Journals-costed, one-time unlocks. Placeholder
  // costs/times, freely editable, same convention as every other
  // invented number in this project.
  const RESEARCH_TOPICS = [
    { id: 'woodbundle2', name: 'Bulk Wood Trade', buildTime: 30, costRaw: '5 journals', startAvailable: true,
      apply: () => window.OrbWeaver.Market.growBundle('wood', [200, 500]) },
    { id: 'woodbundle3', name: 'Mass Wood Trade', buildTime: 60, costRaw: '10 journals', startAvailable: true,
      apply: () => window.OrbWeaver.Market.growBundle('wood', [500, 1000]) },
    { id: 'marketslot2', name: 'Second Sale Slot', buildTime: 45, costRaw: '15 journals', startAvailable: true,
      apply: () => window.OrbWeaver.Market.setMaxConcurrent(2) },
    { id: 'marketslot3', name: 'Third Sale Slot', buildTime: 90, costRaw: '20 journals', startAvailable: true,
      apply: () => window.OrbWeaver.Market.setMaxConcurrent(3) }
  ];
  function onTopicComplete(id, item) { item.apply(); }
  const topicsTrack = window.OrbWeaver.Upgrades.createChoiceTrack(RESEARCH_TOPICS, onTopicComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:topics`, topicsTrack);

  // Papers → Journals conversion. Flat cost/time — no escalation.
  // 25 Research Papers per Journal, placeholder 20s batch time.
  const CONVERSION_RECIPES = [
    { id: 'papers1', name: 'Research Papers', costRaw: '25 researchpapers', buildTime: 20,
      outputId: 'journals', outputAmount: 1, outputName: 'Journal', startUnlocked: true }
  ];
  const conversionTrack = window.OrbWeaver.Upgrades.createConversionTrack(CONVERSION_RECIPES, {
    getAssigned: () => window.OrbWeaver.Workers.getAssigned(ID),
    getSPW: () => window.OrbWeaver.Upgrades.getBaseSPW()
  });
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:conversion`, conversionTrack);

  let opened = false;
  let goldStarved = false;

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Camp',
    upgradeTrackKey: 'topics',
    buildTrackKey: 'conversion',
    cardName: () => 'Academy',
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Research and development';
      if (goldStarved && window.OrbWeaver.Workers.getAssigned(ID) > 0) return 'Stopped';
      const rem = conversionTrack.getSoonestRemaining();
      return rem != null ? `Converting – ${Math.ceil(rem)}s` : '';
    },
    getUpgradeBarPct: () => topicsTrack.getProgressPct(),
    getBuildBarPct: () => conversionTrack.getBuildBarPct(),
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Converts ${window.OrbWeaver.Upgrades.formatRate(assigned * window.OrbWeaver.Upgrades.getBaseSPW())}s faster`;
    },
    cheatCompleteAll() { topicsTrack.completeAll(); },
    patchLiveTrack() { topicsTrack.patchModalRows(); conversionTrack.patchDOM(); },
    renderModalHTML() {
      return `<div class="academy-modal">` +
        `<div class="modal-subsection-label">Research Progress</div>${topicsTrack.renderModalRows(ID, 'topics')}` +
        `<div class="modal-subsection-label divider-top">Conversion</div>${conversionTrack.renderCards(ID, 'conversion')}` +
      `</div>`;
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (goldAvailable) {
        if (topicsTrack.isBuilding()) topicsTrack.advanceTimer(tickRate, assigned, window.OrbWeaver.Upgrades.getBaseSPW());
        conversionTrack.tick(tickRate);
      }
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ----
     Both tracks save themselves. Completed Research Topics replay their
     apply() on load, which is how their cross-mechanic effects (Market
     bundle growth, extra sale slots) are restored — the effect is
     recomputed from the fact that the topic was researched, never
     stored as a number. */
  window.OrbWeaver.Save.register(ID,
    () => ({ o: opened ? 1 : 0 }),
    (d) => { opened = !!d.o; });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
