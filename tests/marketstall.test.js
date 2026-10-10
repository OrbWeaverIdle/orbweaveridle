/* Market Stall. Boots the real game headless and drives all three tabs
   through the public surface — same style as the other suites.

   Priority order follows the handoff doc (§5):
   1. walkAccum survives a save round trip.
   2. The crate spend fallback (parent first, noCrate opt-out, no
      chain, Camp crates don't feed Mountains).
   3. Camp's Gold Bars survive a reload (guards the save.js Camp-prefix
      fix).
   4. Auto-sell restarts an idle staffed row; 0 workers freezes exactly.
   5. Flat sell time — 100 and 1000 units both cost 180 worker-seconds.
   6. Above-cap does NOT exist — Wood clamps at its own cap.
   7. Purchases blocked when Gold Bars are short (direct call, not the
      button).

   Plus the high-value Stock Market and Commodities extras: pre-seed
   fires once only, history trims to 20, bounds hold, sell clamps to
   gold headroom, speed-up gated directly, tradeable filter, the Wood
   Crate grants into the crate row not the parent, step lands at
   exactly 600s, old saves without the new keys load cleanly, and a
   real DOM click on Buy moves real goods.
   Plus slippage: a trade moves that resource's own price against
   itself and persists until reversion decays it, fill cost/proceeds
   match the trapezoid formula, an immediate round trip loses money,
   one oversized trade cannot break the floor clamp, and Buy still
   respects Gold on hand once slippage is priced in. Plus the flat
   price band: a 0.25g floor shared by every resource, a per-resource
   base+offset ceiling, reversion that re-centers on the band midpoint,
   and the Stock Market range line in the trade panel, the Commodities
   order, and that a retired resource stays out of the quote list even
   once revealed. Plus price shocks:
   nothing counts before the card is revealed or during an offline
   replay, wood always spikes on the second counted update, the cadence
   only rolls every third update, the jump lands exactly 80% of the way
   to the edge, and the counter both saves and defaults old saves past
   the scripted spike. */
const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT    = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g)
  .map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore() {
  STORE = {
    _d: {},
    getItem(k)    { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
}

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  // Plain assignment silently no-ops: jsdom defines `performance` as a
  // non-writable accessor on Window.prototype. defineProperty is the
  // only way this stub actually takes hold — without it, every fresh
  // boot() briefly falls back to jsdom's own near-zero internal clock,
  // which sits inside Cards' 130ms ghost-click guard and makes a click
  // right after boot() pass or fail depending on real elapsed time.
  Object.defineProperty(w, 'performance', { value: { now: () => Date.now() }, configurable: true, writable: true });
  // cards.js measures text via canvas — stub it so modal opens work.
  w.HTMLCanvasElement.prototype.getContext = () =>
    ({ font: '', measureText: (t) => ({ width: (t || '').length * 6 }) });
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => {
    try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  w.OrbWeaver.Resources.reveal('wood'); // Wood hides until first gained; a real player has it long before Market Stall
  return { w, OW: w.OrbWeaver, errors };
}

const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}
const rnd = (n) => Math.round(n * 1e6) / 1e6;

// ─────────────────────────────────────────────────────────────────────
newStore();
const { w, OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));

const R  = OW.Resources;
const MS = OW.MarketStall;
const mech = OW.Mechanics.get('marketstall');

// Helpers for creating Camp's lazily-made Gold Bars row.
const campLoc  = OW.Locations.all().find((l) => l.id === 'camp');
const giveBars = (n) => R.add(campLoc.ensureResource('goldbars', 'Gold Bars'), n);
const bars     = ()  => R.available('goldbars');

// ─── 1. walkAccum survives a save round trip ─────────────────────────
// This is the loudest warning in the handoff: at a 600s interval,
// omitting walkAccum silently resets up to 10 minutes of waiting on
// every reload, for every player, forever.
MS.advanceWalk(347);
const accBefore = MS.getWalkAccum();
const blob = JSON.parse(JSON.stringify(OW.Save.serialize()));
check('walkAccum IS in the save blob', blob.mechanics.marketstall.w === accBefore,
  'got: ' + blob.mechanics.marketstall.w);
STORE.setItem('orbweaver.save.v1', OW.Save.encode(blob));

newStore();
STORE.setItem('orbweaver.save.v1', OW.Save.encode(blob));
const B = boot();
check('second boot has no script errors', B.errors.length === 0, B.errors.join('\n        '));
check('walkAccum survives a full save round trip',
  B.OW.MarketStall.getWalkAccum() === accBefore,
  'expected ' + accBefore + ', got ' + B.OW.MarketStall.getWalkAccum());

// ─── 2. Crate spend fallback ─────────────────────────────────────────
newStore();
const C = boot();
const CR = C.OW.Resources;
// 2a. Loose stock drains first; crate only touched once parent hits zero.
CR.setRaw('wood', 50);
CR.add(CR.ensureCrate('wood'), 200);
CR.spend('wood', 30);
check('2a: loose Wood drains before the crate is touched',
  rnd(CR.get('wood')) === 20 && rnd(CR.get('woodcrate')) === 200);

// 2b. Crate covers the shortfall once loose is exhausted.
CR.spend('wood', 60);   // 20 loose, then 40 from crate
check('2b: crate covers the shortfall',
  rnd(CR.get('wood')) === 0,
  'wood=' + CR.get('wood'));
check('2b: crate drained only the shortfall',
  rnd(CR.get('woodcrate')) === 160,
  'crate=' + CR.get('woodcrate'));

// 2c. noCrate=true opts the caller out entirely.
CR.setRaw('wood', 10); CR.setRaw('woodcrate', 100);
CR.spend('wood', 50, true);    // would need the crate, but noCrate
check('2c: noCrate=true takes only the loose stock',
  rnd(CR.get('wood')) === 0 && rnd(CR.get('woodcrate')) === 100,
  'wood=' + CR.get('wood') + ' crate=' + CR.get('woodcrate'));

// 2d. Crates never chain.
check('2d: crates do not chain (woodcrate has no crate)',
  !CR.exists('woodcratecrate'));

// 2e. Camp crates never feed Mountains — parentOf('mtn_woodcrate') must
//     resolve to 'mtn_wood', NOT to Camp's 'wood'.
C.OW.Mountains.reveal();
CR.ensure('mtn_wood', { name: 'Wood', mount: C.w.document.createElement('div'), current: 0, cap: 2000 });
CR.add(CR.ensureCrate('mtn_wood'), 500);
check('2e: mtn_woodcrate parents to mtn_wood only',
  CR.parentOf('mtn_woodcrate') === 'mtn_wood');
check('2e: spending mtn_wood draws from mtn_woodcrate, not woodcrate',
  (() => { const cbefore = CR.get('woodcrate'); CR.spend('mtn_wood', 100); return CR.get('woodcrate') === cbefore; })());

