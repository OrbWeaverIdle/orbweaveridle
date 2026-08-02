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

    // trackKey optional — stamps data-track on buttons/progress bar so a
    // mechanic with more than one track (e.g. Builder's Bench) can tell
    // its bars/buttons apart. Omitted (Wood/Stone): markup unchanged.
    function renderModalHTML(mechanicId, liveStats, trackKey) {
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
        // Arrow (when collapsible) now renders next to the section label
        // itself, not inline here — see the mechanic's own renderModalHTML.
        let actionBody = '';
        if (i === 0) {
          if (collected) {
            const assigned = window.OrbWeaver.Workers.getAssigned(mechanicId);
            const workerPart = assigned > 0
              ? `<span class="detail-status-sep">·</span><span>${assigned} worker${assigned > 1 ? 's' : ''} reducing ${assigned}/s</span>`
              : '';
            actionBody = `
              <div class="detail-progress-wrap"><div class="detail-progress-bar"${trackAttr}></div></div>
              <div class="detail-status"><span>Building — ${Math.ceil(timeRemaining)}s remaining</span>${workerPart}</div>
              <button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="cancel">Cancel</button>`;
          } else if (Object.keys(reservation).length > 0) {
            const totalNeeded = Object.values(row.cost).reduce((a, b) => a + b, 0);
            const totalHave = Object.keys(row.cost).reduce((a, id) => a + (reservation[id] || 0), 0);
            const pct = Math.min(100, totalNeeded > 0 ? (totalHave / totalNeeded) * 100 : 0).toFixed(1);
            actionBody = `<button class="action-btn collect-btn" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="cancel" style="--collect-pct:${pct}%">Cancel collecting</button>`;
          } else {
            const label = canFullyAfford(row) ? 'Build upgrade' : 'Collect Resources';
            actionBody = `<button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-upgrade-action="start">${label}</button>`;
          }
        }
        return `
          <div class="upgrade-row ${locked ? 'locked' : ''}">
            <div class="upgrade-row-top">
              <span class="upgrade-name">${row.name}</span>
              <span class="upgrade-cost">${i === 0 ? resourceTracker(row) : (row.costRaw || '—')}</span>
            </div>
            <div class="upgrade-effect">${effectLine}</div>
            ${actionBody}
          </div>`;
      }).join('');
    }

    return { current, start, cancel, collectProduced, advanceTimer, isBuilding, isCollecting, getCardProgressPct, renderModalHTML, toggleCollapse, isCollapsed };
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
          return `<div class="upgrade-row">
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
          return `<div class="upgrade-row">
            <div class="upgrade-row-horizontal">${textStack}</div>
            ${costTime}
            <div class="detail-progress-wrap"><div class="detail-progress-bar"${trackAttr} style="width:${pct}%"></div></div>
            <div class="detail-status"><span>Building — ${Math.ceil(timeRemaining)}s remaining</span></div>
            <button class="action-btn" data-mechanic="${mechanicId}"${trackAttr} data-item="${item.id}" data-upgrade-action="cancel">Cancel</button>
          </div>`;
        }
        const disabled = activeId !== null || !canAfford(item);
        return `<div class="upgrade-row">
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

    return { unlock, revealWithGold, start, cancel, isBuilding, activeItem, getRemaining, getProgressPct, advanceTimer, renderModalRows };
  }

  /* ---------------- Sell track (Market) ----------------
     Per-resource sell cards sharing one pool of "sale slots"
     (maxConcurrent). Each resource has 1–2 selectable bundles, an
     optional auto-sell toggle (+ a lock that keeps it on through a
     gold-cap loss), full up-front resource cost, a timed gold payout,
     and a cancel (refund). Sell time = max(floor, base − workers×spw),
     fixed at sale start and counted down in real seconds.

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
    const projectedTime = () => Math.max(config.floorTime, config.baseTime - config.getAssigned() * config.getSPW());

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
      const t = projectedTime();
      r.sale = { t, total: t, gold: goldFor(r), amt: a };
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
      res.forEach((r) => {
        if (!r.sale) return;
        r.sale.t -= tickRate;
        if (r.sale.t > 0) return;
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
      res.forEach((r) => { if (r.sale && (m == null || r.sale.t < m)) m = r.sale.t; });
      return m;
    }
    function getBuildBarPct() {
      let best = null;
      res.forEach((r) => { if (r.sale && (best == null || r.sale.t < best.t)) best = r.sale; });
      return best ? ((best.total - best.t) / best.total) * 100 : 0;
    }

    function renderCards(mechanicId, trackKey) {
      const now = performance.now();
      const cards = res.filter((r) => r.unlocked).map((r) => {
        const d = `data-mechanic="${mechanicId}" data-track="${trackKey}" data-res="${r.id}"`;
        const chips = r.bundles.map((b, i) =>
          `<button class="sell-bundle${i === r.sel ? ' selected' : ''}" ${d} data-idx="${i}" data-upgrade-action="select-bundle">${b} ${r.name}</button>`).join('');
        const auto = r.auto
          ? `<div class="sell-auto-wrap"><div class="toggle-switch sell-auto${r.autoOn ? ' on' : ''}${now < r.bumpUntil ? ' bump' : ''}" ${d} data-upgrade-action="toggle-auto"></div>` +
            `<button class="sell-lock${r.autoLocked ? ' locked' : ''}" ${d} data-upgrade-action="toggle-lock">${r.autoLocked ? '🔒' : '🔓'}</button></div>`
          : '';
        let action, bar = '';
        if (r.sale) {
          const pct = ((r.sale.total - r.sale.t) / r.sale.total * 100).toFixed(1);
          action = `<div class="sell-status">Selling — ${Math.ceil(r.sale.t)}s</div>` +
            `<button class="action-btn" ${d} data-upgrade-action="cancel-sale">Cancel</button>`;
          bar = `<div class="sell-progress"><div class="sell-progress-bar" style="width:${pct}%"></div></div>`;
        } else {
          action = `<button class="action-btn" ${d} data-upgrade-action="sell"${canSell(r) ? '' : ' disabled'}>Bundle</button>`;
        }
        return `<div class="sell-card">
          <div class="sell-card-top"><div class="sell-bundles">${chips}</div>${auto}</div>
          <div class="sell-gold">→ ${goldFor(r)} Gold</div>
          ${action}${bar}
        </div>`;
      }).join('');
      return `<div class="sell-grid">${cards}</div>`;
    }

    return {
      unlockResource, enableAuto, setBundles, setMaxConcurrent, selectBundle,
      startSale, cancelSale, toggleAuto, toggleLock, tick,
      getSoonestRemaining, getBuildBarPct, projectedTime, renderCards
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
  document.addEventListener('pointerdown', (e) => {
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
