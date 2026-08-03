/* ============================================================
   CORE: UPGRADES
   Two track types, both generic and reusable by any mechanic:

   1) create(table, renderEffect, collapsible) — sequential ladder
      (Wood/Stone/Builder's Bench self-upgrade). renderEffect is an
      optional (row, prevRow, liveStats, i) => html function; when
      omitted, the original Cap/Rate formula is used unchanged.
      collapsible (optional) adds a header arrow that hides the
      row list down to one summary line — omitted entirely (no
      header rendered) unless explicitly requested, so Wood/Stone's
      markup is byte-identical to before.

   2) createChoiceTrack(items, onComplete) — independent-choice,
      single-build-slot list (Builder's Bench's Construction list).
      Every item is buildable in any order the player likes, but
      only one can be mid-build at a time; items require full
      up-front payment (no partial auto-collection), can be hidden
      behind a gold-cost early reveal, and drop off the list for
      good once built.

   advanceTimer's 4th arg (secondsPerWorker) is optional on both
   track types and defaults to 0.2 — Wood/Stone never pass it, so
   their timers behave exactly as before.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  function parseCost(str) {
    const cost = {};
    if (!str) return cost;
    str.split(',').forEach((part) => {
      const [amount, ...nameParts] = part.trim().split(' ');
      cost[nameParts.join(' ').toLowerCase()] = parseFloat(amount);
    });
    return cost;
  }

  const tracks = {}; // 'mechanicId' or 'mechanicId:trackKey' -> track
  let lastCollapseAt = 0; // debounces duplicate mobile taps on the collapse arrow

  /* ---------------- Sequential ladder (Wood/Stone/self-upgrade) ---------------- */
  function create(table, renderEffect, collapsible) {
    const parsed = table.map((row) => ({ ...row, cost: parseCost(row.costRaw) }));
    let index = 0;
    let reservation = {};
    let collected = false;
    let timeRemaining = null;
    let collapsed = !!collapsible;

    function current() { return parsed[index] || null; }
    function toggleCollapse() { if (collapsible) collapsed = !collapsed; }
    function isCollapsed() { return collapsed; }

    function canFullyAfford(row) {
      return Object.keys(row.cost).every((id) => window.OrbWeaver.Resources.get(id) >= row.cost[id]);
    }

    function checkFullyCollected(row) {
      if (Object.keys(row.cost).every((id) => (reservation[id] || 0) >= row.cost[id])) {
        collected = true;
        timeRemaining = row.buildTime;
      }
    }

    function start() {
      const row = current();
      if (!row || collected) return;
      reservation = {};
      Object.keys(row.cost).forEach((id) => {
        reservation[id] = window.OrbWeaver.Resources.spend(id, row.cost[id]);
      });
      const under = Object.keys(row.cost).some((id) => reservation[id] < row.cost[id]);
      if (under) window.OrbWeaver.Footer.push(`Not enough resources for ${row.name} — collecting the rest automatically.`);
      checkFullyCollected(row);
    }

    function cancel() {
      const row = current();
      if (!row || Object.keys(reservation).length === 0) return;
      const refund = reservation;
      reservation = {};
      collected = false;
      timeRemaining = null;
      Object.keys(refund).forEach((id) => window.OrbWeaver.Resources.add(id, refund[id]));
      window.OrbWeaver.Footer.push(`${row.name} upgrade canceled — resources returned.`);
    }

    function collectProduced(id, amount) {
      const row = current();
      const inProgress = Object.keys(reservation).length > 0;
      if (!row || collected || !inProgress || amount <= 0 || row.cost[id] == null) return 0;
      const have = reservation[id] || 0;
      const room = Math.max(0, row.cost[id] - have);
      const used = Math.min(room, amount);
      if (used > 0) {
        reservation[id] = have + used;
        checkFullyCollected(row);
      }
      return used;
    }

    // secondsPerWorker optional, defaults to 0.2 (today's fixed rule).
    function advanceTimer(tickRate, assigned, onComplete, secondsPerWorker) {
      if (!collected) return;
      const spw = secondsPerWorker != null ? secondsPerWorker : 0.2;
      timeRemaining -= tickRate + (assigned * spw * tickRate);
      if (timeRemaining <= 0) {
        const row = current();
        onComplete(row);
        index++;
        reservation = {};
        collected = false;
        timeRemaining = null;
        window.OrbWeaver.Footer.push(`${row.name} complete!`);
      }
    }

    function isBuilding() { return collected; }

    function getCardProgressPct() {
      if (!collected) return 0;
      const row = current();
      return ((row.buildTime - timeRemaining) / row.buildTime) * 100;
    }

    function resourceTracker(row) {
      const resources = Object.keys(row.cost).map((id) => {
        const have = collected ? row.cost[id]
          : Object.keys(reservation).length > 0 ? (reservation[id] || 0)
          : window.OrbWeaver.Resources.get(id);
        const label = id.charAt(0).toUpperCase() + id.slice(1);
        return `${Math.round(have)}/${Math.round(row.cost[id])} ${label}`;
      }).join(' ');
      return `${resources} – ${row.buildTime}s`;
    }

    function isCollecting() { return Object.keys(reservation).length > 0 && !collected; }

    // 0-100 progress of resource collection toward the current tier's cost —
    // shared by the modal's Cancel-collecting button fill and the card
    // face's top bar (see getBarPct).
    function getCollectPct() {
      const row = current();
      if (!row || !isCollecting()) return 0;
      const totalNeeded = Object.values(row.cost).reduce((a, b) => a + b, 0);
      const totalHave = Object.keys(row.cost).reduce((a, id) => a + (reservation[id] || 0), 0);
      return Math.min(100, totalNeeded > 0 ? (totalHave / totalNeeded) * 100 : 0);
    }

    // Single number for the card face's top bar: collection progress while
    // gathering resources, build progress once collected and building.
    function getBarPct() { return isCollecting() ? getCollectPct() : getCardProgressPct(); }

    // trackKey optional — stamps data-track on buttons/progress bar so a
    // mechanic with more than one track (e.g. Builder's Bench) can tell
    // its bars/buttons apart. Omitted (Wood/Stone): markup unchanged.
    function renderModalHTML(mechanicId, liveStats, trackKey, arrowHTML) {
      const trackAttr = trackKey ? ` data-track="${trackKey}"` : '';
      const rows = collapsible && collapsed
        ? [parsed[index]]
        : [parsed[index], parsed[index + 1], parsed[index + 2]];
      return rows.map((row, i) => {
        if (!row) return '';
        const locked = i > 0;
        const prevRow = i === 0 ? null : parsed[index + i - 1];
        const effectLine = renderEffect
          ? renderEffect(row, prevRow, liveStats, i)
          : (() => {
              const prevCap = i === 0 ? liveStats.cap : prevRow.newCap;
              const prevRate = i === 0 ? liveStats.rate : prevRow.gainPerWorker;
              return `Cap: ${prevCap} → <strong>${row.newCap}</strong> · Rate: ${prevRate.toFixed(2)}/s → <strong>${row.gainPerWorker.toFixed(2)}/s</strong> per worker`;
            })();

        const arrow = (i === 0 && arrowHTML) ? arrowHTML : '';
        let titleRowRight = `<span class="upgrade-cost">${i === 0 ? resourceTracker(row) : (row.costRaw || '—')}</span>`;
        let bodyRows = `<div class="upgrade-effect">${effectLine}</div>`;
        let extraBody = '';

        if (i === 0) {
          if (collected) {
            const assigned = window.OrbWeaver.Workers.getAssigned(mechanicId);
            const workerPart = assigned > 0
              ? `<span class="detail-status-sep">·</span><span>${assigned} worker${assigned > 1 ? 's' : ''} reducing ${assigned}/s</span>`
              : '';
            extraBody = `
              <div class="detail-progress-wrap"><div class="detail-progress-bar"${trackAttr}></div></div>
              <div class="detail-status"><span>Building — ${Math.ceil(timeRemaining)}s remaining</span>${workerPart}</div>
              <button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="cancel">Cancel</button>`;
          } else if (Object.keys(reservation).length > 0) {
            const pct = getCollectPct().toFixed(1);
            extraBody = `<button class="action-btn collect-btn" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="cancel" style="--collect-pct:${pct}%">Cancel collecting</button>`;
          } else {
            const label = canFullyAfford(row) ? 'Build upgrade' : 'Collect Resources';
            if (collapsed) {
              // Collapsed: button fills the title row's remaining width.
              // Cost + effect sit on one shrinkable line below.
              titleRowRight = `<button class="action-btn collapsed-action" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="start">${label}</button>`;
              bodyRows = `<div class="upgrade-cost-sub"><span class="upgrade-cost-part">${resourceTracker(row)}</span><span class="upgrade-effect-part">${effectLine}</span></div>`;
            } else {
              extraBody = `<button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="start">${label}</button>`;
            }
          }
        }

        return `
          <div class="upgrade-row ${locked ? 'locked' : ''}">
            <div class="upgrade-row-top">
              <span class="upgrade-name">${arrow}${row.name}</span>
              ${titleRowRight}
            </div>
            ${bodyRows}${extraBody}
          </div>`;
      }).join('');
    }

    // Always returns the live resource tracker string so patchOpenModal
    // can keep the cost display current every tick regardless of state.
    function getResourceTrackerAlways() {
      const row = current();
      return row ? resourceTracker(row) : null;
    }

    return { current, start, cancel, collectProduced, advanceTimer, isBuilding, isCollecting,
             getCardProgressPct, getCollectPct, getBarPct, renderModalHTML, toggleCollapse, isCollapsed,
             getResourceTracker: getResourceTrackerAlways,
             getBuildStatusText: () => collected ? `Building — ${Math.ceil(timeRemaining)}s remaining` : null };
  }

  /* ---------------- Choice track (Construction list) ----------------
     Every item is independently buildable (full up-front cost, no
     partial auto-collection), only one item builds at a time, items
     may start unavailable (not shown at all) or hidden ("???" with a
     gold-cost early reveal), and drop off the list permanently once
     built. onComplete(itemId, item) lets the mechanic react (e.g.
     reveal a resource) when a specific item finishes. */
  function createChoiceTrack(items, onComplete) {
    const state = {};
    items.forEach((it) => { state[it.id] = { available: !!it.startAvailable, hidden: !!it.startHidden, built: false }; });
    let activeId = null;
    let timeRemaining = null;

    function itemById(id) { return items.find((i) => i.id === id); }
    function cost(item) { return parseCost(item.costRaw); }

    function canAfford(item) {
      const c = cost(item);
      return Object.keys(c).every((id) => window.OrbWeaver.Resources.get(id) >= c[id]);
    }

    function canReveal(item) {
      if (!item || !item.revealCost) return false;
      return Object.keys(item.revealCost).every((id) => window.OrbWeaver.Resources.get(id) >= item.revealCost[id]);
    }

    function unlock(id) {
      const s = state[id];
      if (s) { s.available = true; s.hidden = false; }
    }

    function revealWithGold(id) {
      const item = itemById(id), s = state[id];
      if (!item || !s || !s.hidden || !canReveal(item)) return;
      Object.keys(item.revealCost).forEach((rid) => window.OrbWeaver.Resources.spend(rid, item.revealCost[rid]));
      s.hidden = false;
      window.OrbWeaver.Footer.push(`${item.name} revealed!`);
    }

    function start(id) {
      if (activeId) return;
      const item = itemById(id), s = state[id];
      if (!item || !s || !s.available || s.hidden || s.built) return;
      if (!canAfford(item)) return;
      const c = cost(item);
      Object.keys(c).forEach((rid) => window.OrbWeaver.Resources.spend(rid, c[rid]));
      activeId = id;
      timeRemaining = item.buildTime;
    }

    function cancel(id) {
      if (activeId !== id) return;
      const item = itemById(id);
      const c = cost(item);
      Object.keys(c).forEach((rid) => window.OrbWeaver.Resources.add(rid, c[rid]));
      activeId = null;
      timeRemaining = null;
      window.OrbWeaver.Footer.push(`${item.name} construction canceled — resources returned.`);
    }

    function isBuilding() { return activeId !== null; }
    function activeItem() { return activeId ? itemById(activeId) : null; }
    function getRemaining() { return timeRemaining; }

    function getProgressPct() {
      if (!activeId) return 0;
      const item = itemById(activeId);
      return ((item.buildTime - timeRemaining) / item.buildTime) * 100;
    }

    // secondsPerWorker optional, defaults to 0.2 — Construction always
    // uses the flat default regardless of the mechanic's own tier.
    function advanceTimer(tickRate, assigned, secondsPerWorker) {
      if (!activeId) return;
      const spw = secondsPerWorker != null ? secondsPerWorker : 0.2;
      timeRemaining -= tickRate + (assigned * spw * tickRate);
      if (timeRemaining <= 0) {
        const item = itemById(activeId);
        const finishedId = activeId;
        state[finishedId].built = true;
        activeId = null;
        timeRemaining = null;
        window.OrbWeaver.Footer.push(`${item.name} complete!`);
        if (onComplete) onComplete(finishedId, item);
      }
    }

    function renderModalRows(mechanicId, trackKey) {
      const trackAttr = trackKey ? ` data-track="${trackKey}"` : '';
      return items.map((item) => {
        const s = state[item.id];
        if (!s.available || s.built) return '';
        if (s.hidden) {
          return `<div class="upgrade-row" data-item="${item.id}">
            <div class="upgrade-row-horizontal">
              <div class="upgrade-text-stack"><span class="upgrade-name">???</span></div>
              <button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-item="${item.id}" data-upgrade-action="reveal" ${canReveal(item) ? '' : 'disabled'}>Reveal (${item.revealCostRaw})</button>
            </div>
          </div>`;
        }
        const textStack = `
          <div class="upgrade-text-stack">
            <span class="upgrade-name">${item.name}</span>
            <span class="upgrade-desc">Description coming soon.</span>
          </div>`;
        const c = cost(item);
        const trackerStr = Object.keys(c).map((id) => {
          const have = activeId === item.id ? c[id] : window.OrbWeaver.Resources.get(id);
          const label = id.charAt(0).toUpperCase() + id.slice(1);
          return `${Math.round(have)}/${Math.round(c[id])} ${label}`;
        }).join(' ');
        const costTime = `<div class="upgrade-costtime">${trackerStr} – ${item.buildTime}s</div>`;
        if (activeId === item.id) {
          const pct = getProgressPct().toFixed(1);
          return `<div class="upgrade-row" data-item="${item.id}">
            <div class="upgrade-row-horizontal">${textStack}</div>
            ${costTime}
            <div class="detail-progress-wrap"><div class="detail-progress-bar"${trackAttr} style="width:${pct}%"></div></div>
            <div class="detail-status"><span>Building — ${Math.ceil(timeRemaining)}s remaining</span></div>
            <button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-item="${item.id}" data-upgrade-action="cancel">Cancel</button>
          </div>`;
        }
        const disabled = activeId !== null || !canAfford(item);
        return `<div class="upgrade-row" data-item="${item.id}">
          <div class="upgrade-row-horizontal">
            <div class="upgrade-text-stack">
              <span class="upgrade-name">${item.name}</span>
              <span class="upgrade-desc">Description coming soon.</span>
            </div>
            <div class="upgrade-action-stack">
              <button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-item="${item.id}" data-upgrade-action="start" ${disabled ? 'disabled' : ''}>Build</button>
              ${costTime}
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // Live-patches rows already in the DOM (cost trackers, disabled
    // buttons, the active item's countdown/bar) without touching
    // structure — same "patch, don't rebuild" rule the self-upgrade
    // ladder already follows, applied to the Construction list.
    function patchModalRows() {
      items.forEach((item) => {
        const s = state[item.id];
        if (!s.available || s.built) return;
        const row = document.querySelector(`#card-modal-body .upgrade-row[data-item="${item.id}"]`);
        if (!row) return;
        if (s.hidden) {
          const btn = row.querySelector('[data-upgrade-action="reveal"]');
          if (btn) btn.disabled = !canReveal(item);
          return;
        }
        if (activeId === item.id) {
          const bar = row.querySelector('.detail-progress-bar');
          if (bar) bar.style.width = getProgressPct().toFixed(1) + '%';
          const statusSpan = row.querySelector('.detail-status span');
          if (statusSpan) statusSpan.textContent = `Building — ${Math.ceil(timeRemaining)}s remaining`;
          return;
        }
        const c = cost(item);
        const trackerStr = Object.keys(c).map((id) => {
          const have = window.OrbWeaver.Resources.get(id);
          const label = id.charAt(0).toUpperCase() + id.slice(1);
          return `${Math.round(have)}/${Math.round(c[id])} ${label}`;
        }).join(' ');
        const costEl = row.querySelector('.upgrade-costtime');
        if (costEl) costEl.textContent = `${trackerStr} – ${item.buildTime}s`;
        const btn = row.querySelector('[data-upgrade-action="start"]');
        if (btn) btn.disabled = activeId !== null || !canAfford(item);
      });
    }

    function availableCount() { return items.filter((it) => state[it.id].available && !state[it.id].hidden && !state[it.id].built).length; }

    return { unlock, revealWithGold, start, cancel, isBuilding, activeItem, getRemaining, getProgressPct, availableCount, advanceTimer, renderModalRows, patchModalRows };
  }

  /* ---------------- Sell track (Market) ----------------
     Per-resource sell cards sharing one pool of "sale slots"
     (maxConcurrent). Each resource has 1–2 selectable bundles, an
     optional auto-sell toggle (+ a lock that keeps it on through a
     gold-cap loss), full up-front resource cost, a timed gold payout,
     and a cancel (refund).

     Sale timing copies the self-upgrade ladder's own mechanism exactly:
     each sale starts with `remaining = baseTime` and every tick
     subtracts `tickRate + assigned*spw*tickRate` (see the sequential
     ladder's advanceTimer above) — an accelerating clock, not a
     shrinking target, so assigning/unassigning workers mid-sale speeds
     up or slows the remaining time live, same as any ladder build.

     One addition the ladder itself doesn't have: `floorTime` is kept as
     a hard minimum on REAL elapsed seconds (tracked separately via
     `realElapsed`), so no amount of worker stacking can finish a sale
     faster than floorTime real seconds — a safety clamp specific to
     Market, layered on top of the borrowed mechanism rather than part
     of it.

     config: { baseTime, floorTime, getAssigned(), getSPW() }.
     Mechanic drives it: unlockResource/enableAuto/setBundles/
     setMaxConcurrent (from ladder effects), tick(), and the render/
     query helpers. */
  function createSellTrack(defs, config) {
    const res = defs.map((d) => ({ ...d, unlocked: false, auto: false, autoOn: false, autoLocked: false, sel: 0, sale: null, bumpUntil: 0 }));
    let maxConcurrent = 1;
    const byId = (id) => res.find((r) => r.id === id);
    const activeCount = () => res.filter((r) => r.sale).length;
    const toggledCount = () => res.filter((r) => r.autoOn).length;
    const amt = (r) => r.bundles[r.sel];
    const goldFor = (r) => Math.round(amt(r) * r.goldPerUnit);

    // Effective remaining time for one sale: the accelerated countdown,
    // floored by how much real time must still pass to satisfy floorTime.
    // Whichever is larger wins, so the displayed/completing time never
    // drops below the real-time floor no matter how fast `remaining`
    // itself has counted down.
    function effectiveRemaining(sale) {
      return Math.max(sale.remaining, config.floorTime - sale.realElapsed);
    }

    // Display-only estimate of a fresh sale's duration at the CURRENT
    // worker count (assuming it stays constant) — shown next to the
    // "Sell" header. Not used for actual sale pacing; see tick().
    function previewDuration() {
      const rate = 1 + config.getAssigned() * config.getSPW();
      return Math.max(config.floorTime, config.baseTime / rate);
    }

    function unlockResource(id) { const r = byId(id); if (r) r.unlocked = true; }
    function enableAuto(id) { const r = byId(id); if (r) r.auto = true; }
    function setBundles(id, arr) { const r = byId(id); if (r) { r.bundles = arr; if (r.sel >= arr.length) r.sel = 0; } }
    function setMaxConcurrent(n) { maxConcurrent = n; }
    function selectBundle(id, idx) { const r = byId(id); if (r && idx >= 0 && idx < r.bundles.length) r.sel = idx; }
    function canSell(r) { return r.unlocked && !r.sale && activeCount() < maxConcurrent && amt(r) > 0 && window.OrbWeaver.Resources.get(r.id) >= amt(r); }

    function startSale(id) {
      const r = byId(id);
      if (!r || !canSell(r)) return;
      const a = amt(r);
      window.OrbWeaver.Resources.spend(r.id, a);
      r.sale = { remaining: config.baseTime, realElapsed: 0, gold: goldFor(r), amt: a };
    }

    function cancelSale(id) {
      const r = byId(id);
      if (!r || !r.sale) return;
      window.OrbWeaver.Resources.add(r.id, r.sale.amt); // overflow past cap is lost
      r.sale = null;
      window.OrbWeaver.Footer.push(`${r.name} sale canceled — resources returned.`);
    }

    function toggleAuto(id) {
      const r = byId(id);
      if (!r || !r.auto) return;
      if (r.autoOn) { r.autoOn = false; return; }
      if (toggledCount() >= maxConcurrent) { r.bumpUntil = performance.now() + 160; return; } // no free slot → bump back
      r.autoOn = true;
    }
    function toggleLock(id) { const r = byId(id); if (r && r.auto) r.autoLocked = !r.autoLocked; }

    function tick(tickRate) {
      const assigned = config.getAssigned();
      const spw = config.getSPW();
      res.forEach((r) => {
        if (!r.sale) return;
        r.sale.realElapsed += tickRate;
        r.sale.remaining -= tickRate + (assigned * spw * tickRate);
        if (effectiveRemaining(r.sale) > 0) return;
        const added = window.OrbWeaver.Resources.add('gold', r.sale.gold);
        const lost = r.sale.gold - added > 0.001;
        r.sale = null;
        window.OrbWeaver.Footer.push(`${r.name} bundle sold for ${Math.round(added)} gold.${lost ? ' (gold cap — surplus lost)' : ''}`);
        if (lost && r.autoOn && !r.autoLocked) { r.autoOn = false; window.OrbWeaver.Footer.push(`${r.name} auto-sell off — gold cap reached.`); }
      });
      res.forEach((r) => { if (r.autoOn && canSell(r)) startSale(r.id); });
    }

    function getSoonestRemaining() {
      let m = null;
      res.forEach((r) => { if (r.sale) { const rem = Math.max(0, effectiveRemaining(r.sale)); if (m == null || rem < m) m = rem; } });
      return m;
    }
    function getBuildBarPct() {
      let best = null;
      res.forEach((r) => { if (r.sale) { const rem = effectiveRemaining(r.sale); if (best == null || rem < best) best = rem; } });
      return best == null ? 0 : Math.min(100, ((config.baseTime - best) / config.baseTime) * 100);
    }

    // Reserves fixed layout slots (bundles | auto-toggle | gold | status |
    // action | progress bar) so a card's box never resizes: unlocking an
    // auto-toggle, starting a sale, etc. fills an already-reserved slot
    // instead of growing the card (see .sell-card in style.css).
    function renderCards(mechanicId, trackKey) {
      const now = performance.now();
      const cards = res.filter((r) => r.unlocked).map((r) => {
        const d = `data-mechanic="${mechanicId}" data-track="${trackKey}" data-res="${r.id}"`;
        const chips = r.bundles.map((b, i) =>
          `<button class="sell-bundle${i === r.sel ? ' selected' : ''}" ${d} data-idx="${i}" data-upgrade-action="select-bundle">${b} ${r.name}</button>`).join('');
        // Auto-wrap is ALWAYS rendered (reserved space) even before the
        // resource has auto-sell unlocked — only its inner contents are
        // conditional — so unlocking it never shifts the bundle chips.
        const autoInner = r.auto
          ? `<div class="toggle-switch sell-auto${r.autoOn ? ' on' : ''}${now < r.bumpUntil ? ' bump' : ''}" ${d} data-upgrade-action="toggle-auto"></div>` +
            `<button class="sell-lock${r.autoLocked ? ' locked' : ''}" ${d} data-upgrade-action="toggle-lock">${r.autoLocked ? '🔒' : '🔓'}</button>`
          : '';
        let statusText = '', actionHtml, pct = 0;
        if (r.sale) {
          const rem = Math.max(0, effectiveRemaining(r.sale));
          statusText = `Selling — ${Math.ceil(rem)}s`;
          actionHtml = `<button class="action-btn" ${d} data-upgrade-action="cancel-sale">Cancel</button>`;
          pct = Math.min(100, ((config.baseTime - rem) / config.baseTime) * 100);
        } else {
          actionHtml = `<button class="action-btn" ${d} data-upgrade-action="sell"${canSell(r) ? '' : ' disabled'}>Bundle</button>`;
        }
        return `<div class="sell-card" data-res="${r.id}">
          <div class="sell-row-top"><div class="sell-bundles">${chips}</div><div class="sell-auto-wrap">${autoInner}</div></div>
          <div class="sell-gold">→ ${goldFor(r)} Gold</div>
          <div class="sell-status">${statusText}</div>
          ${actionHtml}
          <div class="sell-progress"><div class="sell-progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
        </div>`;
      }).join('');
      return `<div class="sell-grid">${cards}</div>`;
    }

    function patchDOM() {
      const timeEl = document.querySelector('#card-modal-body .sell-time-label');
      if (timeEl) timeEl.textContent = `— ${previewDuration().toFixed(1)}s`;
      res.filter((r) => r.unlocked).forEach((r) => {
        const rem = r.sale ? Math.max(0, effectiveRemaining(r.sale)) : null;
        const statusEl = document.querySelector(`#card-modal-body [data-res="${r.id}"] .sell-status`);
        if (statusEl) statusEl.textContent = rem != null ? `Selling — ${Math.ceil(rem)}s` : '';
        const barEl = document.querySelector(`#card-modal-body [data-res="${r.id}"] .sell-progress-bar`);
        if (barEl) barEl.style.width = (rem != null ? Math.min(100, ((config.baseTime - rem) / config.baseTime) * 100) : 0).toFixed(1) + '%';
        if (!r.sale) {
          const btn = document.querySelector(`#card-modal-body [data-res="${r.id}"] [data-upgrade-action="sell"]`);
          if (btn) btn.disabled = !canSell(r);
        }
      });
    }

    return {
      unlockResource, enableAuto, setBundles, setMaxConcurrent, selectBundle,
      startSale, cancelSale, toggleAuto, toggleLock, tick,
      getSoonestRemaining, getBuildBarPct, projectedTime: previewDuration, renderCards, patchDOM
    };
  }

  function registerTrack(id, track) { tracks[id] = track; }

  // Called by Resources.add() before anything reaches the free pool.
  // Guards on t.collectProduced so choice tracks (no partial collection)
  // are safely skipped.
  function collectIntoReservations(id, amount) {
    let remaining = amount;
    Object.values(tracks).forEach((t) => {
      if (remaining <= 0 || !t.collectProduced) return;
      remaining -= t.collectProduced(id, remaining);
    });
    return amount - remaining;
  }

  // Delegated listener: resolves 'mechanicId' or 'mechanicId:trackKey'
  // depending on whether the clicked element carries data-track, so it
  // works for both single-track (Wood/Stone) and multi-track mechanics.
  // Uses 'click' (not 'pointerdown'): pointerdown fires before the
  // browser's own click is dispatched, so an action that closes the
  // modal mid-pointerdown left a same-tap ghost click to fall through
  // onto whatever card was newly exposed underneath. 'click' already
  // waits for pointerup at the same target, matching how card-open
  // clicks work elsewhere, so there's exactly one event per tap.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-upgrade-action]');
    if (!btn) return;
    const key = btn.dataset.track ? `${btn.dataset.mechanic}:${btn.dataset.track}` : btn.dataset.mechanic;
    const track = tracks[key];
    if (!track) return;
    const action = btn.dataset.upgradeAction, item = btn.dataset.item;
    let shouldClose = false;

    if (action === 'start') {
      track.start(item);
      if (!track.revealWithGold) {
        // Sequential track: close only if we jumped straight to building
        // (fully afforded), stay open if now in collecting phase.
        shouldClose = track.isBuilding();
      } else {
        // Choice track (Construction Build button): always close.
        shouldClose = true;
      }
    } else if (action === 'cancel') {
      track.cancel(item);
    } else if (action === 'reveal' && track.revealWithGold) {
      track.revealWithGold(item);
    } else if (action === 'toggle-collapse' && track.toggleCollapse) {
      // Mobile can deliver two clicks for one tap; a second toggle
      // within 300ms would flip it straight back, making the arrow
      // look unresponsive. Swallow the duplicate. Scoped to this
      // action only — every other action stays instantly repeatable.
      if (performance.now() - lastCollapseAt < 300) return;
      lastCollapseAt = performance.now();
      track.toggleCollapse();
    } else if (action === 'select-bundle') {
      track.selectBundle(btn.dataset.res, parseInt(btn.dataset.idx, 10));
    } else if (action === 'sell') {
      track.startSale(btn.dataset.res);
    } else if (action === 'cancel-sale') {
      track.cancelSale(btn.dataset.res);
    } else if (action === 'toggle-auto') {
      track.toggleAuto(btn.dataset.res);
    } else if (action === 'toggle-lock') {
      track.toggleLock(btn.dataset.res);
    }

    if (shouldClose) {
      window.OrbWeaver.Cards.closeModal();
    } else {
      window.OrbWeaver.Cards.refreshOpenModal(btn.dataset.mechanic);
    }
  });

  window.OrbWeaver.Upgrades = { create, createChoiceTrack, createSellTrack, registerTrack, collectIntoReservations };
})();
