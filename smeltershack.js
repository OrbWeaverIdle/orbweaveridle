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

  // Ore kinds: m = raw units consumed per worker/s (also the divisor —
  // 1 Molten point per `m` units actually spent, so every ore kind
  // feeds Molten at the same 1/worker/s pace, just at different raw costs).
  const ORE_KINDS = {
    golddust: { name: 'Gold Dust', m: 20 },
    nugget:   { name: 'Nuggets',   m: 5 }
  };
  // Output kinds: m = Molten consumed per worker/s (also the divisor —
  // 1 unit of output per `m` Molten actually consumed).
  const OUTPUT_KINDS = {
    goldbars:  { name: 'Gold Bars',  m: 6 },
    goldcoins: { name: 'Gold Coins', m: 4 }
  };
  const WOOD_M = 1; // wood banked per worker/s (baseline mpf dial)

  const GOLDBARS_ID = 'mtn_goldbars'; // deterministic (Mountains' prefix + 'goldbars') — no
                                       // need to save this pointer, see wheatfieldcard.js's
                                       // identical RES pattern for mtn_wheatbundle
  function ensureGoldBarsRevealed() {
    if (!window.OrbWeaver.Resources.exists(GOLDBARS_ID)) window.OrbWeaver.Mountains.ensureResource('goldbars', 'Gold Bars');
  }
  let goldStarved = false;

  let forges = [];
  function pool() { return window.OrbWeaver.Mountains.workerPool; }
  const rate = (n, m) => window.OrbWeaver.Upgrades.workerRate(n, m, 1, 0);

  function makeForge() {
    return { phase: 'stopped', ore: [], woodWorkers: 0, woodBank: 0, molten: 0, output: { res: null, workers: 0 } };
  }
  function seed() { forges = [makeForge(), makeForge()]; }

  /* ---- Worker sub-slots (same rules as Gold Panning/Mountains) ----
     Every worker physically placed in any row on any Forge counts
     toward usedWorkers(), regardless of that Forge's phase — a worker
     parked on a Stopped Forge is still "there", just unbilled. */
  function rowWorkers(f) { return f.woodWorkers + f.output.workers + f.ore.reduce((s, o) => s + o.workers, 0); }
  function usedWorkers() { return forges.reduce((sum, f) => sum + rowWorkers(f), 0); }
  function billableWorkers() { return forges.reduce((sum, f) => f.phase === 'stopped' ? sum : sum + rowWorkers(f), 0); }
  function freeCardWorkers() { return pool().getAssigned(ID) - usedWorkers(); }

  // slot: 'wood' | 'output' | 'ore'. oreIdx only used for 'ore'.
  function subAssign(forgeIdx, slot, oreIdx) {
    const f = forges[forgeIdx];
    if (!f) return;
    if (slot === 'output' && !f.output.res) return; // nothing to staff until an output is chosen
    if (freeCardWorkers() <= 0) { if (!pool().assign(ID)) return; }
    if (slot === 'wood') f.woodWorkers++;
    else if (slot === 'output') f.output.workers++;
    else if (slot === 'ore' && f.ore[oreIdx]) f.ore[oreIdx].workers++;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  function subUnassign(forgeIdx, slot, oreIdx) {
    const f = forges[forgeIdx];
    if (!f) return;
    if (slot === 'wood') { if (f.woodWorkers <= 0) return; f.woodWorkers--; }
    else if (slot === 'output') { if (f.output.workers <= 0) return; f.output.workers--; }
    else if (slot === 'ore') { if (!f.ore[oreIdx] || f.ore[oreIdx].workers <= 0) return; f.ore[oreIdx].workers--; }
    else return;
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  // Card-face stepper shrinking below sum-of-rows: clamp greedily,
  // Forge order then ore/wood/output within each (earlier keeps priority).
  pool().onChange(() => {
    let budget = pool().getAssigned(ID);
    forges.forEach((f) => {
      f.ore.forEach((o) => { const keep = Math.min(o.workers, budget); o.workers = keep; budget -= keep; });
      const wKeep = Math.min(f.woodWorkers, budget); f.woodWorkers = wKeep; budget -= wKeep;
      const oKeep = Math.min(f.output.workers, budget); f.output.workers = oKeep; budget -= oKeep;
    });
  });

  /* ---- Resource selection (locked while a Forge is active) ---- */
  function isLocked(f) { return f.phase !== 'stopped'; }
  function addOre(forgeIdx, res) {
    const f = forges[forgeIdx];
    if (!f || isLocked(f) || f.ore.length >= ORE_CAP || !ORE_KINDS[res]) return;
    if (f.ore.some((o) => o.res === res)) return;
    f.ore.push({ res, workers: 0 });
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
  function stopForge(f) { f.phase = 'stopped'; f.woodBank = 0; f.molten = 0; }

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
      if (goldAvailable) f.woodBank = Math.min(WOOD_CAP, f.woodBank + window.OrbWeaver.Resources.spend(MTN_WOOD, rate(f.woodWorkers, WOOD_M) * tickRate));
      if (f.woodBank >= WOOD_CAP) f.phase = 'filling';
      return;
    }

    // filling or outputting: the flat burn is physical, not worker-driven
    // — it keeps consuming stored wood even while gold-starved, a pure
    // cost to the player, never a benefit, so it's fine to let it run
    // unpaid. Worker-driven wood gain draws from mtn_wood (same as ore
    // rows draw from HiddenRes) and pauses on gold starvation. Other
    // worker-driven rates (ore->molten, molten->output) likewise pause.
    const woodGain = goldAvailable ? window.OrbWeaver.Resources.spend(MTN_WOOD, rate(f.woodWorkers, WOOD_M) * tickRate) : 0;
    f.woodBank = Math.min(WOOD_CAP, Math.max(0, f.woodBank + woodGain - WOOD_BURN * tickRate));
    if (f.woodBank <= 0) { stopForge(f); return; }
    if (!goldAvailable) return;

    f.ore.forEach((o) => {
      const kind = ORE_KINDS[o.res];
      const want = rate(o.workers, kind.m) * tickRate;
      const spent = window.OrbWeaver.HiddenRes.spend(o.res, want);
      f.molten = Math.min(MOLTEN_CAP, f.molten + spent / kind.m);
    });

    if (f.phase === 'filling' && f.molten >= MOLTEN_CAP) f.phase = 'outputting';

    if (f.phase === 'outputting' && f.output.res) {
      const kind = OUTPUT_KINDS[f.output.res];
      const want = rate(f.output.workers, kind.m) * tickRate;
      const consumed = Math.min(f.molten, want);
      f.molten -= consumed;
      const gained = consumed / kind.m;
      if (gained > 0) {
        if (f.output.res === 'goldbars') {
          ensureGoldBarsRevealed();
          window.OrbWeaver.Resources.add(GOLDBARS_ID, gained);
        } else {
          window.OrbWeaver.Resources.add('gold', gained);
        }
      }
      if (f.molten <= 0) stopForge(f);
    }
  }

  /* ---- Resource tracker strip (Phase E) ---- Gold Dust and Nuggets
     stock only, live every tick via patchLiveTrack(). The per-second
     rate deliberately lives ONLY on each Forge's own ore row (see
     oreRateText below) — showing it up here too would just be the
     same number twice, so this strip is amount-only. RES_BAR is
     shared by resBar()'s initial render and the live patch so there's
     one source of truth for which rows exist. Both stats share a
     single box (no divider) per spacing. */
  const RES_BAR = [
    { key: 'golddust', label: 'Gold Dust', amt: () => window.OrbWeaver.HiddenRes.get('golddust') },
    { key: 'nugget',   label: 'Nuggets',   amt: () => window.OrbWeaver.HiddenRes.get('nugget') }
  ];
  function resBar() {
    return `<div class="sm-resbar"><div class="sm-resbar-item">${RES_BAR.map((r) => `<div class="sm-resbar-stat">
      <span class="sm-resbar-label">${r.label}</span>
      <span class="sm-resbar-amt" data-sm-res-amt="${r.key}">${Math.round(r.amt())}</span>
    </div>`).join('')}</div></div>`;
  }

  /* ---- Card face ---- */
  function activeForgeCount() { return forges.filter((f) => f.phase !== 'stopped').length; }
  function lowestOutputtingPct() {
    const outputting = forges.filter((f) => f.phase === 'outputting');
    if (!outputting.length) return 0;
    return Math.min(...outputting.map((f) => f.molten));
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
  function statusLabel(f) { return { stopped: 'Stopped', heating: 'Heating', filling: 'Filling', outputting: 'Outputting' }[f.phase]; }

  function oreRateText(o) {
    if (o.workers <= 0) return '';
    if (goldStarved) return 'Stopped';
    const kind = ORE_KINDS[o.res];
    return `${fmt(rate(o.workers, kind.m))} ${kind.name.toLowerCase()} /s`;
  }
  function woodBankText(f) { return `${Math.round(f.woodBank)}/${WOOD_CAP}`; }
  function woodRateText(f) {
    if (f.phase !== 'filling' && f.phase !== 'outputting') return '';
    if (goldStarved && f.woodWorkers > 0) return 'Stopped';
    return `${fmt(rate(f.woodWorkers, WOOD_M))}/s`; // gross production only — burn shown nowhere in this row
  }
  function outputRateText(f) {
    if (!f.output.res || f.output.workers <= 0 || f.phase !== 'outputting') return '';
    if (goldStarved) return 'Stopped';
    const kind = OUTPUT_KINDS[f.output.res];
    return `${fmt(rate(f.output.workers, kind.m))} ${kind.name.toLowerCase()} /s`;
  }

  function stepperRow(key, workers, extra) {
    return `<div class="card-steppers visible">
      <button class="card-stepper-btn" data-sm-minus="${key}" ${workers <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-sm-val="${key}">${workers}</span>
      <button class="card-stepper-btn" data-sm-plus="${key}">+</button>
    </div>${extra || ''}`;
  }

  function oreRow(idx, o, oi, locked) {
    const key = rowKey(idx, 'ore', oi), kind = ORE_KINDS[o.res];
    return `<div class="sm-ore-row">
      <div class="sm-row-controls">
        ${stepperRow(key, o.workers)}
        <select class="sp-select" ${locked ? 'disabled' : ''}><option value="${o.res}">${kind.name}</option></select>
        <button class="sp-remove-btn" data-sm-ore-remove="${idx}:${oi}" ${locked ? 'disabled' : ''}>×</button>
      </div>
      <div class="sm-rate-line" data-sm-rate="${key}">${oreRateText(o)}</div>
    </div>`;
  }
  function addResourceSelect(idx, existingOre) {
    const used = existingOre.map((o) => o.res);
    const opts = Object.keys(ORE_KINDS).filter((k) => !used.includes(k))
      .map((k) => `<option value="${k}">${ORE_KINDS[k].name}</option>`).join('');
    return `<select class="sp-select sm-add-resource" data-sm-add-resource="${idx}"><option value="">+ Add resource…</option>${opts}</select>`;
  }
  function moltenRow(f, idx) {
    const pct = Math.round(f.molten), stopped = f.phase === 'stopped';
    return `<div class="sm-molten-row">
      <div class="sm-status-line">
        <span class="sm-status-label sm-status-${f.phase}" data-sm-status="${idx}">${statusLabel(f)}</span>
        <span class="sm-molten-pct" data-sm-molten-pct="${idx}">${pct}%</span>
      </div>
      <div class="detail-progress-wrap"><div class="detail-progress-bar sm-molten-bar${stopped ? ' sm-bar-stopped' : ''}" data-sm-molten-bar="${idx}" style="width:${pct}%"></div></div>
    </div>`;
  }
  function woodRow(f, idx, locked) {
    const key = rowKey(idx, 'wood'), active = f.phase !== 'stopped';
    return `<div class="sm-wood-row">
      <div class="sm-row-controls">
        ${stepperRow(key, f.woodWorkers)}
        <select class="sp-select" disabled><option>Wood</option></select>
      </div>
      <div class="sm-wood-line">
        <span class="${active ? 'sm-wood-active' : ''}" data-sm-wood-bank="${idx}">${woodBankText(f)}</span>
        <span data-sm-wood-rate="${idx}">${woodRateText(f)}</span>
      </div>
    </div>`;
  }
  function outputRow(f, idx, locked) {
    const key = rowKey(idx, 'output');
    return `<div class="sm-output-row">
      <div class="sm-row-controls">
        ${stepperRow(key, f.output.workers)}
        <select class="sp-select" data-sm-output-select="${idx}" ${locked ? 'disabled' : ''}>
          <option value="" ${!f.output.res ? 'selected' : ''} disabled>— Choose output —</option>
          <option value="goldbars" ${f.output.res === 'goldbars' ? 'selected' : ''}>Gold Bars</option>
          <option value="goldcoins" ${f.output.res === 'goldcoins' ? 'selected' : ''}>Gold Coins</option>
        </select>
      </div>
      <div class="sm-rate-line" data-sm-rate="${key}">${outputRateText(f)}</div>
    </div>`;
  }
  function smeltButton(f, idx) {
    const stopped = f.phase === 'stopped';
    return `<button class="action-btn sm-smelt-btn" data-sm-smelt="${idx}" ${stopped && !canSmelt(f) ? 'disabled' : ''}>${stopped ? 'Smelt' : 'Cancel'}</button>`;
  }
  function forgeCard(f, idx) {
    const locked = isLocked(f);
    const oreBox = f.ore.length ? `<div class="sm-box sm-box-ore">${f.ore.map((o, oi) => oreRow(idx, o, oi, locked)).join('')}</div>` : '';
    const addRes = (!locked && f.ore.length < ORE_CAP) ? addResourceSelect(idx, f.ore) : '';
    return `<div class="hs-card sm-forge" data-sm-forge="${idx}">
      <div class="hs-head"><span class="hs-title">Forge ${idx + 1}</span></div>
      <div class="hs-body">
        ${oreBox}
        ${addRes}
        <div class="sm-box sm-box-fuel">${moltenRow(f, idx)}<div class="sm-divider"></div>${woodRow(f, idx, locked)}</div>
        <div class="sm-box sm-box-output">${outputRow(f, idx, locked)}</div>
        ${smeltButton(f, idx)}
      </div>
    </div>`;
  }
  function addForgeCard() {
    if (atCap()) return '';
    const have = Math.round(window.OrbWeaver.Resources.exists(GOLDBARS_ID) ? window.OrbWeaver.Resources.get(GOLDBARS_ID) : 0);
    const affordable = canAdd();
    return `<div class="hs-card sm-forge${affordable ? '' : ' hs-card-dim'}" data-sm-add>
      <div class="hs-head">
        <span class="hs-title">Add Forge</span>
        <span class="upgrade-costtime" data-sm-addcost>${have}/${ADD_COST} Gold Bars</span>
      </div>
      <div class="hs-body">
        <div class="hs-desc-build-row">
          <span class="upgrade-desc${affordable ? ' upgrade-desc-affordable' : ''}">Build another Forge.</span>
          <button class="action-btn hs-btn-right" data-sm-add-btn ${affordable ? '' : 'disabled'}>${ADD_COST} bars</button>
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
    cardThemeClass: 'sm-forge-card', // amber card-face bottom bar (see .card-wrap.sm-forge-card in style.css)
    getStatText() {
      if (pool().getAssigned(ID) === 0) return '';
      if (goldStarved) return 'Stopped';
      const n = activeForgeCount();
      return n > 0 ? `Smelting – ${n} forge${n > 1 ? 's' : ''}` : 'Stopped';
    },
    getUpgradeBarPct: () => 0,
    getBuildBarPct: () => lowestOutputtingPct(),
    // Dummy keys matching no real data-track attribute — every Forge's
    // own molten bar is untracked and hand-patched per-idx above, so the
    // shared per-frame bar-smoothing loop (cards.js startSmoothing) must
    // never grab one via its ":not([data-track])" single-bar fallback.
    // Same escape hatch Mountains uses for its own hand-patched bars
    // (see mountains.js's upgradeTrackKey: 'travelpaths').
    upgradeTrackKey: 'sm-none',
    buildTrackKey: 'sm-none',
    getBillableCount: () => billableWorkers(),
    renderModalHTML: () => `<div class="bench-modal">${resBar()}<div class="sm-grid">${forges.map(forgeCard).join('')}${addForgeCard()}</div></div>`,
    // Re-wire hold-to-repeat onto every sub-slot stepper after each
    // render — same pattern as Gold Panning/Mountains. One pair of
    // buttons per ore row, plus one each for Wood and Output.
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
      RES_BAR.forEach((r) => {
        const amtEl = q(`[data-sm-res-amt="${r.key}"]`); if (amtEl) amtEl.textContent = Math.round(r.amt());
      });
      const STATUS_CLASSES = ['sm-status-heating', 'sm-status-filling', 'sm-status-outputting', 'sm-status-stopped'];
      function patchStepper(key, workers, rateStr) {
        const val = q(`[data-sm-val="${key}"]`); if (val) val.textContent = workers;
        const minus = q(`[data-sm-minus="${key}"]`); if (minus) minus.disabled = workers <= 0;
        const rt = q(`[data-sm-rate="${key}"]`); if (rt) rt.textContent = rateStr;
      }
      forges.forEach((f, idx) => {
        f.ore.forEach((o, oi) => patchStepper(rowKey(idx, 'ore', oi), o.workers, oreRateText(o)));
        patchStepper(rowKey(idx, 'wood'), f.woodWorkers); // val/minus only — bank+rate patched separately below
        patchStepper(rowKey(idx, 'output'), f.output.workers, outputRateText(f));
        const bankEl = q(`[data-sm-wood-bank="${idx}"]`);
        if (bankEl) { bankEl.textContent = woodBankText(f); bankEl.classList.toggle('sm-wood-active', f.phase !== 'stopped'); }
        const wRateEl = q(`[data-sm-wood-rate="${idx}"]`); if (wRateEl) wRateEl.textContent = woodRateText(f);

        const pct = Math.round(f.molten);
        const pctEl = q(`[data-sm-molten-pct="${idx}"]`); if (pctEl) pctEl.textContent = pct + '%';
        const bar = q(`[data-sm-molten-bar="${idx}"]`);
        if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('sm-bar-stopped', f.phase === 'stopped'); }
        const statusEl = q(`[data-sm-status="${idx}"]`);
        if (statusEl) { statusEl.textContent = statusLabel(f); statusEl.classList.remove(...STATUS_CLASSES); statusEl.classList.add(`sm-status-${f.phase}`); }

        const btn = q(`[data-sm-smelt="${idx}"]`);
        if (btn) { const stopped = f.phase === 'stopped'; btn.textContent = stopped ? 'Smelt' : 'Cancel'; btn.disabled = stopped && !canSmelt(f); }
      });
      const addCost = q('[data-sm-addcost]');
      if (addCost) addCost.textContent = `${Math.round(window.OrbWeaver.Resources.exists(GOLDBARS_ID) ? window.OrbWeaver.Resources.get(GOLDBARS_ID) : 0)}/${ADD_COST} Gold Bars`;
      const addBtn = q('[data-sm-add-btn]');
      if (addBtn) {
        const aff = canAdd();
        addBtn.disabled = !aff;
        const card = q('[data-sm-add]'); if (card) card.classList.toggle('hs-card-dim', !aff);
        const desc = card && card.querySelector('.upgrade-desc'); if (desc) desc.classList.toggle('upgrade-desc-affordable', aff);
      }
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      forges.forEach((f) => tickForge(f, tickRate, goldAvailable));
      window.OrbWeaver.Cards.refresh(mechanic);
    },
    _debug: { seed, forges: () => forges, subAssign, subUnassign, addOre, removeOre, setOutput, smelt, cancel, addForge, canAdd, atCap, canSmelt, freeCardWorkers }
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
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-sm-ore-remove]');
    if (rm) { const [idx, oreIdx] = rm.dataset.smOreRemove.split(':').map(Number); removeOre(idx, oreIdx); }
    const smeltBtn = e.target.closest('[data-sm-smelt]');
    if (smeltBtn) { const idx = +smeltBtn.dataset.smSmelt; const f = forges[idx]; if (f) (f.phase === 'stopped' ? smelt : cancel)(idx); }
    if (e.target.closest('[data-sm-add-btn]')) addForge();
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
        or: f.ore.map((o) => [o.res, o.workers]),
        ww: f.woodWorkers, wb: f.woodBank,
        ml: f.molten,
        ou: f.output.res, ow: f.output.workers
      }))
    }),
    (d) => {
      if (!d || !d.fg || !d.fg.length) { if (!forges.length) seed(); return; }
      forges = d.fg.map((fv) => ({
        phase: fv.ph || 'stopped',
        ore: (fv.or || []).map(([res, workers]) => ({ res, workers: workers || 0 })),
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
