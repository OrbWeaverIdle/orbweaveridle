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
  const GHOST_MS = 500;
  let modalClosedAt = 0;
  function markModalClosed() { modalClosedAt = performance.now(); }
  function isGhostClick() { return performance.now() - modalClosedAt < GHOST_MS; }

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
    if (isModal) {
      const lock = document.createElement('button');
      lock.className = 'card-lock-btn';
      lock.title = 'Lock workers on this card (excludes from recall)';
      lock.addEventListener('click', () => {
        mechanic.locked = !mechanic.locked;
        lock.classList.toggle('locked', mechanic.locked);
        lock.textContent = mechanic.locked ? '🔒' : '🔓';
      });
      lock.textContent = mechanic.locked ? '🔒' : '🔓';
      lock.classList.toggle('locked', !!mechanic.locked);
      wrap.appendChild(lock);
      if (mechanic.getWorkerDesc) {
        const desc = document.createElement('span');
        desc.className = 'worker-desc';
        desc.textContent = mechanic.getWorkerDesc();
        wrap.appendChild(desc);
      }
    }
    const plus = wrap.querySelector('.stepper-plus');
    const minus = wrap.querySelector('.stepper-minus');
    addHoldBehavior(plus, () => window.OrbWeaver.Workers.assign(mechanic.id));
    addHoldBehavior(minus, () => window.OrbWeaver.Workers.unassign(mechanic.id));
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
        if (openModalMechanicId === mechanic.id) {
          const sel = spec.track
            ? `#card-modal-body .detail-progress-bar[data-track="${spec.track}"]`
            : '#card-modal-body .detail-progress-bar:not([data-track])';
          const modalBar = document.querySelector(sel);
          if (modalBar) modalBar.style.width = s.shown + '%';
        }
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function build(mechanic) {
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap';
    if (mechanic.startHidden) wrap.style.display = 'none';

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
      upgradeBar,
      buildBar,
      modalSteppers: null
    };

    window.OrbWeaver.Workers.onChange(() => refresh(mechanic));
    startSmoothing(mechanic);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-steppers')) return;
      if (isGhostClick()) return; // same tap that just closed a modal
      openModalMechanicId = mechanic.id;
      if (mechanic.onOpen) mechanic.onOpen();
      // Optional: mechanic.modalWide widens the shared modal for grid-style bodies.
      document.getElementById('card-modal-win').classList.toggle('modal-wide', !!mechanic.modalWide);
      const modalSteppers = makeStepperSet(mechanic, true);
      mechanic.els.modalSteppers = modalSteppers;
      window.OrbWeaver.openCardModal(mechanic.cardName(), mechanic.renderModalHTML(), modalSteppers, mechanic.getSubtitleHtml ? mechanic.getSubtitleHtml() : '');
      refreshModalSteppers(mechanic);
    });

    refresh(mechanic);
    return wrap;
  }

  function reveal(mechanic) {
    if (mechanic && mechanic.els && mechanic.els.wrap) mechanic.els.wrap.style.display = '';
  }

  function refreshModalSteppers(mechanic) {
    const ms = mechanic.els.modalSteppers;
    if (!ms) return;
    const assigned = window.OrbWeaver.Workers.getAssigned(mechanic.id);
    ms.querySelector('.card-stepper-val').textContent = assigned;
    ms.querySelector('.stepper-minus').disabled = assigned === 0;
    ms.querySelector('.stepper-plus').disabled = window.OrbWeaver.Workers.getIdleCount() === 0;
    if (mechanic.getWorkerDesc) {
      const desc = ms.querySelector('.worker-desc');
      if (desc) desc.textContent = mechanic.getWorkerDesc();
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
        const costEl = document.querySelector('#card-modal-body .upgrade-row:not(.locked) .upgrade-cost');
        if (costEl) costEl.innerHTML = val;
        const subEl = document.querySelector('#card-modal-body .upgrade-row:not(.locked) .upgrade-cost-part');
        if (subEl) subEl.innerHTML = val;
      }
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
    window.OrbWeaver.openCardModal(mechanic.cardName(), mechanic.renderModalHTML(), mechanic.els.modalSteppers, mechanic.getSubtitleHtml ? mechanic.getSubtitleHtml() : '');
    applyShownBar(mechanic, mechanic.els.shownPct, mechanic.upgradeTrackKey);
    applyShownBar(mechanic, mechanic.els.shownBuildPct, mechanic.buildTrackKey);
  }

  function refresh(mechanic) {
    const assigned = window.OrbWeaver.Workers.getAssigned(mechanic.id);
    mechanic.els.nameEl.textContent = mechanic.cardName();
    mechanic.els.statEl.textContent = mechanic.getStatText();
    mechanic.els.cardStepperVal.textContent = assigned;
    mechanic.els.cardStepperMinus.disabled = assigned === 0;
    mechanic.els.cardStepperPlus.disabled = window.OrbWeaver.Workers.getIdleCount() === 0;
    refreshModalSteppers(mechanic);
    if (openModalMechanicId === mechanic.id) patchOpenModal(mechanic);
  }

  function closeModal() {
    openModalMechanicId = null;
    window.OrbWeaver.openCardModal('', '', null);
    document.getElementById('card-modal-scrim').classList.remove('open');
    markModalClosed();
  }

  function refreshOpenModal(mechanicId) {
    const mechanic = window.OrbWeaver.Mechanics.get(mechanicId);
    if (mechanic) rebuildOpenModal(mechanic);
  }

  // Stop treating the modal as "open" once it's closed, so we don't
  // keep re-rendering it every tick after the player closes it.
  document.addEventListener('click', (e) => {
    if (e.target.id === 'card-modal-close' || e.target.id === 'card-modal-scrim') {
      openModalMechanicId = null;
      markModalClosed();
    }
  });

  window.OrbWeaver.Cards = { build, refresh, refreshOpenModal, reveal, closeModal, isGhostClick };
})();