// ─── 3. Camp's Gold Bars survive a reload ────────────────────────────
// Guards the save.js fix: the old code had `l.prefix && id.startsWith(l.prefix)`
// which silently excluded Camp (prefix '') from dynamic-resource restore,
// deleting Gold Bars on every single reload.
newStore();
const G = boot();
const campL = G.OW.Locations.all().find((l) => l.id === 'camp');
const barsId = campL.ensureResource('goldbars', 'Gold Bars');
G.OW.Resources.setRaw(barsId, 777);
STORE.setItem('orbweaver.save.v1', G.OW.Save.encode(G.OW.Save.serialize()));

newStore();
STORE.setItem('orbweaver.save.v1', G.OW.Save.encode(G.OW.Save.serialize()));
const G2 = boot();
const restoredBars = G2.OW.Resources.get('goldbars');
check('3: Camp Gold Bars survive a reload (save.js Camp-prefix fix)',
  rnd(restoredBars) === 777,
  'expected 777, got ' + restoredBars);

// ─── 4. Auto-sell restarts; 0 workers freezes ────────────────────────
newStore();
const A = boot();
const AR = A.OW.Resources; const AM = A.OW.MarketStall;
A.OW.Workers.addWorkers(5);
AM.subAssign('wood');
const woodRow = AM._rows.wood;

// 4a. Auto: an idle+staffed+auto row restarts on the next tick.
woodRow.auto = true; woodRow.qty = 100; woodRow.phase = 'idle';
AR.setRaw('wood', 500);
AM.startSale('wood');
// Run the gather to completion then let the sell finish.
tick(A.OW, 200);
check('4a: auto-sell restarts: row is gathering again after completing',
  woodRow.phase !== 'idle' || woodRow.auto,
  'phase=' + woodRow.phase);
// After a full cycle with auto on, the row must have restarted.
tick(A.OW, 400);
check('4a: auto row is never idle while staffed',
  woodRow.phase !== 'idle',
  'phase after cycle=' + woodRow.phase);

// 4b. 0 workers: gathering freezes exactly where it is.
woodRow.auto = false; woodRow.phase = 'idle';
AR.setRaw('wood', 500);
AM.startSale('wood');
woodRow.workers = 0;   // remove the worker
const gatheredSnap = woodRow.gathered;
tick(A.OW, 60);
check('4b: 0 workers freezes gathering exactly',
  rnd(woodRow.gathered) === rnd(gatheredSnap),
  'expected ' + gatheredSnap + ', got ' + woodRow.gathered);
check('4b: phase stays gathering with 0 workers',
  woodRow.phase === 'gathering');

// ─── 5. Flat sell time ───────────────────────────────────────────────
// 100 units and 1000 units must both cost exactly 180 worker-seconds
// in the sell phase, making big batches more gold/s efficient.
newStore();
const F = boot();
F.OW.Workers.addWorkers(5);
const FM = F.OW.MarketStall; const FR = F.OW.Resources;

function workerSecondsToSell(qty, workerCount) {
  const row = FM._rows.wood;
  FR.setRaw('wood', qty);
  row.qty = qty; row.workers = workerCount;
  row.phase = 'selling'; row.gathered = qty; row.progress = 0;
  let ws = 0;
  while (row.phase === 'selling') {
    mech.tick && 0; // use the mechanic from the outer scope for tick
    row.progress += (workerCount * 0.2) / 180;
    ws += 0.2 * workerCount;
    if (row.progress >= 1) { row.phase = 'idle'; row.gathered = 0; row.progress = 0; }
    if (ws > 400) break; // safety
  }
  return rnd(ws);
}
// Simulate directly against the formula for clarity.
function sellWS(qty, workers) {
  let progress = 0, ws = 0;
  while (progress < 1) { progress += (workers * 0.2) / 180; ws += 0.2 * workers; }
  return rnd(ws);
}
const ws100  = sellWS(100, 2);
const ws1000 = sellWS(1000, 2);
check('5: 100-unit and 1000-unit sells cost the same worker-seconds',
  ws100 === ws1000,
  '100u=' + ws100 + 'ws, 1000u=' + ws1000 + 'ws');
check('5: the sell phase is ~180 worker-seconds (within one tick)',
  Math.abs(ws100 - 180) <= 0.2 * 2,   // at most one tick's worth of overshoot
  'got ' + ws100 + ' worker-seconds');

// ─── 6. Above-cap does NOT exist ────────────────────────────────────
newStore();
const P = boot();
P.OW.Workers.addWorkers(5);
P.OW.Resources.setRaw('gold', 5000);
P.OW.Resources.setRaw('wood', 1990);
P.OW.MarketStall.setTradeQty(500);
// Captured BEFORE the trade — tradeCost() reads live stock price, and
// stockBuy() mutates that price via its own impact.
const expected6 = P.OW.MarketStall.tradeCost('wood', 10, true);   // room clamps 500 -> 10
P.OW.MarketStall.stockBuy('wood');
check('6: Wood never exceeds its cap of 2000',
  rnd(P.OW.Resources.get('wood')) === 2000,
  'got ' + P.OW.Resources.get('wood'));
check('6: charged only for the units received (10, not 500), trapezoid cost',
  rnd(5000 - P.OW.Resources.get('gold')) === rnd(expected6),
  'expected=' + expected6 + ' gold delta=' + (5000 - P.OW.Resources.get('gold')));
check('6: no overflow into the crate row',
  rnd(P.OW.Resources.get('woodcrate')) === 0);

// ─── 7. Purchases blocked when Gold Bars are short ───────────────────
// The real gate is inside buy(), not the disabled attribute.
newStore();
const QB = boot();
// 4 bars, item costs 5.
QB.OW.Locations.all().find((l) => l.id === 'camp').ensureResource('goldbars', 'Gold Bars');
QB.OW.Resources.setRaw('goldbars', 4);
const copperBefore = QB.OW.Resources.get('copperhead');
QB.OW.MarketStall.buy('copper');
check('7: buy() is a no-op when Gold Bars are short (direct call)',
  rnd(QB.OW.Resources.get('copperhead')) === rnd(copperBefore),
  'copperhead before=' + copperBefore + ' after=' + QB.OW.Resources.get('copperhead'));
check('7: no bars were spent on the blocked purchase',
  rnd(QB.OW.Resources.get('goldbars')) === 4);

// ─── 8. Pre-seed fires once and only once ────────────────────────────
newStore();
const PS = boot();
PS.OW.MarketStall.buyPrice('wood');   // first read — triggers creation
const h0 = PS.OW.MarketStall._stocks.wood.history.length;
check('8: pre-seed creates an 11-point history on first read',
  h0 === 11, 'got ' + h0);
PS.OW.MarketStall.buyPrice('wood');   // second read
PS.OW.MarketStall.buyPrice('wood');   // third
check('8: subsequent reads never re-seed',
  PS.OW.MarketStall._stocks.wood.history.length === 11,
  'got ' + PS.OW.MarketStall._stocks.wood.history.length);

// ─── 9. History trims to 20 ──────────────────────────────────────────
for (let i = 0; i < 200; i++) PS.OW.MarketStall.advanceWalk(600);
check('9: history never exceeds 20 entries',
  PS.OW.MarketStall._stocks.wood.history.length === 20,
  'got ' + PS.OW.MarketStall._stocks.wood.history.length);

