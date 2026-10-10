/* Resource rates (js/core/rates.js). Boots the real game headless and
   checks the rail's measured rates: accuracy against a known producer,
   the three units, Worker wages, clicks/cheats ignored, crate merge,
   cap "Full" (+ usage), whole-number hint, pause/gold-starved freeze, the
   in-band breakdown, offline reset, display prefs, band striping, the
   /s lump average, the /min and /hr long average (cycles, on/off, wages,
   dice, rare finds, Full stores, worker-change restarts, steady changes, the
   1% redraw rule), Gold Panning and Dig Site expected rates on /min and /hr,
   and Scout Stable's auto-mule hint. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

const STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window, doc = w.document;
Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
w.requestAnimationFrame = () => 0;
w.performance = { now: () => Date.now() };
const errors = [];
w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
SCRIPTS.forEach((src) => {
  try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); } catch (e) { errors.push(`${src}: ${e.message}`); }
});
doc.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
const OW = w.OrbWeaver, R = OW.Resources, Rates = OW.Rates;
OW.Loop.stop();

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}
const entry = (id) => R.all().find((r) => r.id === id);
const rateText = (id) => entry(id).rateEl.textContent;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
// runBulk drives Loop.step(), the only place moves are recorded. Starts
// the loop first (isFrozen reads it) and stops it again afterwards.
function play(s) { OW.Loop.start(); OW.Loop.runBulk(Math.round(s / 0.2), 0.2); OW.Loop.stop(); OW.Loop.start(); }
const num = (t) => parseFloat(t.replace(/[^0-9.\-−]/g, '').replace('−', '-'));

check('game boots with no script errors', errors.length === 0, errors.join('\n        '));

/* ---- New game: Wood hidden until first gained; Gold never "Full" ---- */
check('Wood starts hidden on a new game', R.isHidden('wood'));
Rates.render();
check('Gold at cap with nothing moving shows no "Full"', rateText('gold') === '' && R.isAtCap('gold'), rateText('gold'));

/* ---- Accuracy: one Wood worker at baseline = 1.84 wood/s ---- */
OW.Workers.assign('wood');
play(10);
check('measured Wood rate matches the card (1.84/s)', near(Rates.perSecond('wood'), 1.84, 1e-6), Rates.perSecond('wood'));
check('Wood reveals itself on its first gain', !R.isHidden('wood'));
check('rail shows +1.8/s in green', rateText('wood') === '+1.8/s' && !entry('wood').rateEl.classList.contains('neg'), rateText('wood'));
check('Gold shows Worker wages as a whole-number loss', rateText('gold') === '−1/s' && entry('gold').rateEl.classList.contains('neg'), rateText('gold'));

/* ---- Units ---- */
doc.querySelector('#settings-modal-win [data-rate-unit="1"]').click();
check('/min unit = 60s window (110.4/min)', rateText('wood') === '+110.4/min', rateText('wood'));
doc.querySelector('#settings-modal-win [data-rate-unit="2"]').click();
check('/hr unit extrapolates the partial hour (6,624/hr)', near(num(rateText('wood')), 6624, 0.1) && rateText('wood').endsWith('/hr'), rateText('wood'));
check('unit persists in display prefs, not the save', JSON.parse(STORE.getItem('orbweaver.display.v1')).rateUnit === 2);
doc.querySelector('.side-label').click();
check('a click elsewhere leaves the unit alone', doc.body.dataset.rates === '2');
doc.querySelector('#rail-unit [data-rate-unit="0"]').click();
check('rail pill sets the unit too', doc.body.dataset.rates === '0' && rateText('wood') === '+1.8/s', rateText('wood'));
doc.getElementById('rate-rail-toggle').click();
check('Add to resources toggles the rail pill', doc.body.classList.contains('rate-rail') && JSON.parse(STORE.getItem('orbweaver.display.v1')).rateRail === 1);

/* ---- Clicks and cheats are not flows ---- */
doc.getElementById('cheat-wood').click();
play(1);
check('a cheat +100 does not move the rate', near(Rates.perSecond('wood'), 1.84, 1e-6), Rates.perSecond('wood'));

