/* Resource Cards (Wood/Stone Pit/Quarry) overhaul. Boots the real game
   headless and covers what changed this session: GAIN (the card's own
   wood/stone-per-work-unit balance number) now sits OUTSIDE the m/p/f
   formula instead of occupying the m slot, leaving m free at baseline
   1 for any future external buff source. No more upgrade ladder — name,
   cap, and modal are all fixed; only m/p/f are this card's own saved
   state. Covers Wood and Stone Pit; add Quarry cases once migrated. */
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
  w.requestAnimationFrame = () => 0;
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

const wood = OW.Mechanics.get('wood');

/* ---- Fixed identity: no ladder, name/cap/modal are all static ---- */
check('wood cardName is fixed at "Wood"', wood.cardName() === 'Wood');
check('wood has no cheatCompleteAll — ALL cheat cannot advance a ladder that no longer exists', !wood.cheatCompleteAll);
check('wood cap is the new static 2000 (was 200 under the old ladder)', OW.Resources.getCap('wood') === 2000);
check('wood modal renders empty (placeholder — content added in a later session)', wood.renderModalHTML() === '');
check('wood top bar is a permanent empty stub', wood.getUpgradeBarPct() === 0);

/* ---- Baseline rate: GAIN=1.84 lands correctly with m/p/f at (1,1,0) ---- */
OW.Workers.assign('wood');
tick(OW, 5);
const expectedBaseline = 5 * 1.84;
check('1 worker produces at GAIN (1.84/s) with m/p/f at baseline',
  Math.abs(OW.Resources.get('wood') - expectedBaseline) < 0.05,
  `got ${OW.Resources.get('wood')}, expected ~${expectedBaseline}`);

OW.Workers.assign('wood'); // 2nd worker — confirms m=1,p=1 stays exactly linear
const woodBefore2 = OW.Resources.get('wood');
tick(OW, 5);
const gained2 = OW.Resources.get('wood') - woodBefore2;
const expected2 = 5 * 2 * 1.84;
check('2 workers produce exactly double 1 worker\'s rate (p=1, linear)',
  Math.abs(gained2 - expected2) < 0.1, `got ${gained2.toFixed(2)}, expected ~${expected2}`);

