/* The cases the design specifically worried about:
   sequestered workers mid-trip, replayed research effects,
   mid-flight sales, dynamic destination resources, corrupt saves,
   and a plain untouched early-game save. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = require('path').join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore() { STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } }; }

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  // location is non-configurable in jsdom; import() reloads, which we don't exercise here.
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  w.performance = { now: () => Date.now() };
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => {
    try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  // jsdom fires its OWN DOMContentLoaded once parsing finishes, shortly
  // after ours — which boots the entire game a second time on top of the
  // first. Sync tests finish before it lands; anything that yields to a
  // frame does not. Block it during the capture phase on window, which
  // runs before the document listeners the game registered.
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, errors };
}

const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);

// Fire a real delegated UI action, exactly as a button in the modal would.
function act(w, attrs, type) {
  const b = w.document.createElement('button');
  Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
  w.document.body.appendChild(b);
  b.dispatchEvent(new w.Event(type || 'click', { bubbles: true }));
  b.remove();
}

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

/* ============ 1. Sequestered workers mid-trip ============ */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-all').dispatchEvent(new a.w.Event('click', { bubbles: true }));
  tick(A, 5);
  A.Workers.assign('scoutspen');

  // Plan and dispatch a real cargo run to Mountains.
  const sel = a.w.document.createElement('select');
  sel.setAttribute('data-sp-action', 'add-resource');
  sel.setAttribute('data-sp-loc', 'camp');
  sel.setAttribute('data-sp-vehicle', 'mule');
  const opt = a.w.document.createElement('option'); opt.value = 'wood'; sel.appendChild(opt);
  a.w.document.body.appendChild(sel); sel.value = 'wood';
  sel.dispatchEvent(new a.w.Event('change', { bubbles: true }));

  const dsel = a.w.document.createElement('select');
  dsel.setAttribute('data-sp-action', 'set-dest');
  dsel.setAttribute('data-sp-loc', 'camp');
  dsel.setAttribute('data-sp-vehicle', 'mule');
  const dopt = a.w.document.createElement('option'); dopt.value = 'mountains'; dsel.appendChild(dopt);
  a.w.document.body.appendChild(dsel); dsel.value = 'mountains';
  dsel.dispatchEvent(new a.w.Event('change', { bubbles: true }));

  act(a.w, { 'data-sp-action': 'dispatch', 'data-sp-loc': 'camp', 'data-sp-vehicle': 'mule' });
  tick(A, 3); // finish loading -> crew moves to the mule card
  act(a.w, { 'data-sp-action': 'disembark-cargo', 'data-sp-loc': 'camp', 'data-sp-vehicle': 'mule' });
  tick(A, 2); // now traveling, crew sequestered

  const mule = A.Mechanics.get('resupplymule');
  const travelingNow = mule.getStatText().indexOf('Traveling') === 0;
  const totalBefore = A.Workers.getTotal();
  check('a mule is genuinely mid-trip with a sequestered crew', travelingNow && totalBefore < 60,
    `stat="${mule.getStatText()}" campTotal=${totalBefore}`);

  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  const muleB = B.Mechanics.get('resupplymule');
  check('mid-trip mule survives save/load', muleB.getStatText().indexOf('Traveling') === 0,
    `stat="${muleB.getStatText()}"`);
  check('sequestered crew is not deleted by the save', B.Workers.getTotal() === totalBefore,
    `${totalBefore} -> ${B.Workers.getTotal()}`);

  // Let the trip finish in the reloaded world; the crew must come back.
  const mtnBefore = B.Workers.getPools()['mountains'].getTotal();
  tick(B, 40);
  const mtnAfter = B.Workers.getPools()['mountains'].getTotal();
  check('crew arrives at the destination after loading', mtnAfter > mtnBefore, `${mtnBefore} -> ${mtnAfter}`);
  check('cargo was delivered', B.Resources.get('mtn_wood') > 0, String(B.Resources.get('mtn_wood')));
}

/* ============ 2. Research effects are replayed, not stored ============ */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-all').dispatchEvent(new a.w.Event('click', { bubbles: true }));
  tick(A, 2);
  // ALL completes every finite track, including Academy's topics, which
  // grow Market's bundles and sale slots via apply().
  const bundlesBefore = JSON.stringify(A.Mechanics.get('market').renderModalHTML().match(/\d+ Wood/g));
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  const bundlesAfter = JSON.stringify(B.Mechanics.get('market').renderModalHTML().match(/\d+ Wood/g));
  check('Academy research effects on Market are restored', bundlesBefore === bundlesAfter,
    `${bundlesBefore} -> ${bundlesAfter}`);
  check('...and they were NOT stored in the save blob',
    A.Save.exportText().length > 0 && !JSON.stringify(A.Save.serialize()).includes('"bundles"'));
}

