/* Pulley counterweight. Boots the real game headless with the pulley
   built, then builds a Mountains counterweight (10,000 stone hauled in
   pieces), checks the Sand Dunes end stays its own, drives trips with
   crew (none = stopped, gold out = stopped, MPF buffs apply), the
   repeat switch (waits unbilled for a full load, a partial fill, off
   only when an Up finds storage full, never off on Down), save/reload,
   an older save's Sand Dunes clearers, and the card − priority. */
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
const body = () => w.document.getElementById('card-modal-body').innerHTML;
const pause = () => { const t0 = Date.now(); while (Date.now() - t0 < 150); };
let cp, sdp, P, S;
const bind = () => { cp = OW.Mechanics.get('collapsedpath'); sdp = OW.Mechanics.get('sdpulley'); P = OW.Pulley; S = OW.CollapsedPath.splits; };
const openCard = (m) => { OW.Cards.closeModal(); pause(); m.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true })); };
const press = (slot, n = 1, act = 'add') => { for (let i = 0; i < n; i++) { const b = $(`[data-cp-sub="${slot}"][data-cp-sub-action="${act}"]`); b.dispatchEvent(new w.Event('pointerdown')); b.dispatchEvent(new w.Event('pointerup')); } };
const click = (sel) => $(sel).dispatchEvent(new w.Event('click', { bubbles: true }));
const setLoad = (end, dir, id, n) => {
  click(`[data-pe="${end}"][data-pe-action="${dir}"]`);
  const sel = $(`[data-pe-cargo="${end}"]`); sel.value = id; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const q = $(`[data-pe-qty="${end}"]`); q.value = String(n); q.dispatchEvent(new w.Event('input', { bubbles: true }));
};
bind();

// Staging: Mountains + Sand Dunes found, ladder up, pulley built, plenty of gold.
OW.Mountains.reveal(); OW.Mountains.addWorkers(20); OW.SandDunes.addWorkers(6);
OW.Resources.setCap('gold', 1e9); OW.Resources.add('gold', 1e8);
{ const s = OW.Save.serialize(); s.mechanics.collapsedpath = Object.assign({}, s.mechanics.collapsedpath, { l: 1, p: 1 }); s.mechanics.pulley = { b: 1, s: {} }; OW.Save.deserialize(s); }
OW.SandDunes.reveal(); OW.Cards.reveal(cp); OW.Cards.reveal(sdp);
const mtnStone = OW.Mountains.stoneId, mtnWood = OW.Mountains.woodId;
OW.Resources.spend(mtnStone, OW.Resources.get(mtnStone)); OW.Resources.add(mtnStone, 3000);

/* ---- Before: Pulley, with Counterweight to build below it ---- */
openCard(cp);
check('Mountains area is titled Pulley (not Ladder & Pulley)', body().includes('>Pulley<') && !body().includes('Ladder &amp;'));
check('a Counterweight section sits below the Pulley, 10,000 Stone', body().indexOf('>Pulley<') < body().indexOf('>Counterweight<') && body().includes('10,000 Stone'));
check('no crew stepper or repeat switch before the counterweight', !$('[data-cp-sub="crew"]') && !$('[data-pe-action="auto"]'));
press('cwb', 5);
check('counterweight + promotes Mountains workers onto the card', OW.Mountains.workerPool.getAssigned('collapsedpath') === 5 && S.mtn.get('cwb') === 5);
OW.Cards.closeModal();
tick(OW, 100);
check('5 builders haul ~500 stone in 100s', Math.abs(P.mtn.save().h - 500) < 1, P.mtn.save().h);
check('card face reads Building Counterweight; builders bill', cp.getStatText() === 'Building Counterweight' && cp.getBillableCount() === 5, cp.getStatText());
check('bottom bar shows counterweight progress', Math.abs(cp.getBuildBarPct() - 5) < 0.1);
tick(OW, 600);
check('out of stone: stops, keeps progress, bills nothing', Math.abs(P.mtn.save().h - 3000) < 1 && cp.getBillableCount() === 0 && OW.Resources.get(mtnStone) === 0);
openCard(cp);
check('stopped build says so', $('[data-pe-cw="mtn"]').textContent.includes('3,000/10,000') && $('[data-pe-cw="mtn"]').textContent.includes('Stopped'));
OW.Cards.closeModal();
for (let i = 0; i < 2; i++) { OW.Resources.add(mtnStone, 5000); tick(OW, 1000); }
check('built in pieces past the 5,000 stone cap', P.mtn.save().w === 1 && P.mtn.save().h === 10000);
check('builders step back onto the card', S.mtn.get('cwb') === 0 && OW.Mountains.workerPool.getAssigned('collapsedpath') === 5);
check('exactly 10,000 stone spent', OW.Resources.get(mtnStone) === 3000, OW.Resources.get(mtnStone));