/* ---- m is now a free dial: bumping it changes the rate uniformly,
   unlike the old shape where m WAS the gain and had no headroom. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const w = A.Mechanics.get('wood');
  w.bumpLocalM(); w.bumpLocalM(); // m: 1 -> 1.2
  A.Workers.assign('wood');
  tick(A, 5);
  const expected = 5 * 1.2 * 1.84;
  check('bumpLocalM (m=1.2) scales the whole rate, GAIN untouched',
    Math.abs(A.Resources.get('wood') - expected) < 0.05,
    `got ${A.Resources.get('wood')}, expected ~${expected}`);
}

/* ---- p in isolation: no effect on a lone worker, compounds with more ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const w = A.Mechanics.get('wood');
  for (let i = 0; i < 2; i++) w.bumpLocalP(); // p: 1 -> 1.2
  A.Workers.assign('wood');
  tick(A, 5);
  const expected = 5 * Math.pow(1, 1.2) * 1.84; // 1 worker: p has no effect yet
  check('bumpLocalP with exactly 1 worker has no effect (1^p === 1)',
    Math.abs(A.Resources.get('wood') - expected) < 0.05,
    `got ${A.Resources.get('wood')}, expected ~${expected}`);
}

/* ---- f in isolation: a free worker now adds at the real GAIN rate,
   not 1 flat unit — the bug this whole pass exists to fix. Needs at
   least 1 REAL worker assigned — 0 assigned short-circuits tick()
   before rate() is ever called (pre-existing, unchanged by this pass;
   f alone can't produce with an empty card any more than before). ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const w = A.Mechanics.get('wood');
  for (let i = 0; i < 20; i++) w.bumpLocalF(); // f: 0 -> 2.0 (2 free workers)
  A.Workers.assign('wood'); // 1 real worker, so tick() actually reaches rate()
  tick(A, 5);
  const expected = 5 * (1 + 2.0) * 1.84; // 1 real worker + f=2.0, times GAIN
  check('bumpLocalF (f=2) adds two full GAIN-rate workers\' worth on top of 1 real one',
    Math.abs(A.Resources.get('wood') - expected) < 0.05,
    `got ${A.Resources.get('wood')}, expected ~${expected}`);
}

/* ---- Combined m+p+f, matched against workerRate() directly rather
   than a hand-derived number, as a cross-check on the formula itself. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const w = A.Mechanics.get('wood');
  w.bumpLocalM(); w.bumpLocalM(); // m -> 1.2
  for (let i = 0; i < 2; i++) w.bumpLocalP(); // p -> 1.2
  for (let i = 0; i < 3; i++) w.bumpLocalF(); // f -> 0.3
  A.Workers.addWorkers(3);
  for (let i = 0; i < 4; i++) A.Workers.assign('wood');
  tick(A, 5);
  const expected = 5 * A.Upgrades.workerRate(4, 1.2, 1.2, 0.3) * 1.84;
  check('combined m/p/f + 4 workers matches workerRate() times GAIN',
    Math.abs(A.Resources.get('wood') - expected) < 0.1,
    `got ${A.Resources.get('wood')}, expected ~${expected}`);
}

/* ---- Save/load: m/p/f round-trip; GAIN and cap are never saved
   (constants), so they must come back identical without being stored. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const w = A.Mechanics.get('wood');
  w.bumpLocalM(); for (let i = 0; i < 2; i++) w.bumpLocalP(); w.bumpLocalF();
  A.Workers.assign('wood');
  tick(A, 3);
  const woodBefore = A.Resources.get('wood');
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  check('an m/p/f-buffed wood save keeps producing at the same rate after load',
    Math.abs(B.Resources.get('wood') - woodBefore) < 0.05,
    `before=${woodBefore} after=${B.Resources.get('wood')}`);
  check('cap is still 2000 after load (a constant, never saved)', B.Resources.getCap('wood') === 2000);
  check('cardName is still "Wood" after load (fixed, never saved)', B.Mechanics.get('wood').cardName() === 'Wood');
}

/* ---- rM cheat button reaches Wood (Stone/Quarry pick this up once
   each adopts bumpLocalM in a later step — see cheats.js's shared
   bumpResourceCards helper, which no-ops on a missing method today). ---- */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-rm').click();
  A.Workers.assign('wood');
  tick(A, 1);
  const expected = A.Upgrades.workerRate(1, 1.1, 1, 0) * 1.84;
  check('rM cheat button stacks +0.1 onto Wood\'s local m',
    Math.abs(A.Resources.get('wood') - expected) < 0.01,
    `got ${A.Resources.get('wood')}, expected ~${expected.toFixed(3)}`);
}

/* ============================================================
   STONE PIT — same formula shape as Wood, own GAIN (1.13) and cap
   (1000). Formula math itself is already proven above; these cases
   confirm Stone was wired correctly, not re-derive the whole formula.
   ============================================================ */
newStore();
{
  const a = boot(), A = a.OW;
  const stone = A.Mechanics.get('stone');
  A.Cards.reveal(stone); // Stone starts hidden — reveal for a realistic test

  check('stone cardName is fixed at "Stone Pit"', stone.cardName() === 'Stone Pit');
  check('stone has no cheatCompleteAll — ALL cheat cannot advance a ladder that no longer exists', !stone.cheatCompleteAll);
  check('stone cap is the new static 1000 (was 500 under the old ladder)', A.Resources.getCap('stone') === 1000);
  check('stone modal renders empty (placeholder — content added in a later session)', stone.renderModalHTML() === '');
  check('stone top bar is a permanent empty stub', stone.getUpgradeBarPct() === 0);

  A.Workers.assign('stone');
  tick(A, 5);
  const expected = 5 * 1.13;
  check('1 worker produces at GAIN (1.13/s) with m/p/f at baseline',
    Math.abs(A.Resources.get('stone') - expected) < 0.05,
    `got ${A.Resources.get('stone')}, expected ~${expected}`);
}

newStore();
{
  const a = boot(), A = a.OW;
  const stone = A.Mechanics.get('stone');
  stone.bumpLocalM(); stone.bumpLocalM(); // m: 1 -> 1.2
  A.Workers.assign('stone');
  tick(A, 5);
  const expected = 5 * 1.2 * 1.13;
  check('stone bumpLocalM (m=1.2) scales the whole rate, GAIN untouched',
    Math.abs(A.Resources.get('stone') - expected) < 0.05,
    `got ${A.Resources.get('stone')}, expected ~${expected}`);
}

