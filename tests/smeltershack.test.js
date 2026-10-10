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

let heatGuard = 0;
while (forges[0].phase === 'heating' && heatGuard++ < 200) tick(OW, 1); // burning starts at 50 wood (1 worker x 1/s)
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
const plusBtn = body.querySelector('[data-sm-plus="3:ore"]');
check('the Input header stepper exists once the Forge has an ore row', !!plusBtn);
if (plusBtn) {
  const before = freshForges[3].oreWorkers;
  plusBtn.dispatchEvent(new w.Event('pointerdown'));
  check('a real click on that button reaches subAssign and updates state', freshForges[3].oreWorkers === before + 1,
    `before=${before} after=${freshForges[3].oreWorkers}`);
}

/* ---- Global M bug fix: a global M buff must land at the SAME % on
   every ore kind (Gold Dust m=24, Nuggets m=3, Gold Bars m=1), not
   scale by 1/kind.m the way it did when kind.m occupied the m slot
   (previously: +1 globalM was worth +4% on Gold Dust but +100% on
   Gold Bars, same card, same tick). ---- */
function molten1sFromOre(res) {
  const a = boot();
  const smA = a.OW.Mechanics.get('smeltershack'), DA = smA._debug;
  a.OW.Cards.reveal(smA); a.OW.Mountains.reveal(); a.OW.Mountains.addWorkers(5);
  a.OW.Mountains.workerPool.assign('smeltershack');
  DA.addOre(0, res);
  DA.subAssign(0, 'ore', 0);
  a.OW.Resources.setRaw('mtn_wood', 1000000, 1000000);
  if (res === 'goldbars') { a.OW.Mountains.ensureResource('goldbars', 'Gold Bars'); a.OW.Resources.setRaw('mtn_goldbars', 1000000, 1000000); }
  else a.OW.HiddenRes.add(res, 1000000);
  DA.smelt(0);
  DA.forges()[0].phase = 'filling'; DA.forges()[0].woodBank = 200; // skip Heating — only the ore->molten rate matters here
  tick(a.OW, 1);
  return DA.forges()[0].molten;
}
function molten1sBuffed(res) {
  const a = boot();
  a.w.document.getElementById('cheat-mpf-m').click(); // global M +0.1
  const smA = a.OW.Mechanics.get('smeltershack'), DA = smA._debug;
  a.OW.Cards.reveal(smA); a.OW.Mountains.reveal(); a.OW.Mountains.addWorkers(5);
  a.OW.Mountains.workerPool.assign('smeltershack');
  DA.addOre(0, res);
  DA.subAssign(0, 'ore', 0);
  a.OW.Resources.setRaw('mtn_wood', 1000000, 1000000);
  if (res === 'goldbars') { a.OW.Mountains.ensureResource('goldbars', 'Gold Bars'); a.OW.Resources.setRaw('mtn_goldbars', 1000000, 1000000); }
  else a.OW.HiddenRes.add(res, 1000000);
  DA.smelt(0);
  DA.forges()[0].phase = 'filling'; DA.forges()[0].woodBank = 200;
  tick(a.OW, 1);
  return DA.forges()[0].molten;
}
{
  newStore(); const goldDustBase = molten1sFromOre('golddust');
  newStore(); const goldBarsBase = molten1sFromOre('goldbars');
  newStore(); const goldDustBuffed = molten1sBuffed('golddust');
  newStore(); const goldBarsBuffed = molten1sBuffed('goldbars');
  const pctGoldDust = (goldDustBuffed / goldDustBase - 1) * 100;
  const pctGoldBars = (goldBarsBuffed / goldBarsBase - 1) * 100;
  check('a global +M buff lands at the same % on Gold Dust (m=24) and Gold Bars (m=1)',
    Math.abs(pctGoldDust - pctGoldBars) < 0.5,
    `Gold Dust +${pctGoldDust.toFixed(1)}%, Gold Bars +${pctGoldBars.toFixed(1)}%`);
}

