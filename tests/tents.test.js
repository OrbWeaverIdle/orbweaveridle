/* Tents. Boots the real game headless and covers the card-face time
   display: the two strict unit thresholds (2 minutes, 1 hour), that
   the rounding can't print a 60 in the smaller unit, and that all
   three card-face states plus the modal's Next cost row read from the
   one shared formatter. Tents' build/cost/escalation behavior is
   already exercised by save-roundtrip and save-edgecases and is not
   re-proven here. Also asserts the PAUSED caption's markup contract,
   since its visibility is pure CSS and jsdom applies no stylesheet. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPTS = HTML.match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore() { STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } }; }

function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
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

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

newStore();
const { w, OW, errors } = boot();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));

const tents = OW.Mechanics.get('tents');
OW.Cards.reveal(tents);

/* costLine is deliberately private. Drive it the way the game does —
   set tentsBuilt through a real save load so tentTime() lands on the
   value under test, then read the real card-face string. The time part
   is everything after the comma. */
const saveBlob = JSON.parse(JSON.stringify(OW.Save.serialize()));
function setBuilt(n) {
  const blob = JSON.parse(JSON.stringify(saveBlob));
  blob.mechanics.tents = { n, st: 'idle', t: null, ct: null };
  OW.Save.deserialize(blob);
}
function faceTime() {
  const s = tents.getStatText();          // "Next – 0.01 wood, 3.0s"
  return s.slice(s.indexOf('wood,') + 6);
}
function pitchTime() {
  const s = tents.getStatText();          // "Pitching – 3.0s remaining"
  return s.slice(s.indexOf('–') + 2, s.lastIndexOf(' remaining')).trim();
}
// tentsBuilt that puts tentTime() closest to a target number of seconds.
function builtFor(seconds) { return Math.log(seconds / 3) / Math.log(1.33); }

/* ---- Tier 1: seconds, below and exactly at the 120s threshold ---- */
setBuilt(0);
check('a short time reads in seconds with one decimal', faceTime() === '3.0s', faceTime());

setBuilt(builtFor(120));
check('exactly 120s still reads in seconds (threshold is strict)', /^120\.0s$/.test(faceTime()), faceTime());

setBuilt(builtFor(125));
check('just past 120s switches to minutes and seconds', faceTime() === '2m 5s', faceTime());

/* ---- Tier 2: minutes. The rounding trap: a total whose seconds part
   rounds to 60 must carry into the minutes, never print "2m 60s". ---- */
setBuilt(builtFor(179.7));
check('179.7s carries into 3m 0s rather than printing 2m 60s', faceTime() === '3m 0s', faceTime());

setBuilt(builtFor(1500));
check('a mid-range time reads in minutes and seconds', faceTime() === '25m 0s', faceTime());

setBuilt(builtFor(3600));
check('exactly 3600s still reads in minutes (threshold is strict)', /^60m 0s$/.test(faceTime()), faceTime());

/* ---- Tier 3: hours and minutes, no seconds ---- */
setBuilt(builtFor(3660));
check('just past an hour switches to hours and minutes', faceTime() === '1h 1m', faceTime());
check('the hour tier drops seconds entirely', !/s$/.test(faceTime()), faceTime());

setBuilt(builtFor(7199));
check('7199s carries into 2h 0m rather than printing 1h 60m', faceTime() === '2h 0m', faceTime());

setBuilt(builtFor(50000));
check('a long time reads in hours and minutes', faceTime() === '13h 53m', faceTime());

/* ---- Every face state and the modal row share one formatter ---- */
setBuilt(builtFor(3660));
const nextStr = tents.getStatText();
check('idle face state uses the tiered time', nextStr.startsWith('Next – ') && nextStr.endsWith('1h 1m'), nextStr);
check('modal Next cost row matches the card face exactly',
  tents.renderModalHTML().includes('1h 1m'), tents.renderModalHTML());

const stoppedBlob = JSON.parse(JSON.stringify(saveBlob));
stoppedBlob.mechanics.tents = { n: builtFor(3660), st: 'stopped', t: null, ct: null };
OW.Save.deserialize(stoppedBlob);
check('stopped face state uses the tiered time', tents.getStatText().includes('1h 1m'), tents.getStatText());

/* A tent in progress is cancelled by tick() the moment it has no
   workers, so the fixture has to be staffed — snapshot a world with a
   worker already on the card, then patch the in-flight tent into it. */
OW.Workers.assign('tents');
const pitchBlob = JSON.parse(JSON.stringify(OW.Save.serialize()));
pitchBlob.mechanics.tents = { n: 0, st: 'producing', t: 3660, ct: 4000 };
OW.Save.deserialize(pitchBlob);
const pitching = tents.getStatText();
check('pitching face state tiers the live remaining time and keeps "remaining"',
  pitching.includes('1h 1m') && pitching.endsWith('remaining'), pitching);
check('pitching face state contains no wood count (wood already spent)',
  !pitching.includes('wood'), pitching);
check('idle (Next) face state still shows the wood cost',
  nextStr.includes('wood'), nextStr);

/* ---- PAUSED caption markup contract (visibility itself is CSS) ---- */
const label = w.document.getElementById('pause-label');
const btn = w.document.getElementById('pause-play-btn');
check('a #pause-label element exists in the topbar', !!label && label.parentElement.className === 'left-hand-topbar');
check('the caption reads PAUSED in uppercase', label && label.textContent === 'PAUSED', label && label.textContent);
check('it sits after the button so the sibling selector can reach it',
  btn && label && btn.compareDocumentPosition(label) & 4);
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
check('CSS shows it only while the button carries icon-play',
  /#pause-play-btn\.icon-play ~ #pause-label\s*\{\s*display:\s*block/.test(css));
check('it is absolutely positioned so pausing never reflows the rail',
  /#pause-label\s*\{[^}]*position:\s*absolute/.test(css));
check('script.js still knows nothing about the caption',
  !fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').includes('pause-label'));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