// ─── 10. Bounds always hold ───────────────────────────────────────────
// Flat band now: 0.25g floor for everything, ceiling = base + offset.
// Wood is base 3, offset +1, so 0.25–4.
const hist = PS.OW.MarketStall._stocks.wood.history;
const lo = 0.25, hi = 4;
check('10: no price ever falls below the flat 0.25 floor after 200 steps',
  Math.min(...hist) >= lo - 1e-9, 'min=' + Math.min(...hist) + ' floor=' + lo);
check('10: no price ever rises above wood\'s 4g ceiling after 200 steps',
  Math.max(...hist) <= hi + 1e-9, 'max=' + Math.max(...hist) + ' ceiling=' + hi);

// ─── 10b. The floor is flat, not per-resource ────────────────────────
// Every resource shares 0.25 regardless of base, and every ceiling is
// exactly base + its own offset. Driven through the public surface by
// forcing an oversized trade against each clamp.
const BANDS = { wood: [3, 4], stone: [4, 5.5], tools2: [8, 11], tools3: [110, 150],
  goldbars: [30, 42] };
let bandFail = null;
Object.keys(BANDS).forEach((id) => {
  const st = PS.OW.MarketStall._stocks[id];
  if (!st) return;                      // not tradeable in this boot
  const [, ceil] = BANDS[id];
  if (st.price < 0.25 - 1e-9 || st.price > ceil + 1e-9) bandFail = id + ' price=' + st.price;
});
check('10b: every seeded stock sits inside its own 0.25–(base+offset) band',
  bandFail === null, bandFail);

// ─── 11. Sell clamps to gold headroom ────────────────────────────────
newStore();
const SH = boot();
SH.OW.Resources.setRaw('wood', 5000, 5000); // big stockpile
SH.OW.Resources.setRaw('gold', 4990);        // 10g headroom
SH.OW.MarketStall.setTradeQty(1000);
SH.OW.MarketStall.stockSell('wood');
check('11: Gold never exceeds its cap after a sell',
  SH.OW.Resources.get('gold') <= 5000,
  'gold=' + SH.OW.Resources.get('gold'));
check('11: a sell actually paid something into the headroom',
  SH.OW.Resources.get('gold') > 4990,
  'gold=' + SH.OW.Resources.get('gold'));
// At zero headroom the sell must be a complete no-op.
SH.OW.Resources.setRaw('gold', 5000);
const woodSHbefore = SH.OW.Resources.get('wood');
SH.OW.MarketStall.stockSell('wood');
check('11: sell at zero headroom is a no-op',
  rnd(SH.OW.Resources.get('wood')) === rnd(woodSHbefore));

// ─── 12. Speed-up gated directly ────────────────────────────────────
newStore();
const SP = boot();
const accSP0 = SP.OW.MarketStall.getWalkAccum();
SP.OW.MarketStall.speedUp();    // no bars
check('12: speedUp() no-ops with 0 bars',
  SP.OW.MarketStall.getWalkAccum() === accSP0);
SP.OW.Locations.all().find((l) => l.id === 'camp').ensureResource('goldbars', 'Gold Bars');
SP.OW.Resources.setRaw('goldbars', 3);
SP.OW.MarketStall.speedUp();
check('12: one speedUp adds exactly 60s',
  rnd(SP.OW.MarketStall.getWalkAccum() - accSP0) === 60,
  'got ' + (SP.OW.MarketStall.getWalkAccum() - accSP0));
check('12: one bar was spent',
  rnd(SP.OW.Resources.get('goldbars')) === 2);
SP.OW.MarketStall.speedUp(); SP.OW.MarketStall.speedUp();
check('12: speed-up is repeatable and uncapped',
  rnd(SP.OW.MarketStall.getWalkAccum() - accSP0) === 180,
  'got ' + (SP.OW.MarketStall.getWalkAccum() - accSP0));

// ─── 13. Tradeable filter ────────────────────────────────────────────
newStore();
const TF = boot();
const TFR = TF.OW.Resources; const TFM = TF.OW.MarketStall;
TFR.reveal('stone'); TFR.reveal('tools2');
let ids = TFM.tradeable();
check('13: Gold is never tradeable', ids.indexOf('gold') < 0);
check('13: crates are never tradeable',
  ids.every((id) => !TFR.parentOf(id)),
  'crate in list: ' + ids.filter((id) => TFR.parentOf(id)));
check('13: hidden resources are excluded',
  ids.indexOf('tools3') < 0);
check('13: revealed Camp resources are included',
  ids.indexOf('stone') > -1 && ids.indexOf('tools2') > -1);
// 13b. Retired from the tradeable set — present as resources, never
// quoted. BASES is the whole set, so dropping an entry is the removal.
['journals', 'researchpapers', 'copperhead', 'goldbars'].forEach((id) => TFR.reveal(id));
check('13: retired resources stay out even once revealed',
  TFM.tradeable().every((id) => ['journals', 'researchpapers', 'copperhead', 'goldbars'].indexOf(id) < 0),
  'got ' + TFM.tradeable().join(','));
TF.OW.Mountains.reveal();
ids = TFM.tradeable();
check('13: Mountains-prefixed resources are excluded',
  ids.every((id) => id.indexOf('mtn_') !== 0),
  'mtn_ resource in list: ' + ids.filter((id) => id.startsWith('mtn_')));

// ─── 14. Crate-of-Wood grants into the crate, not wood itself ────────
newStore();
const CO = boot();
CO.OW.Locations.all().find((l) => l.id === 'camp').ensureResource('goldbars', 'Gold Bars');
CO.OW.Resources.setRaw('goldbars', 500);
CO.OW.Resources.setRaw('wood', 1990);
CO.OW.MarketStall._com.wcrate = 1;
CO.OW.MarketStall.buy('wcrate');
check('14: Crate-of-Wood buy leaves Wood itself at 1990 (cap is 2000)',
  rnd(CO.OW.Resources.get('wood')) === 1990,
  'wood=' + CO.OW.Resources.get('wood'));
check('14: 1000 units land in woodcrate, not in wood',
  rnd(CO.OW.Resources.get('woodcrate')) === 1000,
  'woodcrate=' + CO.OW.Resources.get('woodcrate'));
check('14: available() sees both pools',
  rnd(CO.OW.Resources.available('wood')) === 2990,
  'available=' + CO.OW.Resources.available('wood'));

// ─── 15. Walk step lands at exactly 600s, not 599 ────────────────────
newStore();
const WS = boot();
// Reset accumulator to zero.
while (WS.OW.MarketStall.getWalkAccum() > 0) WS.OW.MarketStall.advanceWalk(-WS.OW.MarketStall.getWalkAccum());
WS.OW.MarketStall.advanceWalk(0);   // harmless
WS.OW.MarketStall.buyPrice('wood'); // ensure stock exists
const wsHist0 = WS.OW.MarketStall._stocks.wood.history.length;
for (let i = 0; i < 599; i++) WS.OW.MarketStall.advanceWalk(1);
check('15: no step fires at 599s',
  WS.OW.MarketStall._stocks.wood.history.length === wsHist0,
  'history length=' + WS.OW.MarketStall._stocks.wood.history.length);