/* ---- After: Pulley & counterweight ---- */
openCard(cp);
check('area becomes Pulley & counterweight with crew stepper and repeat switch', body().includes('Pulley &amp; counterweight') && $('.hs-head [data-cp-sub="crew"]') && $('[data-pe-action="auto"]') && !body().includes('>Counterweight<'));
check('no crew: header says it needs a worker', $('[data-pe-time="mtn"]').textContent === 'Needs a worker');
openCard(sdp);
check('Sand Dunes end is still a plain Pulley with its own Counterweight to build', body().includes('>Pulley<') && body().includes('>Counterweight<') && !body().includes('Pulley &amp; counterweight') && P.sd.save().w === 0);

/* ---- Crew drives the trip ---- */
openCard(cp);
OW.Resources.add(mtnWood, 1000);
setLoad('mtn', 'up', 'wood', 50);
click('[data-pe="mtn"][data-pe-action="send"]');
tick(OW, 30);
check('0 crew: the trip stands still and bills nothing', P.mtn.trip.t === 300 && cp.getStatText() === 'Stopped' && cp.getBillableCount() === 0);
openCard(cp);
check('stopped trip says it needs a worker', $('[data-pe-trip="mtn"]').textContent.includes('Stopped — needs a worker'));
press('crew', 1);
check('1 crew: header shows the standard 5m trip', $('[data-pe-time="mtn"]').textContent === 'Trip 5m');
OW.Cards.closeModal();
tick(OW, 60);
check('1 crew moves it at 1 s/s, crew bills while it moves', Math.abs(P.mtn.trip.t - 240) < 0.5 && cp.getBillableCount() === 1, P.mtn.trip.t);
openCard(cp); press('crew', 1);
check('2 crew: Trip 2m 30s', $('[data-pe-time="mtn"]').textContent === 'Trip 2m 30s');
OW.Cards.closeModal();
tick(OW, 30);
check('2 crew speed the trip already in flight (2 s/s)', Math.abs(P.mtn.trip.t - 180) < 0.5, P.mtn.trip.t);
const gold = OW.Resources.get('gold');
OW.Resources.spend('gold', gold);
tick(OW, 30);
check('gold out: the trip stops and crew bill nothing', Math.abs(P.mtn.trip.t - 180) < 0.5 && cp.getBillableCount() === 0, P.mtn.trip.t);
OW.Resources.add('gold', gold);
OW.Upgrades.addGlobalMod('m', 1);
openCard(cp);
check('MPF buffs apply: M+1 doubles 2 crew to Trip 1m 15s', $('[data-pe-time="mtn"]').textContent === 'Trip 1m 15s', $('[data-pe-time="mtn"]').textContent);
OW.Upgrades.addGlobalMod('m', -1);
OW.Cards.closeModal();
tick(OW, 100);
check('the trip lands', !P.mtn.trip && P.storageHtml().includes('Wood 50'));