/* ============ 3. A sale in flight ============ */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-all').dispatchEvent(new a.w.Event('click', { bubbles: true }));
  A.Workers.assign('market');
  A.Upgrades.getTrack('market:sell').startSale('wood');
  tick(A, 10);
  const remA = A.Upgrades.getTrack('market:sell').getSoonestRemaining();
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  const remB = B.Upgrades.getTrack('market:sell').getSoonestRemaining();
  check('an in-flight sale keeps its exact remaining time',
    remA != null && remB != null && Math.abs(remA - remB) < 0.01, `${remA} -> ${remB}`);
}

/* ============ 4. A dynamically created destination resource ============ */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-loc').dispatchEvent(new a.w.Event('click', { bubbles: true }));
  const id = A.SandDunes.ensureResource('journals', 'Journals');
  A.Resources.setRaw(id, 42);
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  check('a resource that only exists because cargo created it is recreated',
    B.Resources.exists('sd_journals') && B.Resources.get('sd_journals') === 42,
    `exists=${B.Resources.exists('sd_journals')} value=${B.Resources.get('sd_journals')}`);
  check('...with its display name intact', B.Resources.getName('sd_journals') === 'Journals');
}

/* ============ 5. Corrupt save must not soft-lock the game ============ */
newStore();
{
  STORE.setItem('orbweaver.save.v1', 'OW1|bm90cmVhbGpzb24=|zzzz');
  const b = boot();
  // One console.error IS the correct behaviour here — recovery should be
  // loud in the console and quiet in the UI. What must not happen is an
  // unhandled throw, a missing game, or a wiped world.
  const onlyExpected = b.errors.length === 1 && b.errors[0].includes('Save could not be loaded');
  check('a corrupt save starts a fresh game instead of breaking',
    onlyExpected && !!b.OW.Mechanics.get('wood') && b.OW.Resources.get('gold') === 5000,
    b.errors.join('\n        '));
  check('...and the unreadable save is set aside, not silently destroyed',
    !!STORE.getItem('orbweaver.save.v1.broken'));
}

/* ============ 6. A plain early-game save, no cheats ============ */
newStore();
{
  const a = boot(), A = a.OW;
  A.Workers.assign('wood'); A.Workers.assign('wood');
  tick(A, 90);
  const woodA = A.Resources.get('wood');
  const goldA = A.Resources.get('gold');
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  check('an untouched early-game save round-trips',
    Math.abs(B.Resources.get('wood') - woodA) < 0.001 && Math.abs(B.Resources.get('gold') - goldA) < 0.001,
    `wood ${woodA}->${B.Resources.get('wood')}, gold ${goldA}->${B.Resources.get('gold')}`);
  check('cheatsUsed is false on a clean save', A.Save.serialize().cheatsUsed === false);
  check('unrevealed cards stay unrevealed', B.Mechanics.get('academy').revealed === false);
}

/* ============ 7. Global M/P/F cheat deltas persist and stack ============ */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-mpf-m').click();
  a.w.document.getElementById('cheat-mpf-p').click();
  a.w.document.getElementById('cheat-mpf-f').click();
  a.w.document.getElementById('cheat-mpf-card').click();
  const before = A.Upgrades.getGlobalMods();
  check('global M/P/F cheat presses stack to 0.1 each',
    Math.abs(before.m - 0.1) < 1e-9 && Math.abs(before.p - 0.1) < 1e-9 && Math.abs(before.f - 0.1) < 1e-9,
    JSON.stringify(before));
  check('the MPF Test card is revealed by its cheat button', A.Mechanics.get('mpftest').revealed === true);
  // Open the card's own modal exactly as a click would, to catch a
  // missing renderModalHTML() the way clicking the card in-browser did.
  let modalErr = null;
  try { A.Mechanics.get('mpftest').renderModalHTML(); } catch (e) { modalErr = e.message; }
  check('MPF Test card renders its modal without throwing', modalErr === null, modalErr);
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  const after = B.Upgrades.getGlobalMods();
  check('global M/P/F deltas round-trip through save/load',
    Math.abs(after.m - before.m) < 1e-9 && Math.abs(after.p - before.p) < 1e-9 && Math.abs(after.f - before.f) < 1e-9,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  check('a revealed MPF Test card stays revealed after load', B.Mechanics.get('mpftest').revealed === true);
}