/* ---- Recipes bar: fresh-board scenarios, isolated from the mutated
   board above via a dedicated boot+reveal helper. ---- */
function freshSmelter(workers) {
  newStore();
  const a = boot();
  const smA = a.OW.Mechanics.get('smeltershack');
  const DA = smA._debug;
  a.OW.Cards.reveal(smA);
  a.OW.Mountains.reveal();
  a.OW.Mountains.addWorkers(workers);
  return { a, w: a.w, OW: a.OW, sm: smA, D: DA };
}

// Scenario 1: Apply fills ore+output on the first empty Forge, never
// staffs workers, never auto-Smelts.
{
  const { OW: OWr, D } = freshSmelter(10);
  D.applyRecipe(0); // Gold Dust -> Gold Coins
  const f0 = D.forges()[0];
  check('recipe apply fills ore and output with 0 workers, still stopped',
    f0.ore.length === 1 && f0.ore[0].res === 'golddust' && f0.oreWorkers === 0 &&
    f0.output.res === 'goldcoins' && f0.output.workers === 0 && f0.phase === 'stopped');
}

// Scenario 2: a hand-configured Forge (any ore/output selection, even
// partial) is skipped as a target — Apply goes to the next empty one.
{
  const { D } = freshSmelter(10);
  D.addOre(0, 'nugget'); // hand-configure forge 0 (nothing else)
  D.applyRecipe(0);
  check('hand-configured Forge is skipped; recipe lands on Forge 1 instead',
    D.forges()[0].ore.length === 1 && D.forges()[0].ore[0].res === 'nugget' && !D.forges()[0].output.res &&
    D.forges()[1].ore[0].res === 'golddust' && D.forges()[1].output.res === 'goldcoins');
}

// Scenario 3: a recipe-configured Forge is likewise skipped by a later apply.
{
  const { D } = freshSmelter(10);
  D.applyRecipe(0); // forge 0 now recipe-configured
  D.applyRecipe(1); // should land on forge 1, not re-target forge 0
  check('a second Apply skips the already recipe-configured Forge 0',
    D.forges()[0].output.res === 'goldcoins' && D.forges()[1].output.res !== null && D.forges()[1] !== D.forges()[0]);
}

// Scenario 4: an auto-stopped Forge (ran dry on its own) keeps its
// selections and still counts as "configured" -> stays skipped.
{
  const { OW: OWr, D } = freshSmelter(20);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 4; i++) pool.assign('smeltershack');
  D.addOre(0, 'golddust');
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'wood', undefined);
  D.setOutput(0, 'goldbars');
  D.subAssign(0, 'output', undefined);
  OWr.Resources.setRaw('mtn_wood', 1000000, 1000000);
  OWr.HiddenRes.add('golddust', 1000000);
  D.smelt(0);
  tick(OWr, 220);
  let guard = 0;
  while (D.forges()[0].phase !== 'stopped' && guard++ < 2000) tick(OWr, 1);
  check('Forge 0 auto-stopped before Apply', D.forges()[0].phase === 'stopped', `guard=${guard}`);
  D.applyRecipe(0);
  check('Apply skips an auto-stopped-but-configured Forge, targets Forge 1',
    D.forges()[0].output.res === 'goldbars' && D.forges()[1].output.res !== null);
}

// Scenario 5: no eligible empty Forge -> Apply is a no-op and every
// recipe row renders disabled with "No empty Forge". Renders via
// renderModalHTML() directly into a detached div rather than the real
// click-to-open flow, which needs real wall-clock time to clear the
// mobile ghost-click guard (GHOST_MS) — irrelevant to what's being
// tested here and needlessly flaky in a synchronous test.
{
  const { w: wr, D, sm: smR } = freshSmelter(10);
  D.applyRecipe(0); D.applyRecipe(1); // fill both starting Forges
  const before = JSON.stringify(D.forges());
  D.applyRecipe(2);
  check('applyRecipe is a no-op once every Forge is configured', JSON.stringify(D.forges()) === before);
  check('recipeDisabledReason is "No empty Forge" for every recipe once full',
    D.RECIPES.every((r) => D.recipeDisabledReason(r) === 'No empty Forge'));
  const bodyR = wr.document.createElement('div');
  bodyR.innerHTML = smR.renderModalHTML();
  const rows = bodyR.querySelectorAll('[data-sm-recipe-apply]');
  const allDisabled = rows.length > 0 && Array.from(rows).every((btn) => btn.disabled);
  const reasonsFilled = Array.from(bodyR.querySelectorAll('[data-sm-recipe-reason]')).every((el) => el.textContent.trim() === 'No empty Forge');
  check('every rendered recipe row is disabled with reason text shown', allDisabled && reasonsFilled);
}

