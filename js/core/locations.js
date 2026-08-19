/* ============================================================
   CORE: LOCATIONS
   Generic registry of cargo destinations. A location is anything
   exposing id/label/prefix/isDiscovered()/addWorkers()/ensureResource()
   — Camp registers itself here too (prefix '', always discovered) so
   other locations' Scout Stables can send cargo home. Any Scout
   Stable's dropdown is "every registered location except me."
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const locations = {};

  function register(loc) { locations[loc.id] = loc; }
  function get(id) { return locations[id] || null; }
  function all() { return Object.values(locations); }
  function destinationsFor(selfId) {
    return all().filter((l) => l.id !== selfId && l.isDiscovered());
  }

  window.OrbWeaver.Locations = { register, get, all, destinationsFor };
})();