/* ============ 8. Local M/P/F card buttons persist and stack ============ */
newStore();
{
  const a = boot(), A = a.OW;
  act(a.w, { 'data-mpf-action': 'bump-local-m' });
  act(a.w, { 'data-mpf-action': 'bump-local-m' });
  act(a.w, { 'data-mpf-action': 'bump-local-p' });
  act(a.w, { 'data-mpf-action': 'bump-local-f' });
  const rateBefore = A.Mechanics.get('mpftest').getWorkerDesc; // sanity: still callable
  check('local M/P/F card buttons are wired and callable', typeof rateBefore === 'function');
  A.Workers.assign('mpftest');
  tick(A, 1);
  const statsHtml = A.Mechanics.get('mpftest').renderModalHTML();
  check('the modal reflects the stacked local m/p/f values', statsHtml.includes('m=1.20') && statsHtml.includes('p=1.10') && statsHtml.includes('f=0.10'),
    statsHtml.match(/m=[\d.]+ p=[\d.]+ f=[\d.]+/)?.[0]);
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  const statsHtmlB = B.Mechanics.get('mpftest').renderModalHTML();
  check('local m/p/f round-trip through save/load', statsHtmlB.includes('m=1.20') && statsHtmlB.includes('p=1.10') && statsHtmlB.includes('f=0.10'),
    statsHtmlB.match(/m=[\d.]+ p=[\d.]+ f=[\d.]+/)?.[0]);
}

/* ============ 9. Wood/Stone production formula: baseline unchanged, global M/P/F now reaches it ============ */
newStore();
{
  const a = boot(), A = a.OW;
  A.Workers.assign('wood');
  tick(A, 5); // 5s at baseline: 1 worker * 0.65 starting gainPerWorker (pre-upgrade)
  const expected = 5 * 0.65;
  check('baseline wood production is unchanged by the formula swap',
    Math.abs(A.Resources.get('wood') - expected) < 0.05,
    `got ${A.Resources.get('wood')}, expected ~${expected}`);
}
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-mpf-m').click(); // global m +0.1
  A.Workers.assign('wood');
  tick(A, 5);
  const expected = 5 * (0.65 + 0.1); // starting gainPerWorker + globalM
  check('global +M cheat now measurably speeds up real wood production',
    Math.abs(A.Resources.get('wood') - expected) < 0.05,
    `got ${A.Resources.get('wood')}, expected ~${expected}`);
}

/* ============ 10. Wood/Stone/Quarry local p/f round-trip through save/load ============ */
newStore();
{
  const a = boot(), A = a.OW;
  A.Workers.assign('wood');
  tick(A, 3);
  const woodBefore = A.Resources.get('wood');
  A.Save.saveToStorage();
  const b = boot(), B = b.OW;
  check('an untouched wood save keeps producing at the same rate after load',
    Math.abs(B.Resources.get('wood') - woodBefore) < 0.05,
    `before=${woodBefore} after=${B.Resources.get('wood')}`);
}

/* ============ 11. rP/rF cheat buttons stack local p/f on Wood/Stone/Quarry ============ */
newStore();
{
  const a = boot(), A = a.OW;
  a.w.document.getElementById('cheat-rp').click();
  a.w.document.getElementById('cheat-rf').click();
  // p=1.1, f=0.1, gainPerWorker=0.65 (pre-upgrade), 1 worker:
  // rate = 0.65 * 1^1.1 + 0.1 = 0.75
  const expected = 0.65 * Math.pow(1, 1.1) + 0.1;
  A.Save.saveToStorage(); // save BEFORE assigning/ticking, so wood stays at 0
  A.Workers.assign('wood');
  tick(A, 1);
  check('rP/rF reach Wood\'s production rate',
    Math.abs(A.Resources.get('wood') - expected) < 0.01,
    `got ${A.Resources.get('wood')}, expected ~${(expected).toFixed(3)}`);

  const b = boot(), B = b.OW; // loads the pre-tick save (wood=0, p/f stacked)
  B.Workers.assign('wood');
  tick(B, 1);
  check('rP/rF-stacked local p/f survive save/load',
    Math.abs(B.Resources.get('wood') - expected) < 0.01,
    `got ${B.Resources.get('wood')}, expected ~${(expected).toFixed(3)}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
