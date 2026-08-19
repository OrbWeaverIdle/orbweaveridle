/* Boots the real Orb Weaver in jsdom, plays it, saves, boots a SECOND
   fresh game, loads the save into it, and compares the two worlds. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = require('path').join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g)
  .map((t) => t.match(/src="([^"]+)"/)[1]);

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/'
  });
  const w = dom.window;
  // localStorage shim shared across boots so a save survives.
  // Must be defineProperty — jsdom exposes localStorage via a prototype
  // getter, so a plain assignment silently does nothing.
  const store = global.__store || (global.__store = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  });
  Object.defineProperty(w, 'localStorage', { value: store, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  w.performance = { now: () => Date.now() };
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };

  SCRIPTS.forEach((src) => {
    const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    try { w.eval(code); } catch (e) { errors.push(`${src}: ${e.message}`); }
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

// A world snapshot we can diff. Deliberately reads the OBSERVABLE game,
// not the save blob — otherwise we'd only be testing JSON.stringify.
function snapshot(OW) {
  const res = {};
  OW.Resources.all().forEach((r) => {
    res[r.id] = [Number(r.current.toFixed(4)), r.cap, !!r.hidden, r.name];
  });
  const pools = {};
  Object.entries(OW.Workers.getPools()).forEach(([k, p]) => {
    pools[k] = { total: p.getTotal(), idle: p.getIdleCount() };
  });
  const cards = {};
  OW.Mechanics.all().forEach((m) => {
    cards[m.id] = {
      name: m.cardName(),
      stat: m.getStatText(),
      revealed: !!m.revealed,
      assigned: (m.workerPool || OW.Workers).getAssigned(m.id),
      bar: Math.round((m.getUpgradeBarPct ? m.getUpgradeBarPct() : 0) * 100) / 100,
      build: Math.round((m.getBuildBarPct ? m.getBuildBarPct() : 0) * 100) / 100
    };
  });
  return { res, pools, cards };
}

function tick(OW, seconds) {
  const n = Math.round(seconds / 0.2);
  OW.Loop.runBulk(n, 0.2);
}

const results = [];
function check(label, cond, detail) {
  results.push({ label, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

/* ---------------- Play a game ---------------- */
const a = boot();
check('game boots with no script errors', a.errors.length === 0, a.errors.join('\n        '));

const A = a.OW;
// Drive it well past the early game with the ALL cheat, then play on.
a.w.document.getElementById('cheat-all').dispatchEvent(new a.w.Event('click', { bubbles: true }));
tick(A, 30);

// Assign workers around, including a second location.
A.Workers.assign('wood'); A.Workers.assign('wood'); A.Workers.assign('market');
A.Workers.assign('tents'); A.Workers.assign('academy'); A.Workers.assign('scoutspen');
// The ALL cheat only tops up Camp's pool (documented behaviour), so
// staff Mountains the way the game itself does — via the location.
A.Mountains.addWorkers(4);
const mtnPool = A.Workers.getPools()['mountains'];
mtnPool.assign('mountains'); mtnPool.assign('quarry');
A.Mechanics.get('wood').locked = true;
tick(A, 120);

const before = snapshot(A);
check('game actually progressed (wood produced)', before.res.wood[0] > 0, JSON.stringify(before.res.wood));
check('a second location is live', before.pools.mountains.total > 0, JSON.stringify(before.pools));

/* ---------------- Save ---------------- */
let saveText = null;
try { saveText = A.Save.exportText(); } catch (e) { }
check('export produces a save string', !!saveText && saveText.startsWith('OW1|'), String(saveText).slice(0, 40));
console.log(`        save size: ${saveText ? saveText.length : 0} chars`);

check('checksum rejects a truncated save', (() => {
  try { A.Save.decode(saveText.slice(0, saveText.length - 6)); return false; } catch (e) { return true; }
})());
check('checksum rejects foreign text', (() => {
  try { A.Save.decode('hello world'); return false; } catch (e) { return true; }
})());

A.Save.saveToStorage();

/* ---------------- Fresh boot + load ---------------- */
const b = boot();
check('second boot with no script errors', b.errors.length === 0, b.errors.join('\n        '));
const B = b.OW;
const after = snapshot(B);

/* ---------------- Compare ---------------- */
function diff(x, y, prefix, out) {
  const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
  keys.forEach((k) => {
    const xv = (x || {})[k], yv = (y || {})[k];
    const xs = JSON.stringify(xv), ys = JSON.stringify(yv);
    if (xs !== ys) out.push(`${prefix}${k}: saved ${xs} -> loaded ${ys}`);
  });
  return out;
}
const resDiff = diff(before.res, after.res, 'resource ', []);
const poolDiff = diff(before.pools, after.pools, 'pool ', []);
const cardDiff = diff(before.cards, after.cards, 'card ', []);

check('all resources restored (value, cap, hidden, name)', resDiff.length === 0, resDiff.join('\n        '));
check('all worker pools restored', poolDiff.length === 0, poolDiff.join('\n        '));
check('all cards restored (name, stat, reveal, assignment, bars)', cardDiff.length === 0, cardDiff.join('\n        '));

// Derived-not-stored: the ladder name must come from replaying the table.
check('wood card name was recomputed from the ladder, not stored',
  after.cards.wood.name === before.cards.wood.name && after.cards.wood.name !== 'Wood',
  `${before.cards.wood.name} -> ${after.cards.wood.name}`);

// Research effects must be replayed, not stored.
check('worker lock survived', B.Mechanics.get('wood').locked === true);

/* ---------------- Both worlds must now EVOLVE identically ---------------- */
tick(A, 60); tick(B, 60);
const evoDiff = diff(snapshot(A).res, snapshot(B).res, 'resource ', []);
check('after 60 more seconds both worlds are still identical', evoDiff.length === 0, evoDiff.join('\n        '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