/* ---- Repeat ---- */
openCard(cp); press('crew', 8); // 10 crew: 30s trips
setLoad('mtn', 'up', 'wood', 50);
OW.Resources.spend(mtnWood, OW.Resources.get(mtnWood)); OW.Resources.add(mtnWood, 20);
click('[data-pe="mtn"][data-pe-action="auto"]');
check('the repeat switch turns on', $('[data-pe-action="auto"]').classList.contains('on'));
tick(OW, 5);
check('not enough wood: waits, sends nothing, bills no crew', !P.mtn.trip && cp.getStatText() === 'Waiting for 50 Wood' && cp.getBillableCount() === 0 && OW.Resources.get(mtnWood) === 20, cp.getStatText());
OW.Resources.add(mtnWood, 1000);
tick(OW, 1);
check('wood arrives: the same load goes out on its own', P.mtn.trip && P.mtn.trip.n === 50 && P.mtn.trip.id === 'wood');
tick(OW, 31);
check('after landing it repeats the same load', P.mtn.trip && P.mtn.trip.n === 50 && P.storageHtml().includes('Wood 100'), P.storageHtml());
S.mtn.clear('crew'); // hold the trip while other cargo tops storage to 180
OW.Resources.add(OW.SandDunes.ensureResource('stone', 'Stone'), 30);
openCard(sdp); setLoad('sd', 'up', 'stone', 30); click('[data-pe="sd"][data-pe-action="send"]');
tick(OW, 301);
openCard(cp); press('crew', 10);
OW.Cards.closeModal();
tick(OW, 31);
check('a repeat with only 20 room sends the 20 that fit', P.mtn.trip && P.mtn.trip.n === 20, P.mtn.trip && P.mtn.trip.n);
tick(OW, 32);
check('storage full: the switch turns itself off and nothing more goes', !P.mtn.trip && P.mtn.save().a === 0 && P.storageHtml().includes('200/200'), P.storageHtml());
openCard(cp);
check('switch shows off after the full-storage stop', !$('[data-pe-action="auto"]').classList.contains('on'));
setLoad('mtn', 'down', 'wood', 50);
click('[data-pe="mtn"][data-pe-action="auto"]');
tick(OW, 200);
check('Down repeats never switch off on full storage; with 20 wood left they wait for a full 50', P.mtn.save().a === 1 && P.storageHtml().includes('Wood 20') && /Waiting for 50 Wood/.test(cp.getStatText()), cp.getStatText());
openCard(cp);
check('the waiting repeat keeps its cargo selected', $('[data-pe-cargo="mtn"]').value === 'wood' && $('[data-pe-wait="mtn"]').textContent === 'Waiting for 50 Wood');

/* ---- Sand Dunes end: its own counterweight, from Sand Dunes stone ---- */
openCard(sdp);
press('clear', 1); press('cwb', 3);
check('Sand Dunes card splits its workers: 1 clearing, 3 on the counterweight', S.sd.get('clear') === 1 && S.sd.get('cwb') === 3 && OW.SandDunes.workerPool.getAssigned('sdpulley') === 4);
OW.Resources.add(OW.SandDunes.ensureResource('stone', 'Stone'), 100);
OW.Cards.closeModal();
tick(OW, 10);
check('Sand Dunes counterweight hauls Sand Dunes stone only', Math.abs(P.sd.save().h - 30) < 1 && P.mtn.save().w === 1, P.sd.save().h);

/* ---- Save / reload ---- */
OW.Save.saveToStorage();
({ w, OW, errors } = boot()); bind();
tick(OW, 1);
check('reload keeps both ends: counterweight, repeat, cargo, crew, split', errors.length === 0 && P.mtn.save().w === 1 && P.mtn.save().a === 1 && P.mtn.save().c === 'wood'
  && P.mtn.save().u === 0 && S.mtn.get('crew') === 10 && S.sd.get('cwb') === 3 && Math.abs(P.sd.save().h - 33) < 1, errors.join('; '));
{ // Older save: Sand Dunes card workers were all clearers (no split saved).
  const s = OW.Save.serialize(); delete s.mechanics.collapsedpath.ssp;
  s.pools.sanddunes.a = { sdpulley: 2 };
  OW.Save.deserialize(s);
  check('older save: Sand Dunes card workers come back as clearers', S.sd.get('clear') === 2 && S.sd.get('cwb') === 0, JSON.stringify(S.sd.serialize()));
}

/* ---- Card − priority: free, builders, crew, clearers ---- */
{ const pool = OW.Mountains.workerPool;
  while (pool.unassign('collapsedpath'));
  S.mtn.deserialize({});
  openCard(cp); press('clear', 1); press('crew', 2); pool.assign('collapsedpath');
  pool.unassign('collapsedpath');
  check('card − takes the free worker first', S.mtn.get('crew') === 2 && S.mtn.get('clear') === 1);
  pool.unassign('collapsedpath');
  check('then crew before clearers', S.mtn.get('crew') === 1 && S.mtn.get('clear') === 1);
  pool.unassign('collapsedpath'); pool.unassign('collapsedpath');
  check('clearers go last', S.mtn.get('crew') === 0 && S.mtn.get('clear') === 0);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
