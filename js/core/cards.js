/* ============================================================
   CORE: REAL CARD BUILDER
   Generic card-building + modal-wiring for real (non-placeholder)
   mechanic cards. Mirrors placeholders.js's buildCard, but reads
   live game state instead of static demo text, and never carries
   the .placeholder-marker class — so it stays visible even when the
   placeholder toggle is off.

   A mechanic may optionally define:
     mechanic.startHidden      — card starts hidden, shown via Cards.reveal()
     mechanic.onOpen()         — called once when the card is first clicked
     mechanic.getBuildBarPct() — adds a second (bottom) progress bar
     mechanic.upgradeTrackKey / mechanic.buildTrackKey — data-track
       values used to find the right bar inside a multi-track modal
   None of these are required — Wood/Stone define none of them and
   behave exactly as before.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  let openModalMechanicId = null;

  /* RENDER SUSPENSION
     Mechanics call Cards.refresh() from inside their own tick(), so
     "simulate" and "draw" are entangled. Rather than rewrite every
     mechanic, refresh() checks this flag and returns immediately when
     drawing is off. The loop switches it off while running many ticks
     back-to-back (live catch-up, and later offline replay) and calls
     refreshAll() once at the end — so 86,400 ticks of offline progress
     cost one repaint instead of 86,400. */
  let renderEnabled = true;
  function setRenderEnabled(v) { renderEnabled = !!v; }
  function refreshAll() {
    window.OrbWeaver.Mechanics.all().forEach((m) => { if (m.els) refresh(m); });
  }

  /* GHOST-CLICK GUARD (mobile)
     A tap that closes the modal can have its synthesized follow-up
     click dispatched AFTER the modal is gone — the browser then
     hit-tests the card now sitting under the finger and opens it.
     Switching the action listener to 'click' stopped one flavor of
     this, but touch event synthesis can still deliver a second event
     once the target is removed. Rather than chase each flavor, we
     time-gate it: any card click within GHOST_MS of a modal close
     came from the same tap and is discarded. Also stops the double-
     fire that made the collapse arrow feel unresponsive (toggle open,
     immediately toggle shut). */
  const GHOST_MS = 130;
  let modalClosedAt = 0;
  function markModalClosed() { modalClosedAt = performance.now(); }
  function isGhostClick() { return performance.now() - modalClosedAt < GHOST_MS; }

  /* .worker-desc's natural width changes every tick as its text changes,
     which shifts #card-modal-header-left's width and bumps the centered
     .modal-title. We commit to a fixed `width` (not min-width — a floor
     alone can't stop growth) sized to the text plus a pad, and only
     re-commit when the text either outgrows the current box or shrinks
     far enough to leave a large gap. Small changes reuse the existing
     box and never touch the title. Canvas measureText is used instead
     of scrollWidth for a measurement that doesn't depend on the
     element's own current box/layout state. Resets on modal reopen. */
  const WORKER_DESC_BUFFER_PX = 20;
  let measureCtx = null;
  function measureTextWidth(el, text) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = getComputedStyle(el).font;
    return measureCtx.measureText(text).width;
  }
  function applyWorkerDescWidth(desc) {
    const natural = measureTextWidth(desc, desc.textContent);
    const committed = parseFloat(desc.dataset.committedW);
    if (isNaN(committed) || natural > committed || natural < committed - WORKER_DESC_BUFFER_PX) {
      const padded = natural + WORKER_DESC_BUFFER_PX;
      desc.dataset.committedW = padded;
      desc.style.width = padded + 'px';
    }
  }

  // Every location has its own worker pool (Camp's is the default); a
  // mechanic living on another pool sets mechanic.workerPool.
  function pool(mechanic) { return mechanic.workerPool || window.OrbWeaver.Workers; }

  function addHoldBehavior(btn, action) {
    let initialTimer = null, repeatTimer = null, holdStart = null;
    function stop() {
      clearTimeout(initialTimer); clearInterval(repeatTimer);
      initialTimer = repeatTimer = holdStart = null;
    }
    function fire() { if (!btn.disabled) action(); else stop(); }
    btn.addEventListener('pointerdown', () => {
      fire();
      holdStart = Date.now();
      initialTimer = setTimeout(() => {
        repeatTimer = setInterval(() => {
          if (Date.now() - holdStart >= 1800) {
            clearInterval(repeatTimer);
            repeatTimer = setInterval(fire, 20);
          }
          fire();
        }, 50);
      }, 600);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
  }

  function makeStepperSet(mechanic, isModal) {
    const wrap = document.createElement('div');
    wrap.className = 'card-steppers visible';
    wrap.innerHTML = `
      <button class="card-stepper-btn stepper-minus">–</button>
      <span class="card-stepper-val">0</span>
      <button class="card-stepper-btn stepper-plus">+</button>`;

    // Shared helper — keeps both lock buttons in sync whenever either is clicked.
    function applyLock(locked) {
      mechanic.locked = locked;
      if (mechanic.els && mechanic.els.cardFaceLock) {
        mechanic.els.cardFaceLock.style.display = locked ? '' : 'none';
      }
      if (mechanic.els && mechanic.els.modalSteppers) {
        const ml = mechanic.els.modalSteppers.querySelector('.card-lock-btn');
        if (ml) { ml.classList.toggle('locked', locked); ml.textContent = locked ? '🔒' : '🔓'; }
      }
    }

    if (isModal) {
      const lock = document.createElement('button');
      lock.className = 'card-lock-btn';
      lock.title = 'Lock workers on this card (excludes from recall)';
      lock.addEventListener('click', () => applyLock(!mechanic.locked));
      lock.textContent = mechanic.locked ? '🔒' : '🔓';
      lock.classList.toggle('locked', !!mechanic.locked);
      wrap.appendChild(lock);
      if (mechanic.getWorkerDesc) {
        const desc = document.createElement('span');
        desc.className = 'worker-desc';
        desc.textContent = mechanic.getWorkerDesc();
        wrap.appendChild(desc);
        applyWorkerDescWidth(desc);
      }
    } else {
      // Card-face lock: only visible when locked, 🔒 only, clicking unlocks.
      const faceLock = document.createElement('button');
      faceLock.className = 'card-lock-btn card-face-lock';
      faceLock.title = 'Locked — click to unlock';
      faceLock.textContent = '🔒';
      faceLock.style.display = mechanic.locked ? '' : 'none';
      faceLock.addEventListener('click', (e) => { e.stopPropagation(); applyLock(false); });
      wrap.appendChild(faceLock);
      if (mechanic.els) mechanic.els.cardFaceLock = faceLock;
      else mechanic._pendingFaceLock = faceLock;
    }
    const plus = wrap.querySelector('.stepper-plus');
    const minus = wrap.querySelector('.stepper-minus');
    addHoldBehavior(plus, () => pool(mechanic).assign(mechanic.id));
    addHoldBehavior(minus, () => pool(mechanic).unassign(mechanic.id));
    return wrap;
  }

  // Drives one or two progress bars (card face + open modal) per mechanic
  // via a single requestAnimationFrame loop, easing toward each bar's true
  // target every frame instead of snapping once per tick.
  function startSmoothing(mechanic) {
    const specs = [{ getPct: mechanic.getUpgradeBarPct, el: mechanic.els.upgradeBar, track: mechanic.upgradeTrackKey || null, key: 'shownPct' }];
    if (mechanic.getBuildBarPct && mechanic.els.buildBar) {
      specs.push({ getPct: mechanic.getBuildBarPct, el: mechanic.els.buildBar, track: mechanic.buildTrackKey || null, key: 'shownBuildPct' });
    }
    const state = specs.map(() => ({ shown: 0, from: 0, to: 0, start: performance.now(), dur: window.OrbWeaver.Loop.getIntervalMs() }));

    function frame(now) {
      specs.forEach((spec, i) => {
        const s = state[i];
        const target = spec.getPct();
        if (target !== s.to) { s.from = s.shown; s.to = target; s.start = now; s.dur = window.OrbWeaver.Loop.getIntervalMs(); }
        const t = s.dur > 0 ? Math.min(1, (now - s.start) / s.dur) : 1;
        s.shown = s.from + (s.to - s.from) * t;
        mechanic.els[spec.key] = s.shown;
        spec.el.style.width = s.shown + '%';
        let modalBar = null;
        if (openModalMechanicId === mechanic.id) {
          // Build bar's modal target can shift between sub-tracks (e.g.
          // Mountains: outpost while building, quarry once outpost is done)
          // — resolved live each frame instead of the static spec.track.
          const liveTrack = (i === 1 && mechanic.getBuildBarTrackKey) ? mechanic.getBuildBarTrackKey() : spec.track;
          const sel = liveTrack
            ? `#card-modal-body .detail-progress-bar[data-track="${liveTrack}"]`
            : '#card-modal-body .detail-progress-bar:not([data-track])';
          modalBar = document.querySelector(sel);
          if (modalBar) modalBar.style.width = s.shown + '%';
        }
        // Top (upgrade) bar only: faded-gold tint while still collecting
        // resources, reverting to its normal color once building starts.
        if (i === 0 && mechanic.isUpgradeCollecting) {
          const collecting = mechanic.isUpgradeCollecting();
          spec.el.classList.toggle('bar-collecting', collecting);
          if (modalBar) modalBar.classList.toggle('bar-collecting', collecting);
        }
        // Bottom (build) bar: optional isBuildBarFaded() dims it while in a
        // "soft active" state (e.g. loading vs traveling for mule cards).
        if (i === 1 && mechanic.isBuildBarFaded) {
          const faded = mechanic.isBuildBarFaded();
          spec.el.classList.toggle('bar-collecting', faded);
          if (modalBar) modalBar.classList.toggle('bar-collecting', faded);
        }
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function build(mechanic) {
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap' + (mechanic.isMule ? ' mule' : '');
    // mechanic.revealed is REAL state the save system reads. Previously
    // "has the player unlocked this card" existed only as a CSS display
    // property, which is not a place to keep game state.
    if (mechanic.revealed == null) mechanic.revealed = !mechanic.startHidden;
    if (!mechanic.revealed) wrap.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const body = document.createElement('div');
    body.className = 'card-body';
    body.innerHTML = `<div class="card-name"></div><div class="card-stat"></div>`;

    const cardSteppers = makeStepperSet(mechanic, false);
    const upgradeBar = document.createElement('div');
    upgradeBar.className = 'card-upgrade-bar';

    card.appendChild(body);
    card.appendChild(cardSteppers);
    card.appendChild(upgradeBar);

    let buildBar = null;
    if (mechanic.getBuildBarPct) {
      buildBar = document.createElement('div');
      buildBar.className = 'card-progress-bar';
      card.appendChild(buildBar);
    }

    wrap.appendChild(card);

    mechanic.els = {
      wrap,
      nameEl: body.querySelector('.card-name'),
      statEl: body.querySelector('.card-stat'),
      cardStepperVal: cardSteppers.querySelector('.card-stepper-val'),
      cardStepperMinus: cardSteppers.querySelector('.stepper-minus'),
      cardStepperPlus: cardSteppers.querySelector('.stepper-plus'),
      cardSteppersWrap: cardSteppers,
      cardFaceLock: mechanic._pendingFaceLock || null,
      upgradeBar,
      buildBar,
      modalSteppers: null
    };
    delete mechanic._pendingFaceLock;

    pool(mechanic).onChange(() => refresh(mechanic));
    startSmoothing(mechanic);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-steppers')) return;
      if (isGhostClick()) return; // same tap that just closed a modal
      openModalMechanicId = mechanic.id;
      if (mechanic.onOpen) mechanic.onOpen();
      // Optional: mechanic.modalWide widens the shared modal for grid-style bodies.
      document.getElementById('card-modal-win').classList.toggle('modal-wide', !!mechanic.modalWide);
      // Optional: mechanic.stepperReady() — a card can start with no
      // steppers at all (e.g. a mule still preparing) and grow them later.
      const ready = !mechanic.stepperReady || mechanic.stepperReady();
      const modalSteppers = ready ? makeStepperSet(mechanic, true) : null;
      mechanic.els.modalSteppers = modalSteppers;
      window.OrbWeaver.openCardModal(mechanic.cardName(), mechanic.renderModalHTML(), modalSteppers, mechanic.getSubtitleHtml ? mechanic.getSubtitleHtml() : '', mechanic.modalTheme);
      if (modalSteppers) refreshModalSteppers(mechanic);
      if (mechanic.afterRender) mechanic.afterRender();
    });

    refresh(mechanic);
    return wrap;
  }

  function reveal(mechanic) {
    if (!mechanic) return;
    mechanic.revealed = true;
    if (mechanic.els && mechanic.els.wrap) {
      const wrap = mechanic.els.wrap;
      wrap.style.display = '';
      wrap.style.visibility = '';
      if (gapObserver) gapObserver.unobserve(wrap);
    }
  }

  // Lazily-created single observer shared by every gap-on-hide card (see
  // mechanic.gapOnHide below) — watches cards that hid themselves while
  // still on-screen, and only collapses their grid slot once they scroll
  // out of view, so a disappearing mule/cart never bumps other cards.
  let gapObserver = null;
  function getGapObserver() {
    if (!gapObserver) {
      gapObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            entry.target.style.display = 'none';
            entry.target.style.visibility = '';
            gapObserver.unobserve(entry.target);
          }
        });
      });
    }
    return gapObserver;
  }

  // Counterpart to reveal() — for a card that can legitimately disappear
  // again after completion (e.g. a mule once its trip is over). Optional
  // mechanic.gapOnHide leaves a blank same-size gap instead of reflowing
  // the grid, but only while the card is actually visible on screen —
  // off-screen cards just collapse immediately like before.
  function hide(mechanic) {
    if (!mechanic) return;
    mechanic.revealed = false;
    if (mechanic.els && mechanic.els.wrap) {
      const wrap = mechanic.els.wrap;
      if (mechanic.gapOnHide) {
        const rect = wrap.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.top < (window.innerHeight || document.documentElement.clientHeight);
        if (visible) { wrap.style.visibility = 'hidden'; getGapObserver().observe(wrap); }
        else wrap.style.display = 'none';
      } else {
        wrap.style.display = 'none';
      }
    }
    if (openModalMechanicId === mechanic.id) closeModal();
  }

  // Pushes mechanic.revealed back onto the DOM. Used after a save load,
  // where the flags are restored first and the DOM must follow them.
  function applyVisibility(mechanic) {
    if (!mechanic || !mechanic.els || !mechanic.els.wrap) return;
    const wrap = mechanic.els.wrap;
    wrap.style.visibility = '';
    wrap.style.display = mechanic.revealed ? '' : 'none';
    if (gapObserver) gapObserver.unobserve(wrap);
  }

  function isModalOpenFor(id) { return openModalMechanicId === id; }

  function refreshModalSteppers(mechanic) {
    const ms = mechanic.els.modalSteppers;
    if (!ms) return;
    const assigned = pool(mechanic).getAssigned(mechanic.id);
    ms.querySelector('.card-stepper-val').textContent = assigned;
    ms.querySelector('.stepper-minus').disabled = assigned === 0;
    ms.querySelector('.stepper-plus').disabled = pool(mechanic).getIdleCount() === 0;
    if (mechanic.getWorkerDesc) {
      const desc = ms.querySelector('.worker-desc');
      if (desc) {
        desc.textContent = mechanic.getWorkerDesc();
        applyWorkerDescWidth(desc);
      }
    }
  }

  function applyShownBar(mechanic, shown, trackKey) {
    if (shown == null) return;
    const sel = trackKey
      ? `#card-modal-body .detail-progress-bar[data-track="${trackKey}"]`
      : '#card-modal-body .detail-progress-bar:not([data-track])';
    const bar = document.querySelector(sel);
    if (bar) bar.style.width = shown + '%';
  }

  // Patch the live modal DOM without rebuilding it — only the text nodes
  // that change every tick. Full rebuild only happens when the modal first
  // opens or a structural change occurs (upgrade completes, sale starts/ends).
  function patchOpenModal(mechanic) {
    if (mechanic.patchUpgradeCost) {
      const val = mechanic.patchUpgradeCost();
      if (val != null) {
        const costEl = document.querySelector('#card-modal-body .hs-card:not(.locked) .upgrade-cost');
        if (costEl) costEl.innerHTML = val;
        const subEl = document.querySelector('#card-modal-body .hs-card:not(.locked) .upgrade-cost-part');
        if (subEl) subEl.innerHTML = val;
      }
    }
    if (mechanic.patchCollectPct) {
      const pct = mechanic.patchCollectPct();
      const btn = document.querySelector('#card-modal-body .hs-card:not(.locked) .collect-btn');
      if (btn) btn.style.setProperty('--collect-pct', pct + '%');
    }
    const statusEl = document.querySelector('#card-modal-body .detail-status span:first-child');
    if (statusEl && mechanic.patchBuildStatus) {
      const s = mechanic.patchBuildStatus();
      if (s != null) statusEl.textContent = s;
    }
    if (mechanic.patchLiveTrack) mechanic.patchLiveTrack();
    const titleEl = document.getElementById('card-modal-title');
    if (titleEl) titleEl.textContent = mechanic.cardName();
  }

  // Full rebuild: used only on first open or after a state change that
  // alters structure (new buttons, new rows). NOT called every tick.
  function rebuildOpenModal(mechanic) {
    window.OrbWeaver.openCardModal(mechanic.cardName(), mechanic.renderModalHTML(), mechanic.els.modalSteppers, mechanic.getSubtitleHtml ? mechanic.getSubtitleHtml() : '', mechanic.modalTheme);
    applyShownBar(mechanic, mechanic.els.shownPct, mechanic.upgradeTrackKey);
    applyShownBar(mechanic, mechanic.els.shownBuildPct, mechanic.buildTrackKey);
    if (mechanic.afterRender) mechanic.afterRender();
  }

  function refresh(mechanic) {
    if (!renderEnabled) return;
    const assigned = pool(mechanic).getAssigned(mechanic.id);
    mechanic.els.nameEl.textContent = mechanic.cardName();
    mechanic.els.statEl.textContent = mechanic.getStatText();
    mechanic.els.cardStepperVal.textContent = assigned;
    mechanic.els.cardStepperMinus.disabled = assigned === 0;
    mechanic.els.cardStepperPlus.disabled = pool(mechanic).getIdleCount() === 0;
    // Optional: mechanic.stepperReady() — hide the face steppers entirely
    // until the card says it's ready for them (see makeStepperSet/click).
    if (mechanic.stepperReady) mechanic.els.cardSteppersWrap.style.display = mechanic.stepperReady() ? '' : 'none';
    if (mechanic.hideUpgradeBar && mechanic.els.upgradeBar) mechanic.els.upgradeBar.style.display = mechanic.hideUpgradeBar() ? 'none' : '';
    if (mechanic.hideBuildBar && mechanic.els.buildBar) mechanic.els.buildBar.style.display = mechanic.hideBuildBar() ? 'none' : '';
    // Optional: mechanic.isMuted() — a dimmed-but-still-clickable state.
    if (mechanic.isMuted) mechanic.els.wrap.classList.toggle('card-pending', mechanic.isMuted());
    // Sync card-face lock icon visibility with current locked state.
    if (mechanic.els.cardFaceLock) mechanic.els.cardFaceLock.style.display = mechanic.locked ? '' : 'none';
    refreshModalSteppers(mechanic);
    if (openModalMechanicId === mechanic.id) patchOpenModal(mechanic);
  }

  /* The stepper set built for a modal is thrown away when the modal
     closes, but mechanic.els.modalSteppers kept pointing at the now-
     detached DOM — so refreshModalSteppers() went on querying and
     measuring dead nodes every tick, for every card ever opened, and
     the detached nodes could never be collected. Cleared on close. */
  function dropModalSteppers(id) {
    const m = id && window.OrbWeaver.Mechanics.get(id);
    if (m && m.els) m.els.modalSteppers = null;
  }

  function closeModal() {
    dropModalSteppers(openModalMechanicId);
    openModalMechanicId = null;
    window.OrbWeaver.openCardModal('', '', null);
    document.getElementById('card-modal-scrim').classList.remove('open');
    markModalClosed();
  }

  function refreshOpenModal(mechanicId) {
    if (openModalMechanicId !== mechanicId) return;
    const mechanic = window.OrbWeaver.Mechanics.get(mechanicId);
    if (mechanic) rebuildOpenModal(mechanic);
  }

  // Stop treating the modal as "open" once it's closed, so we don't
  // keep re-rendering it every tick after the player closes it.
  document.addEventListener('click', (e) => {
    if (e.target.id === 'card-modal-close' || e.target.id === 'card-modal-scrim') {
      dropModalSteppers(openModalMechanicId);
      openModalMechanicId = null;
      markModalClosed();
    }
  });

  window.OrbWeaver.Cards = { build, refresh, refreshAll, setRenderEnabled, applyVisibility, refreshOpenModal, reveal, hide, closeModal, isGhostClick, isModalOpenFor, addHoldBehavior };
})();