/* ---- Save/load: m/p/f round-trip; GAIN and cap are never saved. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const stone = A.Mechanics.get('stone');
  stone.bumpLocalM(); for (let i = 0; i < 2; i++) stone.bumpLocalP(); stone.bumpLocalF();
  A.Workers.assign('stone');
  tick(A, 3);
  const stoneBefore = A.Resources.get('stone');
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  check('an m/p/f-buffed stone save keeps producing at the same rate after load',
    Math.abs(B.Resources.get('stone') - stoneBefore) < 0.05,
    `before=${stoneBefore} after=${B.Resources.get('stone')}`);
  check('stone cap is still 1000 after load (a constant, never saved)', B.Resources.getCap('stone') === 1000);
  check('stone cardName is still "Stone Pit" after load (fixed, never saved)', B.Mechanics.get('stone').cardName() === 'Stone Pit');
}

/* ---- rM cheat button now reaches BOTH Wood and Stone in one press
   (Quarry still no-ops until it's migrated in a later step). ---- */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-rm').click();
  A.Workers.assign('wood'); A.Workers.assign('stone');
  tick(A, 1);
  const expectedWood = A.Upgrades.workerRate(1, 1.1, 1, 0) * 1.84;
  const expectedStone = A.Upgrades.workerRate(1, 1.1, 1, 0) * 1.13;
  check('rM cheat button stacks +0.1 onto both Wood\'s and Stone\'s local m in one press',
    Math.abs(A.Resources.get('wood') - expectedWood) < 0.01 && Math.abs(A.Resources.get('stone') - expectedStone) < 0.01,
    `wood=${A.Resources.get('wood').toFixed(3)} (exp ${expectedWood.toFixed(3)}), stone=${A.Resources.get('stone').toFixed(3)} (exp ${expectedStone.toFixed(3)})`);
}

/* ============================================================
   QUARRY — same formula shape, own GAIN (15.82) and Mountains' worker
   pool/tool-consumption machinery (untouched by this pass). Formula
   math itself is already proven above; these cases confirm Quarry was
   wired correctly, not re-derive the whole formula.
   ============================================================ */
newStore();
{
  const a = boot(), A = a.OW;
  const quarry = A.Mechanics.get('quarry');
  A.Mountains.reveal();
  A.Cards.reveal(quarry);
  A.Mountains.addWorkers(10);
  const pool = A.Mountains.workerPool;
  A.Mountains.ensureResource('tools2', 'Tools II'); A.Resources.setRaw('mtn_tools2', 100000, 100000); // never tool-starved for these checks

  check('quarry cardName is fixed at "Quarry"', quarry.cardName() === 'Quarry');
  check('quarry has no cheatCompleteAll — ALL cheat cannot advance a ladder that no longer exists', !quarry.cheatCompleteAll);
  check('quarry cap is untouched at 5000 (per explicit instruction — no ladder ever drove it)', A.Resources.getCap('mtn_stone') === 5000);
  check('quarry modal renders empty (placeholder — content added in a later session)', quarry.renderModalHTML() === '');
  check('quarry top bar is a permanent empty stub', quarry.getUpgradeBarPct() === 0);
  check('quarry resourceId still correctly points at mtn_stone', quarry.resourceId === 'mtn_stone');
  check('quarry still uses the Mountains modal theme', quarry.modalTheme === 'theme-mountains');

  pool.assign('quarry');
  tick(A, 5);
  const expected = 5 * 15.82;
  check('1 worker produces at GAIN (15.82/s) with m/p/f at baseline',
    Math.abs(A.Resources.get('mtn_stone') - expected) < 0.05,
    `got ${A.Resources.get('mtn_stone')}, expected ~${expected}`);
}

