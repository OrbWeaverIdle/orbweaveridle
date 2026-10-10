/* Collapsed Path + the Mountains/Sand Dunes pulley. Boots the real game
   headless, reveals the card through the Mountains 'blockedexit' reward
   claim, then drives the area steppers, the worker-built ladder and
   pulley, the shared pulley storage from both ends across a save/reload,
   and a full clear through to Scout Stable routing. */
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

let cp = OW.Mechanics.get('collapsedpath');
let pool = OW.Mountains.workerPool;
const $ = (sel) => w.document.querySelector('#card-modal-body ' + sel);
const click = (sel) => $(sel).dispatchEvent(new w.Event('click', { bubbles: true }));
const press = (slot, n = 1) => { for (let i = 0; i < n; i++) { const b = $(`[data-cp-sub="${slot}"][data-cp-sub-action="add"]`); b.dispatchEvent(new w.Event('pointerdown')); b.dispatchEvent(new w.Event('pointerup')); } };
const open = () => cp.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
const body = () => w.document.getElementById('card-modal-body').innerHTML;

check('a new game no longer shows the card or grants test tools', !cp.revealed && !OW.Resources.exists('mtn_tools3'));
{ // Save compatibility: an older save's Sand Dunes idle/total counter lands in its pool.
  const old = OW.Save.serialize(); old.mechanics.sanddunes = { d: 0, t: 4, i: 4 }; delete (old.pools || {}).sanddunes;
  OW.Save.deserialize(old);
  check('older Sand Dunes worker counts carry into its pool', OW.SandDunes.workerPool.getTotal() === 4 && OW.SandDunes.workerPool.getIdleCount() === 4, OW.SandDunes.workerPool.getTotal());
  OW.SandDunes.workerPool.deserialize({ total: 0, idle: 0, a: {} }); // back to a clean pool for the rest of the suite
}
{ // A cheat can reveal the Sand Dunes pulley early; Send must do nothing until it's built.
  const sdp0 = OW.Mechanics.get('sdpulley'), sdPool = OW.SandDunes.workerPool;
  sdPool.addWorkers(2); OW.Cards.reveal(sdp0);
  sdp0.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
  w.document.querySelector('#card-modal-body [data-pe="sd"][data-pe-action="send"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  check('the Sand Dunes pulley refuses to send before the pulley is built', sdPool.getTotal() === 2 && !sdp0.getStatText());
  OW.Cards.closeModal(); OW.Cards.hide(sdp0); sdPool.deserialize({ total: 0, idle: 0, a: {} });
}
// Test staging: Mountains, 10 workers, 1000 Tier III tools, and the
// 'A blocked exit' travel path parked at its claim phase.
OW.Mountains.reveal(); OW.Mountains.addWorkers(10);
OW.Resources.add(OW.Mountains.ensureResource('tools3', 'Tools III'), 1000);
const blob = OW.Save.serialize();
blob.mechanics.mountains.ap = [];
blob.mechanics.mountains.ps = { blockedexit: { phase: 'claim', progress: 120, workers: 0, m: 1, p: 1, f: 0 } };
OW.Save.deserialize(blob);
check('finishing "A rugged Mountain path" reveals "A blocked exit"', /ruggedpath:[\s\S]*?reveals: \['blockedexit'\]/.test(require('fs').readFileSync(require('path').join(ROOT, 'js/mechanics/mountains.js'), 'utf8')));
const claim = w.document.createElement('button');
claim.dataset.mtnAction = 'claim'; claim.dataset.mtnClaim = 'blockedexit';
w.document.body.appendChild(claim);
claim.dispatchEvent(new w.Event('click', { bubbles: true }));
check('the Collapsed Pass claim reveals the Collapsed Path card', cp.revealed);
const toolsBefore = OW.Resources.get('mtn_tools3');
w.document.getElementById('cheat-tools3').dispatchEvent(new w.Event('click', { bubbles: true }));
check('Tools III +1000 cheat reaches every discovered location', OW.Resources.get('mtn_tools3') - toolsBefore === 1000 && OW.Resources.get('tools3') === 1000);
OW.Resources.spend('mtn_tools3', 1000);
const pause = () => { const t0 = Date.now(); while (Date.now() - t0 < 150); }; // past cards.js's ghost-click guard after a modal close
pause();
check('Sand Dunes not reachable by Scout Stables before clearing',
  !OW.Locations.destinationsFor('mountains').some((l) => l.id === 'sanddunes'));

open();
check('before the ladder, the build area is titled Ladder and nothing names the pulley', body().includes('>Ladder<') && !/pulley/i.test(body()));
check('modal has two distinct areas, each with its own stepper', body().includes('Clearing the path') && body().includes('>Ladder<')
  && $('[data-cp-sub="clear"]') && $('[data-cp-sub="build"]'));
check('steppers sit in each area header, tier pips below the clearing stepper', $('.hs-head [data-cp-sub="clear"]') && $('.hs-head [data-cp-sub="build"]') && $('.hs-head .tool-pips-row'));
check('clearing counts down from 999', $('[data-cp-num]').textContent === '999 left');
check('card-face top bar starts full', cp.getUpgradeBarPct() === 100);
check('tier pill lives in the Clearing area, not the card face', !cp.els.wrap.querySelector('.card-tier-pill') && body().includes('Requires Tier III tools'));

/* ---- Builders haul Wood into the ladder at 1/worker/s ---- */
OW.Resources.add('mtn_wood', 1000);
OW.Resources.setCap('mtn_stone', 50000); OW.Resources.add('mtn_stone', 50000);
press('build', 5);
const clearVal = () => +$('[data-cp-sub-val="clear"]').textContent;
const buildVal = () => +$('[data-cp-sub-val="build"]').textContent;
check('card stepper is back on the card face and modal header', cp.els.cardSteppersWrap.style.display !== 'none' && w.document.querySelector('#card-modal-header .card-steppers, .modal-win .card-steppers'));
check('build stepper promotes Mountains workers onto the card and the build area', pool.getAssigned('collapsedpath') === 5 && buildVal() === 5);
press('clear', 2); $('[data-cp-sub="clear"][data-cp-sub-action="remove"]').dispatchEvent(new w.Event('pointerdown'));
check('area − returns the worker to idle; the other area is untouched', buildVal() === 5 && clearVal() === 1 && pool.getAssigned('collapsedpath') === 6);
pool.assign('collapsedpath'); pool.unassign('collapsedpath');
check('card − takes a free worker first', buildVal() === 5 && clearVal() === 1 && pool.getAssigned('collapsedpath') === 6);
pool.unassign('collapsedpath');
check('with none free, card − takes a builder, never a clearer', buildVal() === 4 && clearVal() === 1);
$('[data-cp-sub="clear"][data-cp-sub-action="remove"]').dispatchEvent(new w.Event('pointerdown'));
press('build', 1);
check('area + promotes from the pool when the card has none free', buildVal() === 5 && clearVal() === 0 && pool.getAssigned('collapsedpath') === 5);
const wood0 = OW.Resources.get('mtn_wood');
tick(OW, 30);
check('bottom bar tracks ladder build', Math.abs(cp.getBuildBarPct() - 50) < 1, cp.getBuildBarPct());
check('5 builders haul ~150 wood in 30s, ladder not done yet', Math.abs(wood0 - OW.Resources.get('mtn_wood') - 150) < 1 && !OW.SandDunes.isDiscovered(), wood0 - OW.Resources.get('mtn_wood'));
tick(OW, 31);
check('ladder completes without revealing Sand Dunes yet', !OW.SandDunes.isDiscovered());
open();
check('ladder frees its builders onto the card (area 0, card total kept)', +$('[data-cp-sub-val="build"]').textContent === 0 && pool.getAssigned('collapsedpath') === 5);
check('card-face top bar uses the section color', cp.els.wrap.querySelector('.card-upgrade-bar.tiered'));
click('[data-cp-action="peer"]');
check('Peer over the top closes the modal and reveals Sand Dunes (still unreachable)', !OW.Cards.isModalOpenFor('collapsedpath') && OW.SandDunes.isDiscovered() && !OW.SandDunes.isReachable());
pause();
open();
check('peer button is gone once used', !$('[data-cp-action="peer"]'));
press('build', 5);

/* ---- Pulley: one 1000-stone build; reveals the Sand Dunes pulley ---- */
const stone0 = OW.Resources.get('mtn_stone');
// Rendered ticks (not runBulk, which suspends drawing), so the card face
// is redrawn on the very tick the pulley finishes.
let tickThrew = false;
for (let i = 0; i < 1003; i++) try { cp.tick(true, 0.2); } catch (e) { tickThrew = true; }
const stone1 = OW.Resources.get('mtn_stone');
tick(OW, 10);
check('pulley frees its builders onto the card too', pool.getAssigned('collapsedpath') === 5 && !OW.Mechanics.get('collapsedpath').renderModalHTML().includes('data-cp-sub="build"'));
check('pulley is one build (~1000 stone), then no more building', OW.Pulley.isBuilt() && stone0 - stone1 <= 1000 && OW.Resources.get('mtn_stone') === stone1, stone0 - stone1);
check('Sand Dunes pulley card appears when the pulley is built', OW.Mechanics.get('sdpulley').revealed);
check('finishing the last build redraws cleanly (was: null project label)', !tickThrew);
open();
check('Mountains modal shows the shared storage strip', body().includes('Pulley storage') && body().includes('0/200'));

/* ---- Up from Mountains: no crew, straight into a 5-minute trip ---- */
const send = (end, dir, id, n) => {
  click(`[data-pe="${end}"][data-pe-action="${dir}"]`);
  const sel = $(`[data-pe-cargo="${end}"]`); sel.value = id; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const q = $(`[data-pe-qty="${end}"]`); q.value = String(n); q.dispatchEvent(new w.Event('input', { bubbles: true }));
  click(`[data-pe="${end}"][data-pe-action="send"]`);
};
const wood1 = OW.Resources.get('mtn_wood');
send('mtn', 'up', 'wood', 80);
check('asking for 80 sends 50: one trip carries at most 50', wood1 - OW.Resources.get('mtn_wood') === 50, wood1 - OW.Resources.get('mtn_wood'));
check('no crew assigned: the pulley area has no stepper', !$('[data-cp-sub="build"]'));
tick(OW, 11);
check('the 5-minute trip starts at once, no loading wait', /Hoisting 4m (49|50)s/.test(cp.getStatText()), cp.getStatText());
OW.Save.saveToStorage();
({ w, OW, errors } = boot());
cp = OW.Mechanics.get('collapsedpath'); pool = OW.Mountains.workerPool;
check('reload mid-trip boots clean', errors.length === 0, errors.join('\n        '));
tick(OW, 290);
check('wood lands in shared storage after reload', OW.Pulley.storageHtml().includes('Wood 50') && OW.Pulley.storageHtml().includes('150 free'));

/* ---- Workers up, then down at the Sand Dunes end ---- */
open();
send('mtn', 'up', 'workers', 3);
check('riding workers leave the Mountains pool', pool.getTotal() === 7, pool.getTotal());
tick(OW, 302);
let sdp = OW.Mechanics.get('sdpulley');
sdp.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
check('Sand Dunes card-face top bar is banded in the storage colors', /linear-gradient/.test(sdp.els.upgradeBar.style.background)
  && sdp.els.upgradeBar.style.background.includes('201, 164, 107') && sdp.els.upgradeBar.style.background.includes('122, 158, 122'), sdp.els.upgradeBar.style.background);
check('Sand Dunes pulley modal shows the same storage', body().includes('Workers 3') && body().includes('Wood 50'));
check('Sand Dunes modal uses its yellow theme', w.document.querySelector('.modal-win').classList.contains('theme-sanddunes'));
send('sd', 'down', 'workers', 3);
check('Sand Dunes pulley trip needs no crew', /Hoisting/.test(sdp.getStatText()) && sdp.getBillableCount() === 0, sdp.getStatText());
check('Sand Dunes card is named Collapsed Path', sdp.cardName() === 'Collapsed Path');
tick(OW, 305);
check('3 workers lowered into Sand Dunes', OW.SandDunes.workerPool.getTotal() === 3, OW.SandDunes.workerPool.getTotal());
check('storage cannot exceed 200', OW.Pulley.storageHtml().includes('150 free'));

/* ---- Sand Dunes side: digs the same collapse with its own tools ---- */
const openSd = () => sdp.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
openSd();
check('Sand Dunes modal: clearing, then storage, then the pulley', body().indexOf('Clearing the path') < body().indexOf('Pulley storage') && body().indexOf('Pulley storage') < body().indexOf('>Pulley<') && body().includes('999 left') && body().includes('Requires Tier III tools'));
check('storage card carries the 2px-tighter spacing class', !!$('.ps-card'));
OW.Resources.add(OW.SandDunes.ensureResource('tools3', 'Tools III'), 60);
for (let i = 0; i < 3; i++) { const b = $('[data-cp-sub="clear"][data-cp-sub-action="add"]'); b.dispatchEvent(new w.Event('pointerdown')); b.dispatchEvent(new w.Event('pointerup')); }
check('Sand Dunes clearing stepper assigns its own workers', OW.SandDunes.workerPool.getAssigned('sdpulley') === 3);
const mtnTools = OW.Resources.get('mtn_tools3');
tick(OW, 10);
check('Sand Dunes clearers shorten the Mountains count too', cp.getUpgradeBarPct() < 97.5 && /Clearing — 969 left/.test(sdp.getStatText()) && OW.Resources.get('mtn_tools3') === mtnTools, sdp.getStatText());
check('Sand Dunes clearing shows on the Mountains card face too', /Clearing — 969 left/.test(cp.getStatText()), cp.getStatText());
check('each side bills only its own working clearers', sdp.getBillableCount() === 3 && cp.getBillableCount() === 0);
tick(OW, 15);
check('Sand Dunes side stops when its own tools run out', OW.Resources.get('sd_tools3') === 0 && sdp.getStatText() === 'Stopped' && sdp.getBillableCount() === 0, sdp.getStatText());
OW.Save.saveToStorage();
({ w, OW, errors } = boot());
cp = OW.Mechanics.get('collapsedpath'); pool = OW.Mountains.workerPool;
check('shared clearing progress survives reload', errors.length === 0 && cp.renderModalHTML().includes('939 left') && OW.Mechanics.get('sdpulley').renderModalHTML().includes('939 left'));
sdp = OW.Mechanics.get('sdpulley');
pause();
openSd();

/* ---- Clearing: 7 workers on the clear slot wear 1 tool/s each ---- */
open();
check('Sand Dunes theme does not stick to the next modal (Mountains blue again)', !w.document.querySelector('.modal-win').classList.contains('theme-sanddunes') && w.document.querySelector('.modal-win').classList.contains('theme-mountains'));
check('storage sits above the pulley in the Collapsed Path modal', body().indexOf('Pulley storage') < body().indexOf('>Pulley<'));
press('clear', 7);
OW.Resources.add('gold', 5000); // long run above drains upkeep; keep clearing gold-funded
const tools0 = OW.Resources.get('mtn_tools3');
tick(OW, 100);
check('7 clearers wear ~700 tools in 100s', Math.abs(tools0 - OW.Resources.get('mtn_tools3') - 700) <= 2, tools0 - OW.Resources.get('mtn_tools3'));
check('top bar drains as the collapse is dug out (both sides count)', Math.abs(cp.getUpgradeBarPct() - (100 - 100 * (60 + 1000 - OW.Resources.get('mtn_tools3')) / 999)) < 0.5);
tick(OW, 60);
check('path cleared at 999 tools across both sides: card hidden, workers freed, status blank', cp.getStatText() === '' && !cp.revealed && pool.getAssigned('collapsedpath') === 0 && OW.Resources.get('mtn_tools3') === 61, OW.Resources.get('mtn_tools3'));
check('Sand Dunes now a Scout Stable destination', OW.Locations.destinationsFor('mountains').some((l) => l.id === 'sanddunes'));
check('Sand Dunes Collapsed Path card hides too, its clearers freed', !OW.Mechanics.get('sdpulley').revealed && OW.SandDunes.workerPool.getAssigned('sdpulley') === 0 && OW.SandDunes.workerPool.getTotal() === 3);
check('clearing hands all pulley storage to Sand Dunes', OW.Resources.get('sd_wood') === 50 && OW.Pulley.storageHtml().includes('200 free'), OW.Resources.get('sd_wood'));
OW.Save.saveToStorage();
({ w, OW, errors } = boot());
check('cleared state survives reload (both cards stay hidden)', errors.length === 0 && !OW.Mechanics.get('collapsedpath').revealed && !OW.Mechanics.get('sdpulley').revealed && OW.SandDunes.isReachable());

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
