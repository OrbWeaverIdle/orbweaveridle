/* ============================================================
   CORE: SCOUT STABLE FACTORY
   createScoutStable(config) builds one Scout Stable — worker-powered
   Expedition tab + Resupply tab (two cargo vehicles) — and registers
   it and its cargo cards. Every location's Scout Stable (Camp,
   Mountains, and future ones) is one call to this factory with a
   short config, instead of a hand-copied file per location.

   config:
     id              — mechanic id for the Scout Stable card
     locationId      — this location's id in the Locations registry
     section         — display section ('Camp', 'Mountains', ...)
     resourcePrefix  — this location's resource id prefix ('' for Camp)
     modalTheme      — optional, recolors the shared modal
     workerPool      — pool instance (defaults to the Camp pool)
     vehicles        — { mule: {id,cap,travel,label}, cartbull: {...} }
     hasInitialExpedition — true only for Camp: its Expedition tab has
       the one-time "Prepare Mule" flow that discovers a new location.
       Every other location starts (and stays) on the greyed
       "Visit Academy for more Expeditions" message — future
       Expeditions are unlocked via Academy research, shared by every
       Scout Stable, not built yet.
     expeditionMuleId, expeditionTargetWood, expeditionTravelTime,
     onExpeditionComplete(ridersAway) — only used when
       hasInitialExpedition is true.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  function createScoutStable(config) {
    const ID = config.id;
    const LOC = config.locationId;
    const VEHICLES = config.vehicles;
    const pool = () => config.workerPool || window.OrbWeaver.Workers;
    const cardIdFor = (vk) => VEHICLES[vk].id;

    // Resources belonging to this location: id starts with this
    // location's prefix and isn't claimed by any other location's
    // prefix (Camp's prefix '' would otherwise match everything).
    function ownResources() {
      const otherPrefixes = window.OrbWeaver.Locations.all()
        .map((l) => l.prefix).filter((p) => p && p !== config.resourcePrefix);
      return window.OrbWeaver.Resources.all().filter((r) =>
        r.id !== 'gold' && r.id.startsWith(config.resourcePrefix) &&
        !otherPrefixes.some((p) => r.id.startsWith(p)));
    }
    function isZero(id) { return window.OrbWeaver.Resources.get(id) <= 0; }
    function displayName(id) { return window.OrbWeaver.Resources.getName(id); }

    function availableDestinations() { return window.OrbWeaver.Locations.destinationsFor(LOC); }
    function destinationById(id) { return availableDestinations().find((d) => d.id === id) || null; }

    let everOpened = false;
    let activeTab = 'expedition';

    // ---- Expedition state (only meaningful when hasInitialExpedition) ----
    let expeditionPhase = 'idle';
    let expeditionCollected = 0;
    let expeditionStalled = false;
    let expeditionRemaining = 0;
    let expeditionRidersAway = 0;
    let goldStarved = false;

    // ---- Cargo state ----
    const plans = {
      mule:     { dest: null, items: [] },
      cartbull: { dest: null, items: [] }
    };
    const runs = {
      mule:     { phase: 'idle', run: null, remaining: 0, ridersAway: 0, destId: null, auto: false, autoStarted: false },
      cartbull: { phase: 'idle', run: null, remaining: 0, ridersAway: 0, destId: null, auto: false, autoStarted: false }
    };

    function trackerLine(r) {
      return r.run.map((it) => `${Math.floor(it.loaded)}/${it.qty} ${displayName(it.res)}`).join(', ');
    }

    function cargoOptions(vk) {
      const taken = new Set(plans[vk].items.map((p) => p.res));
      return ownResources().filter((r) => !taken.has(r.id)).map((r) => ({ id: r.id, name: displayName(r.id) }));
    }

    function isCargoStalled(vk) {
      const r = runs[vk];
      if (r.phase !== 'loading' || !r.run) return false;
      if (pool().getAssigned(ID) < 1 || goldStarved) return true;
      const unfilled = r.run.filter((it) => it.loaded < it.qty - 1e-9);
      return unfilled.length > 0 && unfilled.every((it) => window.OrbWeaver.Resources.get(it.res) <= 0);
    }

    function clampQty(vk, res, raw) {
      const cap = VEHICLES[vk].cap;
      const others = plans[vk].items.filter((p) => p.res !== res).reduce((a, p) => a + p.qty, 0);
      return Math.max(1, Math.min(raw, cap - others));
    }

    /* ---- Expedition tab ---- */
    function renderExpeditionTab() {
      if (!config.hasInitialExpedition) return `<div class="sp-tab-greyed">Visit Academy for more Expeditions.</div>`;
      if (expeditionPhase !== 'idle') return `<div class="sp-tab-greyed">Visit Academy for more Expeditions.</div>`;
      return `<div class="upgrade-row-horizontal">
        <div class="upgrade-text-stack">
          <span class="upgrade-name">Prepare Mule</span>
          <span class="upgrade-desc">Prepare an expedition to explore the surrounding lands.</span>
        </div>
        <button class="action-btn" data-sp-action="prepare-mule" data-sp-loc="${LOC}">Prepare Mule</button>
      </div>`;
    }

    /* ---- Resupply tab ---- */
    function renderDestSelector(vk) {
      const dests = availableDestinations();
      const plan = plans[vk];
      if (!plan.dest || !dests.some((d) => d.id === plan.dest)) plan.dest = dests[0] ? dests[0].id : null;
      if (dests.length <= 1) return '';
      return `<select class="sp-select sp-dest-select" data-sp-action="set-dest" data-sp-loc="${LOC}" data-sp-vehicle="${vk}">
        ${dests.map((d) => `<option value="${d.id}"${d.id === plan.dest ? ' selected' : ''}>${d.label}</option>`).join('')}
      </select>`;
    }

    function renderCargoGrid(vk) {
      const plan = plans[vk], cap = VEHICLES[vk].cap;
      const total = plan.items.reduce((a, p) => a + p.qty, 0);
      const cards = plan.items.map((p) => {
        const zero = isZero(p.res);
        return `<div class="cargo-card${zero ? ' future' : ''}" data-sp-row="${p.res}">
          <span class="cargo-name">${displayName(p.res)}</span>
          <button class="card-stepper-btn" data-sp-action="qty-minus" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" data-sp-res="${p.res}" ${p.qty <= 1 ? 'disabled' : ''}>–</button>
          <span class="card-stepper-val" data-sp-action="qty-edit" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" data-sp-res="${p.res}">${p.qty}</span>
          <button class="card-stepper-btn" data-sp-action="qty-plus" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" data-sp-res="${p.res}" ${total >= cap ? 'disabled' : ''}>+</button>
          <button class="sp-remove-btn" data-sp-action="remove-resource" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" data-sp-res="${p.res}" ${plan.items.length <= 1 ? 'disabled' : ''}>×</button>
        </div>`;
      }).join('');
      const opts = cargoOptions(vk);
      const dropdown = opts.length
        ? `<select class="sp-select" data-sp-action="add-resource" data-sp-loc="${LOC}" data-sp-vehicle="${vk}">
            <option value="">+ Add resource…</option>
            ${opts.map((r) => `<option value="${r.id}"${isZero(r.id) ? ' class="sp-option-future"' : ''}>${r.name}${isZero(r.id) ? ' (none in stock)' : ''}</option>`).join('')}
          </select>`
        : '';
      return `<div class="cargo-grid">${cards}</div>${dropdown}
        <div class="sp-cap-line">${total}/${cap} loaded per ${VEHICLES[vk].label.toLowerCase()}</div>`;
    }

    function renderLoadingView(vk) {
      const r = runs[vk];
      const total = r.run.reduce((a, it) => a + it.qty, 0);
      const loaded = r.run.reduce((a, it) => a + it.loaded, 0);
      const pct = total > 0 ? (loaded / total) * 100 : 0;
      return `<div class="detail-card-desc">Loading: ${trackerLine(r)}</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
        <button class="action-btn" data-sp-action="cancel-cargo" data-sp-loc="${LOC}" data-sp-vehicle="${vk}">Cancel</button>`;
    }

    function renderDispatchButton(vk) {
      const r = runs[vk], plan = plans[vk];
      const total = plan.items.reduce((a, p) => a + p.qty, 0);
      const busy = r.phase !== 'idle';
      const label = busy ? `${VEHICLES[vk].label} in transit…` : `Dispatch`;
      return `<button class="action-btn" data-sp-action="dispatch" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" ${busy || total <= 0 || !plan.dest ? 'disabled' : ''}>${label}</button>`;
    }

    function renderVehicleColumn(vk) {
      const on = runs[vk].auto;
      const r = runs[vk];
      const body = r.phase === 'loading'
        ? renderLoadingView(vk)
        : renderDestSelector(vk) + renderCargoGrid(vk) + renderDispatchButton(vk);
      return `<div class="sp-vehicle-col hs-card">
        <div class="hs-head">
          <span class="hs-title">${VEHICLES[vk].label}</span>
          <div class="toggle-switch${on ? ' on' : ''}" data-sp-action="toggle-auto" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" title="Auto"></div>
        </div>
        <div class="hs-body" data-sp-vehicle-panel="${vk}">${body}</div>
      </div>`;
    }

    function renderResupplyTab() {
      if (availableDestinations().length === 0) return `<div class="sp-tab-greyed">No discovered destinations yet.</div>`;
      return `<div class="sp-vehicle-row">${renderVehicleColumn('mule')}${renderVehicleColumn('cartbull')}</div>`;
    }

    function adjustQty(vk, res, delta) {
      const p = plans[vk].items.find((x) => x.res === res);
      if (!p) return;
      p.qty = clampQty(vk, res, p.qty + delta);
    }
    function setQty(vk, res, raw) {
      const p = plans[vk].items.find((x) => x.res === res);
      if (!p) return;
      p.qty = clampQty(vk, res, raw);
    }

    function patchCargoRows(vk) {
      const plan = plans[vk], cap = VEHICLES[vk].cap;
      const total = plan.items.reduce((a, p) => a + p.qty, 0);
      const scope = `#card-modal-body [data-sp-vehicle-panel="${vk}"]`;
      plan.items.forEach((p) => {
        const row = document.querySelector(`${scope} .cargo-card[data-sp-row="${p.res}"]`);
        if (!row) return;
        const val = row.querySelector('.card-stepper-val');
        if (val && val.tagName !== 'INPUT') val.textContent = p.qty;
        const minus = row.querySelector('[data-sp-action="qty-minus"]');
        const plus = row.querySelector('[data-sp-action="qty-plus"]');
        if (minus) minus.disabled = p.qty <= 1;
        if (plus) plus.disabled = total >= cap;
      });
      const capLine = document.querySelector(`${scope} .sp-cap-line`);
      if (capLine) capLine.textContent = `${total}/${cap} loaded per ${VEHICLES[vk].label.toLowerCase()}`;
      const goBtn = document.querySelector(`${scope} [data-sp-action="dispatch"]`);
      if (goBtn) goBtn.disabled = runs[vk].phase !== 'idle' || total <= 0 || !plan.dest;
    }

    function activateQtyEdit(span, vk, res) {
      if (span.tagName === 'INPUT') return;
      const plan = plans[vk];
      const p = plan.items.find((x) => x.res === res);
      if (!p) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.className = 'cargo-qty-input';
      input.value = p.qty;
      span.replaceWith(input);
      input.select();

      function commit() {
        const raw = parseInt(input.value, 10);
        if (!isNaN(raw)) setQty(vk, res, raw);
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }
      function cancel() { window.OrbWeaver.Cards.refreshOpenModal(ID); }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      input.addEventListener('blur', commit);
    }

    const mechanic = {
      id: ID,
      startHidden: true,
      section: config.section,
      modalTheme: config.modalTheme,
      modalWide: true,
      workerPool: config.workerPool,
      cardName: () => 'Scout Stable',
      isBillable: () => expeditionPhase === 'preparing' || runs.mule.phase === 'loading' || runs.cartbull.phase === 'loading',
      getStatText() {
        if (pool().getAssigned(ID) === 0) return '';
        if (goldStarved) return 'Stopped';
        const anyAutoActive = ['mule', 'cartbull'].some((vk) => runs[vk].auto && runs[vk].phase !== 'idle');
        if (anyAutoActive) return 'Auto-loading';
        return mechanic.isBillable() ? '' : 'Stopped';
      },
      getUpgradeBarPct: () => 0,
      patchLiveTrack() {
        ['mule', 'cartbull'].forEach((vk) => {
          const r = runs[vk];
          if (r.phase !== 'loading' || !r.run) return;
          const scope = `#card-modal-body [data-sp-vehicle-panel="${vk}"]`;
          const total = r.run.reduce((a, it) => a + it.qty, 0);
          const loaded = r.run.reduce((a, it) => a + it.loaded, 0);
          const bar = document.querySelector(`${scope} .detail-progress-bar`);
          if (bar) bar.style.width = (total > 0 ? (loaded / total) * 100 : 0).toFixed(1) + '%';
          const desc = document.querySelector(`${scope} .detail-card-desc`);
          if (desc) desc.textContent = 'Loading: ' + trackerLine(r);
        });
      },
      getWorkerDesc() {
        const assigned = pool().getAssigned(ID);
        return assigned === 0 ? '' : `Loading ${window.OrbWeaver.Upgrades.formatRate(assigned * window.OrbWeaver.Upgrades.getBaseSPW())}s faster`;
      },
      onOpen() { activeTab = (config.hasInitialExpedition && !everOpened) ? 'expedition' : 'resupply'; everOpened = true; },
      afterRender() {
        if (activeTab !== 'resupply') return;
        document.querySelectorAll('#card-modal-body [data-sp-action="qty-plus"]').forEach((btn) => {
          window.OrbWeaver.Cards.addHoldBehavior(btn, () => { adjustQty(btn.dataset.spVehicle, btn.dataset.spRes, 1); patchCargoRows(btn.dataset.spVehicle); });
        });
        document.querySelectorAll('#card-modal-body [data-sp-action="qty-minus"]').forEach((btn) => {
          window.OrbWeaver.Cards.addHoldBehavior(btn, () => { adjustQty(btn.dataset.spVehicle, btn.dataset.spRes, -1); patchCargoRows(btn.dataset.spVehicle); });
        });
      },
      renderModalHTML() {
        const tabs = `<div class="sp-tabs">
          <button class="sp-tab${activeTab === 'resupply' ? ' active' : ''}" data-sp-action="tab" data-sp-loc="${LOC}" data-sp-tab="resupply">Resupply</button>
          <button class="sp-tab${activeTab === 'expedition' ? ' active' : ''}" data-sp-action="tab" data-sp-loc="${LOC}" data-sp-tab="expedition">Expedition</button>
        </div>`;
        const body = activeTab === 'expedition' ? renderExpeditionTab() : renderResupplyTab();
        return `<div class="scoutspen-modal">${tabs}<div class="sp-tab-body">${body}</div></div>`;
      },
      tick(goldAvailable, tickRate) {
        goldStarved = !goldAvailable;
        const assigned = pool().getAssigned(ID);
        const spw = window.OrbWeaver.Upgrades.getBaseSPW();
        const perTick = assigned >= 1 ? tickRate * (2 + assigned * spw) : 0;

        if (goldAvailable) {
          if (config.hasInitialExpedition && expeditionPhase === 'preparing') {
            const actual = window.OrbWeaver.Resources.spend('wood', perTick);
            expeditionCollected += actual;
            expeditionStalled = actual < perTick - 1e-9;
            if (expeditionCollected >= config.expeditionTargetWood) {
              expeditionCollected = config.expeditionTargetWood;
              expeditionPhase = 'ready';
              pool().transferAssignment(ID, config.expeditionMuleId, 1);
              window.OrbWeaver.Footer.push("Mule's ready to embark.");
              if (window.OrbWeaver.Cards.isModalOpenFor(config.expeditionMuleId)) window.OrbWeaver.Cards.closeModal();
            }
          }

          ['mule', 'cartbull'].forEach((vk) => {
            const r = runs[vk];
            if (r.phase !== 'loading') return;
            const unfilled = r.run.filter((it) => it.loaded < it.qty - 1e-9);
            if (unfilled.length > 0 && perTick > 0) {
              const share = perTick / unfilled.length;
              unfilled.forEach((it) => {
                const actual = window.OrbWeaver.Resources.spend(it.res, Math.min(share, it.qty - it.loaded));
                it.loaded += actual;
              });
            }
            if (r.run.every((it) => it.loaded >= it.qty - 1e-9)) {
              r.phase = 'loaded';
              if (r.auto) autoDisembark(vk);
              else pool().transferAssignment(ID, cardIdFor(vk), 1);
            }
          });
        }

        ['mule', 'cartbull'].forEach((vk) => {
          const r = runs[vk];
          if (r.phase === 'idle' && r.auto && r.autoStarted && plans[vk].items.length > 0 && plans[vk].dest) {
            dispatchVehicle(vk, false);
          }
        });

        window.OrbWeaver.Cards.refresh(mechanic);
      }
    };

    /* ---------------- Expedition Mule (Camp only) ---------------- */
    let expeditionMuleMechanic = null;
    if (config.hasInitialExpedition) {
      expeditionMuleMechanic = {
        id: config.expeditionMuleId,
        startHidden: true, section: config.section, isMule: true, modalTheme: 'theme-mule', upkeepExempt: true,
        workerPool: config.workerPool,
        cardName: () => 'Expedition Mule',
        getUpgradeBarPct: () => 0,
        stepperReady: () => expeditionPhase === 'ready',
        isMuted: () => expeditionPhase === 'preparing',
        getBuildBarPct() {
          if (expeditionPhase === 'preparing') return (expeditionCollected / config.expeditionTargetWood) * 100;
          if (expeditionPhase === 'traveling') return ((config.expeditionTravelTime - expeditionRemaining) / config.expeditionTravelTime) * 100;
          return 0;
        },
        getStatText() {
          if (expeditionPhase === 'preparing') return `${expeditionStalled ? 'Stopped – ' : ''}Preparing mule – ${Math.floor(expeditionCollected)}/${config.expeditionTargetWood} wood`;
          if (expeditionPhase === 'ready') return 'Ready to disembark';
          if (expeditionPhase === 'traveling') return `On Expedition… ${Math.ceil(expeditionRemaining)}s`;
          return '';
        },
        patchBuildStatus() {
          if (expeditionPhase === 'preparing') return `${Math.floor(expeditionCollected)}/${config.expeditionTargetWood} wood`;
          if (expeditionPhase === 'traveling') return `${Math.ceil(expeditionRemaining)}s remaining`;
          return null;
        },
        renderModalHTML() {
          if (expeditionPhase === 'ready') {
            const canGo = pool().getAssigned(config.expeditionMuleId) > 0;
            return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div><div class="hs-body">
              <div class="detail-card-desc">Embark on an expedition of the surrounding lands.</div>
              <button class="action-btn" data-sp-action="disembark-expedition" data-sp-loc="${LOC}" ${canGo ? '' : 'disabled'}>Disembark</button>
              <div class="detail-card-desc">Assigned workers leave camp. Can return later.</div>
            </div></div>`;
          }
          if (expeditionPhase === 'traveling') {
            return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div><div class="hs-body">
              <div class="detail-card-desc">On expedition…</div>
              <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
              <div class="detail-status"><span>${Math.ceil(expeditionRemaining)}s remaining</span></div>
            </div></div>`;
          }
          return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div><div class="hs-body">
            <div class="detail-card-desc">Preparing a mule for expedition.</div>
            <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
            <div class="detail-status"><span>${Math.floor(expeditionCollected)}/${config.expeditionTargetWood} wood</span></div>
            <button class="action-btn" data-sp-action="cancel-expedition" data-sp-loc="${LOC}">Cancel</button>
          </div></div>`;
        },
        patchLiveTrack() {
          const btn = document.querySelector('#card-modal-body [data-sp-action="disembark-expedition"]');
          if (btn) btn.disabled = pool().getAssigned(config.expeditionMuleId) <= 0;
        },
        tick(goldAvailable, tickRate) {
          if (expeditionPhase === 'traveling') {
            expeditionRemaining -= tickRate;
            if (expeditionRemaining <= 0) completeExpedition();
          }
          window.OrbWeaver.Cards.refresh(expeditionMuleMechanic);
        }
      };
    }

    function prepareMule() {
      if (!config.hasInitialExpedition || expeditionPhase !== 'idle') return;
      expeditionPhase = 'preparing';
      window.OrbWeaver.Cards.reveal(expeditionMuleMechanic);
      window.OrbWeaver.Cards.closeModal();
    }
    function disembarkExpedition() {
      if (!config.hasInitialExpedition || expeditionPhase !== 'ready' || pool().getAssigned(config.expeditionMuleId) <= 0) return;
      expeditionRidersAway = pool().sequester(config.expeditionMuleId);
      expeditionPhase = 'traveling';
      expeditionRemaining = config.expeditionTravelTime;
      window.OrbWeaver.Cards.closeModal();
    }
    function cancelExpedition() {
      if (!config.hasInitialExpedition || expeditionPhase !== 'preparing') return;
      const space = (window.OrbWeaver.Resources.getCap('wood') ?? Infinity) - window.OrbWeaver.Resources.get('wood');
      window.OrbWeaver.Resources.add('wood', Math.min(expeditionCollected, space));
      expeditionCollected = 0; expeditionStalled = false; expeditionPhase = 'idle';
      window.OrbWeaver.Cards.hide(expeditionMuleMechanic);
      if (window.OrbWeaver.Cards.isModalOpenFor(config.expeditionMuleId)) window.OrbWeaver.Cards.closeModal();
    }
    function completeExpedition() {
      expeditionPhase = 'delivered';
      window.OrbWeaver.Cards.hide(expeditionMuleMechanic);
      if (config.onExpeditionComplete) config.onExpeditionComplete(expeditionRidersAway);
    }

    /* ---------------- Cargo vehicles ---------------- */
    function makeCargoMechanic(vk) {
      const cfg = VEHICLES[vk];
      const obj = {
        id: cardIdFor(vk), startHidden: true, section: config.section,
        isMule: true, modalTheme: 'theme-mule', upkeepExempt: true, gapOnHide: true,
        workerPool: config.workerPool,
        cardName: () => cfg.label,
        getUpgradeBarPct: () => 0,
        stepperReady: () => runs[vk].phase === 'loaded',
        isBuildBarFaded: () => runs[vk].phase === 'loading',
        getBuildBarPct() {
          const r = runs[vk];
          if (r.phase === 'traveling') return ((cfg.travel - r.remaining) / cfg.travel) * 100;
          if (!r.run) return 0;
          const need = r.run.reduce((a, it) => a + it.qty, 0);
          return need > 0 ? (r.run.reduce((a, it) => a + it.loaded, 0) / need) * 100 : 0;
        },
        getStatText() {
          const r = runs[vk];
          if (r.phase === 'traveling') return `Traveling… ${Math.ceil(r.remaining)}s`;
          if (r.phase === 'loading' || r.phase === 'loaded') return `${r.phase === 'loaded' ? 'Ready to depart' : (isCargoStalled(vk) ? 'Stopped' : 'Loading')} – ${trackerLine(r)}`;
          return '';
        },
        patchBuildStatus() {
          const r = runs[vk];
          if (r.phase === 'traveling') return `${Math.ceil(r.remaining)}s remaining`;
          if (r.phase === 'loading' || r.phase === 'loaded') return trackerLine(r);
          return null;
        },
        renderModalHTML() {
          const r = runs[vk];
          const destLabel = destinationById(r.destId)?.label ?? 'its destination';
          const head = `<div class="hs-head"><span class="hs-title">${cfg.label}</span></div>`;
          if (r.phase === 'traveling') {
            const cargo = r.run ? r.run.map((it) => `${Math.floor(it.loaded)} ${displayName(it.res)}`).join(', ') : '';
            return `<div class="hs-card">${head}<div class="hs-body">
              <div class="detail-card-desc">On the road to ${destLabel}…</div>
              ${cargo ? `<div class="detail-card-desc">${cargo}</div>` : ''}
              <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
              <div class="detail-status"><span>${Math.ceil(r.remaining)}s remaining</span></div>
            </div></div>`;
          }
          if (r.phase === 'loading') {
            return `<div class="hs-card">${head}<div class="hs-body">
              <div class="detail-card-desc">Loading cargo bound for ${destLabel}.</div>
              <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
              <div class="detail-status"><span>${r.run ? trackerLine(r) : ''}</span></div>
              <button class="action-btn" data-sp-action="cancel-cargo" data-sp-loc="${LOC}" data-sp-vehicle="${vk}">Cancel</button>
            </div></div>`;
          }
          const canGo = pool().getAssigned(cardIdFor(vk)) > 0;
          return `<div class="hs-card">${head}<div class="hs-body">
            <div class="detail-card-desc">Fully loaded, ready to depart for ${destLabel}.</div>
            <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
            <div class="detail-status"><span>${r.run ? trackerLine(r) : ''}</span></div>
            <button class="action-btn" data-sp-action="disembark-cargo" data-sp-loc="${LOC}" data-sp-vehicle="${vk}" ${canGo ? '' : 'disabled'}>Disembark</button>
          </div></div>`;
        },
        patchLiveTrack() {
          const btn = document.querySelector(`#card-modal-body [data-sp-action="disembark-cargo"][data-sp-vehicle="${vk}"]`);
          if (btn) btn.disabled = pool().getAssigned(cardIdFor(vk)) <= 0;
        },
        tick(goldAvailable, tickRate) {
          if (runs[vk].phase === 'traveling') {
            runs[vk].remaining -= tickRate;
            if (runs[vk].remaining <= 0) completeVehicle(vk);
          }
          window.OrbWeaver.Cards.refresh(obj);
        }
      };
      return obj;
    }
    const resupplyMuleMechanic = makeCargoMechanic('mule');
    const cartBullMechanic = makeCargoMechanic('cartbull');

    /* ---- Save/load ----
       Registered once per Scout Stable instance (Camp's and Mountains'
       each get their own entry, keyed by this stable's id).

       THE TRAP: ridersAway. sequester() removes a vehicle's crew from
       the pool entirely — it decrements `total`, so they are neither
       idle nor active nor recallable while away, and completeVehicle()
       later hands them to the destination. The pool saves the reduced
       total faithfully; if these counters were not saved alongside it,
       every worker on the road at save time would be permanently
       deleted. Save both, or neither.

       Travel time is stored as remaining seconds and keeps ticking,
       rather than as an arrival timestamp — the offline replay window
       (24h) is far longer than any trip, so a countdown still completes
       across a closed tab, and travel stays consistent with every other
       timer in the game (including the speed-multiplier cheat). */
    function serializeRun(r) {
      return {
        p: r.phase, rem: r.remaining, ra: r.ridersAway, d: r.destId,
        a: r.auto ? 1 : 0, as: r.autoStarted ? 1 : 0,
        run: r.run ? r.run.map((it) => ({ r: it.res, q: it.qty, l: it.loaded })) : null
      };
    }
    function restoreRun(r, d) {
      if (!d) return;
      r.phase = d.p || 'idle';
      r.remaining = d.rem || 0;
      r.ridersAway = d.ra || 0;
      r.destId = d.d || null;
      r.auto = !!d.a;
      r.autoStarted = !!d.as;
      r.run = d.run ? d.run.map((it) => ({ res: it.r, qty: it.q, loaded: it.l })) : null;
    }

    window.OrbWeaver.Save.register(ID,
      () => ({
        eo: everOpened ? 1 : 0, tab: activeTab,
        ep: expeditionPhase, ec: expeditionCollected,
        er: expeditionRemaining, era: expeditionRidersAway,
        plans: {
          mule: { dest: plans.mule.dest, items: plans.mule.items.map((i) => ({ res: i.res, qty: i.qty })) },
          cartbull: { dest: plans.cartbull.dest, items: plans.cartbull.items.map((i) => ({ res: i.res, qty: i.qty })) }
        },
        runs: { mule: serializeRun(runs.mule), cartbull: serializeRun(runs.cartbull) }
      }),
      (d) => {
        everOpened = !!d.eo;
        activeTab = d.tab || 'expedition';
        expeditionPhase = d.ep || 'idle';
        expeditionCollected = d.ec || 0;
        expeditionRemaining = d.er || 0;
        expeditionRidersAway = d.era || 0;
        ['mule', 'cartbull'].forEach((vk) => {
          const sp = (d.plans || {})[vk];
          if (sp) {
            plans[vk].dest = sp.dest || null;
            plans[vk].items = (sp.items || []).map((i) => ({ res: i.res, qty: i.qty }));
          }
          restoreRun(runs[vk], (d.runs || {})[vk]);
        });
      });

    function dispatchVehicle(vk, fromModal) {
      const r = runs[vk], plan = plans[vk];
      if (r.phase !== 'idle' || !plan.dest || plan.items.length === 0) return;
      r.run = plan.items.map((p) => ({ res: p.res, qty: p.qty, loaded: 0 }));
      r.phase = 'loading';
      r.destId = plan.dest;
      r.autoStarted = r.auto;
      window.OrbWeaver.Cards.reveal(vk === 'mule' ? resupplyMuleMechanic : cartBullMechanic);
      if (fromModal) window.OrbWeaver.Cards.closeModal();
    }

    function autoDisembark(vk) {
      runs[vk].ridersAway = 0;
      runs[vk].phase = 'traveling';
      runs[vk].remaining = VEHICLES[vk].travel;
      if (window.OrbWeaver.Cards.isModalOpenFor(cardIdFor(vk))) window.OrbWeaver.Cards.closeModal();
    }

    function disembarkVehicle(vk) {
      const r = runs[vk];
      if (r.phase !== 'loaded' || pool().getAssigned(cardIdFor(vk)) <= 0) return;
      r.ridersAway = pool().sequester(cardIdFor(vk));
      r.phase = 'traveling';
      r.remaining = VEHICLES[vk].travel;
      window.OrbWeaver.Cards.closeModal();
    }

    function cancelVehicle(vk) {
      const r = runs[vk];
      if (r.phase !== 'loading') return;
      r.run.forEach((it) => {
        const space = (window.OrbWeaver.Resources.getCap(it.res) ?? Infinity) - window.OrbWeaver.Resources.get(it.res);
        window.OrbWeaver.Resources.add(it.res, Math.min(it.loaded, space));
      });
      r.phase = 'idle'; r.run = null; r.auto = false; r.autoStarted = false;
      const cargoMechanic = vk === 'mule' ? resupplyMuleMechanic : cartBullMechanic;
      window.OrbWeaver.Cards.hide(cargoMechanic);
      if (window.OrbWeaver.Cards.isModalOpenFor(cardIdFor(vk))) window.OrbWeaver.Cards.closeModal();
      else if (window.OrbWeaver.Cards.isModalOpenFor(ID)) window.OrbWeaver.Cards.refreshOpenModal(ID);
    }

    function completeVehicle(vk) {
      const r = runs[vk];
      const dest = destinationById(r.destId);
      if (dest) {
        r.run.forEach((it) => {
          dest.ensureResource(it.res.replace(config.resourcePrefix, ''), displayName(it.res));
          window.OrbWeaver.Resources.add(dest.prefix + it.res.replace(config.resourcePrefix, ''), it.loaded);
        });
        dest.addWorkers(r.ridersAway);
      }
      window.OrbWeaver.Footer.push(`The ${VEHICLES[vk].label.toLowerCase()} arrived at ${dest ? dest.label : 'its destination'}.`);
      r.phase = 'idle'; r.run = null; r.ridersAway = 0; r.destId = null; r.autoStarted = r.auto;
      window.OrbWeaver.Cards.hide(vk === 'mule' ? resupplyMuleMechanic : cartBullMechanic);
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sp-action]');
      if (!btn || btn.dataset.spLoc !== LOC) return;
      const action = btn.dataset.spAction, vk = btn.dataset.spVehicle;
      if (action === 'tab') { activeTab = btn.dataset.spTab; window.OrbWeaver.Cards.refreshOpenModal(ID); }
      else if (action === 'prepare-mule') prepareMule();
      else if (action === 'disembark-expedition') disembarkExpedition();
      else if (action === 'cancel-expedition') cancelExpedition();
      else if (action === 'toggle-auto') {
        runs[vk].auto = !runs[vk].auto;
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }
      else if (action === 'dispatch') dispatchVehicle(vk, true);
      else if (action === 'cancel-cargo') cancelVehicle(vk);
      else if (action === 'disembark-cargo') disembarkVehicle(vk);
      else if (action === 'remove-resource') {
        plans[vk].items = plans[vk].items.filter((p) => p.res !== btn.dataset.spRes);
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }
      else if (action === 'qty-edit') activateQtyEdit(btn, vk, btn.dataset.spRes);
    });
    document.addEventListener('change', (e) => {
      const addSel = e.target.closest(`[data-sp-action="add-resource"][data-sp-loc="${LOC}"]`);
      if (addSel && addSel.value) {
        const vk = addSel.dataset.spVehicle;
        const cap = VEHICLES[vk].cap;
        const used = plans[vk].items.reduce((a, p) => a + p.qty, 0);
        if (used >= cap) {
          const last = plans[vk].items[plans[vk].items.length - 1];
          if (last) last.qty = Math.max(1, last.qty - 1);
        }
        plans[vk].items.push({ res: addSel.value, qty: 1 });
        window.OrbWeaver.Cards.refreshOpenModal(ID);
        return;
      }
      const destSel = e.target.closest(`[data-sp-action="set-dest"][data-sp-loc="${LOC}"]`);
      if (destSel) plans[destSel.dataset.spVehicle].dest = destSel.value;
    });

    window.OrbWeaver.Mechanics.register(mechanic);
    if (expeditionMuleMechanic) window.OrbWeaver.Mechanics.register(expeditionMuleMechanic);
    window.OrbWeaver.Mechanics.register(resupplyMuleMechanic);
    window.OrbWeaver.Mechanics.register(cartBullMechanic);
  }

  window.OrbWeaver.ScoutStable = { create: createScoutStable };
})();
