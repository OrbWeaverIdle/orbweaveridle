/* Gold Mine. Boots the real game headless, reveals the card through Loc 2,
   and drives claims through the public surface. Math.random is pinned so
   every bonus is exact: 0 always hits (both tiers), 0.99 never does.
   Covers the dig → search → mine → search loop, payouts per tier, the
   per-claim formulas, the always-present bottom claim, two-click collapse,
   tier switching (header click → face pill + tool spend), tool and gold
   starvation with upkeep, and a save round trip. */
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
const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);
const dig = (OW) => tick(OW, 0.2); // 5 workers × one 0.2s tick = exactly one dig

newStore();
const { w, OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));
const gm = OW.Mechanics.get('goldmine'), D = gm._debug, pool = OW.Mountains.workerPool;
const HR = OW.HiddenRes, R = OW.Resources;
const c1 = () => D.claims()[0];

// ---- Reveal + placement ----
check('starts hidden', gm.revealed === false);
w.document.getElementById('cheat-loc2').click();
check('Loc 2 reveals Gold Mine', gm.revealed === true);
const grid = [...w.document.querySelectorAll('#grid-mountains > .card-wrap')];
check('sits right after Smelter Shack', grid.indexOf(gm.els.wrap) === grid.indexOf(OW.Mechanics.get('smeltershack').els.wrap) + 1);
check('one claim to start, 1000 to dig, face pill II',
  D.claims().length === 1 && c1().pts === 1000 && gm.els.wrap.querySelector('.card-tier-pill').textContent === 'II');

// ---- Formulas ----
const at = (cycles, no = 1) => ({ no, cycles });
check('dig target grows 15% per claim', D.digT(at(0, 2)) === 1150 && D.digT(at(0, 3)) === 1322);
check('search target grows 15% per cycle', D.searchT(at(0)) === 1000 && D.searchT(at(1)) === 1150);
check('vein starts 200, shrinks 4% per cycle, never below 1', D.vein(at(0)) === 200 && D.vein(at(1)) === 192 && D.vein(at(500)) === 1);
check('collapse pays 400 dust per completed vein', D.payout(at(0)) === 0 && D.payout(at(3)) === 1200);

// ---- Dig phase ----
w.Math.random = () => 0.99; // no bonus
for (let i = 0; i < 5; i++) D.subAssign(1);
const tools2 = R.get('mtn_tools2'), gold0 = R.get('gold');
tick(OW, 1);
check('5 workers dig 5 per second', c1().pts === 995, `pts ${c1().pts}`);
check('first dig opens claim #2 below at 1150', D.claims().length === 2 && D.claims()[1].no === 2 && D.claims()[1].pts === 1150);
check('Tier II tools spent per worker-second', tools2 - R.get('mtn_tools2') === 5, `spent ${tools2 - R.get('mtn_tools2')}`);
check('slotted workers pay upkeep', gm.getBillableCount() === 5 && R.get('gold') < gold0);
check('face reads Digging rate', gm.getStatText() === 'Digging 5.00/s', gm.getStatText());
w.Math.random = () => 0; // always bonus
dig(OW);
check('dig bonus removes 100 extra', c1().pts === 894, `pts ${c1().pts}`);

// ---- Search phase ----
c1().pts = 1; dig(OW);
check('reaching 0 moves to Searching at 0', c1().phase === 'search' && c1().pts === 0);
const dust0 = HR.get('golddust');
dig(OW);
check('search dig: +1 +100 bonus, 4 dust (bonus pays no dust)', c1().pts === 101 && HR.get('golddust') - dust0 === 4, `pts ${c1().pts}, dust +${HR.get('golddust') - dust0}`);
c1().pts = 999; dig(OW);
check('search target clamps and strikes a 200 vein', c1().phase === 'mine' && c1().pts === 200);

// ---- Mine phase ----
let n0 = HR.get('nugget');
w.Math.random = () => 0.99; dig(OW);
check('mine dig: 15 nuggets, 1 point', HR.get('nugget') - n0 === 15 && c1().pts === 199);
n0 = HR.get('nugget'); w.Math.random = () => 0; dig(OW);
check('Tier II bonus pays 30 instead, still 1 point', HR.get('nugget') - n0 === 30 && c1().pts === 198);
check('bonus line reads the nuggets', c1().bonus && c1().bonus.text === 'Bonus: 30 nuggets', c1().bonus && c1().bonus.text);
c1().pts = 1; dig(OW);
check('vein out: back to Searching, cycle 1, target 1150', c1().phase === 'search' && c1().cycles === 1 && c1().pts === 0);

// ---- Tier switch through the header ----
for (const t = Date.now(); Date.now() - t < 150;); // clear the ghost-click guard
gm.els.wrap.querySelector('.card').dispatchEvent(new w.Event('click', { bubbles: true }));
const sub = () => w.document.getElementById('card-modal-header-sub');
check('header tip shows before any tier click', /Change tool tier above/.test(sub().textContent) && !!sub().querySelector('.sp-req-msg'));
const strip = w.document.querySelector('#card-modal-body .gm-resbar').textContent;
check('resource strip lists Tools II and Tools III with their counts', /Tools II\s*[\d,]+/.test(strip) && /Tools III\s*[\d,]+/.test(strip), strip);
w.document.querySelector('#card-modal-header-sub [data-gm-tier="3"]').dispatchEvent(new w.Event('click', { bubbles: true }));
check('tier click retires the tip', !/Change tool tier above/.test(sub().textContent));
check('header click selects Tier III: face pill + label', gm.toolTier === 3 && gm.els.wrap.querySelector('.card-tier-pill').textContent === 'III'
  && /Using Tier III tools/.test(w.document.getElementById('card-modal-header-sub').textContent));
