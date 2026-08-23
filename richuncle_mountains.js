/* ============================================================
   MECHANIC: RICH UNCLE (Mountains)
   Mountains' copy of the reusable Rich Uncle factory (js/core/richuncle.js).
   Draws from Mountains' own worker pool (wired in main.js, after
   mountains.js has created it — see goldpanning.js/smeltershack.js for
   the same pattern: a plain workerPool property assigned post-load,
   not a getter). Appears directly after the Mountains card itself in
   #grid-mountains (see main.js).

   Same step and content as richuncle_camp.js's STEP_LOW_GOLD (kept as
   its own small copy per-file, matching how e.g. quarry.js owns its
   own numbers rather than reaching into stone.js) — only the trigger
   differs: active once Mountains has been discovered instead of
   before. No abortCondition needed here; once Mountains is discovered
   it stays discovered, so there's nothing to hand off away from.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const STEP_LOW_GOLD = {
    id: 'lowgold',
    trigger: () =>
      window.OrbWeaver.Resources.get('gold') <= 2000 &&
      !window.OrbWeaver.Mechanics.get('goldpanning').revealed &&
      window.OrbWeaver.Mountains.isDiscovered(),
    repeatable: true,
    message: "You need to pay better attention to your spending. I won't be around forever, you know? Here's a bag of gold but be more fiscally responsible.",
    checks: [],
    buildTime: 8,
    reward: 5000,
    faceIdle: 'Click me',
    faceBuilding: 'Handshake'
  };

  window.OrbWeaver.RichUncle.create({
    id: 'richuncle_mountains',
    section: 'Mountains',
    steps: [STEP_LOW_GOLD]
  });
})();
