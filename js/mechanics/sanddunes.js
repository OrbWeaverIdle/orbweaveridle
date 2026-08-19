/* ============================================================
   MECHANIC: SAND DUNES (Section, yellow theme)
   Second cargo destination, same shape Mountains started as: a
   placeholder card with just an idle/total worker counter — no
   resources of its own at launch. Any resource actually gets
   registered here the moment cargo delivers it for the first time
   (see ensureResource()), so nothing needs to be pre-declared.

   Reveal trigger is TBD — planned as a "Mountain passage" found on
   the Mountains card in a later session. Until that exists, reveal()
   is only reachable via the ALL cheat, so this location is visible
   for testing/preview.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'sanddunes';
  const PREFIX = 'sd_';
  let discovered = false;
  let sdTotal = 0, sdIdle = 0, sdValEl = null, sdMount = null;

  function renderSdWorkers() { if (sdValEl) sdValEl.textContent = `${sdIdle}/${sdTotal}`; }

  function initWorkersRow(mount) {
    sdMount = mount;
    const row = document.createElement('div');
    row.className = 'resource-row worker-row';
    row.innerHTML = `<span class="res-name">Workers</span><button class="worker-recall-btn" disabled>–</button><span class="res-val"></span>`;
    mount.appendChild(row);
    sdValEl = row.querySelector('.res-val');
    renderSdWorkers();
  }

  function addWorkers(n) {
    if (n <= 0) return;
    sdTotal += n;
    sdIdle += n;
    renderSdWorkers();
  }

  function ensureResource(baseId, name) {
    const id = PREFIX + baseId;
    window.OrbWeaver.Resources.ensure(id, { name, mount: sdMount, current: 0, displayType: 'decimal', hidden: false });
    return id;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Sand Dunes',
    modalTheme: 'theme-sanddunes',
    stepperReady: () => false,
    cardName: () => 'Sand Dunes',
    getStatText: () => '',
    getUpgradeBarPct: () => 0,
    renderModalHTML: () => `<div class="hs-card"><div class="hs-head"><span class="hs-title">Sand Dunes</span></div><div class="hs-body"><div class="detail-card-desc">Windswept dunes on the horizon. More to come.</div></div></div>`,
    tick() { window.OrbWeaver.Cards.refresh(mechanic); }
  };

  function reveal() {
    if (discovered) return;
    discovered = true;
    document.getElementById('sanddunes-section').style.display = '';
    document.getElementById('left-hand-sanddunes-group').style.display = '';
    document.getElementById('camp-section-label').style.display = '';
    window.OrbWeaver.Cards.reveal(mechanic);
  }

  /* ---- Save/load ----
     Sand Dunes keeps a plain idle/total counter rather than a real
     Workers pool (it has nothing to assign to yet), so those two
     numbers are saved here instead of by js/core/workers.js. When it
     grows a real pool, move them to createPool(0, 'sanddunes') and
     delete this. */
  window.OrbWeaver.Save.register(ID,
    () => ({ d: discovered ? 1 : 0, t: sdTotal, i: sdIdle }),
    (d) => {
      sdTotal = d.t || 0;
      sdIdle = d.i || 0;
      renderSdWorkers();
      if (d.d) reveal();
    });

  window.OrbWeaver.Mechanics.register(mechanic);
  window.OrbWeaver.SandDunes = {
    id: ID, label: 'Sand Dunes', prefix: PREFIX,
    initWorkersRow, addWorkers, ensureResource, reveal, isDiscovered: () => discovered
  };
  window.OrbWeaver.Locations.register(window.OrbWeaver.SandDunes);
})();