/* ---- Crate merge: crate moves count toward the parent ---- */
R.ensureCrate('wood');
Rates.setSource('test'); R.add('woodcrate', 10); Rates.setSource(null); play(1);   // 2 lumps 1s apart: 1/s
Rates.setSource('test'); R.add('woodcrate', 1); Rates.setSource(null); play(1);
check('crate moves land in the parent ledger', Rates.perSecond('woodcrate') === 0 && near(Rates.perSecond('wood'), 1.84 + 1, 1e-6), Rates.perSecond('wood'));
check('crate row has no rate line of its own', entry('woodcrate').rateEl.textContent === '');

/* ---- Whole-number hint ---- */
Rates.setSource('test'); R.add('tools2', 1); Rates.setSource(null); play(5);       // 2 lumps 5s apart: 0.2/s
Rates.setSource('test'); R.add('tools2', 1); Rates.setSource(null); play(1);
check('whole-number resource under 1/s reads <1/s (hint)', rateText('tools2') === '<1/s' && entry('tools2').rateEl.classList.contains('hint'), rateText('tools2'));

/* ---- Cap reads "Full" ---- */
R.setRaw('wood', R.getCap('wood'));
play(10);
check('at cap with nothing draining reads grey "Full"', rateText('wood') === 'Full' && entry('wood').rateEl.classList.contains('grey'), rateText('wood'));

/* ---- Breakdown expands in the band ---- */
R.setRaw('wood', 0);
play(10);
const band = entry('wood').wrap;
band.querySelector('.res-name').click();
const bd = band.querySelector('.res-breakdown');
const labels = bd ? Array.from(bd.querySelectorAll('.rb-row span:first-child')).map((s) => s.textContent) : [];
check('click expands a breakdown inside the band', band.classList.contains('open') && !!bd);
check('breakdown lists the source by card name, then an unlabeled total row', labels[0] === 'Wood' && labels[labels.length - 1] === '' && bd.lastElementChild.classList.contains('rb-net'), labels.join(','));
doc.querySelector('#left-hand .res-band').click(); // Gold
const gl = Array.from(entry('gold').wrap.querySelectorAll('.rb-row span:first-child')).map((s) => s.textContent);
check('Gold breakdown names Worker wages', gl.includes('Worker wages'), gl.join(','));

/* ---- Freeze: paused, then gold-starved ---- */
const before = rateText('wood');
OW.Loop.stop(); Rates.render();
check('paused greys and freezes the rate', band.classList.contains('frozen') && rateText('wood') === before && bd.querySelector('.rb-state').textContent === 'Paused');
OW.Loop.start(); Rates.render();
check('resuming un-greys', !band.classList.contains('frozen'));
R.setRaw('gold', 0); Rates.render();
check('gold-starved greys and tags "Stopped — no gold"', band.classList.contains('frozen') && band.querySelector('.rb-state').textContent === 'Stopped — no gold');
R.setRaw('gold', 5000);
band.querySelector('.res-name').click();
check('second click collapses and removes the breakdown', !band.classList.contains('open') && !band.querySelector('.res-breakdown'));

/* ---- Offline reset ---- */
Rates.reset();
check('reset clears every window', Rates.perSecond('wood') === 0 && rateText('wood') === '');

/* ---- Striping: visible bands alternate, hidden ones don't count ---- */
const stripes = () => Array.from(doc.querySelectorAll('#left-hand-real-resources > .res-band')).filter((b) => b.style.display !== 'none');
const ok = () => stripes().every((b, i) => b.classList.contains('alt') === (i % 2 === 1));
check('visible bands alternate', ok());
R.reveal('stone');
check('alternation recomputes after a reveal', ok());

