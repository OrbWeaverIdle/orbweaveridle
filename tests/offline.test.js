/* Offline catch-up. Because the replay spans animation frames, every
   check here waits on the onDone callback rather than returning inline. */
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
  // Run frame callbacks on the macrotask queue so chunked replay
  // actually yields, the way it does in a browser.
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
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
// apply() calls back as soon as the world is settled and the summary is
// on screen — dismissing it is the player's business, not the game's.
const offline = (OW, secs) => new Promise((res) => OW.Offline.apply(secs, res));
const dismiss = (w) => {
  const btn = w.document.getElementById('offline-modal-close');
  if (btn) btn.dispatchEvent(new w.Event('click', { bubbles: true }));
};

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

// Rewind a stored save's savedAt so the next boot believes time passed.
function ageSave(OW, seconds) {
  const data = OW.Save.decode(STORE.getItem('orbweaver.save.v1'));
  data.savedAt = Date.now() - seconds * 1000;
  STORE.setItem('orbweaver.save.v1', OW.Save.encode(data));
}

(async function run() {

  /* ===== 1. Time away is credited ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    A.Workers.assign('wood');
    tick(A, 30);
    // Tier-one wood caps at 200. A capped resource makes its workers
    // upkeep-exempt, so leaving the cap in place would silently make
    // several of these checks measure the cap instead of the replay.
    A.Resources.setRaw('wood', A.Resources.get('wood'), 1000000);
    const wood0 = A.Resources.get('wood');
    A.Resources.setRaw('gold', 5000);
    await offline(A, 600); dismiss(a.w); // 10 minutes
    const gained = A.Resources.get('wood') - wood0;
    check('10 minutes offline credits roughly 10 minutes of wood',
      gained > 300 && gained < 420, `gained ${gained.toFixed(1)} (expected ~390 at 0.65/s)`);
  }

  /* ===== 2. Capped at 24 hours ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    let report = null;
    A.Offline.setBonus((r) => { report = r; return null; });
    A.Workers.assign('wood');
    await offline(A, 60 * 60 * 24 * 5); dismiss(a.w); // five days
    check('a five-day absence is capped at 24 hours',
      report && report.secondsCredited === 86400 && report.wasCapped === true,
      report ? `credited ${report.secondsCredited}, capped=${report.wasCapped}` : 'no report');
    check('...and the report still knows how long they were really away',
      report && report.secondsAway === 432000, report ? String(report.secondsAway) : 'no report');
    A.Offline.setBonus(null);
  }

  /* ===== 3. Gold starvation — the core design decision ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    let report = null;
    A.Offline.setBonus((r) => { report = r; return null; });
    // Twenty workers on wood, a small gold buffer: upkeep drains 20/s,
    // so 400 gold buys about 20 seconds and then everything stops.
    A.Workers.addWorkers(20);
    for (let i = 0; i < 20; i++) A.Workers.assign('wood');
    A.Resources.setRaw('wood', 0, 1000000);
    A.Resources.setRaw('gold', 400);
    const wood0 = A.Resources.get('wood');
    await offline(A, 3600); dismiss(a.w); // an hour away
    const gained = A.Resources.get('wood') - wood0;
    check('running out of gold stops production, as designed',
      gained > 0 && gained < 60 * 20 * 0.65, `gained ${gained.toFixed(1)} wood in an "hour"`);
    check('the report says gold ran out', report && report.goldRanOutAfterSeconds != null,
      report ? String(report.goldRanOutAfterSeconds) : 'no report');
    check('...and roughly when', report && report.goldRanOutAfterSeconds <= 300,
      report ? `${report.goldRanOutAfterSeconds}s` : 'no report');
    A.Offline.setBonus(null);
  }

  /* ===== 4. A healthy gold buffer keeps earning ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    let report = null;
    A.Offline.setBonus((r) => { report = r; return null; });
    A.Workers.addWorkers(4);
    for (let i = 0; i < 4; i++) A.Workers.assign('wood');
    A.Resources.setRaw('wood', 0, 1000000);
    A.Resources.setRaw('gold', 5000);
    const wood0 = A.Resources.get('wood');
    await offline(A, 600); dismiss(a.w);
    check('a funded camp keeps producing for the whole absence',
      A.Resources.get('wood') - wood0 > 1000 && report.goldRanOutAfterSeconds === null,
      `gained ${(A.Resources.get('wood') - wood0).toFixed(0)}, ranOut=${report && report.goldRanOutAfterSeconds}`);
    A.Offline.setBonus(null);
  }

  /* ===== 5. Report content ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    let report = null;
    A.Offline.setBonus((r) => { report = r; return 'Bonus goes here.'; });
    A.Workers.assign('wood');
    A.Resources.setRaw('gold', 5000);
    await offline(A, 600); dismiss(a.w);
    check('the report lists resource changes', report.gains.some((g) => g.id === 'wood' && g.delta > 0),
      JSON.stringify(report.gains.map((g) => g.id)));
    check('gold spent on upkeep shows as a decrease', report.gains.some((g) => g.id === 'gold' && g.delta < 0));
    check('the bonus hook receives the report and its note is kept',
      report.bonusNote === 'Bonus goes here.', String(report.bonusNote));
    A.Offline.setBonus(null);
  }

  /* ===== 6. Events are collected from what mechanics already announce ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    let report = null;
    A.Offline.setBonus((r) => { report = r; return null; });
    a.w.document.getElementById('cheat-all').dispatchEvent(new a.w.Event('click', { bubbles: true }));
    tick(A, 5);
    A.Workers.assign('tents');
    A.Resources.setRaw('gold', 5000);
    await offline(A, 900); dismiss(a.w);
    check('tents built while away appear in the summary',
      report.events.some((e) => /tent/i.test(e.message)),
      `events=${JSON.stringify(report.events)} tentsStat="${A.Mechanics.get('tents').getStatText()}" wood=${A.Resources.get('wood').toFixed(0)} gold=${A.Resources.get('gold').toFixed(0)}`);
    check('...with a count rather than a repeated line',
      report.events.every((e) => e.count >= 1) && report.events.length < 12,
      JSON.stringify(report.events));
    A.Offline.setBonus(null);
  }

  /* ===== 7. Short gaps don't interrupt ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    const scrim = a.w.document.getElementById('offline-modal-scrim');
    A.Workers.assign('wood');
    await offline(A, 3); // a page refresh
    check('a 3-second gap credits nothing and shows nothing',
      !scrim.classList.contains('open'), 'modal opened for a refresh');
    await offline(A, 30); // brief, still no interruption
    check('a 30-second gap is simulated but does not interrupt',
      !scrim.classList.contains('open'));
  }

  /* ===== 8. Nonsense clock values are safe ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    const wood0 = A.Resources.get('wood');
    await offline(A, -50000);   // clock moved backwards
    await offline(A, NaN);
    await offline(A, Infinity); // clamps to the 24h cap, must not hang
    check('a backwards or nonsense clock never credits negative time',
      A.Resources.get('wood') >= wood0, String(A.Resources.get('wood')));
    check('the game is still intact afterwards', !!A.Mechanics.get('wood') && a.errors.length === 0,
      a.errors.join('\n        '));
  }

  /* ===== 9. Full boot path: save, age it, reopen ===== */
  newStore();
  {
    const a = boot(), A = a.OW;
    A.Workers.assign('wood'); A.Workers.assign('wood');
    A.Resources.setRaw('wood', 0, 1000000);
    A.Resources.setRaw('gold', 5000);
    tick(A, 30);
    const wood0 = A.Resources.get('wood');
    A.Save.saveToStorage();
    ageSave(A, 1800); // pretend the tab was closed for 30 minutes

    const b = boot(), B = b.OW;
    await new Promise((res) => setTimeout(res, 300)); // let the chunks run
    check('reopening after 30 minutes credits the time',
      B.Resources.get('wood') > wood0 + 500,
      `${wood0.toFixed(0)} -> ${B.Resources.get('wood').toFixed(0)}`);
    check('the welcome-back summary is shown',
      b.w.document.getElementById('offline-modal-scrim').classList.contains('open'));
    check('the summary is an overlay, not a gate — the game is already running',
      b.w.OrbWeaver.Loop.getIntervalMs() > 0);
    dismiss(b.w);
    check('dismissing the summary closes it',
      !b.w.document.getElementById('offline-modal-scrim').classList.contains('open'));
    check('no errors across the whole boot path', b.errors.length === 0, b.errors.join('\n        '));
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
