/* Loc 2 cheat. Boots the real game headless with the Rich Uncle
   Tutorial on, presses Loc 2, and checks it finishes Camp and Mountains
   (buildings, travels, caps, tools, workers) without ever giving Rich
   Uncle, mules, carts, bulls or anything in Sand Dunes. Then walks the
   real route — ladder, Peer over the top — and presses Loc 2 again to
   prove Sand Dunes and Collapsed Path progress are left alone. */
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
let { w, OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));
const $ = (sel) => w.document.querySelector('#card-modal-body ' + sel);
const clickId = (id) => w.document.getElementById(id).dispatchEvent(new w.Event('click', { bubbles: true }));
const pause = () => { const t0 = Date.now(); while (Date.now() - t0 < 150); };
const M = (id) => OW.Mechanics.get(id);
const EXCLUDED = ['richuncle_camp', 'richuncle_mountains', 'expeditionmule', 'mpftest', 'strangeshard', 'sanddunes', 'sdpulley']
  .concat(OW.Mechanics.all().map((m) => m.id).filter((id) => /mule|cartbull/.test(id)));
const snapshotSd = () => JSON.stringify({ d: OW.SandDunes.isDiscovered(), p: OW.SandDunes.workerPool.serialize(),
  r: OW.Resources.all().filter((r) => r.id.startsWith('sd_')).map((r) => [r.id, r.current]), sd: M('sanddunes').revealed, pl: M('sdpulley').revealed });

// Rich Uncle Tutorial ON — the worst case: the cheat's builds must not summon him.
clickId('richuncle-toggle');
check('a Loc 2 button sits in the cheat bar', w.document.getElementById('cheat-loc2').textContent === 'Loc 2');
clickId('cheat-loc2');

/* ---- What it gives ---- */
const capped = OW.Resources.all().filter((r) => r.cap != null && !r.id.startsWith('sd_'));
check('every Camp and Mountains resource with a cap is full', capped.every((r) => r.current === r.cap), capped.filter((r) => r.current !== r.cap).map((r) => r.id).join(','));
check('1000 Tools II and III in Camp and Mountains, all rows shown', ['tools2', 'tools3', 'mtn_tools2', 'mtn_tools3'].every((id) => OW.Resources.get(id) === 1000 && !OW.Resources.isHidden(id)));
check('20 workers in Camp and in Mountains', OW.Workers.getPools().camp.getTotal() === 20 && OW.Workers.getPools().mountains.getTotal() === 20,
  OW.Workers.getPools().camp.getTotal() + '/' + OW.Workers.getPools().mountains.getTotal());
tick(OW, 2);
const CAMP = ['buildersbench', 'wood', 'stone', 'tents', 'marketstall', 'scoutspen', 'academy', 'toolshed', 'digsite'];
const MTN = ['mountains', 'mtn_scoutstable', 'quarry', 'smeltershack', 'goldpanning', 'wheatfieldcard', 'collapsedpath'];
check('every Camp building is shown', CAMP.every((id) => M(id).revealed), CAMP.filter((id) => !M(id).revealed).join(','));
check('every Mountains building is shown', MTN.every((id) => M(id).revealed), MTN.filter((id) => !M(id).revealed).join(','));
const mtnSave = OW.Save.serialize().mechanics.mountains;
check('every Mountains travel is finished and claimed', mtnSave.ap.length === 0 && Object.keys(mtnSave.ps).length === 9
  && Object.values(mtnSave.ps).every((s) => s.phase === 'done'), JSON.stringify(Object.keys(mtnSave.ps)));
check('Quarry and Smelter Shack builds are done', mtnSave.qp === 'done' && mtnSave.sp === 'done' && mtnSave.su === 1);

/* ---- What it must not give ---- */
tick(OW, 10);
check('no Rich Uncle, mules, carts, bulls, test cards or Sand Dunes cards', EXCLUDED.every((id) => !M(id).revealed), EXCLUDED.filter((id) => M(id).revealed).join(','));
check('Sand Dunes untouched: undiscovered, no workers, no resources', !OW.SandDunes.isDiscovered() && OW.SandDunes.workerPool.getTotal() === 0
  && !OW.Resources.all().some((r) => r.id.startsWith('sd_')) && w.document.getElementById('sanddunes-section').style.display === 'none');
check('Sand Dunes not a Scout Stable destination', !OW.Locations.destinationsFor('mountains').some((l) => l.id === 'sanddunes'));
const cp = M('collapsedpath');
check('Collapsed Path arrives fresh: full collapse, ladder unbuilt, no peer button', cp.getUpgradeBarPct() === 100
  && !cp.renderModalHTML().includes('data-cp-action="peer"') && cp.renderModalHTML().includes('Lash a ladder'));
check('the cheat assigns nobody to Collapsed Path', OW.Workers.getPools().mountains.getAssigned('collapsedpath') === 0);

/* ---- Pressing it twice is harmless ---- */
const before = OW.Save.serialize();
clickId('cheat-loc2');
const after = OW.Save.serialize();
check('a second press leaves travels, builds and Collapsed Path as they were', JSON.stringify(after.mechanics.mountains.ps) === JSON.stringify(before.mechanics.mountains.ps)
  && JSON.stringify(after.mechanics.collapsedpath) === JSON.stringify(before.mechanics.collapsedpath));
check('a second press tops workers to 20 rather than adding', OW.Workers.getPools().camp.getTotal() === 20 && OW.Workers.getPools().mountains.getTotal() === 20);

/* ---- The real Sand Dunes route still works: ladder -> Peer over the top ---- */
pause();
cp.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
for (let i = 0; i < 5; i++) { const b = $('[data-cp-sub="build"][data-cp-sub-action="add"]'); b.dispatchEvent(new w.Event('pointerdown')); b.dispatchEvent(new w.Event('pointerup')); }
OW.Cards.closeModal();
tick(OW, 62);
check('Sand Dunes still hidden once the ladder stands', !OW.SandDunes.isDiscovered());
pause();
cp.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
check('Peer over the top appears after the ladder', !!$('[data-cp-action="peer"]'));
$('[data-cp-action="peer"]').dispatchEvent(new w.Event('click', { bubbles: true }));
check('Peer over the top reveals Sand Dunes (still unreachable, no pulley card)', OW.SandDunes.isDiscovered() && !OW.SandDunes.isReachable() && M('sanddunes').revealed && !M('sdpulley').revealed);

/* ---- Loc 2 after Sand Dunes exists never touches it ---- */
OW.SandDunes.addWorkers(3); OW.Resources.add(OW.SandDunes.ensureResource('wood', 'Wood'), 25);
const sd0 = snapshotSd(), cp0 = JSON.stringify(OW.Save.serialize().mechanics.collapsedpath);
clickId('cheat-loc2');
tick(OW, 2);
check('Loc 2 after peering leaves Sand Dunes exactly as it was', snapshotSd() === sd0, snapshotSd());
check('Loc 2 after peering leaves Collapsed Path progress alone (no second peer)', JSON.stringify(OW.Save.serialize().mechanics.collapsedpath) === cp0
  && !cp.renderModalHTML().includes('data-cp-action="peer"'));

/* ---- Save / reload ---- */
OW.Save.saveToStorage();
({ w, OW, errors } = boot());
tick(OW, 5);
check('reload boots clean with everything kept', errors.length === 0 && OW.SandDunes.isDiscovered() && M('collapsedpath').revealed && M('toolshed').revealed && M('smeltershack').revealed,
  errors.join('\n        '));
check('Rich Uncle stays away after reload (tutorial still on)', !M('richuncle_camp').revealed && !M('richuncle_mountains').revealed);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
