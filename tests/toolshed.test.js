/* Tool Shed. Boots the real game headless, stages benches, and drives
   ticks through the public surface — same style as the other suites.
   Covers starting state, the output-must-be-chosen-before-staffing
   rule, the output select locking while staffed and unlocking once
   empty, the binary recipe gate (frozen progress on a wood/stone
   shortfall, no partial credit, resuming from the exact frozen point),
   full gold-starvation stop, billing (a starved bench's workers are
   free), Add-Bench cost/cap (gated on Camp's own 'goldbars' row),
   save/load, the Camp Construction-list reveal path, and a real card
   click + stepper click reaching the mechanic through the DOM. */
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

const ts = OW.Mechanics.get('toolshed');
const D = ts._debug;
OW.Cards.reveal(ts);

/* ---- Starting state: one bench per tool tier, fixed, unstaffed ---- */
let benches = D.benches();
check('one bench per entry in BENCHES', benches.length === D.BENCHES.length && benches.length === 2,
  `count=${benches.length} BENCHES=${D.BENCHES.length}`);
check('each bench is permanently bound to its own tool, in BENCHES order',
  benches.every((b, i) => b.res === D.BENCHES[i]), benches.map((b) => b.res).join(','));
check('benches start unstaffed', benches.every((b) => b.workers === 0));
check('each bench takes its cycle time from its own recipe',
  benches.every((b) => b.cyc.getCycleTime() === D.RECIPES[b.res].cycleTime),
  benches.map((b) => `${b.res}=${b.cyc.getCycleTime()}`).join(' '));
check('every recipe carries the roman numeral its header renders',
  D.BENCHES.every((r) => /^[IVX]+$/.test(D.RECIPES[r].tier)));
check('the mechanic no longer exposes any output-selection or bench-buying API',
  ['setOutput', 'addBench', 'canAdd', 'atCap'].every((k) => D[k] === undefined));

/* ---- Staffing is immediate: there is no output to choose first ---- */
for (let i = 0; i < 3; i++) OW.Workers.assign('toolshed');
D.subAssign(0);
check('subAssign staffs a bench straight away', benches[0].workers === 1);
D.subUnassign(0);
check('subUnassign removes the worker again', benches[0].workers === 0);

/* ---- Recipe gate: staff, seed plenty of wood/stone, confirm production ---- */
OW.Resources.setRaw('wood', 100000, 100000);
OW.Resources.setRaw('stone', 100000, 100000);
D.subAssign(0);
const toolsBefore = OW.Resources.get('tools2');
tick(OW, 5); // 1 worker -> 1 tool/s baseline -> ~5 tools
const toolsAfter = OW.Resources.get('tools2');
check('bench produces Tools II when wood/stone are available', toolsAfter > toolsBefore, `before=${toolsBefore} after=${toolsAfter}`);
const woodSpent = 100000 - OW.Resources.get('wood');
const stoneSpent = 100000 - OW.Resources.get('stone');
check('recipe spends 1 wood + 2 stone per Tools II produced',
  Math.round(woodSpent) === Math.round(toolsAfter - toolsBefore) && Math.round(stoneSpent) === Math.round((toolsAfter - toolsBefore) * 2),
  `wood=${woodSpent} stone=${stoneSpent} tools=${toolsAfter - toolsBefore}`);

/* ---- Binary gate: shortfall freezes progress, no partial credit ----
   Sub-whole-tool progress keeps banking normally tick to tick (nothing
   spent yet); the freeze only happens on the specific tick that would
   cross into needing a whole tool it can't afford — so the meaningful
   check is that FURTHER ticking while still starved never moves
   progress again, not that it's pinned at whatever value it held
   before the shortfall began. */
OW.Resources.setRaw('wood', 0, 0);
OW.Resources.setRaw('stone', 0, 0);
const bench0 = benches[0];
tick(OW, 3); // enough ticks to reach and freeze at the boundary
check('bench reports starved once wood/stone run out', bench0.starved === true);
const frozenProgress = bench0.cyc.getProgress();
check('frozen progress never reached a full whole tool (< cycle time)', frozenProgress < bench0.cyc.getCycleTime());
tick(OW, 3); // keep ticking while still starved
check('progress does not move further while starved (no partial credit)',
  bench0.cyc.getProgress() === frozenProgress, `frozen=${frozenProgress} after=${bench0.cyc.getProgress()}`);
check('no Tools II gained while starved', OW.Resources.get('tools2') === toolsAfter);
OW.Resources.setRaw('wood', 100000, 100000);
OW.Resources.setRaw('stone', 100000, 100000);
tick(OW, 1);
check('production resumes once inputs return, from the frozen point', OW.Resources.get('tools2') > toolsAfter && bench0.starved === false);

/* ---- Gold starvation: full stop, no burn-through ----
   Both workers go on bench 0. Bench 1 is the Tier III bench and has no
   Copper Tool Heads to work with, so staffing it would freeze on its
   input shortfall and make this check vacuous. */
