/* ============================================================
   MECHANIC: SAND DUNES (Section, yellow theme)
   Revealed by "Peer over the top" on the Collapsed Path card
   (js/mechanics/collapsedpath.js). Own worker pool, filled only by the
   pulley (js/mechanics/pulley.js) until the path is cleared —
   isReachable() keeps Scout Stables from routing here before that. Any
   resource registers here the moment cargo first delivers it
   (ensureResource()), so nothing needs to be pre-declared. The card
   itself has no activity yet.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;

  const ID = 'sanddunes';
  const PREFIX = 'sd_';
  const pool = OW.Workers.createPool(0, 'sanddunes');
  let discovered = false, sdMount = null;

  // displayType omitted — see js/core/resources.js's shared whole-number rule.
  function ensureResource(baseId, name) {
    const id = PREFIX + baseId;
    OW.Resources.ensure(id, { name, mount: sdMount, current: 0, hidden: false });
    return id;
  }

  const reachable = () => !!(OW.CollapsedPath && OW.CollapsedPath.isCleared());

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Sand Dunes',
    modalTheme: 'theme-sanddunes',
    workerPool: pool,
    stepperReady: () => false, // nothing to assign to yet
    reserveStepperSpace: true,
    cardName: () => 'Sand Dunes',
    getStatText: () => '',
    getUpgradeBarPct: () => 0,
    renderModalHTML: () => `<div class="hs-card"><div class="hs-head"><span class="hs-title">Sand Dunes</span></div><div class="hs-body">
      <div class="detail-card-desc">Windswept dunes beyond the collapse. ${reachable() ? 'The pass is open.' : 'Only the pulley reaches here until the pass is cleared.'}</div></div></div>`,
    tick() { OW.Cards.refresh(mechanic); }
  };

  function reveal() {
    if (discovered) return;
    discovered = true;
    document.getElementById('sanddunes-section').style.display = '';
    document.getElementById('left-hand-sanddunes-group').style.display = '';
    document.getElementById('camp-section-label').style.display = '';
    OW.Cards.reveal(mechanic);
  }

  // Workers save with the pool (js/core/workers.js); only discovery lives
  // here. Older saves kept a plain idle/total counter (t/i) instead of a
  // pool — carried into the pool so those workers aren't lost.
  OW.Save.register(ID, () => ({ d: discovered ? 1 : 0 }), (d) => {
    if (d.t && !pool.getTotal()) pool.deserialize({ total: d.t, idle: d.i || 0, a: {} });
    if (d.d) reveal();
  });

  OW.Mechanics.register(mechanic);
  OW.SandDunes = {
    id: ID, label: 'Sand Dunes', prefix: PREFIX, workerPool: pool,
    initWorkersRow: (mount) => { sdMount = mount; pool.init(mount); },
    addWorkers: (n) => pool.addWorkers(n), ensureResource, reveal,
    isDiscovered: () => discovered, isReachable: reachable
  };
  OW.Locations.register(OW.SandDunes);
})();
