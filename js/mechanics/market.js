/* ============================================================
   MECHANIC: MARKET (Camp)
   Not a resource — no left-hand row. Workers are ALWAYS upkeep-free
   here (upkeepExempt), since the Market makes gold. Two tracks off
   one worker pool:

   1) Self-upgrade ladder (top bar, collapsible) — the SAME collapsible
      ladder Builder's Bench uses. Each tier raises the worker sell-time
      rate (secondsPerWorker) and applies a structured `effect` that
      unlocks sell cards, enables auto-sell toggles, grows bundle sizes,
      and raises the shared sale-slot count. Starting tier "Market Stall"
      is free/instant on reveal (wood+stone already sellable).

   2) Sell track (bottom bar) — per-resource sell cards, each with one or
      two selectable bundles, optional auto-sell toggle (+ a lock), a
      shared pool of sale slots (1 → 2 → 3), full up-front resource cost,
      timed payout in gold, cancellable with refund.

   Card face: "Bundle resources for gold" until first opened, then blank /
   "Selling – Xs" (soonest sale) / "Collecting" (self-upgrade), combined.

   NOTE (spreadsheet data-entry, edit freely here):
     • Market Booths cost E3 read "100, 40 stone" — entered as 100 wood.
     • Trading District B10 read "Auto plywood Sell brick" — coded as
       auto Plywood only (Brick stays manual). Add 'brick' to its
       effect.auto below if you want Brick auto-sold too.

   Worker sell-time reduction is purely workers × secondsPerWorker per
   second, floored at 8s off a 180s base (see SELL_CONFIG). Self-upgrade
   build uses the default 0.2/worker speed-up (like Wood/Stone), NOT the
   sell rate.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'market';
  const SELL_CONFIG = { baseTime: 180, floorTime: 8 };

  // Sellable resources. goldPerUnit derives each bundle's payout
  // (bundleSize × goldPerUnit). All start locked; the ladder unlocks them.
  const SELL_RESOURCES = [
    { id: 'wood',        name: 'Wood',         goldPerUnit: 0.5, bundles: [60, 120] },
    { id: 'stone',       name: 'Stone',        goldPerUnit: 1,   bundles: [200, 500] },
    { id: 'simpleparts', name: 'Simple Parts', goldPerUnit: 25,  bundles: [60, 120] },
    { id: 'simpletools', name: 'Simple Tools', goldPerUnit: 60,  bundles: [60, 120] },
    { id: 'plywood',     name: 'Plywood',      goldPerUnit: 60,  bundles: [60, 120] },
    { id: 'brick',       name: 'Brick',        goldPerUnit: 80,  bundles: [200, 500] }
  ];

  // Upgrades BEYOND the free starting tier "Market Stall".
  // gainPerWorker = seconds each worker shaves off sell time (col C).
  // effect = what completing the tier does (col B / F, as data).
  const SELF_TABLE = [
    { name: 'Market Booths',   gainPerWorker: 0.5, buildTime: 120,  costRaw: '100 wood, 40 stone',        desc: 'Auto-sell Wood & Stone',
      effect: { auto: ['wood', 'stone'] } },
    { name: 'Market Centre',   gainPerWorker: 1,   buildTime: 220,  costRaw: '220 wood, 100 stone',       desc: '1/s Worker Speed; Sell Simple Parts',
      effect: { unlock: ['simpleparts'] } },
    { name: 'Market Square',   gainPerWorker: 1,   buildTime: 420,  costRaw: '550 wood, 650 stone',       desc: 'Auto-sell Simple Parts; large Wood & Stone bundles',
      effect: { auto: ['simpleparts'], bundles: { wood: [200, 500], stone: [200, 500] } } },
    { name: 'Market District', gainPerWorker: 1,   buildTime: 600,  costRaw: '700 wood, 650 stone',       desc: 'Sell 2 Bundles; large Simple Parts bundle',
      effect: { concurrent: 2, bundles: { simpleparts: [200] } } },
    { name: 'Trading Post',    gainPerWorker: 2,   buildTime: 1200, costRaw: '900 wood, 900 stone',       desc: '2/s Worker Speed; Sell Simple Tools',
      effect: { unlock: ['simpletools'] } },
    { name: 'Trading Centre',  gainPerWorker: 2,   buildTime: 1500, costRaw: '200 plywood, 100 brick',    desc: 'Auto-sell Simple Tools; larger Wood bundles',
      effect: { auto: ['simpletools'], bundles: { wood: [500, 1000], stone: [200, 500] } } },
    { name: 'Trading Quarter', gainPerWorker: 2,   buildTime: 1700, costRaw: '400 brick, 100 wrought iron', desc: 'Sell Plywood & Brick',
      effect: { unlock: ['plywood', 'brick'] } },
    { name: 'Trading District',gainPerWorker: 2,   buildTime: 1900, costRaw: '600 brick, 150 wrought iron', desc: 'Auto-sell Plywood; larger Plywood/Brick bundles',
      effect: { auto: ['plywood'], bundles: { plywood: [200], brick: [300] } } },
    { name: 'Trading Complex', gainPerWorker: 2,   buildTime: 2500, costRaw: '800 brick, 200 wrought iron', desc: 'Sell 3 resources at once; larger Plywood/Brick bundles',
      effect: { concurrent: 3, bundles: { plywood: [500], brick: [500] } } },
    { name: 'Bazaar',          gainPerWorker: 3,   buildTime: 3000, costRaw: '1300 brick, 600 wrought iron', desc: 'Faster sales (better worker rate)', effect: {} },
    { name: 'Mall',            gainPerWorker: 4,   buildTime: 4000, costRaw: '3500 brick, 1700 wrought iron', desc: 'Faster sales (better worker rate)', effect: {} },
    { name: 'Grand Bazaar',    gainPerWorker: 5,   buildTime: 6000, costRaw: '7000 brick, 3500 wrought iron', desc: 'Faster sales (better worker rate)', effect: {} },
    { name: 'Mega Mall',       gainPerWorker: 6,   buildTime: 8000, costRaw: '9000 brick, 6000 wrought iron', desc: 'Faster sales (better worker rate)', effect: {} }
  ];

  const TIP = 'TIP: Upgrade Wood and Stone Pile. Wood is selling at a loss. Stone Pile selling for small profit.';

  let cardName = 'Market Stall';     // starting tier
  let secondsPerWorker = 0.5;        // Market Stall's col-C rate
  let opened = false;
  let tipVisible = true;

  const selfTrack = window.OrbWeaver.Upgrades.create(SELF_TABLE, (row) => row.desc || 'TBD', true);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:self`, selfTrack);

  const sellTrack = window.OrbWeaver.Upgrades.createSellTrack(SELL_RESOURCES, {
    baseTime: SELL_CONFIG.baseTime,
    floorTime: SELL_CONFIG.floorTime,
    getAssigned: () => window.OrbWeaver.Workers.getAssigned(ID),
    getSPW: () => secondsPerWorker
  });
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:sell`, sellTrack);

  // Market Stall's baked-in starting state: Wood + Stone already sellable.
  sellTrack.unlockResource('wood');
  sellTrack.unlockResource('stone');

  function onSelfComplete(row) {
    cardName = row.name;
    secondsPerWorker = row.gainPerWorker;
    const e = row.effect || {};
    (e.unlock || []).forEach((id) => sellTrack.unlockResource(id));
    (e.auto || []).forEach((id) => sellTrack.enableAuto(id));
    if (e.bundles) Object.keys(e.bundles).forEach((id) => sellTrack.setBundles(id, e.bundles[id]));
    if (e.concurrent) sellTrack.setMaxConcurrent(e.concurrent);
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    upkeepExempt: true,
    modalWide: true,
    upgradeTrackKey: 'self',
    buildTrackKey: 'sell',
    cardName: () => cardName,
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Bundle resources for gold';
      const collecting = selfTrack.isCollecting();
      const rem = sellTrack.getSoonestRemaining();
      if (rem != null) {
        const base = `Selling – ${Math.ceil(rem)}s`;
        return collecting ? `${base} – Collecting` : base;
      }
      return collecting ? 'Collecting' : '';
    },
    getUpgradeBarPct: () => selfTrack.getCardProgressPct(),
    getBuildBarPct: () => sellTrack.getBuildBarPct(),
    getWorkerDesc: () => { const a = window.OrbWeaver.Workers.getAssigned(ID); const rate = (a * secondsPerWorker).toFixed(1); return a <= 1 ? `1 worker reducing ${secondsPerWorker.toFixed(1)}/s` : `${a} workers reducing ${rate}/s`; },
    patchUpgradeCost: () => selfTrack.getResourceTracker(),
    patchBuildStatus: () => selfTrack.getBuildStatusText(),
    patchLiveTrack: () => sellTrack.patchDOM(),
    getSubtitleHtml() {
      const tip = tipVisible ? `<div class="modal-subtitle-tip">${TIP}</div>` : '';
      return tip + `<div class="modal-subtitle-note">Active Workers cost no gold during sales</div>`;
    },
    renderModalHTML() {
      const arrow = `<span class="section-collapse-arrow${selfTrack.isCollapsed() ? ' collapsed' : ''}" data-upgrade-action="toggle-collapse" data-mechanic="${ID}" data-track="self">▾</span>`;
      const sellTime = `<span class="sell-time-label">— ${sellTrack.projectedTime().toFixed(1)}s</span>`;
      return `<div class="market-modal">` +
        selfTrack.renderModalHTML(ID, {}, 'self', arrow) +
        `<div class="modal-subsection-label divider-top">Sell ${sellTime}</div>${sellTrack.renderCards(ID, 'sell')}` +
      `</div>`;
    },
    tick(goldAvailable, tickRate) {
      if (tipVisible) {
        const w = window.OrbWeaver.Mechanics.get('wood');
        const s = window.OrbWeaver.Mechanics.get('stone');
        if ((w && w.cardName() !== 'Wood') || (s && s.cardName() !== 'Stone Pit')) tipVisible = false;
      }
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (selfTrack.isBuilding()) selfTrack.advanceTimer(tickRate, assigned, onSelfComplete);
      sellTrack.tick(tickRate);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