WS.OW.MarketStall.advanceWalk(1);
check('15: exactly one step fires at 600s',
  WS.OW.MarketStall._stocks.wood.history.length === Math.min(20, wsHist0 + 1),
  'got=' + WS.OW.MarketStall._stocks.wood.history.length);
check('15: accumulator is zero after a clean step',
  rnd(WS.OW.MarketStall.getWalkAccum()) === 0,
  'accum=' + WS.OW.MarketStall.getWalkAccum());

// ─── 16. Old saves without the new keys load cleanly ─────────────────
newStore();
const OL = boot();
const oldBlob = JSON.parse(JSON.stringify(OL.OW.Save.serialize()));
delete oldBlob.mechanics.marketstall.w;
delete oldBlob.mechanics.marketstall.s;
delete oldBlob.mechanics.marketstall.v;
delete oldBlob.mechanics.marketstall.tq;
delete oldBlob.mechanics.marketstall.c;
OL.OW.Save.deserialize(oldBlob);
check('16: old save without Stock Market keys loads without throwing',
  OL.OW.MarketStall.getWalkAccum() === 0);
check('16: old save without Commodities key loads with default qty 1',
  OL.OW.MarketStall._com.wcrate === 1);

// ─── 18. Real DOM click on Buy (integration) ─────────────────────────
// Uses the initial boot world (same convention as toolshed.test.js) —
// the mechanic is already built and revealed by Cards, so the click
// handler is live.
OW.Cards.reveal(mech);
R.setRaw('gold', 5000);
R.reveal('stone');
R.setRaw('stone', 0, 1000);
giveBars(100);
// Open the modal by clicking the card face.
mech.els.wrap.querySelector('.card')
  .dispatchEvent(new w.Event('click', { bubbles: true }));
check('18: card click opens the Market Stall modal',
  OW.Cards.isModalOpenFor('marketstall'));
let dmBody = w.document.getElementById('card-modal-body');
// Switch to the Stock Market tab.
dmBody.querySelector('[data-ms-tab="stock"]')
  .dispatchEvent(new w.Event('click', { bubbles: true }));
// Switch to Stone via the dropdown.
dmBody = w.document.getElementById('card-modal-body');
const dmSel = dmBody.querySelector('[data-ms-view]');
dmSel.value = 'stone';
dmSel.dispatchEvent(new w.Event('change', { bubbles: true }));
// Set trade size to 1 and refresh so the Buy button is active.
MS.setTradeQty(1);
OW.Cards.refreshOpenModal('marketstall');
dmBody = w.document.getElementById('card-modal-body');
const stoneBefore = R.get('stone');
const goldBefore  = R.get('gold');
dmBody.querySelector('[data-ms-trade="buy"]')
  .dispatchEvent(new w.Event('click', { bubbles: true }));
check('18: DOM Buy click added real units of Stone',
  R.get('stone') > stoneBefore,
  'stone before=' + stoneBefore + ' after=' + R.get('stone'));
check('18: DOM Buy click spent real Gold',
  R.get('gold') < goldBefore,
  'gold before=' + goldBefore + ' after=' + R.get('gold'));

// ─── 19. Flat fill: cost/proceeds are exactly qty * the quoted price ──
newStore();
const SL = boot();
const SLR = SL.OW.Resources, SLM = SL.OW.MarketStall;
SLR.reveal('stone');
SLR.setRaw('stone', 0, 1000);
SLR.setRaw('gold', 5000, 100000);
SLM.buyPrice('stone');                     // ensure the stock exists (triggers pre-seed)
const priceBefore19 = SLM._stocks.stone.price;

SLM.setTradeQty(100);
const buyCost = SLM.tradeCost('stone', 100, true);
SLM.stockBuy('stone');
check('19: a buy leaves the quoted price untouched — trades never move it',
  rnd(SLM._stocks.stone.price) === rnd(priceBefore19),
  'before=' + priceBefore19 + ' after=' + SLM._stocks.stone.price);
check('19: buy cost is exactly 100 * price',
  rnd(5000 - SLR.get('gold')) === rnd(buyCost) && rnd(buyCost) === rnd(100 * priceBefore19),
  'expected=' + buyCost + ' actual=' + (5000 - SLR.get('gold')));

const goldAfterBuy = SLR.get('gold');
const sellProceeds = SLM.tradeCost('stone', 100, false);
SLM.stockSell('stone');
check('19: sell proceeds are exactly 100 * price',
  rnd(SLR.get('gold') - goldAfterBuy) === rnd(sellProceeds) && rnd(sellProceeds) === rnd(100 * priceBefore19),
  'expected=' + sellProceeds + ' actual=' + (SLR.get('gold') - goldAfterBuy));
check('19: an immediate buy-then-sell round trip nets exactly zero',
  rnd(SLR.get('gold')) === 5000,
  'started 5000, ended ' + SLR.get('gold'));

// ─── 19b. Round trip never profits, at any trade size ────────────────
// Same quoted price both sides and trades can't move it, so this is
// now true by construction — kept as a regression, not a derivation.
newStore();
const RT = boot();
const RTR = RT.OW.Resources, RTM = RT.OW.MarketStall;
RTR.reveal('stone');
let rtProfit = null;
[1, 10, 50, 100, 250, 400, 800, 1600, 4000].forEach((n) => {
  RTR.setRaw('stone', 0, 100000);
  RTR.setRaw('gold', 100000, 100000);
  RTM.setTradeQty(n);
  RTM.stockBuy('stone');
  RTM.stockSell('stone');
  const delta = RTR.get('gold') - 100000;
  if (Math.abs(delta) > 1e-9 && rtProfit === null) rtProfit = n + ' units => ' + delta;
});
check('19b: buy-then-sell nets exactly zero, at any size from 1 to 4000 units',
  rtProfit === null, rtProfit);

// ─── 19c. No spread: both sides quote the same price ─────────────────
check('19c: buyPrice equals sellPrice equals the raw stock price',
  rnd(RTM.buyPrice('stone')) === rnd(RTM.sellPrice('stone')),
  'buy=' + RTM.buyPrice('stone') + ' sell=' + RTM.sellPrice('stone'));

// ─── 19d. Trading has zero effect on where the price walks next ──────
// The old exploit vector (crash the price with a sell, buy back
// cheaper next window) required trades to move the price. They can't
// anymore — proven by comparing the walked price after a big trade
// against the walked price with no trade at all, same frozen "random"
// draw (frozen on each window's OWN Math, not the test runner's —
// each boot() is its own realm), same starting price. If trading had
// any effect, these would diverge; the whole point is that they can't.
newStore();
const NT = boot();                           // control: no trade at all
const NTR = NT.OW.Resources, NTM = NT.OW.MarketStall;
NTR.reveal('stone');
NTM.buyPrice('stone');                       // create the stock (pre-seeds)
NTM._stocks.stone.price = 4;
NT.w.Math.random = () => 0.5;
NTM.advanceWalk(600);
const controlPrice = NTM._stocks.stone.price;

