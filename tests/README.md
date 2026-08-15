# Tests

Node-only. No browser, no build step. From the project root:

```
npm install jsdom      # one time
node tests/loop-timing.test.js
node tests/save-roundtrip.test.js
node tests/save-edgecases.test.js
```

Each prints PASS/FAIL per check and exits non-zero if anything failed.

**loop-timing** drives `js/core/loop.js` with a fake clock. Proves game
time tracks real time even when the pump is throttled the way a
background tab throttles it, that a long gap is capped rather than
replayed all at once, and that a bulk catch-up repaints once.

**save-roundtrip** boots the real game in a headless DOM, plays it,
saves, boots a second fresh game, loads, and diffs the two worlds —
every resource, worker pool, and card. Then ticks both another 60
seconds and diffs again, which is the check that actually matters: two
worlds that look identical but *evolve* differently mean something
derived didn't come back.

**save-edgecases** covers what the design was most worried about: a mule
mid-trip with a sequestered crew, research effects being replayed rather
than stored, a sale in flight, a resource that only exists because cargo
created it, a corrupt save, and a plain early-game save with no cheats.

These read the game through its public surface, so they keep working as
mechanics are added. When you add a mechanic, add a case here.

**offline** covers crediting time away, the 24-hour cap, gold running
out mid-absence, report contents, the bonus hook, short gaps that
shouldn't interrupt, and nonsense clock values.

## A trap worth knowing

jsdom fires its **own** `DOMContentLoaded` shortly after a manual
dispatch, which boots the entire game a second time on top of the first.
Synchronous suites finish before it lands and never notice; anything
that yields to an animation frame does. Every harness here blocks it
with a capture-phase listener on `window`. Four apparent "offline bugs"
turned out to be exactly this.
