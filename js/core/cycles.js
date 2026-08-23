/* ============================================================
   CORE: CYCLES
   Generic completion engine for any worker-driven, repeating,
   fixed-length process — solves the sub-tick problem once for the
   whole game. A single game tick advances progress by rate*tickRate;
   when a card's rate gets large (buffed workers, high global P) one
   tick can cross a cycle's finish line MANY times over. The old
   `remaining -= rate*tickRate; if (<=0) reset` pattern silently
   discarded that overshoot and capped throughput at one completion
   per 200ms tick. This carries the true remainder forward instead,
   generalizing wheatfieldcard.js's bundle carry-over.

   create(cycleTime): an accumulator toward one completion.
     advance(rate, tickRate) -> whole completions this tick (O(1),
     never an unbounded loop); the fractional remainder is banked.
     Progress/remaining/reset/serialize let a card show a bar and
     persist mid-cycle.

   roll(table): weighted lookup for a stochastic completion. A table
     is [{ weight, ... }] (any extra fields are the payload). rollOne()
     returns one entry; sample(n) returns a { index: count } tally for
     n completions — looped individually up to SAFE_CAP, then drawn as
     one multinomial sample past it so a huge n costs the same as a
     small one (protects both the live 20ms case and offline catch-up,
     which replays thousands of ticks with rendering off).
     ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const SAFE_CAP = 300; // completions/tick resolved individually before batching

  /* ---- Completion accumulator ---- */
  function create(cycleTime) {
    let progress = 0; // seconds accumulated toward the next completion

    // Banks rate*tickRate and returns how many whole cycles completed.
    // Math.floor is O(1) regardless of how many crossed — no inner loop.
    function advance(rate, tickRate) {
      if (rate <= 0 || cycleTime <= 0) return 0;
      progress += rate * tickRate;
      const done = Math.floor(progress / cycleTime);
      if (done > 0) progress -= done * cycleTime;
      return done;
    }

    return {
      advance,
      getProgress: () => progress,
      getPct: () => (cycleTime > 0 ? Math.min(100, (progress / cycleTime) * 100) : 0),
      getCycleTime: () => cycleTime,
      setCycleTime: (t) => { cycleTime = t; },
      reset: () => { progress = 0; },
      serialize: () => progress,
      deserialize: (p) => { progress = (p > 0 ? p : 0); }
    };
  }

  /* ---- Weighted roll / batch sampler ----
     Bind a table once; rollOne() for a single completion, sample(n)
     for n completions returned as an index->count tally. */
  function roll(table) {
    const total = table.reduce((s, e) => s + (e.weight || 0), 0);

    function pickIndex(r) {
      // r in [0,total). Linear scan — tables are tiny (≤ a dozen rows).
      let acc = 0;
      for (let i = 0; i < table.length; i++) {
        acc += table[i].weight || 0;
        if (r < acc) return i;
      }
      return table.length - 1;
    }

    function rollOne() { return table[pickIndex(Math.random() * total)]; }

    function sample(n) {
      const tally = {};
      if (n <= 0 || total <= 0) return tally;
      if (n <= SAFE_CAP) {
        for (let i = 0; i < n; i++) {
          const idx = pickIndex(Math.random() * total);
          tally[idx] = (tally[idx] || 0) + 1;
        }
        return tally;
      }
      // Past the cap: one multinomial draw. Walk the buckets, drawing
      // each count from a binomial against the remaining probability
      // mass so the totals stay exact and the distribution is unbiased.
      let remaining = n, remainingWeight = total;
      for (let i = 0; i < table.length; i++) {
        const w = table[i].weight || 0;
        if (i === table.length - 1) { if (remaining > 0) tally[i] = remaining; break; }
        const p = remainingWeight > 0 ? w / remainingWeight : 0;
        const c = binomial(remaining, p);
        if (c > 0) tally[i] = c;
        remaining -= c;
        remainingWeight -= w;
        if (remaining <= 0) break;
      }
      return tally;
    }

    return { rollOne, sample, getTable: () => table };
  }

  // Sample from Binomial(n, p). Exact inversion for small n (the common
  // case after the first bucket peels most mass off); normal approx for
  // large n, clamped to [0, n]. Only ever called on the batch path.
  function binomial(n, p) {
    if (p <= 0) return 0;
    if (p >= 1) return n;
    if (n <= 64) {
      let count = 0;
      for (let i = 0; i < n; i++) if (Math.random() < p) count++;
      return count;
    }
    const mean = n * p, sd = Math.sqrt(n * p * (1 - p));
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.min(n, Math.round(mean + z * sd)));
  }

  window.OrbWeaver.Cycles = { create, roll, SAFE_CAP };
})();