// Scenario 6: Clear empties a Forge, it becomes the next Apply target,
// and Clear never changes the card's total assigned-worker count.
{
  const { OWr, D } = (() => { const s = freshSmelter(10); return { OWr: s.OW, D: s.D }; })();
  D.applyRecipe(0);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 2; i++) pool.assign('smeltershack');
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'output', undefined);
  const assignedBefore = pool.getAssigned('smeltershack');
  D.clearForge(0);
  check('Clear empties ore/output and returns Forge to stopped',
    D.forges()[0].ore.length === 0 && !D.forges()[0].output.res && D.forges()[0].phase === 'stopped');
  check('Clear does not change the card\'s total assigned-worker count', pool.getAssigned('smeltershack') === assignedBefore);
  D.applyRecipe(1); // second recipe -> forge 1 was already empty, so this just checks forge 0 is a valid next target
  D.applyRecipe(2);
  check('a cleared Forge becomes a valid Apply target again', D.forges()[0].output.res !== null);
}

// Scenario 7: Clear is inert on an actively-running Forge.
{
  const { OWr, D } = (() => { const s = freshSmelter(20); return { OWr: s.OW, D: s.D }; })();
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 4; i++) pool.assign('smeltershack');
  D.addOre(0, 'golddust');
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'wood', undefined);
  D.setOutput(0, 'goldbars');
  D.subAssign(0, 'output', undefined);
  OWr.Resources.setRaw('mtn_wood', 1000000, 1000000);
  OWr.HiddenRes.add('golddust', 1000000);
  D.smelt(0);
  tick(OWr, 5); // now heating, definitely active
  const before = JSON.stringify(D.forges()[0]);
  D.clearForge(0);
  check('Clear is a no-op on an actively-running (non-stopped) Forge', JSON.stringify(D.forges()[0]) === before);
}