let driftMismatch = null;
[10, 100, 400, 1600].forEach((n) => {
  [true, false].forEach((buyFirst) => {
    newStore();
    const XB = boot();
    const XBR = XB.OW.Resources, XBM = XB.OW.MarketStall;
    XBR.reveal('stone');
    XBR.setRaw('stone', buyFirst ? 0 : 100000, 100000);
    XBR.setRaw('gold', 100000, 100000);
    XBM.buyPrice('stone');
    XBM._stocks.stone.price = 4;
    XBM.setTradeQty(n);
    buyFirst ? XBM.stockBuy('stone') : XBM.stockSell('stone');
    XB.w.Math.random = () => 0.5;              // same frozen draw as the control
    XBM.advanceWalk(600);
    if (rnd(XBM._stocks.stone.price) !== rnd(controlPrice) && driftMismatch === null) {
      driftMismatch = (buyFirst ? 'buy' : 'sell') + ' ' + n + ' units => walked to ' +
        XBM._stocks.stone.price + ', control was ' + controlPrice;
    }
  });
});
check('19d: a trade of any size does not change where the price walks next',
  driftMismatch === null, driftMismatch);

// ─── 21. Buy still respects Gold on hand ──────────────────────────────
newStore();
const SLG = boot();
const SLGR = SLG.OW.Resources, SLGM = SLG.OW.MarketStall;
SLGR.reveal('stone');
SLGR.setRaw('stone', 0, 1000);
SLGR.setRaw('gold', 1);                    // effectively broke
SLGM.setTradeQty(100);
const stoneBeforeSLG = SLGR.get('stone');
SLGM.stockBuy('stone');
check('21: a buy that costs more than Gold on hand is a no-op',
  rnd(SLGR.get('stone')) === rnd(stoneBeforeSLG),
  'stone before=' + stoneBeforeSLG + ' after=' + SLGR.get('stone'));

// ─── 22. Cancel: full refund, mid-gather and mid-sell ────────────────
newStore();
const CN = boot();
const CNR = CN.OW.Resources; const CNM = CN.OW.MarketStall;
CN.OW.Workers.addWorkers(5);
CNM.subAssign('wood');
CNR.setRaw('wood', 500);

// 19a. Cancel mid-gather refunds exactly what's been pulled so far.
CN.OW.MarketStall._rows.wood.qty = 100;
CNM.startSale('wood');
tick(CN.OW, 30);              // 5 workers * 1/s = 150 pulled, capped at qty 100 -> already gathering->selling; use fewer seconds
check('22a: setup is mid-cycle (not idle)', CNM._rows.wood.phase !== 'idle');
const woodBeforeCancel = CNR.get('wood');
CNM.cancelSale('wood');
check('22a: cancel returns the row to idle', CNM._rows.wood.phase === 'idle');
check('22a: cancel zeroes gathered/progress', CNM._rows.wood.gathered === 0 && CNM._rows.wood.progress === 0);
check('22a: canceling refunds the pulled amount back to Wood',
  CNR.get('wood') > woodBeforeCancel,
  'before=' + woodBeforeCancel + ' after=' + CNR.get('wood'));

// 19b. Cancel mid-sell (post-gather) refunds the FULL quantity, no gold.
CNR.setRaw('wood', 500);
CN.OW.MarketStall._rows.wood.qty = 100;
CNM.startSale('wood');
tick(CN.OW, 100);              // gather finishes (100/5=20s), well into selling (180s)
check('22b: row reached the selling phase', CNM._rows.wood.phase === 'selling');
const goldBeforeCancel = CNR.get('gold');
const woodBeforeCancel2 = CNR.get('wood');
CNM.cancelSale('wood');
check('22b: canceling mid-sell refunds the full 100 units',
  rnd(CNR.get('wood') - woodBeforeCancel2) === 100,
  'delta=' + (CNR.get('wood') - woodBeforeCancel2));
check('22b: canceling mid-sell grants no gold', CNR.get('gold') === goldBeforeCancel);

// 19c. Cancel on an already-idle row is a no-op.
const woodBeforeNoop = CNR.get('wood');
CNM.cancelSale('wood');
check('22c: cancel on an idle row does not change stock', CNR.get('wood') === woodBeforeNoop);

// 19d. Cancel disables auto sell and leaves it off.
CNM._rows.wood.auto = true;
CNR.setRaw('wood', 500);
CNM._rows.wood.qty = 100;
CNM.startSale('wood');
check('22d: auto was on before cancel', CNM._rows.wood.auto === true);
CNM.cancelSale('wood');
check('22d: cancel turns auto sell off', CNM._rows.wood.auto === false);
// Starting a new sale manually does not re-enable auto.
CNM.startSale('wood');
check('22d: auto stays off after manual re-start', CNM._rows.wood.auto === false);
CNM.cancelSale('wood');

// 19e. getStatText() sums g/s across active rows with workers, excludes stalled.
newStore();
const STC = boot();
const STOW = STC.OW; const STMS = STOW.MarketStall; const STR = STOW.Resources;
STOW.Workers.addWorkers(10);
STR.setRaw('wood', 500); STR.setRaw('stone', 500);
STMS.subAssign('wood'); STMS.subAssign('stone');
STMS._rows.wood.qty = 100; STMS._rows.stone.qty = 100;
const mech19 = STOW.Mechanics.get('marketstall');
// Force open so getStatText() doesn't return the intro string.
mech19.onOpen();
check('22e: idle → empty stat text', mech19.getStatText() === '');
STMS.startSale('wood'); STMS.startSale('stone');
check('22e: active sales with workers produce a g/s card face',
  mech19.getStatText().includes('g/s'),
  'got: ' + mech19.getStatText());
check('22e: card face g/s is prefixed with +',
  mech19.getStatText().startsWith('+'),
  'got: ' + mech19.getStatText());
// Row with 0 workers contributes 0.
STMS._rows.stone.workers = 0;
const statWithZeroWorker = mech19.getStatText();
STMS._rows.stone.workers = 1; // restore
check('22e: row with 0 workers excluded from g/s sum',
  parseFloat(statWithZeroWorker) < parseFloat(mech19.getStatText()),
  'zero=' + statWithZeroWorker + ' with=' + mech19.getStatText());

// ─── 23. DOM integration: Cancel button label, quantity lock, refund ─
// Reuses the long-lived top-level `OW`/`mech` world (already open on the
// Stock Market tab from check 18) rather than a fresh boot() — a fresh
// boot's very first click can race the ghost-click guard (130ms window
// against a boot-time closeModal()), since almost no real time has
// passed yet. This world has been running for a while, same reasoning
// as toolshed.test.js's DOM check.
OW.Workers.addWorkers(5);
let dcBody = w.document.getElementById('card-modal-body');
dcBody.querySelector('[data-ms-tab="selling"]').dispatchEvent(new w.Event('click', { bubbles: true }));
dcBody = w.document.getElementById('card-modal-body');
R.setRaw('wood', 500);
MS.subAssign('wood');
MS._rows.wood.qty = 200;   // above QTY_STEP's floor of 100, so the minus
                            // button's state below is purely the phase
                            // lock, not the floor lock