/* ---- Steady sources read instantly; stopping drops to 0 at once ---- */
Rates.reset();
R.setRaw('wood', 0);
play(1);
const one = Rates.perSecond('wood');
OW.Workers.assign('wood'); OW.Workers.assign('wood');                // 1 -> 3 workers
play(0.4);
const three = OW.Upgrades.workerRate(3, 1, 1, 0) * 1.84;
check('adding workers shows the new true rate within 2 ticks', near(Rates.perSecond('wood'), three, 1e-6) && three > one, `${Rates.perSecond('wood')} vs ${three}`);
OW.Workers.recallAll ? OW.Workers.recallAll() : ['wood', 'wood', 'wood'].forEach((id) => OW.Workers.unassign(id));
play(1);
check('removing every worker drops the rate to 0 within 1s', Rates.perSecond('wood') === 0 && rateText('wood') === '', Rates.perSecond('wood'));

/* ---- A steady source flipping tick to tick holds its 1s peak ---- */
Rates.reset();
R.setRaw('gold', 1000);
const flip = []; Rates.setSource('upkeep');
for (let i = 0; i < 20; i++) { R.spend('gold', i % 2 ? 0.6 : 1); Rates.tick(0.2); flip.push(Rates.perSecond('gold')); }
Rates.setSource(null);
check('wages flipping between two sums read one steady peak', flip.slice(2).every((v) => near(v, -5)), flip.join(','));
Rates.setSource('upkeep');
for (let i = 0; i < 10; i++) { R.spend('gold', 0.6); Rates.tick(0.2); }
Rates.setSource(null);
check('a real drop shows once the 1s hold passes', near(Rates.perSecond('gold'), -3), Rates.perSecond('gold'));

/* ---- Bursty sources: 10-minute lump average ---- */
Rates.reset();
Rates.setSource('test');
for (let i = 0; i < 50; i++) { if (i % 5 === 0) R.add('stone', 1); Rates.tick(0.2); }
Rates.setSource(null);
check('a source moving one tick in five is averaged (1/s), not instant', near(Rates.perSecond('stone'), 1, 1e-6), Rates.perSecond('stone'));
doc.querySelector('#settings-modal-win [data-rate-unit="2"]').click();
check('/hr is the same average ×3,600 from the start (no early overshoot)', rateText('stone') === '+3,600.0/hr', rateText('stone'));
doc.querySelector('#settings-modal-win [data-rate-unit="0"]').click();
const lump = (id, amt) => { Rates.setSource('test'); R.add(id, amt); Rates.setSource(null); };
const idle = (s) => { for (let i = 0; i < Math.round(s / 0.2); i++) Rates.tick(0.2); };
Rates.reset(); R.setRaw('stone', 0);
lump('stone', 50); idle(1);
check('a single lump reads nothing yet', Rates.perSecond('stone') === 0 && rateText('stone') === '', rateText('stone'));
idle(9); lump('stone', 50); idle(1);
check('a 2nd lump 10s later reads 50 ÷ 10s = 5/s, holding between lumps', near(Rates.perSecond('stone'), 5), Rates.perSecond('stone'));
idle(15);
check('…still 5/s within twice the usual gap', near(Rates.perSecond('stone'), 5), Rates.perSecond('stone'));
idle(5);
check('…drops to 0 after more than twice the usual gap', Rates.perSecond('stone') === 0, Rates.perSecond('stone'));
Rates.reset(); R.setRaw('stone', 0);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let hits = 0, firstHit = -1, lastHit = 0, rolled = 0;
for (let i = 0; i < 3000; i++) { if (rnd() < 0.05) { lump('stone', 4); if (firstHit < 0) firstHit = i; else rolled += 4; lastHit = i; hits++; } Rates.tick(0.2); }
const expect = rolled / ((lastHit - firstHit) * 0.2);
check('random rolls read their measured average over 10 min (~1/s)', near(Rates.perSecond('stone'), expect, 1e-6) && Math.abs(expect - 1) < 0.3, `${Rates.perSecond('stone')} vs ${expect}, ${hits} hits`);

