/* ============================================================
   MECHANIC: MARKET (Camp)
   Not a resource — no left-hand row. Workers are ALWAYS upkeep-free
   here (upkeepExempt), since the Market makes gold. One track:

   Sell track (bottom bar) — per-resource sell cards, each with one or
   two selectable bundles, auto-sell (on for every sellable resource
   from the moment it's unlocked — see unlockResource() in upgrades.js),
   a shared pool of sale slots, full up-front resource cost, timed
   payout in gold, cancellable with refund. Wood and Stone are sellable
   (and auto-sellable) from the start.

   Market no longer has a self-upgrade ladder — bundle growth and sale
   slot count are no longer things Market levels up on its own; they're
   now Academy Research Topics (see js/mechanics/academy.js) that call
   growBundle()/setMaxConcurrent() below. The top bar is a reserved-but-
   unused stub (getUpgradeBarPct: () => 0), same convention as every
   other card that doesn't use it.

   Card face: "Bundle resources for gold" until first opened, then blank
   or "Selling – Xs".

   Simple Parts/Tools, Plywood, and Brick were previously placeholder
   sell entries gated behind the old ladder — deleted along with it,
   since none of those resources exist in the game yet. No other
   mechanic reads or produces them (checked), so nothing else is
   affected by their removal. Re-add them here as real sell entries
   whenever those resources actually exist.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'market';
  const SELL_CONFIG = { baseTime: 180, floorTime: 20 };

  // Sellable resources. goldPerUnit derives each bundle's payout
  // (bundleSize × goldPerUnit).
  const SELL_RESOURCES = [
    { id: 'wood',  name: 'Wood',  goldPerUnit: 0.5, bundles: [60, 120] },
    { id: 'stone', name: 'Stone', goldPerUnit: 1,   bundles: [200, 500] }
  ];

  const TIP = 'TIP: Upgrade Wood and Stone Pile. Wood is selling at a loss. Stone Pile selling for small profit.';

  let opened = false;
  let tipVisible = true;

  const sellTrack = window.OrbWeaver.Upgrades.createSellTrack(SELL_RESOURCES, {
    baseTime: SELL_CONFIG.baseTime,
    floorTime: SELL_CONFIG.floorTime,
    getAssigned: () => window.OrbWeaver.Workers.getAssigned(ID),
    getSPW: () => window.OrbWeaver.Upgrades.getBaseSPW()
  });
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:sell`, sellTrack);

  // Wood + Stone are sellable (and auto-sellable) from the start — no
  // upgrade required.
  sellTrack.unlockResource('wood');
  sellTrack.unlockResource('stone');

  const mechanic = {
    id: ID,
    section: 'Camp',
    startHidden: true,
    upkeepExempt: true,
    modalWide: true,
    buildTrackKey: 'sell',
    cardName: () => 'Market',
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Bundle resources for gold';
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      if (assigned === 0 && sellTrack.getSoonestRemaining() != null) return 'Stopped';
      const rem = sellTrack.getSoonestRemaining();
      return rem != null ? `Selling – ${Math.ceil(rem)}s` : '';
    },
    getUpgradeBarPct: () => 0,
    getBuildBarPct: () => sellTrack.getBuildBarPct(),
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Selling ${window.OrbWeaver.Upgrades.formatRate(assigned * window.OrbWeaver.Upgrades.getBaseSPW())}s faster`;
    },
    patchLiveTrack: () => sellTrack.patchDOM(),
    getSubtitleHtml() {
      const tip = tipVisible ? `<div class="modal-subtitle-tip">${TIP}</div>` : '';
      return tip + `<div class="modal-subtitle-note">Active Workers cost no gold during sales</div>`;
    },
    renderModalHTML() {
      const sellTime = `<span class="sell-time-label">— ${sellTrack.projectedTime().toFixed(1)}s</span>`;
      return `<div class="market-modal"><div class="modal-subsection-label">Sell ${sellTime}</div>${sellTrack.renderCards(ID, 'sell')}</div>`;
    },
    tick(goldAvailable, tickRate) {
      if (tipVisible) {
        const w = window.OrbWeaver.Mechanics.get('wood');
        const s = window.OrbWeaver.Mechanics.get('stone');
        if ((w && w.cardName() !== 'Wood') || (s && s.cardName() !== 'Stone Pit')) tipVisible = false;
      }
      if (window.OrbWeaver.Workers.getAssigned(ID) >= 1) sellTrack.tick(tickRate);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ----
     The sell track saves its own per-resource state. Bundle sizes and
     sale-slot count are NOT saved anywhere — they are effects of
     Academy research, replayed on load, so re-tuning them reaches
     existing players. Only this card's own UI state lives here. */
  window.OrbWeaver.Save.register(ID,
    () => ({ o: opened ? 1 : 0, tip: tipVisible ? 1 : 0 }),
    (d) => { opened = !!d.o; tipVisible = !!d.tip; });

  window.OrbWeaver.Mechanics.register(mechanic);
  // Public surface for Academy's Research Topics to drive (bundle growth,
  // concurrent sale slots) — same convention as window.OrbWeaver.Mountains.
  window.OrbWeaver.Market = {
    growBundle: (id, sizes) => sellTrack.setBundles(id, sizes),
    setMaxConcurrent: (n) => sellTrack.setMaxConcurrent(n)
  };
})();
