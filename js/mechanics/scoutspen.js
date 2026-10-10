/* ============================================================
   MECHANIC: SCOUT STABLE (Camp) — cardName only; id/file stay
   "scoutspen" (no rename requested beyond the display name).
   Thin config for the shared js/core/scoutstable.js factory. Camp is
   the only location with hasInitialExpedition: true — its one-time
   Expedition Mule is what discovers Mountains; every other location's
   Scout Stable (see js/mechanics/mountainsscoutstable.js) starts
   permanently on the greyed Expedition tab, since future Expeditions
   come from Academy research shared by every Scout Stable, not a
   per-location unlock.

   vehicleKinds order matters — the first kind renders as the left
   column in the Resupply tab (Mule left, Cart and Bull right).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  window.OrbWeaver.ScoutSpen = window.OrbWeaver.ScoutStable.create({
    id: 'scoutspen',
    locationId: 'camp',
    section: 'Camp',
    resourcePrefix: '',
    vehicleKinds: {
      mule:     { idBase: 'resupplymule', cap: 200,  travel: 15, label: 'Resupply Mule' },
      cartbull: { idBase: 'cartbull',     cap: 1000, travel: 60, label: 'Cart and Bull' }
    },
    hasInitialExpedition: true,
    expeditionMuleId: 'expeditionmule',
    expeditionTargetWood: 200,
    expeditionTravelTime: 30,
    onExpeditionComplete(ridersAway) {
      window.OrbWeaver.Mountains.reveal();
      window.OrbWeaver.Mountains.addWorkers(ridersAway);
      window.OrbWeaver.Footer.push('Expedition discovered the Mountains.');
    }
  });
})();