/* ---- rateExcluded: Gold Panning listed but not totalled ---- */
Rates.reset();
R.setRaw('gold', 1000);
Rates.setSource('goldpanning');
for (let i = 0; i < 10; i++) { R.add('gold', 5); Rates.tick(0.2); }
Rates.setSource(null);
const gb = entry('gold').wrap;
if (!gb.classList.contains('open')) gb.querySelector('.res-name').click();
Rates.render();
const ex = gb.querySelector('.rb-excl');
check('Gold Panning is left out of Gold\'s rail total', rateText('gold') === '', rateText('gold'));
check('…but listed greyed in the breakdown, after Net', !!ex && ex.textContent.startsWith('Gold Panning (not in total)') && ex.previousElementSibling.classList.contains('rb-net'), ex && ex.textContent);

/* ---- Gold leads the Camp rail, above Workers ---- */
const first = doc.getElementById('left-hand-real-resources').children;
check('Gold sits above Workers', first[0] === gb && first[1].classList.contains('worker-row'));

/* ---- Market Stall: Gold shows the card-face g/s, not lumpy payouts ---- */
Rates.reset();
OW.Workers.addWorkers(10);
R.setRaw('wood', 500); R.setRaw('gold', 1000);
const MS = OW.MarketStall, msMech = OW.Mechanics.get('marketstall');
MS.subAssign('wood'); MS._rows.wood.qty = 100; msMech.onOpen(); MS.startSale('wood');
doc.querySelector('#settings-modal-win [data-rate-unit="2"]').click();   // /hr so g/s reads as a whole number
const gps = msMech.rateFor('gold');
check('Gold rail matches the Market Stall card face', gps > 0 && msMech.getStatText() === `+${gps.toFixed(2)} g/s` && num(rateText('gold')) === Math.round(gps * 3600), `${rateText('gold')} vs card ${msMech.getStatText()}`);
const msRow = Array.from(entry('gold').wrap.querySelectorAll('.rb-row span:first-child')).map((s) => s.textContent);
check('Gold breakdown lists Market Stall', msRow.includes('Market Stall'), msRow.join(','));
MS.cancelSale('wood');
doc.querySelector('#settings-modal-win [data-rate-unit="0"]').click();

/* ---- Income and consumption netting to zero still show ---- */
Rates.reset();
R.setRaw('stone', 10);
for (let i = 0; i < 3; i++) {
  Rates.setSource('a'); R.add('stone', 1);
  Rates.setSource('b'); R.spend('stone', 1);
  Rates.setSource(null); Rates.tick(0.2);
}
check('net 0 with activity shows 0.0/s in neutral', rateText('stone') === '0.0/s' && entry('stone').rateEl.classList.contains('zero'), rateText('stone'));

/* ---- Sticky "Full": a capped store churned tick by tick doesn't flash ---- */
Rates.reset();
const cap = R.getCap('stone');
R.setRaw('stone', cap);
const churn = (n, take) => { const seen = []; for (let i = 0; i < n; i++) {
  Rates.setSource('a'); R.add('stone', 1);
  Rates.setSource('b'); R.spend('stone', take);
  Rates.setSource(null); Rates.tick(0.2); seen.push(rateText('stone'));
} return seen; };
const held = churn(10, 0.5);
check('capped store drained and refilled reads "Full" every tick', held.every((t) => t.startsWith('Full')), held.join(','));
check('…with what is using it: "Full < 2.5/s"', held.slice(2).every((t) => t === 'Full < 2.5/s') && entry('stone').rateEl.classList.contains('grey'), held.join(','));
churn(20, 3);                                              // real drain: 4s below cap
check('a real drain turns red once 3s off the cap', rateText('stone').startsWith('−') && entry('stone').rateEl.classList.contains('neg'), rateText('stone'));

/* ---- Amount holds at cap for 1s after each touch ---- */
const val = () => entry('stone').valEl.textContent;
const stoneCap = R.getCap('stone'), CAPTXT = `${stoneCap}/${stoneCap}`;
R.setRaw('stone', stoneCap);
const amt = [];
for (let i = 0; i < 14; i++) {                             // used, then topped up to cap every 3rd tick (last at i=11)
  R.spend('stone', 0.7); if (i % 3 === 2) R.add('stone', 5);
  R.clock(0.2); amt.push(val());
}
check('a capped amount being used and topped up reads steady at cap', amt.every((t) => t === CAPTXT), amt.join(','));
R.clock(0.2);
check('…still held 0.8s after the last touch', val() === CAPTXT, val());
R.clock(0.2); R.clock(0.2);
check('…shows the real amount once 1s passes', val() !== CAPTXT && R.get('stone') < stoneCap, val());

