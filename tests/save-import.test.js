/* Reproduces the reported bug: export a save, start a fresh game,
   import it, and end up with the fresh game. Also covers Erase, which
   fails the same way, and a browser that blocks storage entirely. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore(opts) {
  const o = opts || {};
  STORE = {
    _d: {}, blocked: !!o.blocked,
    getItem(k) { if (this.blocked && o.blockReads) throw new Error('blocked'); return k in this._d ? this._d[k] : null; },
    setItem(k, v) { if (this.blocked) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
}

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

  // jsdom won't let us replace window.location, so intercept the reload
  // the same way a browser would: fire the unload events, then stop.
  w.__reloaded = false;
  SCRIPTS.forEach((src) => {
    let code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    code = code.replace(/location\.reload\(\);/g, 'window.__doReload();');
    try { w.eval(code); } catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  w.__doReload = () => {
    w.__reloaded = true;
    // A real reload fires these before tearing the page down.
    w.dispatchEvent(new w.Event('pagehide'));
    w.dispatchEvent(new w.Event('beforeunload'));
  };
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
const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

/* ===== 1. Export from one game, import into a fresh one ===== */
newStore();
let exported = null, woodA = 0;
{
  const a = boot(), A = a.OW;
  A.Workers.assign('wood'); A.Workers.assign('wood');
  tick(A, 120);
  woodA = A.Resources.get('wood');
  exported = A.Save.exportText();
}
newStore(); // a brand new browser profile: empty storage
{
  const b = boot(), B = b.OW;
  check('fresh profile really is a new game', B.Resources.get('wood') === 0, String(B.Resources.get('wood')));
  B.Save.importText(exported);
  check('import triggered a reload', b.w.__reloaded);
  // What survived the reload is what the player gets back.
  const c = boot(), C = c.OW;
  check('imported save survives the reload', Math.abs(C.Resources.get('wood') - woodA) < 0.001,
    `expected ${woodA.toFixed(2)} wood, got ${C.Resources.get('wood').toFixed(2)}`);
}

/* ===== 2. Erase must actually erase ===== */
newStore();
{
  const a = boot(), A = a.OW;
  A.Workers.assign('wood'); tick(A, 60);
  A.Save.saveToStorage();
  A.Save.eraseAndReload();
  const b = boot(), B = b.OW;
  check('erase actually erases', B.Resources.get('wood') === 0, String(B.Resources.get('wood')));
}

/* ===== 3. A browser that blocks storage (private mode) ===== */
newStore({ blocked: true });
{
  const a = boot(), A = a.OW;
  check('game still boots when storage is blocked', !!A.Mechanics.get('wood'));
  let ok = false, msg = '';
  try { ok = A.Save.importText(exported); } catch (e) { msg = e.message; }
  check('import still works when storage is blocked', ok === true, msg || 'importText returned ' + ok);
  check('...and the imported world is actually loaded', Math.abs(A.Resources.get('wood') - woodA) < 0.001,
    `expected ${woodA.toFixed(2)} wood, got ${A.Resources.get('wood').toFixed(2)}`);
}

/* ===== 4. A bad paste reports why ===== */
newStore();
{
  const a = boot(), A = a.OW;
  let msg = '';
  try { A.Save.importText('not a save'); } catch (e) { msg = e.message; }
  check('a bad paste gives a readable reason', /Orb Weaver save/i.test(msg), msg);
  msg = '';
  try { A.Save.importText(exported.slice(0, exported.length - 8)); } catch (e) { msg = e.message; }
  check('a truncated paste gives a readable reason', /incomplete|damaged/i.test(msg), msg);
}

/* ===== 5. The Settings buttons themselves =====
   The reload bug lived in the engine; the "nothing happens" feeling
   lived in the button wiring. Drive the actual DOM controls. */
newStore();
{
  const a = boot(), A = a.OW;
  const box = a.w.document.getElementById('save-text');
  const status = a.w.document.getElementById('save-status');
  const click = (id) => a.w.document.getElementById(id).dispatchEvent(new a.w.Event('click', { bubbles: true }));

  check('the paste box is visible from the start, not hidden behind a first press',
    box.style.display !== 'none', `display="${box.style.display}"`);

  A.Workers.assign('wood'); tick(A, 60);
  const woodLive = A.Resources.get('wood');
  click('save-export-btn');
  check('Export fills the box with a usable code', box.value.startsWith('OW1|'), box.value.slice(0, 24));

  // Fresh profile, paste, single press.
  const savedCode = box.value;
  newStore();
  const b = boot(), B = b.OW;
  const box2 = b.w.document.getElementById('save-text');
  const status2 = b.w.document.getElementById('save-status');
  const click2 = (id) => b.w.document.getElementById(id).dispatchEvent(new b.w.Event('click', { bubbles: true }));

  click2('save-import-btn');
  check('pressing Import with an empty box explains what to do',
    /paste/i.test(status2.textContent), `"${status2.textContent}"`);

  box2.value = savedCode;
  click2('save-import-btn');
  check('ONE press of Import after pasting does the import', b.w.__reloaded, `status="${status2.textContent}"`);

  const c = boot(), C = c.OW;
  check('and the imported game is what loads', Math.abs(C.Resources.get('wood') - woodLive) < 0.001,
    `expected ${woodLive.toFixed(2)}, got ${C.Resources.get('wood').toFixed(2)}`);

  // Garbage in the box must report, not reload.
  newStore();
  const e = boot();
  const box3 = e.w.document.getElementById('save-text');
  box3.value = 'garbage';
  e.w.document.getElementById('save-import-btn').dispatchEvent(new e.w.Event('click', { bubbles: true }));
  check('a bad paste reports in the UI and does not reload',
    !e.w.__reloaded && /OW1|incomplete|damaged/i.test(e.w.document.getElementById('save-status').textContent),
    `reloaded=${e.w.__reloaded} status="${e.w.document.getElementById('save-status').textContent}"`);

  // Erase: two presses.
  newStore();
  const f = boot(), F = f.OW;
  F.Workers.assign('wood'); tick(F, 60); F.Save.saveToStorage();
  f.w.document.getElementById('save-reset-btn').dispatchEvent(new f.w.Event('click', { bubbles: true }));
  check('one press of Erase only arms it', !f.w.__reloaded && /erase/i.test(f.w.document.getElementById('save-reset-btn').textContent));
  f.w.document.getElementById('save-reset-btn').dispatchEvent(new f.w.Event('click', { bubbles: true }));
  const g = boot();
  check('two presses of Erase actually erase', g.OW.Resources.get('wood') === 0, String(g.OW.Resources.get('wood')));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