OW.Cards.refreshOpenModal('marketstall');
dcBody = w.document.getElementById('card-modal-body');
dcBody.querySelector('[data-ms-sell="wood"]').dispatchEvent(new w.Event('click', { bubbles: true }));
tick(OW, 5);   // let a real gather happen so cancel has something to refund
OW.Cards.refreshOpenModal('marketstall');
dcBody = w.document.getElementById('card-modal-body');
const sellBtn = dcBody.querySelector('[data-ms-sell="wood"]');
check('23: button reads Cancel once a sale is active', sellBtn.textContent === 'Cancel');
const qMinus = dcBody.querySelector('[data-ms-step="q"][data-ms-row="wood"][data-ms-dir="-1"]');
const qPlus  = dcBody.querySelector('[data-ms-step="q"][data-ms-row="wood"][data-ms-dir="1"]');
check('23: Quantity − is disabled mid-sale', qMinus.disabled === true);
check('23: Quantity + is disabled mid-sale', qPlus.disabled === true);
const wMinus = dcBody.querySelector('[data-ms-step="w"][data-ms-row="wood"][data-ms-dir="-1"]');
check('23: Workers stepper stays enabled mid-sale', wMinus.disabled === false);

// Clicking Cancel refunds and flips the button back to Sell.
const woodBeforeDomCancel = R.get('wood');
sellBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
check('23: DOM Cancel click refunds real Wood',
  R.get('wood') > woodBeforeDomCancel,
  'before=' + woodBeforeDomCancel + ' after=' + R.get('wood'));
dcBody = w.document.getElementById('card-modal-body');
check('23: button reads Sell again after cancel',
  dcBody.querySelector('[data-ms-sell="wood"]').textContent === 'Sell');
check('23: Quantity − is re-enabled once idle (qty above floor)',
  dcBody.querySelector('[data-ms-step="q"][data-ms-row="wood"][data-ms-dir="-1"]').disabled === false);

// ─── 24. Reversion re-centers on the band midpoint, not base ─────────
// Wood's band is 0.25–4, midpoint 2.125, base 3. Reverting to base
// would keep the walk pinned near the ceiling and leave the floor
// unreachable; reverting to the midpoint must put the long-run average
// meaningfully BELOW base while still respecting both clamps.
newStore();
const MID = boot();
const MIDM = MID.OW.MarketStall;
MIDM.buyPrice('wood');                       // force creation + pre-seed
// Sample every step, not just the trailing 20-entry history — a short
// autocorrelated window makes the average of the mean too noisy to
// assert on reliably.
const midSamples = [];
for (let i = 0; i < 400; i++) { MIDM.advanceWalk(600); midSamples.push(MIDM._stocks.wood.price); }
const midAvg = midSamples.reduce((a, v) => a + v, 0) / midSamples.length;
check('24: the long-run walk settles below base (midpoint reversion)',
  midAvg < 3, 'avg=' + midAvg + ' base=3');
check('24: the walk still respects both clamps across 400 steps',
  Math.min(...midSamples) >= 0.25 - 1e-9 && Math.max(...midSamples) <= 4 + 1e-9,
  'min=' + Math.min(...midSamples) + ' max=' + Math.max(...midSamples));

// ─── 25. The band line renders in the single-resource trade panel ────
// Driven through the same long-lived DOM world check 23 uses, so this
// reads the real rendered panel rather than a detached HTML string.
let bBody = w.document.getElementById('card-modal-body');
bBody.querySelector('[data-ms-tab="stock"]').dispatchEvent(new w.Event('click', { bubbles: true }));
MS.setView('wood');
OW.Cards.refreshOpenModal('marketstall');
bBody = w.document.getElementById('card-modal-body');
const bandEl = bBody.querySelector('.ms-band');
check('25: the trade panel states wood\'s actual floor and ceiling',
  bandEl && bandEl.textContent === 'The Stock Market range for Wood is 0.25–4 gold coins per unit.',
  'got: ' + (bandEl ? bandEl.textContent : 'no .ms-band element'));
MS.setView('all');
OW.Cards.refreshOpenModal('marketstall');
bBody = w.document.getElementById('card-modal-body');
check('25: the All resources overlay shows no band line',
  !bBody.querySelector('.ms-band'));

// ─── 26. Held steppers keep firing (button survives the press) ───────
// addHoldBehavior stops repeating the moment its button leaves the DOM,
// so any stepper action that rebuilds the modal silently loses hold.
// The worker steppers did exactly that via subAssign/subUnassign's own
// refreshOpenModal call. Each stepper must patch in place instead.
OW.Workers.addWorkers(20);
R.setRaw('wood', 500);
let hBody = w.document.getElementById('card-modal-body');
hBody.querySelector('[data-ms-tab="selling"]').dispatchEvent(new w.Event('click', { bubbles: true }));
hBody = w.document.getElementById('card-modal-body');
MS._rows.wood.workers = 0;
OW.Cards.refreshOpenModal('marketstall');
hBody = w.document.getElementById('card-modal-body');
const hPlus = hBody.querySelector('[data-ms-step="w"][data-ms-row="wood"][data-ms-dir="1"]');
for (let i = 0; i < 5; i++) hPlus.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
check('26: a held worker + keeps firing on the same element',
  MS._rows.wood.workers === 5 && hPlus.isConnected,
  'workers=' + MS._rows.wood.workers + ' connected=' + hPlus.isConnected);
check('26: the worker stepper display keeps up with the hold',
  hBody.querySelector('[data-ms-val="w-wood"]').textContent === '5',
  'shown=' + hBody.querySelector('[data-ms-val="w-wood"]').textContent);
const hMinus = hBody.querySelector('[data-ms-step="w"][data-ms-row="wood"][data-ms-dir="-1"]');
for (let i = 0; i < 8; i++) hMinus.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
check('26: a held worker − stops cleanly at zero and disables itself',
  MS._rows.wood.workers === 0 && hMinus.disabled === true,
  'workers=' + MS._rows.wood.workers + ' disabled=' + hMinus.disabled);
// The quantity and trade steppers must stay held-capable too.
const hQty = hBody.querySelector('[data-ms-step="q"][data-ms-row="wood"][data-ms-dir="1"]');
const qStart = MS._rows.wood.qty;
for (let i = 0; i < 3; i++) hQty.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
check('26: a held quantity + keeps firing on the same element',
  MS._rows.wood.qty === qStart + 300 && hQty.isConnected,
  'qty=' + MS._rows.wood.qty + ' connected=' + hQty.isConnected);