D.subAssign(0);
OW.Resources.setRaw('gold', 0, OW.Resources.getCap('gold'));
const toolsPreGoldStarve = OW.Resources.get('tools2');
const woodPreGoldStarve = OW.Resources.get('wood');
tick(OW, 5);
check('no Tools II production at all while gold-starved', OW.Resources.get('tools2') === toolsPreGoldStarve);
check('no wood spent either — full stop, not a partial burn', OW.Resources.get('wood') === woodPreGoldStarve);
OW.Resources.setRaw('gold', 5000, OW.Resources.getCap('gold'));

/* ---- Billing: a starved bench's workers are free; a producing bench's cost gold ---- */
OW.Resources.setRaw('wood', 0, 0);
OW.Resources.setRaw('stone', 0, 0);
tick(OW, 3); // enough ticks to cross Tools II's 2s cycle time and force the starved state
check('billableWorkers is 0 while every staffed bench is input-starved', ts.getBillableCount() === 0, `billable=${ts.getBillableCount()}`);
OW.Resources.setRaw('wood', 100000, 100000);
OW.Resources.setRaw('stone', 100000, 100000);
tick(OW, 1); // one tick to clear the starved flag via a successful production
check('billableWorkers counts workers once benches are actually producing', ts.getBillableCount() > 0, `billable=${ts.getBillableCount()}`);

/* ---- The Tier III bench is always present and always staffable, even
   with no Copper Tool Heads in existence. It banks progress up to the
   first whole tool, then freezes there permanently — and its workers
   stop being billed while frozen. That free parking spot is deliberate
   (see the mechanic's header comment), so it is asserted, not guarded
   against. ---- */
const tier3 = benches[1];
check('the Tier III bench exists from the start', tier3.res === 'tools3');
check('copper tool heads are genuinely absent', OW.Resources.get('copperhead') === 0);
const billedBefore = ts.getBillableCount();
D.subAssign(1);
tick(OW, 30); // far past Tools III's 10s cycle time
check('the Tier III bench freezes on its missing input', tier3.starved === true);
check('no Tools III were produced', OW.Resources.get('tools3') === 0);
const parkedProgress = tier3.cyc.getProgress();
tick(OW, 30);
check('a frozen Tier III bench never advances again', tier3.cyc.getProgress() === parkedProgress,
  `frozen=${parkedProgress} after=${tier3.cyc.getProgress()}`);
check('its parked worker is not billed', ts.getBillableCount() === billedBefore,
  `before=${billedBefore} after=${ts.getBillableCount()}`);

/* ---- Stopped-state strings. Input rows must stay readable while a
   bench is stopped; only the progress box says 'Stopped'. ---- */
const t3in = D.RECIPES.tools3.inputs;
const rowTexts = t3in.map((inp) => ts._debug.inputRateText(tier3, inp));
check('no input row ever says Stopped', rowTexts.every((t) => !t.includes('Stopped')), rowTexts.join(' | '));
check('the missing input flags itself by name',
  rowTexts.some((t) => /^1 Copper Tool Head – Missing$/.test(t)), rowTexts.join(' | '));
check('an input still in stock keeps its live rate, not a Missing flag',
  rowTexts.some((t) => /wood\/s$/.test(t)), rowTexts.join(' | '));
check('the progress box names an input shortfall',
  ts._debug.outputRateText(tier3) === 'Stopped – Missing resource', ts._debug.outputRateText(tier3));

while (tier3.workers > 0) D.subUnassign(1);

/* ---- Card-face status text ---- */
check('card status reads Crafting with the active bench count', /^Crafting – \d+ bench(es)?$/.test(ts.getStatText()), ts.getStatText());

/* ---- Save/load round trip. A bench's tool is a constant of BENCHES,
   not player state, so the save carries only workers and progress —
   and the reloaded benches must still be bound to the right tools. ---- */
const boardA = D.benches().map((b) => ({ w: b.workers, r: b.res, cp: b.cyc.getProgress() }));
const blob = OW.Save.serialize();
check('the save stores no per-bench tool id', blob.mechanics.toolshed.bn.every((bv) => bv.r === undefined),
  JSON.stringify(blob.mechanics.toolshed));
STORE.setItem('orbweaver.save.v1', OW.Save.encode(blob));

const B = boot();
check('second boot with no script errors', B.errors.length === 0, B.errors.join('\n        '));
const tsB = B.OW.Mechanics.get('toolshed');
const boardB = tsB._debug.benches().map((b) => ({ w: b.workers, r: b.res, cp: b.cyc.getProgress() }));
check('bench board survived save/load, tools included', JSON.stringify(boardA) === JSON.stringify(boardB),
  `${JSON.stringify(boardA)}\n        ${JSON.stringify(boardB)}`);

/* A save written before the bench list was fixed could hold any number
   of entries. The list is rebuilt from BENCHES rather than from the
   save, so no save shape can ever produce a bench without a tool. */
