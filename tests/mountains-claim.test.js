/* Mountains travel-path reward claim. Covers the flow that replaced the
   old Wheat Field / Gold Panning build sub-slots: a reward path finishes
   travelling but does NOT vanish — it parks at phase 'claim' with its bar
   full and its button switched live, and only the click reveals the cards
   and clears the section.

   The load-bearing design property under test is that a claim-phase path
   has LEFT activePaths, so nothing reading that array (upkeep, clamping,
   stat text, the card-face bars, tick) can see it — that is what kept the
   blast radius of this change inside renderModalHTML(). */
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

/* Place arbitrary travel-path state through the real save engine — the
   same route a mid-chain save restore takes, so these helpers double as
   restore coverage rather than reaching into module internals. */
function setPaths(OW, active, state, stubs) {
  const blob = OW.Save.serialize();
  blob.mechanics.mountains.ap = active;
  blob.mechanics.mountains.ps = state;
  if (stubs) blob.mechanics.mountains.pst = stubs;
  OW.Save.deserialize(blob);
}
const idle = (extra) => Object.assign({ phase: 'idle', progress: 0, workers: 0, m: 1, p: 1, f: 0 }, extra || {});

// Isolate the claim button's own tag out of the rendered modal, so a
// `disabled` sitting on some unrelated stepper can never satisfy (or
// break) an assertion about the button.
function claimTag(html, id) {
  const m = html.match(new RegExp(`<button[^>]*data-mtn-claim="${id}"[^>]*>[^<]*</button>`));
  return m ? m[0] : null;
}
const footerHas = (OW, text) => OW.Footer.getHistory().some((e) => e.t === text);

newStore();
const { w, OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));

OW.Mountains.reveal();
OW.Mountains.addWorkers(20);
OW.Resources.add('gold', 1e6);
const mtn = OW.Mechanics.get('mountains');
const pool = OW.Mountains.workerPool;
pool.assign('mountains'); pool.assign('mountains'); pool.assign('mountains');
mtn.onOpen();

// Finish the Outpost stage — the whole post-Outpost modal (travel paths
// included) does not render until it is done.
OW.Upgrades.getTrack('mountains:stage').completeAll();
tick(OW, 1);
check('Outpost stage completed, post-Outpost modal renders',
  mtn.renderModalHTML().includes('bare-section'));

/* ---------- 1. Travelling: button present, greyed, already named ---------- */
setPaths(OW, ['wheatfield'], { wheatfield: idle({ workers: 2 }) });
OW.Resources.add('gold', 1e6);

const travellingTag = claimTag(mtn.renderModalHTML(), 'wheatfield');
check('a reward path renders a claim button while still travelling', !!travellingTag);
check('that button is disabled while travelling',
  !!travellingTag && travellingTag.includes('disabled'), travellingTag);
check('the greyed button already names the reward, so the payout is visible up front',
  !!travellingTag && travellingTag.includes('>Wheat Field</button>'), travellingTag);
check('a non-reward path renders no claim button at all', (() => {
  setPaths(OW, ['hike'], { hike: idle({ workers: 1 }) });
  return !claimTag(mtn.renderModalHTML(), 'hike');
})());

/* ---------- 2. Completion parks at claim, does not vanish ---------- */
setPaths(OW, ['wheatfield'], { wheatfield: idle({ workers: 2 }) });
OW.Resources.add('gold', 1e6);
tick(OW, 60); // wheatfield needs 20s of worker-time; 2 workers clear it easily

const readyHtml = mtn.renderModalHTML();
const readyTag = claimTag(readyHtml, 'wheatfield');
check('the finished travel section is still rendered, not removed', !!readyTag, readyHtml.slice(0, 300));
check('its button is now live (no disabled attribute)',
  !!readyTag && !readyTag.includes('disabled'), readyTag);
check('its bar is pinned full', readyHtml.includes('style="width:100%"'));
check('the stepper is gone from the finished section (workers returned to the pool)',
  !readyHtml.includes('data-mtn-sub="wheatfield"'));
check('no sub-slot still holds workers after completion', mtn.getBillableCount() === 0,
  `getBillableCount()=${mtn.getBillableCount()}`);
check("the travel's own doneMsg fired on completion, before any claim",
  footerHas(OW, "You've found a small field of wheat in the valley."));