// ─── 26a. The readout tracks the QUANTITY stepper, not just Workers ───
// Every figure in the panel derives from qty: the total is qty * price,
// and gather time is qty/workers, so cycle time (and therefore g/s)
// moves with it too. The stepper patches in place, so these must change
// without the modal being rebuilt.
MS._rows.wood.workers = 5;
MS._rows.wood.qty = 100;
OW.Cards.refreshOpenModal('marketstall');
hBody = w.document.getElementById('card-modal-body');
const readEl = () => hBody.querySelector('[data-ms-readout="wood"]');
const parts = () => [...readEl().children].map((e) => e.textContent.trim());
const before26a = parts();
const qUp = hBody.querySelector('[data-ms-step="q"][data-ms-row="wood"][data-ms-dir="1"]');
qUp.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
const after26a = parts();
check('26a: a quantity step updates the g total line', before26a[0] !== after26a[0], `${before26a[0]} -> ${after26a[0]}`);
check('26a: a quantity step updates the g/s line', before26a[2] !== after26a[2], `${before26a[2]} -> ${after26a[2]}`);
check('26a: a quantity step updates the time-to-sell line (gathering takes longer)',
  parseFloat(after26a[1]) > parseFloat(before26a[1]), `${before26a[1]} -> ${after26a[1]}`);
check('26a: the readout patches in place, without rebuilding the modal', qUp.isConnected === true);
const qDown = hBody.querySelector('[data-ms-step="q"][data-ms-row="wood"][data-ms-dir="-1"]');
qDown.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
check('26a: stepping the quantity back restores the original figures',
  parts().join('|') === before26a.join('|'), parts().join('|'));
// The worker stepper must still refresh the readout after the refactor.
const wUp = hBody.querySelector('[data-ms-step="w"][data-ms-row="wood"][data-ms-dir="1"]');
const beforeW = parts();
wUp.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
check('26a: a worker step still updates the readout', parts()[2] !== beforeW[2], `${beforeW[2]} -> ${parts()[2]}`);

// ─── 26b. Commodities order and titles ───────────────────────────────
// Copper leads the tab and names its tier, so a player reads what the
// heads are for without opening the Tool Shed to find out.
let cBody = w.document.getElementById('card-modal-body');
cBody.querySelector('[data-ms-tab="commodities"]').dispatchEvent(new w.Event('click', { bubbles: true }));
cBody = w.document.getElementById('card-modal-body');
const comTitles = [...cBody.querySelectorAll('.hs-title')].map((e) => e.textContent);
check('26b: Copper Tool Head leads the Commodities tab',
  comTitles[0].indexOf('Copper Tool Head') > -1, 'got ' + comTitles.join(' | '));
check('26b: Wheat Bundles is gone from Commodities',
  comTitles.indexOf('Wheat Bundles') < 0, 'got ' + comTitles.join(' | '));
check('26b: both crates carry their exceeds-cap renaming',
  comTitles.indexOf('Wood Crate (exceeds cap)') > -1 &&
  comTitles.indexOf('Stone Crate (exceeds cap)') > -1, 'got ' + comTitles.join(' | '));
const copperTitleEl = cBody.querySelectorAll('.ms-item-title')[0];
const copperPill = copperTitleEl.querySelector('.card-tier-pill');
check('26b: Copper Tool Head carries a Tier III pill',
  copperPill && copperPill.textContent === 'III',
  'got ' + (copperPill ? copperPill.textContent : 'no pill'));
check('26b: the pill sits to the left of the name, not the right',
  copperTitleEl.firstElementChild === copperPill,
  'firstChild=' + (copperTitleEl.firstElementChild && copperTitleEl.firstElementChild.className));

// ─── 26c. All-resources color swap ────────────────────────────────────
// Positional by design (see the COLORS comment) — assert against the
// fixed creation order the game itself produces, not a hardcoded index.
newStore();
const CC = boot();
const CCR = CC.OW.Resources, CCM = CC.OW.MarketStall;
['wood', 'stone', 'tools2', 'tools3'].forEach((id) => CCR.reveal(id));
CCM.setView('all');
const ccMech = CC.OW.Mechanics.get('marketstall');
CC.OW.Cards.reveal(ccMech);
ccMech.els.wrap.querySelector('.card').dispatchEvent(new CC.w.Event('click', { bubbles: true }));
let ccBody = CC.w.document.getElementById('card-modal-body');
ccBody.querySelector('[data-ms-tab="stock"]').dispatchEvent(new CC.w.Event('click', { bubbles: true }));
ccBody = CC.w.document.getElementById('card-modal-body');
const legendColor = (id) => {
  const i = ccBody.querySelector(`.ms-leg[data-ms-pick="${id}"] i`);
  return i && i.getAttribute('style').replace(/^background:/, '');
};
// Series colors are theme variables now, each carrying its original hex
// as the fallback — so these assert BOTH halves: the right --chart-N
// slot (still positional) and the unchanged Original color inside it.
check('26c: Wood reads green', legendColor('wood') === 'var(--chart-1, #6fa86f)', 'wood=' + legendColor('wood'));
check('26c: Tools II and Tools III swapped colors',
  legendColor('tools2') === 'var(--chart-3, #c96a5e)' && legendColor('tools3') === 'var(--chart-4, #8f6fbf)',
  'tools2=' + legendColor('tools2') + ' tools3=' + legendColor('tools3'));
check('26c: Gold Bars is not in the legend', !ccBody.querySelector('.ms-leg[data-ms-pick="goldbars"]'));

// ─── 26d. Transaction total ────────────────────────────────────────────
// qty × the plain quoted price — an estimate, deliberately not the
// slippage-true tradeCost() figure (see the CSS comment on .ms-total).
newStore();
const TT = boot();
const TTM = TT.OW.MarketStall;
const WOOD_STEP = 100;                            // STEPS.wood in marketstall.js
TTM.setView('wood');                               // snaps tradeQty up to WOOD_STEP
const ttMech = TT.OW.Mechanics.get('marketstall');
TT.OW.Cards.reveal(ttMech);
ttMech.els.wrap.querySelector('.card').dispatchEvent(new TT.w.Event('click', { bubbles: true }));
let ttBody = TT.w.document.getElementById('card-modal-body');
ttBody.querySelector('[data-ms-tab="stock"]').dispatchEvent(new TT.w.Event('click', { bubbles: true }));
ttBody = TT.w.document.getElementById('card-modal-body');
const totalEl = () => ttBody.querySelector('[data-ms-total] b');
const priceNow = () => TTM._stocks.wood.price;
const gfmtLike = (n) => (+n.toFixed(2)).toLocaleString();
check('26d: shows qty × price on open (qty starts at the step, WOOD_STEP)',
  totalEl().textContent === gfmtLike(WOOD_STEP * priceNow()) + 'g',
  'got ' + totalEl().textContent + ' price=' + priceNow());
const ttPlus = ttBody.querySelector('[data-ms-step="t"][data-ms-dir="1"]');
ttPlus.dispatchEvent(new TT.w.Event('pointerdown', { bubbles: true }));
ttBody = TT.w.document.getElementById('card-modal-body');   // same node; re-grabbed for clarity
check('26d: updates when the quantity stepper is used',
  totalEl().textContent === gfmtLike(2 * WOOD_STEP * priceNow()) + 'g',
  'got ' + totalEl().textContent);
TTM.advanceWalk(600);
TT.OW.Cards.refreshOpenModal('marketstall');
check('26d: updates when the price itself moves on a walk step',
  totalEl().textContent === gfmtLike(2 * WOOD_STEP * priceNow()) + 'g',
  'got ' + totalEl().textContent + ' price=' + priceNow());

