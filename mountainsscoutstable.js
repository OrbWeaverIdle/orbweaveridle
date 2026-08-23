/* ============================================================
   MECHANIC: MOUNTAIN SCOUT STABLE
   Thin config for js/core/scoutstable.js — same "Scout Stable" card,
   same Resupply Mule / Cart and Bull cargo vehicles, as Camp's, just
   living in the Mountains section and drawing from Mountains' own
   worker pool and resource pool (mtn_ prefix). Revealed by Mountains'
   "Outpost on the Frontier" stage (see js/mechanics/mountains.js).
   No initial Expedition — every non-Camp Scout Stable starts (and
   stays) on the greyed Expedition tab; see js/core/scoutstable.js.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  window.OrbWeaver.ScoutStable.create({
    id: 'mtn_scoutstable',
    locationId: 'mountains',
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    resourcePrefix: window.OrbWeaver.Mountains.prefix,
    workerPool: window.OrbWeaver.Mountains.workerPool,
    vehicles: {
      mule:     { id: 'mtn_resupplymule', cap: 200,  travel: 15, label: 'Resupply Mule' },
      cartbull: { id: 'mtn_cartbull',     cap: 1000, travel: 60, label: 'Cart and Bull' }
    },
    hasInitialExpedition: false
  });
})();