/* ---- /min and /hr: long average per source (/s keeps its own method) ---- */
const unitTo = (u) => doc.querySelector(`#settings-modal-win [data-rate-unit="${u}"]`).click();
// Feed source `src` into `res` for `secs`: amt(k) per tick k (k counts from 0 for this call); a negative amount spends.
const feed = (src, res, secs, amt) => { for (let k = 0; k < Math.round(secs / 0.2); k++) {
  const a = amt(k); Rates.setSource(src);
  if (a > 0) R.add(res, a); else if (a < 0) R.spend(res, -a);
  Rates.setSource(null); Rates.tick(0.2);
} };
const hr = (res, src) => { unitTo(2); const v = Rates.perSecond(res, src); unitTo(0); return v; };
const ps = (res, src) => { unitTo(0); return Rates.perSecond(res, src); };
Rates.reset(); R.setRaw('researchpapers', 0); R.setRaw('gold', 1e6);
let cyc = 0; feed('fast', 'researchpapers', 120, () => { cyc += 0.2; if (cyc >= 0.3 - 1e-9) { cyc -= 0.3; return 1; } return 0; });
check('/hr: a 0.3s cycle reads its true 3.33/s', near(hr('researchpapers', 'fast'), 1 / 0.3, 0.02), hr('researchpapers', 'fast'));
check('/s keeps its own method: the same cycle shows its peak tick (5/s)', near(ps('researchpapers', 'fast'), 5), ps('researchpapers', 'fast'));
const loadRun = [];
feed('load', 'gold', 600, (k) => (k % 85 < 10 ? -10 : 0));                // 10 ticks loading, 75 travelling
for (let i = 0; i < 85; i++) { feed('load', 'gold', 0.2, () => ((600 / 0.2 + i) % 85 < 10 ? -10 : 0)); loadRun.push(hr('gold', 'load')); }
check('/hr: load-then-travel reads its whole-cycle average (−100 per 17s), never 0 between loads', loadRun.every((v) => near(v, -100 / 17, 1e-6)), loadRun.slice(0, 12).join(','));
feed('onoff', 'researchpapers', 300, (k) => (k % 300 < 150 ? 0.4 : 0));       // 30s on at 2/s, 30s off
const onoff = []; for (let i = 0; i < 60; i++) { feed('onoff', 'researchpapers', 1, (k) => ((1500 + i * 5 + k) % 300 < 150 ? 0.4 : 0)); onoff.push(hr('researchpapers', 'onoff')); }
check('/hr: a source on 30s / off 30s reads 1/s through both halves', onoff.every((v) => near(v, 1, 1e-6)), onoff.slice(0, 8).join(','));
feed('flip', 'gold', 30, (k) => (k % 2 ? -1 : -0.6));
check('/hr: wages flipping between two sums read their average (−4/s)', near(hr('gold', 'flip'), -4, 0.01), hr('gold', 'flip'));
feed('upkeep', 'gold', 120, (k) => (Math.floor(k / 50) % 2 ? -1 : -0.6));        // wages: 10s at −3/s, 10s at −5/s
const blips = []; for (let i = 0; i < 40; i++) { feed('upkeep', 'gold', 1, (k) => (Math.floor((600 + i * 5 + k) / 50) % 2 ? -1 : -0.6)); blips.push(hr('gold', 'upkeep')); }
check('/hr: wages changing in 10s blips stay within 10% of their −4/s average', blips.every((v) => Math.abs(v + 4) < 0.4), blips.map((v) => v.toFixed(2)).join(','));
let sd = 9; const roll = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
feed('dice', 'researchpapers', 600, () => (roll() < 0.3 ? 4 : 0));
check('/hr: dice (30% a tick, ×4) read within 10% of their true 6/s', Math.abs(hr('researchpapers', 'dice') - 6) < 0.6, hr('researchpapers', 'dice'));
feed('rare', 'researchpapers', 600, (k) => (k % 100 === 0 ? 1 : 0));          // 1 per 20s for 10 min…
feed('rare', 'researchpapers', 600, (k) => (k % 200 === 0 ? 1 : 0));          // …then 1 per 40s
check('/hr: rare finds remember up to 30 min (≈1 per 27s over both halves, not the last 10 min\'s 1 per 40s)', Math.abs(hr('researchpapers', 'rare') - 1 / 26.7) < 0.003, hr('researchpapers', 'rare'));
feed('quiet', 'researchpapers', 60, (k) => (k % 25 === 0 ? 1 : 0)); feed('quiet', 'researchpapers', 4, () => 0);   // last find 9s ago, longest gap 5s
check('/hr: a source quiet under twice its longest gap still reads', hr('researchpapers', 'quiet') > 0);
feed('quiet', 'researchpapers', 2, () => 0);
check('…and reads 0 past it', hr('researchpapers', 'quiet') === 0, hr('researchpapers', 'quiet'));