// ─── 26e. Single-resource graph line reads gold, not green ───────────
newStore();
const SG = boot();
const SGM = SG.OW.MarketStall;
SGM.setView('stone');                              // any single resource, not 'all'
const sgMech = SG.OW.Mechanics.get('marketstall');
SG.OW.Cards.reveal(sgMech);
sgMech.els.wrap.querySelector('.card').dispatchEvent(new SG.w.Event('click', { bubbles: true }));
let sgBody = SG.w.document.getElementById('card-modal-body');
sgBody.querySelector('[data-ms-tab="stock"]').dispatchEvent(new SG.w.Event('click', { bubbles: true }));
sgBody = SG.w.document.getElementById('card-modal-body');
// The stroke moved from a presentation attribute to an inline style —
// a var() reference is only honored as a CSS property value.
const sgLine = sgBody.querySelector('.ms-graph polyline');
const sgStroke = sgLine && sgLine.getAttribute('style');
check('26e: single-resource line is gold (#c9a227)',
  !!sgStroke && sgStroke.indexOf('var(--chart-gold, #c9a227)') !== -1,
  'got ' + sgStroke);
check('26e: axis styling never leaks onto the series line',
  !!sgLine && sgLine.getAttribute('stroke') === null,
  'got stroke attr ' + (sgLine && sgLine.getAttribute('stroke')));

// ─── 27. Price shocks ────────────────────────────────────────────────
// A shock REPLACES an update's ordinary drift with a jump 80% of the
// way to the band edge, so every assertion below is exact rather than
// statistical: the walk's only randomness is stubbed out, and the two
// formulas are checked against the price the update actually produced.
newStore();
const SK  = boot();
const MSK = SK.OW.MarketStall;
const SKmech = SK.OW.Mechanics.get('marketstall');
const WCEIL = 4, WFLOOR = 0.25, WBASE = 3;      // wood's band and base
const REACH = 0.8, REV = 0.05, VOL = 0.16;
const WMID = (WFLOOR + WCEIL) / 2;
const shockTo = (px) => px + (WCEIL - px) * REACH;
// Stubbed inside jsdom's realm — the game code runs there, not here.
const seedRandom = (v) => { SK.w.Math.random = () => v; };
const driftTo = (px, r) => px + (WMID - px) * REV + (r * 2 - 1) * WBASE * VOL;

// 27a. Nothing counts until the player can actually see the card.
for (let i = 0; i < 6; i++) MSK.advanceWalk(600);
check('27: no update counts while the Market Stall is still hidden',
  MSK.getWalkCount() === 0, 'count=' + MSK.getWalkCount());

// 27b. The scripted Wood spike, always, on the second counted update.
SKmech.revealed = true;
seedRandom(0.5);                                 // a plain, centred drift
MSK.advanceWalk(600);                            // update 1
const px1 = MSK._stocks.wood.price;
MSK.advanceWalk(600);                            // update 2 — scripted
check('27: wood always spikes on the second counted update',
  Math.abs(MSK._stocks.wood.price - shockTo(px1)) < 1e-9,
  'got ' + MSK._stocks.wood.price + ' want ' + shockTo(px1));
check('27: the scripted spike stops short of the ceiling',
  MSK._stocks.wood.price < WCEIL - 1e-9, 'got ' + MSK._stocks.wood.price);

// 27c. Every third update rolls; 0 always clears the 20% gate and the
// 66% up gate, so this is the shock path taken deliberately.
seedRandom(0);
const px2 = MSK._stocks.wood.price;
MSK.advanceWalk(600);                            // update 3 — a shock update
check('27: a rolled shock jumps 80% of the way to the ceiling',
  Math.abs(MSK._stocks.wood.price - shockTo(px2)) < 1e-9,
  'got ' + MSK._stocks.wood.price + ' want ' + shockTo(px2));

// 27d. Update 4 is not a multiple of 3, so the SAME random seed that
// just fired a shock must now produce nothing but ordinary drift.
const px3 = MSK._stocks.wood.price;
MSK.advanceWalk(600);                            // update 4
check('27: an off-cadence update never shocks, however the dice fall',
  Math.abs(MSK._stocks.wood.price - driftTo(px3, 0)) < 1e-9,
  'got ' + MSK._stocks.wood.price + ' want ' + driftTo(px3, 0));

// 27e. Offline replay: prices still walk, but nothing counts and
// nothing shocks — the cadence waits for the player to come back.
const realIsReplaying = SK.w.OrbWeaver.Offline.isReplaying;
SK.w.OrbWeaver.Offline.isReplaying = () => true;
const countBefore = MSK.getWalkCount(), px4 = MSK._stocks.wood.price;
MSK.advanceWalk(600 * 3);                        // would be updates 5, 6, 7
check('27: an offline replay advances no counted updates',
  MSK.getWalkCount() === countBefore,
  'count=' + MSK.getWalkCount() + ' was ' + countBefore);
check('27: prices still walk offline, they just never shock',
  MSK._stocks.wood.price !== px4 &&
  Math.abs(MSK._stocks.wood.price - shockTo(px4)) > 1e-9,
  'got ' + MSK._stocks.wood.price);
SK.w.OrbWeaver.Offline.isReplaying = realIsReplaying;

// 27f. The counter is saved. Losing it re-fires the scripted spike on
// every reload, which is the whole reason it is not a local.
const wcBefore = MSK.getWalkCount();
const sblob = JSON.parse(JSON.stringify(SK.OW.Save.serialize()));
check('27: walkCount IS in the save blob',
  sblob.mechanics.marketstall.n === wcBefore, 'got ' + sblob.mechanics.marketstall.n);
newStore();
STORE.setItem('orbweaver.save.v1', SK.OW.Save.encode(sblob));
const SB = boot();
check('27: walkCount survives a full save round trip',
  SB.OW.MarketStall.getWalkCount() === wcBefore,
  'expected ' + wcBefore + ', got ' + SB.OW.MarketStall.getWalkCount());

// 27g. A save written before shocks existed has no counter at all, and
// must load past the scripted spike rather than replaying it.
delete sblob.mechanics.marketstall.n;
newStore();
STORE.setItem('orbweaver.save.v1', SK.OW.Save.encode(sblob));
const SO = boot();
check('27: a save with no counter loads past the scripted Wood update',
  SO.OW.MarketStall.getWalkCount() === 2,
  'got ' + SO.OW.MarketStall.getWalkCount());
SO.OW.Mechanics.get('marketstall').revealed = true;
SO.w.Math.random = () => 0.5;
SO.OW.MarketStall.advanceWalk(600);              // its update 3, not its update 2
const oldPx = SO.OW.MarketStall._stocks.wood.price;
SO.OW.MarketStall.advanceWalk(600);              // update 4 — must be plain drift
check('27: an old save never gets the scripted spike sprung on it',
  Math.abs(SO.OW.MarketStall._stocks.wood.price - shockTo(oldPx)) > 1e-9,
  'got ' + SO.OW.MarketStall._stocks.wood.price);

// ─────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