check('the established message has NOT fired yet', !footerHas(OW, 'Wheat Field established.'));

/* The design property that kept this change small: a claim-phase path is
   invisible to everything that reads activePaths. */
check('claim path has left activePaths — no extra bar is emitted for it',
  !mtn.getExtraBars().some((b) => b.id === 'wheatfield'));
check('claim path contributes no card-face progress bar',
  mtn.hideUpgradeBar() === true || !mtn.getExtraBars().length);

/* ---------- 3. The claim click ---------- */
const body = w.document.getElementById('card-modal-body');
body.innerHTML = readyHtml;
const wheatCard = OW.Mechanics.get('wheatfieldcard');
check('Wheat Field card is hidden before the claim', !wheatCard.revealed);

const scrim = w.document.getElementById('card-modal-scrim');
scrim.classList.add('open'); // simulate the Mountains modal being open
body.querySelector('[data-mtn-claim="wheatfield"]').click();

check('claiming revealed the Wheat Field card', wheatCard.revealed === true);
check('claiming pushed the established message', footerHas(OW, 'Wheat Field established.'));
check('claiming removed the finished travel section',
  !claimTag(mtn.renderModalHTML(), 'wheatfield'));
check('claiming the Wheat Field reward closes the modal',
  !scrim.classList.contains('open'));

const htmlAfterClaim = mtn.renderModalHTML();
body.innerHTML = readyHtml; // re-mount the stale section and click again
body.querySelector('[data-mtn-claim="wheatfield"]').click();
check('a stale button cannot re-grant once the phase left claim',
  mtn.renderModalHTML() === htmlAfterClaim);

/* ---------- 4. Claim state survives a save round trip with no new key ---------- */
setPaths(OW, [], { surroundedmountains: idle({ phase: 'claim', progress: 120 }) });
const blob = OW.Save.serialize();
check('no new save key was added for the claim — it rides pathState (ps)',
  blob.mechanics.mountains.ps.surroundedmountains.phase === 'claim'
  && !('cl' in blob.mechanics.mountains));
OW.Save.deserialize(blob);

const gpTag = claimTag(mtn.renderModalHTML(), 'surroundedmountains');
check('a restored claim renders live, not greyed', !!gpTag && !gpTag.includes('disabled'), gpTag);
check('restored claim button names Gold Panning',
  !!gpTag && gpTag.includes('>Gold Panning</button>'), gpTag);

/* ---------- 5. Smelter Shack unlocks when the claim button goes live,
   not when it's clicked ----------
   Real tick()-driven completion (not the setPaths shortcut used above),
   so the actual code path where grants.onReady fires is exercised. */
setPaths(OW, ['surroundedmountains'], { surroundedmountains: idle({ workers: 3 }) });
OW.Resources.add('gold', 1e6);
check('Smelter Shack is not buildable before the path finishes travelling',
  !mtn.renderModalHTML().includes('data-mtn-action="start-smelter"'));
tick(OW, 60); // surroundedmountains needs 120s of worker-time; 3 workers clear it in 40s

const smelt = OW.Mechanics.get('smeltershack');
check('Smelter Shack build option appears the instant the claim button goes live, before any click',
  mtn.renderModalHTML().includes('data-mtn-action="start-smelter"'));
check('Smelter Shack the CARD is not revealed yet — only its build option unlocked',
  !smelt.revealed);
check('Smelter Shack build renders above Stone Quarry, below the claim-phase path',
  (() => {
    const html = mtn.renderModalHTML();
    return html.indexOf('data-mtn-claim="surroundedmountains"') < html.indexOf('data-mtn-action="start-smelter"')
      && html.indexOf('data-mtn-action="start-smelter"') < html.indexOf('data-quarry-card');
  })());

/* ---------- 6. Claiming Gold Panning reveals only Gold Panning ----------
   Smelter Shack is a separate build (unlocked in section 5 above, not
   granted here) — it stays a build option, never an instant card grant. */
const gold = OW.Mechanics.get('goldpanning');
check('Gold Panning is hidden before the claim', !gold.revealed);

body.innerHTML = mtn.renderModalHTML();
scrim.classList.add('open'); // simulate the Mountains modal being open again
body.querySelector('[data-mtn-claim="surroundedmountains"]').click();

