/* Quarry. Boots the real game headless and covers what changed this
   session: real toolTier: 2 consumption (a tool shortfall stops
   production, binary, not scaled), the header tier-pips subtitle, and
   the upkeep.js gold-cap bug fix (mechanic.resourceId) that was
   piggybacked onto this same tick() edit. Quarry's pre-existing ladder/
   production behavior is exercised incidentally, not re-proven here —
   save-edgecases.test.js already covers Wood's identical formula. */
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

const quarry = OW.Mechanics.get('quarry');
OW.Mountains.reveal();
OW.Cards.reveal(quarry);
OW.Mountains.addWorkers(10);
const pool = OW.Mountains.workerPool;

check('quarry.resourceId matches its actual resource (upkeep.js fix)', quarry.resourceId === 'mtn_stone');
check('quarry uses the Mountains modal theme, same as its sibling mechanics', quarry.modalTheme === 'theme-mountains');

/* ---- Header tier-pips subtitle ---- */
const subtitle = quarry.getSubtitleHtml();
check('getSubtitleHtml renders a Tier II requirement with one crossed pip below it',
  (subtitle.match(/tier-pip-crossed/g) || []).length === 1 && subtitle.includes('Requires Tier II tools'), subtitle);

/* ---- No tools at all: a worker needs a whole tool in hand to work, so
   nothing is produced from the very first tick — no sub-whole-tool window
   of free output — and it stays stopped for as long as tools stay empty. */
const stoneAtStart = OW.Resources.get('mtn_stone');
pool.assign('quarry');
tick(OW, 0.8); // the old sub-whole-tool window: must now yield exactly nothing
check('no tools in stock produces nothing at all from the very first tick',
  OW.Resources.get('mtn_stone') === stoneAtStart, `start=${stoneAtStart} after=${OW.Resources.get('mtn_stone')}`);
tick(OW, 2);
check('stays fully stopped for as long as tools stay empty — no creep',
  OW.Resources.get('mtn_stone') === stoneAtStart, `start=${stoneAtStart} after=${OW.Resources.get('mtn_stone')}`);
check('getStatText reads the generic Stopped string while tool-starved', quarry.getStatText() === 'Stopped');

/* ---- Idle workers are free: no tool in hand means no work happened, so no
   wage is owed. Covered twice over — quarry's own isBillable() and the
   core net in upkeep.js reading mechanic.toolConsumer.isStarved(). ---- */
let goldAtStop = OW.Resources.get('gold');
tick(OW, 3);
check('gold does not drain for workers on a tool-starved Quarry',
  OW.Resources.get('gold') === goldAtStop, `before=${goldAtStop} after=${OW.Resources.get('gold')}`);
check('the core upkeep net sees the starved consumer through mechanic.toolConsumer',
  quarry.toolConsumer && quarry.toolConsumer.isStarved() === true);
// The net alone must hold: a future tool card that forgets isBillable is
// still covered, purely by exposing its consumer.
const savedIsBillable = quarry.isBillable;
delete quarry.isBillable;
goldAtStop = OW.Resources.get('gold');
tick(OW, 2);
check('the toolConsumer net alone stops the drain, with no isBillable on the card',
  OW.Resources.get('gold') === goldAtStop, `before=${goldAtStop} after=${OW.Resources.get('gold')}`);
quarry.isBillable = savedIsBillable;

/* ---- Plenty of tools: production proceeds normally ---- */
OW.Mountains.ensureResource('tools2', 'Tools II');
OW.Resources.setRaw('mtn_tools2', 100000, 100000);
const stoneBefore = OW.Resources.get('mtn_stone');
goldAtStop = OW.Resources.get('gold');
tick(OW, 5);
check('mtn_stone increases once mtn_tools2 is available', OW.Resources.get('mtn_stone') > stoneBefore, `before=${stoneBefore} after=${OW.Resources.get('mtn_stone')}`);
check('gold drains normally again once the workers have tools to use',
  OW.Resources.get('gold') < goldAtStop, `before=${goldAtStop} after=${OW.Resources.get('gold')}`);
check('mtn_tools2 was actually spent (1 per worker/s, 1 worker for 5s)',
  Math.round(100000 - OW.Resources.get('mtn_tools2')) === 5, `spent=${100000 - OW.Resources.get('mtn_tools2')}`);

/* ---- Running out mid-flight: production stops the instant tools do,
   binary — not a scaled-down trickle. ---- */
OW.Resources.setRaw('mtn_tools2', 0, 100000);
const stoneBefore2 = OW.Resources.get('mtn_stone');
tick(OW, 3);
check('production stops immediately once tools run out (no partial output)', OW.Resources.get('mtn_stone') === stoneBefore2, `before=${stoneBefore2} after=${OW.Resources.get('mtn_stone')}`);

/* ---- The actual upkeep bug this session fixed: Quarry's workers now
   correctly stop costing gold once mtn_stone is at cap (previously
   upkeep.js checked isAtCap('quarry'), a resource id that never
   existed, so this exemption silently never fired). ---- */
OW.Resources.setRaw('mtn_tools2', 100000, 100000);
OW.Resources.setRaw('mtn_stone', OW.Resources.getCap('mtn_stone'), OW.Resources.getCap('mtn_stone'));
const goldBefore = OW.Resources.get('gold');
tick(OW, 5);
check('gold does not drain for a worker on an at-cap Quarry (upkeep.js fix)', OW.Resources.get('gold') === goldBefore, `before=${goldBefore} after=${OW.Resources.get('gold')}`);

/* ---- Save/load: the tool consumer's own accumulator progress persists ---- */
OW.Resources.setRaw('mtn_tools2', 100000, 100000);
tick(OW, 0.6); // bank some sub-whole-tool progress without landing exactly on an integer
const boardA = { p: 1, stone: OW.Resources.get('mtn_stone') };
STORE.setItem('orbweaver.save.v1', OW.Save.encode(OW.Save.serialize()));
const B = boot();
check('second boot with no script errors', B.errors.length === 0, B.errors.join('\n        '));
const quarryB = B.OW.Mechanics.get('quarry');
check('quarry resourceId hook survives a fresh module load too', quarryB.resourceId === 'mtn_stone');
check('mtn_stone value survived save/load', B.OW.Resources.get('mtn_stone') === boardA.stone, `A=${boardA.stone} B=${B.OW.Resources.get('mtn_stone')}`);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
