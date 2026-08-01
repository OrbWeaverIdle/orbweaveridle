/* ============================================================
   CORE: REAL CARD BUILDER
   Generic card-building + modal-wiring for real (non-placeholder)
   mechanic cards. Mirrors placeholders.js's buildCard, but reads
   live game state instead of static demo text, and never carries
   the .placeholder-marker class — so it stays visible even when the
   placeholder toggle is off.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  let openModalMechanicId = null;

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
    }
    const plus = wrap.querySelector('.stepper-plus');
    const minus = wrap.querySelector('.stepper-minus');
    addHoldBehavior(plus, () => window.OrbWeaver.Workers.assign(mechanic.id));
    addHoldBehavior(minus, () => window.OrbWeaver.Workers.unassign(mechanic.id));
    return wrap;
  }

  // Smoothly eases a bar's displayed width toward its true target every
  // animation frame, rather than snapping once per tick (which is what
  // caused visible jitter). Interpolation duration matches the current
  // tick interval so motion still tracks the speed cheat correctly.
  function startSmoothing(mechanic) {
    let shown = 0, from = 0, to = 0, start = performance.now(), dur = window.OrbWeaver.Loop.getIntervalMs();
    function frame(now) {
      const target = mechanic.getUpgradeBarPct();
      if (target !== to) {
        from = shown; to = target; start = now; dur = window.OrbWeaver.Loop.getIntervalMs();
      }
      const t = dur > 0 ? Math.min(1, (now - start) / dur) : 1;
      shown = from + (to - from) * t;
      mechanic.els.shownPct = shown;
      mechanic.els.upgradeBar.style.width = shown + '%';
      if (openModalMechanicId === mechanic.id) {
        const modalBar = document.querySelector('#card-modal-body .detail-progress-bar');
        if (modalBar) modalBar.style.width = shown + '%';
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function build(mechanic) {
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap';

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
    wrap.appendChild(card);

    // Modal steppers: rebuilt each open so they're always fresh DOM nodes.
    mechanic.els = {
      nameEl: body.querySelector('.card-name'),
      statEl: body.querySelector('.card-stat'),
      cardStepperVal: cardSteppers.querySelector('.card-stepper-val'),
      cardStepperMinus: cardSteppers.querySelector('.stepper-minus'),
      cardStepperPlus: cardSteppers.querySelector('.stepper-plus'),
      upgradeBar,
      modalSteppers: null
    };

    window.OrbWeaver.Workers.onChange(() => refresh(mechanic));
    startSmoothing(mechanic);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-steppers')) return;
      openModalMechanicId = mechanic.id;
      const modalSteppers = makeStepperSet(mechanic, true);
      mechanic.els.modalSteppers = modalSteppers;
      window.OrbWeaver.openCardModal(mechanic.cardName(), mechanic.renderModalHTML(), modalSteppers);
      refreshModalSteppers(mechanic);
    });

    refresh(mechanic);
    return wrap;
  }

  function refreshModalSteppers(mechanic) {
    const ms = mechanic.els.modalSteppers;
    if (!ms) return;
    const assigned = window.OrbWeaver.Workers.getAssigned(mechanic.id);
    ms.querySelector('.card-stepper-val').textContent = assigned;
    ms.querySelector('.stepper-minus').disabled = assigned === 0;
    ms.querySelector('.stepper-plus').disabled = window.OrbWeaver.Workers.getIdleCount() === 0;
  }

  function refresh(mechanic) {
    const assigned = window.OrbWeaver.Workers.getAssigned(mechanic.id);
    mechanic.els.nameEl.textContent = mechanic.cardName();
    mechanic.els.statEl.textContent = mechanic.getStatText();
    mechanic.els.cardStepperVal.textContent = assigned;
    mechanic.els.cardStepperMinus.disabled = assigned === 0;
    mechanic.els.cardStepperPlus.disabled = window.OrbWeaver.Workers.getIdleCount() === 0;
    refreshModalSteppers(mechanic);
    if (openModalMechanicId === mechanic.id) {
      window.OrbWeaver.openCardModal(mechanic.cardName(), mechanic.renderModalHTML(), mechanic.els.modalSteppers);
      const modalBar = document.querySelector('#card-modal-body .detail-progress-bar');
      if (modalBar && mechanic.els.shownPct != null) modalBar.style.width = mechanic.els.shownPct + '%';
    }
  }

  function refreshOpenModal(mechanicId) {
    const mechanic = window.OrbWeaver.Mechanics.get(mechanicId);
    if (mechanic) refresh(mechanic);
  }

  // Stop treating the modal as "open" once it's closed, so we don't
  // keep re-rendering it every tick after the player closes it.
  document.addEventListener('click', (e) => {
    if (e.target.id === 'card-modal-close' || e.target.id === 'card-modal-scrim') {
      openModalMechanicId = null;
    }
  });

  window.OrbWeaver.Cards = { build, refresh, refreshOpenModal };
})();
