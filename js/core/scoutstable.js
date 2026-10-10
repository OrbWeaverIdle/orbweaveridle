/* ============================================================
   CORE: SCOUT STABLE FACTORY
   createScoutStable(config) builds one Scout Stable — worker-powered
   Expedition tab + Resupply tab — and registers it and its cargo
   vehicles. Every location's Scout Stable (Camp, Mountains, and future
   ones) is one call to this factory with a short config.

   Resupply vehicles are growable, purchasable stations (Tool Shed/
   Smelter Shack's "buy more for Gold Bars" pattern, applied per kind):
   every location starts with STARTING_STATIONS of each kind in
   config.vehicleKinds, buyable up to STATION_CAP each, flat
   STATION_ADD_COST Gold Bars per purchase (that location's own —
   Camp's plain 'goldbars', Mountains' 'mtn_goldbars', same convention
   Tool Shed/Smelter Shack already use). Since this codebase never
   registers cards at runtime, every possible station up to STATION_CAP
   is pre-registered as a hidden grid card at boot (same trick as Stone
   or the Expedition Mule existing hidden before you build them) —
   whichever ones are actually owned *and* dispatched reveal themselves
   on the grid, same as before, just several possible at once now.

   A vehicle's own card only ever shows two states — 'loading' (cargo
   still being collected) and 'traveling' — because dispatch no longer
   needs a worker: once loading finishes, it always proceeds straight
   to traveling (the old manual "loaded, click Disembark" state is
   gone). Workers can optionally ride along as a cargo line (id
   '__workers__', excluded from the resource weight cap): adding one to
   a plan pulls it from idle onto this Scout Stable's own assignment
   immediately (contributing to this card's tick, same idea as the
   Expedition Mule's held workers below); at dispatch they transfer
   onto the departing vehicle's own id and sequester for the trip,
   arriving permanently at the destination.

   config:
     id, locationId, section, resourcePrefix, modalTheme, workerPool
     vehicleKinds — { mule: {idBase,cap,travel,label}, cartbull: {...} }
       (order matters: first kind renders as the left column)
     hasInitialExpedition — true only for Camp: its Expedition tab has
       the one-time "Prepare Mule" flow that discovers a new location.
       Every other location starts (and stays) on the greyed
       "Visit Academy for more Expeditions" message.
     expeditionMuleId, expeditionTargetWood, expeditionTravelTime,
     onExpeditionComplete(ridersAway) — only used when
       hasInitialExpedition is true.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const STATION_CAP = 8;          // max owned stations per vehicle kind
  const STARTING_STATIONS = 2;    // owned stations per kind on a fresh game
  const STATION_ADD_COST = 2000;  // Gold Bars per bought station
  const EXPEDITION_WORKERS_NEEDED = 5; // workers required to Prepare Mule (idle + assigned to this card)
  const WORKERS_RES = '__workers__';

  function createScoutStable(config) {
    const ID = config.id;
    const LOC = config.locationId;
    const KINDS = config.vehicleKinds;
    const KIND_KEYS = Object.keys(KINDS);
    const pool = () => config.workerPool || window.OrbWeaver.Workers;
    const cardIdFor = (kind, idx) => `${KINDS[kind].idBase}${idx + 1}`;
    const stationLabel = (kind, idx) => `${KINDS[kind].label} ${idx + 1}`;

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
    function stockFor(id) { return id === WORKERS_RES ? pool().getIdleCount() : window.OrbWeaver.Resources.get(id); }
    function isZero(id) { return stockFor(id) <= 0; }
    // A crate's row reads just 'Crate' because it sits under the parent
    // that names it; out of that context it needs qualifying, or every
    // crate in the dropdown looks identical.
    function displayName(id) {
      if (id === WORKERS_RES) return 'Workers';
      const p = window.OrbWeaver.Resources.parentOf(id);
      const R = window.OrbWeaver.Resources;
      return p ? `${R.getName(p)} Crate` : R.getName(id);
    }

    function availableDestinations() { return window.OrbWeaver.Locations.destinationsFor(LOC); }
    function destinationById(id) { return availableDestinations().find((d) => d.id === id) || null; }

    function goldBarsId() { return config.resourcePrefix + 'goldbars'; }
    function goldBarsHave() { return window.OrbWeaver.Resources.exists(goldBarsId()) ? window.OrbWeaver.Resources.get(goldBarsId()) : 0; }
    function canAddStation(kind) { return owned[kind] < STATION_CAP && goldBarsHave() >= STATION_ADD_COST; }
    function addStation(kind) {
      if (!canAddStation(kind)) return;
      window.OrbWeaver.Resources.spend(goldBarsId(), STATION_ADD_COST);
      owned[kind]++;
      window.OrbWeaver.Footer.push(`New ${KINDS[kind].label.toLowerCase()} station added.`);
      window.OrbWeaver.Cards.refreshOpenModal(ID);
    }

    let activeTab = 'resupply'; // every open starts here (onOpen)

    // Worker contribution formula (see js/core/upgrades.js workerRate()).
    // Local to this Scout Stable instance.
    let m = 1, p = 1, f = 0;

    // ---- Expedition state (only meaningful when hasInitialExpedition) ----
    let expeditionPhase = 'idle';
    let expeditionCollected = 0;
    let expeditionStalled = false;
    let expeditionRemaining = 0;
    let expeditionRidersAway = 0;
    let expeditionWorkersHeld = 0; // idle workers sequestered onto this card during 'preparing'
    let goldStarved = false;

    // ---- Station ownership + per-station plan/run state ----
    // Every possible station up to STATION_CAP is pre-allocated (its
    // grid card is pre-registered too, see below) — `owned[kind]` is
    // just how many of them are currently usable/visible in the modal.
    let owned = {};
    const plans = {}; // kind -> array[STATION_CAP] of { dest, items }
    const runs = {};  // kind -> array[STATION_CAP] of run state
    // Rows for a just-added cargo item, not yet touched by a stepper or a
    // committed/cancelled qty edit — purely a UI hint (never saved), cleared
    // the moment that specific row is interacted with. Keyed 'kind|idx|res'.
    const freshRows = new Set();
    const freshKey = (kind, idx, res) => `${kind}|${idx}|${res}`;
    KIND_KEYS.forEach((k) => {
      owned[k] = STARTING_STATIONS;
      plans[k] = Array.from({ length: STATION_CAP }, () => ({ dest: null, items: [] }));
      runs[k] = Array.from({ length: STATION_CAP }, () => ({
        phase: 'idle', run: null, remaining: 0, ridersAway: 0, pendingRiders: 0,
        destId: null, auto: false, autoStarted: false, loadAt: null, hint: null
      }));
    });

    function trackerLine(r) {
      return r.run.map((it) => `${Math.floor(it.loaded)}/${it.qty} ${displayName(it.res)}`).join(', ');
    }

    function cargoOptions(kind, idx) {
      const taken = new Set(plans[kind][idx].items.map((p) => p.res));
      const opts = [];
      if (!taken.has(WORKERS_RES)) opts.push({ id: WORKERS_RES, name: 'Workers' });
      ownResources().forEach((r) => { if (!taken.has(r.id)) opts.push({ id: r.id, name: displayName(r.id) }); });
      return opts;
    }

    function isCargoStalled(kind, idx) {
      const r = runs[kind][idx];
      if (r.phase !== 'loading' || !r.run) return false;
      if (pool().getAssigned(ID) < 1 || goldStarved) return true;
      const unfilled = r.run.filter((it) => it.loaded < it.qty - 1e-9);
      return unfilled.length > 0 && unfilled.every((it) => window.OrbWeaver.Resources.get(it.res) <= 0);
    }

    // Real resources only — workers never compete for a vehicle's cap.
    function realTotal(kind, idx) {
      return plans[kind][idx].items.filter((p) => p.res !== WORKERS_RES).reduce((a, p) => a + p.qty, 0);
    }
    function clampQty(kind, idx, res, raw) {
      const cap = KINDS[kind].cap;
      const others = plans[kind][idx].items.filter((p) => p.res !== res && p.res !== WORKERS_RES).reduce((a, p) => a + p.qty, 0);
      return Math.max(1, Math.min(raw, cap - others));
    }

    /* ---- Expedition tab ---- */
    function renderExpeditionTab() {
      if (!config.hasInitialExpedition || expeditionPhase !== 'idle') return `<div class="sp-tab-greyed">Visit Academy for more Expeditions.</div>`;
      return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div>
        <div class="hs-body">
          <div class="detail-card-desc">Prepare an expedition to explore the surrounding lands.</div>
          <div class="ts-box sp-req-box">
            <div class="sp-req-row"><span>Workers</span><span data-sp-exp-workers>${expWorkersHtml()}</span></div>
            <div class="sp-req-row"><span>Wood loaded on prep</span><span>${config.expeditionTargetWood}</span></div>
          </div>
          <button class="action-btn" data-sp-action="prepare-mule" data-sp-loc="${LOC}">Prepare Mule</button>
        </div></div>`;
    }
    // Workers counted toward the expedition: idle plus already on this card (prepareMule's own gate).
    function expWorkersHtml() {
      const have = Math.min(EXPEDITION_WORKERS_NEEDED, pool().getIdleCount() + pool().getAssigned(ID));
      return `<span${have < EXPEDITION_WORKERS_NEEDED ? ' class="sp-short"' : ''}>${have}/${EXPEDITION_WORKERS_NEEDED}</span>`;
    }

    /* ---- Resupply tab ---- */
    function renderDestSelector(kind, idx) {
      const dests = availableDestinations();
      const plan = plans[kind][idx];
      if (!plan.dest || !dests.some((d) => d.id === plan.dest)) plan.dest = dests[0] ? dests[0].id : null;
      if (dests.length <= 1) return '';
      return `<select class="sp-select sp-dest-select" data-sp-action="set-dest" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}">
        ${dests.map((d) => `<option value="${d.id}"${d.id === plan.dest ? ' selected' : ''}>${d.label}</option>`).join('')}
      </select>`;
    }

    function renderCargoGrid(kind, idx) {
      const plan = plans[kind][idx], cap = KINDS[kind].cap;
      const resTotal = realTotal(kind, idx);
      const cards = plan.items.map((p) => {
        const isWorkers = p.res === WORKERS_RES;
        const zero = !isWorkers && isZero(p.res);
        const plusDisabled = isWorkers ? pool().getIdleCount() <= 0 : resTotal >= cap;
        const fresh = freshRows.has(freshKey(kind, idx, p.res));
        return `<div class="cargo-card${zero ? ' future' : ''}" data-sp-row="${p.res}">
          <span class="cargo-name">${displayName(p.res)}</span>
          <button class="card-stepper-btn" data-sp-action="qty-minus" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}" data-sp-res="${p.res}" ${p.qty <= 1 ? 'disabled' : ''}>–</button>
          <span class="card-stepper-val${fresh ? ' card-stepper-val-fresh' : ''}" data-sp-action="qty-edit" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}" data-sp-res="${p.res}">${p.qty}</span>
          <button class="card-stepper-btn" data-sp-action="qty-plus" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}" data-sp-res="${p.res}" ${plusDisabled ? 'disabled' : ''}>+</button>
          <button class="sp-remove-btn" data-sp-action="remove-resource" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}" data-sp-res="${p.res}">×</button>
        </div>`;
      }).join('');
      const opts = cargoOptions(kind, idx);
      const dropdown = opts.length
        ? `<select class="sp-select" data-sp-action="add-resource" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}">
            <option value="">+ Add resource…</option>
            ${opts.map((r) => `<option value="${r.id}"${isZero(r.id) ? ' class="sp-option-future"' : ''}>${r.name}${isZero(r.id) ? ' (none in stock)' : ''}</option>`).join('')}
          </select>`
        : '';
      return `<div class="cargo-grid">${cards}</div>${dropdown}
        <div class="sp-cap-line">${resTotal}/${cap} loaded per ${KINDS[kind].label.toLowerCase()}</div>`;
    }

    function renderLoadingView(kind, idx) {
      const r = runs[kind][idx];
      const total = r.run.reduce((a, it) => a + it.qty, 0);
      const loaded = r.run.reduce((a, it) => a + it.loaded, 0);
      const pct = total > 0 ? (loaded / total) * 100 : 0;
      const riders = r.pendingRiders ? `, ${r.pendingRiders} Workers` : '';
      return `<div class="detail-card-desc">Loading: ${trackerLine(r)}${riders}</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
        <button class="action-btn" data-sp-action="cancel-cargo" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}">Cancel</button>`;
    }

    function renderDispatchButton(kind, idx) {
      const r = runs[kind][idx], plan = plans[kind][idx];
      const busy = r.phase !== 'idle';
      const label = busy ? `${KINDS[kind].label} in transit…` : `Dispatch`;
      return `<button class="action-btn" data-sp-action="dispatch" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}" ${busy || plan.items.length <= 0 || !plan.dest ? 'disabled' : ''}>${label}</button>`;
    }

    function renderVehicleColumn(kind, idx) {
      const r = runs[kind][idx];
      const on = r.auto;
      const body = r.phase === 'loading'
        ? renderLoadingView(kind, idx)
        : renderDestSelector(kind, idx) + renderCargoGrid(kind, idx) + renderDispatchButton(kind, idx);
      return `<div class="sp-vehicle-col hs-card" data-sp-station="${kind}${idx}">
        <div class="hs-head">
          <span class="hs-title">${stationLabel(kind, idx)}</span>
          <div class="toggle-switch${on ? ' on' : ''}" data-sp-action="toggle-auto" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}" title="Auto"></div>
        </div>
        <div class="hs-body" data-sp-vehicle-panel="${kind}${idx}">${body}</div>
      </div>`;
    }

    /* One shared purchase control spanning both columns, collapsed to a slim
       strip until asked for. It is a native <details>, deliberately: every
       path that must collapse it (a purchase, a tab switch, closing the
       modal) already re-renders this tab, and fresh markup is closed markup —
       so there is no open/closed flag to hold, reset, or keep out of saves.
       Nothing on the strip hints at cost, so affordability is revealed only
       once opened — and then by each row's own button, which the live tick
       enables and disables in place. Kinds at cap drop their row; when none
       are left the control removes itself entirely. */
    function renderAddStationControl() {
      const buyable = KIND_KEYS.filter((k) => owned[k] < STATION_CAP);
      if (buyable.length === 0) return '';
      return `<details class="sp-add">
        <summary class="sp-strip">ADD STATION</summary>
        <div class="hs-body">
          ${buyable.map((k) => `<div class="sp-panel-row">
            <span><span class="sp-panel-name">${KINDS[k].label}</span><span class="sp-panel-count">${owned[k]}/${STATION_CAP} owned</span></span>
            <button class="action-btn hs-btn-right" data-sp-add-station="${k}" data-sp-loc="${LOC}" ${canAddStation(k) ? '' : 'disabled'}>${STATION_ADD_COST} Gold bars</button>
          </div>`).join('')}
        </div>
      </details>`;
    }

    function renderStationColumn(kind) {
      const cards = [];
      for (let i = 0; i < owned[kind]; i++) cards.push(renderVehicleColumn(kind, i));
      return `<div class="sp-vehicle-col-group">${cards.join('')}</div>`;
    }

    function renderResupplyTab() {
      const body = `<div class="sp-vehicle-row">${KIND_KEYS.map(renderStationColumn).join('')}</div>${renderAddStationControl()}`;
      if (availableDestinations().length) return body;
      // Nowhere to send anything yet: show the full tab, dimmed and unclickable.
      return `<div class="sp-no-dest">No discovered destinations. Use Expedition tab</div><div class="sp-locked" inert>${body}</div>`;
    }

    function adjustQty(kind, idx, res, delta) {
      const p = plans[kind][idx].items.find((x) => x.res === res);
      if (!p) return;
      if (res === WORKERS_RES) {
        if (delta > 0) { if (pool().assign(ID)) p.qty += 1; }
        else if (p.qty > 1) { pool().unassign(ID); p.qty -= 1; }
      } else {
        p.qty = clampQty(kind, idx, res, p.qty + delta);
      }
    }
    function setQty(kind, idx, res, raw) {
      const p = plans[kind][idx].items.find((x) => x.res === res);
      if (!p) return;
      if (res === WORKERS_RES) {
        const target = Math.max(1, Math.floor(raw));
        const delta = target - p.qty;
        if (delta > 0) {
          const grant = Math.min(delta, pool().getIdleCount());
          for (let i = 0; i < grant; i++) pool().assign(ID);
          p.qty += grant;
        } else if (delta < 0) {
          for (let i = 0; i < -delta; i++) pool().unassign(ID);
          p.qty += delta;
        }
      } else {
        p.qty = clampQty(kind, idx, res, raw);
      }
    }

    function patchCargoRows(kind, idx, touchedRes) {
      const plan = plans[kind][idx], cap = KINDS[kind].cap;
      const resTotal = realTotal(kind, idx);
      const scope = `#card-modal-body [data-sp-vehicle-panel="${kind}${idx}"]`;
      if (touchedRes != null) freshRows.delete(freshKey(kind, idx, touchedRes)); // only the row actually pressed loses its hint
      plan.items.forEach((p) => {
        const row = document.querySelector(`${scope} .cargo-card[data-sp-row="${p.res}"]`);
        if (!row) return;
        const val = row.querySelector('.card-stepper-val');
        if (val && val.tagName !== 'INPUT') {
          val.textContent = p.qty;
          if (p.res === touchedRes) val.classList.remove('card-stepper-val-fresh');
        }
        const minus = row.querySelector('[data-sp-action="qty-minus"]');
        const plus = row.querySelector('[data-sp-action="qty-plus"]');
        if (minus) minus.disabled = p.qty <= 1;
        if (plus) plus.disabled = p.res === WORKERS_RES ? pool().getIdleCount() <= 0 : resTotal >= cap;
      });
      const capLine = document.querySelector(`${scope} .sp-cap-line`);
      if (capLine) capLine.textContent = `${resTotal}/${cap} loaded per ${KINDS[kind].label.toLowerCase()}`;
      const goBtn = document.querySelector(`${scope} [data-sp-action="dispatch"]`);
      if (goBtn) goBtn.disabled = runs[kind][idx].phase !== 'idle' || plan.items.length <= 0 || !plan.dest;
    }

    function activateQtyEdit(span, kind, idx, res) {
      if (span.tagName === 'INPUT') return;
      const p = plans[kind][idx].items.find((x) => x.res === res);
      if (!p) return;
      freshRows.delete(freshKey(kind, idx, res)); // clicking in ends the "click here" hint either way
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.className = 'cargo-qty-input';
      input.value = p.qty;
      span.replaceWith(input);
      input.select();

      // Guard against a real double-fire: refreshOpenModal() rebuilds the
      // modal body via innerHTML, which detaches this still-focused input
      // as part of clearing the old content. A focused element being
      // detached makes the browser fire a SECOND, synthetic 'blur' on it —
      // re-entering commit() while the first innerHTML assignment is still
      // tearing down the old tree, which collides and throws. One flag
      // makes commit/cancel idempotent so only the first call ever acts.
      let settled = false;
      function commit() {
        if (settled) return;
        settled = true;
        const raw = parseInt(input.value, 10);
        if (!isNaN(raw)) setQty(kind, idx, res, raw);
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }
      function cancel() {
        if (settled) return;
        settled = true;
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      input.addEventListener('blur', commit);
    }

    function anyLoading() { return KIND_KEYS.some((k) => runs[k].slice(0, owned[k]).some((r) => r.phase === 'loading')); }
    function anyAutoActive() { return KIND_KEYS.some((k) => runs[k].slice(0, owned[k]).some((r) => r.auto && r.phase !== 'idle')); }

    const mechanic = {
      id: ID,
      startHidden: true,
      section: config.section,
      modalTheme: config.modalTheme,
      modalWide: true,
      workerPool: config.workerPool,
      cardName: () => 'Scout Stable',
      isBillable: () => (config.hasInitialExpedition && expeditionPhase === 'preparing') || anyLoading(),
      getStatText() {
        if (pool().getAssigned(ID) === 0) return '';
        if (goldStarved) return 'Stopped';
        if (anyAutoActive()) return 'Auto-loading';
        return mechanic.isBillable() ? '' : 'Stopped';
      },
      getUpgradeBarPct: () => 0,
      patchLiveTrack() {
        KIND_KEYS.forEach((kind) => {
          for (let idx = 0; idx < owned[kind]; idx++) {
            const r = runs[kind][idx];
            if (r.phase !== 'loading' || !r.run) continue;
            const scope = `#card-modal-body [data-sp-vehicle-panel="${kind}${idx}"]`;
            const total = r.run.reduce((a, it) => a + it.qty, 0);
            const loaded = r.run.reduce((a, it) => a + it.loaded, 0);
            const bar = document.querySelector(`${scope} .detail-progress-bar`);
            if (bar) bar.style.width = (total > 0 ? (loaded / total) * 100 : 0).toFixed(1) + '%';
            const desc = document.querySelector(`${scope} .detail-card-desc`);
            if (desc) desc.textContent = 'Loading: ' + trackerLine(r) + (r.pendingRiders ? `, ${r.pendingRiders} Workers` : '');
          }
          const addBtn = document.querySelector(`#card-modal-body [data-sp-add-station="${kind}"]`);
          if (addBtn) addBtn.disabled = !canAddStation(kind);
        });
        if (config.hasInitialExpedition && activeTab === 'expedition' && expeditionPhase === 'idle') {
          const el = document.querySelector('#card-modal-body [data-sp-exp-workers]');
          if (el) el.innerHTML = expWorkersHtml();
        }
      },
      getWorkerDesc() {
        const assigned = pool().getAssigned(ID);
        return assigned === 0 ? '' : `Loading ${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f))}/s`;
      },
      onOpen() {
        activeTab = 'resupply';
      },
      afterRender() {
        if (activeTab !== 'resupply') return;
        document.querySelectorAll('#card-modal-body [data-sp-action="qty-plus"]').forEach((btn) => {
          const kind = btn.dataset.spKind, idx = +btn.dataset.spIdx, res = btn.dataset.spRes;
          window.OrbWeaver.Cards.addHoldBehavior(btn, () => { adjustQty(kind, idx, res, 1); patchCargoRows(kind, idx, res); });
        });
        document.querySelectorAll('#card-modal-body [data-sp-action="qty-minus"]').forEach((btn) => {
          const kind = btn.dataset.spKind, idx = +btn.dataset.spIdx, res = btn.dataset.spRes;
          window.OrbWeaver.Cards.addHoldBehavior(btn, () => { adjustQty(kind, idx, res, -1); patchCargoRows(kind, idx, res); });
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
        const perTick = tickRate * window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f);

        if (goldAvailable) {
          if (config.hasInitialExpedition && expeditionPhase === 'preparing') {
            const actual = window.OrbWeaver.Resources.spend('wood', perTick);
            expeditionCollected += actual;
            expeditionStalled = actual < perTick - 1e-9;
            if (expeditionCollected >= config.expeditionTargetWood) {
              expeditionCollected = config.expeditionTargetWood;
              pool().transferAssignment(ID, config.expeditionMuleId, expeditionWorkersHeld);
              expeditionRidersAway = pool().sequester(config.expeditionMuleId);
              expeditionPhase = 'traveling';
              expeditionRemaining = config.expeditionTravelTime;
              window.OrbWeaver.Footer.push('The expedition mule has departed.');
              if (window.OrbWeaver.Cards.isModalOpenFor(config.expeditionMuleId)) window.OrbWeaver.Cards.closeModal();
            }
          }

          // One worker pool shared by every loading vehicle across both
          // kinds: perTick is divided among them, so total throughput is
          // flat no matter how many are loading. A vehicle whose unfilled
          // cargo has no stock at all can't progress, so it's left out of
          // the divisor and the others absorb its share.
          const loadingNow = [];
          KIND_KEYS.forEach((kind) => {
            for (let idx = 0; idx < owned[kind]; idx++) {
              const r = runs[kind][idx];
              if (r.phase !== 'loading') continue;
              const unfilled = r.run.filter((it) => it.loaded < it.qty - 1e-9);
              loadingNow.push({ kind, idx, r, unfilled });
            }
          });
          const active = loadingNow.filter((v) =>
            v.unfilled.length > 0 && v.unfilled.some((it) => window.OrbWeaver.Resources.get(it.res) > 0));
          const perVehicle = active.length > 0 ? perTick / active.length : 0;
          active.forEach((v) => {
            if (perVehicle <= 0) return;
            const share = perVehicle / v.unfilled.length;
            v.unfilled.forEach((it) => {
              // noCrate: a Wood run loads real Wood only. Crates
              // travel by being chosen as cargo themselves, which
              // is the whole point of them being their own row.
              const actual = window.OrbWeaver.Resources.spend(it.res, Math.min(share, it.qty - it.loaded), true);
              it.loaded += actual;
            });
          });
          loadingNow.forEach((v) => {
            if (v.r.run.every((it) => it.loaded >= it.qty - 1e-9)) completeLoading(v.kind, v.idx);
          });
        }

        KIND_KEYS.forEach((kind) => {
          for (let idx = 0; idx < owned[kind]; idx++) {
            const r = runs[kind][idx];
            if (r.phase === 'idle' && r.auto && r.autoStarted && plans[kind][idx].items.length > 0 && plans[kind][idx].dest) {
              dispatchVehicle(kind, idx, false);
            }
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
        stepperReady: () => false, // no steppers ever — it departs on its own once loaded
        isMuted: () => expeditionPhase === 'preparing',
        getBuildBarPct() {
          if (expeditionPhase === 'preparing') return (expeditionCollected / config.expeditionTargetWood) * 100;
          if (expeditionPhase === 'traveling') return ((config.expeditionTravelTime - expeditionRemaining) / config.expeditionTravelTime) * 100;
          return 0;
        },
        getStatText() {
          if (expeditionPhase === 'preparing') return `${expeditionStalled ? 'Stopped – ' : ''}Preparing mule – ${Math.floor(expeditionCollected)}/${config.expeditionTargetWood} wood`;
          if (expeditionPhase === 'traveling') return `On Expedition… ${Math.ceil(expeditionRemaining)}s`;
          return '';
        },
        patchBuildStatus() {
          if (expeditionPhase === 'preparing') return `${Math.floor(expeditionCollected)}/${config.expeditionTargetWood} wood`;
          if (expeditionPhase === 'traveling') return `${Math.ceil(expeditionRemaining)}s remaining`;
          return null;
        },
        renderModalHTML() {
          if (expeditionPhase === 'traveling') {
            return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div><div class="hs-body">
              <div class="detail-card-desc">On expedition…</div>
              <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
              <div class="detail-status"><span>${Math.ceil(expeditionRemaining)}s remaining</span></div>
            </div></div>`;
          }
          return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div><div class="hs-body">
            <div class="detail-card-desc">Preparing a mule for expedition — ${expeditionWorkersHeld} Workers assigned.</div>
            <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
            <div class="detail-status"><span>${Math.floor(expeditionCollected)}/${config.expeditionTargetWood} wood</span></div>
            <button class="action-btn" data-sp-action="cancel-expedition" data-sp-loc="${LOC}">Cancel</button>
          </div></div>`;
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
      const alreadyOn = pool().getAssigned(ID);
      const shortfall = EXPEDITION_WORKERS_NEEDED - alreadyOn;
      if (shortfall > pool().getIdleCount()) return; // the red Workers count already shows why
      for (let i = 0; i < shortfall; i++) pool().assign(ID);
      expeditionWorkersHeld = EXPEDITION_WORKERS_NEEDED;
      expeditionPhase = 'preparing';
      window.OrbWeaver.Cards.reveal(expeditionMuleMechanic);
      window.OrbWeaver.Cards.closeModal();
    }
    function cancelExpedition() {
      if (!config.hasInitialExpedition || expeditionPhase !== 'preparing') return;
      const space = (window.OrbWeaver.Resources.getCap('wood') ?? Infinity) - window.OrbWeaver.Resources.get('wood');
      window.OrbWeaver.Resources.add('wood', Math.min(expeditionCollected, space));
      for (let i = 0; i < expeditionWorkersHeld; i++) pool().unassign(ID);
      expeditionWorkersHeld = 0;
      expeditionCollected = 0; expeditionStalled = false; expeditionPhase = 'idle';
      window.OrbWeaver.Cards.hide(expeditionMuleMechanic);
      if (window.OrbWeaver.Cards.isModalOpenFor(config.expeditionMuleId)) window.OrbWeaver.Cards.closeModal();
    }
    function completeExpedition() {
      expeditionPhase = 'delivered';
      window.OrbWeaver.Cards.hide(expeditionMuleMechanic);
      if (config.onExpeditionComplete) config.onExpeditionComplete(expeditionRidersAway);
    }

    /* ---------------- Cargo vehicle stations ---------------- */
    // Every possible station up to STATION_CAP is pre-registered here
    // (hidden), for every kind. Only `owned[kind]` of them are ever
    // shown in the Scout Stable's own modal; any of them can be
    // revealed on the grid once dispatched, regardless of ownership
    // count at registration time (buying more later just means more of
    // these already-registered cards become reachable).
    const cargoMechanics = {};
    KIND_KEYS.forEach((kind) => {
      cargoMechanics[kind] = [];
      for (let idx = 0; idx < STATION_CAP; idx++) {
        cargoMechanics[kind].push(makeCargoMechanic(kind, idx));
      }
    });

    function makeCargoMechanic(kind, idx) {
      const cfg = KINDS[kind];
      const id = cardIdFor(kind, idx);
      const obj = {
        id, startHidden: true, section: config.section,
        isMule: true, modalTheme: 'theme-mule', upkeepExempt: true, gapOnHide: true,
        workerPool: config.workerPool,
        cardName: () => stationLabel(kind, idx),
        // Rail rate hint for an auto run (js/core/rates.js), until 2 arrivals are measured.
        rateHint: (rid) => { const r = runs[kind][idx]; return r.auto && r.hint ? r.hint[rid] : undefined; },
        getUpgradeBarPct: () => 0,
        stepperReady: () => false, // no steppers — dispatch never needs a worker
        isBuildBarFaded: () => runs[kind][idx].phase === 'loading',
        getBuildBarPct() {
          const r = runs[kind][idx];
          if (r.phase === 'traveling') return ((cfg.travel - r.remaining) / cfg.travel) * 100;
          if (!r.run) return 0;
          const need = r.run.reduce((a, it) => a + it.qty, 0);
          return need > 0 ? (r.run.reduce((a, it) => a + it.loaded, 0) / need) * 100 : 0;
        },
        getStatText() {
          const r = runs[kind][idx];
          if (r.phase === 'traveling') return `Traveling… ${Math.ceil(r.remaining)}s`;
          if (r.phase === 'loading') {
            const riders = r.pendingRiders ? `, ${r.pendingRiders} Workers` : '';
            return `${isCargoStalled(kind, idx) ? 'Stopped' : 'Loading'} – ${trackerLine(r)}${riders}`;
          }
          return '';
        },
        patchBuildStatus() {
          const r = runs[kind][idx];
          if (r.phase === 'traveling') return `${Math.ceil(r.remaining)}s remaining`;
          if (r.phase === 'loading') return trackerLine(r);
          return null;
        },
        renderModalHTML() {
          const r = runs[kind][idx];
          const destLabel = destinationById(r.destId)?.label ?? 'its destination';
          const head = `<div class="hs-head"><span class="hs-title">${stationLabel(kind, idx)}</span></div>`;
          if (r.phase === 'traveling') {
            const cargo = r.run ? r.run.map((it) => `${Math.floor(it.loaded)} ${displayName(it.res)}`).join(', ') : '';
            const riderNote = r.ridersAway > 0 ? `${cargo ? ', ' : ''}${r.ridersAway} Workers` : '';
            return `<div class="hs-card">${head}<div class="hs-body">
              <div class="detail-card-desc">On the road to ${destLabel}…</div>
              ${(cargo || riderNote) ? `<div class="detail-card-desc">${cargo}${riderNote}</div>` : ''}
              <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
              <div class="detail-status"><span>${Math.ceil(r.remaining)}s remaining</span></div>
            </div></div>`;
          }
          return `<div class="hs-card">${head}<div class="hs-body">
            <div class="detail-card-desc">Loading cargo bound for ${destLabel}.</div>
            <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
            <div class="detail-status"><span>${r.run ? trackerLine(r) : ''}</span></div>
            <button class="action-btn" data-sp-action="cancel-cargo" data-sp-loc="${LOC}" data-sp-kind="${kind}" data-sp-idx="${idx}">Cancel</button>
          </div></div>`;
        },
        tick(goldAvailable, tickRate) {
          const r = runs[kind][idx];
          if (r.phase === 'traveling') {
            r.remaining -= tickRate;
            if (r.remaining <= 0) completeVehicle(kind, idx);
          }
          window.OrbWeaver.Cards.refresh(obj);
        }
      };
      return obj;
    }

    /* ---- Save/load ----
       No migration from the old single-mule save shape — this is still
       active development with no players to preserve saves for.
       ridersAway/pendingRiders: sequester() removes a rider's crew from
       the pool entirely (decrements `total`); saving both alongside
       phase/remaining is what makes a rider mid-trip survive a save. */
    function serializeRun(r) {
      return {
        p: r.phase, rem: r.remaining, ra: r.ridersAway, pr: r.pendingRiders || 0, d: r.destId,
        a: r.auto ? 1 : 0, as: r.autoStarted ? 1 : 0,
        run: r.run ? r.run.map((it) => ({ r: it.res, q: it.qty, l: it.loaded })) : null
      };
    }
    function restoreRun(r, d) {
      if (!d) return;
      r.phase = d.p || 'idle';
      r.remaining = d.rem || 0;
      r.ridersAway = d.ra || 0;
      r.pendingRiders = d.pr || 0;
      r.destId = d.d || null;
      r.auto = !!d.a;
      r.autoStarted = !!d.as;
      r.run = d.run ? d.run.map((it) => ({ res: it.r, qty: it.q, loaded: it.l })) : null;
      r.loadAt = null; r.hint = null; // not saved — the hint returns after the next load
    }

    window.OrbWeaver.Save.register(ID,
      () => ({
        ep: expeditionPhase, ec: expeditionCollected,
        er: expeditionRemaining, era: expeditionRidersAway, ewh: expeditionWorkersHeld,
        owned: Object.assign({}, owned),
        plans: KIND_KEYS.reduce((acc, k) => {
          acc[k] = plans[k].map((pl) => ({ dest: pl.dest, items: pl.items.map((i) => ({ res: i.res, qty: i.qty })) }));
          return acc;
        }, {}),
        runs: KIND_KEYS.reduce((acc, k) => { acc[k] = runs[k].map(serializeRun); return acc; }, {})
      }),
      (d) => {
        if (!d) return;
        expeditionPhase = d.ep || 'idle';
        expeditionCollected = d.ec || 0;
        expeditionRemaining = d.er || 0;
        expeditionRidersAway = d.era || 0;
        expeditionWorkersHeld = d.ewh || 0;
        KIND_KEYS.forEach((k) => {
          owned[k] = (d.owned && d.owned[k]) || STARTING_STATIONS;
          const savedPlans = (d.plans && d.plans[k]) || [];
          savedPlans.forEach((sp, i) => {
            if (!plans[k][i]) return;
            plans[k][i].dest = sp.dest || null;
            plans[k][i].items = (sp.items || []).map((it) => ({ res: it.res, qty: it.qty }));
          });
          const savedRuns = (d.runs && d.runs[k]) || [];
          savedRuns.forEach((sr, i) => { if (runs[k][i]) restoreRun(runs[k][i], sr); });
        });
      });

    function dispatchVehicle(kind, idx, manual) {
      const r = runs[kind][idx], plan = plans[kind][idx];
      if (r.phase !== 'idle' || !plan.dest || plan.items.length === 0) return;
      const workerItem = plan.items.find((it) => it.res === WORKERS_RES);
      r.pendingRiders = workerItem ? workerItem.qty : 0;
      r.run = plan.items.filter((it) => it.res !== WORKERS_RES).map((it) => ({ res: it.res, qty: it.qty, loaded: 0 }));
      r.phase = 'loading';
      r.destId = plan.dest;
      r.autoStarted = r.auto;
      r.loadAt = window.OrbWeaver.Rates.now();
      window.OrbWeaver.Cards.reveal(cargoMechanics[kind][idx]);
      if (manual) window.OrbWeaver.Cards.closeModal();
    }

    // Loading finished — always proceeds straight to traveling (no
    // worker required to depart, manual or auto alike). Any workers
    // riding along transfer onto the vehicle's own id and sequester
    // for the trip.
    function completeLoading(kind, idx) {
      const r = runs[kind][idx];
      if (r.pendingRiders > 0) {
        pool().transferAssignment(ID, cardIdFor(kind, idx), r.pendingRiders);
        r.ridersAway = pool().sequester(cardIdFor(kind, idx));
      } else {
        r.ridersAway = 0;
      }
      r.pendingRiders = 0;
      // Hint: cargo ÷ (this load + travel), per destination resource.
      const dest = destinationById(r.destId), cycle = r.loadAt == null ? 0 : window.OrbWeaver.Rates.now() - r.loadAt + KINDS[kind].travel;
      r.hint = dest && cycle > 0 ? Object.fromEntries(r.run.map((it) => [dest.prefix + it.res.replace(config.resourcePrefix, ''), it.loaded / cycle])) : null;
      r.phase = 'traveling';
      r.remaining = KINDS[kind].travel;
      if (window.OrbWeaver.Cards.isModalOpenFor(cardIdFor(kind, idx))) window.OrbWeaver.Cards.closeModal();
    }

    function cancelVehicle(kind, idx) {
      const r = runs[kind][idx];
      if (r.phase !== 'loading') return;
      if (r.run) r.run.forEach((it) => {
        const space = (window.OrbWeaver.Resources.getCap(it.res) ?? Infinity) - window.OrbWeaver.Resources.get(it.res);
        window.OrbWeaver.Resources.add(it.res, Math.min(it.loaded, space));
      });
      if (r.pendingRiders) { for (let i = 0; i < r.pendingRiders; i++) pool().unassign(ID); }
      r.phase = 'idle'; r.run = null; r.pendingRiders = 0; r.auto = false; r.autoStarted = false;
      window.OrbWeaver.Cards.hide(cargoMechanics[kind][idx]);
      if (window.OrbWeaver.Cards.isModalOpenFor(cardIdFor(kind, idx))) window.OrbWeaver.Cards.closeModal();
      else if (window.OrbWeaver.Cards.isModalOpenFor(ID)) window.OrbWeaver.Cards.refreshOpenModal(ID);
    }

    function completeVehicle(kind, idx) {
      const r = runs[kind][idx];
      const dest = destinationById(r.destId);
      if (dest) {
        (r.run || []).forEach((it) => {
          dest.ensureResource(it.res.replace(config.resourcePrefix, ''), displayName(it.res));
          window.OrbWeaver.Resources.add(dest.prefix + it.res.replace(config.resourcePrefix, ''), it.loaded);
        });
        dest.addWorkers(r.ridersAway);
      }
      window.OrbWeaver.Footer.push(`The ${KINDS[kind].label.toLowerCase()} arrived at ${dest ? dest.label : 'its destination'}.`);
      r.phase = 'idle'; r.run = null; r.ridersAway = 0; r.destId = null; r.autoStarted = r.auto;
      window.OrbWeaver.Cards.hide(cargoMechanics[kind][idx]);
    }

    document.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-sp-add-station]');
      if (addBtn && addBtn.dataset.spLoc === LOC) { addStation(addBtn.dataset.spAddStation); return; }

      const btn = e.target.closest('[data-sp-action]');
      if (!btn || btn.dataset.spLoc !== LOC) return;
      const action = btn.dataset.spAction;
      const kind = btn.dataset.spKind;
      const idx = btn.dataset.spIdx != null ? +btn.dataset.spIdx : null;
      if (action === 'tab') { activeTab = btn.dataset.spTab; window.OrbWeaver.Cards.refreshOpenModal(ID); }
      else if (action === 'prepare-mule') prepareMule();
      else if (action === 'cancel-expedition') cancelExpedition();
      else if (action === 'toggle-auto') { runs[kind][idx].auto = !runs[kind][idx].auto; window.OrbWeaver.Cards.refreshOpenModal(ID); }
      else if (action === 'dispatch') dispatchVehicle(kind, idx, true);
      else if (action === 'cancel-cargo') cancelVehicle(kind, idx);
      else if (action === 'remove-resource') {
        const res = btn.dataset.spRes;
        const plan = plans[kind][idx];
        const item = plan.items.find((it) => it.res === res);
        if (item && item.res === WORKERS_RES) { for (let i = 0; i < item.qty; i++) pool().unassign(ID); }
        plan.items = plan.items.filter((it) => it.res !== res);
        freshRows.delete(freshKey(kind, idx, res));
        window.OrbWeaver.Cards.refreshOpenModal(ID);
      }
      else if (action === 'qty-edit') activateQtyEdit(btn, kind, idx, btn.dataset.spRes);
    });
    document.addEventListener('change', (e) => {
      const addSel = e.target.closest(`[data-sp-action="add-resource"][data-sp-loc="${LOC}"]`);
      if (addSel && addSel.value) {
        const kind = addSel.dataset.spKind, idx = +addSel.dataset.spIdx;
        const plan = plans[kind][idx];
        if (addSel.value === WORKERS_RES) {
          if (pool().assign(ID)) { plan.items.push({ res: WORKERS_RES, qty: 1 }); freshRows.add(freshKey(kind, idx, WORKERS_RES)); }
        } else {
          const cap = KINDS[kind].cap;
          const used = realTotal(kind, idx);
          if (used >= cap) {
            const lastReal = [...plan.items].reverse().find((it) => it.res !== WORKERS_RES);
            if (lastReal) lastReal.qty = Math.max(1, lastReal.qty - 1);
          }
          plan.items.push({ res: addSel.value, qty: 1 });
          freshRows.add(freshKey(kind, idx, addSel.value));
        }
        window.OrbWeaver.Cards.refreshOpenModal(ID);
        return;
      }
      const destSel = e.target.closest(`[data-sp-action="set-dest"][data-sp-loc="${LOC}"]`);
      if (destSel) plans[destSel.dataset.spKind][+destSel.dataset.spIdx].dest = destSel.value;
    });

    window.OrbWeaver.Mechanics.register(mechanic);
    if (expeditionMuleMechanic) window.OrbWeaver.Mechanics.register(expeditionMuleMechanic);
    KIND_KEYS.forEach((kind) => cargoMechanics[kind].forEach((m) => window.OrbWeaver.Mechanics.register(m)));

    // Every pre-registered station card's id, per kind — main.js builds
    // all of them (hidden until dispatched) instead of hardcoding ids or
    // needing to know STATION_CAP itself.
    const vehicleIds = {};
    KIND_KEYS.forEach((kind) => { vehicleIds[kind] = cargoMechanics[kind].map((m) => m.id); });
    return { vehicleIds };
  }

  window.OrbWeaver.ScoutStable = { create: createScoutStable };
})();
