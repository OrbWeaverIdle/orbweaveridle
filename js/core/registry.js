/* ============================================================
   CORE: MECHANIC REGISTRY
   Tiny list of active mechanics. Mechanic files register themselves
   here on load; the game loop iterates this list every tick.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const list = [];

  function register(mechanic) { list.push(mechanic); }
  function get(id) { return list.find((m) => m.id === id); }
  function all() { return list; }

  window.OrbWeaver.Mechanics = { register, get, all };
})();