// Scenario 8: every one of the 6 recipes produces the correct output
// via a real tick, run in its own fresh boot to avoid cross-recipe
// forge-slot contention.
{
  // goldcoins pays into the shared 'gold' resource, which billing also
  // drains from every tick — net balance can't isolate production there,
  // so that one case is verified via a spy on Resources.add instead.
  const EXPECT_ID = ['gold', 'mtn_goldbars', 'mtn_goldbars', 'mtn_copperingots', 'mtn_copperhead', 'mtn_luxury'];
  let allOk = true; let detail = '';
  for (let ri = 0; ri < 6; ri++) {
    const { OWr, D } = (() => { const s = freshSmelter(20); return { OWr: s.OW, D: s.D }; })();
    // Seed stock with headroom above cap so the same resource can also
    // grow when a recipe produces it (recipe 4/5 consume Copper Ingots
    // or Gold Bars that recipe 1/3 produce, in a different fresh boot).
    OWr.Mountains.ensureResource('copperhead', 'Copper Tool Head');
    OWr.Resources.setRaw('mtn_copperhead', 500000, 5000000);
    OWr.Resources.setRaw('mtn_wood', 1000000, 1000000);
    OWr.HiddenRes.add('golddust', 1000000);
    OWr.HiddenRes.add('nugget', 1000000);
    OWr.Mountains.ensureResource('goldbars', 'Gold Bars');
    OWr.Resources.setRaw('mtn_goldbars', 500000, 5000000);
    OWr.Mountains.ensureResource('copperingots', 'Copper Ingots');
    OWr.Resources.setRaw('mtn_copperingots', 500000, 5000000);
    D.applyRecipe(ri);
    const pool = OWr.Mountains.workerPool;
    const oreWorkersNeeded = D.forges()[0].ore.length;
    for (let i = 0; i < oreWorkersNeeded + 2; i++) pool.assign('smeltershack');
    for (let i = 0; i < oreWorkersNeeded; i++) D.subAssign(0, 'ore', i);
    D.subAssign(0, 'wood', undefined); D.subAssign(0, 'wood'); // 2 Hearth workers hold the 2/s burn
    D.subAssign(0, 'output', undefined);
    const resId = EXPECT_ID[ri];
    let gained = 0;
    const origAdd = OWr.Resources.add;
    OWr.Resources.add = function (id, n) { if (id === resId) gained += n; return origAdd.call(OWr.Resources, id, n); };
    D.smelt(0);
    tick(OWr, 260);
    let guard = 0;
    while (D.forges()[0].phase !== 'outputting' && D.forges()[0].phase !== 'stopped' && guard++ < 500) tick(OWr, 5);
    tick(OWr, 30);
    OWr.Resources.add = origAdd;
    if (!(gained > 0)) { allOk = false; detail += ` recipe${ri}(${resId}):gained=${gained},phase=${D.forges()[0].phase};`; }
  }
  check('all 6 recipes produce their expected output via a real tick', allOk, detail);
}

// Scenario 9: Copper Tool Head recipe spends Mountains' mtn_copperhead,
// never Camp's copperhead (same base id, different location prefix).
{
  const { OWr, D } = (() => { const s = freshSmelter(20); return { OWr: s.OW, D: s.D }; })();
  OWr.Mountains.ensureResource('copperhead', 'Copper Tool Head');
  OWr.Resources.setRaw('mtn_copperhead', 1000, 1000);
  const camp = OWr.Locations.get('camp');
  camp.ensureResource('copperhead', 'Copper Tool Head');
  OWr.Resources.add('copperhead', 1000);
  const campBefore = OWr.Resources.get('copperhead');
  const ri = D.RECIPES.findIndex((r) => r.inputs.length === 1 && r.inputs[0] === 'copperhead');
  D.applyRecipe(ri);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 3; i++) pool.assign('smeltershack');
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'wood', undefined);
  D.subAssign(0, 'output', undefined);
  OWr.Resources.setRaw('mtn_wood', 1000000, 1000000);
  D.smelt(0);
  tick(OWr, 260);
  let guard = 0;
  while (D.forges()[0].phase === 'heating' && guard++ < 500) tick(OWr, 5);
  tick(OWr, 30);
  check('mtn_copperhead was spent by the recipe', OWr.Resources.get('mtn_copperhead') < 1000);
  check('Camp\'s copperhead (different location) is untouched', OWr.Resources.get('copperhead') === campBefore);
}

// Scenario 10: Copper Ingots and Luxury are created on first production
// and display as whole numbers, including after being "shipped" to
// another location (simulated the way completeVehicle() delivers cargo).
{
  const { OWr, D } = (() => { const s = freshSmelter(20); return { OWr: s.OW, D: s.D }; })();
  OWr.Mountains.ensureResource('copperhead', 'Copper Tool Head');
  OWr.Resources.setRaw('mtn_copperhead', 1000000, 1000000);
  OWr.Resources.setRaw('mtn_wood', 1000000, 1000000);
  const ri = D.RECIPES.findIndex((r) => r.output === 'copperingots');
  D.applyRecipe(ri);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 3; i++) pool.assign('smeltershack');
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'wood', undefined); D.subAssign(0, 'wood'); // 2 Hearth workers hold the 2/s burn
  D.subAssign(0, 'output', undefined);
  D.smelt(0);
  tick(OWr, 260);
  let guard = 0;
  while (D.forges()[0].phase !== 'outputting' && D.forges()[0].phase !== 'stopped' && guard++ < 500) tick(OWr, 5);
  tick(OWr, 30);
  const mtnEntry = OWr.Resources.all().find((r) => r.id === 'mtn_copperingots');
  check('Copper Ingots created on first production and displays as integer',
    !!mtnEntry && mtnEntry.displayType === 'integer' && OWr.Resources.get('mtn_copperingots') > 0);
  // simulate shipping to Camp the same way completeVehicle() does
  const camp = OWr.Locations.get('camp');
  camp.ensureResource('copperingots', 'Copper Ingots');
  OWr.Resources.add('copperingots', 10);
  const campEntry = OWr.Resources.all().find((r) => r.id === 'copperingots');
  check('Copper Ingots also displays as integer after arriving at Camp',
    !!campEntry && campEntry.displayType === 'integer');
}

