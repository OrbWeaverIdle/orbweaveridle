/* Scout Stable tabs and the Mine cheat. Boots the real game headless:
   Mine reveals only Gold Mine; the Scout Stable always opens on Resupply,
   which is shown dimmed and inert under a message until a destination
   exists; the Expedition tab's requirements box live-patches its
   Workers count (red while short, capped at 5/5). */
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
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) }); // jsdom has no canvas
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
const $ = (sel) => w.document.querySelector('#card-modal-body ' + sel);
const click = (el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
const pause = () => { const t0 = Date.now(); while (Date.now() - t0 < 150); };
const M = (id) => OW.Mechanics.get(id);
const SP = M('scoutspen');
const open = () => { OW.Cards.closeModal(); pause(); click(SP.els.wrap.firstElementChild); };

// Mine cheat: reveals Gold Mine only.
const before = OW.Mechanics.all().filter((m) => m.revealed).map((m) => m.id).join();
check('Gold Mine starts hidden', !M('goldmine').revealed);
click(w.document.getElementById('cheat-mine'));
check('Mine reveals Gold Mine', M('goldmine').revealed);
check('Mine reveals nothing else', OW.Mechanics.all().filter((m) => m.revealed && m.id !== 'goldmine').map((m) => m.id).join() === before);
check('Mine button sits right after Loc 2', w.document.getElementById('cheat-loc2').nextElementSibling.id === 'cheat-mine');

// Resupply default with no destinations: message, full tab dimmed and inert.
OW.Cards.reveal(SP);
open();
check('first open lands on Resupply', $('.sp-tab.active') && $('.sp-tab.active').dataset.spTab === 'resupply');
check('no-destination message text', $('.sp-no-dest') && $('.sp-no-dest').textContent === 'No discovered destinations. Use Expedition tab');
const locked = $('.sp-locked');
check('Add Station price names Gold bars', /^\d+ Gold bars$/.test($('[data-sp-add-station]').textContent));
check('stations render inside an inert wrapper', locked && locked.hasAttribute('inert') && locked.querySelectorAll('.sp-vehicle-col').length === 4 && locked.querySelector('.sp-add'));

// Expedition tab layout and live worker count.
click($('[data-sp-tab="expedition"]'));
check('Expedition card title, no pill', $('.hs-title').textContent === 'Expedition Mule' && !$('.card-tier-pill'));
check('old requirement banner gone', !$('.sp-req-msg'));
const wk = () => $('[data-sp-exp-workers]');
while (OW.Workers.getIdleCount() > 2) OW.Workers.assign('wood'); // leave 2 idle
SP.patchLiveTrack();
check('Workers row reads idle/5 and is red when short', wk().textContent === '2/5' && wk().querySelector('.sp-short'));
check('Wood row reads target', /Wood loaded on prep\s*200/.test($('.sp-req-box').textContent));
OW.Workers.addWorkers(3); // 2 idle + 3 = 5
SP.patchLiveTrack();
check('Workers row live-patches to 5/5 in normal color', wk().textContent === '5/5' && !wk().querySelector('.sp-short'));
OW.Workers.addWorkers(3);
SP.patchLiveTrack();
check('Workers count caps at 5/5', wk().textContent === '5/5');
click($('[data-sp-action="prepare-mule"]'));
check('Prepare Mule starts preparing', M('expeditionmule').revealed);
open();
check('reopen during prep still lands on Resupply', $('.sp-tab.active').dataset.spTab === 'resupply');
click($('[data-sp-tab="expedition"]'));
check('Expedition tab shows Academy message while away', /Visit Academy/.test($('.sp-tab-greyed').textContent));

// Once a destination exists the Resupply tab is live.
OW.Mountains.reveal();
open();
check('with a destination: no message, no inert wrapper', !$('.sp-no-dest') && !$('.sp-locked') && $('.sp-vehicle-col'));

// Save no longer carries the tab fields.
const sp = OW.Save.serialize().mechanics.scoutspen;
check('save blob has no eo/tab fields', sp && !('eo' in sp) && !('tab' in sp));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