newStore();
{
  const a = boot(), A = a.OW;
  const quarry = A.Mechanics.get('quarry');
  A.Mountains.reveal();
  A.Cards.reveal(quarry);
  A.Mountains.addWorkers(10);
  A.Mountains.ensureResource('tools2', 'Tools II'); A.Resources.setRaw('mtn_tools2', 100000, 100000);
  quarry.bumpLocalM(); quarry.bumpLocalM(); // m: 1 -> 1.2
  A.Mountains.workerPool.assign('quarry');
  tick(A, 5);
  const expected = 5 * 1.2 * 15.82;
  check('quarry bumpLocalM (m=1.2) scales the whole rate, GAIN untouched',
    Math.abs(A.Resources.get('mtn_stone') - expected) < 0.05,
    `got ${A.Resources.get('mtn_stone')}, expected ~${expected}`);
}

/* ---- Save/load: m/p/f AND the tool consumer's own accumulator both
   round-trip independently — confirms adding m didn't disturb tc. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const quarry = A.Mechanics.get('quarry');
  A.Mountains.reveal();
  A.Cards.reveal(quarry);
  A.Mountains.addWorkers(10);
  A.Mountains.ensureResource('tools2', 'Tools II'); A.Resources.setRaw('mtn_tools2', 100000, 100000);
  quarry.bumpLocalM(); for (let i = 0; i < 2; i++) quarry.bumpLocalP(); quarry.bumpLocalF();
  A.Mountains.workerPool.assign('quarry');
  tick(A, 3);
  const stoneBefore = A.Resources.get('mtn_stone');
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  check('an m/p/f-buffed quarry save keeps producing at the same rate after load',
    Math.abs(B.Resources.get('mtn_stone') - stoneBefore) < 0.05,
    `before=${stoneBefore} after=${B.Resources.get('mtn_stone')}`);
  check('quarry cap is still 5000 after load (never touched, never saved)', B.Resources.getCap('mtn_stone') === 5000);
  check('quarry cardName is still "Quarry" after load (fixed, never saved)', B.Mechanics.get('quarry').cardName() === 'Quarry');
}

/* ---- rM cheat button now reaches all three resource cards. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  const quarry = A.Mechanics.get('quarry');
  A.Mountains.reveal();
  A.Cards.reveal(quarry);
  A.Mountains.addWorkers(10);
  A.Mountains.ensureResource('tools2', 'Tools II'); A.Resources.setRaw('mtn_tools2', 100000, 100000);
  a.w.document.getElementById('cheat-rm').click();
  A.Workers.assign('wood'); A.Workers.assign('stone'); A.Mountains.workerPool.assign('quarry');
  tick(A, 1);
  const expectedWood = A.Upgrades.workerRate(1, 1.1, 1, 0) * 1.84;
  const expectedStone = A.Upgrades.workerRate(1, 1.1, 1, 0) * 1.13;
  const expectedQuarry = A.Upgrades.workerRate(1, 1.1, 1, 0) * 15.82;
  check('rM cheat button stacks +0.1 onto Wood, Stone, and Quarry\'s local m in one press',
    Math.abs(A.Resources.get('wood') - expectedWood) < 0.01 &&
    Math.abs(A.Resources.get('stone') - expectedStone) < 0.01 &&
    Math.abs(A.Resources.get('mtn_stone') - expectedQuarry) < 0.01,
    `wood=${A.Resources.get('wood').toFixed(3)}, stone=${A.Resources.get('stone').toFixed(3)}, quarry=${A.Resources.get('mtn_stone').toFixed(3)}`);
}

/* ---- A crate lives inside its parent's band, above the parent's
   rate line — never sandwiched between the parent's number and it. ---- */
newStore();
{
  const a = boot(), A = a.OW;
  A.Workers.assign('wood');
  tick(A, 1);                                            // gives Wood a visible +rate
  a.w.document.getElementById('cheat-crates').click();   // reveals woodcrate
  const woodEntry = A.Resources.all().find((r) => r.id === 'wood');
  const crateEntry = A.Resources.all().find((r) => r.id === 'woodcrate');
  const kids = Array.from(woodEntry.wrap.children);
  const crateIdx = kids.indexOf(crateEntry.wrap), rateIdx = kids.indexOf(woodEntry.rateEl);
  check('Wood crate sits inside Wood\'s band, under Wood\'s row, with Wood\'s rate below the crate',
    crateIdx === 1 && rateIdx === 2 && woodEntry.rateEl.textContent.startsWith('+'),
    `crateIdx=${crateIdx} rateIdx=${rateIdx} rate=${woodEntry.rateEl.textContent}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