// Scenario 11: output select offers the full, current 5-kind set.
// Renders via renderModalHTML() directly (see Scenario 5's note on
// why the real click-to-open flow is avoided here).
{
  const { w: wr, sm: smR } = freshSmelter(10);
  const bodyR = wr.document.createElement('div');
  bodyR.innerHTML = smR.renderModalHTML();
  const outSelect = bodyR.querySelector('[data-sm-output-select="0"]');
  const optionValues = Array.from(outSelect.querySelectorAll('option')).map((o) => o.value).filter(Boolean);
  check('output select offers all 5 output kinds', optionValues.sort().join(',') === 'copperhead,copperingots,goldbars,goldcoins,luxury', optionValues.join(','));
}

// Scenario 12: the resource strip is dynamic — Copper Ingots appears
// live once it exists; Copper Tool Head and Luxury never appear in it.
{
  const { OW: OWr, w: wr, sm: smR, D } = freshSmelter(20);
  OWr.Mountains.ensureResource('copperhead', 'Copper Tool Head');
  OWr.Resources.setRaw('mtn_copperhead', 1000000, 1000000);
  OWr.Resources.setRaw('mtn_wood', 1000000, 1000000);
  let bodyR = wr.document.createElement('div');
  bodyR.innerHTML = smR.renderModalHTML();
  check('resource strip does not show Copper Ingots before any exists', !bodyR.querySelector('[data-sm-res-amt="copperingots"]'));
  const ri = D.RECIPES.findIndex((r) => r.output === 'copperingots');
  D.applyRecipe(ri);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 3; i++) pool.assign('smeltershack');
  D.subAssign(0, 'ore', 0);
  D.subAssign(0, 'wood', undefined); D.subAssign(0, 'wood'); // 2 Hearth workers hold the 2/s burn
  D.subAssign(0, 'output', undefined);
  D.smelt(0);
  tick(OWr, 260);
  let guard = 0;
  while (D.forges()[0].phase !== 'outputting' && D.forges()[0].phase !== 'stopped' && guard++ < 500) tick(OWr, 5);
  tick(OWr, 30);
  bodyR = wr.document.createElement('div');
  bodyR.innerHTML = smR.renderModalHTML();
  check('resource strip shows Copper Ingots once produced', !!bodyR.querySelector('[data-sm-res-amt="copperingots"]'));
  check('resource strip never shows Copper Tool Head or Luxury',
    !bodyR.querySelector('[data-sm-res-amt="copperhead"]') && !bodyR.querySelector('[data-sm-res-amt="luxury"]'));
}

