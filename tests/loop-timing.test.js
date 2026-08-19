/* Verifies loop.js timing in isolation: game time must track REAL time
   regardless of how erratically the pump is called. */
const fs = require('fs');

let fakeNow = 0;
let pumpFn = null;
let gameSeconds = 0;
let renderCount = 0;

global.performance = { now: () => fakeNow };
global.console = console;
global.setInterval = (fn) => { pumpFn = fn; return 1; };
global.clearInterval = () => {};

global.window = {
  OrbWeaver: {
    Resources: { get: () => 5000, setRenderEnabled: () => {} },
    Footer: { push: () => {} },
    Upkeep: { tick: () => {} },
    Mechanics: { all: () => [{ id: 'stub', tick: (g, rate) => { gameSeconds += rate; } }] },
    Cards: { setRenderEnabled: () => {}, refreshAll: () => { renderCount++; } }
  }
};

eval(fs.readFileSync(require('path').join(__dirname,'..','js/core/loop.js'), 'utf8'));
const Loop = global.window.OrbWeaver.Loop;

function advance(realMs, pumpEveryMs) {
  let left = realMs;
  while (left > 0) {
    const chunk = Math.min(pumpEveryMs, left);
    fakeNow += chunk;
    left -= chunk;
    pumpFn();
  }
}

function reset() { gameSeconds = 0; renderCount = 0; }
function check(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual.toFixed(2)}s, expected ~${expected}s`);
  return ok;
}

let allOk = true;
Loop.start();

// 1. Foreground: pump fires reliably every 50ms for 60 real seconds.
reset();
advance(60000, 50);
allOk &= check('60s foreground @50ms pump', gameSeconds, 60, 0.25);

// 2. Background: browser throttles the pump to once per second.
//    A callback-counting loop would lose ~95% of this. Delta must not.
reset();
advance(60000, 1000);
allOk &= check('60s background @1000ms pump (throttled)', gameSeconds, 60, 0.25);

// 3. Pathologically bad pump: once every 5 seconds.
reset();
advance(60000, 5000);
allOk &= check('60s @5000ms pump', gameSeconds, 60, 0.25);

// 4. Catch-up cap: one 10-minute gap must credit 30s, not 600s.
reset();
fakeNow += 600000;
pumpFn();
allOk &= check('10min gap is capped', gameSeconds, 30, 0.25);

// 5. Speed multiplier: 10x for 10 real seconds = 100 game seconds.
reset();
Loop.setSpeed(10);
advance(10000, 50);
allOk &= check('10x speed, 10 real seconds', gameSeconds, 100, 0.5);
Loop.setSpeed(1);

// 6. Clock going backwards must not run negative or explode.
reset();
fakeNow -= 5000;
pumpFn();
advance(2000, 50);
allOk &= check('clock jumped backwards', gameSeconds, 2, 0.25);

// 7. Bulk path draws once, not once per tick.
reset();
fakeNow += 10000; // 50 ticks in one pump
pumpFn();
console.log(`${renderCount === 1 ? 'PASS' : 'FAIL'}  50 ticks in one pump caused ${renderCount} redraw(s), expected 1`);
allOk &= (renderCount === 1);

console.log(allOk ? '\nAll loop timing checks passed.' : '\nSOME CHECKS FAILED.');
process.exit(allOk ? 0 : 1);
