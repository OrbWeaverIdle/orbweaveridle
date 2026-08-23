/* Smelter Shack. Boots the real game headless, stages Forges, and
   drives ticks through the public surface — same style as the other
   suites. Covers starting state, the full Heating -> Filling ->
   Outputting -> Stopped cycle (including an automatic Stop that
   tickForge() triggers on its own, not a user Cancel), locking,
   billing (stopped-Forge workers are free), Gold Bars' reveal-on-
   first-bar rule, Add-Forge cost/cap, save/load, and — now that
   Phase D exists — DOM-level checks that the modal actually renders
   the right number of Forges and a real stepper click reaches the
   mechanic. */
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
const { w, OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));

const sm = OW.Mechanics.get('smeltershack');
const D = sm._debug;
OW.Cards.reveal(sm);
OW.Mountains.reveal();
OW.Mountains.addWorkers(20);
const pool = OW.Mountains.workerPool;

/* ---- Starting state ---- */
let forges = D.forges();
check('2 starting Forges, both stopped and empty',
  forges.length === 2 && forges.every((f) => f.phase === 'stopped' && f.ore.length === 0 && f.woodWorkers === 0 && f.output.res === null));
check('Gold Bars not revealed before any bar is produced', OW.Resources.exists('mtn_goldbars') === false);

/* ---- Staff and run Forge 0 through a full real cycle ---- */
for (let i = 0; i < 4; i++) pool.assign('smeltershack'); // 2 ore + 1 wood + 1 output
D.addOre(0, 'golddust');
D.subAssign(0, 'ore', 0);
D.subAssign(0, 'ore', 0);
D.subAssign(0, 'wood', undefined);
D.setOutput(0, 'goldbars');
D.subAssign(0, 'output', undefined);
check('canSmelt true once ore + wood + output are all staffed', D.canSmelt(forges[0]));

// Heating and Filling both draw real resources — seed plenty so the
// full cycle can progress without running dry mid-test.
OW.Resources.setRaw('mtn_wood', 1000000, 1000000);
OW.HiddenRes.add('golddust', 1000000);

D.smelt(0);
check('Smelt moves phase to heating', forges[0].phase === 'heating');

tick(OW, 220); // WOOD_CAP 200 / (1 worker * WOOD_M 1)/s = 200s needed; 220 gives buffer
check('Heating completes into Filling', forges[0].phase === 'filling', `phase=${forges[0].phase} woodBank=${forges[0].woodBank}`);

let fillGuard = 0;
while (forges[0].phase === 'filling' && fillGuard++ < 100) tick(OW, 1); // 2 ore workers * 20 m -> 2 molten/s, MOLTEN_CAP 100 needs ~50s
check('Filling completes into Outputting', forges[0].phase === 'outputting', `phase=${forges[0].phase} molten=${forges[0].molten}`);

const barsAfterFirstRun = OW.Resources.exists('mtn_goldbars') ? OW.Resources.get('mtn_goldbars') : 0;
check('Gold Bars revealed and gained once Outputting has run', OW.Resources.exists('mtn_goldbars') && barsAfterFirstRun > 0, `bars=${barsAfterFirstRun}`);

// Let it run all the way dry (Molten depletes faster than 1 output
// worker can be topped up forever) — this Stop happens INSIDE
// tickForge() on its own, never via a user Cancel click.
let guard = 0;
while (forges[0].phase !== 'stopped' && guard++ < 2000) tick(OW, 1);
check('Forge auto-stops once it runs dry (not via user Cancel)', forges[0].phase === 'stopped', `guard=${guard}`);
check('Auto-stop resets wood bank and molten to 0', forges[0].woodBank === 0 && forges[0].molten === 0);
check('Auto-stop leaves ore/output selections and worker counts untouched',
  forges[0].ore.length === 1 && forges[0].ore[0].res === 'golddust' && forges[0].output.res === 'goldbars' && forges[0].woodWorkers === 1);

/* ---- Locking: selections locked while active, staffing never locked ---- */
D.smelt(0); // re-smelt the already-configured Forge — should work immediately
check('Re-Smelt on an already-configured Forge works immediately', forges[0].phase === 'heating');
const oreCountBeforeLockedAttempt = forges[0].ore.length;
D.addOre(0, 'nugget');
D.removeOre(0, 0);
D.setOutput(0, 'goldcoins');
check('addOre/removeOre/setOutput all no-op while locked',
  forges[0].ore.length === oreCountBeforeLockedAttempt && forges[0].ore[0].res === 'golddust' && forges[0].output.res === 'goldbars');