/* ---- Sections, shared Input stepper, Wood strip, card-face bar ---- */
{
  const { w: wr, OW: OWr, sm, D } = freshSmelter(10);
  OWr.HiddenRes.add('golddust', 100000); OWr.HiddenRes.add('nugget', 100000);
  const render = () => { const b = wr.document.createElement('div'); b.innerHTML = sm.renderModalHTML(); return b; };
  let b = render();
  const forge0 = b.querySelector('[data-sm-forge="0"]');
  check('Forge sections titled Input, Molten pool, Hearth, Anvil in order',
    [...forge0.querySelectorAll('.sm-sec-title')].map((e) => e.textContent).join() === 'Input,Molten pool,Hearth,Anvil');
  check('Input, Hearth and Anvil steppers sit in their headers; Molten pool has none',
    !!forge0.querySelector('.sm-box-ore .sm-sec-head [data-sm-plus="0:ore"]') && !!forge0.querySelector('.sm-box-output .sm-sec-head [data-sm-plus="0:output"]') &&
    !!forge0.querySelector('.sm-box-hearth .sm-sec-head [data-sm-plus="0:wood"]') && !forge0.querySelector('.sm-box-fuel .card-steppers'));
  check('Hearth header shows the wood bank; molten % stays above the bar',
    !!forge0.querySelector('.sm-box-hearth .sm-sec-head [data-sm-wood-bank="0"]') && !!forge0.querySelector('.sm-box-fuel .sm-status-line [data-sm-molten-pct="0"]'));
  check('resource strip lists Wood first', b.querySelector('.sm-resbar-label').textContent === 'Wood' &&
    +b.querySelector('[data-sm-res-amt="wood"]').textContent === Math.round(OWr.Resources.get('mtn_wood')));
  D.addOre(0, 'golddust'); D.addOre(0, 'nugget');
  b = render();
  const box = b.querySelector('[data-sm-forge="0"] .sm-box-ore');
  check('+ Add resource sits above the chosen ore rows (none left to add hides it)', !box.querySelector('[data-sm-add-resource]'));
  D.removeOre(0, 1);
  b = render();
  const kids = [...b.querySelector('[data-sm-forge="0"] .sm-box-ore').children];
  check('+ Add resource sits above the chosen ore row', kids.findIndex((e) => e.matches('[data-sm-add-resource]')) < kids.findIndex((e) => e.matches('.sm-ore-row')));
  D.addOre(0, 'nugget');
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 6; i++) pool.assign('smeltershack');
  for (let i = 0; i < 4; i++) D.subAssign(0, 'ore');
  D.subAssign(0, 'wood'); D.subAssign(0, 'output'); // output not chosen: no-op
  const f = D.forges()[0];
  check('Input is one shared count; Anvil needs an output first', f.oreWorkers === 4 && f.woodWorkers === 1 && f.output.workers === 0);
  D.setOutput(0, 'goldbars'); D.subAssign(0, 'output');
  b = render();
  check('two ores split the Input work in half (4 workers -> 48 dust/s, 6 nuggets/s)',
    b.querySelector('[data-sm-rate="0:ore:0"]').textContent === '48.00 gold dust /s' && b.querySelector('[data-sm-rate="0:ore:1"]').textContent === '6.00 gold nuggets /s');
  D.removeOre(0, 1);
  b = render();
  check('one ore takes the full Input work', b.querySelector('[data-sm-rate="0:ore:0"]').textContent === '96.00 gold dust /s' && f.oreWorkers === 4);
  check('card face bar empty with nothing running', sm.getBuildBarPct() === 0 && !sm.isBuildBarFaded());
  D.smelt(0);
  tick(OWr, 10);
  check('heating: bar is wood toward 50, faded', f.phase === 'heating' && Math.abs(sm.getBuildBarPct() - f.woodBank / 50 * 100) < 1e-9 && sm.isBuildBarFaded());
  let g = 0; while (f.phase === 'heating' && g++ < 500) tick(OWr, 1);
  check('filling: bar is molten %, faded', f.phase === 'filling' && sm.getBuildBarPct() === f.molten && sm.isBuildBarFaded());
  g = 0; while (f.phase === 'filling' && g++ < 500) tick(OWr, 0.2);
  check('outputting: bar is molten %, bright', f.phase === 'outputting' && sm.getBuildBarPct() === f.molten && !sm.isBuildBarFaded());
  const saved = JSON.stringify(OWr.Save.serialize().mechanics.smeltershack.fg[0]);
  check('save carries ore ids and the shared Input count', /"or":\["golddust"\]/.test(saved) && /"iw":4/.test(saved));
}

