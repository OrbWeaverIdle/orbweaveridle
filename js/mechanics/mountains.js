/* ============================================================
   MECHANIC: MOUNTAINS (Section B, blue theme)
   Discovered once by Scout Stable's first Expedition Mule (see
   js/mechanics/scoutspen.js), which calls Mountains.reveal() and
   Mountains.addWorkers(n) directly. Mountains has its own resource
   pool (mtn_ prefix, never mixes with Camp's) and its own assignable
   worker pool (own idle/total, separate from Camp's) — riders who
   travel here join this pool, not Camp's.

   Once Outpost is built, the modal shows Prepare Stone Quarry (a
   standalone gradual-drain build) plus a branching TRAVEL PATH chain
   (see below) — each a pure worker timer that, on completion, removes
   itself and reveals whatever comes next: more travel paths, inert
   TBD stubs, or both. Sub-slot workers (quarry + every active path)
   are drawn from workers already assigned to the Mountains card,
   auto-promoting from the wider Mountain pool if the card has none
   free (never reaches into the global/Camp pool).

   Workers assigned here still drain Camp's shared Gold (see
   js/core/upkeep.js) — Gold is the one resource every location draws
   from together.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'mountains';
  const PREFIX = 'mtn_';
  const WOOD_ID = PREFIX + 'wood';
  const STONE_ID = PREFIX + 'stone';
  let discovered = false;
  let opened = false;
  let mtnMount = null;
  const pool = window.OrbWeaver.Workers.createPool(0, 'mountains');

  const OUTPOST_ITEMS = [
    { id: 'outpost', name: 'Outpost on the Frontier', desc: 'Build beneath the Mountain\'s Lower Range.', buildTime: 45, costRaw: `200 ${WOOD_ID}`, startAvailable: true }
  ];

  // Quarry build — gradual resource drain over 45s, stalls if resources run out
  const QUARRY_WOOD_COST = 500, QUARRY_STONE_COST = 100, QUARRY_BUILD_TIME = 45;
  let quarryPhase = 'idle'; // idle | building | done
  let quarryWoodDrained = 0, quarryStoneDrained = 0, quarryTimeRemaining = QUARRY_BUILD_TIME;
  let quarryStalled = false;
  let quarryWorkers = 0;
  // Worker contribution formula (see js/core/upgrades.js workerRate()).
  // Independent m/p/f sets — a future tool could speed up Quarry or the
  // Outpost stage without touching each other or the travel path chain.
  let stageM = 1, stageP = 1, stageF = 0;
  let quarryM = 1, quarryP = 1, quarryF = 0;

  /* ---- TRAVEL PATHS ----
     A branching chain of pure worker-driven timers (no cost), each
     rendered chromeless (hs_card_pattern.chromeless_structure) exactly
     like the original Hike the Lower Range. Adding a future path is
     one new table entry — no other code changes needed.
       title/desc/time/verb — display + the worker-rate verb (e.g.
         "Hiking 2.00/s").
       reveals — path ids to activate (in parallel) on completion.
       stubs   — inert TBD placeholder titles to reveal on completion
         (no timer, no functionality — content to be designed later).
       doneMsg — footer log line on completion.
       pinBottom — optional; keeps this path sorted below every other
         currently active path when rendering, even as siblings are
         added/removed around it (plain array order alone doesn't
         guarantee this once a path revealed earlier gets replaced by
         later children — see renderModalHTML()).
     Runtime state per active path lives in pathState, keyed by id. */
  const TRAVEL_PATHS = {
    hike: {
      title: 'Hike the Lower Range', desc: 'A winding river path into the Mountains.',
      time: 120, verb: 'Hiking', reveals: ['river', 'horses'], stubs: [],
      doneMsg: "You've hiked the Lower Range."
    },
    river: {
      title: 'River leads to a Mountainous valley', desc: 'Continue following the river into the valley.',
      time: 30, verb: 'Hiking', reveals: ['mountainbasin', 'wheatfield'], stubs: [],
      doneMsg: "You've followed the river into the valley."
    },
    horses: {
      title: 'Wild horses run through the open valley', desc: 'Track the horses up the valley hills.',
      time: 120, verb: 'Tracking', reveals: ['chasinghorse'], stubs: [],
      doneMsg: "You've tracked the wild horses through the valley.", pinBottom: true
    },
    // Unique among the travel paths: rendered with the dotted-trail
    // "Concept 3" look (trail: true) instead of the chromeless default,
    // and carries two optional mechanics no other path uses —
    //   bonus         — whenever workers are 0, progress is pinned at
    //                    (time - bonus), i.e. a permanent "60s remaining"
    //                    floor. This covers both the head-start on first
    //                    assignment and the reset-on-removal rule at
    //                    once: they're the same state.
    //   diceInterval/diceThreshold/diceAdd — every diceInterval real
    //                    seconds while staffed, roll 1-100; a roll above
    //                    diceThreshold adds diceAdd seconds to this
    //                    path's own required time (see pathTotalTime()).
    //                    Reset to 0 whenever workers hit 0, same as bonus.
    chasinghorse: {
      title: 'Chasing a wild horse',
      desc: (workers) => workers > 0 ? 'Remove workers to rest and reset.' : 'Work together to roundup the horse',
      time: 120, verb: 'Chasing', reveals: [], stubs: ['Horse Ranch'],
      doneMsg: "You've tamed a wild horse.", pinBottom: true, trail: true,
      bonus: 60, diceInterval: 5, diceThreshold: 30, diceAdd: 28
    },
    mountainbasin: {
      title: 'Calm river up the Mountain basin', desc: 'Follow the river out of the Valley into the Mountains.',
      time: 45, verb: 'Hiking', reveals: ['surroundedmountains'], stubs: [],
      doneMsg: "You've followed the river up into the Mountain basin."
    },
    surroundedmountains: {
      title: 'Surrounded by Mountains. The river widens and slows.',
      desc: 'A brief shine catches the eye.',
      time: 120, verb: 'Sleuthing', reveals: ['ruggedpath'], stubs: [],
      doneMsg: "You've found a calm stretch of river surrounded by mountains."
    },
    ruggedpath: {
      title: 'A rugged Mountain path', desc: 'Hike deep into the Mountains.',
      time: 600, verb: 'Hiking', reveals: [], stubs: ['Deep in the Mountain path'],
      doneMsg: "You've hiked deep into the rugged Mountain path."
    },
    wheatfield: {
      title: 'A small field of wheat in the lower valley.', desc: 'Hike down the valley to the fields below.',
      time: 20, verb: 'Hiking', reveals: [], stubs: [],
      doneMsg: "You've found a small field of wheat in the valley."
    }
  };
  let activePaths = ['hike'];   // path ids currently shown & in progress
  let pathState = {};           // id -> { phase, progress, workers, m, p, f }
  let pathStubs = [];           // inert TBD titles revealed so far
  function initPathState(id) { pathState[id] = { phase: 'idle', progress: 0, workers: 0, m: 1, p: 1, f: 0 }; }
  initPathState('hike');

  // A path's real required time, folding in any dice-added extra (see
  // TRAVEL_PATHS' diceInterval fields). Always equal to def.time for
  // every path that doesn't roll dice, since extra defaults to 0.
  function pathTotalTime(id) { return TRAVEL_PATHS[id].time + (pathState[id].extra || 0); }

  // Workers actually placed in a sub-slot (Quarry, Wheat Field, any
  // active travel path) right now — the subset of the card's assigned
  // workers that are doing something, vs. just sitting on the card.
  function usedSubSlotWorkers() {
    let used = quarryWorkers + wheatWorkers + goldPanWorkers;
    activePaths.forEach((id) => { used += pathState[id].workers; });
    return used;
  }

  // Free workers on the Mountains card available for sub-slot assignment
  function freeCardWorkers() {
    return pool.getAssigned(ID) - usedSubSlotWorkers();
  }

  // upkeep.js's getBillableCount() hook: gold should only drain for
  // workers actually doing something, not every worker parked on the
  // card. Pre-Outpost there are no sub-slots yet, so every assigned
  // worker directly powers the stage build and all of them bill.
  // Post-Outpost, only sub-slotted workers bill — any left unassigned
  // on the card face sit idle and free, matching every other mechanic.
  function getBillableCount() {
    return stageTrack.isBuilding() ? pool.getAssigned(ID) : usedSubSlotWorkers();
  }

  // Add a worker to a sub-slot (quarry, the Wheat Field build, or any
  // active travel path id). Promotes from category pool if the card has
  // none free. Only the underlying state changes here — Cards.refresh()
  // below patches the live modal (patchLiveTrack -> patchSubSlot)
  // without rebuilding it, exactly like the main card-level stepper. A
  // full rebuild (refreshOpenModal) is reserved for genuine structural
  // changes (see tick()), never for a routine worker-count change —
  // rebuilding out from under a held button is what orphaned its hold
  // timers before. activePaths.includes() guards against ever touching
  // a completed path's now-stale pathState entry (its own id is never
  // reused for anything else, but the check is cheap insurance).
  function subAssign(subSlot) {
    if (freeCardWorkers() <= 0) {
      if (!pool.assign(ID)) return; // category pool empty — do nothing
    }
    if (subSlot === 'quarry') quarryWorkers++;
    else if (subSlot === 'wheatfieldbuild') wheatWorkers++;
    else if (subSlot === 'goldpanbuild') goldPanWorkers++;
    else if (pathState[subSlot] && activePaths.includes(subSlot)) {
      pathState[subSlot].workers++;
      // Re-assigning to chasinghorse clears the "Lost the trail" persistent message.
      if (subSlot === 'chasinghorse' && pathState[subSlot].rollMsg === 'Lost the trail') {
        pathState[subSlot].rollMsg = null;
      }
    }
    else return;
    window.OrbWeaver.Cards.refresh(mechanic);
  }

  // Remove a worker from a sub-slot, returning it to Mountains card free pool.
  function subUnassign(subSlot) {
    if (subSlot === 'quarry') { if (quarryWorkers > 0) quarryWorkers--; else return; }
    else if (subSlot === 'wheatfieldbuild') { if (wheatWorkers > 0) wheatWorkers--; else return; }
    else if (subSlot === 'goldpanbuild') { if (goldPanWorkers > 0) goldPanWorkers--; else return; }
    else if (pathState[subSlot] && activePaths.includes(subSlot) && pathState[subSlot].workers > 0) pathState[subSlot].workers--;
    else return;
    window.OrbWeaver.Cards.refresh(mechanic);
  }

  function onStageComplete(id) {
    if (id === 'outpost') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('mtn_scoutstable'));
      quarryPhase = 'idle';
    }
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  const stageTrack = window.OrbWeaver.Upgrades.createChoiceTrack(OUTPOST_ITEMS, onStageComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:stage`, stageTrack);

  // Whenever the pool changes, clamp sub-slot workers so they never exceed
  // the total assigned to the Mountains card. This fires when the card-face
  // stepper removes workers while sub-slots are still occupied — without this,
  // sub-slot workers would keep running "for free" with no card assignment
  // backing them. Clamping is greedy from the bottom: quarry, wheat, gold pan,
  // then each active path in order — first in, first cut.
  pool.onChange(() => {
    const assigned = pool.getAssigned(ID);
    let budget = assigned;
    function clamp(get, set) {
      const keep = Math.min(get(), budget);
      set(keep);
      budget -= keep;
    }
    clamp(() => quarryWorkers, (v) => { quarryWorkers = v; });
    clamp(() => wheatWorkers, (v) => { wheatWorkers = v; });
    clamp(() => goldPanWorkers, (v) => { goldPanWorkers = v; });
    activePaths.forEach((id) => {
      clamp(() => pathState[id] ? pathState[id].workers : 0, (v) => { if (pathState[id]) pathState[id].workers = v; });
    });
  });

  /* ---- Wheat Field build ----
     Hand-rolled to match Prepare Stone Quarry's structure exactly (own
     phase state, own hs-card markup, stepper inside the card) rather
     than the shared choice-track engine, since that engine has no
     concept of a dedicated per-item worker sub-slot at all. The cost
     mechanic itself stays simple like Outpost, not Quarry's gradual
     worker-driven timer. Free to build (no resource cost). Unlocked once
     the 'wheatfield' travel path completes (wheatFieldUnlocked() —
     derived from pathState, no separate saved flag needed). Building
     it reveals the Wheat Field card, whose own function is still TBD. */
  const WHEAT_BUILD_TIME = 10;
  let wheatPhase = 'idle'; // idle | building | done
  let wheatTimeRemaining = WHEAT_BUILD_TIME;
  let wheatWorkers = 0;
  let wheatM = 1, wheatP = 1, wheatF = 0;
  function wheatFieldUnlocked() { return !!(pathState.wheatfield && pathState.wheatfield.phase === 'done'); }

  /* ---- Gold Panning build ----
     Same hand-rolled pattern as Wheat Field: flat worker-driven timer,
     free to build (no resource cost). Unlocked when the
     'surroundedmountains' travel path completes. Reveals the Gold
     Panning card on completion. */
  const GOLDPAN_BUILD_TIME = 20;
  let goldPanPhase = 'idle'; // idle | building | done
  let goldPanTimeRemaining = GOLDPAN_BUILD_TIME;
  let goldPanWorkers = 0;
  let goldPanM = 1, goldPanP = 1, goldPanF = 0;
  function goldPanUnlocked() { return !!(pathState.surroundedmountains && pathState.surroundedmountains.phase === 'done'); }

  function ensureResource(baseId, name) {
    const id = PREFIX + baseId;
    window.OrbWeaver.Resources.ensure(id, { name, mount: mtnMount, current: 0, displayType: 'decimal', hidden: false });
    return id;
  }

  function initWorkersRow(mount) { mtnMount = mount; pool.init(mount); }

  // Renders a sub-slot stepper row for use inside the modal detail cards.
  // data-mtn-sub-val identifies the count span for patchSubSlot() below.
  // rateText (e.g. "Building 2/s") renders in a .worker-desc span, live-
  // patched every tick by patchLiveTrack() via its data-mtn-rate tag.
  // Hold-to-repeat is wired separately, in afterRender() below.
  function stepperHtml(slot, count, rateText) {
    const rateSpan = rateText != null ? `<span class="worker-desc" data-mtn-rate="${slot}">${rateText}</span>` : '';
    return `<div class="card-steppers visible" style="margin-top:4px">
      <button class="card-stepper-btn" data-mtn-sub="${slot}" data-mtn-sub-action="remove" ${count <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-mtn-sub-val="${slot}">${count}</span>
      <button class="card-stepper-btn" data-mtn-sub="${slot}" data-mtn-sub-action="add">+</button>
      ${rateSpan}
    </div>`;
  }

  // Live-patches a sub-slot stepper's count and disabled state in place —
  // never rebuilds it. Called from patchLiveTrack() every tick and right
  // after every subAssign/subUnassign (via Cards.refresh()).
  function patchSubSlot(slot, count) {
    const valEl = document.querySelector(`#card-modal-body [data-mtn-sub-val="${slot}"]`);
    if (valEl) valEl.textContent = count;
    const minusBtn = document.querySelector(`#card-modal-body [data-mtn-sub="${slot}"][data-mtn-sub-action="remove"]`);
    if (minusBtn) minusBtn.disabled = count <= 0;
  }

  // Live rate text for a sub-timer's stepper row — '' at 0 workers, same
  // convention as every card-level getWorkerDesc().
  function subRateText(verb, workers, m, p, f) {
    if (workers === 0) return '';
    return `${verb} ${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(workers, m, p, f))}/s`;
  }

  // Renders one active travel path as a chromeless bare-section, matching
  // hs_card_pattern.chromeless_structure. Its bar is eased by the shared
  // smoothing engine via mechanic.getExtraBars() (data-extra-track);
  // status text and rate are live-patched every tick in patchLiveTrack().
  function renderPathSection(id) {
    const def = TRAVEL_PATHS[id];
    const st = pathState[id];
    const descText = typeof def.desc === 'function' ? def.desc(st.workers) : def.desc;
    const stepper = stepperHtml(id, st.workers, subRateText(def.verb, st.workers, st.m, st.p, st.f));
    // Concept-3 dotted-trail look — currently only Chasing a wild horse
    // opts in via TRAVEL_PATHS' trail:true; every other path keeps the
    // chromeless bare-section below.
    if (def.trail) {
      const rollText = st.rollMsg || '';
      return `<div class="trail-card">
        <div class="trail-name">${def.title}</div>
        <div class="trail-desc" data-path-desc="${id}">${descText}</div>
        <div class="trail-track">
          <div class="trail-dot start"></div>
          <div class="trail-line"><div class="trail-fill" data-extra-track="${id}"></div></div>
          <div class="trail-dot"></div>
        </div>
        <div class="trail-foot">
          ${stepper}
          <span class="trail-roll" data-path-roll="${id}">${rollText}</span>
        </div>
      </div>`;
    }
    return `<div class="bare-section">
      <div class="bare-row">
        <span class="bare-label">${def.title}</span>
      </div>
      <div class="detail-card-desc">${descText}</div>
      <div class="detail-progress-wrap"><div class="detail-progress-bar" data-extra-track="${id}"></div></div>
      ${stepper}
    </div>`;
  }

  // Inert placeholder revealed by a completed path's `stubs` list — title
  // + "TBD" only, no timer, no functionality, until it's designed later.
  function renderStub(title) {
    return `<div class="bare-section">
      <div class="bare-row"><span class="bare-label">${title}</span></div>
      <div class="detail-card-desc">TBD</div>
    </div>`;
  }

  // Wheat Field's build option — free (time only), no resource cost.
  function wheatFieldSection() {
    if (!wheatFieldUnlocked() || wheatPhase === 'done') return '';
    if (wheatPhase === 'building') {
      const secs = Math.ceil(wheatTimeRemaining);
      const pct = Math.min(100, ((WHEAT_BUILD_TIME - wheatTimeRemaining) / WHEAT_BUILD_TIME) * 100);
      return `<div class="hs-card">
        <div class="hs-head"><span class="hs-title">Wheat Field</span><span class="detail-status" data-wheat-timer>${secs}s</span></div>
        <div class="hs-body">
          <div class="detail-status"><span data-wheat-status>Building — ${secs}s remaining</span></div>
          <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="wheatfield" style="width:${pct}%"></div></div>
          ${stepperHtml('wheatfieldbuild', wheatWorkers, subRateText('Farming', wheatWorkers, wheatM, wheatP, wheatF))}
          <button class="action-btn" data-mtn-action="cancel-wheat">Cancel</button>
        </div></div>`;
    }
    // idle
    return `<div class="hs-card" data-wheat-card>
      <div class="hs-head"><span class="hs-title">Wheat Field</span></div>
      <div class="hs-body">
        <div class="hs-desc-build-row">
          <span class="upgrade-desc upgrade-desc-affordable">TBD</span>
          <button class="action-btn hs-btn-right" data-mtn-action="start-wheat">Free</button>
        </div>
      </div></div>`;
  }

  // Gold Panning build — free (time only), no resource cost.
  function goldPanSection() {
    if (!goldPanUnlocked() || goldPanPhase === 'done') return '';
    if (goldPanPhase === 'building') {
      const secs = Math.ceil(goldPanTimeRemaining);
      const pct = Math.min(100, ((GOLDPAN_BUILD_TIME - goldPanTimeRemaining) / GOLDPAN_BUILD_TIME) * 100);
      return `<div class="hs-card">
        <div class="hs-head"><span class="hs-title">Gold Panning</span><span class="detail-status" data-goldpan-timer>${secs}s</span></div>
        <div class="hs-body">
          <div class="detail-status"><span data-goldpan-status>Building — ${secs}s remaining</span></div>
          <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="goldpanbuild" style="width:${pct}%"></div></div>
          ${stepperHtml('goldpanbuild', goldPanWorkers, subRateText('Building', goldPanWorkers, goldPanM, goldPanP, goldPanF))}
          <button class="action-btn" data-mtn-action="cancel-goldpan">Cancel</button>
        </div></div>`;
    }
    // idle
    return `<div class="hs-card" data-goldpan-card>
      <div class="hs-head"><span class="hs-title">Gold Panning</span></div>
      <div class="hs-body">
        <div class="hs-desc-build-row">
          <span class="upgrade-desc upgrade-desc-affordable">Pan the river for gold.</span>
          <button class="action-btn hs-btn-right" data-mtn-action="start-goldpan">Free</button>
        </div>
      </div></div>`;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    buildTrackKey: 'quarry',
    getBuildBarTrackKey: () => (stageTrack.isBuilding() || stageTrack.getQueuedItem()) ? 'stage' : 'quarry',
    upgradeTrackKey: 'travelpaths', // no modal element ever matches this key — path bars are hand-patched (see patchLiveTrack)
    workerPool: pool,
    cardName: () => 'Mountains',
    isBillable: () => stageTrack.isBuilding() || quarryPhase === 'building' || wheatPhase === 'building' || activePaths.some((id) => pathState[id].phase === 'exploring'),
    getBillableCount,
    isBuildBarFaded: () => stageTrack.getQueuedItem() !== null && !stageTrack.isBuilding(),
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return '';
      // Priority 1: Chasing a wild horse — unique, no rate shown.
      if (pathState.chasinghorse && pathState.chasinghorse.workers > 0) return 'Chasing';
      // Priority 2: A build sub-slot running with workers (Quarry, Wheat Field, Gold Panning).
      if (quarryPhase === 'building' && quarryWorkers > 0)
        return subRateText('Building', quarryWorkers, quarryM, quarryP, quarryF);
      if (wheatPhase === 'building' && wheatWorkers > 0)
        return subRateText('Building', wheatWorkers, wheatM, wheatP, wheatF);
      if (goldPanPhase === 'building' && goldPanWorkers > 0)
        return subRateText('Building', goldPanWorkers, goldPanM, goldPanP, goldPanF);
      // Priority 3: Any staffed travel path — pick the most-complete one.
      const staffedPaths = activePaths.filter((id) => pathState[id].workers > 0 && id !== 'chasinghorse');
      if (staffedPaths.length > 0) {
        const best = staffedPaths.reduce((a, b) =>
          (pathState[a].progress / pathTotalTime(a)) >= (pathState[b].progress / pathTotalTime(b)) ? a : b
        );
        const st = pathState[best];
        return subRateText(TRAVEL_PATHS[best].verb, st.workers, st.m, st.p, st.f);
      }
      // Existing stage-build / queued / to-build states.
      const pathsStopped = activePaths.length > 0 && activePaths.every((id) => {
        const st = pathState[id];
        return st.workers > 0 && st.phase !== 'exploring';
      });
      const quarryStopped = quarryWorkers > 0 && quarryPhase !== 'building' && quarryPhase !== 'done';
      if (pathsStopped && quarryStopped) return 'Stopped';
      if (stageTrack.isBuilding()) {
        const item = stageTrack.activeItem();
        const secs = Math.ceil(stageTrack.getRemaining());
        return pool.getAssigned(ID) === 0 ? `Stopped ${item.name} – ${secs}s` : `Building ${item.name} – ${secs}s`;
      }
      const queued = stageTrack.getQueuedItem();
      if (queued) return `Queued ${queued.name} – waiting`;
      const remaining = stageTrack.availableCount();
      if (remaining <= 0) return '';
      return pool.getAssigned(ID) > 0 ? `Stopped – ${remaining} to build` : `${remaining} to build`;
    },
    // Card-face top bar reflects whichever travel path is first/active;
    // hides once the chain has run out of active paths (all resolved
    // into stubs).
    getUpgradeBarPct() {
      if (activePaths.length === 0) return 100;
      const id = activePaths[0];
      return Math.min(100, (pathState[id].progress / pathTotalTime(id)) * 100);
    },
    getBuildBarPct() {
      if (stageTrack.isBuilding()) return stageTrack.getProgressPct();
      if (stageTrack.getQueuedItem()) return stageTrack.getQueueFillPct();
      if (quarryPhase === 'done') return 100;
      if (quarryPhase === 'building') {
        return Math.min(100, ((QUARRY_BUILD_TIME - quarryTimeRemaining) / QUARRY_BUILD_TIME) * 100);
      }
      return 0;
    },
    // Every currently active travel path's own bar, eased by the shared
    // smoothing engine (js/core/cards.js startSmoothing) instead of being
    // hand-set once per tick — smooth even with more than one active at
    // once, and bars automatically appear/disappear as paths do.
    getExtraBars: () => activePaths.map((id) => ({
      id, pct: Math.min(100, (pathState[id].progress / pathTotalTime(id)) * 100)
    })),
    // No card-level rate line beyond the top/bottom bars — every worker-
    // driven sub-process here (quarry, wheat field build, each travel
    // path) has its own dedicated stepper with its own rate line instead.
    hideUpgradeBar: () => activePaths.length === 0,
    hideBuildBar: () => quarryPhase === 'done' && !stageTrack.isBuilding() && !stageTrack.getQueuedItem(),
    patchLiveTrack() {
      stageTrack.patchModalRows();
      activePaths.forEach((id) => {
        const def = TRAVEL_PATHS[id];
        const st = pathState[id];
        // Bar itself is handled by the shared smoothing engine via
        // getExtraBars() above — only text is patched here.
        const rateEl = document.querySelector(`#card-modal-body [data-mtn-rate="${id}"]`);
        if (rateEl) rateEl.textContent = subRateText(def.verb, st.workers, st.m, st.p, st.f);
        if (typeof def.desc === 'function') {
          const descEl = document.querySelector(`#card-modal-body [data-path-desc="${id}"]`);
          if (descEl) descEl.textContent = def.desc(st.workers);
        }
        if (def.diceInterval) {
          const rollEl = document.querySelector(`#card-modal-body [data-path-roll="${id}"]`);
          if (rollEl) {
            // Show per-roll messages only while staffed, but "Lost the trail"
            // persists even at 0 workers — it's a state message, not a readout.
            const show = st.workers > 0 ? (st.rollMsg || '') : (st.rollMsg === 'Lost the trail' ? st.rollMsg : '');
            rollEl.textContent = show;
          }
        }
        patchSubSlot(id, st.workers);
      });
      const quarryRateEl = document.querySelector('#card-modal-body [data-mtn-rate="quarry"]');
      if (quarryRateEl) quarryRateEl.textContent = subRateText('Building', quarryWorkers, quarryM, quarryP, quarryF);
      patchSubSlot('quarry', quarryWorkers);
      if (wheatFieldUnlocked()) {
        if (wheatPhase === 'building') {
          const secs = Math.ceil(wheatTimeRemaining);
          const pct = Math.min(100, ((WHEAT_BUILD_TIME - wheatTimeRemaining) / WHEAT_BUILD_TIME) * 100);
          const headerTimer = document.querySelector('#card-modal-body [data-wheat-timer]');
          if (headerTimer) headerTimer.textContent = `${secs}s`;
          const statusEl = document.querySelector('#card-modal-body [data-wheat-status]');
          if (statusEl) statusEl.textContent = `Building — ${secs}s remaining`;
          const barEl = document.querySelector('#card-modal-body [data-track="wheatfield"]');
          if (barEl) barEl.style.width = pct + '%';
          const wheatRateEl = document.querySelector('#card-modal-body [data-mtn-rate="wheatfieldbuild"]');
          if (wheatRateEl) wheatRateEl.textContent = subRateText('Farming', wheatWorkers, wheatM, wheatP, wheatF);
          patchSubSlot('wheatfieldbuild', wheatWorkers);
        }
      }
      if (goldPanUnlocked()) {
        if (goldPanPhase === 'building') {
          const secs = Math.ceil(goldPanTimeRemaining);
          const pct = Math.min(100, ((GOLDPAN_BUILD_TIME - goldPanTimeRemaining) / GOLDPAN_BUILD_TIME) * 100);
          const timerEl = document.querySelector('#card-modal-body [data-goldpan-timer]');
          if (timerEl) timerEl.textContent = `${secs}s`;
          const statusEl = document.querySelector('#card-modal-body [data-goldpan-status]');
          if (statusEl) statusEl.textContent = `Building — ${secs}s remaining`;
          const barEl = document.querySelector('#card-modal-body [data-track="goldpanbuild"]');
          if (barEl) barEl.style.width = pct + '%';
          const rateEl = document.querySelector('#card-modal-body [data-mtn-rate="goldpanbuild"]');
          if (rateEl) rateEl.textContent = subRateText('Building', goldPanWorkers, goldPanM, goldPanP, goldPanF);
          patchSubSlot('goldpanbuild', goldPanWorkers);
        }
      }
      if (quarryPhase === 'building') {
        const secs = Math.ceil(quarryTimeRemaining);
        const headerTimer = document.querySelector('#card-modal-body [data-quarry-timer]');
        if (headerTimer) headerTimer.textContent = `${secs}s`;
        const statusEl = document.querySelector('#card-modal-body [data-quarry-status]');
        if (statusEl) statusEl.textContent = quarryStalled ? 'Stopped – waiting for resources' : `Building — ${secs}s remaining`;
        const descEl = document.querySelector('#card-modal-body .quarry-desc');
        if (descEl) descEl.textContent = `Wood: ${quarryWoodDrained.toFixed(1)}/${QUARRY_WOOD_COST} | Stone: ${quarryStoneDrained.toFixed(1)}/${QUARRY_STONE_COST} | ${secs}s remaining`;
      }
      if (quarryPhase === 'idle') {
        const card = document.querySelector('#card-modal-body [data-quarry-card]');
        if (card) {
          const qw = window.OrbWeaver.Resources.get(WOOD_ID);
          const qs = window.OrbWeaver.Resources.get(STONE_ID);
          const affordable = qw >= QUARRY_WOOD_COST && qs >= QUARRY_STONE_COST;
          card.classList.toggle('hs-card-dim', !affordable);
          const costLbl = card.querySelector('.quarry-cost-label');
          if (costLbl) costLbl.textContent = `${Math.round(qw)}/${QUARRY_WOOD_COST} Wood, ${Math.round(qs)}/${QUARRY_STONE_COST} Stone – 45s`;
          const desc = card.querySelector('.upgrade-desc');
          if (desc) desc.classList.toggle('upgrade-desc-affordable', affordable);
          const btn = card.querySelector('[data-mtn-action="start-quarry"]');
          if (btn) btn.disabled = !affordable;
        }
      }
    },
    renderModalHTML() {
      const outpostDone = stageTrack.availableCount() === 0 && !stageTrack.isBuilding();
      let postOutpost = '';
      if (outpostDone) {
        // Quarry section
        let quarrySection = '';
        if (quarryPhase === 'building') {
          const secs = Math.ceil(quarryTimeRemaining);
          const stallText = quarryStalled ? '<div class="detail-status"><span data-quarry-status>Stopped – waiting for resources</span></div>' : '';
          quarrySection = `<div class="hs-card">
            <div class="hs-head"><span class="hs-title">Prepare Stone Quarry</span><span class="detail-status" data-quarry-timer>${secs}s</span></div>
            <div class="hs-body">
              ${stallText}
              <div class="detail-card-desc quarry-desc">Wood: ${quarryWoodDrained.toFixed(1)}/${QUARRY_WOOD_COST} | Stone: ${quarryStoneDrained.toFixed(1)}/${QUARRY_STONE_COST} | ${secs}s remaining</div>
              <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="quarry"></div></div>
              ${stepperHtml('quarry', quarryWorkers, subRateText('Building', quarryWorkers, quarryM, quarryP, quarryF))}
              <button class="action-btn" data-mtn-action="cancel-quarry">Cancel</button>
            </div></div>`;
        } else if (quarryPhase === 'idle') {
          const quarryWood = window.OrbWeaver.Resources.get(WOOD_ID);
          const quarryStone = window.OrbWeaver.Resources.get(STONE_ID);
          const quarryAffordable = quarryWood >= QUARRY_WOOD_COST && quarryStone >= QUARRY_STONE_COST;
          quarrySection = `<div class="hs-card${quarryAffordable ? '' : ' hs-card-dim'}" data-quarry-card>
            <div class="hs-head">
              <span class="hs-title">Prepare Stone Quarry</span>
              <span class="upgrade-costtime quarry-cost-label">${Math.round(quarryWood)}/${QUARRY_WOOD_COST} Wood, ${Math.round(quarryStone)}/${QUARRY_STONE_COST} Stone – 45s</span>
            </div>
            <div class="hs-body">
              <div class="hs-desc-build-row">
                <span class="upgrade-desc${quarryAffordable ? ' upgrade-desc-affordable' : ''}">A Quarry provides more stone than a Pit.</span>
                <button class="action-btn hs-btn-right" data-mtn-action="start-quarry" ${quarryAffordable ? '' : 'disabled'}>Build</button>
              </div>
            </div></div>`;
        } // quarryPhase === 'done' -> quarrySection stays ''

        const wheatBlock = wheatFieldSection();
        const goldPanBlock = goldPanSection();
        // pinBottom paths (e.g. Wild horses) always sort below every
        // other active path, regardless of activePaths' actual array
        // order — see TRAVEL_PATHS' pinBottom note above.
        const orderedPaths = activePaths.slice().sort((a, b) =>
          (TRAVEL_PATHS[a].pinBottom ? 1 : 0) - (TRAVEL_PATHS[b].pinBottom ? 1 : 0));
        const blocks = [
          ...orderedPaths.map(renderPathSection),
          ...pathStubs.map(renderStub),
          ...(wheatBlock ? [wheatBlock] : []),
          ...(goldPanBlock ? [goldPanBlock] : []),
          ...(quarrySection ? [quarrySection] : [])
        ];
        postOutpost = blocks.map((b) => `<div class="bench-modal-divider"></div>${b}`).join('');
      }
      return `<div class="bench-modal">${stageTrack.renderModalRows(ID, 'stage')}${postOutpost}</div>`;
    },
    // Wires hold-to-repeat (same behavior as every other card's steppers,
    // see js/core/cards.js addHoldBehavior) onto every sub-slot stepper
    // button just rendered — quarry, and every currently active travel
    // path. Runs after every render, since renderModalHTML() rebuilds
    // these buttons from scratch each time.
    afterRender() {
      const body = document.getElementById('card-modal-body');
      if (!body) return;
      body.querySelectorAll('[data-mtn-sub]').forEach((btn) => {
        const slot = btn.dataset.mtnSub;
        const action = btn.dataset.mtnSubAction;
        window.OrbWeaver.Cards.addHoldBehavior(btn, () => {
          if (action === 'add') subAssign(slot);
          else subUnassign(slot);
        });
      });
    },
    tick(goldAvailable, tickRate) {
      const queued = stageTrack.getQueuedItem();
      const freeWorkers = freeCardWorkers();
      if (queued && freeWorkers > 0) {
        stageTrack.start(queued.id);
        if (stageTrack.isBuilding()) stageTrack.dequeue();
      }
      if (stageTrack.isBuilding() && freeWorkers > 0) stageTrack.advanceTimer(tickRate, freeWorkers, stageM, stageP, stageF);

      // Wheat Field build — hand-rolled like Quarry, but a simple flat
      // timer (cost already spent upfront when Build was clicked, see
      // the click handler below) rather than a gradual drain.
      if (wheatPhase === 'building' && wheatWorkers > 0) {
        wheatTimeRemaining -= window.OrbWeaver.Upgrades.workerRate(wheatWorkers, wheatM, wheatP, wheatF) * tickRate;
        if (wheatTimeRemaining <= 0) {
          wheatPhase = 'done';
          wheatTimeRemaining = 0;
          wheatWorkers = 0;
          window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('wheatfieldcard'));
          window.OrbWeaver.WheatField.fillWheat();
          window.OrbWeaver.Footer.push('Wheat Field established.');
          window.OrbWeaver.Cards.refreshOpenModal(ID);
        }
      }

      // Gold Panning build — same flat-timer pattern as Wheat Field
      if (goldPanPhase === 'building' && goldPanWorkers > 0) {
        goldPanTimeRemaining -= window.OrbWeaver.Upgrades.workerRate(goldPanWorkers, goldPanM, goldPanP, goldPanF) * tickRate;
        if (goldPanTimeRemaining <= 0) {
          goldPanPhase = 'done';
          goldPanTimeRemaining = 0;
          goldPanWorkers = 0;
          window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('goldpanning'));
          window.OrbWeaver.Footer.push('Gold Panning established.');
          window.OrbWeaver.Cards.refreshOpenModal(ID);
        }
      }

      // Quarry gradual build
      if (quarryPhase === 'building' && quarryWorkers > 0) {
        const woodNeeded = QUARRY_WOOD_COST - quarryWoodDrained;
        const stoneNeeded = QUARRY_STONE_COST - quarryStoneDrained;
        const woodAvail = window.OrbWeaver.Resources.get(WOOD_ID);
        const stoneAvail = window.OrbWeaver.Resources.get(STONE_ID);
        quarryStalled = (woodNeeded > 0 && woodAvail <= 0) || (stoneNeeded > 0 && stoneAvail <= 0);
        if (!quarryStalled) {
          const rate = tickRate / QUARRY_BUILD_TIME;
          const woodTick = Math.min(woodNeeded, QUARRY_WOOD_COST * rate);
          const stoneTick = Math.min(stoneNeeded, QUARRY_STONE_COST * rate);
          quarryWoodDrained += window.OrbWeaver.Resources.spend(WOOD_ID, woodTick);
          quarryStoneDrained += window.OrbWeaver.Resources.spend(STONE_ID, stoneTick);
          quarryTimeRemaining -= window.OrbWeaver.Upgrades.workerRate(quarryWorkers, quarryM, quarryP, quarryF) * tickRate;
          if (quarryWoodDrained >= QUARRY_WOOD_COST && quarryStoneDrained >= QUARRY_STONE_COST || quarryTimeRemaining <= 0) {
            quarryPhase = 'done';
            quarryTimeRemaining = 0;
            quarryWorkers = 0;
            window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('quarry'));
            window.OrbWeaver.Footer.push('Stone Quarry established.');
            window.OrbWeaver.Cards.refreshOpenModal(ID);
          }
        }
      }

      // Travel paths — pure worker-driven timers; completing one removes
      // it and activates whatever it reveals (more paths, TBD stubs, or
      // both), possibly in parallel.
      activePaths.slice().forEach((id) => {
        const def = TRAVEL_PATHS[id];
        const st = pathState[id];
        if (st.workers > 0) {
          st.phase = 'exploring';
          // Dice-roll time penalty (e.g. Chasing a wild horse) — only
          // rolls while actively staffed. Optional: absent on every
          // other path, so their behavior is unchanged.
          if (def.diceInterval) {
            st.diceTimer = (st.diceTimer || 0) + tickRate;
            while (st.diceTimer >= def.diceInterval) {
              st.diceTimer -= def.diceInterval;
              const hit = (Math.floor(Math.random() * 100) + 1) > def.diceThreshold;
              if (hit) st.extra = (st.extra || 0) + def.diceAdd;
              st.rollMsg = hit ? 'Losing the trail' : 'On the trail';
            }
          }
          st.progress += window.OrbWeaver.Upgrades.workerRate(st.workers, st.m, st.p, st.f) * tickRate;
          // "Lost the trail" trigger — fires when bad dice rolls push time
          // remaining back up to 110s or more, despite ongoing worker progress.
          // Uses time-remaining (>= not <=) so it only triggers when the horse
          // is actively getting away, not at the bonus-floor starting point (60s).
          if (id === 'chasinghorse' && (pathTotalTime(id) - st.progress) >= 125) {
            st.workers = 0;
            st.rollMsg = 'Lost the trail';
            st.phase = 'idle';
            window.OrbWeaver.Cards.refresh(mechanic);
          }
          const total = pathTotalTime(id);
          if (st.progress >= total) {
            st.progress = total;
            st.phase = 'done';
            st.workers = 0; // explicitly return to the free pool, not just implicitly via leaving activePaths
            activePaths.splice(activePaths.indexOf(id), 1);
            def.reveals.forEach((childId) => { initPathState(childId); activePaths.push(childId); });
            pathStubs.push(...def.stubs);
            window.OrbWeaver.Footer.push(def.doneMsg);
            window.OrbWeaver.Cards.refreshOpenModal(ID);
          }
        } else {
          if (st.phase === 'exploring') st.phase = 'idle';
          // Clear dice roll messages on stop, but preserve "Lost the trail"
          // — it's a persistent state message, not a per-roll readout.
          if (st.rollMsg && st.rollMsg !== 'Lost the trail') st.rollMsg = null;
          // Bonus floor (e.g. Chasing a wild horse) — at 0 workers,
          // progress and any dice-added time reset to the (time - bonus)
          // baseline. Covers both the head-start on first assignment and
          // the reset-on-removal rule with one mechanism. Optional: no
          // effect on paths without a bonus field.
          if (def.bonus != null) { st.progress = def.time - def.bonus; st.extra = 0; st.diceTimer = 0; }
        }
      });

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  function reveal() {
    if (discovered) return;
    discovered = true;
    document.getElementById('mountains-section').style.display = '';
    document.getElementById('left-hand-mountains-group').style.display = '';
    document.getElementById('camp-section-label').style.display = '';
    window.OrbWeaver.Resources.reveal(WOOD_ID);
    window.OrbWeaver.Resources.reveal(STONE_ID);
    window.OrbWeaver.Cards.reveal(mechanic);
  }

  /* ---- Save/load ----
     The Outpost stage track saves itself. What lives here is the
     hand-rolled Quarry and Wheat Field sub-tasks and the travel-path
     chain's state — a SUBSET of the workers already assigned to the
     Mountains card, so both the pool's assignment and this split must
     come back together or it silently drifts. Quarry's drained totals
     and Wheat Field's spent cost are real spent resources and are
     preserved exactly (Wheat Field's cost was deducted upfront, so
     unlike Quarry there's nothing gradual to track — only phase and
     time remaining). */
  window.OrbWeaver.Save.register(ID,
    () => ({
      d: discovered ? 1 : 0, o: opened ? 1 : 0,
      qp: quarryPhase, qw: quarryWoodDrained, qs: quarryStoneDrained,
      qt: quarryTimeRemaining, qn: quarryWorkers,
      ap: activePaths.slice(), ps: pathState, pst: pathStubs.slice(),
      wp: wheatPhase, wt: wheatTimeRemaining, wn: wheatWorkers,
      gp: goldPanPhase, gt: goldPanTimeRemaining, gn: goldPanWorkers
    }),
    (d) => {
      opened = !!d.o;
      quarryPhase = d.qp || 'idle';
      quarryWoodDrained = d.qw || 0;
      quarryStoneDrained = d.qs || 0;
      quarryTimeRemaining = d.qt != null ? d.qt : QUARRY_BUILD_TIME;
      quarryWorkers = d.qn || 0;
      activePaths = d.ap && d.ap.length ? d.ap : ['hike'];
      pathState = d.ps && Object.keys(d.ps).length ? d.ps : {};
      if (!pathState.hike && activePaths.includes('hike')) initPathState('hike');
      activePaths.forEach((id) => { if (!pathState[id]) initPathState(id); });
      pathStubs = d.pst || [];
      wheatPhase = d.wp || 'idle';
      wheatTimeRemaining = d.wt != null ? d.wt : WHEAT_BUILD_TIME;
      wheatWorkers = d.wn || 0;
      goldPanPhase = d.gp || 'idle';
      goldPanTimeRemaining = d.gt != null ? d.gt : GOLDPAN_BUILD_TIME;
      goldPanWorkers = d.gn || 0;
      if (d.d) reveal();
    });

  window.OrbWeaver.Mechanics.register(mechanic);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mtn-action]');
    if (!btn) return;
    if (btn.dataset.mtnAction === 'start-quarry' && quarryPhase === 'idle') {
      quarryPhase = 'building';
      quarryWoodDrained = 0; quarryStoneDrained = 0;
      quarryTimeRemaining = QUARRY_BUILD_TIME; quarryStalled = false;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'cancel-quarry' && quarryPhase === 'building') {
      window.OrbWeaver.Resources.add(WOOD_ID, quarryWoodDrained);
      window.OrbWeaver.Resources.add(STONE_ID, quarryStoneDrained);
      quarryPhase = 'idle';
      quarryWoodDrained = 0; quarryStoneDrained = 0;
      quarryTimeRemaining = QUARRY_BUILD_TIME; quarryStalled = false;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'start-wheat' && wheatFieldUnlocked() && wheatPhase === 'idle') {
      wheatPhase = 'building';
      wheatTimeRemaining = WHEAT_BUILD_TIME;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'cancel-wheat' && wheatPhase === 'building') {
      wheatPhase = 'idle';
      wheatTimeRemaining = WHEAT_BUILD_TIME;
      wheatWorkers = 0;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'start-goldpan' && goldPanUnlocked() && goldPanPhase === 'idle') {
      goldPanPhase = 'building';
      goldPanTimeRemaining = GOLDPAN_BUILD_TIME;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'cancel-goldpan' && goldPanPhase === 'building') {
      goldPanPhase = 'idle';
      goldPanTimeRemaining = GOLDPAN_BUILD_TIME;
      goldPanWorkers = 0;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    }
  });

  window.OrbWeaver.Mountains = {
    id: ID, label: 'Mountains', prefix: PREFIX, woodId: WOOD_ID, stoneId: STONE_ID, workerPool: pool,
    initWorkersRow, addWorkers: (n) => pool.addWorkers(n), ensureResource, reveal, isDiscovered: () => discovered
  };
  window.OrbWeaver.Locations.register(window.OrbWeaver.Mountains);
})();
