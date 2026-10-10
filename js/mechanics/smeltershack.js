/* ============================================================
   MECHANIC: SMELTER SHACK (Mountains section)
   Revealed alongside Gold Panning (see mountains.js). A growable list
   of Forges (2 to start, buyable to 8, 2000 Gold Bars each) — each an
   independent state machine converting Gold Dust/Nuggets (hidden
   ledger, js/core/hiddenRes.js) into Molten Gold, then into Gold Bars
   (visible Mountains resource, mtn_goldbars) or Gold Coins (shared
   gold), fueled continuously by Wood drawn from mtn_wood.

   Per-Forge cycle: Heating (wood 0->200) -> Filling (ore adds to
   molten 0->100, output inert) -> Outputting (molten first hits 100;
   one-way flag — ore keeps adding, output keeps draining, wood keeps
   burning, indefinitely) -> Stopped (molten or wood hits 0; Smelt
   must be pressed again, resetting wood+molten to 0). Wood nets
   (wood workers' rate) minus a flat 1/s burn once Filling begins;
   Heating is pure accumulation, no burn.

   No cycles.js here — unlike Gold Panning's dice rolls, every rate is
   continuous and deterministic, so plain rate*tickRate deltas (same
   idiom as mountains.js's own timers) are all this needs.

   Molten/ore gain is derived from what was actually SPENT from the
   hidden ledger (not assumed), so a Gold Dust/Nugget shortfall slows
   Molten gain gracefully instead of overshooting.

   Billing: only workers on an actively-cycling Forge cost gold —
   workers parked on a Stopped Forge (waiting for Smelt) are free,
   same philosophy as Mountains' own getBillableCount(). Gold
   starvation pauses every worker-driven rate (wood gain, ore->molten,
   molten->output — same convention as academy.js) but NOT the flat
   wood burn, which is physical rather than worker-driven and keeps
   consuming stored wood regardless — a pure cost, never a benefit, so
   a starved Forge still runs its wood down and eventually auto-stops
   via stopForge(), which is what actually drops the molten bar.

   A resource tracker strip sits above the Forge grid — Gold Dust and
   Nuggets stock only (see RES_BAR). Their per-second rate deliberately
   lives only on each ore row (oreRateText) — not duplicated up here.

   Modal: a wrapping 2-per-row grid of Forge hs-cards (.sm-grid/.sm-
   forge) plus an Add Forge prompt, all sm-prefixed CSS in style.css.
   Steppers use hold-to-repeat (afterRender); selects/remove/Smelt-
   Cancel/Add-Forge are delegated document listeners, since Phase C's
   own functions already call refreshOpenModal() on every structural
   change. patchLiveTrack() covers everything else in place, every
   tick, including phase flips tickForge() triggers on its own (e.g.
   an automatic Stop from Molten or Wood hitting 0) — nothing about
   that path calls refreshOpenModal, so the live-patch is load-bearing
   there, not just a smoothness nicety. See SMELTER-SHACK-HANDOFF.md
   for the full per-phase design rationale.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'smeltershack';
  const FORGE_CAP = 8;
  const ADD_COST = 2000;          // Gold Bars per bought Forge
  const ORE_CAP = 2;              // max ore-input rows per Forge
  const WOOD_CAP = 200;
  const WOOD_BURN = 2;            // flat, per Forge per second, Filling+Outputting only
  const MOLTEN_CAP = 100;
  // Heat = the Hearth's wood bank. Heating ends (burning starts) at BURN_AT;
  // the band then sets Anvil speed only: Cool below COOL_BELOW, Hot above HOT_ABOVE.
  const BURN_AT = 50, COOL_BELOW = 80, HOT_ABOVE = 150;
  const HEAT = [
    { cls: 'cool', label: 'Cool -x0.5', mult: 0.5 },
    { cls: 'hot', label: 'Hot', mult: 1 },
    { cls: 'superheat', label: 'Superheating +x1.5', mult: 1.5 }
  ];
  function heat(f) { return HEAT[f.woodBank < COOL_BELOW ? 0 : f.woodBank <= HOT_ABOVE ? 1 : 2]; }

  // Deterministic Mountains-prefixed ids (Mountains' prefix + base name)
  // — no need to save these pointers, see wheatfieldcard.js's identical
  // RES pattern for mtn_wheatbundle. Gold Bars and Copper Tool Head can
  // each arrive two ways (cargo delivery OR being produced here first),
  // so both get a lazy reveal; Copper Ingots and Luxury are produced
  // here only, same idiom.
  const GOLDBARS_ID = 'mtn_goldbars';
  const COPPERHEAD_ID = 'mtn_copperhead';
  const COPPERINGOTS_ID = 'mtn_copperingots';
  const LUXURY_ID = 'mtn_luxury';
  function ensureGoldBarsRevealed() {
    if (!window.OrbWeaver.Resources.exists(GOLDBARS_ID)) window.OrbWeaver.Mountains.ensureResource('goldbars', 'Gold Bars');
  }
  function ensureCopperheadRevealed() {
    if (!window.OrbWeaver.Resources.exists(COPPERHEAD_ID)) window.OrbWeaver.Mountains.ensureResource('copperhead', 'Copper Tool Head');
  }
  function ensureCopperIngotsRevealed() {
    if (!window.OrbWeaver.Resources.exists(COPPERINGOTS_ID)) window.OrbWeaver.Mountains.ensureResource('copperingots', 'Copper Ingots');
  }
  function ensureLuxuryRevealed() {
    if (!window.OrbWeaver.Resources.exists(LUXURY_ID)) window.OrbWeaver.Mountains.ensureResource('luxury', 'Luxury');
  }

  // Ore kinds: m = raw units consumed per worker/s (also the divisor —
  // 1 Molten point per `m` units actually spent, so every ore kind
  // feeds Molten at the same 1/worker/s pace, just at different raw
  // costs). Each kind declares its own source as take(want) -> actually
  // spent, so tickForge() never special-cases where a resource lives
  // (HiddenRes vs. the public Resources registry). `gate`, when
  // present, hides the kind from the manual "+ Add resource…" dropdown
  // until it returns true — omitted entirely for a kind that's always
  // offered (Gold Dust/Nuggets, in the hidden ledger from the start).
  const ORE_KINDS = {
    golddust: { name: 'Gold Dust', m: 24, take: (want) => window.OrbWeaver.HiddenRes.spend('golddust', want) },
    nugget:   { name: 'Gold Nuggets', m: 3, take: (want) => window.OrbWeaver.HiddenRes.spend('nugget', want) },
    goldbars: { name: 'Gold Bars', m: 1, take: (want) => window.OrbWeaver.Resources.spend(GOLDBARS_ID, want), gate: () => window.OrbWeaver.Resources.exists(GOLDBARS_ID) },
    copperhead: { name: 'Copper Tool Head', m: 2, take: (want) => window.OrbWeaver.Resources.spend(COPPERHEAD_ID, want), gate: () => window.OrbWeaver.Resources.exists(COPPERHEAD_ID) },
    copperingots: { name: 'Copper Ingots', m: 1, take: (want) => window.OrbWeaver.Resources.spend(COPPERINGOTS_ID, want), gate: () => window.OrbWeaver.Resources.exists(COPPERINGOTS_ID) }
  };
  // Output kinds: m = Molten consumed per worker/s (also the divisor —
  // 1 unit of output per `m` Molten actually consumed). Each declares
  // its own sink as give(amount), which also owns revealing its
  // resource on first production. `multiplier` (default 1 when
  // omitted) is the payout multiplier applied to the raw units/s
  // before give() is called — Gold Coins' ×10 lives here now instead
  // of an inline conditional in tickForge().
  const OUTPUT_KINDS = {
    goldbars:  { name: 'Gold Bars',  m: 6, give: (n) => { ensureGoldBarsRevealed(); window.OrbWeaver.Resources.add(GOLDBARS_ID, n); } },
    goldcoins: { name: 'Gold Coins', m: 2, multiplier: 10, give: (n) => window.OrbWeaver.Resources.add('gold', n) },
    copperhead: { name: 'Copper Tool Head', m: 1, give: (n) => { ensureCopperheadRevealed(); window.OrbWeaver.Resources.add(COPPERHEAD_ID, n); } },
    copperingots: { name: 'Copper Ingots', m: 1, give: (n) => { ensureCopperIngotsRevealed(); window.OrbWeaver.Resources.add(COPPERINGOTS_ID, n); } },
    luxury: { name: 'Luxury', m: 1, give: (n) => { ensureLuxuryRevealed(); window.OrbWeaver.Resources.add(LUXURY_ID, n); } }
  };
  const WOOD_M = 1; // wood banked per worker/s (baseline mpf dial)
  let goldStarved = false;

  // RECIPES — an additive shortcut only; the manual ore/output controls
  // below stay exactly as they are, and a player can always configure a
  // Forge entirely by hand and ignore this. All six are known from the
  // start (how a recipe becomes known is deliberately undecided — see
  // SMELTER-RECIPES-HANDOFF.md's Out of scope). Display order below is
  // render order. No recipe id is ever stored on a Forge — "configured
  // by a recipe" and "configured by hand" are the same observable state
  // (the Forge isn't empty), so there's nothing to persist here.
  const RECIPES = [
    { inputs: ['golddust'], output: 'goldcoins' },
    { inputs: ['nugget'], output: 'goldbars' },
    { inputs: ['golddust', 'nugget'], output: 'goldbars' },
    { inputs: ['copperhead'], output: 'copperingots' },
    { inputs: ['copperingots'], output: 'copperhead' },
    { inputs: ['copperingots', 'goldbars'], output: 'luxury' }
  ];
  // The single target rule: the first Forge, in order, that is stopped
  // AND has nothing configured. A hand-configured Forge, a recipe-
  // configured Forge, and a Forge that auto-stopped mid-cycle (which
  // preserves its ore/output selections) are all "not empty" and are
  // all skipped identically — Clear (below) is what makes a Forge
  // empty again.
  function emptyForgeIndex() { return forges.findIndex((f) => f.phase === 'stopped' && f.ore.length === 0 && !f.output.res); }
  // null when applicable; otherwise the one short reason a disabled
  // recipe row should show. "No empty Forge" wins over any per-recipe
  // ingredient reason, since it's true for every recipe at once.
  function recipeDisabledReason(r) {
    if (emptyForgeIndex() < 0) return 'No empty Forge';
    const missing = r.inputs.find((res) => { const k = ORE_KINDS[res]; return k.gate && !k.gate(); });
    return missing ? `No ${ORE_KINDS[missing].name}` : null;
  }
  // Fills the target Forge's ore rows and output row only — no worker
  // assignment, no auto-Smelt. The player still staffs and presses
  // Smelt themselves, exactly as for a hand-built Forge.
  function applyRecipe(ri) {
    const r = RECIPES[ri];
    if (!r || recipeDisabledReason(r)) return;
    const idx = emptyForgeIndex();
    if (idx < 0) return;
    const f = forges[idx];
    f.ore = r.inputs.map((res) => ({ res }));
    f.output.res = r.output;
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  let forges = [];
  function pool() { return window.OrbWeaver.Mountains.workerPool; }
  // Raw worker-effort this tick — m/p/f left at baseline (1,1,0), same
  // convention as Tool Shed/Mountains/Gold Panning (no local buff dial
  // of its own yet). Each ore/output/wood kind's own ratio (kind.m)
  // multiplies the result OUTSIDE this call, rather than occupying the
  // m slot — so a future global M lands uniformly across every kind
  // instead of scaling by 1/kind.m (the bug this fixes: previously
  // kind.m sat IN the m slot, so the same global buff was worth a
  // different % on Gold Dust (m=24) than on Gold Bars (m=1), on the
  // same card, same tick).
  function workUnits(n) { return window.OrbWeaver.Upgrades.workerRate(n, 1, 1, 0); }

  function makeForge() {
    return { phase: 'stopped', ore: [], oreWorkers: 0, woodWorkers: 0, woodBank: 0, molten: 0, output: { res: null, workers: 0 } };
  }
  function seed() { forges = [makeForge(), makeForge()]; }

  /* ---- Worker sub-slots (same rules as Gold Panning/Mountains) ----
     Every worker physically placed in any row on any Forge counts
     toward usedWorkers(), regardless of that Forge's phase — a worker
     parked on a Stopped Forge is still "there", just unbilled. */
  function rowWorkers(f) { return f.oreWorkers + f.woodWorkers + f.output.workers; }
  // Input is one shared stepper: its work splits evenly across the Forge's ore rows.
  function oreShare(f) { return f.ore.length ? workUnits(f.oreWorkers) / f.ore.length : 0; }
  function usedWorkers() { return forges.reduce((sum, f) => sum + rowWorkers(f), 0); }
  function billableWorkers() { return forges.reduce((sum, f) => f.phase === 'stopped' ? sum : sum + rowWorkers(f), 0); }
  function freeCardWorkers() { return pool().getAssigned(ID) - usedWorkers(); }

  // Card-"+" slot keys (cards.js subSlots): Input (once it has an ore), Wood, Anvil (once an output is chosen).
  const slotKey = (i, slot) => `${i}|${slot}|`;
  const subSlots = () => forges.flatMap((f, i) => [...(f.ore.length ? [slotKey(i, 'ore')] : []), slotKey(i, 'wood'), ...(f.output.res ? [slotKey(i, 'output')] : [])]);
  function subAdd(k) { const [i, slot] = k.split('|'); subAssign(+i, slot); }
  // Slot field per sub-stepper; 'ore' is the shared Input count.
  const FIELD = { ore: (f) => f, wood: (f) => f, output: (f) => f.output };
  const PROP = { ore: 'oreWorkers', wood: 'woodWorkers', output: 'workers' };
  function subAssign(forgeIdx, slot) {
    const f = forges[forgeIdx];
    if (!f || !FIELD[slot]) return;
    if ((slot === 'output' && !f.output.res) || (slot === 'ore' && !f.ore.length)) return; // nothing to staff yet
    if (freeCardWorkers() <= 0) { if (!pool().assign(ID)) return; }
    FIELD[slot](f)[PROP[slot]]++;
    mechanic.lastSub = slotKey(forgeIdx, slot);
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  function subUnassign(forgeIdx, slot) {
    const f = forges[forgeIdx];
    if (!f || !FIELD[slot] || FIELD[slot](f)[PROP[slot]] <= 0) return;
    FIELD[slot](f)[PROP[slot]]--;
    pool().unassign(ID); // a modal − returns the worker to idle (fires the card refresh)
  }
  // Card-face stepper shrinking below sum-of-rows: clamp greedily,
  // Forge order then Input/Wood/Anvil within each (earlier keeps priority).
  pool().onChange(() => {
    let budget = pool().getAssigned(ID);
    forges.forEach((f) => ['ore', 'wood', 'output'].forEach((slot) => {
      const o = FIELD[slot](f), keep = Math.min(o[PROP[slot]], budget);
      o[PROP[slot]] = keep; budget -= keep;
    }));
  });

  /* ---- Resource selection (locked while a Forge is active) ---- */
  function isLocked(f) { return f.phase !== 'stopped'; }
  function addOre(forgeIdx, res) {
    const f = forges[forgeIdx];
    if (!f || isLocked(f) || f.ore.length >= ORE_CAP || !ORE_KINDS[res]) return;
    if (f.ore.some((o) => o.res === res)) return;
    f.ore.push({ res });
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  function removeOre(forgeIdx, oreIdx) {
    const f = forges[forgeIdx];
    if (!f || isLocked(f) || !f.ore[oreIdx]) return;
    // Deliberately does NOT call pool().unassign() — those workers stay
    // counted in the card's total budget, just freed up for another row
    // on this card, same as sliding a worker between sub-slots elsewhere.
    f.ore.splice(oreIdx, 1);
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  function setOutput(forgeIdx, res) {
    const f = forges[forgeIdx];
    if (!f || isLocked(f) || !OUTPUT_KINDS[res]) return;
    // Switching Gold Bars <-> Gold Coins retargets the same slot — the
    // workers already staffed there carry over, no re-staffing needed.
    f.output.res = res;
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  // Empties a stopped Forge back to the RECIPES apply target — load-
  // bearing, not a convenience: without it, a fully hand-configured
  // board could never become eligible for a recipe again, since the
  // empty check (RECIPES section, emptyForgeIndex()) would never match.
  // Deliberately does not touch any worker count, matching removeOre()'s
  // documented behavior exactly — workers stay counted in the card's
  // total budget, freed up for another row on this same card.
  function clearForge(forgeIdx) {
    const f = forges[forgeIdx];
    if (!f || isLocked(f)) return;
    f.ore = [];
    f.output.res = null;
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  /* ---- Smelt / Cancel ---- */
  function canSmelt(f) { return f.phase === 'stopped' && f.ore.length > 0 && f.woodWorkers > 0 && !!f.output.res; }
  function smelt(forgeIdx) {
    const f = forges[forgeIdx];
    if (!f || !canSmelt(f)) return;
    f.phase = 'heating';
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  function cancel(forgeIdx) {
    const f = forges[forgeIdx];
    if (!f || f.phase === 'stopped') return;
    stopForge(f);
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }
  // note: why an automatic stop happened, shown in the Forge header until the player touches that Forge (never saved).
  function stopForge(f, note) { f.phase = 'stopped'; f.woodBank = 0; f.molten = 0; f.note = note || ''; }

  /* ---- Add-Forge ---- */
  function canAdd() { return forges.length < FORGE_CAP && window.OrbWeaver.Resources.exists(GOLDBARS_ID) && window.OrbWeaver.Resources.get(GOLDBARS_ID) >= ADD_COST; }
  function atCap() { return forges.length >= FORGE_CAP; }
  function addForge() {
    if (!canAdd()) return;
    window.OrbWeaver.Resources.spend(GOLDBARS_ID, ADD_COST);
    forges.push(makeForge());
    window.OrbWeaver.Footer.push('New Forge built.');
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  /* ---- Per-Forge tick ---- */
  function tickForge(f, tickRate, goldAvailable) {
    if (f.phase === 'stopped') return;

    const MTN_WOOD = 'mtn_wood';
    if (f.phase === 'heating') {
      if (goldAvailable) f.woodBank = Math.min(WOOD_CAP, f.woodBank + window.OrbWeaver.Resources.spend(MTN_WOOD, workUnits(f.woodWorkers) * WOOD_M * tickRate));
      if (f.woodBank >= BURN_AT) f.phase = 'filling';
      return;
    }

    // filling or outputting: the flat burn is physical, not worker-driven
    // — it keeps consuming stored wood even while gold-starved, a pure
    // cost to the player, never a benefit, so it's fine to let it run
    // unpaid. Worker-driven wood gain draws from mtn_wood (same as ore
    // rows draw from HiddenRes) and pauses on gold starvation. Other
    // worker-driven rates (ore->molten, molten->output) likewise pause.
    const woodGain = goldAvailable ? window.OrbWeaver.Resources.spend(MTN_WOOD, workUnits(f.woodWorkers) * WOOD_M * tickRate) : 0;
    f.woodBank = Math.min(WOOD_CAP, Math.max(0, f.woodBank + woodGain - WOOD_BURN * tickRate));
    if (f.woodBank <= 0) { stopForge(f, 'Empty Wood'); return; }
    if (!goldAvailable) return;

    f.ore.forEach((o) => {
      const kind = ORE_KINDS[o.res];
      const want = oreShare(f) * kind.m * tickRate;
      const spent = kind.take(want);
      f.molten = Math.min(MOLTEN_CAP, f.molten + spent / kind.m);
    });

    if (f.phase === 'filling' && f.molten >= MOLTEN_CAP) f.phase = 'outputting';

    if (f.phase === 'outputting' && f.output.res) {
      const kind = OUTPUT_KINDS[f.output.res];
      const want = workUnits(f.output.workers) * kind.m * heat(f).mult * tickRate;
      const consumed = Math.min(f.molten, want);
      f.molten -= consumed;
      const gained = (consumed / kind.m) * (kind.multiplier || 1);
      if (gained > 0) kind.give(gained);
      if (f.molten <= 0) stopForge(f, 'Empty molten pool');
    }
  }

  /* ---- Resource tracker strip ---- Gold Dust, Gold Nuggets and Gold
     Bars stock, live every tick via patchLiveTrack(). The per-second
     rate deliberately lives ONLY on each Forge's own ore row (see
     oreRateText below) — showing it up here too would just be the
     same number twice, so this strip is amount-only. `whole: true`
     floors a row's display instead of rounding — required for any
     whole-number resource (Resources.register()'s own whole-number
     rule, js/core/resources.js), so this strip can never read
     "2000/2000" one tick before the sidebar (which floors) agrees.
     `visible`, when present, hides a row until it returns true —
     Copper Ingots doesn't exist until first produced, same rule the
     manual ore dropdown already uses for gated kinds; Gold Bars stays
     unconditionally shown (0 before it exists), matching its existing
     behavior from before this session. Copper Tool Head and Luxury are
     deliberately left out of this strip.
     resBarKeysAtRender is Tool Shed's own trick (js/mechanics/
     toolshed.js): it records which rows were last rendered so
     patchLiveTrack can tell a row was gained/lost and trigger a
     structural rebuild instead of patching values into rows that
     don't exist in the DOM yet. */
  const RES_BAR = [
    { key: 'wood', label: 'Wood', amt: () => window.OrbWeaver.Resources.get('mtn_wood') },
    { key: 'golddust', label: 'Gold Dust', amt: () => window.OrbWeaver.HiddenRes.get('golddust') },
    { key: 'nugget',   label: 'Gold Nuggets', amt: () => window.OrbWeaver.HiddenRes.get('nugget') },
    { key: 'goldbars', label: 'Gold Bars', whole: true, amt: () => window.OrbWeaver.Resources.exists(GOLDBARS_ID) ? window.OrbWeaver.Resources.get(GOLDBARS_ID) : 0 },
    { key: 'copperingots', label: 'Copper Ingots', whole: true, visible: () => window.OrbWeaver.Resources.exists(COPPERINGOTS_ID), amt: () => window.OrbWeaver.Resources.get(COPPERINGOTS_ID) }
  ];
  let resBarKeysAtRender = null;
  function resBarVisible() { return RES_BAR.filter((r) => !r.visible || r.visible()); }
  function resBarAmt(r) { return r.whole ? Math.floor(r.amt()) : Math.round(r.amt()); }
  function resBar() {
    const rows = resBarVisible();
    resBarKeysAtRender = rows.map((r) => r.key).join(',');
    return `<div class="sm-resbar"><div class="sm-resbar-item">${rows.map((r) => `<div class="sm-resbar-stat">
      <span class="sm-resbar-label">${r.label}</span>
      <span class="sm-resbar-amt" data-sm-res-amt="${r.key}">${resBarAmt(r)}</span>
    </div>`).join('')}</div></div>`;
  }

  /* ---- Recipes bar (Phase F) ---- A native <details>, deliberately:
     reuses Scout Stable's Add-Station disclosure shell (.sp-add/.sp-strip
     for the collapsed strip + open border, .sp-panel-row for each row's
     name-left/button-right layout) verbatim — sm-recipes/sm-recipes-strip
     are carried as extra classes purely as data hooks for this file's own
     queries, not for any new styling; only the recipe-specific bits (the
     arrow, the disabled dim, the reason line) get new CSS. No open/closed
     state is held: refreshOpenModal() rebuilds fresh (closed) markup on
     every structural change, including applyRecipe() itself, so the bar
     self-collapses after use for free. patchLiveTrack() DOES touch rows
     in place every tick (toggling disabled/reason only, never the
     <details> element itself) so an open bar's Apply buttons stay
     accurate as Forges free up or a gated resource is produced
     elsewhere, without ever closing out from under the player. */
  function recipeSignature(r) {
    const names = r.inputs.map((res) => ORE_KINDS[res].name).join(' + ');
    return `${names}<span class="sm-recipe-arrow">&rarr;</span>${OUTPUT_KINDS[r.output].name}`;
  }
  function recipeRow(r, ri) {
    const reason = recipeDisabledReason(r);
    return `<div class="sp-panel-row sm-recipe-row${reason ? ' sm-recipe-disabled' : ''}" data-sm-recipe-row="${ri}">
      <span class="sm-recipe-sig">${recipeSignature(r)}<span class="sm-recipe-reason" data-sm-recipe-reason="${ri}">${reason || ''}</span></span>
      <button class="action-btn hs-btn-right" data-sm-recipe-apply="${ri}" ${reason ? 'disabled' : ''}>Apply</button>
    </div>`;
  }
  function recipesBar() {
    return `<details class="sp-add sm-recipes">
      <summary class="sp-strip sm-recipes-strip">RECIPES</summary>
      <div class="hs-body">${RECIPES.map(recipeRow).join('')}</div>
    </details>`;
  }

  /* ---- Card face ---- */
  function activeForgeCount() { return forges.filter((f) => f.phase !== 'stopped').length; }
  // Bottom bar: Outputting (lowest molten, bright), else Filling (highest
  // molten, faded), else Heating (wood toward BURN_AT, faded), else empty.
  function faceBar() {
    const of = (ph) => forges.filter((f) => f.phase === ph);
    const out = of('outputting'), fill = of('filling'), heating = of('heating');
    if (out.length) return { pct: Math.min(...out.map((f) => f.molten)), faded: false };
    if (fill.length) return { pct: Math.max(...fill.map((f) => f.molten)), faded: true };
    if (heating.length) return { pct: Math.min(100, Math.max(...heating.map((f) => f.woodBank / BURN_AT * 100))), faded: true };
    return { pct: 0, faded: false };
  }

  /* ---- Modal (Phase D) ----
     Forge grid: two hs-cards per row (.sm-grid/.sm-forge), an Add Forge
     prompt tacked on the end (same disappear-at-cap convention as Gold
     Panning's add-station card). Every sub-slot row shares one key
     scheme — "forgeIdx:slot" or "forgeIdx:slot:oreIdx" — used by both
     the stepper buttons here and patchLiveTrack's live-update queries.
     A row's own kind <select> (Gold Dust/Nuggets already chosen, or
     Wood) shows a single option and stays effectively inert — Phase C
     has no "swap an existing row's kind" function, only add/remove, so
     switching kind means removing the row and picking again via the
     "+ Add resource…" prompt. */
  function rowKey(idx, slot, oreIdx) { return oreIdx != null ? `${idx}:${slot}:${oreIdx}` : `${idx}:${slot}`; }
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  // Inverse of rowKey — splits a data-sm-minus/-plus/-val/-rate key back
  // into the (forgeIdx, slot, oreIdx) args subAssign/subUnassign expect.
  function parseKey(key) {
    const [idx, slot, oreIdx] = key.split(':');
    return { idx: +idx, slot, oreIdx: oreIdx != null ? +oreIdx : undefined };
  }
  const fmt = (v) => window.OrbWeaver.Upgrades.formatRate(v);
  // Molten pool status. Outputting reads Pouring, or Holding while the Anvil can't pour (no workers or no gold).
  function status(f) {
    const ph = f.phase === 'outputting' && (f.output.workers <= 0 || goldStarved) ? 'holding' : f.phase;
    return { text: { stopped: 'Stopped', heating: 'Heating', filling: 'Filling', outputting: 'Pouring', holding: 'Holding' }[ph], cls: `sm-status-${ph}` };
  }
  // Hearth heat label: the band while burning, blank otherwise.
  function heatTag(f) {
    const on = f.phase === 'filling' || f.phase === 'outputting', h = heat(f);
    return { text: on ? h.label : '', cls: `sm-heat${on ? ` sm-heat-${h.cls}` : ''}` };
  }

  function oreRateText(f, o) {
    if (f.oreWorkers <= 0) return '';
    if (goldStarved) return 'Stopped';
    const kind = ORE_KINDS[o.res];
    return `${fmt(oreShare(f) * kind.m)} ${kind.name.toLowerCase()} /s`;
  }
  function woodBankText(f) { return `${Math.round(f.woodBank)}/${WOOD_CAP}`; }
  function woodRateText(f) {
    if (f.phase !== 'filling' && f.phase !== 'outputting') return '';
    if (goldStarved && f.woodWorkers > 0) return 'Stopped';
    return `${fmt(workUnits(f.woodWorkers) * WOOD_M)}/s`; // gross production only — burn shown nowhere in this row
  }
  function outputRateText(f) {
    if (!f.output.res || f.output.workers <= 0 || f.phase !== 'outputting') return '';
    if (goldStarved) return 'Stopped';
    const kind = OUTPUT_KINDS[f.output.res];
    const displayRate = workUnits(f.output.workers) * heat(f).mult * (kind.multiplier || 1);
    return `${fmt(displayRate)} ${kind.name.toLowerCase()} /s`;
  }

  function stepperRow(key, workers, extra) {
    return `<div class="card-steppers visible">
      <button class="card-stepper-btn" data-sm-minus="${key}" ${workers <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-sm-val="${key}">${workers}</span>
      <button class="card-stepper-btn" data-sm-plus="${key}">+</button>
    </div>${extra || ''}`;
  }

  function oreRow(f, idx, o, oi, locked) {
    const key = rowKey(idx, 'ore', oi), kind = ORE_KINDS[o.res];
    return `<div class="sm-ore-row">
      <div class="sm-row-controls">
        <select class="sp-select" ${locked ? 'disabled' : ''}><option value="${o.res}">${kind.name}</option></select>
        <button class="sp-remove-btn" data-sm-ore-remove="${idx}:${oi}" ${locked ? 'disabled' : ''}>×</button>
      </div>
      <div class="sm-rate-line" data-sm-rate="${key}">${oreRateText(f, o)}</div>
    </div>`;
  }
  function addResourceSelect(idx, existingOre) {
    const used = existingOre.map((o) => o.res);
    const opts = Object.keys(ORE_KINDS)
      .filter((k) => !used.includes(k))
      .filter((k) => !ORE_KINDS[k].gate || ORE_KINDS[k].gate())
      .map((k) => `<option value="${k}">${ORE_KINDS[k].name}</option>`).join('');
    return `<select class="sp-select sm-add-resource" data-sm-add-resource="${idx}"><option value="">+ Add resource…</option>${opts}</select>`;
  }
  function moltenRow(f, idx) {
    const pct = Math.round(f.molten), stopped = f.phase === 'stopped';
    return `<div class="sm-molten-row">
      <div class="sm-status-line">
        <span class="sm-status-label ${status(f).cls}" data-sm-status="${idx}">${status(f).text}</span>
        <span class="sm-molten-pct" data-sm-molten-pct="${idx}">${pct}%</span>
      </div>
      <div class="detail-progress-wrap"><div class="detail-progress-bar sm-molten-bar${stopped ? ' sm-bar-stopped' : ''}" data-sm-molten-bar="${idx}" style="width:${pct}%"></div></div>
    </div>`;
  }
  function woodBank(f, idx) {
    const h = heatTag(f);
    return `<span class="sm-sec-right sm-hearth-right"><span class="${h.cls}" data-sm-heat="${idx}">${h.text}</span><span class="${f.phase !== 'stopped' ? 'sm-wood-active' : ''}" data-sm-wood-bank="${idx}">${woodBankText(f)}</span></span>`;
  }
  function woodRow(f, idx) {
    return `<div class="sm-wood-row">
      <div class="sm-row-controls"><select class="sp-select" disabled><option>Wood</option></select></div>
      <div class="sm-wood-line"><span data-sm-wood-rate="${idx}">${woodRateText(f)}</span></div>
    </div>`;
  }
  // Every OUTPUT_KINDS entry is always offered here, unconditionally —
  // same rule the original two (Gold Bars/Gold Coins) already used,
  // now just a loop instead of two hardcoded <option>s so a future
  // output kind needs no markup change.
  function outputOptions(f) {
    return Object.keys(OUTPUT_KINDS)
      .map((k) => `<option value="${k}" ${f.output.res === k ? 'selected' : ''}>${OUTPUT_KINDS[k].name}</option>`)
      .join('');
  }
  function outputRow(f, idx, locked) {
    const key = rowKey(idx, 'output');
    return `<div class="sm-output-row">
      <div class="sm-row-controls">
        <select class="sp-select" data-sm-output-select="${idx}" ${locked ? 'disabled' : ''}>
          <option value="" ${!f.output.res ? 'selected' : ''} disabled>— Choose output —</option>
          ${outputOptions(f)}
        </select>
      </div>
      <div class="sm-rate-line" data-sm-rate="${key}">${outputRateText(f)}</div>
    </div>`;
  }
  function smeltButton(f, idx) {
    const stopped = f.phase === 'stopped';
    return `<button class="action-btn sm-smelt-btn" data-sm-smelt="${idx}" ${stopped && !canSmelt(f) ? 'disabled' : ''}>${stopped ? 'Smelt' : 'Cancel'}</button>`;
  }
  // Right-aligned in the Forge's own header row (hs-head is already
  // justify-content:space-between, same trick Add Forge's cost readout
  // and Tool Shed's tier pill use). Enabled only while stopped, same
  // lock every other selection control in this card already uses.
  function clearButton(f, idx) {
    return `<button class="action-btn sm-clear-btn" data-sm-clear="${idx}" ${isLocked(f) ? 'disabled' : ''}>Clear</button>`;
  }
  // A titled Forge section: optional header stepper, then the title.
  function section(cls, title, stepper, body, right) {
    return `<div class="sm-box ${cls}"><div class="sm-sec-head">${stepper || ''}<span class="sm-sec-title">${title}</span>${right || ''}</div>${body}</div>`;
  }
  function forgeCard(f, idx) {
    const locked = isLocked(f);
    const addRes = (!locked && f.ore.length < ORE_CAP) ? addResourceSelect(idx, f.ore) : '';
    return `<div class="hs-card sm-forge" data-sm-forge="${idx}">
      <div class="hs-head"><span class="hs-title">Forge ${idx + 1}</span><span class="sm-note" data-sm-note="${idx}">${f.note || ''}</span>${clearButton(f, idx)}</div>
      <div class="hs-body">
        ${section('sm-box-ore', 'Input', stepperRow(rowKey(idx, 'ore'), f.oreWorkers), addRes + f.ore.map((o, oi) => oreRow(f, idx, o, oi, locked)).join(''))}
        ${section('sm-box-fuel', 'Molten pool', '', moltenRow(f, idx))}
        ${section('sm-box-hearth', 'Hearth', stepperRow(rowKey(idx, 'wood'), f.woodWorkers), woodRow(f, idx), woodBank(f, idx))}
        ${section('sm-box-output', 'Anvil', stepperRow(rowKey(idx, 'output'), f.output.workers), outputRow(f, idx, locked))}
        ${smeltButton(f, idx)}
      </div>
    </div>`;
  }
  function addForgeCard() {
    if (atCap()) return '';
    // Floored, not rounded — Gold Bars is a whole-number resource (see
    // RES_BAR above), so this can never read e.g. "2000/2000" one tick
    // before the sidebar (which floors) agrees, with the button still
    // disabled underneath a readout that looks fully paid.
    const have = Math.floor(window.OrbWeaver.Resources.exists(GOLDBARS_ID) ? window.OrbWeaver.Resources.get(GOLDBARS_ID) : 0);
    const affordable = canAdd();
    return `<div class="hs-card sm-forge" data-sm-add>
      <div class="hs-head">
        <span class="hs-title">Add Forge</span>
        <span class="upgrade-costtime" data-sm-addcost>${have}/${ADD_COST} Gold Bars</span>
      </div>
      <div class="hs-body">
        <div class="hs-desc-build-row">
          <span class="upgrade-desc">Build another Forge.</span>
          <button class="action-btn hs-btn-right" data-sm-add-btn ${affordable ? '' : 'disabled'}>${ADD_COST} Gold bars</button>
        </div>
      </div>
    </div>`;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    modalWide: true,                // two Forges per row needs the same widened modal Scout Stable uses
    workerPool: null,               // set to Mountains' pool in main.js after Mountains loads
    cardName: () => 'Smelter Shack',
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots, subAdd,
    cardThemeClass: 'sm-forge-card', // amber card-face bottom bar (see .card-wrap.sm-forge-card in style.css)
    getStatText() {
      if (pool().getAssigned(ID) === 0) return '';
      if (goldStarved) return 'Stopped';
      const n = activeForgeCount();
      return n > 0 ? `Smelting – ${n} forge${n > 1 ? 's' : ''}` : 'Stopped';
    },
    getUpgradeBarPct: () => 0,
    getBuildBarPct: () => faceBar().pct,
    isBuildBarFaded: () => faceBar().faded,
    // Dummy keys matching no real data-track attribute — every Forge's
    // own molten bar is untracked and hand-patched per-idx above, so the
    // shared per-frame bar-smoothing loop (cards.js startSmoothing) must
    // never grab one via its ":not([data-track])" single-bar fallback.
    // Same escape hatch Mountains uses for its own hand-patched bars
    // (see mountains.js's upgradeTrackKey: 'travelpaths').
    upgradeTrackKey: 'sm-none',
    buildTrackKey: 'sm-none',
    getBillableCount: () => billableWorkers(),
    renderModalHTML: () => `<div class="bench-modal">${resBar()}${recipesBar()}<div class="sm-grid">${forges.map(forgeCard).join('')}${addForgeCard()}</div></div>`,
    // Re-wire hold-to-repeat onto every sub-slot stepper after each
    // render — same pattern as Gold Panning/Mountains. One pair each
    // for Input (shared by every ore row), Wood and Anvil.
    afterRender() {
      const body = document.getElementById('card-modal-body');
      if (!body) return;
      body.querySelectorAll('[data-sm-minus]').forEach((btn) => {
        const { idx, slot, oreIdx } = parseKey(btn.dataset.smMinus);
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => subUnassign(idx, slot, oreIdx));
      });
      body.querySelectorAll('[data-sm-plus]').forEach((btn) => {
        const { idx, slot, oreIdx } = parseKey(btn.dataset.smPlus);
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => subAssign(idx, slot, oreIdx));
      });
    },
    // Patch live values in place every tick (never rebuild — that would
    // orphan a held stepper's repeat timer). Structural changes (ore
    // row added/removed, output chosen, Smelt<->Cancel, grid growing)
    // already call refreshOpenModal() themselves from Phase C.
    patchLiveTrack() {
      // Copper Ingots can appear mid-game (first production). If the
      // visible row set changed since last render, that's a structural
      // change — same trigger Tool Shed's own resource strip uses. The
      // one guard this needs that Tool Shed's doesn't: never rebuild
      // while the Recipes bar is open, since that would slam it shut
      // mid-read (nothing else in this file can trigger a passive,
      // tick-driven rebuild — every other structural change already
      // comes from a user action that closes the bar on its own). Skip
      // this tick's rebuild and simply try again next tick once closed.
      const liveResKeys = resBarVisible().map((r) => r.key).join(',');
      if (liveResKeys !== resBarKeysAtRender && !q('details.sm-recipes[open]')) {
        window.OrbWeaver.Cards.refreshOpenModal(ID);
        return;
      }
      // Patch whatever rows are actually in the DOM right now (q()
      // no-ops on a row that doesn't exist yet) — runs even when a
      // rebuild is pending-but-deferred by the guard above, so the
      // rows already showing stay live instead of freezing until the
      // bar closes.
      RES_BAR.forEach((r) => {
        const amtEl = q(`[data-sm-res-amt="${r.key}"]`); if (amtEl) amtEl.textContent = resBarAmt(r);
      });
      // Recipe rows: attribute/text patches only, never a rebuild — an
      // open <details> stays open while its rows' eligibility catches up
      // to the current game state (a Forge freeing up, a gated resource
      // being produced elsewhere).
      RECIPES.forEach((r, ri) => {
        const reason = recipeDisabledReason(r);
        const rowEl = q(`[data-sm-recipe-row="${ri}"]`); if (rowEl) rowEl.classList.toggle('sm-recipe-disabled', !!reason);
        const reasonEl = q(`[data-sm-recipe-reason="${ri}"]`); if (reasonEl) reasonEl.textContent = reason || '';
        const applyBtn = q(`[data-sm-recipe-apply="${ri}"]`); if (applyBtn) applyBtn.disabled = !!reason;
      });
      function patchStepper(key, workers, rateStr) {
        const val = q(`[data-sm-val="${key}"]`); if (val) val.textContent = workers;
        const minus = q(`[data-sm-minus="${key}"]`); if (minus) minus.disabled = workers <= 0;
        const rt = q(`[data-sm-rate="${key}"]`); if (rt && rateStr != null) rt.textContent = rateStr;
      }
      forges.forEach((f, idx) => {
        patchStepper(rowKey(idx, 'ore'), f.oreWorkers);
        f.ore.forEach((o, oi) => { const rt = q(`[data-sm-rate="${rowKey(idx, 'ore', oi)}"]`); if (rt) rt.textContent = oreRateText(f, o); });
        patchStepper(rowKey(idx, 'wood'), f.woodWorkers); // val/minus only — bank+rate patched separately below
        patchStepper(rowKey(idx, 'output'), f.output.workers, outputRateText(f));
        const bankEl = q(`[data-sm-wood-bank="${idx}"]`);
        if (bankEl) { bankEl.textContent = woodBankText(f); bankEl.classList.toggle('sm-wood-active', f.phase !== 'stopped'); }
        const heatEl = q(`[data-sm-heat="${idx}"]`); if (heatEl) { const h = heatTag(f); heatEl.textContent = h.text; heatEl.className = h.cls; }
        const wRateEl = q(`[data-sm-wood-rate="${idx}"]`); if (wRateEl) wRateEl.textContent = woodRateText(f);

        const pct = Math.round(f.molten);
        const pctEl = q(`[data-sm-molten-pct="${idx}"]`); if (pctEl) pctEl.textContent = pct + '%';
        const bar = q(`[data-sm-molten-bar="${idx}"]`);
        if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('sm-bar-stopped', f.phase === 'stopped'); }
        const statusEl = q(`[data-sm-status="${idx}"]`);
        if (statusEl) { const st = status(f); statusEl.textContent = st.text; statusEl.className = `sm-status-label ${st.cls}`; }

        const btn = q(`[data-sm-smelt="${idx}"]`);
        if (btn) { const stopped = f.phase === 'stopped'; btn.textContent = stopped ? 'Smelt' : 'Cancel'; btn.disabled = stopped && !canSmelt(f); }
        const clearBtn = q(`[data-sm-clear="${idx}"]`); if (clearBtn) clearBtn.disabled = isLocked(f);
        const noteEl = q(`[data-sm-note="${idx}"]`); if (noteEl) noteEl.textContent = f.note || '';
      });
      const addCost = q('[data-sm-addcost]');
      if (addCost) addCost.textContent = `${Math.floor(window.OrbWeaver.Resources.exists(GOLDBARS_ID) ? window.OrbWeaver.Resources.get(GOLDBARS_ID) : 0)}/${ADD_COST} Gold Bars`;
      const addBtn = q('[data-sm-add-btn]');
      if (addBtn) addBtn.disabled = !canAdd();
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      forges.forEach((f) => tickForge(f, tickRate, goldAvailable));
      window.OrbWeaver.Cards.refresh(mechanic);
    },
    _debug: {
      seed, forges: () => forges, subAssign, subUnassign, addOre, removeOre, setOutput, smelt, cancel, addForge, canAdd, atCap, canSmelt, freeCardWorkers,
      RECIPES, applyRecipe, recipeDisabledReason, emptyForgeIndex, clearForge
    }
  };

  // Selects and one-shot buttons — delegated, since every element here
  // is rebuilt by refreshOpenModal() on the structural change it causes
  // (new/removed ore row, output chosen, Smelt<->Cancel, grid growing),
  // so there's nothing per-render to re-wire (unlike the steppers above).
  document.addEventListener('change', (e) => {
    const addSel = e.target.closest('[data-sm-add-resource]');
    if (addSel && addSel.value) addOre(+addSel.dataset.smAddResource, addSel.value);
    const outSel = e.target.closest('[data-sm-output-select]');
    if (outSel && outSel.value) setOutput(+outSel.dataset.smOutputSelect, outSel.value);
  });
  // Any touch inside a Forge clears its stop note (capture: runs before a rebuild detaches the target).
  ['pointerdown', 'change'].forEach((type) => document.addEventListener(type, (e) => {
    const el = e.target.closest && e.target.closest('[data-sm-forge]');
    const f = el && forges[+el.dataset.smForge];
    if (f && f.note) { f.note = ''; const n = el.querySelector('[data-sm-note]'); if (n) n.textContent = ''; }
  }, true));
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-sm-ore-remove]');
    if (rm) { const [idx, oreIdx] = rm.dataset.smOreRemove.split(':').map(Number); removeOre(idx, oreIdx); }
    const smeltBtn = e.target.closest('[data-sm-smelt]');
    if (smeltBtn) { const idx = +smeltBtn.dataset.smSmelt; const f = forges[idx]; if (f) (f.phase === 'stopped' ? smelt : cancel)(idx); }
    if (e.target.closest('[data-sm-add-btn]')) addForge();
    const recipeBtn = e.target.closest('[data-sm-recipe-apply]');
    if (recipeBtn) applyRecipe(+recipeBtn.dataset.smRecipeApply);
    const clearBtn = e.target.closest('[data-sm-clear]');
    if (clearBtn) clearForge(+clearBtn.dataset.smClear);
  });

  /* ---- Save/load ---- Seed only: phase, ore pairs, wood/molten
     numbers, output choice per Forge. Forge index IS its id (not
     stored, matching Gold Panning's derived-station-id convention).
     Gold Bars' resource id is never saved — it's deterministic and
     Resources' own save participant already recreates the row itself
     if it was ever revealed (see ensureGoldBarsRevealed() above).
     Everything else (caps, rates, kinds) replays from the constants
     above, so rebalancing reaches existing saves on next load. */
  window.OrbWeaver.Save.register(ID,
    () => ({
      fg: forges.map((f) => ({
        ph: f.phase,
        or: f.ore.map((o) => o.res), iw: f.oreWorkers,
        ww: f.woodWorkers, wb: f.woodBank,
        ml: f.molten,
        ou: f.output.res, ow: f.output.workers
      }))
    }),
    (d) => {
      if (!d || !d.fg || !d.fg.length) { if (!forges.length) seed(); return; }
      forges = d.fg.map((fv) => ({
        phase: fv.ph || 'stopped',
        ore: (fv.or || []).map((r) => ({ res: [].concat(r)[0] })), oreWorkers: fv.iw || 0, // [].concat: older [res, workers] pairs
        woodWorkers: fv.ww || 0, woodBank: fv.wb || 0,
        molten: fv.ml || 0,
        output: { res: fv.ou || null, workers: fv.ow || 0 }
      }));
    });
  window.OrbWeaver.Mechanics.register(mechanic);

  // Seed the starting Forges at load (a fresh game); a save load
  // replaces them in Step 11.
  seed();
})();