/* ---- Forge stop notes ---- */
{
  const { w: wr, OW: OWr, sm, D } = freshSmelter(10);
  OWr.HiddenRes.add('golddust', 100000);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 3; i++) pool.assign('smeltershack');
  const f = D.forges()[0];
  const prep = () => { D.addOre(0, 'golddust'); D.setOutput(0, 'goldbars'); };
  prep(); D.subAssign(0, 'ore'); D.subAssign(0, 'wood'); D.subAssign(0, 'output');
  // Empty Wood: fill, then pull every Hearth worker and drain mtn_wood so the burn empties the bank.
  D.smelt(0);
  let g = 0; while (f.phase === 'heating' && g++ < 500) tick(OWr, 1);
  D.subUnassign(0, 'wood'); OWr.Resources.setRaw('mtn_wood', 0, 2000); OWr.HiddenRes.spend('golddust', 1e9);
  g = 0; while (f.phase !== 'stopped' && g++ < 500) tick(OWr, 1);
  check('a Forge that burns through its hearth notes "Empty Wood"', f.phase === 'stopped' && f.note === 'Empty Wood', `phase=${f.phase} note=${f.note}`);
  OWr.Cards.reveal(sm);
  const body = wr.document.getElementById('card-modal-body');
  body.innerHTML = sm.renderModalHTML();
  check('the note renders in the Forge header', body.querySelector('[data-sm-forge="0"] .hs-head [data-sm-note]').textContent === 'Empty Wood');
  body.querySelector('[data-sm-forge="0"] [data-sm-plus="0:wood"]').dispatchEvent(new wr.Event('pointerdown', { bubbles: true }));
  check('touching that Forge clears the note', f.note === '' && body.querySelector('[data-sm-note="0"]').textContent === '');
  // Empty molten pool: refill and let the Anvil drain it.
  OWr.Resources.setRaw('mtn_wood', 2000, 2000); OWr.HiddenRes.add('golddust', 100000);
  D.subAssign(0, 'wood'); D.subAssign(0, 'wood'); D.smelt(0); // 2 Hearth workers hold the burn until the pool fills
  g = 0; while (f.phase !== 'outputting' && g++ < 800) tick(OWr, 1);
  D.subAssign(0, 'wood'); // 3 Hearth workers out-pace the 2/s burn, so only the pool can empty
  OWr.HiddenRes.spend('golddust', 1e9);
  g = 0; while (f.phase !== 'stopped' && g++ < 800) tick(OWr, 1);
  check('an Anvil that drains the pool notes "Empty molten pool"', f.note === 'Empty molten pool', `phase=${f.phase} note=${f.note}`);
  body.innerHTML = sm.renderModalHTML();
  body.querySelector('[data-sm-forge="0"] [data-sm-output-select]').dispatchEvent(new wr.Event('change', { bubbles: true }));
  check('a picker change in that Forge clears the note', f.note === '');
  D.smelt(0); D.cancel(0);
  check('Cancel leaves no note', f.phase === 'stopped' && f.note === '');
  check('Add Forge button reads "2000 Gold bars"', /^\d+ Gold bars$/.test((() => { const d = wr.document.createElement('div'); d.innerHTML = sm.renderModalHTML(); return d.querySelector('[data-sm-add-btn]').textContent; })()));
  check('the note is not saved', !('note' in OWr.Save.serialize().mechanics.smeltershack.fg[0]) && !/note/.test(JSON.stringify(OWr.Save.serialize().mechanics.smeltershack)));
}

