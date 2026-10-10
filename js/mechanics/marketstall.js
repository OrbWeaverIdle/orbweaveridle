/* ============================================================
   MECHANIC: MARKET STALL (Camp)
   Replaces the old Market card (js/mechanics/market.js, deleted).
   Not a resource — no left-hand row. Workers here are ALWAYS
   upkeep-free (upkeepExempt) and never gold-starved (tick ignores
   goldAvailable), same two exemptions the old Market had: this card
   MAKES gold, so charging or stalling it would deadlock a broke save.

   A three-tab hub. All three tabs are open from the start — there is
   no unlock currency (an earlier design had "Receipts"; dropped).

   SELLING (this stage) — one independent gather-then-sell state
   machine per resource:
     1. gather  — drains the EXISTING stockpile at a flat 1 unit/s per
                  worker (deliberately linear, not workerRate()), until
                  `gathered` reaches the row's quantity.
     2. selling — sellProgress += workers/180 per second, also flat and
                  INDEPENDENT of quantity. Selling 100 units and 1000
                  units both cost the same 180 worker-seconds, so big
                  batches are far more gold-per-second efficient. That
                  is the whole point of the per-row g/s readout.
   On completion: gold += qty * goldPerUnit, row returns to idle.

   Auto-sell is checked once per tick AFTER the row's normal tick: an
   idle, staffed, auto row restarts immediately. Toggling auto off
   never cancels a sale in flight, it only stops the next one.

   Like every card with sub-slots, the three rows draw from Camp's one
   worker pool; the card's own stepper holds the total and each row's
   stepper claims a share of it (auto-promoting an idle pool worker
   when the card has none spare — the mountains_sub_slots pattern).

   Crates are deliberately NOT sellable here and not part of any row.

   COMMODITIES — a flat shop, no timer and no worker. Four items,
   every one priced in Gold Bars only. Each has its own Quantity
   stepper (steps of 1, floor 1, no ceiling) that scales both the cost
   and the grant. Crate items grant into the parent's crate row, so
   1000 wood arrives without Wood ever exceeding its own cap — there is
   no above-cap state anywhere in the engine.

   STOCK MARKET — one shared price walk stepping once every 600s, with
   occasional outsized shocks (see SHOCK_* below). The walk is entirely
   exogenous: reversion, volatility and shocks move it, nothing a
   player does ever does. Trades move REAL goods against Gold at that
   one quoted price, flat: cost/proceeds are exactly qty * price, the
   same number for both sides (no spread, no fee, no per-trade impact).
   A Buy clamps to the resource's own cap, a Sell clamps to Gold's
   remaining headroom, so neither can ever silently destroy value by
   overflowing. Trades can't move the price, so a same-window
   buy-then-sell nets exactly 0 at any size by construction — there is
   nothing left to integrate or defer. Prices live inside a flat band —
   a 0.25g floor shared by every resource, and a ceiling of base +
   CEILINGS[id] — and mean reversion pulls toward that band's midpoint
   rather than base, so the floor stays reachable in ordinary play
   instead of the walk hugging the ceiling. walkAccum is saved; `base`
   is not (re-read from BASES, so prices stay rebalanceable).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'marketstall';
  const SELL_SECONDS = 180;   // worker-seconds for the sell phase, any qty
  const QTY_STEP = 100;
  const ROWS = [
    { id: 'wood',   name: 'Wood',     gold: 3 },
    { id: 'stone',  name: 'Stone',    gold: 4 },
    { id: 'tools2', name: 'Tools II', gold: 8 }
  ];

  // COMMODITIES — a flat shop. Every price is Gold Bars, full stop.
  // `amount` is what ONE quantity grants; `crate: 1` routes the grant
  // into the parent's crate row instead of the parent itself, which is
  // how 1000 wood lands without ever pushing Wood past its own cap.
  const ITEMS = [
    { key: 'copper', name: 'Copper Tool Head', bars: 5, grants: 'copperhead', amount: 1, tier: 3 },
    { key: 'wcrate', name: 'Wood Crate (exceeds cap)',  bars: 20, grants: 'wood',  amount: 1000, crate: 1 },
    { key: 'scrate', name: 'Stone Crate (exceeds cap)', bars: 20, grants: 'stone', amount: 1000, crate: 1 }
  ];

  const pool = () => window.OrbWeaver.Workers;
  const R = () => window.OrbWeaver.Resources;
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  // available() reads 0 for an unregistered id, so this is safe before
  // Camp's Gold Bars row is ever created by a cargo delivery.
  const barsHave = () => R().available('goldbars');

  let activeTab = 'selling';
  let opened = false;
  const rows = {};
  ROWS.forEach((r) => { rows[r.id] = { qty: QTY_STEP, workers: 0, phase: 'idle', gathered: 0, progress: 0, auto: false }; });
  const comQty = {};
  ITEMS.forEach((i) => { comQty[i.key] = 1; });

  /* ============ STOCK MARKET ============
     One shared price walk, stepping once every WALK_SECONDS. Trades
     move REAL goods: buying spends Gold and adds units to the
     stockpile. BASES is the whole tradeable set — a Camp resource with
     no entry here simply never appears, so adding a future one is a
     single line. */
  const WALK_SECONDS = 600;
  const REVERSION = 0.05, VOLATILITY = 0.16;
  // Hard price band, in flat gold — NOT a multiple of base. The floor
  // is the same 0.25g for every resource; the ceiling is that
  // resource's base plus its own CEILINGS offset (below).
  const FLOOR = 0.25;
  // No spread: one flat price for both sides — cost/proceeds are
  // exactly qty * price either way. Trades never move the price (see
  // the header comment), so a buy-then-sell round trip nets exactly 0
  // at any size; there's no curve or fee for a spread to interact
  // with. Kept as a named dial rather than deleted, so a spread can be
  // reintroduced later by changing this one number.
  const SPREAD = 0;
  const HISTORY_LEN = 20;
  const PRESEED = 10;                // walk steps run the instant a stock is created
  const SPEEDUP_SECONDS = 60;        // per Gold Bar, repeatable, uncapped
  // SHOCKS — on every SHOCK_EVERY-th counted update, each tradeable
  // resource independently rolls SHOCK_CHANCE for one outsized move,
  // SHOCK_UP of them upward. A shock covers SHOCK_REACH of the distance
  // left to the band edge, so the edge itself is never reached; ordinary
  // reversion walks the price back over the updates that follow.
  const SHOCK_EVERY = 3, SHOCK_CHANCE = 0.2, SHOCK_UP = 0.66, SHOCK_REACH = 0.8;
  const WOOD_SHOCK_AT = 2;           // scripted: wood always spikes on this update
  const BASES = {
    wood: 3, stone: 4, tools2: 8, tools3: 110
  };
  // Per-resource ceiling OFFSET above base (~35–40% of base), the same
  // flat table shape as STEPS. Kept as an offset rather than an
  // absolute ceiling so BASES stays the single anchor and a future
  // Market Stall upgrade can scale every offset by one multiplier.
  const CEILINGS = {
    wood: 1, stone: 1.5, tools2: 3, tools3: 40
  };
  const ceilingOf = (id) => BASES[id] + CEILINGS[id];
  // Reversion pulls toward the BAND MIDPOINT, not base. Base sits near
  // the ceiling under this band, so reverting to base would keep the
  // walk pinned to the top and leave the 0.25 floor unreachable.
  const midOf = (id) => (FLOOR + ceilingOf(id)) / 2;
  // Trade-quantity stepper increment, one per resource — a flat table,
  // not derived from anything else.
  const STEPS = {
    wood: 100, stone: 100, tools2: 25, tools3: 5
  };

  const stocks = {};                 // id -> { price, history: [] }  (base is re-read from BASES)
  let walkAccum = 0;
  // Counted walk updates since the card was revealed. Drives both the
  // shock cadence and the scripted Wood update, so it has to be saved.
  let walkCount = 0;
  let stockView = 'wood';            // a resource id, or 'all' for the overlay
  let tradeQty = 1;

  // Revealed Camp resources only: no Gold, no crates (parentOf is
  // truthy for one), nothing carrying another location's prefix, and
  // nothing missing from BASES.
  function tradeable() {
    const others = window.OrbWeaver.Locations.all().map((l) => l.prefix).filter(Boolean);
    return R().all()
      .filter((e) => BASES[e.id] && !e.hidden && !R().parentOf(e.id) && !others.some((p) => e.id.startsWith(p)))
      .map((e) => e.id);
  }
  const clamp = (id, v) => Math.min(ceilingOf(id), Math.max(FLOOR, v));
  // `shock` (+1 up, -1 down, 0 none) REPLACES this update's ordinary
  // drift rather than stacking on top of it — one big move, then the
  // usual reversion, so a crash recovers and a spike decays by itself.
  // Purely exogenous: nothing a player trades ever feeds back in here.
  function step(id, shock) {
    const s = stocks[id], base = BASES[id];
    const drift = shock
      ? ((shock > 0 ? ceilingOf(id) : FLOOR) - s.price) * SHOCK_REACH
      : (midOf(id) - s.price) * REVERSION + (Math.random() * 2 - 1) * base * VOLATILITY;
    s.price = clamp(id, s.price + drift);
    s.history.push(s.price);
    if (s.history.length > HISTORY_LEN) s.history.splice(0, s.history.length - HISTORY_LEN);
  }
  // Pre-seeding happens ONCE, at creation — never on a later read — so
  // a fresh stock opens as an 11-point line rather than a flat dot.
  function stock(id) {
    if (!stocks[id]) {
      stocks[id] = { price: BASES[id], history: [BASES[id]] };
      for (let i = 0; i < PRESEED; i++) step(id);
    }
    return stocks[id];
  }
  // Both sides quote the same price (SPREAD is 0). Kept as two named
  // functions because both are on the public surface and read by
  // tests, and because a future spread would reintroduce the split
  // here without touching any caller.
  const buyPrice = (id) => stock(id).price * (1 + SPREAD);
  const sellPrice = (id) => stock(id).price * (1 - SPREAD);
  // Flat fill: n units always cost/net exactly n * the quoted price —
  // no curve, no volume dependence. Trades can't move the price (see
  // step()), so this is also the exact number both stockBuy/stockSell
  // charge; a same-window buy-then-sell nets exactly 0 by construction.
  function tradeCost(id, n, isBuy) {
    return n * (isBuy ? buyPrice(id) : sellPrice(id));
  }
  // How many units a Buy can actually take: the cap is the hard limit,
  // then the wallet, checked against the full fill cost. All or
  // nothing at the requested size.
  function buyableQty(id, want) {
    const cap = R().getCap(id);
    const room = cap == null ? want : Math.max(0, cap - R().get(id));
    const n = Math.min(want, Math.floor(room));
    // +1e-9 for the same float-boundary reason as sellableQty below.
    return n > 0 && R().get('gold') + 1e-9 >= tradeCost(id, n, true) ? n : 0;
  }
  // Sells clamp to gold HEADROOM as well as stock held, so a sale can
  // never destroy value by overflowing Gold's own cap. Unlike Buy,
  // this trims down to whatever fits — a big requested sale still
  // partially executes instead of refusing outright. Cost is flat, so
  // the largest affordable n is a single division, not a search.
  function sellableQty(id, want) {
    const cap = R().getCap('gold');
    const headroom = cap == null ? Infinity : Math.max(0, cap - R().get('gold'));
    const n = Math.min(want, Math.floor(R().available(id)));
    if (n <= 0 || headroom === Infinity) return Math.max(0, n);
    // +1e-9 guards against float division landing a hair under an
    // exact integer (e.g. 10 - epsilon flooring to 9) and silently
    // trimming a fill that should have gone through in full.
    return Math.max(0, Math.min(n, Math.floor(headroom / sellPrice(id) + 1e-9)));
  }
  // Returns the units filled (0 when blocked), which the UI uses to
  // flash the button only on a real fill. Trades never move the price
  // (see step()) — they just spend/grant at today's flat quote.
  function stockBuy(id) {
    const n = buyableQty(id, tradeQty);
    if (!n) return 0;                                 // the real gate
    const cost = tradeCost(id, n, true);
    R().spend('gold', cost);
    R().add(id, n);
    return n;
  }
  function stockSell(id) {
    const n = sellableQty(id, tradeQty);
    if (!n) return 0;                                 // the real gate
    const proceeds = tradeCost(id, n, false);
    R().spend(id, n);
    R().add('gold', proceeds);
    return n;
  }
  // Keeps tradeQty aligned to the current resource's step — switching
  // resources, or an old save's raw tq, can leave it off-grid.
  function snapTradeQty() {
    const step = STEPS[stockView] || 1;
    tradeQty = Math.max(step, Math.round(tradeQty / step) * step);
  }
  function speedUp() {
    if (barsHave() < 1) return;                       // the real gate
    R().spend('goldbars', 1);
    walkAccum += SPEEDUP_SECONDS;
  }
  // Banked outside tick() so offline catch-up and speed-ups resolve
  // through exactly the same path.
  function advanceWalk(seconds) {
    walkAccum += seconds;
    let stepped = false;
    while (walkAccum >= WALK_SECONDS) {
      walkAccum -= WALK_SECONDS;
      // Only updates the player is present for count. Before the card is
      // revealed, and all through an offline replay, prices walk exactly
      // as they always have but nothing shocks and walkCount holds — an
      // unseen spike is no spike, so the whole cadence waits for them.
      const live = mechanic.revealed && !window.OrbWeaver.Offline.isReplaying();
      if (live) walkCount++;
      const scripted = live && walkCount === WOOD_SHOCK_AT;
      const rolling = live && !scripted && walkCount % SHOCK_EVERY === 0;
      tradeable().forEach((id) => {
        stock(id);
        const hit = scripted ? id === 'wood' : (rolling && Math.random() < SHOCK_CHANCE);
        step(id, hit ? (scripted || Math.random() < SHOCK_UP ? 1 : -1) : 0);
      });
      stepped = true;
    }
    return stepped;
  }

  // A row is only shown once its resource is revealed — Tools II stays
  // off the list until Tool Shed actually produces one.
  const visibleRows = () => ROWS.filter((r) => R().exists(r.id) && !R().isHidden(r.id));
  const totalSubWorkers = () => ROWS.reduce((n, r) => n + rows[r.id].workers, 0);
  const freeCardWorkers = () => pool().getAssigned(ID) - totalSubWorkers();

  /* ---- worker sub-slots ----
     `quiet` skips the modal rebuild. The held row stepper passes it and
     patches in place instead: a rebuild replaces the button under the
     player's finger, and addHoldBehavior's isConnected guard then stops
     the repeat, which is why hold never worked on these two. */
  function subAssign(id, quiet) {
    if (!rows[id]) return;
    if (freeCardWorkers() <= 0 && !pool().assign(ID)) return;
    rows[id].workers++;
    mechanic.lastSub = id;
    if (!quiet) window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  function subUnassign(id, quiet) {
    if (!rows[id] || rows[id].workers <= 0) return;
    rows[id].workers--;
    pool().unassign(ID); // a modal − returns the worker to idle
    if (!quiet) window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  // The card-face stepper can shrink the card's total below what the
  // rows hold; clamp greedily in ROWS order so nothing outlives it.
  // Only rebuild the modal when the clamp actually changed a row count
  // — row-level worker steppers patch in-place and must not trigger a
  // rebuild (that would disconnect the held button mid-hold).
  pool().onChange(() => {
    let budget = pool().getAssigned(ID);
    let changed = false;
    ROWS.forEach((r) => { const keep = Math.min(rows[r.id].workers, budget); if (keep !== rows[r.id].workers) changed = true; rows[r.id].workers = keep; budget -= keep; });
    if (changed) window.OrbWeaver.Cards.refreshOpenModal(ID);
  });

  /* ---- per-row maths ---- */
  const payout = (r) => rows[r.id].qty * r.gold;
  // Gather is qty/workers seconds, sell is a flat 180/workers. null
  // means "no workers", which the readout shows as a dash.
  function cycleSeconds(r) {
    const w = rows[r.id].workers;
    return w > 0 ? (rows[r.id].qty + SELL_SECONDS) / w : null;
  }
  function goldPerSecond(r) {
    const t = cycleSeconds(r);
    return t ? payout(r) / t : null;
  }
  // Card-face g/s: busy rows with workers AND stock to work on.
  // Gathering rows with 0 available are excluded — they're stalled.
  const liveGps = () => ROWS.reduce((acc, r) => {
    const s = rows[r.id];
    if (s.phase === 'idle' || s.workers <= 0 || (s.phase === 'gathering' && R().available(r.id) <= 0)) return acc;
    return acc + (goldPerSecond(r) || 0);
  }, 0);
  const canStart = (r) => rows[r.id].phase === 'idle' && rows[r.id].workers > 0;

  function startSale(id) {
    const s = rows[id];
    if (!s || s.phase !== 'idle') return;
    s.phase = 'gathering';
    s.gathered = 0;
    s.progress = 0;
  }

  // Full refund, any time before completion: whatever's currently
  // pulled out of stock (partial mid-gather, or the whole qty once
  // selling) goes straight back. No gold is granted — that only
  // happens on a real completion in tickRow(). Auto sell is also
  // disabled so the player has to consciously re-enable it.
  function cancelSale(id) {
    const s = rows[id];
    if (!s || s.phase === 'idle') return;
    const r = ROWS.find((x) => x.id === id);
    if (s.gathered > 0) R().add(id, s.gathered);
    s.phase = 'idle'; s.gathered = 0; s.progress = 0;
    s.auto = false;
    // Reflect the toggle state immediately if the modal is already open.
    const tog = document.querySelector(`.toggle-switch[data-ms-auto="${id}"]`);
    if (tog) tog.classList.remove('on');
    window.OrbWeaver.Footer.push(`Canceled ${r.name} sale. Refunded.`);
  }

  function tickRow(r, tickRate) {
    const s = rows[r.id];
    if (s.workers <= 0) return;              // paused exactly where it is
    if (s.phase === 'gathering') {
      // Flat 1 unit/s per worker, never more than the row still needs.
      const want = Math.min(s.workers * tickRate, s.qty - s.gathered);
      s.gathered += R().spend(r.id, want);   // crates back-fill via spend()
      if (s.gathered >= s.qty - 1e-9) { s.gathered = s.qty; s.phase = 'selling'; }
    } else if (s.phase === 'selling') {
      s.progress += (s.workers * tickRate) / SELL_SECONDS;
      if (s.progress >= 1) {
        R().add('gold', payout(r));
        s.phase = 'idle'; s.gathered = 0; s.progress = 0;
      }
    }
  }

  /* ---- rendering ---- */
  const fmt = (n) => Math.round(n).toLocaleString();
  // Gold figure keeping up to 2 decimals but never trailing zeros:
  // 0.25 stays 0.25, 4 stays 4, 5.5 stays 5.5.
  const gfmt = (n) => (+n.toFixed(2)).toLocaleString();
  // allOff locks BOTH stepper buttons regardless of minusOff — used to
  // grey Quantity out completely while a row is mid-sale.
  function stepper(kind, id, val, minusOff, allOff) {
    return `<div class="card-steppers visible ms-stepper">
      <button class="card-stepper-btn" data-ms-step="${kind}" data-ms-row="${id}" data-ms-dir="-1" ${allOff || minusOff ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-ms-val="${kind}-${id}">${val}</span>
      <button class="card-stepper-btn" data-ms-step="${kind}" data-ms-row="${id}" data-ms-dir="1" ${allOff ? 'disabled' : ''}>+</button>
    </div>`;
  }
  // Three stacked lines in a dark panel — g/s (bottom) is the highlighted
  // figure, since that's the number that makes big batches pay off.
  // The inner lines are split out so the full render and the in-place
  // patch after a stepper press share one template, not two copies.
  function readoutInner(r) {
    const t = cycleSeconds(r), gps = goldPerSecond(r);
    return `<span>${fmt(payout(r))}g total</span>
      <span>${t ? Math.ceil(t) + 's to sell' : '— to sell'}</span>
      <b>${gps ? gps.toFixed(2) + ' g/s' : '— g/s'}</b>`;
  }
  const readout = (r) => `<div class="ms-readout" data-ms-readout="${r.id}">${readoutInner(r)}</div>`;
  // Per-unit price shown in each row header, left-aligned after the stock count.
  const unitPrice = (r) => `<span class="ms-unit-price">${r.gold}g/unit</span>`;
  function rowHtml(r) {
    const s = rows[r.id];
    const active = s.phase !== 'idle';
    const cur = fmt(R().available(r.id));
    const cap = R().getCap(r.id); const capStr = cap != null ? fmt(cap) : '∞';
    const status = s.phase === 'gathering' ? `Gathering ${fmt(s.gathered)}/${fmt(s.qty)}`
      : s.phase === 'selling' ? `Selling ${Math.floor(s.progress * 100)}%` : '';
    return `<div class="hs-card">
      <div class="hs-head">
        <span class="hs-title">${r.name} <span class="ms-stock-count" data-ms-stock="${r.id}">${cur}/${capStr}</span>${unitPrice(r)}</span>
        <span class="ms-auto-inline"><span class="ms-auto-label">Auto sell</span><span class="toggle-switch sell-auto${s.auto ? ' on' : ''}" data-ms-auto="${r.id}"></span></span>
      </div>
      <div class="hs-body">
        <div class="ms-row-body">
          <div class="ms-controls">
            <div class="ms-ctl"><span class="ms-ctl-label">Workers</span>${stepper('w', r.id, s.workers, s.workers <= 0)}</div>
            <div class="ms-ctl"><span class="ms-ctl-label">Quantity</span>${stepper('q', r.id, fmt(s.qty), s.qty <= QTY_STEP, active)}</div>
          </div>
          ${readout(r)}
          <div class="ms-right">
            <button class="action-btn ms-sell" data-ms-sell="${r.id}" ${active || canStart(r) ? '' : 'disabled'}>${active ? 'Cancel' : 'Sell'}</button>
            <span class="ms-sell-status" data-ms-status="${r.id}">${status}</span>
          </div>
        </div>
      </div>
      <div class="sell-progress"><div class="sell-progress-bar" data-ms-bar="${r.id}" style="width:${s.phase === 'selling' ? s.progress * 100 : 0}%"></div></div>
    </div>`;
  }
  function sellingTab() {
    const list = visibleRows();
    if (!list.length) return `<div class="sp-tab-greyed">Nothing to sell yet.</div>`;
    return list.map(rowHtml).join('');
  }
  function headerStrip() {
    return `<div class="ms-header">
      <span>Gold <b data-ms-gold>${fmt(R().get('gold'))}</b></span>
      <span>Gold Bars <b data-ms-bars>${fmt(barsHave())}</b></span>
    </div>`;
  }

  /* ---- Commodities ---- */
  const itemCost = (it) => it.bars * comQty[it.key];
  // Names come from the registry, so a resource rename propagates here
  // with no second copy to keep in sync.
  function grantText(it) {
    const nm = R().getName(it.grants);
    return `${fmt(it.amount * comQty[it.key])} ${it.crate ? 'crated ' + nm : nm}`;
  }
  // Gated here, in the function itself — the disabled button is only
  // cosmetic and is not what stops an unaffordable purchase.
  function buy(key) {
    const it = ITEMS.find((i) => i.key === key);
    if (!it) return;
    const cost = itemCost(it);
    if (barsHave() < cost) return;
    R().spend('goldbars', cost);
    const n = it.amount * comQty[key];
    if (it.crate) R().add(R().ensureCrate(it.grants), n);
    else { R().reveal(it.grants); R().add(it.grants, n); }
  }
  function itemHtml(it) {
    const cost = itemCost(it);
    // Same roman-numeral pill the card face and Tool Shed pips use —
    // one shared visual language for "this belongs to Tier N".
    const pill = it.tier
      ? `<span class="card-tier-pill">${['I', 'II', 'III', 'IV', 'V'][it.tier - 1]}</span>` : '';
    return `<div class="hs-card">
      <div class="hs-head">
        <span class="hs-title ms-item-title">${pill}${it.name}</span>
        <span class="upgrade-costtime" data-ms-cost="${it.key}">${fmt(cost)} Gold Bars</span>
      </div>
      <div class="hs-body">
        <div class="ms-row-body">
          <div class="ms-ctl ms-com-ctl"><span class="ms-ctl-label">Quantity</span>${stepper('c', it.key, fmt(comQty[it.key]), comQty[it.key] <= 1)}</div>
          <span class="ms-com-grant" data-ms-grant="${it.key}">${grantText(it)}</span>
          <div class="ms-right"><button class="action-btn ms-sell" data-ms-buy="${it.key}" ${barsHave() < cost ? 'disabled' : ''}>Buy</button></div>
        </div>
      </div>
    </div>`;
  }

  /* ---- Stock Market rendering ---- */
  // Hand-built inline SVG, no library. Both views auto-fit the axis to
  // the data on screen: the walk realistically wanders roughly
  // 0.5x-1.7x of base, well inside the hard 0.30x-2.5x clamp, so
  // drawing the full theoretical band would squeeze every line into a
  // sliver and hide the variance. The overlay also normalizes each
  // line to a percentage of its OWN base, since a shared raw axis
  // would flatten Wood next to Tools III.
  const W = 420, H = 140, PADL = 34, PADB = 16, PADT = 8;
  // Positional, not per-id: color N goes to whichever resource sits at
  // index N in tradeable()'s fixed creation-order list (currently wood,
  // stone, tools2, tools3 — see that function). Tools II/Tools III are
  // swapped from the plain sequence on purpose so Tools II reads red.
  // Each entry becomes a CSS var reference with its own hex as the
  // fallback, so a theme can restyle the first few series while the
  // later ones (no --chart-N defined) keep rendering from the hex.
  const COLORS = ['#6fa86f', '#5c9ead', '#c96a5e', '#8f6fbf', '#c9a227', '#b98a4a', '#7f8fa6', '#a86f96', '#6f9fa8'];
  const colorOf = (ids, id) => {
    const i = ids.indexOf(id) % COLORS.length;
    return `var(--chart-${i + 1}, ${COLORS[i]})`;
  };
  const SINGLE_LINE_COLOR = 'var(--chart-gold, #c9a227)'; // gold — used for any individually-viewed resource's line

  function polyline(vals, lo, hi, color) {
    if (vals.length < 2) return '';
    const span = hi - lo || 1;
    const pts = vals.map((v, i) => {
      const x = PADL + (i / (vals.length - 1)) * (W - PADL - 4);
      const y = PADT + (1 - (v - lo) / span) * (H - PADT - PADB);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    // stroke via style, not the presentation attribute — a var() reference
    // is only honored as a CSS property value.
    return `<polyline points="${pts}" fill="none" stroke-width="1.5" style="stroke:${color}"/>`;
  }
  function axis(lo, hi, suffix) {
    const y = (t) => PADT + t * (H - PADT - PADB);
    return [0, 0.5, 1].map((t) => {
      const v = hi - t * (hi - lo);
      // Styles sit on each element rather than the parent <svg>, so they
      // can never cascade onto the series polylines drawn alongside them.
      return `<line x1="${PADL}" y1="${y(t)}" x2="${W - 4}" y2="${y(t)}" stroke-width="1" style="stroke:var(--edge, #2a2a2a)"/>
        <text x="${PADL - 5}" y="${y(t) + 3}" text-anchor="end" font-size="8" style="fill:var(--text-muted, #6b6b6b)">${v >= 100 ? Math.round(v) : v.toFixed(1)}${suffix}</text>`;
    }).join('');
  }
  // Axis bounds from the data, with 10% headroom. minSpan keeps a
  // near-flat series from being magnified into meaningless noise.
  function fit(vals, minSpan) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.1 || minSpan * 0.5;
    let lo = min - pad, hi = max + pad;
    if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    return [lo, hi];
  }
  function graph(ids) {
    if (stockView === 'all') {
      // Each series as a % of its own base, axis fitted to the data.
      const series = ids.map((id) => ({ id, vals: stock(id).history.map((v) => (v / BASES[id]) * 100) }));
      const flat = series.reduce((a, s) => a.concat(s.vals), []);
      if (!flat.length) return '';
      const [lo, hi] = fit(flat, 10);          // at least a 10-point %-band
      return `<svg viewBox="0 0 ${W} ${H}" class="ms-graph">${axis(lo, hi, '%')}
        ${series.map((s) => polyline(s.vals, lo, hi, colorOf(ids, s.id))).join('')}</svg>`;
    }
    const s = stock(stockView), base = BASES[stockView];
    const [lo, hi] = fit(s.history, base * 0.1);   // at least a ±5%-of-base band
    return `<svg viewBox="0 0 ${W} ${H}" class="ms-graph">${axis(lo, hi, '')}
      ${polyline(s.history, lo, hi, SINGLE_LINE_COLOR)}</svg>`;
  }
  function legend(ids) {
    return `<div class="ms-legend">${ids.map((id) =>
      `<span class="ms-leg" data-ms-pick="${id}"><i style="background:${colorOf(ids, id)}"></i>${R().getName(id)}</span>`).join('')}</div>`;
  }
  const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  // Shared by the initial render and both live-patch sites below, so
  // the qty × price formula and its "g" formatting exist in one place.
  const totalHtml = (id) => `Transaction total: <b>${gfmt(tradeQty * stock(id).price)}g</b>`;
  function tradePanel(id) {
    const step = STEPS[id] || 1;
    const cap = R().getCap(id);
    return `<div class="ms-row"><div class="ms-row-head">
        <span class="ms-row-name">${R().getName(id)} <span class="ms-stock-count" data-ms-held>${fmt(R().available(id))}/${cap != null ? fmt(cap) : '∞'}</span></span>
        <span class="ms-row-status"><b data-ms-px>${stock(id).price.toFixed(2)}g</b> <span class="ms-unit-suffix">per unit</span></span></div>
      <div class="ms-row-body">
        <div class="ms-ctl ms-com-ctl"><span class="ms-ctl-label">Quantity</span>${stepper('t', 'qty', fmt(tradeQty), tradeQty <= step)}</div>
        <div class="ms-right ms-trade-btns">
          <button class="action-btn ms-sell" data-ms-trade="buy" ${buyableQty(id, tradeQty) ? '' : 'disabled'}>Buy</button>
          <button class="action-btn ms-sell" data-ms-trade="sell" ${sellableQty(id, tradeQty) ? '' : 'disabled'}>Sell</button>
        </div></div>
      <div class="ms-total" data-ms-total>${totalHtml(id)}</div>
      <div class="ms-band">The Stock Market range for ${R().getName(id)} is <b>${gfmt(FLOOR)}–${gfmt(ceilingOf(id))}</b> gold coins per unit.</div></div>`;
  }
  function stockTab() {
    const ids = tradeable();
    if (!ids.length) return `<div class="sp-tab-greyed">Nothing is traded here yet.</div>`;
    if (stockView !== 'all' && ids.indexOf(stockView) < 0) stockView = ids[0];
    if (stockView !== 'all') snapTradeQty();
    return `<div class="ms-stock">
      <div class="ms-stock-bar">
        <select class="sp-select" data-ms-view>
          <option value="all" ${stockView === 'all' ? 'selected' : ''}>All resources</option>
          ${ids.map((id) => `<option value="${id}" ${stockView === id ? 'selected' : ''}>${R().getName(id)}</option>`).join('')}
        </select>
        <span class="ms-next">Updates in <b data-ms-next>${clock(WALK_SECONDS - walkAccum)}</b></span>
        <button class="action-btn ms-sell" data-ms-speed ${barsHave() < 1 ? 'disabled' : ''}>-1 min</button>
        <span class="ms-speed-note">Costs 1 gold bar</span>
      </div>
      ${stockView === 'all' ? legend(ids) : ''}
      ${graph(ids)}
      ${stockView === 'all' ? '' : tradePanel(stockView)}</div>`;
  }

  const mechanic = {
    id: ID,
    section: 'Camp',
    startHidden: true,
    upkeepExempt: true,
    modalWide: true,
    facePill: '$',
    cardName: () => 'Market Stall',
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots: () => visibleRows().map((r) => r.id), subAdd: (id) => subAssign(id),
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return 'Bundle resources for gold';
      if (!ROWS.some((r) => rows[r.id].phase !== 'idle')) return '';
      const gps = liveGps();
      return gps > 0 ? `+${gps.toFixed(2)} g/s` : 'Stopped';
    },
    // Rail rate (js/core/rates.js): sales pay in lumps, so Gold shows this
    // card-face projection instead of the measured payouts.
    rateFor: (id) => (id === 'gold' ? liveGps() : undefined),
    getUpgradeBarPct: () => 0,
    getWorkerDesc() {
      const n = totalSubWorkers();
      return n === 0 ? '' : `Selling with ${n}`;
    },
    getSubtitleHtml: () => `<div class="tool-pips-row"><div class="card-tier-pill pill-glyph">$</div><span class="tool-pips-label">Workers are free</span></div>`,
    renderModalHTML() {
      const tab = (key, label) => `<button class="sp-tab${activeTab === key ? ' active' : ''}" data-ms-tab="${key}">${label}</button>`;
      const body = activeTab === 'selling' ? sellingTab()
        : activeTab === 'commodities' ? ITEMS.map(itemHtml).join('')
        : stockTab();
      return `<div class="marketstall-modal">${headerStrip()}
        <div class="sp-tabs">${tab('selling', 'Selling')}${tab('stock', 'Stock Market')}${tab('commodities', 'Commodities')}</div>
        <div class="sp-tab-body ms-body">${body}</div></div>`;
    },
    // Live-patch the numbers that move every tick, so the modal never
    // re-renders under the player's cursor mid-drag.
    patchLiveTrack() {
      // The header strip is shared by every tab, so it patches first
      // and unconditionally; only the body below it branches.
      const g = q('[data-ms-gold]'); if (g) g.textContent = fmt(R().get('gold'));
      const b = q('[data-ms-bars]'); if (b) b.textContent = fmt(barsHave());
      if (activeTab === 'commodities') {
        ITEMS.forEach((it) => {
          const cost = itemCost(it);
          const btn = q(`[data-ms-buy="${it.key}"]`);
          if (btn) btn.disabled = barsHave() < cost;
        });
        return;
      }
      if (activeTab === 'stock') {
        // The SVG is deliberately NOT rebuilt here — a line that moves
        // once every ten minutes has no business repainting five times
        // a second. renderModalHTML handles that on a real walk step.
        const n = q('[data-ms-next]'); if (n) n.textContent = clock(WALK_SECONDS - walkAccum);
        const sp = q('[data-ms-speed]'); if (sp) sp.disabled = barsHave() < 1;
        if (stockView !== 'all' && stocks[stockView]) {
          const px = q('[data-ms-px]'); if (px) px.textContent = `${stocks[stockView].price.toFixed(2)}g`;
          const tot = q('[data-ms-total]'); if (tot) tot.innerHTML = totalHtml(stockView);
          const hd = q('[data-ms-held]');
          if (hd) { const c = R().getCap(stockView); hd.textContent = `${fmt(R().available(stockView))}/${c != null ? fmt(c) : '∞'}`; }
          const bb = q('[data-ms-trade="buy"]'); if (bb) bb.disabled = !buyableQty(stockView, tradeQty);
          const sb = q('[data-ms-trade="sell"]'); if (sb) sb.disabled = !sellableQty(stockView, tradeQty);
        }
        return;
      }
      if (activeTab !== 'selling') return;
      visibleRows().forEach((r) => {
        const s = rows[r.id];
        const active = s.phase !== 'idle';
        const st = q(`[data-ms-status="${r.id}"]`);
        if (st) st.textContent = s.phase === 'gathering' ? `Gathering ${fmt(s.gathered)}/${fmt(s.qty)}`
          : s.phase === 'selling' ? `Selling ${Math.floor(s.progress * 100)}%` : '';
        const btn = q(`[data-ms-sell="${r.id}"]`);
        if (btn) { btn.disabled = active ? false : !canStart(r); btn.textContent = active ? 'Cancel' : 'Sell'; }
        // Quantity locks (both buttons) for exactly as long as the row
        // is non-idle — this is a display of the existing "quantity
        // locks mid-sale" gate in the step handler, not a new rule.
        const qMinus = q(`[data-ms-step="q"][data-ms-row="${r.id}"][data-ms-dir="-1"]`);
        if (qMinus) qMinus.disabled = active || s.qty <= QTY_STEP;
        const qPlus = q(`[data-ms-step="q"][data-ms-row="${r.id}"][data-ms-dir="1"]`);
        if (qPlus) qPlus.disabled = active;
        const bar = q(`[data-ms-bar="${r.id}"]`);
        if (bar) bar.style.width = (s.phase === 'selling' ? s.progress * 100 : 0) + '%';
        const sc = q(`[data-ms-stock="${r.id}"]`);
        if (sc) { const cap = R().getCap(r.id); sc.textContent = `${fmt(R().available(r.id))}/${cap != null ? fmt(cap) : '∞'}`; }
      });
    },
    afterRender() {
      const body = document.getElementById('card-modal-body');
      if (!body) return;
      body.querySelectorAll('[data-ms-tab]').forEach((el) => el.addEventListener('click', () => {
        activeTab = el.getAttribute('data-ms-tab');
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }));
      body.querySelectorAll('[data-ms-sell]').forEach((el) => el.addEventListener('click', () => {
        const id = el.getAttribute('data-ms-sell');
        const s = rows[id];
        (s && s.phase !== 'idle' ? cancelSale : startSale)(id);
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }));
      const redraw = () => window.OrbWeaver.Cards.refreshOpenModal(ID);
      const view = body.querySelector('[data-ms-view]');
      if (view) view.addEventListener('change', () => { stockView = view.value; redraw(); });
      body.querySelectorAll('[data-ms-pick]').forEach((el) => el.addEventListener('click', () => {
        stockView = el.getAttribute('data-ms-pick'); redraw();
      }));
      body.querySelectorAll('[data-ms-trade]').forEach((el) => el.addEventListener('click', () => {
        const kind = el.getAttribute('data-ms-trade');
        const n = kind === 'buy' ? stockBuy(stockView) : stockSell(stockView);
        redraw();
        // redraw() replaces the button, so the confirmation flash goes
        // on the fresh one — and only when units actually changed hands.
        if (!n) return;
        const fresh = q(`[data-ms-trade="${kind}"]`);
        if (!fresh) return;
        fresh.classList.add('ms-flash');
        setTimeout(() => fresh.classList.remove('ms-flash'), 220);
      }));
      const speed = body.querySelector('[data-ms-speed]');
      if (speed) speed.addEventListener('click', () => { speedUp(); advanceWalk(0); redraw(); });
      body.querySelectorAll('[data-ms-buy]').forEach((el) => el.addEventListener('click', () => {
        buy(el.getAttribute('data-ms-buy'));
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }));
      body.querySelectorAll('[data-ms-auto]').forEach((el) => el.addEventListener('click', () => {
        const s = rows[el.getAttribute('data-ms-auto')];
        if (!s) return;
        s.auto = !s.auto;
        el.classList.toggle('on', s.auto);
      }));
      body.querySelectorAll('[data-ms-step]').forEach((el) => {
        const kind = el.getAttribute('data-ms-step');
        const id = el.getAttribute('data-ms-row');
        const dir = parseInt(el.getAttribute('data-ms-dir'), 10);
        // Patch a stepper's displayed value and its ±-disabled states in
        // place, without rebuilding the DOM. This keeps the held element
        // connected so hold-repeat keeps firing throughout the hold.
        const patchStepper = (valText, minusOff, plusOff) => {
          const val = body.querySelector(`[data-ms-val="${kind}-${id}"]`);
          if (val) val.textContent = valText;
          const minus = body.querySelector(`[data-ms-step="${kind}"][data-ms-row="${id}"][data-ms-dir="-1"]`);
          const plus  = body.querySelector(`[data-ms-step="${kind}"][data-ms-row="${id}"][data-ms-dir="1"]`);
          if (minus) minus.disabled = minusOff;
          if (plus)  plus.disabled  = plusOff;
        };
        // Refresh everything a sell row renders from state — the readout
        // panel and the Sell button. Both the worker and quantity branches
        // call it, so neither has to track which displays its own value
        // feeds (the omission that left Quantity's readout stale).
        const patchRow = (rowId) => {
          const r = ROWS.find((x) => x.id === rowId), s = rows[rowId];
          if (!r || !s) return;
          const ro = body.querySelector(`[data-ms-readout="${rowId}"]`);
          if (ro) ro.innerHTML = readoutInner(r);
          const sellBtn = body.querySelector(`[data-ms-sell="${rowId}"]`);
          if (sellBtn && s.phase === 'idle') sellBtn.disabled = !canStart(r);
        };
        const act = () => {
          if (kind === 'w') {
            dir > 0 ? subAssign(id, true) : subUnassign(id, true);
            // subAssign/Unassign change rows[id].workers; patch the value
            // and buttons in-place so the held element stays connected.
            const s = rows[id];
            if (s) patchStepper(s.workers, s.workers <= 0, false);
            patchRow(id);
            return;
          }
          if (kind === 'c') {
            comQty[id] = Math.max(1, comQty[id] + dir);
            patchStepper(fmt(comQty[id]), comQty[id] <= 1, false);
            // Cost label and Buy disabled state need patching too.
            const costEl = body.querySelector(`[data-ms-cost="${id}"]`);
            const it = window.OrbWeaver.MarketStall._com && ITEMS.find((i) => i.key === id);
            if (costEl && it) costEl.textContent = `${fmt(itemCost(it))} Gold Bars`;
            const btn = body.querySelector(`[data-ms-buy="${id}"]`);
            if (btn) btn.disabled = barsHave() < itemCost(it);
            const grantEl = body.querySelector(`[data-ms-grant="${id}"]`);
            if (grantEl && it) grantEl.textContent = grantText(it);
            return;
          }
          if (kind === 't') {
            const step = STEPS[stockView] || 1;
            tradeQty = Math.max(step, tradeQty + dir * step);
            patchStepper(fmt(tradeQty), tradeQty <= step, false);
            const bb = body.querySelector('[data-ms-trade="buy"]');
            const sb = body.querySelector('[data-ms-trade="sell"]');
            if (bb) bb.disabled = !buyableQty(stockView, tradeQty);
            if (sb) sb.disabled = !sellableQty(stockView, tradeQty);
            const tot = body.querySelector('[data-ms-total]'); if (tot) tot.innerHTML = totalHtml(stockView);
            return;
          }
          const s = rows[id];
          if (!s || s.phase !== 'idle') return;   // quantity locks mid-sale
          s.qty = Math.max(QTY_STEP, s.qty + dir * QTY_STEP);
          patchStepper(fmt(s.qty), s.qty <= QTY_STEP, false);
          patchRow(id); // total and g/s both scale with qty, and so does gather time
        };
        window.OrbWeaver.Cards.addHoldBehavior(el, act);
      });
    },
    tick(goldAvailable, tickRate) {
      ROWS.forEach((r) => {
        tickRow(r, tickRate);
        const s = rows[r.id];
        if (s.phase === 'idle' && s.auto && s.workers > 0) startSale(r.id);
      });
      // A landed walk step is the one moment the graph genuinely needs
      // redrawing, so the rebuild is tied to it rather than to the tick.
      if (advanceWalk(tickRate) && activeTab === 'stock') window.OrbWeaver.Cards.refreshOpenModal(ID);
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ---- Every row's own state plus the open tab. */
  window.OrbWeaver.Save.register(ID,
    () => ({
      o: opened ? 1 : 0, t: activeTab, c: comQty,
      // walkAccum MUST travel with the save: at a 600s interval,
      // dropping it silently discards up to ten minutes on every
      // reload. `base` is deliberately NOT saved — it's re-read from
      // BASES on load, so prices stay rebalanceable after release.
      w: walkAccum, n: walkCount, v: stockView, tq: tradeQty,
      s: Object.keys(stocks).reduce((o, id) => { o[id] = [stocks[id].price, stocks[id].history]; return o; }, {}),
      r: ROWS.reduce((o, r) => { const s = rows[r.id]; o[r.id] = [s.qty, s.workers, s.phase, s.gathered, s.progress, s.auto ? 1 : 0]; return o; }, {})
    }),
    (d) => {
      if (!d) return;
      opened = !!d.o;
      activeTab = d.t || 'selling';
      Object.assign(comQty, d.c || {});   // pre-Commodities saves simply keep the default of 1
      walkAccum = d.w || 0;
      // A save written before shocks existed starts past the scripted
      // Wood update — it is a one-off opening beat, not something to
      // spring on a game already hours old.
      walkCount = d.n != null ? d.n : WOOD_SHOCK_AT;
      stockView = d.v || 'wood';
      tradeQty = d.tq || 1;
      Object.keys(d.s || {}).forEach((id) => {
        if (!BASES[id]) return;           // a retired resource is dropped, not resurrected
        stocks[id] = { price: d.s[id][0], history: d.s[id][1].slice() };
      });
      ROWS.forEach((r) => {
        const v = (d.r || {})[r.id];
        if (!v) return;
        const s = rows[r.id];
        s.qty = v[0]; s.workers = v[1]; s.phase = v[2]; s.gathered = v[3]; s.progress = v[4]; s.auto = !!v[5];
      });
    });

  window.OrbWeaver.Mechanics.register(mechanic);
  window.OrbWeaver.MarketStall = { _rows: rows, _com: comQty, _stocks: stocks, startSale, cancelSale, subAssign, subUnassign,
    buy, stockBuy, stockSell, speedUp, advanceWalk, tradeable, buyPrice, sellPrice, tradeCost,
    getWalkAccum: () => walkAccum, getWalkCount: () => walkCount, setTradeQty: (n) => { tradeQty = n; }, setView: (v) => { stockView = v; } };
})();