/* Full store: refills don't drag the producer down */
Rates.reset(); R.setRaw('stone', 0);
const both = (secs) => { for (let k = 0; k < Math.round(secs / 0.2); k++) { Rates.setSource('prod'); R.add('stone', 1); Rates.setSource('use'); R.spend('stone', 0.5); Rates.setSource(null); Rates.tick(0.2); } };
both(30);
R.setRaw('stone', R.getCap('stone')); both(120);                                      // Full: prod only refills 0.5 a tick
R.setRaw('stone', 0); both(5);
check('/hr: a producer keeps its true 5/s after a spell at a Full store', near(hr('stone', 'prod'), 5), hr('stone', 'prod'));

/* Worker changes restart a card's history; the old number shows until the new one is ready */
Rates.reset(); R.setRaw('researchpapers', 0);
OW.Workers.addWorkers(2);
feed('ratecard', 'researchpapers', 600, (k) => (k % 40 === 39 ? 5 : 0));      // 5 per 8s
OW.Workers.assign('ratecard');
feed('ratecard', 'researchpapers', 1, (k) => (k % 40 === 39 ? 7.5 : 0));
check('after a worker change the old /hr shows until new numbers are ready', near(hr('researchpapers', 'ratecard'), 5 / 8), hr('researchpapers', 'ratecard'));
feed('ratecard', 'researchpapers', 24, (k) => ((k + 5) % 40 === 39 ? 7.5 : 0));
check('…then the new rate shows exactly within ~3 cycles (7.5 per 8s)', near(hr('researchpapers', 'ratecard'), 7.5 / 8), hr('researchpapers', 'ratecard'));
OW.Workers.unassign('ratecard');
feed('steady', 'researchpapers', 120, () => 0.368);
feed('steady', 'researchpapers', 1.2, () => 0.552);
check('/hr: a steady source that changes amount (an upgrade) shows the new rate within 1s', near(hr('researchpapers', 'steady'), 2.76), hr('researchpapers', 'steady'));

/* 1% redraw rule on /min and /hr */
Rates.reset(); R.setRaw('researchpapers', 0);
feed('jit', 'researchpapers', 60, (k) => (k % 2 ? 0.2 : 0.21));
unitTo(2); Rates.render(); const before1 = rateText('researchpapers');
feed('jit', 'researchpapers', 20, (k) => (k % 2 ? 0.2 * 1.005 : 0.21 * 1.005));
Rates.render(); const small = rateText('researchpapers');
feed('jit', 'researchpapers', 60, (k) => (k % 2 ? 0.2 * 1.05 : 0.21 * 1.05));
Rates.render(); const big = rateText('researchpapers'); unitTo(0);
check('/hr line holds through a 0.5% move', small === before1, `${before1} → ${small}`);
check('…and redraws once it moves 1% or more', big !== before1, `${before1} → ${big}`);

