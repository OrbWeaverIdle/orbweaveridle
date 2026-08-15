/* ============================================================
   CORE: OFFLINE PROGRESS
   When the game reopens after being closed, replay the time that
   passed so the world is where it should be.

   COARSE REPLAY. The same tick() code every mechanic already runs,
   driven in 1-second steps instead of 0.2-second ones — five times
   fewer steps for the same simulated time. This reuses all existing
   logic, so a mechanic added next year is covered without touching
   this file. The tradeoff is honest and worth knowing: anything that
   can only happen once per tick is throughput-limited during replay
   (a tent that takes 0.4s to pitch still only completes one per
   step), and timers overshoot by up to a step. Both under-credit
   slightly, never over-credit.

   GOLD RUNS NORMALLY. Upkeep drains during replay exactly as it does
   live, so a player who logs off without a gold buffer comes back to
   a camp that stopped early. That is the intended design, not a bug —
   which is why the report says plainly when and how it happened.

   CHUNKED. A full 24 hours is tens of thousands of steps and takes
   long enough to freeze the tab. The replay runs a few thousand steps
   per animation frame instead, so the progress bar actually paints
   and the page stays responsive. The game loop is held until it
   finishes (see Save.init's callback) so nothing double-counts.

   THE BONUS SEAM. Offline.setBonus(fn) is where a future
   "reward for being away" goes. fn receives the finished report and
   may grant whatever it likes through Resources.add(), returning a
   short string to show in the summary. Nothing is designed yet, so
   nothing is assumed here.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const STEP_SECONDS = 1;      // coarse replay granularity
  const MAX_SECONDS = 86400;   // 24 hour cap
  const MIN_REPLAY = 10;       // below this, not worth simulating
  const MIN_REPORT = 60;       // below this, simulate but don't interrupt
  const CHUNK_STEPS = 3000;    // steps per animation frame
  const SAMPLE_STEPS = 60;     // how often the replay is observed, in steps

  let bonusFn = null;
  function setBonus(fn) { bonusFn = typeof fn === 'function' ? fn : null; }

  const el = (id) => document.getElementById(id);

  function formatDuration(s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const parts = [];
    if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
    if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
    if (!h && !m) parts.push(`${sec} second${sec === 1 ? '' : 's'}`);
    return parts.join(' ');
  }

  function formatAmount(n) {
    const abs = Math.abs(n);
    if (abs >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (abs >= 1000) return (n / 1000).toFixed(1) + 'k';
    return abs >= 10 ? Math.round(n).toString() : n.toFixed(1);
  }

  function snapshotResources() {
    const out = {};
    window.OrbWeaver.Resources.all().forEach((r) => { out[r.id] = r.current; });
    return out;
  }

  /* ---------------- The replay ---------------- */

  function apply(secondsAway, onDone) {
    const done = typeof onDone === 'function' ? onDone : function () {};
    const raw = Number(secondsAway) || 0;

    // A clock that moved backwards, or a nonsense value, credits nothing.
    if (!(raw >= MIN_REPLAY)) { done(); return; }

    const capped = Math.min(raw, MAX_SECONDS);
    const wasCapped = raw > MAX_SECONDS;
    const totalSteps = Math.floor(capped / STEP_SECONDS);

    /* Hold the live loop for the duration. The normal boot path already
       replays before starting it, but the replay spans animation frames,
       and if the loop were running its pumps would interleave between
       chunks — mixing 0.2s live ticks into a 1s coarse replay and
       double-counting the same wall-clock time. Enforce it here rather
       than relying on every caller to remember. */
    if (totalSteps <= 0) { done(); return; }

    const loopWasRunning = window.OrbWeaver.Loop.isRunning();
    if (loopWasRunning) window.OrbWeaver.Loop.stop();

    const before = snapshotResources();
    const goldBefore = window.OrbWeaver.Resources.get('gold');

    // Collect the announcements mechanics make during replay.
    const events = new Map();
    window.OrbWeaver.Footer.setMuted(true);
    window.OrbWeaver.Footer.setListener((msg) => { events.set(msg, (events.get(msg) || 0) + 1); });

    let goldRanOutAtStep = null;
    let stepsRun = 0;
    const showUI = capped >= MIN_REPORT;

    if (showUI) openProgress();

    function finish() {
      if (loopWasRunning) window.OrbWeaver.Loop.start();
      window.OrbWeaver.Footer.setListener(null);
      window.OrbWeaver.Footer.setMuted(false);

      const after = snapshotResources();
      const gains = [];
      Object.keys(after).forEach((id) => {
        const delta = after[id] - (before[id] || 0);
        if (Math.abs(delta) >= 0.05) {
          gains.push({ id: id, name: window.OrbWeaver.Resources.getName(id), delta: delta });
        }
      });
      gains.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      const report = {
        secondsAway: raw,
        secondsCredited: capped,
        wasCapped: wasCapped,
        gains: gains,
        events: Array.from(events.entries()).map(([msg, count]) => ({ message: msg, count: count })),
        goldRanOutAfterSeconds: goldRanOutAtStep == null ? null : goldRanOutAtStep * STEP_SECONDS,
        goldBefore: goldBefore,
        goldAfter: window.OrbWeaver.Resources.get('gold')
      };

      let bonusNote = null;
      if (bonusFn) {
        try { bonusNote = bonusFn(report) || null; }
        catch (err) { console.error('[Orb Weaver] Offline bonus threw:', err); }
      }
      report.bonusNote = bonusNote;

      // The loop restarts as soon as the summary is on screen, NOT when
      // it is dismissed. Gating the game's start on a button press means
      // one broken button is a game that never starts; the few seconds
      // of production that pass while the player reads are worth far
      // less than that failure mode. The summary is just an overlay.
      if (showUI) showReport(report);
      done();
    }

    function runChunk() {
      const remaining = totalSteps - stepsRun;
      if (remaining <= 0) { finish(); return; }
      const n = Math.min(CHUNK_STEPS, remaining);

      // Sampled every SAMPLE_STEPS so "your gold ran out after about X"
      // is accurate to the minute rather than to the chunk. Chunks are
      // thousands of steps; reporting a 20-second collapse as "about 50
      // minutes" would be worse than saying nothing.
      const base = stepsRun;
      window.OrbWeaver.Loop.runBulk(n, STEP_SECONDS, SAMPLE_STEPS, (done) => {
        if (goldRanOutAtStep == null && window.OrbWeaver.Resources.get('gold') <= 0) {
          goldRanOutAtStep = base + done;
        }
      });
      stepsRun += n;
      if (goldRanOutAtStep == null && window.OrbWeaver.Resources.get('gold') <= 0) {
        goldRanOutAtStep = stepsRun;
      }

      if (showUI) setProgress(stepsRun / totalSteps);

      if (stepsRun >= totalSteps) finish();
      else requestAnimationFrame(runChunk);
    }

    // One frame before starting, so the overlay paints before the
    // first chunk blocks the thread.
    if (showUI) requestAnimationFrame(() => requestAnimationFrame(runChunk));
    else runChunk();
  }

  /* ---------------- UI ---------------- */

  function openProgress() {
    const scrim = el('offline-modal-scrim');
    if (!scrim) return;
    el('offline-modal-body').innerHTML =
      `<div class="offline-progress-label">Catching up on what happened while you were away…</div>
       <div class="offline-progress-wrap"><div class="offline-progress-bar" id="offline-progress-bar"></div></div>`;
    el('offline-modal-close').style.display = 'none';
    scrim.classList.add('open');
  }

  function setProgress(pct) {
    const bar = el('offline-progress-bar');
    if (bar) bar.style.width = Math.round(Math.min(1, pct) * 100) + '%';
  }

  function showReport(report) {
    const scrim = el('offline-modal-scrim');
    if (!scrim) return;

    let html = `<div class="offline-away">You were away for <strong>${formatDuration(report.secondsAway)}</strong>.</div>`;
    if (report.wasCapped) {
      html += `<div class="offline-note">Offline progress is capped at 24 hours, so 24 hours were credited.</div>`;
    }

    if (report.goldRanOutAfterSeconds != null) {
      html += `<div class="offline-warning">Your gold ran out after ${formatDuration(report.goldRanOutAfterSeconds)}. 1 worker costs 1 gold every second.</div>`;
    }

    if (report.gains.length) {
      html += `<div class="offline-section-label">Changes</div><div class="offline-gains">`;
      report.gains.forEach((g) => {
        const sign = g.delta > 0 ? '+' : '−';
        const cls = g.delta > 0 ? 'up' : 'down';
        html += `<div class="offline-gain-row"><span class="offline-gain-name">${g.name}</span>
                 <span class="offline-gain-val ${cls}">${sign}${formatAmount(Math.abs(g.delta))}</span></div>`;
      });
      html += `</div>`;
    } else {
      html += `<div class="offline-note">Nothing changed while you were away.</div>`;
    }

    // Use the full restored log history — it's already loaded from the
    // save and contains everything the player saw before closing, plus
    // whatever the replay just generated. Show newest-first, cap at 12.
    const logHistory = window.OrbWeaver.Footer.getHistory();

    if (logHistory.length) {
      html += `<div class="offline-section-label">While you were away</div><ul class="offline-events">`;
      logHistory.slice(0, 12).forEach((h) => {
        html += `<li>${h.t}</li>`;
      });
      if (logHistory.length > 12) html += `<li>…and ${logHistory.length - 12} more</li>`;
      html += `</ul>`;
    }

    if (report.bonusNote) html += `<div class="offline-bonus">${report.bonusNote}</div>`;

    el('offline-modal-body').innerHTML = html;
    el('offline-modal-close').style.display = '';

    function close() { scrim.classList.remove('open'); }
    el('offline-modal-close').addEventListener('click', close);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  }

  window.OrbWeaver.Offline = {
    apply, setBonus,
    MAX_SECONDS, STEP_SECONDS,
    formatDuration // exported for tests and for a future bonus to reuse
  };
})();
