/* ============================================================
   MECHANIC: MOUNTAINS (Section B, blue theme)
   Discovered once by Scout Stable's first Expedition Mule (see
   js/mechanics/scoutspen.js), which calls Mountains.reveal() and
   Mountains.addWorkers(n) directly. Mountains has its own resource
   pool (mtn_ prefix, never mixes with Camp's) and its own assignable
   worker pool (own idle/total, separate from Camp's) — riders who
   travel here join this pool, not Camp's.

   Once Outpost is built, the modal shows Stone Quarry (a
   standalone gradual-drain build) plus a branching TRAVEL PATH chain
   (see below) — each a pure worker timer that, on completion, removes
   itself and reveals whatever comes next: more travel paths, inert
   TBD stubs, or both. A path carrying a `grants` block is the one
   exception: it stays on screen with its bar full and its reward
   button switched live, and clicking that button — which costs no
   workers and no time — is what reveals the card and clears the
   section. Sub-slot workers (quarry + every active path)
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

  // Quarry and Smelter Shack builds — flat cost paid up front the moment
  // Build is pressed, then a pure worker-timer countdown (same shape as
  // the Outpost stage above) — no partial draining, no resource stall.
  const QUARRY_WOOD_COST = 500, QUARRY_STONE_COST = 100, QUARRY_BUILD_TIME = 45;
  let quarryPhase = 'idle'; // idle | building | done
  let quarryTimeRemaining = QUARRY_BUILD_TIME;
  let quarryWorkers = 0;

  // Smelter Shack — hidden until smelterUnlocked flips true, which
  // happens the moment the "Gold Panning" claim button goes live (see
  // surroundedmountains' grants.onReady below), not when it's clicked.
  const SMELTER_WOOD_COST = 200, SMELTER_BUILD_TIME = 120;
  let smelterUnlocked = false;
  let smelterPhase = 'idle'; // idle | building | done
  let smelterTimeRemaining = SMELTER_BUILD_TIME;
  let smelterWorkers = 0;

  // Worker contribution formula (see js/core/upgrades.js workerRate()).
  // Independent m/p/f sets — a future tool could speed up any one build
  // or the travel path chain without touching the others.
  let stageM = 1, stageP = 1, stageF = 0;
  let quarryM = 1, quarryP = 1, quarryF = 0;
  let smelterM = 1, smelterP = 1, smelterF = 0;

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
       grants  — optional; makes this a REWARD path. Instead of vanishing
         on completion, the path stays on screen (phase 'claim', bar
         pinned full, workers returned to the free pool) with its reward
         button switched live. Clicking it reveals cards — no workers, no
         build timer — and only then removes the section. Shape:
           label — button text, also shown greyed while still travelling
             so the player can see the payout up front.
           cards — mechanic ids to reveal on claim (one click may grant
             several).
           msg   — footer log line on claim (doneMsg still fires earlier,
             on travel completion).
           onClaim — optional extra side effect (Wheat Field's fillWheat).
           onReady — optional extra side effect fired the moment the path
             reaches phase 'claim' (the button going live), not when it's
             actually clicked — for anything that should unlock as soon
             as the reward is visible/available rather than after the
             player claims it (Smelter Shack's build option).
         Adding a future reward path is one grants block, no new code.
       pinBottom — optional; keeps this path sorted below every other
         currently active path when rendering, even as siblings are
         added/removed around it (plain array order alone doesn't
         guarantee this once a path revealed earlier gets replaced by
         later children — see renderModalHTML()).
       pinTop — optional; the mirror of pinBottom. Keeps this path
         rendered first — above every other path AND above the Quarry
         section — the moment it's revealed, regardless of reveal order.
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
      doneMsg: "You've found a calm stretch of river surrounded by mountains.",
      grants: {
        label: 'Gold Panning', cards: ['goldpanning'], msg: 'Gold Panning established.',
        onReady: () => { smelterUnlocked = true; }
      }
    },
    ruggedpath: {
      title: 'A rugged Mountain path', desc: 'Hike deep into the Mountains.',
      time: 600, verb: 'Hiking', reveals: ['blockedexit'], stubs: ['Deep in the Mountain path'],
      doneMsg: "You've hiked deep into the rugged Mountain path.", pinTop: true
    },
    blockedexit: {
      title: 'A blocked exit', desc: 'The way out of the Mountains has been caved in',
      time: 120, verb: 'Exploring', reveals: [], stubs: [],
      doneMsg: "You've found the blocked way out of the mountains.",
      grants: { label: 'Collapsed Pass', cards: ['collapsedpath'], msg: 'The Collapsed Path lies ahead.' }
    },
    wheatfield: {
      title: 'A small field of wheat in the lower valley.', desc: 'Hike down the valley to the fields below.',
      time: 20, verb: 'Hiking', reveals: [], stubs: [],
      doneMsg: "You've found a small field of wheat in the valley.",
      grants: {
        label: 'Wheat Field', cards: ['wheatfieldcard'], msg: 'Wheat Field established.',
        onClaim: () => window.OrbWeaver.WheatField.fillWheat()
      }
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

  // A finished-but-unclaimed reward path (phase 'claim') deliberately
  // leaves activePaths on completion exactly as every other path does,
  // so nothing that reads activePaths (upkeep, clamping, stat text, the
  // card-face bars, tick) needs to know this state exists at all — it's
  // rendered by checking pathState[id].phase directly (renderModalHTML).

  // Workers actually placed in a sub-slot (Quarry, Wheat Field, any
  // active travel path) right now — the subset of the card's assigned
  // workers that are doing something, vs. just sitting on the card.
  function usedSubSlotWorkers() {
    let used = quarryWorkers + smelterWorkers;
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
    else if (subSlot === 'smelter') smelterWorkers++;
    else if (pathState[subSlot] && activePaths.includes(subSlot)) {
      pathState[subSlot].workers++;
      // Re-assigning to chasinghorse clears the "Lost the trail" persistent message.
      if (subSlot === 'chasinghorse' && pathState[subSlot].rollMsg === 'Lost the trail') {
        pathState[subSlot].rollMsg = null;
      }
    }
    else return;
    mechanic.lastSub = subSlot;
    window.OrbWeaver.Cards.refresh(mechanic);
  }

  // Remove a worker from a sub-slot and return it to Mountains' idle pool.
  function subUnassign(subSlot) {
    if (subSlot === 'quarry') { if (quarryWorkers > 0) quarryWorkers--; else return; }
    else if (subSlot === 'smelter') { if (smelterWorkers > 0) smelterWorkers--; else return; }
    else if (pathState[subSlot] && activePaths.includes(subSlot) && pathState[subSlot].workers > 0) pathState[subSlot].workers--;
    else return;
    pool.unassign(ID); // fires the card refresh
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
  // backing them. Clamping is greedy from the bottom: quarry, then each
  // active path in order — first in, first cut.
  pool.onChange(() => {
    const assigned = pool.getAssigned(ID);
    let budget = assigned;
    function clamp(get, set) {
      const keep = Math.min(get(), budget);
      set(keep);
      budget -= keep;
    }
    clamp(() => quarryWorkers, (v) => { quarryWorkers = v; });
    clamp(() => smelterWorkers, (v) => { smelterWorkers = v; });
    activePaths.forEach((id) => {
      clamp(() => pathState[id] ? pathState[id].workers : 0, (v) => { if (pathState[id]) pathState[id].workers = v; });
    });
  });

  // displayType omitted — Resources.register()'s shared whole-number
  // rule (js/core/resources.js) matches the prefixed id directly, so
  // this doesn't need its own copy of the tools/goldbars/etc. list.
  function ensureResource(baseId, name) {
    const id = PREFIX + baseId;
    window.OrbWeaver.Resources.ensure(id, { name, mount: mtnMount, current: 0, hidden: false });
    return id;
  }

  function initWorkersRow(mount) { mtnMount = mount; pool.init(mount); }

  // Renders a sub-slot stepper row for use inside the modal detail cards.
  // data-mtn-sub-val identifies the count span for patchSubSlot() below.
  // rateText (e.g. "Building 2/s") renders in a .worker-desc span, live-
  // patched every tick by patchLiveTrack() via its data-mtn-rate tag.
  // Hold-to-repeat is wired separately, in afterRender() below.
  // extra — optional trailing markup inside the same row (a reward path's
  // claim button, which pins itself right via its own margin-left:auto).
  function stepperHtml(slot, count, rateText, extra) {
    const rateSpan = rateText != null ? `<span class="worker-desc" data-mtn-rate="${slot}">${rateText}</span>` : '';
    return `<div class="card-steppers visible" style="margin-top:4px">
      <button class="card-stepper-btn" data-mtn-sub="${slot}" data-mtn-sub-action="remove" ${count <= 0 ? 'disabled' : ''}>−</button>
      <span class="card-stepper-val" data-mtn-sub-val="${slot}">${count}</span>
      <button class="card-stepper-btn" data-mtn-sub="${slot}" data-mtn-sub-action="add">+</button>
      ${rateSpan}${extra || ''}
    </div>`;
  }

  // A reward path's claim button. Greyed (disabled) while the travel is
  // still running so the payout is visible up front; live once the path
  // reaches 'claim'. Styling is the stock .action-btn — the only addition
  // is margin-left:auto to pin it opposite the stepper, set inline for the
  // same reason the row above sets its own margin-top inline.
  function claimBtnHtml(id, live) {
    return `<button class="action-btn" style="margin-left:auto" data-mtn-action="claim"
      data-mtn-claim="${id}"${live ? '' : ' disabled'}>${TRAVEL_PATHS[id].grants.label}</button>`;
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
    // Finished reward path: section and full bar stay put, the stepper is
    // gone (its workers already went back to the free pool on completion),
    // and the claim button sits alone at the right of that row. The bar is
    // a plain inline 100% — no data-extra-track, so it never enters the
    // shared smoothing loop it has nothing left to animate for.
    if (st.phase === 'claim') {
      return `<div class="bare-section">
        <div class="bare-row"><span class="bare-label">${def.title}</span></div>
        <div class="detail-card-desc">${descText}</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar" style="width:100%"></div></div>
        <div class="card-steppers visible" style="margin-top:4px">${claimBtnHtml(id, true)}</div>
      </div>`;
    }
    const stepper = stepperHtml(id, st.workers, subRateText(def.verb, st.workers, st.m, st.p, st.f),
      def.grants ? claimBtnHtml(id, false) : '');
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

  // Quarry and Smelter Shack are independent sub-slots on the same card
  // and can build in parallel — but the card face has only one shared
  // status line and one shared bottom bar, so whenever both are running
  // at once, whichever is further along (by completion fraction) wins
  // both the face text and the bar. Returns 'quarry' | 'smelter' | null.
  function mostCompleteBuild() {
    const q = (quarryPhase === 'building' && quarryWorkers > 0)
      ? { key: 'quarry', frac: (QUARRY_BUILD_TIME - quarryTimeRemaining) / QUARRY_BUILD_TIME } : null;
    const s = (smelterPhase === 'building' && smelterWorkers > 0)
      ? { key: 'smelter', frac: (SMELTER_BUILD_TIME - smelterTimeRemaining) / SMELTER_BUILD_TIME } : null;
    if (q && s) return q.frac >= s.frac ? q.key : s.key;
    return q ? q.key : (s ? s.key : null);
  }

  // Same problem, one level up: the travel-path chain branches twice
  // (hike -> river + horses; river -> mountainbasin + wheatfield), so
  // more than one path can be active at once, but the card face has
  // only one shared top bar. Mirrors mostCompleteBuild() above —
  // whichever STAFFED path is furthest along wins. Falls back to
  // activePaths[0] when nothing is currently staffed, preserving the
  // original just-revealed/idle display (including a fresh path's
  // bonus-floor starting progress, e.g. Chasing a wild horse).
  function mostCompletePath() {
    const staffed = activePaths.filter((id) => pathState[id].workers > 0);
    if (staffed.length === 0) return activePaths[0] || null;
    return staffed.reduce((a, b) =>
      (pathState[a].progress / pathTotalTime(a)) >= (pathState[b].progress / pathTotalTime(b)) ? a : b
    );
  }

  // Active + claim-phase paths in modal order (see renderModalHTML's note).
  const pinScore = (id) => (TRAVEL_PATHS[id].pinTop ? -1 : TRAVEL_PATHS[id].pinBottom ? 1 : 0);
  const orderedPaths = () => Object.keys(pathState)
    .filter((id) => activePaths.includes(id) || pathState[id].phase === 'claim')
    .sort((a, b) => pinScore(a) - pinScore(b));

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    buildTrackKey: 'quarry',
    getBuildBarTrackKey: () => (stageTrack.isBuilding() || stageTrack.getQueuedItem()) ? 'stage' : (mostCompleteBuild() || 'quarry'),
    upgradeTrackKey: 'travelpaths', // no modal element ever matches this key — path bars are hand-patched (see patchLiveTrack)
    workerPool: pool,
    cardName: () => 'Mountains',
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots: () => (stageTrack.availableCount() || stageTrack.isBuilding() ? [] : [...orderedPaths().filter((id) => activePaths.includes(id)),
      ...(smelterUnlocked && smelterPhase === 'building' ? ['smelter'] : []), ...(quarryPhase === 'building' ? ['quarry'] : [])]),
    subAdd: subAssign,
    isBillable: () => stageTrack.isBuilding() || quarryPhase === 'building' || smelterPhase === 'building' || activePaths.some((id) => pathState[id].phase === 'exploring'),
    getBillableCount,
    isBuildBarFaded: () => stageTrack.getQueuedItem() !== null && !stageTrack.isBuilding(),
    onOpen() { opened = true; },
    getStatText() {
      if (!opened) return '';
      // Priority 1: Chasing a wild horse — unique, no rate shown.
      if (pathState.chasinghorse && pathState.chasinghorse.workers > 0) return 'Chasing';
      // Priority 2: A build sub-slot running with workers (Quarry or
      // Smelter Shack) — whichever is further along when both are active.
      const activeBuild = mostCompleteBuild();
      if (activeBuild === 'quarry') return subRateText('Building', quarryWorkers, quarryM, quarryP, quarryF);
      if (activeBuild === 'smelter') return subRateText('Building', smelterWorkers, smelterM, smelterP, smelterF);
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
      const smelterStopped = smelterWorkers > 0 && smelterPhase !== 'building' && smelterPhase !== 'done';
      if (pathsStopped && quarryStopped && smelterStopped) return 'Stopped';
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
    // Card-face top bar reflects whichever travel path is most complete
    // among the currently staffed ones (see mostCompletePath() — the
    // chain branches, so more than one path can be running at once);
    // hides once the chain has run out of active paths (all resolved
    // into stubs).
    getUpgradeBarPct() {
      if (activePaths.length === 0) return 100;
      const id = mostCompletePath();
      if (!id) return 0;
      return Math.min(100, (pathState[id].progress / pathTotalTime(id)) * 100);
    },
    getBuildBarPct() {
      if (stageTrack.isBuilding()) return stageTrack.getProgressPct();
      if (stageTrack.getQueuedItem()) return stageTrack.getQueueFillPct();
      // Quarry and Smelter Shack can both be building at once — show
      // whichever is further along (see mostCompleteBuild()).
      const active = mostCompleteBuild();
      if (active === 'quarry') return Math.min(100, ((QUARRY_BUILD_TIME - quarryTimeRemaining) / QUARRY_BUILD_TIME) * 100);
      if (active === 'smelter') return Math.min(100, ((SMELTER_BUILD_TIME - smelterTimeRemaining) / SMELTER_BUILD_TIME) * 100);
      // Nothing currently building — pinned full right before the bar
      // hides (see hideBuildBar), 0 while idle/not-yet-built.
      const quarryDone = quarryPhase === 'done';
      const smelterDone = !smelterUnlocked || smelterPhase === 'done';
      return (quarryDone && smelterDone) ? 100 : 0;
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
    hideBuildBar: () => quarryPhase === 'done' && (!smelterUnlocked || smelterPhase === 'done')
      && !stageTrack.isBuilding() && !stageTrack.getQueuedItem(),
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
      if (quarryPhase === 'building') {
        const secs = Math.ceil(quarryTimeRemaining);
        const headerTimer = document.querySelector('#card-modal-body [data-quarry-timer]');
        if (headerTimer) headerTimer.textContent = `${secs}s`;
        const statusEl = document.querySelector('#card-modal-body [data-quarry-status]');
        if (statusEl) statusEl.textContent = `Building — ${secs}s remaining`;
      }
      if (quarryPhase === 'idle') {
        const card = document.querySelector('#card-modal-body [data-quarry-card]');
        if (card) {
          const qw = window.OrbWeaver.Resources.available(WOOD_ID);
          const qs = window.OrbWeaver.Resources.available(STONE_ID);
          const affordable = qw >= QUARRY_WOOD_COST && qs >= QUARRY_STONE_COST;
          const costLbl = card.querySelector('.quarry-cost-label');
          if (costLbl) costLbl.textContent = `${Math.round(qw)}/${QUARRY_WOOD_COST} Wood, ${Math.round(qs)}/${QUARRY_STONE_COST} Stone – 45s`;
          const btn = card.querySelector('[data-mtn-action="start-quarry"]');
          if (btn) btn.disabled = !affordable;
        }
      }
      if (smelterUnlocked) {
        const smelterRateEl = document.querySelector('#card-modal-body [data-mtn-rate="smelter"]');
        if (smelterRateEl) smelterRateEl.textContent = subRateText('Building', smelterWorkers, smelterM, smelterP, smelterF);
        patchSubSlot('smelter', smelterWorkers);
        if (smelterPhase === 'building') {
          const secs = Math.ceil(smelterTimeRemaining);
          const headerTimer = document.querySelector('#card-modal-body [data-smelter-timer]');
          if (headerTimer) headerTimer.textContent = `${secs}s`;
          const statusEl = document.querySelector('#card-modal-body [data-smelter-status]');
          if (statusEl) statusEl.textContent = `Building — ${secs}s remaining`;
        }
        if (smelterPhase === 'idle') {
          const card = document.querySelector('#card-modal-body [data-smelter-card]');
          if (card) {
            const sw = window.OrbWeaver.Resources.available(WOOD_ID);
            const affordable = sw >= SMELTER_WOOD_COST;
            const costLbl = card.querySelector('.smelter-cost-label');
            if (costLbl) costLbl.textContent = `${Math.round(sw)}/${SMELTER_WOOD_COST} Wood – 120s`;
            const btn = card.querySelector('[data-mtn-action="start-smelter"]');
            if (btn) btn.disabled = !affordable;
          }
        }
      }
    },
    renderModalHTML() {
      const outpostDone = stageTrack.availableCount() === 0 && !stageTrack.isBuilding();
      let postOutpost = '';
      if (outpostDone) {
        // Quarry section — flat cost paid up front on Build; the
        // building view is a plain timer, no resource tracking left to
        // show since nothing drains mid-build.
        let quarrySection = '';
        if (quarryPhase === 'building') {
          const secs = Math.ceil(quarryTimeRemaining);
          quarrySection = `<div class="hs-card">
            <div class="hs-head"><span class="hs-title">Stone Quarry</span><span class="detail-status" data-quarry-timer>${secs}s</span></div>
            <div class="hs-body">
              <div class="detail-status"><span data-quarry-status>Building — ${secs}s remaining</span></div>
              <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="quarry"></div></div>
              ${stepperHtml('quarry', quarryWorkers, subRateText('Building', quarryWorkers, quarryM, quarryP, quarryF))}
              <button class="action-btn" data-mtn-action="cancel-quarry">Cancel</button>
            </div></div>`;
        } else if (quarryPhase === 'idle') {
          const quarryWood = window.OrbWeaver.Resources.available(WOOD_ID);
          const quarryStone = window.OrbWeaver.Resources.available(STONE_ID);
          const quarryAffordable = quarryWood >= QUARRY_WOOD_COST && quarryStone >= QUARRY_STONE_COST;
          quarrySection = `<div class="hs-card" data-quarry-card>
            <div class="hs-head">
              <span class="hs-title">Stone Quarry</span>
              <span class="upgrade-costtime quarry-cost-label">${Math.round(quarryWood)}/${QUARRY_WOOD_COST} Wood, ${Math.round(quarryStone)}/${QUARRY_STONE_COST} Stone – 45s</span>
            </div>
            <div class="hs-body">
              <div class="hs-desc-build-row">
                <span class="upgrade-desc">A Quarry provides more stone than a Pit.</span>
                <button class="action-btn hs-btn-right" data-mtn-action="start-quarry" ${quarryAffordable ? '' : 'disabled'}>Build</button>
              </div>
            </div></div>`;
        } // quarryPhase === 'done' -> quarrySection stays ''

        // Smelter Shack section — hidden until smelterUnlocked; same flat-
        // cost shape as Quarry above, single resource (wood only).
        let smelterSection = '';
        if (smelterUnlocked) {
          if (smelterPhase === 'building') {
            const secs = Math.ceil(smelterTimeRemaining);
            smelterSection = `<div class="hs-card">
              <div class="hs-head"><span class="hs-title">Smelter Shack</span><span class="detail-status" data-smelter-timer>${secs}s</span></div>
              <div class="hs-body">
                <div class="detail-status"><span data-smelter-status>Building — ${secs}s remaining</span></div>
                <div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="smelter"></div></div>
                ${stepperHtml('smelter', smelterWorkers, subRateText('Building', smelterWorkers, smelterM, smelterP, smelterF))}
                <button class="action-btn" data-mtn-action="cancel-smelter">Cancel</button>
              </div></div>`;
          } else if (smelterPhase === 'idle') {
            const smelterWood = window.OrbWeaver.Resources.available(WOOD_ID);
            const smelterAffordable = smelterWood >= SMELTER_WOOD_COST;
            smelterSection = `<div class="hs-card" data-smelter-card>
              <div class="hs-head">
                <span class="hs-title">Smelter Shack</span>
                <span class="upgrade-costtime smelter-cost-label">${Math.round(smelterWood)}/${SMELTER_WOOD_COST} Wood – 120s</span>
              </div>
              <div class="hs-body">
                <div class="hs-desc-build-row">
                  <span class="upgrade-desc">Smelt down gold & ores.</span>
                  <button class="action-btn hs-btn-right" data-mtn-action="start-smelter" ${smelterAffordable ? '' : 'disabled'}>Build</button>
                </div>
              </div></div>`;
          } // smelterPhase === 'done' -> smelterSection stays ''
        }

        // Active and finished-but-unclaimed (claimable) paths render as
        // ONE ordered list, not two appended groups — otherwise a path
        // that finishes travelling would jump from wherever it sat among
        // the active rows to the bottom of the section the instant it
        // reaches 'claim'. Object.keys(pathState) already gives a stable
        // reveal order (entries are created once, in reveal order, and
        // never reordered or deleted before the path is actually
        // claimed), so a path's row position is fixed the moment it's
        // revealed and never moves again on its own. pinTop/pinBottom
        // paths (e.g. A rugged Mountain path / Wild horses) still sort
        // to their pinned end regardless of that order — see
        // TRAVEL_PATHS' pinTop/pinBottom note above.
        // A path's blocks are always assembled paths-first, stubs, then
        // Smelter Shack, then Quarry last, so sorting a pinTop path to
        // the front of orderedPaths also puts it ahead of both builds and
        // any TBD stubs — first in the whole post-Outpost list.
        const blocks = [
          ...orderedPaths().map(renderPathSection),
          ...pathStubs.map(renderStub),
          ...(smelterSection ? [smelterSection] : []),
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

      // Quarry build — cost already paid in full when Build was pressed;
      // just a worker-timer countdown from here.
      if (quarryPhase === 'building' && quarryWorkers > 0) {
        quarryTimeRemaining -= window.OrbWeaver.Upgrades.workerRate(quarryWorkers, quarryM, quarryP, quarryF) * tickRate;
        if (quarryTimeRemaining <= 0) {
          quarryPhase = 'done';
          quarryTimeRemaining = 0;
          quarryWorkers = 0;
          window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('quarry'));
          window.OrbWeaver.Footer.push('Stone Quarry established.');
          window.OrbWeaver.Cards.refreshOpenModal(ID);
        }
      }

      // Smelter Shack build — same shape as Quarry above.
      if (smelterPhase === 'building' && smelterWorkers > 0) {
        smelterTimeRemaining -= window.OrbWeaver.Upgrades.workerRate(smelterWorkers, smelterM, smelterP, smelterF) * tickRate;
        if (smelterTimeRemaining <= 0) {
          smelterPhase = 'done';
          smelterTimeRemaining = 0;
          smelterWorkers = 0;
          window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('smeltershack'));
          window.OrbWeaver.Footer.push('Smelter Shack established.');
          window.OrbWeaver.Cards.refreshOpenModal(ID);
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
            // A reward path parks in 'claim' instead of 'done' — same exit
            // from activePaths either way, so nothing reading that array
            // behaves differently; renderModalHTML's orderedPaths picks
            // it back up for render, in its already-fixed row position.
            st.phase = def.grants ? 'claim' : 'done';
            st.workers = 0; // explicitly return to the free pool, not just implicitly via leaving activePaths
            activePaths.splice(activePaths.indexOf(id), 1);
            def.reveals.forEach((childId) => { initPathState(childId); activePaths.push(childId); });
            pathStubs.push(...def.stubs);
            window.OrbWeaver.Footer.push(def.doneMsg);
            // Fires the instant the claim button goes live — deliberately
            // before the player has clicked it (see grants.onReady above).
            if (def.grants && def.grants.onReady) def.grants.onReady();
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
     hand-rolled Quarry and Smelter Shack builds and the travel-path
     chain's state — a SUBSET of the workers already assigned to the
     Mountains card, so both the pool's assignment and this split must
     come back together or it silently drifts. Both builds are flat
     up-front costs now, so there's nothing partial to preserve beyond
     phase/timer/workers. smelterUnlocked is stored directly rather than
     re-derived from pathState, so it survives independently of whatever
     shape the surroundedmountains path's save entry takes.
     An unclaimed reward needs no key of its own: it is just a
     pathState entry sitting at phase 'claim', and pathState is
     already saved whole under ps. */
  window.OrbWeaver.Save.register(ID,
    () => ({
      d: discovered ? 1 : 0, o: opened ? 1 : 0,
      qp: quarryPhase, qt: quarryTimeRemaining, qn: quarryWorkers,
      su: smelterUnlocked ? 1 : 0,
      sp: smelterPhase, st: smelterTimeRemaining, sn: smelterWorkers,
      ap: activePaths.slice(), ps: pathState, pst: pathStubs.slice()
    }),
    (d) => {
      opened = !!d.o;
      quarryPhase = d.qp || 'idle';
      quarryTimeRemaining = d.qt != null ? d.qt : QUARRY_BUILD_TIME;
      quarryWorkers = d.qn || 0;
      smelterUnlocked = !!d.su;
      smelterPhase = d.sp || 'idle';
      smelterTimeRemaining = d.st != null ? d.st : SMELTER_BUILD_TIME;
      smelterWorkers = d.sn || 0;
      activePaths = d.ap && d.ap.length ? d.ap : ['hike'];
      pathState = d.ps && Object.keys(d.ps).length ? d.ps : {};
      if (!pathState.hike && activePaths.includes('hike')) initPathState('hike');
      activePaths.forEach((id) => { if (!pathState[id]) initPathState(id); });
      pathStubs = d.pst || [];
      if (d.d) reveal();
    });

  window.OrbWeaver.Mechanics.register(mechanic);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mtn-action]');
    if (!btn) return;
    if (btn.dataset.mtnAction === 'start-quarry' && quarryPhase === 'idle') {
      const wood = window.OrbWeaver.Resources.available(WOOD_ID);
      const stone = window.OrbWeaver.Resources.available(STONE_ID);
      if (wood < QUARRY_WOOD_COST || stone < QUARRY_STONE_COST) return;
      window.OrbWeaver.Resources.spend(WOOD_ID, QUARRY_WOOD_COST);
      window.OrbWeaver.Resources.spend(STONE_ID, QUARRY_STONE_COST);
      quarryPhase = 'building';
      quarryTimeRemaining = QUARRY_BUILD_TIME;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'cancel-quarry' && quarryPhase === 'building') {
      window.OrbWeaver.Resources.add(WOOD_ID, QUARRY_WOOD_COST);
      window.OrbWeaver.Resources.add(STONE_ID, QUARRY_STONE_COST);
      quarryPhase = 'idle';
      quarryWorkers = 0;
      quarryTimeRemaining = QUARRY_BUILD_TIME;
      window.OrbWeaver.Footer.push('Canceled Stone Quarry. Refunded.');
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'start-smelter' && smelterUnlocked && smelterPhase === 'idle') {
      const wood = window.OrbWeaver.Resources.available(WOOD_ID);
      if (wood < SMELTER_WOOD_COST) return;
      window.OrbWeaver.Resources.spend(WOOD_ID, SMELTER_WOOD_COST);
      smelterPhase = 'building';
      smelterTimeRemaining = SMELTER_BUILD_TIME;
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'cancel-smelter' && smelterPhase === 'building') {
      window.OrbWeaver.Resources.add(WOOD_ID, SMELTER_WOOD_COST);
      smelterPhase = 'idle';
      smelterWorkers = 0;
      smelterTimeRemaining = SMELTER_BUILD_TIME;
      window.OrbWeaver.Footer.push('Canceled Smelter Shack. Refunded.');
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    } else if (btn.dataset.mtnAction === 'claim') {
      const id = btn.dataset.mtnClaim;
      if (!claim(id)) return;
      // Wheat Field, Gold Panning and Collapsed Path close the modal on claim instead of
      // refreshing it in place; every other reward path still refreshes.
      if (id === 'wheatfield' || id === 'surroundedmountains' || id === 'blockedexit') {
        window.OrbWeaver.Cards.closeModal();
      } else {
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }
    }
  });

  // Instant: no workers, no build timer. Reveals the granted cards and
  // drops the finished travel section that carried the button. False
  // when there is nothing to claim (a stale button can't re-grant).
  function claim(id) {
    const def = TRAVEL_PATHS[id];
    if (!def || !def.grants || !pathState[id] || pathState[id].phase !== 'claim') return false;
    def.grants.cards.forEach((cardId) =>
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get(cardId)));
    if (def.grants.onClaim) def.grants.onClaim();
    pathState[id].phase = 'done';
    window.OrbWeaver.Footer.push(def.grants.msg);
    return true;
  }

  // Cheat (Loc 2): every Mountains build finished and every travel path
  // walked and claimed, through the same completion effects play uses
  // (card reveals, stubs, onReady/onClaim). Already-finished parts are
  // left as they are, so pressing it twice changes nothing.
  function cheatFinishAll() {
    stageTrack.completeAll();
    if (quarryPhase !== 'done') {
      quarryPhase = 'done'; quarryTimeRemaining = 0; quarryWorkers = 0;
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('quarry'));
    }
    smelterUnlocked = true;
    if (smelterPhase !== 'done') {
      smelterPhase = 'done'; smelterTimeRemaining = 0; smelterWorkers = 0;
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('smeltershack'));
    }
    while (activePaths.length) {
      const id = activePaths.shift(), def = TRAVEL_PATHS[id], st = pathState[id];
      st.progress = pathTotalTime(id); st.workers = 0; st.phase = def.grants ? 'claim' : 'done';
      def.reveals.forEach((childId) => { initPathState(childId); activePaths.push(childId); });
      pathStubs.push(...def.stubs);
      if (def.grants && def.grants.onReady) def.grants.onReady();
    }
    Object.keys(pathState).forEach(claim);
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  window.OrbWeaver.Mountains = {
    id: ID, label: 'Mountains', prefix: PREFIX, woodId: WOOD_ID, stoneId: STONE_ID, workerPool: pool,
    initWorkersRow, addWorkers: (n) => pool.addWorkers(n), ensureResource, reveal, isDiscovered: () => discovered, cheatFinishAll
  };
  window.OrbWeaver.Locations.register(window.OrbWeaver.Mountains);
})();