/* ---- Scout Stable: an auto mule hints cargo ÷ (load + travel) until 2 arrivals ---- */
Rates.reset();
doc.getElementById('cheat-loc2').click();
R.setRaw('gold', 1e6); R.setRaw('wood', 0); R.setRaw('mtn_wood', 0);   // room at the destination
const pen = () => OW.Save.serialize().mechanics.scoutspen;
const setPlan = (auto) => { const d = pen(); d.plans.mule[0] = { dest: 'mountains', items: [{ res: 'wood', qty: 20 }] }; d.runs.mule[0].a = auto ? 1 : 0; OW.Save.deserialize(Object.assign(OW.Save.serialize(), { mechanics: Object.assign(OW.Save.serialize().mechanics, { scoutspen: d }) })); };
const act = (a) => { const b = doc.createElement('button'); Object.assign(b.dataset, { spAction: a, spLoc: 'camp', spKind: 'mule', spIdx: '0' }); doc.body.appendChild(b); b.click(); b.remove(); };
const camp = OW.Workers.getPools().camp;
while (camp.getIdleCount() > 0) camp.assign('scoutspen');
const mule = OW.Mechanics.get('resupplymule1'), hint = () => mule.rateHint('mtn_wood'), muleRate = () => Rates.perSecond('mtn_wood', 'resupplymule1');
const phase = () => pen().runs.mule[0].p;
const stepUntil = (pred) => { let t = 0; for (let i = 0; i < 1000 && !pred(); i++) { OW.Loop.runBulk(1, 0.2); t += 0.2; } return t; };
// Dispatch, run out of Wood for 1s mid-load (load time is measured, not assumed), return seconds spent loading.
function loadTrip(auto) {
  setPlan(auto); R.setRaw('wood', 5); OW.Loop.start(); act('dispatch');
  let t = 0;
  for (let i = 0; i < 400 && phase() === 'loading'; i++) { if (i === 5) R.setRaw('wood', 500); OW.Loop.runBulk(1, 0.2); t += 0.2; }
  return t;
}
const loadT = loadTrip(true), within = (v, cyc) => v <= 20 / (cyc - 0.4) && v >= 20 / (cyc + 0.4);   // ±2 ticks of loop rounding
check('an auto mule shows cargo ÷ (load + travel) once loaded', loadT > 1 && within(hint(), loadT + 15) && near(muleRate(), hint()), `hint ${hint()} vs ${20 / (loadT + 15)} (load ${loadT}s)`);
const muleRows = () => { const bw = entry('mtn_wood').wrap; if (!bw.classList.contains('open')) bw.querySelector('.res-name').click(); Rates.render(); return Array.from(bw.querySelectorAll('.rb-row span:first-child')).map((x) => x.textContent); };
check('…credited to the destination under the station name', muleRows().includes('Resupply Mule 1'), muleRows().join(','));
stepUntil(() => phase() !== 'traveling'); const t1 = Rates.now();
check('…the hint holds after the first arrival', near(muleRate(), hint()) && hint() > 0, muleRate());
stepUntil(() => phase() === 'traveling'); stepUntil(() => phase() !== 'traveling'); const t2 = Rates.now();
check('…the measured average takes over after 2 arrivals: 20 ÷ gap', near(muleRate(), 20 / (t2 - t1)) && within(hint(), t2 - t1), `${muleRate()} vs ${20 / (t2 - t1)}, hint ${hint()}`);
act('toggle-auto'); stepUntil(() => phase() === 'idle'); Rates.reset();
loadTrip(false);
check('a one-off trip shows no hint', hint() === undefined && muleRate() === 0, `${hint()} / ${muleRate()}`);
OW.Loop.stop();

