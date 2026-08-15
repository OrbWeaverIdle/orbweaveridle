/* ============================================================
   MAIN — GAME START-UP
   Registers real resources and real cards in DOM order, starts loop.
   Adding a new mechanic: new Resources.register line + Cards.build
   line here, plus one <script> tag in index.html.
   ============================================================ */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('left-hand-real-resources');

    window.OrbWeaver.Workers.init(mount);
    window.OrbWeaver.Resources.register('gold', {
      name: 'Gold', mount, current: 5000, cap: 5000, displayType: 'integer'
    });

    window.OrbWeaver.Resources.register('wood', {
      name: 'Wood', mount, current: 0, cap: 200, displayType: 'decimal'
    });
    window.OrbWeaver.Resources.register('stone', {
      name: 'Stone', mount, current: 0, cap: 500, displayType: 'decimal', hidden: true
    });
    // No producer yet (Mountains/pyramid add one in a later session) and
    // no cap — exist now, hidden, so Academy's conversion track and the
    // cheat buttons have something to check against.
    window.OrbWeaver.Resources.register('researchpapers', {
      name: 'Research Papers', mount, current: 0, cap: null, displayType: 'integer', hidden: true
    });
    window.OrbWeaver.Resources.register('journals', {
      name: 'Journals', mount, current: 0, cap: null, displayType: 'integer', hidden: true
    });

    // Camp registers itself as a location too, so other locations' Scout
    // Stables can route cargo back home (prefix '' — Camp's resource ids
    // are already the base names).
    window.OrbWeaver.Locations.register({
      id: 'camp', label: 'Camp', prefix: '',
      isDiscovered: () => true,
      addWorkers: (n) => window.OrbWeaver.Workers.addWorkers(n),
      ensureResource: (baseId, name) => { window.OrbWeaver.Resources.ensure(baseId, { name, mount, current: 0, displayType: 'decimal', hidden: false }); return baseId; }
    });

    // Camp is the first card, visible from game start (no reveal gate).
    const campGrid = document.getElementById('grid-camp');
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('buildersbench')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('tents')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('wood')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('stone')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('market')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('academy')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('scoutspen')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('expeditionmule')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('resupplymule')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('cartbull')));

    // Mountains (Section B) — own left-hand group, own grid, both hidden
    // until Scout Stable's first Expedition Mule reveals them.
    const mtnMount = document.getElementById('left-hand-real-resources-mountains');
    window.OrbWeaver.Mountains.initWorkersRow(mtnMount);
    window.OrbWeaver.Resources.register(window.OrbWeaver.Mountains.woodId, {
      name: 'Wood', mount: mtnMount, current: 200, cap: 2000, displayType: 'decimal', hidden: true
    });
    window.OrbWeaver.Resources.register(window.OrbWeaver.Mountains.stoneId, {
      name: 'Stone', mount: mtnMount, current: 0, cap: 5000, displayType: 'decimal', hidden: true
    });
    document.getElementById('grid-mountains').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mountains')));
    document.getElementById('grid-mountains').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('quarry')));
    document.getElementById('grid-mountains').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mtn_scoutstable')));
    document.getElementById('grid-mountains').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mtn_resupplymule')));
    document.getElementById('grid-mountains').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mtn_cartbull')));

    // Sand Dunes (yellow section) — own left-hand group, own grid, both
    // hidden until revealed (see js/mechanics/sanddunes.js). No resources
    // of its own at launch; ensureResource() registers them on delivery.
    const sdMount = document.getElementById('left-hand-real-resources-sanddunes');
    window.OrbWeaver.SandDunes.initWorkersRow(sdMount);
    document.getElementById('grid-sanddunes').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('sanddunes')));

    // Restore after every card and resource exists, before the first
    // tick — so nothing simulates against a half-built world. Offline
    // catch-up may take several frames, so the loop starts from the
    // callback rather than immediately.
    const isNewGame = !window.OrbWeaver.Save.init(() => {
      window.OrbWeaver.Loop.start();
      // Boot has fully settled — fold any pinned idle message into
      // permanent history now (see footer.js for why this can't happen
      // any earlier: the offline report needs it pinned at the top
      // through the whole replay first).
      window.OrbWeaver.Footer.commitIdleMessage();
    });
    if (isNewGame) {
      window.OrbWeaver.Footer.discardIdleMessage(); // discard any leftover from a previous session
      window.OrbWeaver.Footer.push('5 workers are impatient for you to begin.');
    }
    // Wire the idle-message write on future closes, using the camp pool total.
    window.OrbWeaver.Footer.scheduleIdleMessage(() => window.OrbWeaver.Workers.getTotal());
  });
})();
