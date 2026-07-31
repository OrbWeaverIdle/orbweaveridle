/* ============================================================
   CORE: UPGRADES
   Generic reservation-based upgrade engine shared by every mechanic.
   A mechanic supplies its upgrade table; this handles collecting
   costs over time, pausing/resuming with production, canceling with
   refunds, and rendering the "next 3" modal list. No mechanic-
   specific knowledge lives here.
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

  const tracks = {}; // mechanicId -> track, for the shared modal-button listener

  function create(table) {
    const parsed = table.map((row) => ({ ...row, cost: parseCost(row.costRaw) }));
    let index = 0;
    let reservation = {};
    let collected = false;
    let timeRemaining = null;

    function current() { return parsed[index] || null; }

    // True if the player's current free balance already covers the
    // full cost of every resource this row needs (used to decide the
    // "Build upgrade" vs "Collect Resources" button label).
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

    // Feeds freshly-produced amount of one resource into the active
    // reservation (if any is still needed). Returns the amount used,
    // so the caller adds the remainder to the free resource pool.
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

    // Advances the build timer. Always runs once collected, regardless of
    // worker count or gold. Each assigned worker removes an extra 0.2s/tick
    // (1s/real-second at base speed) on top of the natural tickRate advance.
    function advanceTimer(tickRate, assigned, onComplete) {
      if (!collected) return;
      timeRemaining -= tickRate + (assigned * 0.2 * tickRate);
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

    // Live per-resource "have/need" breakdown for row 1 only (whole numbers).
    // "Have" = free balance before reserving, reserved-so-far while collecting,
    // or the full cost once building. Resources that don't exist yet show 0.
    function resourceTracker(row) {
      return Object.keys(row.cost).map((id) => {
        const have = collected ? row.cost[id]
          : Object.keys(reservation).length > 0 ? (reservation[id] || 0)
          : window.OrbWeaver.Resources.get(id);
        const label = id.charAt(0).toUpperCase() + id.slice(1);
        return `${Math.round(have)}/${Math.round(row.cost[id])} ${label}`;
      }).join(', ');
    }

    function renderModalHTML(mechanicId, liveStats) {
      const rows = [parsed[index], parsed[index + 1], parsed[index + 2]];
      return rows.map((row, i) => {
        if (!row) return '';
        const locked = i > 0;
        const prevRow = i === 0 ? null : parsed[index + i - 1];
        const prevCap = i === 0 ? liveStats.cap : prevRow.newCap;
        const prevRate = i === 0 ? liveStats.rate : prevRow.gainPerWorker;
        const effectLine = `Cap: ${prevCap} → <strong>${row.newCap}</strong> · Rate: ${prevRate.toFixed(2)}/s → <strong>${row.gainPerWorker.toFixed(2)}/s</strong> per worker`;
        let body = '';
        if (i === 0) {
          if (collected) {
            const assigned = window.OrbWeaver.Workers.getAssigned(mechanicId);
            const workerLine = assigned > 0
              ? `<div class="detail-status">${assigned} worker${assigned > 1 ? 's' : ''} reducing ${assigned}/s</div>`
              : '';
            body = `
              <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
              <div class="detail-status">Building — ${Math.ceil(timeRemaining)}s remaining</div>
              ${workerLine}
              <button class="action-btn" data-mechanic="${mechanicId}" data-upgrade-action="cancel">Cancel</button>`;
          } else if (Object.keys(reservation).length > 0) {
            const totalNeeded = Object.values(row.cost).reduce((a, b) => a + b, 0);
            const totalHave = Object.keys(row.cost).reduce((a, id) => a + (reservation[id] || 0), 0);
            const pct = Math.min(100, totalNeeded > 0 ? (totalHave / totalNeeded) * 100 : 0).toFixed(1);
            body = `<button class="action-btn collect-btn" data-mechanic="${mechanicId}" data-upgrade-action="cancel" style="--collect-pct:${pct}%">Cancel collecting</button>`;
          } else {
            const label = canFullyAfford(row) ? 'Build upgrade' : 'Collect Resources';
            body = `<button class="action-btn" data-mechanic="${mechanicId}" data-upgrade-action="start">${label}</button>`;
          }
        }
        return `
          <div class="upgrade-row ${locked ? 'locked' : ''}">
            <div class="upgrade-row-top">
              <span class="upgrade-name">${row.name}</span>
              <span class="upgrade-cost">${i === 0 ? resourceTracker(row) : (row.costRaw || '—')}</span>
            </div>
            <div class="upgrade-effect">${effectLine}</div>
            ${body}
          </div>`;
      }).join('');
    }

    return { current, start, cancel, collectProduced, advanceTimer, isBuilding, getCardProgressPct, renderModalHTML };
  }

  function registerTrack(id, track) { tracks[id] = track; }

  // Called by Resources.add() before anything reaches the free pool, so a
  // sudden gain of any resource (production or cheats) tops off whichever
  // active reservations across any mechanic still need it. Returns how
  // much was absorbed; the caller adds only the remainder to the free pool.
  function collectIntoReservations(id, amount) {
    let remaining = amount;
    Object.values(tracks).forEach((t) => {
      if (remaining <= 0) return;
      remaining -= t.collectProduced(id, remaining);
    });
    return amount - remaining;
  }

  // Delegated listener: works no matter how many times the modal body
  // is re-rendered, since the listener lives on document, not on the
  // buttons themselves.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-upgrade-action]');
    if (!btn) return;
    const track = tracks[btn.dataset.mechanic];
    if (!track) return;
    if (btn.dataset.upgradeAction === 'start') track.start();
    if (btn.dataset.upgradeAction === 'cancel') track.cancel();
    window.OrbWeaver.Cards.refreshOpenModal(btn.dataset.mechanic);
  });

  window.OrbWeaver.Upgrades = { create, registerTrack, collectIntoReservations };
})();