/* ---- /min and /hr expected rates: Gold Panning and Dig Site (checked against what they actually make) ---- */
{
  let sd2 = 4242; w.Math.random = () => (sd2 = (sd2 * 16807) % 2147483647) / 2147483647;   // fixed seed: repeatable rolls
  const made = {}; let cur = null;
  const set0 = Rates.setSource, log0 = Rates.log;
  Rates.setSource = (x) => { cur = x; set0(x); };
  Rates.log = (id, d, x) => { const k = `${x || cur}|${id}`; made[k] = (made[k] || 0) + d; return log0(id, d, x); };
  const run = (h) => { Object.keys(made).forEach((k) => { made[k] = 0; }); OW.Loop.start(); OW.Loop.runBulk(Math.round(h * 3600 / 0.2), 0.2); OW.Loop.stop(); };
  const perS = (k, h) => (made[k] || 0) / (h * 3600);
  const within = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);
  // Rare outcomes: allow 3 standard deviations of chance (counted events) on top of 5%.
  const fair = (exp, k, h) => within(exp, perS(k, h), 0.05 + 3 / Math.sqrt(Math.max(1, exp * h * 3600)));
  R.setCap('gold', 1e12); R.setRaw('gold', 1e9); R.setCap('stone', 1e9); R.setRaw('stone', 0); R.setCap('wood', 1e9); R.setRaw('wood', 1e8);
  OW.Workers.getPools().camp.addWorkers(10); OW.Mountains.workerPool.addWorkers(10);
  const gp = OW.Mechanics.get('goldpanning'), ds = OW.Mechanics.get('digsite');
  gp.subSlots().forEach((id) => gp.subAdd(id));
  run(1);
  const gExp = gp.rateExpect('gold');
  check('Gold Panning /hr expected gold matches 1 game hour of real rolls', gExp > 0 && fair(gExp, 'goldpanning|gold', 1), `${gExp} vs ${perS('goldpanning|gold', 1)}`);
  unitTo(2); R.setRaw('gold', 1e9); OW.Loop.start(); Rates.render();
  const gRows = Array.from(entry('gold').wrap.querySelectorAll('.rb-row')).map((r) => r.className + ':' + r.textContent);
  check('/hr: Gold Panning counts in Gold\'s total (a normal row, not greyed)', near(Rates.perSecond('gold', 'goldpanning'), gExp) && gRows.some((t) => t.startsWith('rb-row :Gold Panning')), gRows.join(' | '));
  unitTo(0); Rates.render(); OW.Loop.stop();
  check('/s: Gold Panning still left out of the total', entry('gold').wrap.querySelector('.rb-excl') !== null);
  OW.DigSite.completeIntro();
  for (let i = 0; i < 3; i++) OW.DigSite.subAssign('dig');
  run(2);
  const dS = ds.rateExpect('stone'), dR = ds.rateExpect('researchpapers');
  check('Dig Site /hr expected Stone and Research match 2 game hours of rolls (no Brazier)',
    fair(dS, 'digsite|stone', 2) && fair(dR, 'digsite|researchpapers', 2), `${dS}/${perS('digsite|stone', 2)} ${dR}/${perS('digsite|researchpapers', 2)}`);
  OW.DigSite.subAssign('brazier');                                          // slow crew: heats, then burns down
  run(2);
  const bS = ds.rateExpect('stone'), bR = ds.rateExpect('researchpapers');
  check('…and with a Brazier heating and burning (research share averaged over its cycle)',
    bR > dR && fair(bS, 'digsite|stone', 2) && fair(bR, 'digsite|researchpapers', 2), `${bS}/${perS('digsite|stone', 2)} ${bR}/${perS('digsite|researchpapers', 2)}`);
  for (let i = 0; i < 2; i++) OW.DigSite.subAssign('brazier');             // fast crew: stays full
  run(1);
  const fR = ds.rateExpect('researchpapers');
  check('…and with a Brazier crew fast enough to stay full', fR > bR && fair(fR, 'digsite|researchpapers', 1), `${fR}/${perS('digsite|researchpapers', 1)}`);
  unitTo(2);
  check('/hr: Dig Site Research shows its expected rate', near(Rates.perSecond('researchpapers', 'digsite'), fR));
  unitTo(0);
  Rates.setSource = set0; Rates.log = log0;
}

check('Gold band is tagged for its gold tint', entry('gold').wrap.dataset.res === 'gold');

OW.Loop.stop();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
