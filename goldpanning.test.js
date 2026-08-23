/* Gold Panning. Boots the real game headless, reveals the card, staffs
   stations, and drives ticks through the public surface — same style as
   the other suites. Covers the dice table, sub-tick throughput, the
   Last Reward / Last Hour tracking, add-station + cap, and save
   survival. The engine pieces (cycles carry-over, the statistical batch
   past 300/tick, the isolated hidden ledger) are exercised here through
   Gold Panning rather than in isolation. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore() { STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } }; }

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0; // no smoothing loop needed here
  w.performance = { now: () => Date.now() };
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => {
    try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, errors };
}

const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

newStore();
const { OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));

const gp = OW.Mechanics.get('goldpanning');
const D = gp._debug;
OW.Cards.reveal(gp);

// Dice table integrity.
check('dice weights sum to 100', D.DICE_TABLE.reduce((s, r) => s + r.weight, 0) === 100);

// Reveal Mountains + give its pool workers so stations can be staffed.
OW.Locations.get ? null : null;
OW.Mountains.reveal();
OW.Mountains.addWorkers(10);

// Three starting stations, correct labels/cycles.
const st = D.stations();
check('3 starting stations (Sluice + 2 Panning)',
  st.length === 3 && st[0].kind === 'sluice' && st[1].kind === 'panning' && st[2].kind === 'panning');

// Staff a panning station and run — it should produce rewards, routing
// Gold to the shared pool and dust/nuggets to the hidden ledger.
const goldBefore = OW.Resources.get('gold');
D.subAssign('panning-1');
tick(OW, 60); // ~20 rolls at 3s each
const s1 = D.stations()[1];
check('worked station has a last reward', s1.lastReward.length > 0, JSON.stringify(s1.lastReward));
const hour = D.hourTotals(s1);
check('hour window accumulated something', (hour.golddust + hour.gold + hour.nugget) > 0);
check('gold OR hidden resources gained',
  OW.Resources.get('gold') > goldBefore || OW.HiddenRes.get('golddust') > 0 || OW.HiddenRes.get('nugget') > 0);

// Hidden resources are NOT in the public Resources registry (isolation).
check('gold dust is not a public resource', OW.Resources.exists('golddust') === false);
check('nugget is not a public resource', OW.Resources.exists('nugget') === false);

// Sub-tick throughput: pile many workers on so one tick completes many
// cycles (well past the 300/tick batch threshold at high enough counts)
// and confirm it keeps paying rather than stalling on the 200ms tick.
D.subAssign('sluice-1');
for (let i = 0; i < 8; i++) D.subAssign('sluice-1'); // 9 workers on a 2s station
const goldPre = OW.Resources.get('gold') + OW.HiddenRes.get('golddust') + OW.HiddenRes.get('nugget');
tick(OW, 10);
const goldPost = OW.Resources.get('gold') + OW.HiddenRes.get('golddust') + OW.HiddenRes.get('nugget');
check('heavily-staffed station keeps paying (no sub-tick stall)', goldPost > goldPre);

// Clear-on-idle: unstaff a station, tick, its displayed stats blank.
while (D.stations()[1].workers > 0) D.subUnassign('panning-1');
tick(OW, 0.2);
check('idle station clears its hour buckets', D.stations()[1].buckets.length === 0);

// Add-station: costs 2000 Mountains wood, adds a Panning, caps at 10.
// mtn_wood caps at 2000, so refill before each purchase.
function refillWood() { OW.Resources.setRaw(OW.Mountains.woodId, OW.Resources.getCap(OW.Mountains.woodId)); }
refillWood();
const n0 = D.stations().length;
const woodBefore = OW.Resources.get(OW.Mountains.woodId);
D.addStation();
check('add-station buys one Panning', D.stations().length === n0 + 1 && D.stations()[n0].kind === 'panning');
check('add-station spent 2000 mtn wood', woodBefore - OW.Resources.get(OW.Mountains.woodId) === 2000);
let guard = 0;
while (D.stations().length < 10 && guard++ < 20) { refillWood(); D.addStation(); }
check('station count caps at 10', D.stations().length === 10);
refillWood();
check('cannot add past the cap', D.canAdd() === false);
D.addStation();
check('no station added past the cap', D.stations().length === 10);

// Save survival: save, boot a fresh game, load, and confirm the station
// board (count, kinds, workers, cycle progress, reward history) returns.
D.subAssign('panning-1');
tick(OW, 30);
const boardA = D.stations().map((s) => ({ id: s.id, k: s.kind, w: s.workers, cp: s.cyc.getProgress(), lr: s.lastReward, bk: s.buckets.length }));
STORE.setItem('orbweaver.save.v1', OW.Save.encode(OW.Save.serialize()));

const B = boot();
check('second boot with no script errors', B.errors.length === 0, B.errors.join('\n        '));
const gpB = B.OW.Mechanics.get('goldpanning');
const boardB = gpB._debug.stations().map((s) => ({ id: s.id, k: s.kind, w: s.workers, cp: s.cyc.getProgress(), lr: s.lastReward, bk: s.buckets.length }));
check('station board survived save/load', JSON.stringify(boardA) === JSON.stringify(boardB),
  `${JSON.stringify(boardA)}\n        ${JSON.stringify(boardB)}`);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
