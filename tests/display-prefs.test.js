/* Display preferences (Settings' four sliders). Covers what jsdom can
   actually establish: defaults, the theme/layout mappings, clamping,
   malformed and blocked storage, the persistence round trip, surviving
   an erase, the pointer-only center detent, and the adjusting-state
   lifecycle. Geometry, zoom rendering, clipping and pointer capture are
   browser-only concerns and are checked by hand — see tests/README.md. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

const DKEY = 'orbweaver.display.v1';
const SKEY = 'orbweaver.save.v1';

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
  w.__reloaded = false;
  SCRIPTS.forEach((src) => {
    let code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    code = code.replace(/location\.reload\(\);/g, 'window.__doReload();');
    try { w.eval(code); } catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  w.__doReload = () => { w.__reloaded = true; };
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, errors };
}

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

const $ = (w, id) => w.document.getElementById(id);
const val = (w, id) => $(w, id).value;
const out = (w, id) => $(w, id).textContent;
const cssVar = (w, name) => w.document.documentElement.style.getPropertyValue(name);
const themeAttr = (w) => w.document.documentElement.getAttribute('data-theme');
const centered = (w) => w.document.body.classList.contains('layout-centered');
const adjusting = (w) => w.document.body.classList.contains('settings-adjusting');
const stored = () => { try { return JSON.parse(STORE._d[DKEY]); } catch (e) { return null; } };

function fire(w, id, type) {
  $(w, id).dispatchEvent(new w.Event(type, { bubbles: true }));
}
function setSlider(w, id, v) {
  $(w, id).value = String(v);
  fire(w, id, 'input');
}

// ─── 1. Defaults on a store with nothing in it ────────────────────────
newStore();
let b = boot();
check('1: boots with no script errors', b.errors.length === 0, b.errors.join(' | '));
check('1: sidebar text defaults to 100', val(b.w, 'sidebar-text-slider') === '100');
check('1: game zoom defaults to 100', val(b.w, 'game-zoom-slider') === '100');
check('1: theme defaults to 3 (top position)', val(b.w, 'display-theme-slider') === '3');
check('1: layout defaults to 1 (centered, top position)', val(b.w, 'display-layout-slider') === '1');
check('1: value labels read out the defaults',
  out(b.w, 'sidebar-text-val') === '100%' && out(b.w, 'game-zoom-val') === '100%' &&
  out(b.w, 'display-theme-val') === 'Original' && out(b.w, 'display-layout-val') === 'Centered',
  `${out(b.w, 'display-theme-val')} / ${out(b.w, 'display-layout-val')}`);
check('1: defaults apply Original and centered layout',
  themeAttr(b.w) === 'original' && centered(b.w), 'theme=' + themeAttr(b.w));
check('1: multipliers start at 1',
  cssVar(b.w, '--sidebar-text') === '1' && cssVar(b.w, '--game-zoom') === '1',
  `${cssVar(b.w, '--sidebar-text')} / ${cssVar(b.w, '--game-zoom')}`);
check('1: Wide Mode is gone from the DOM', !$(b.w, 'wide-mode-toggle'));

// ─── 2. Each slider drives its own effect ─────────────────────────────
setSlider(b.w, 'sidebar-text-slider', 125);
check('2: sidebar text writes its multiplier', cssVar(b.w, '--sidebar-text') === '1.25',
  cssVar(b.w, '--sidebar-text'));
check('2: sidebar text label follows', out(b.w, 'sidebar-text-val') === '125%');
setSlider(b.w, 'game-zoom-slider', 75);
check('2: game zoom writes its multiplier', cssVar(b.w, '--game-zoom') === '0.75',
  cssVar(b.w, '--game-zoom'));
check('2: aria-valuetext follows the label',
  $(b.w, 'game-zoom-slider').getAttribute('aria-valuetext') === '75%');

// ─── 3. Theme mapping, top to bottom ──────────────────────────────────
// Corrected order: Original, Slightly lighter, New, Light stone.
const THEME_ROWS = [[3, 'original', 'Original'], [2, 'subtle', 'Slightly lighter'],
                    [1, 'midpoint', 'New'], [0, 'stone', 'Light stone']];
THEME_ROWS.forEach(([v, attr, name]) => {
  setSlider(b.w, 'display-theme-slider', v);
  check(`3: theme ${v} is ${name}`,
    themeAttr(b.w) === attr && out(b.w, 'display-theme-val') === name,
    `attr=${themeAttr(b.w)} label=${out(b.w, 'display-theme-val')}`);
});
check('3: theme slider sets aria-valuetext too',
  $(b.w, 'display-theme-slider').getAttribute('aria-valuetext') === 'Light stone');

// ─── 4. Layout mapping ────────────────────────────────────────────────
setSlider(b.w, 'display-layout-slider', 0);
check('4: layout 0 is Free and drops the centered class',
  !centered(b.w) && out(b.w, 'display-layout-val') === 'Free');
setSlider(b.w, 'display-layout-slider', 1);
check('4: layout 1 is Centered and restores the class',
  centered(b.w) && out(b.w, 'display-layout-val') === 'Centered');

// ─── 5. Persistence, under the hyphenated key names ───────────────────
const saved = stored();
check('5: saved under the hyphenated property names', saved &&
  saved['sidebar-text'] === 125 && saved['game-zoom'] === 75 &&
  saved.theme === 0 && saved.layout === 1, JSON.stringify(saved));
b = boot();                                   // same STORE, fresh page
check('5: preferences come back after a reboot',
  val(b.w, 'sidebar-text-slider') === '125' && val(b.w, 'game-zoom-slider') === '75' &&
  val(b.w, 'display-theme-slider') === '0' && val(b.w, 'display-layout-slider') === '1');
check('5: restored preferences are applied, not just loaded',
  themeAttr(b.w) === 'stone' && cssVar(b.w, '--sidebar-text') === '1.25' && centered(b.w));

// ─── 6. Out-of-range and wrong-typed values clamp ─────────────────────
newStore();
STORE._d[DKEY] = JSON.stringify({ 'sidebar-text': 999, 'game-zoom': -50, theme: 7, layout: 'yes' });
b = boot();
check('6: over-max size clamps to 125', val(b.w, 'sidebar-text-slider') === '125');
check('6: under-min size clamps to 75', val(b.w, 'game-zoom-slider') === '75');
check('6: out-of-range theme clamps into 0-3', val(b.w, 'display-theme-slider') === '3');
check('6: a non-numeric layout falls back to the default', val(b.w, 'display-layout-slider') === '1');
check('6: clamping produced no errors', b.errors.length === 0, b.errors.join(' | '));

// ─── 7. Malformed stored blob ─────────────────────────────────────────
newStore();
STORE._d[DKEY] = '{not json at all';
b = boot();
check('7: unparseable preferences fall back to defaults without throwing',
  b.errors.length === 0 && val(b.w, 'sidebar-text-slider') === '100' &&
  themeAttr(b.w) === 'original', b.errors.join(' | '));

// ─── 8. Storage blocked entirely (private browsing) ───────────────────
newStore({ blocked: true, blockReads: true });
b = boot();
check('8: boots with defaults when storage throws on read',
  b.errors.length === 0 && val(b.w, 'game-zoom-slider') === '100', b.errors.join(' | '));
setSlider(b.w, 'game-zoom-slider', 110);
check('8: a write that throws still applies the preference in-session',
  cssVar(b.w, '--game-zoom') === '1.1' && out(b.w, 'game-zoom-val') === '110%',
  cssVar(b.w, '--game-zoom'));

// ─── 9. Display preferences outlive an erase ──────────────────────────
// save.js only ever touches its own key, which is the whole reason these
// live in a separate one — a player who wipes progress keeps their theme.
newStore();
b = boot();
setSlider(b.w, 'display-theme-slider', 0);
setSlider(b.w, 'sidebar-text-slider', 90);
b.OW.Save.saveToStorage();
check('9: both keys are present before the erase',
  !!STORE._d[SKEY] && !!STORE._d[DKEY]);
b.OW.Save.eraseAndReload();
check('9: erase cleared the game save', !STORE._d[SKEY]);
check('9: erase left display preferences untouched',
  !!STORE._d[DKEY] && stored().theme === 0 && stored()['sidebar-text'] === 90,
  JSON.stringify(stored()));
b = boot();
check('9: the erased-and-reloaded game still comes back on Light stone',
  themeAttr(b.w) === 'stone' && val(b.w, 'sidebar-text-slider') === '90');

// ─── 10. Pointer-only center detent ───────────────────────────────────
// Dragging snaps 98-102 to exactly 100; the keyboard deliberately does
// not, so a player can still pick 99 or 101 on purpose.
newStore();
b = boot();
fire(b.w, 'sidebar-text-slider', 'pointerdown');
setSlider(b.w, 'sidebar-text-slider', 101);
check('10: a pointer drag snaps 101 to 100',
  val(b.w, 'sidebar-text-slider') === '100' && out(b.w, 'sidebar-text-val') === '100%');
setSlider(b.w, 'sidebar-text-slider', 103);
check('10: a pointer drag leaves 103 alone (outside the detent)',
  val(b.w, 'sidebar-text-slider') === '103');
fire(b.w, 'sidebar-text-slider', 'pointerup');
setSlider(b.w, 'sidebar-text-slider', 101);
check('10: the keyboard keeps every step, including 101',
  val(b.w, 'sidebar-text-slider') === '101' && out(b.w, 'sidebar-text-val') === '101%');

// ─── 11. Adjusting state lifecycle ────────────────────────────────────
newStore();
b = boot();
check('11: not adjusting at rest', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
check('11: a pointer press starts adjusting', adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerup');
check('11: release ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'keydown');
check('11: a held key starts it too', adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'keyup');
check('11: key release ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
fire(b.w, 'game-zoom-slider', 'pointercancel');
check('11: a cancelled pointer ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
fire(b.w, 'game-zoom-slider', 'lostpointercapture');
check('11: losing pointer capture ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
b.w.dispatchEvent(new b.w.Event('blur'));
check('11: window blur ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
b.w.dispatchEvent(new b.w.Event('pagehide'));
check('11: pagehide ends it', !adjusting(b.w));
// The two lower sliders never dim anything.
fire(b.w, 'display-theme-slider', 'pointerdown');
check('11: the theme slider never triggers the dimming', !adjusting(b.w));
fire(b.w, 'display-layout-slider', 'pointerdown');
check('11: the layout slider never triggers it either', !adjusting(b.w));

// ─── 12. The pre-paint <head> initializer ─────────────────────────────
// script.js runs at the end of <body>, i.e. after first paint, so a
// Light stone player would see a flash of the dark default. The inline
// head script exists to beat that. It is never picked up by the SCRIPTS
// list above (no src attribute), so it needs its own harness: parse
// only as far as </head>, with localStorage seeded via beforeParse, and
// assert the work is already done while script.js does not yet exist.
function bootHead(rawValue) {
  const full = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const headOnly = full.slice(0, full.indexOf('</head>') + 7) + '<body></body></html>';
  const dom = new JSDOM(headOnly, {
    runScripts: 'dangerously', url: 'http://localhost/',
    beforeParse(w) {
      const s = {
        _d: rawValue === null ? {} : { [DKEY]: rawValue },
        getItem(k) { return k in this._d ? this._d[k] : null; },
        setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
      };
      Object.defineProperty(w, 'localStorage', { value: s, configurable: true, writable: true });
      w.console = { log() {}, error() {}, warn() {} };
    }
  });
  const r = dom.window.document.documentElement;
  return {
    theme: r.getAttribute('data-theme'),
    zoom: r.style.getPropertyValue('--game-zoom'),
    text: r.style.getPropertyValue('--sidebar-text')
  };
}

let h = bootHead(JSON.stringify({ 'sidebar-text': 125, 'game-zoom': 75, theme: 0, layout: 1 }));
check('12: stone is applied before script.js is even parsed', h.theme === 'stone', h.theme);
check('12: both multipliers are set pre-paint too',
  h.zoom === '0.75' && h.text === '1.25', `${h.zoom} / ${h.text}`);
check('12: head init uses the same corrected mapping (2 is subtle)',
  bootHead(JSON.stringify({ theme: 2 })).theme === 'subtle');
check('12: no stored key leaves Original, forcing no attribute', !bootHead(null).theme);
check('12: a malformed blob neither throws nor sets a theme',
  !bootHead('{{{ not json').theme);
check('12: an out-of-range theme index is ignored',
  !bootHead(JSON.stringify({ theme: 99 })).theme);
check('12: a non-numeric theme is ignored',
  !bootHead(JSON.stringify({ theme: 'stone' })).theme);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
