/* Sub-steppers. Every card whose modal splits its workers into
   sub-steppers, driven through its real buttons: card-face + puts a new
   idle worker into the topmost sub-stepper, then into whichever one was
   last added to (falling back to the topmost once that one is gone); a
   modal − returns the worker to idle; and every worker on the card
   stays visible in some sub-stepper's live count. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window, d = {};
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }, configurable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 6 }) }); // jsdom has no canvas
  w.performance = { now: () => Date.now() };
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => { try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); } catch (e) { errors.push(`${src}: ${e.message}`); } });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, errors };
}

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

const mtn = (OW) => { OW.Mountains.reveal(); OW.Mountains.addWorkers(20); };
const sub = (attr, act) => (k, a) => `[${attr}="${k}"][${act}="${a === 'add' ? 'add' : 'remove'}"]`;
const pair = (plus, minus) => (k, a) => `[${a === 'add' ? plus : minus}="${k}"]`;
// id, setup (makes the sub-steppers exist), button selector (k, 'add'|'remove'), count selector.
const CARDS = [
  ['toolshed', (OW) => OW.Workers.addWorkers(20), pair('data-ts-plus', 'data-ts-minus'), (k) => `[data-ts-val="${k}"]`],
  ['goldpanning', mtn, sub('data-gp-sub', 'data-gp-act'), (k) => `[data-gp-val="${k}"]`],
  ['goldmine', mtn, sub('data-gm-sub', 'data-gm-act'), (k) => `[data-gm-val="${k}"]`],
  ['wheatfieldcard', mtn, sub('data-wf-sub', 'data-wf-sub-action'), (k) => `[data-wf-sub-val="${k}"]`],
  ['digsite', (OW) => { OW.Workers.addWorkers(20); OW.DigSite.completeIntro(); }, pair('data-ds-plus', 'data-ds-minus'), (k) => `[data-ds-count="${k}"]`],
  ['marketstall', (OW) => { OW.Workers.addWorkers(20); OW.Resources.reveal('stone'); },
    (k, a) => `[data-ms-step="w"][data-ms-row="${k}"][data-ms-dir="${a === 'add' ? 1 : -1}"]`, (k) => `[data-ms-val="w-${k}"]`],
  ['smeltershack', mtn, (k, a) => `[data-sm-${a === 'add' ? 'plus' : 'minus'}="${k.split('|').slice(0, 2).join(':')}"]`, (k) => `[data-sm-val="${k.split('|').slice(0, 2).join(':')}"]`],
  ['mountains', (OW) => { mtn(OW); OW.Upgrades.getTrack('mountains:stage').completeAll(); }, sub('data-mtn-sub', 'data-mtn-sub-action'), (k) => `[data-mtn-sub-val="${k}"]`],
  ['collapsedpath', mtn, sub('data-cp-sub', 'data-cp-sub-action'), (k) => `[data-cp-sub-val="${k}"]`],
  ['sdpulley', (OW) => OW.Locations.get('sanddunes').addWorkers(20), sub('data-cp-sub', 'data-cp-sub-action'), (k) => `[data-cp-sub-val="${k}"]`]
];

CARDS.forEach(([id, setup, btnSel, valSel]) => {
  const { w, OW, errors } = boot();
  const m = OW.Mechanics.get(id), pool = m.workerPool || OW.Workers;
  OW.Cards.reveal(m);
  setup(OW);
  for (const t = Date.now(); Date.now() - t < 150;); // clear cards.js's post-close ghost-click guard
  m.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
  const $ = (s) => w.document.querySelector(`#card-modal-body ${s}`);
  const tap = (el) => { el.dispatchEvent(new w.Event('pointerdown')); el.dispatchEvent(new w.Event('pointerup')); };
  const facePlus = () => tap(m.els.wrap.querySelector('.stepper-plus'));
  const val = (k) => +$(valSel(k)).textContent;
  const ks = m.subSlots(), top = ks[0], last = ks[ks.length - 1];
  const shown = () => ks.reduce((n, k) => n + val(k), 0);

  check(`${id}: boots, opens, lists visible sub-steppers [${ks.join(', ')}]`, errors.length === 0 && ks.length && ks.every((k) => $(valSel(k))), errors.join('; '));
  facePlus();
  check(`${id}: card + with nothing added yet fills the topmost`, pool.getAssigned(id) === 1 && val(top) === 1);
  tap($(btnSel(last, 'add')));
  facePlus();
  check(`${id}: card + follows the last sub-stepper added to`, pool.getAssigned(id) === 3 && val(last) === (last === top ? 3 : 2));
  const idle = pool.getIdleCount();
  tap($(btnSel(last, 'remove')));
  check(`${id}: modal − returns the worker to idle`, pool.getAssigned(id) === 2 && pool.getIdleCount() === idle + 1 && val(last) === (last === top ? 2 : 1));
  m.lastSub = '__gone__';
  const topBefore = val(top);
  facePlus();
  check(`${id}: a stale last-added falls back to the topmost`, val(top) === topBefore + 1);
  check(`${id}: every card worker is visible in a sub-stepper`, shown() === pool.getAssigned(id), `${shown()} shown vs ${pool.getAssigned(id)} assigned`);
});

// Safety net: any card whose modal renders steppers must opt in via
// subSlots (js/core/cards.js), or card + / modal − silently keep the old
// behavior. ALL v2 reveals every card; EXEMPT lists modals whose steppers
// aren't worker sub-steppers.
const EXEMPT = { scoutspen: 'cargo quantities', mtn_scoutstable: 'cargo quantities' };
{
  const { w, OW } = boot();
  w.document.getElementById('cheat-all-v2').click();
  const missing = OW.Mechanics.all().filter((m) => m.renderModalHTML && !m.subSlots && !EXEMPT[m.id]
    && /card-stepper-btn/.test(m.renderModalHTML() || '')).map((m) => m.id);
  check('every card with modal steppers opts in to sub-stepper routing', missing.length === 0, `missing subSlots: ${missing.join(', ')}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