check('header shows crossed I and greys the unselected tier', !!w.document.querySelector('#card-modal-header-sub .tier-pip-crossed')
  && w.document.querySelector('[data-gm-tier="2"]').classList.contains('off'));
const t3 = R.get('mtn_tools3'); c1().phase = 'mine'; c1().pts = 50; n0 = HR.get('nugget');
dig(OW);
check('Tier III: tools III spent, bonus pays 180', R.get('mtn_tools3') < t3 && HR.get('nugget') - n0 === 180);
// Header warnings: each just below and at its threshold (search goal 3,000+; vein 120 or less).
const head = () => { OW.Cards.refreshOpenModal('goldmine'); const h = w.document.querySelector('#card-modal-body [data-gm-pts="1"]'); return [h.previousElementSibling.textContent, h.classList.contains('low')]; };
const saved = [c1().phase, c1().cycles, c1().pts];
const at2 = (phase, cycles) => { c1().phase = phase; c1().cycles = cycles; return head(); };
check('search goal 2,660: no warning', JSON.stringify(at2('search', 7)) === '["",false]');
check('search goal 3,059: Longer dig time, red counter', JSON.stringify(at2('search', 8)) === '["Longer dig time",true]');
check('vein 123: no warning', JSON.stringify(at2('mine', 12)) === '["",false]');
check('vein 118: Vein running low, red counter', JSON.stringify(at2('mine', 13)) === '["Vein running low",true]');
[c1().phase, c1().cycles, c1().pts] = saved; OW.Cards.refreshOpenModal('goldmine');
check('modal shows one claim card per claim', w.document.querySelectorAll('#card-modal-body [data-gm-collapse]').length === D.claims().length);

// ---- Starvation ----
R.spend('mtn_tools3', R.get('mtn_tools3'));
const pts0 = c1().pts; tick(OW, 1);
const rateLine = () => w.document.querySelector('#card-modal-body [data-gm-rate="1"]').textContent;
check('no tools: face and claim give the reason, no digging, no upkeep', gm.getStatText() === 'Stopped – no tools'
  && rateLine() === 'Stopped — needs Tier III tools.' && c1().pts === pts0 && !gm.isBillable(), `${gm.getStatText()} | ${rateLine()}`);
R.add('mtn_tools3', 100); R.spend('gold', R.get('gold')); tick(OW, 1);
check('no gold: face and claim give the reason, no digging', gm.getStatText() === 'Stopped – no gold' && rateLine() === 'Stopped — needs gold.' && c1().pts === pts0);
R.add('gold', 1000);

// ---- Collapse (two clicks through the real buttons) ----
const btn = (no) => w.document.querySelector(`#card-modal-body [data-gm-collapse="${no}"]`);
const click = (el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
check('a claim still digging cannot collapse', btn(2).disabled && (D.collapse(2), D.collapse(2), D.claims().some((c) => c.no === 2)));
c1().cycles = 2; OW.Cards.refreshOpenModal('goldmine');
const dust1 = HR.get('golddust'), assigned = pool.getAssigned('goldmine');
check('payout and button share one chip: +800 Gold Dust', btn(1).parentElement.classList.contains('gm-chip') && /\+800 Gold Dust/.test(btn(1).parentElement.textContent));
click(btn(1));
check('first click arms: Confirm?, nothing paid', btn(1).textContent === 'Confirm?' && btn(1).classList.contains('confirm') && HR.get('golddust') === dust1);
click(w.document.getElementById('card-modal-body'));
check('a click elsewhere disarms', btn(1).textContent === 'Collapse');
click(btn(1)); click(btn(1));
check('second click collapses for 400 dust per vein', HR.get('golddust') - dust1 === 800 && !btn(1));
check('collapsed claim gone; its workers stay on the card unslotted and unbilled',
  !D.claims().some((c) => c.no === 1) && pool.getAssigned('goldmine') === assigned && gm.getBillableCount() === 0);

// ---- Save round trip ----
D.subAssign(2); D.claims()[0].pts = 700;
STORE.setItem('orbweaver.save.v1', OW.Save.encode(OW.Save.serialize()));
const B = boot(), gm2 = B.OW.Mechanics.get('goldmine'), c2 = gm2._debug.claims();
check('reload: tier, claims, phase, points and workers restored',
  B.errors.length === 0 && gm2.toolTier === 3 && c2.length === 1 && c2[0].no === 2 && c2[0].pts === 700 && c2[0].workers === 1,
  B.errors.join('; ') || JSON.stringify(c2.map((c) => [c.no, c.phase, c.pts, c.workers])));
check('reload: tip stays retired', !/Change tool tier above/.test(gm2.getSubtitleHtml()));
check('reload: face pill matches the saved tier', gm2.els.wrap.querySelector('.card-tier-pill').textContent === 'III');

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
