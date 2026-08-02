/* ============================================================
   ORB WEAVER — CORE SHELL LOGIC
   This file only knows about the UI shell itself: opening/closing
   modals, collapsing sections, and the settings menu. It has zero
   game-mechanics knowledge and zero game state. Real mechanics get
   built on top of this later.
   ============================================================ */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  /* ---------------- Generic modal open/close ----------------
     Any modal on the page is just a `.modal-scrim` with an `.open`
     class toggle. Clicking the scrim itself (not its content) closes it. */
  function openModal(scrimEl) {
    if (scrimEl) scrimEl.classList.add('open');
  }
  function closeModal(scrimEl) {
    if (scrimEl) scrimEl.classList.remove('open');
  }
  function wireScrimClickToClose(scrimEl) {
    scrimEl.addEventListener('click', (e) => {
      if (e.target === scrimEl) closeModal(scrimEl);
    });
  }

  /* ---------------- Card detail modal ----------------
     Any element with [data-card-name] and [data-card-desc] opens the
     shared card-detail modal when clicked. This is the pattern real
     cards should follow once mechanics exist: no per-card modal HTML,
     just data attributes read by this one handler. */
  const cardModalScrim = el('card-modal-scrim');
  const cardModalTitle = el('card-modal-title');
  const cardModalBody = el('card-modal-body');
  const cardModalHeaderLeft = el('card-modal-header-left');

  wireScrimClickToClose(cardModalScrim);
  el('card-modal-close').addEventListener('click', () => closeModal(cardModalScrim));

  // headerLeftEl: optional DOM element to place left of the title (e.g. steppers).
  // Pass null/undefined to clear the slot (static/placeholder cards).
  function openCardModal(name, descriptionHtml, headerLeftEl, subtitleHtml) {
    cardModalTitle.textContent = name || 'Card';
    cardModalBody.innerHTML = descriptionHtml || '';
    if (cardModalHeaderLeft.firstChild !== headerLeftEl) {
      cardModalHeaderLeft.innerHTML = '';
      if (headerLeftEl) cardModalHeaderLeft.appendChild(headerLeftEl);
    }
    const sub = document.getElementById('card-modal-header-sub');
    if (sub) sub.innerHTML = subtitleHtml || '';
    openModal(cardModalScrim);
  }
  window.OrbWeaver = window.OrbWeaver || {};
  window.OrbWeaver.openCardModal = openCardModal;

  // Delegated click handling: any current or future element with
  // [data-card-name] opens the shared modal. No per-card listeners needed.
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-card-name]');
    if (!trigger) return;
    if (e.target.closest('.card-steppers')) return; // steppers don't open the modal
    openCardModal(trigger.dataset.cardName, trigger.dataset.cardDesc);
  });

  /* ---------------- Section collapse/expand ----------------
     Any `.section-label` toggles the `.card-grid` (or other content
     block) immediately following it in the DOM. */
  function setupSectionCollapse(labelEl) {
    const arrow = labelEl.querySelector('.section-collapse-arrow');
    const target = labelEl.nextElementSibling;
    if (!target) return;
    labelEl.addEventListener('click', () => {
      const collapsed = target.style.display === 'none';
      target.style.display = collapsed ? '' : 'none';
      if (arrow) arrow.classList.toggle('collapsed', !collapsed);
    });
  }
  document.querySelectorAll('.section-label').forEach(setupSectionCollapse);
  // Expose for placeholders.js, since it injects its own section label later.
  window.OrbWeaver.setupSectionCollapse = setupSectionCollapse;

  /* ---------------- Settings modal ---------------- */
  const settingsScrim = el('settings-modal-scrim');
  wireScrimClickToClose(settingsScrim);
  el('settings-gear-btn').addEventListener('click', () => openModal(settingsScrim));
  el('settings-modal-close').addEventListener('click', () => closeModal(settingsScrim));

  /* ---------------- Placeholder toggle ----------------
     This switch shows/hides everything placeholders.js has injected.
     Core shell code never decides what a "placeholder" is — it only
     flips one boolean and calls into placeholders.js's own show/hide
     functions, keeping the two files fully decoupled. */
  const placeholderToggle = el('placeholder-toggle');
  let placeholdersVisible = false; // default OFF

  placeholderToggle.addEventListener('click', () => {
    placeholdersVisible = !placeholdersVisible;
    placeholderToggle.classList.toggle('on', placeholdersVisible);
    if (window.OrbWeaverPlaceholders) {
      if (placeholdersVisible) window.OrbWeaverPlaceholders.show();
      else window.OrbWeaverPlaceholders.hide();
    }
  });

  // Called by placeholders.js once it has injected its content, so the
  // toggle's current on/off state is respected immediately on load.
  window.OrbWeaver.getPlaceholdersVisible = () => placeholdersVisible;

})();
