/* ============================================================
   CORE: GAME LOOP
   Runs at 5 ticks/second (200ms base interval). TICK_RATE (0.2)
   is the fraction of a second each tick represents — all mechanics
   multiply their per-second rates by this value.
   Speed multiplier shortens the interval; 1x=200ms, 2x=100ms,
   5x=40ms, 10x=20ms. Mutually exclusive; setSpeed(1) resets.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const BASE_INTERVAL = 200;
  const TICK_RATE = 0.2; // seconds per tick at 1x speed
  let speedMult = 1;
  let intervalId = null;

  function tick() {
    const goldAvailable = window.OrbWeaver.Resources.get('gold') > 0;
    window.OrbWeaver.Mechanics.all().forEach((m) => m.tick(goldAvailable, TICK_RATE));
    window.OrbWeaver.Upkeep.tick(TICK_RATE);
  }

  function setSpeed(mult) {
    speedMult = mult;
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(tick, BASE_INTERVAL / speedMult);
    window.OrbWeaver.Footer.push(`Speed set to ${mult}x.`);
  }

  function start() {
    intervalId = setInterval(tick, BASE_INTERVAL);
  }

  window.OrbWeaver.Loop = { start, setSpeed, getSpeed: () => speedMult, getIntervalMs: () => BASE_INTERVAL / speedMult, TICK_RATE };
})();