check('the claim revealed Gold Panning', gold.revealed === true);
check('the claim did NOT reveal the Smelter Shack card (it is a build, already unlocked)',
  smelt.revealed === false);
check('Gold Panning claim cleared its own section',
  !claimTag(mtn.renderModalHTML(), 'surroundedmountains'));
check('claiming the Gold Panning reward closes the modal',
  !scrim.classList.contains('open'));

/* ---------- 7. A path's row position doesn't move when it finishes ----------
   Regression for the bug where a finished reward path was appended after
   every still-active path instead of staying where it was revealed —
   visibly, it jumped rows (even past a pinBottom path) the instant it
   became claimable. hike and horses stay travelling throughout; only
   wheatfield (sitting between them) is driven to completion. */
setPaths(OW, ['hike', 'wheatfield', 'horses'],
  { hike: idle({ workers: 1 }), wheatfield: idle({ workers: 2 }), horses: idle({ workers: 1 }) });
OW.Resources.add('gold', 1e6);

const rowOrder = (html) => ['Hike the Lower Range', 'A small field of wheat in the lower valley.',
  'Wild horses run through the open valley'].map((title) => html.indexOf(title));

const beforeIdx = rowOrder(mtn.renderModalHTML());
check('before completion: hike, wheatfield, horses render in that order',
  beforeIdx.every((n) => n >= 0) && beforeIdx[0] < beforeIdx[1] && beforeIdx[1] < beforeIdx[2],
  beforeIdx.join(','));

tick(OW, 25); // clears wheatfield's 20s; hike and horses (120s each) stay active

const afterIdx = rowOrder(mtn.renderModalHTML());
check('wheatfield reached its claim button', !!claimTag(mtn.renderModalHTML(), 'wheatfield'));
check('after wheatfield finishes, the row order is unchanged (it did not move)',
  afterIdx.every((n) => n >= 0) && afterIdx[0] < afterIdx[1] && afterIdx[1] < afterIdx[2],
  afterIdx.join(','));

/* ---------- 8. A rugged Mountain path (pinTop) always renders first ----------
   ruggedpath is revealed after hike, wheatfield and horses, so plain
   reveal order would put it last. pinTop must override that, and it
   must render above the Quarry section too (blocks are paths-first,
   stubs, Quarry last — see renderModalHTML()). */
setPaths(OW, ['hike', 'wheatfield', 'horses', 'ruggedpath'], {
  hike: idle({ workers: 1 }), wheatfield: idle({ workers: 1 }),
  horses: idle({ workers: 1 }), ruggedpath: idle({ workers: 1 })
});
OW.Resources.add('gold', 1e6);

const pinTopHtml = mtn.renderModalHTML();
const ruggedIdx = pinTopHtml.indexOf('A rugged Mountain path');
const hikeIdx = pinTopHtml.indexOf('Hike the Lower Range');
const wheatIdx = pinTopHtml.indexOf('A small field of wheat in the lower valley.');
const horsesIdx = pinTopHtml.indexOf('Wild horses run through the open valley');
const quarryIdx = pinTopHtml.indexOf('Stone Quarry');
check('ruggedpath renders before every other travel path',
  ruggedIdx >= 0 && ruggedIdx < hikeIdx && ruggedIdx < wheatIdx && ruggedIdx < horsesIdx,
  `${ruggedIdx},${hikeIdx},${wheatIdx},${horsesIdx}`);
check('ruggedpath renders before the Quarry section too',
  ruggedIdx >= 0 && quarryIdx >= 0 && ruggedIdx < quarryIdx, `${ruggedIdx},${quarryIdx}`);

/* ---------- 9. The old build machinery is really gone ---------- */
const src = fs.readFileSync(path.join(ROOT, 'js/mechanics/mountains.js'), 'utf8');
['wheatfieldbuild', 'goldpanbuild', 'start-wheat', 'start-goldpan', 'cancel-wheat', 'cancel-goldpan',
  'wheatPhase', 'goldPanPhase', 'WHEAT_BUILD_TIME', 'GOLDPAN_BUILD_TIME']
  .forEach((dead) => check(`build machinery removed: ${dead}`, !src.includes(dead)));
check('the six dead save keys are gone from the serializer',
  !/\b(wp|wt|wn|gp|gt|gn):\s/.test(src));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
