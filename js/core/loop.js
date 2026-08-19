/* ============================================================
   CORE: GAME LOOP
   Fixed-timestep loop driven by the real clock, not by how often
   the browser bothers to call us.

   One tick is always TICK_RATE (0.2) seconds of GAME time and
   always costs BASE_INTERVAL (200ms) of REAL time at 1x speed.
   Every pump we ask the clock how much real time actually passed,
   bank it in `accumulator`, and run however many whole ticks we
   owe. Ticks are never stretched or shortened — only their COUNT
   varies — so the game behaves identically on a fast machine, a
   slow machine, and a throttled background tab.

   Why not plain setInterval: browsers throttle a backgrounded
   tab's intervals to roughly 1/second and sometimes suspend them.
   A loop that counts callbacks silently loses time. This one asks
   the clock instead, so a throttled pump simply runs 5 ticks at
   once and the game stays on schedule.

   Speed multiplier buys game time per real millisecond (10x = ten
   ticks per 200ms), rather than shortening the tick itself.

   MAX_CATCHUP_SECONDS caps how much the LIVE loop will ever make
   up in one pump, so returning to a tab after hours doesn't freeze
   the page. Anything longer belongs to the offline system, which
   drives runBulk() deliberately (see js/core/save.js, Stage 3).
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const TICK_RATE = 0.2;          // seconds of game time per tick
  const BASE_INTERVAL = 200;      // ms of real time per tick at 1x
  const PUMP_INTERVAL = 50;       // how often we check the clock
  const MAX_CATCHUP_SECONDS = 30; // live catch-up ceiling
  const BULK_THRESHOLD = 4;       // above this many ticks in one pump, stop drawing

  let speedMult = 1;
  let pumpId = null;
  let lastNow = 0;
  let accumulator = 0; // unspent real ms, already scaled by speed

  /* One tick of simulation. Draws nothing itself — mechanics still
     call Cards.refresh(), which no-ops while rendering is suspended. */
  function step(tickRate) {
    const goldAvailable = window.OrbWeaver.Resources.get('gold') > 0;
    const mechanics = window.OrbWeaver.Mechanics.all();
    for (let i = 0; i < mechanics.length; i++) {
      const m = mechanics[i];
      // One misbehaving mechanic must not stop every mechanic after it
      // in the list. Log once per mechanic and keep the game running.
      try {
        m.tick(goldAvailable, tickRate);
      } catch (err) {
        if (!m._tickErrorLogged) {
          m._tickErrorLogged = true;
          console.error(`[Orb Weaver] ${m.id} threw during tick and was skipped:`, err);
          window.OrbWeaver.Footer.push(`Something went wrong in ${m.id} — see the browser console.`);
        }
      }
    }
    window.OrbWeaver.Upkeep.tick(tickRate);
  }

  /* Runs many ticks back-to-back with drawing switched off, then
     draws once at the end. Used for live catch-up and, later, for
     offline replay. `stepSeconds` lets the offline system replay in
     coarse 1-second steps instead of 0.2s ones. */
  function runBulk(ticks, stepSeconds, sampleEvery, onSample) {
    if (ticks <= 0) return;
    const rate = stepSeconds != null ? stepSeconds : TICK_RATE;
    const every = (sampleEvery > 0 && typeof onSample === 'function') ? sampleEvery : 0;
    window.OrbWeaver.Cards.setRenderEnabled(false);
    window.OrbWeaver.Resources.setRenderEnabled(false);
    try {
      for (let i = 0; i < ticks; i++) {
        step(rate);
        // Lets a caller observe the world mid-replay (offline catch-up
        // watches for the moment gold runs out) without re-enabling
        // rendering, which would repaint every resource each time.
        if (every && (i + 1) % every === 0) onSample(i + 1);
      }
    } finally {
      // Order matters: re-enabling resources repaints their readouts,
      // then the cards are refreshed against the settled numbers.
      window.OrbWeaver.Resources.setRenderEnabled(true);
      window.OrbWeaver.Cards.setRenderEnabled(true);
      window.OrbWeaver.Cards.refreshAll();
    }
  }

  function pump() {
    const now = performance.now();
    let elapsed = now - lastNow;
    lastNow = now;
    if (!(elapsed > 0)) elapsed = 0; // clock jumped backwards, or first call
    accumulator += elapsed * speedMult;

    const maxTicks = Math.ceil((MAX_CATCHUP_SECONDS * 1000) / BASE_INTERVAL);
    let ticks = Math.floor(accumulator / BASE_INTERVAL);
    if (ticks <= 0) return;
    if (ticks > maxTicks) {
      ticks = maxTicks;
      accumulator = 0; // discard the excess; offline replay owns long gaps
    } else {
      accumulator -= ticks * BASE_INTERVAL;
    }

    if (ticks >= BULK_THRESHOLD) runBulk(ticks, TICK_RATE);
    else for (let i = 0; i < ticks; i++) step(TICK_RATE);
  }

  function setSpeed(mult) {
    speedMult = mult;
    accumulator = 0; // don't let time banked at the old speed spill into the new one
    window.OrbWeaver.Footer.push(`Speed set to ${mult}x.`);
  }

  function start() {
    if (pumpId) return;
    lastNow = performance.now();
    accumulator = 0;
    pumpId = setInterval(pump, PUMP_INTERVAL);
  }

  function stop() {
    if (pumpId) { clearInterval(pumpId); pumpId = null; }
  }

  window.OrbWeaver.Loop = {
    start, stop, setSpeed, runBulk,
    isRunning: () => pumpId !== null,
    getSpeed: () => speedMult,
    // Progress-bar easing duration: how much real time one tick covers.
    getIntervalMs: () => BASE_INTERVAL / speedMult,
    TICK_RATE
  };
})();