const woodWorkersBefore = forges[0].woodWorkers;
D.subAssign(0, 'wood', undefined);
check('staffing (subAssign) still works while locked', forges[0].woodWorkers === woodWorkersBefore + 1);
D.cancel(0);
check('Cancel stops an active Forge', forges[0].phase === 'stopped');

/* ---- Billing: stopped-Forge workers are free; active ones cost gold ---- */
// Forge 1 stays fully stopped here — its 2 assigned-but-parked workers
// (staffed below) must draw 0 gold, per getBillableCount().
D.addOre(1, 'nugget');
D.subAssign(1, 'ore', 0);
D.subAssign(1, 'wood', undefined);
check('billableWorkers() is 0 while every Forge is stopped', sm.getBillableCount() === 0, `billable=${sm.getBillableCount()}`);
const goldBefore = OW.Resources.get('gold');
tick(OW, 5);
check('gold does not drain for workers parked on a stopped Forge', OW.Resources.get('gold') === goldBefore, `before=${goldBefore} after=${OW.Resources.get('gold')}`);

D.setOutput(1, 'goldcoins');
D.subAssign(1, 'output', undefined);
D.smelt(1);
check('billableWorkers() counts only the now-active Forge 1', sm.getBillableCount() === 3, `billable=${sm.getBillableCount()}`);
const goldBefore2 = OW.Resources.get('gold');
tick(OW, 5);
check('gold drains once a Forge is actively cycling', OW.Resources.get('gold') < goldBefore2, `before=${goldBefore2} after=${OW.Resources.get('gold')}`);
D.cancel(1);

/* ---- Add-Forge: cost, cap, and disappearing past cap ---- */
OW.Mountains.ensureResource('goldbars', 'Gold Bars');
function refillBars() { OW.Resources.setRaw('mtn_goldbars', 2000); }
refillBars();
const n0 = forges.length;
D.addForge();
check('addForge grows the array and spends 2000 Gold Bars',
  forges.length === n0 + 1 && OW.Resources.get('mtn_goldbars') === 0, `count=${forges.length} bars=${OW.Resources.get('mtn_goldbars')}`);
let capGuard = 0;
while (forges.length < 8 && capGuard++ < 20) { refillBars(); D.addForge(); }
check('Forge count caps at 8', forges.length === 8, `count=${forges.length}`);
refillBars();
check('canAdd() is false past the cap', D.canAdd() === false);
D.addForge();
check('no Forge added past the cap', forges.length === 8);

/* ---- Save/load round trip ---- */
D.addOre(2, 'golddust');
D.subAssign(2, 'ore', 0);
const boardA = D.forges().map((f) => ({ phase: f.phase, ore: f.ore, woodWorkers: f.woodWorkers, woodBank: f.woodBank, molten: f.molten, output: f.output }));
STORE.setItem('orbweaver.save.v1', OW.Save.encode(OW.Save.serialize()));

const B = boot();
check('second boot with no script errors', B.errors.length === 0, B.errors.join('\n        '));
const smB = B.OW.Mechanics.get('smeltershack');
const boardB = smB._debug.forges().map((f) => ({ phase: f.phase, ore: f.ore, woodWorkers: f.woodWorkers, woodBank: f.woodBank, molten: f.molten, output: f.output }));
check('Forge board survived save/load', JSON.stringify(boardA) === JSON.stringify(boardB),
  `${JSON.stringify(boardA)}\n        ${JSON.stringify(boardB)}`);

/* ---- DOM/UI: the modal actually renders Forges, and a real click
   reaches the mechanic through the real open-modal + afterRender path
   (not just the _debug surface). ---- */
sm.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
check('card click opens the Smelter Shack modal', OW.Cards.isModalOpenFor('smeltershack'));
const body = w.document.getElementById('card-modal-body');
const renderedForgeCards = body.querySelectorAll('[data-sm-forge]');
check('modal renders one card per Forge', renderedForgeCards.length === D.forges().length, `rendered=${renderedForgeCards.length} state=${D.forges().length}`);

const freshForges = D.forges();
D.addOre(3, 'golddust');
OW.Cards.refreshOpenModal('smeltershack'); // structural rebuild so the new row's stepper exists in the DOM
const plusBtn = body.querySelector('[data-sm-plus="3:ore:0"]');
check('a rendered ore-row stepper button exists for a real row', !!plusBtn);
if (plusBtn) {
  const before = freshForges[3].ore[0].workers;
  plusBtn.dispatchEvent(new w.Event('pointerdown'));
  check('a real click on that button reaches subAssign and updates state', freshForges[3].ore[0].workers === before + 1,
    `before=${before} after=${freshForges[3].ore[0].workers}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