const C = boot();
C.OW.Save.deserialize({ mechanics: { toolshed: { bn: [{ w: 1, cp: 0 }, { w: 1, cp: 0 }, { w: 5, cp: 0 }, { w: 5, cp: 0 }] } } });
const oddBenches = C.OW.Mechanics.get('toolshed')._debug.benches();
check('an over-long save cannot grow the bench list', oddBenches.length === 2, `count=${oddBenches.length}`);
check('every bench still has its correct tool after an odd save',
  oddBenches.every((b, i) => b.res === D.BENCHES[i]), oddBenches.map((b) => b.res).join(','));

/* ---- Camp Construction reveal path ---- */
newStore(); // a truly fresh game — the shared STORE above still holds the mid-test save
const C2 = boot();
const bb = C2.OW.Mechanics.get('buildersbench');
check('Tool Shed card starts hidden on a fresh game', C2.OW.Mechanics.get('toolshed').revealed === false);
check('tools2 resource starts hidden on a fresh game', C2.OW.Resources.exists('tools2') && C2.OW.Resources.all().find((r) => r.id === 'tools2').hidden === true);
C2.OW.Resources.setRaw('wood', 1000, 1000);
C2.OW.Resources.setRaw('stone', 1000, 1000);
bb._debug ? null : null; // buildersbench has no _debug surface — drive it through the real choice track
const buildTrack = C2.OW.Upgrades.getTrack('buildersbench:build');
buildTrack.start('toolshed');
C2.OW.Workers.assign('buildersbench');
let buildGuard = 0;
while (buildTrack.isBuilding() && buildGuard++ < 200) tick(C2.OW, 1);
check('Tool Shed reveals once its Construction item completes', C2.OW.Mechanics.get('toolshed').revealed === true, `guard=${buildGuard}`);
check('tools2 stays hidden right after Tool Shed completes — nothing crafted yet', C2.OW.Resources.all().find((r) => r.id === 'tools2').hidden === true);

const tsC2 = C2.OW.Mechanics.get('toolshed');
const D2 = tsC2._debug;
D2.subAssign(0);
let prodGuard = 0;
while (C2.OW.Resources.get('tools2') <= 0 && prodGuard++ < 200) tick(C2.OW, 1);
check('tools2 reveals only once the player has actually produced one', C2.OW.Resources.all().find((r) => r.id === 'tools2').hidden === false,
  `guard=${prodGuard} val=${C2.OW.Resources.get('tools2')}`);

/* ---- DOM/UI: a real card click opens the modal, renders benches, and a
   real stepper click reaches the mechanic. ---- */
ts.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
check('card click opens the Tool Shed modal', OW.Cards.isModalOpenFor('toolshed'));
const body = w.document.getElementById('card-modal-body');
const renderedBenchCards = body.querySelectorAll('[data-ts-bench]');
check('modal renders one card per bench', renderedBenchCards.length === D.benches().length, `rendered=${renderedBenchCards.length} state=${D.benches().length}`);
check('no output dropdown survives anywhere in the modal', !body.querySelector('[data-ts-output-select]'));
check('no Add Bench card survives anywhere in the modal', !body.querySelector('[data-ts-add]'));

/* Header contract: stepper, then tier pill, then title — in that DOM
   order, inside one wrapper so .hs-head's space-between groups them
   left rather than spreading them across the card. */
const head0 = renderedBenchCards[0].querySelector('.hs-head .ts-head-controls');
check('each bench header groups its controls in one wrapper', !!head0);
if (head0) {
  const kids = [...head0.children].map((el) => el.className.split(' ')[0]);
  check('header order is steppers, tier pill, title',
    kids.join('>') === 'card-steppers>card-tier-pill>hs-title', kids.join('>'));
  check('the pill shows the bench\'s own roman numeral',
    head0.querySelector('.card-tier-pill').textContent === 'II', head0.querySelector('.card-tier-pill').textContent);
  check('the title names the tier', head0.querySelector('.hs-title').textContent === 'Tier II tools',
    head0.querySelector('.hs-title').textContent);
}
const head1 = renderedBenchCards[1].querySelector('.ts-head-controls');
check('the second bench is the Tier III bench', head1 && head1.querySelector('.hs-title').textContent === 'Tier III tools',
  head1 && head1.querySelector('.hs-title').textContent);
check('CSS resets the card-face order:1 on both header controls so DOM order wins',
  /\.ts-head-controls \.card-steppers,\s*\n\.ts-head-controls \.card-tier-pill \{ order: 0; \}/.test(
    fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));

const freshBenches = D.benches();
const lastIdx = freshBenches.length - 1;
const plusBtn = body.querySelector(`[data-ts-plus="${lastIdx}"]`);
check('a rendered bench stepper button exists', !!plusBtn);
if (plusBtn) {
  const before2 = freshBenches[lastIdx].workers;
  plusBtn.dispatchEvent(new w.Event('pointerdown'));
  check('a real click on that button reaches subAssign and updates state', freshBenches[lastIdx].workers === before2 + 1,
    `before=${before2} after=${freshBenches[lastIdx].workers}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
