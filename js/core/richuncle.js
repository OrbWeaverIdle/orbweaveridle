/* ============================================================
   CORE: RICH UNCLE (reusable tutorial/bonus card factory)
   RichUncle.create(config) builds one card that watches a small,
   data-driven list of "steps" — each with its own trigger, optional
   read-and-check sentences, a worker-driven build timer, and a gold
   reward. Only one step is ever active at a time; while idle, every
   tick scans config.steps in order for the first one whose trigger()
   currently returns true. A step's `checks` sentences (if any) gate
   worker assignment via the shared canAssign() hook (see cards.js) —
   empty/omitted checks means assignable the instant the step appears.
   Card face never shows a build-bar-driven countdown text, only each
   step's own static faceIdle/faceBuilding strings, per design.

   config: {
     id, cardName (optional, defaults 'Rich Uncle'), section (optional,
     cosmetic only), workerPool (optional, defaults to Camp's pool),
     steps: [{
       id, trigger(), repeatable (bool),
       abortCondition() — optional; forcibly cancels an ALREADY-ACTIVE
         step with no reward and no doneForever bookkeeping (e.g.
         handing off from a Camp copy to a Mountains copy the instant
         Mountains is discovered),
       message (string, shown in the modal), checks (array of
         sentence strings, default []), buildTime (seconds),
       reward (gold), faceIdle (card-face text pre-assignment, checks
         incomplete), faceReady (optional — checks all complete but no
         worker yet; falls back to faceIdle if omitted, so a step with
         no checks doesn't need to define it), faceBuilding (static
         card-face text while building)
     }, ...]
   }

   Adding a future step to an existing instance, or a future location
   entirely, is one more table entry / one more create() call — no
   changes here.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  // Settings > "Rich Uncle Tutorial" — one shared switch for every
  // instance this factory creates (Camp and Mountains both read this
  // same flag, not a copy each). Persisted, off by default. Toggling
  // off only blocks the trigger SCAN below from starting anything new
  // — an already-active step (handled entirely in the tick() branches
  // below this) keeps running and still pays out, same as every other
  // mechanic's "no takebacks mid-build" convention.
  let enabled = false;
  const enableToggle = document.getElementById('richuncle-toggle');
  if (enableToggle) {
    enableToggle.addEventListener('click', () => {
      enabled = !enabled;
      enableToggle.classList.toggle('on', enabled);
    });
  }
  window.OrbWeaver.Save.register('richuncle_enabled',
    () => ({ e: enabled }),
    (d) => {
      enabled = !!(d && d.e);
      if (enableToggle) enableToggle.classList.toggle('on', enabled);
    });

  function create(config) {
    const ID = config.id;
    const steps = config.steps;

    let activeStep = null;
    let checks = {};          // index -> bool, scoped to the current active step
    let buildRemaining = null;
    let doneForever = new Set();

    // Reads mechanic.workerPool live, not config.workerPool captured at
    // create() time — main.js assigns the Mountains pool onto the
    // mechanic object AFTER this factory returns (same pattern
    // goldpanning.js/smeltershack.js use), so a frozen config value
    // would miss that assignment entirely.
    function pool() { return mechanic.workerPool || window.OrbWeaver.Workers; }

    function canAssign() {
      if (!activeStep) return false;
      const list = activeStep.checks || [];
      for (let i = 0; i < list.length; i++) { if (!checks[i]) return false; }
      return true;
    }

    function buildPct() {
      if (!activeStep || buildRemaining == null) return 0;
      return ((activeStep.buildTime - buildRemaining) / activeStep.buildTime) * 100;
    }

    function activate(step) {
      activeStep = step;
      checks = {};
      buildRemaining = step.buildTime;
      window.OrbWeaver.Cards.reveal(mechanic);
    }

    // withReward:false is the abort path (no payout, no doneForever) —
    // used when abortCondition() fires on an in-progress step.
    function deactivate(withReward) {
      const step = activeStep;
      const assigned = pool().getAssigned(ID);
      for (let i = 0; i < assigned; i++) pool().unassign(ID);
      if (withReward && step) {
        window.OrbWeaver.Resources.add('gold', step.reward);
        window.OrbWeaver.Footer.push(`Rich Uncle hands over ${step.reward} gold.`);
        if (!step.repeatable) doneForever.add(step.id);
      }
      activeStep = null;
      checks = {};
      buildRemaining = null;
      window.OrbWeaver.Cards.hide(mechanic);
    }

    function renderModalHTML() {
      if (!activeStep) return '';
      const msg = `<p class="ru-message">${activeStep.message}</p>`;
      const list = activeStep.checks || [];
      const checksHtml = list.length
        ? `<div class="ru-checks">${list.map((sentence, i) => `
          <label class="ru-check-row">
            <input type="checkbox" class="ru-check-input" data-ru-check="${i}"${checks[i] ? ' checked' : ''}>
            <span>${sentence}</span>
          </label>`).join('')}</div>`
        : '';
      const secs = Math.ceil(buildRemaining != null ? buildRemaining : activeStep.buildTime);
      const pct = buildPct().toFixed(1);
      const buildHtml = `<div class="detail-progress-wrap"><div class="detail-progress-bar" style="width:${pct}%"></div></div>
        <div class="detail-status"><span data-ru-timer>${secs}s remaining</span></div>`;
      return `<div class="ru-modal">${msg}${checksHtml}${buildHtml}</div>`;
    }

    const mechanic = {
      id: ID,
      section: config.section,
      workerPool: config.workerPool,
      startHidden: true,
      cardThemeClass: 'richuncle',
      modalTheme: 'theme-richuncle',
      upkeepExempt: true,
      canAssign,
      cardName: () => config.cardName || 'Rich Uncle',
      getStatText() {
        if (!activeStep) return '';
        if (pool().getAssigned(ID) > 0) return activeStep.faceBuilding;
        return canAssign() ? (activeStep.faceReady || activeStep.faceIdle) : activeStep.faceIdle;
      },
      getUpgradeBarPct: () => 0,
      getBuildBarPct: buildPct,
      getWorkerDesc() {
        const assigned = pool().getAssigned(ID);
        if (!activeStep || assigned === 0) return '';
        return `${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, 1, 1, 0))}/s`;
      },
      renderModalHTML,
      patchLiveTrack() {
        if (!activeStep) return;
        const el = document.querySelector('#card-modal-body [data-ru-timer]');
        if (el) el.textContent = `${Math.ceil(buildRemaining != null ? buildRemaining : activeStep.buildTime)}s remaining`;
      },
      afterRender() {
        const body = document.getElementById('card-modal-body');
        if (!body) return;
        body.querySelectorAll('[data-ru-check]').forEach((input) => {
          input.addEventListener('change', () => { checks[input.dataset.ruCheck] = input.checked; });
        });
      },
      // upkeepExempt: true — goldAvailable is ignored entirely (same
      // convention as goldpanning.js).
      tick(goldAvailable, tickRate) {
        if (!activeStep) {
          if (enabled) {
            for (let i = 0; i < steps.length; i++) {
              const step = steps[i];
              if (doneForever.has(step.id)) continue;
              if (step.trigger()) { activate(step); break; }
            }
          }
        } else if (activeStep.abortCondition && activeStep.abortCondition()) {
          deactivate(false);
        } else {
          const assigned = pool().getAssigned(ID);
          if (assigned > 0 && canAssign()) {
            const rate = window.OrbWeaver.Upgrades.workerRate(assigned, 1, 1, 0);
            buildRemaining -= rate * tickRate;
            if (buildRemaining <= 0) { deactivate(true); return; }
          }
        }
        window.OrbWeaver.Cards.refresh(mechanic);
      }
    };

    /* ---- Save/load ----
       Which step (if any) is active, its checkbox states, its build
       progress, and every non-repeatable step this instance has ever
       finished. A save with no blob for this id (new instance, or an
       existing save from before this feature existed) restores to a
       clean slate — the next tick's trigger scan then fires naturally
       if conditions already qualify (continuous check, not edge-
       triggered), so an existing save picks this up retroactively. */
    window.OrbWeaver.Save.register(ID,
      () => ({
        a: activeStep ? activeStep.id : null,
        c: Object.assign({}, checks),
        r: buildRemaining,
        d: Array.from(doneForever)
      }),
      (d) => {
        doneForever = new Set(d && d.d ? d.d : []);
        checks = d && d.c ? Object.assign({}, d.c) : {};
        buildRemaining = d && d.r != null ? d.r : null;
        const savedId = d && d.a;
        activeStep = savedId ? (steps.find((s) => s.id === savedId) || null) : null;
        if (activeStep) window.OrbWeaver.Cards.reveal(mechanic);
      });

    window.OrbWeaver.Mechanics.register(mechanic);
    return mechanic;
  }

  window.OrbWeaver.RichUncle = { create };
})();