/* ---- Heat bands ---- */
{
  const { w: wr, OW: OWr, sm, D } = freshSmelter(10);
  OWr.HiddenRes.add('golddust', 1e6);
  const pool = OWr.Mountains.workerPool;
  for (let i = 0; i < 6; i++) pool.assign('smeltershack');
  D.addOre(0, 'golddust'); D.setOutput(0, 'goldbars');
  for (let i = 0; i < 3; i++) D.subAssign(0, 'ore');
  D.subAssign(0, 'wood'); D.subAssign(0, 'output');
  const f = D.forges()[0];
  D.smelt(0);
  tick(OWr, 30);
  check('heating card-face bar fills toward 50 wood', f.phase === 'heating' && Math.abs(sm.getBuildBarPct() - f.woodBank / 50 * 100) < 1e-9);
  let g = 0; while (f.phase === 'heating' && g++ < 2000) tick(OWr, 0.2);
  const at0 = () => { const d = wr.document.createElement('div'); d.innerHTML = sm.renderModalHTML(); return d.querySelector('[data-sm-heat="0"]').textContent; };
  check('burning starts at 50 wood, while Cool', f.phase === 'filling' && f.woodBank >= 50 && f.woodBank < 55 && at0() === 'Cool -x0.5', `bank=${f.woodBank}`);
  const body = wr.document.createElement('div');
  const read = (sel) => { body.innerHTML = sm.renderModalHTML(); const e = body.querySelector(sel); return [e.textContent, e.className]; };
  const at = (bank) => { f.woodBank = bank; return read('.sm-box-hearth .sm-sec-head [data-sm-heat="0"]'); };
  check('Cool -x0.5 below 80 wood, in the Hearth header, soft blue', at(79).join() === 'Cool -x0.5,sm-heat sm-heat-cool');
  check('Hot from 80 to 150 wood, forge orange', at(80)[0] === 'Hot' && at(150).join() === 'Hot,sm-heat sm-heat-hot');
  check('Superheating +x1.5 above 150 wood, red-orange', at(151).join() === 'Superheating +x1.5,sm-heat sm-heat-superheat');
  check('heat label sits above the x/200 bank', (() => { body.innerHTML = sm.renderModalHTML(); const r = body.querySelector('.sm-hearth-right').children; return r[0].matches('[data-sm-heat]') && r[1].matches('[data-sm-wood-bank]'); })());
  const poolText = (phase, mutate) => { const keep = [f.phase, f.output.workers]; f.phase = phase; if (mutate) mutate(); const t = read('[data-sm-status="0"]')[0]; [f.phase, f.output.workers] = keep; return t; };
  check('Molten pool reads Heating / Filling / Pouring / Stopped', poolText('heating') === 'Heating' && poolText('filling') === 'Filling' && poolText('outputting') === 'Pouring' && poolText('stopped') === 'Stopped');
  check('Pouring with no Anvil workers reads Holding', poolText('outputting', () => { f.output.workers = 0; }) === 'Holding');
  check('no heat label while heating or stopped', (() => { const p = f.phase; f.phase = 'heating'; const h = at(100)[0]; f.phase = 'stopped'; const st = at(100)[0]; f.phase = p; return h === '' && st === ''; })());
  // Anvil speed per band: drain one tick of molten at a fixed bank and compare.
  const drain = (bank) => { f.phase = 'outputting'; f.molten = 50; f.woodBank = bank; const ore = f.oreWorkers; f.oreWorkers = 0; OWr.Mountains.workerPool.onChange; tick(OWr, 0.2); f.oreWorkers = ore; return 50 - f.molten; };
  const base = drain(120), cool = drain(60), hot = drain(190);
  check('Anvil runs x0.5 Cool, x1 Hot, x1.5 Superheating', Math.abs(cool / base - 0.5) < 1e-6 && Math.abs(hot / base - 1.5) < 1e-6, `base=${base} cool=${cool} hot=${hot}`);
  f.woodBank = 60; f.phase = 'filling'; tick(OWr, 0.2);
  check('below 80 a burning Forge stays burning (Cool), never back to Heating', f.phase === 'filling');
  f.phase = 'outputting'; f.molten = 50; f.woodBank = 190;
  body.innerHTML = sm.renderModalHTML();
  check('Anvil rate text includes the heat multiplier', body.querySelector('[data-sm-rate="0:output"]').textContent === '1.50 gold bars /s');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
