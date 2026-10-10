/* ============================================================
   MECHANIC: RICH UNCLE (Camp)
   Camp's copy of the reusable Rich Uncle factory (js/core/richuncle.js).
   Draws from Camp's own default worker pool. Appears directly after
   Camp's own card in #grid-camp (see main.js).

   Two steps, checked in order (first match wins, so a brand-new
   player meets STEP_TWO_BUILDS before ever seeing STEP_LOW_GOLD):

   1. STEP_TWO_BUILDS — the very first tutorial moment, one-time only.
   2. STEP_LOW_GOLD — gold has run low and Gold Panning doesn't exist
      yet, repeatable for as long as both conditions hold. The moment
      Mountains is discovered, this Camp copy hands off to the
      Mountains copy (richuncle_mountains.js) — abortCondition cancels
      an in-progress build with no payout, since nothing was ever
      spent to start it.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  // Rich Uncle's very first tutorial moment: once the player has
  // completed any 2 of Camp's 5 Construction items (any order — see
  // buildersbench.js's CONSTRUCTION_ITEMS), he explains a few basics
  // and pays out 1000 gold once every box is checked. One-time only —
  // once done, doneForever keeps it from ever firing again.
  const STEP_TWO_BUILDS = {
    id: 'twobuilds',
    trigger: () => window.OrbWeaver.Upgrades.getTrack('buildersbench:build').builtCount() >= 2,
    repeatable: false,
    message: "I see you're spending my money already. I hope this little adventure of yours is worth the investment.<br><br>Confirm you understand the following and I'll hand over a few extra coins (1000 gold).",
    checks: [
      '1 worker costs 1 gold a second.',
      'Almost nothing gets done without a worker assigned.',
      'More workers means faster production. With diminishing returns.',
      'Build tents for more workers, tents cost more each time.',
      "Read what's in the windows when you open them. You'll be confused if you don't."
    ],
    buildTime: 8,
    reward: 1000,
    faceIdle: 'Click me',
    faceReady: 'Assign worker in window',
    faceBuilding: 'Handshake'
  };

  const STEP_LOW_GOLD = {
    id: 'lowgold',
    trigger: () =>
      window.OrbWeaver.Resources.get('gold') <= 2000 &&
      !window.OrbWeaver.Mechanics.get('goldpanning').revealed &&
      !window.OrbWeaver.Mountains.isDiscovered(),
    abortCondition: () => window.OrbWeaver.Mountains.isDiscovered(),
    repeatable: true,
    message: "You need to pay better attention to your spending. I won't be around forever, you know? Here's a bag of gold but be more fiscally responsible.",
    checks: [],
    buildTime: 8,
    reward: 5000,
    faceIdle: 'Click me',
    faceBuilding: 'Handshake'
  };

  window.OrbWeaver.RichUncle.create({
    id: 'richuncle_camp',
    section: 'Camp',
    steps: [STEP_TWO_BUILDS, STEP_LOW_GOLD]
  });
})();
