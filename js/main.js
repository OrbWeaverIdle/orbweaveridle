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

    // Gold sits above Workers: registered first so its band leads the rail.
    window.OrbWeaver.Resources.register('gold', {
      name: 'Gold Coins', mount, current: 5000, cap: 5000, displayType: 'integer', noFull: true
    });
    window.OrbWeaver.Workers.init(mount);

    window.OrbWeaver.Resources.register('wood', {
      name: 'Wood', mount, current: 0, cap: 2000, displayType: 'decimal', hidden: true, revealOnGain: true
    });
    window.OrbWeaver.Resources.register('woodcrate', {
      name: 'Crate', mount, current: 0, cap: null, displayType: 'decimal', hidden: true
    });
    window.OrbWeaver.Resources.register('stone', {
      name: 'Stone', mount, current: 0, cap: 1000, displayType: 'decimal', hidden: true
    });
    // Uncapped overflow stores, revealed only once the player owns one.
    // Registered right after their parents so the rail order is right
    // even before Resources' own crate insertion kicks in.
    window.OrbWeaver.Resources.register('stonecrate', {
      name: 'Crate', mount, current: 0, cap: null, displayType: 'decimal', hidden: true
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
    // No cap (unlike Wood's 200) — revealed alongside the Tool Shed card.
    // Integer, not decimal, like Gold/Journals — tools are always whole
    // completed units.
    window.OrbWeaver.Resources.register('tools2', {
      name: 'Tools II', mount, current: 0, cap: null, displayType: 'integer', hidden: true
    });
    window.OrbWeaver.Resources.register('tools3', {
      name: 'Tools III', mount, current: 0, cap: null, displayType: 'integer', hidden: true
    });
    // Id stays 'copperhead' (short, like tools2/goldbars); only the
    // display name is the full "Copper Tool Head". Market Stall's
    // Commodities tab is its first source — Tool Shed's Tier III
    // recipe consumes it. displayType omitted: Resources.register()'s
    // own default already treats 'copperhead' as a whole-number id.
    window.OrbWeaver.Resources.register('copperhead', {
      name: 'Copper Tool Head', mount, current: 0, cap: null, hidden: true
    });

    // Camp registers itself as a location too, so other locations' Scout
    // Stables can route cargo back home (prefix '' — Camp's resource ids
    // are already the base names).
    window.OrbWeaver.Locations.register({
      id: 'camp', label: 'Camp', prefix: '',
      isDiscovered: () => true,
      addWorkers: (n) => window.OrbWeaver.Workers.addWorkers(n),
      // displayType omitted — Resources.register()'s shared default
      // (js/core/resources.js) decides whole-number vs decimal for any
      // baseId, so this no longer needs its own copy of that rule.
      ensureResource: (baseId, name) => { window.OrbWeaver.Resources.ensure(baseId, { name, mount, current: 0, hidden: false }); return baseId; }
    });

    // Camp is the first card, visible from game start (no reveal gate).
    const campGrid = document.getElementById('grid-camp');
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('buildersbench')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('richuncle_camp')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('toolshed')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('tents')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('wood')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mpftest')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('stone')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('digsite')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('marketstall')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('academy')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('scoutspen')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('expeditionmule')));
    // Every pre-registered Mule/Cart and Bull station (hidden until
    // dispatched) — see js/core/scoutstable.js's growable station system.
    window.OrbWeaver.ScoutSpen.vehicleIds.mule.forEach((id) => campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get(id))));
    window.OrbWeaver.ScoutSpen.vehicleIds.cartbull.forEach((id) => campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get(id))));

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
    // Gold Panning and Smelter Shack both use Mountains' worker pool —
    // assigned here after mountains.js, goldpanning.js, and
    // smeltershack.js have already loaded and registered.
    window.OrbWeaver.Mechanics.get('goldpanning').workerPool = window.OrbWeaver.Mountains.workerPool;
    window.OrbWeaver.Mechanics.get('smeltershack').workerPool = window.OrbWeaver.Mountains.workerPool;
    window.OrbWeaver.Mechanics.get('richuncle_mountains').workerPool = window.OrbWeaver.Mountains.workerPool;
    window.OrbWeaver.Mechanics.get('goldmine').workerPool = window.OrbWeaver.Mountains.workerPool;
    const mtnGrid = document.getElementById('grid-mountains');
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mountains')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('richuncle_mountains')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('quarry')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('wheatfieldcard')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('goldpanning')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('smeltershack')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('goldmine')));
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('mtn_scoutstable')));
    window.OrbWeaver.MtnScoutStable.vehicleIds.mule.forEach((id) => mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get(id))));
    window.OrbWeaver.MtnScoutStable.vehicleIds.cartbull.forEach((id) => mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get(id))));
    // Collapsed Path always sits last in the Mountains grid — keep it the final append.
    mtnGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('collapsedpath')));

    // Sand Dunes (yellow section) — own left-hand group, own grid, both
    // hidden until revealed (see js/mechanics/sanddunes.js). No resources
    // of its own at launch; ensureResource() registers them on delivery.
    const sdMount = document.getElementById('left-hand-real-resources-sanddunes');
    window.OrbWeaver.SandDunes.initWorkersRow(sdMount);
    // Collapsed Path (sdpulley) always sits first in the Sand Dunes grid — keep it the first append.
    document.getElementById('grid-sanddunes').appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('sdpulley')));
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

    // Pause support: while paused, Loop's own pump is off, so a card's
    // stat text (driven by its tick()) would otherwise sit stale after
    // a worker is reassigned. Deliberately self-contained here rather
    // than added to js/core/loop.js — the pump is the single most
    // load-bearing piece of the game, not worth touching for a UI
    // convenience. tickRate 0 means every mechanic's own tick() spends
    // nothing and advances no timer — it only recomputes status/text
    // against the current assignment. Upkeep is deliberately skipped:
    // nothing should bill while paused.
    function previewTick() {
      const goldAvailable = window.OrbWeaver.Resources.get('gold') > 0;
      window.OrbWeaver.Mechanics.all().forEach((m) => {
        try { m.tick(goldAvailable, 0); } catch (err) { /* a real tick already logs this mechanic's errors */ }
      });
    }
    Object.values(window.OrbWeaver.Workers.getPools()).forEach((pool) => {
      pool.onChange(() => { if (!window.OrbWeaver.Loop.isRunning()) previewTick(); });
    });
  });
})();
