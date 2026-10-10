/* Tool Use (js/core/toolUse.js) in isolation — no full game boot
   needed, just Upgrades + Cycles (its only two dependencies) plus a
   tiny in-memory Resources stub. Covers the tool-in-hand gate (an
   empty stock starves the very first tick), whole-tool banking,
   frozen-progress-on-shortfall, resuming from the exact frozen point,
   the 0-workers no-op, and the header tier-pips generator. Quarry's own integration (a real consumer wired into a
   real card) is covered separately in tests/quarry.test.js. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.OrbWeaver = {};
  const store = {};
  w.OrbWeaver.Resources = {
    exists: (id) => id in store,
    get: (id) => store[id] || 0,
    // Mirrors the real crate-aware surface: parent + crate. No test
    // here stocks a crate, so it reads the same as get() throughout.
    available: (id) => (store[id] || 0) + (store[id + 'crate'] || 0),
    spend: (id, n) => { const before = store[id] || 0; store[id] = Math.max(0, before - n); return before - store[id]; },
    add: (id, n) => { store[id] = (store[id] || 0) + n; return n; }
  };
  ['js/core/upgrades.js', 'js/core/cycles.js', 'js/core/toolUse.js'].forEach((rel) => {
    w.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  });
  return { w, TU: w.OrbWeaver.ToolUse, store };
}

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

const { TU, store } = boot();

/* ---- Resource id derivation + missing-resource handling ---- */
let c = TU.createConsumer();
let r = c.tick('mtn_', 2, 1, 1); // 1 worker, 1s tick -> exactly 1 whole tool wanted
check('starved when the derived resource (mtn_tools2) does not exist at all', r.starved === true);

/* ---- Exact-stock whole-tool spend ---- */
store['mtn_tools2'] = 1;
c = TU.createConsumer();
r = c.tick('mtn_', 2, 1, 1);
check('consumes exactly 1 whole tool when exactly enough is in stock', r.starved === false && store['mtn_tools2'] === 0, `stock=${store['mtn_tools2']}`);

/* ---- Sub-whole-tool banking across several ticks: nothing spent yet ---- */
store['mtn_tools2'] = 5;
c = TU.createConsumer();
let starvedAny = false;
for (let i = 0; i < 4; i++) { r = c.tick('mtn_', 2, 1, 0.2); if (r.starved) starvedAny = true; }
check('banking under one whole tool spends nothing and never reports starved',
  store['mtn_tools2'] === 5 && !starvedAny, `stock=${store['mtn_tools2']}`);
r = c.tick('mtn_', 2, 1, 0.2); // 5th tick: 5*0.2 = 1.0 total -> crosses into 1 whole tool
check('the tick that crosses the whole-tool line spends exactly 1', store['mtn_tools2'] === 4 && !r.starved, `stock=${store['mtn_tools2']}`);

/* ---- Tool in hand: an empty stock starves the VERY FIRST tick and banks
   nothing, rather than letting the sub-whole-tool window through free ---- */
store['mtn_tools2'] = 0;
c = TU.createConsumer();
r = c.tick('mtn_', 2, 1, 0.2);
check('an empty stock starves on the very first tick, spending nothing', r.starved === true);
store['mtn_tools2'] = 5; // stock returns — the starved tick must have banked nothing
starvedAny = false;
for (let i = 0; i < 4; i++) { if (c.tick('mtn_', 2, 1, 0.2).starved) starvedAny = true; }
check('the starved tick banked no progress at all (still under a whole tool 4 ticks later)',
  store['mtn_tools2'] === 5 && !starvedAny, `stock=${store['mtn_tools2']}`);
c.tick('mtn_', 2, 1, 0.2); // 5th tick since stock returned -> 1.0 banked
check('the full 5 ticks are still needed to wear through one tool', store['mtn_tools2'] === 4, `stock=${store['mtn_tools2']}`);

/* ---- Shortfall mid-bank: frozen exactly at the pre-tick value, no partial
   credit, resumes from that exact point once stock returns ---- */
store['mtn_tools2'] = 1;
c = TU.createConsumer();
for (let i = 0; i < 4; i++) c.tick('mtn_', 2, 1, 0.2); // banks 0.8 against the tool in hand
check('banking against a single in-stock tool spends nothing until it is worn through', store['mtn_tools2'] === 1, `stock=${store['mtn_tools2']}`);
store['mtn_tools2'] = 0; // tool removed by some other route mid-bank
r = c.tick('mtn_', 2, 1, 0.2); // 5th tick would complete a whole tool; stock is 0
check('reports starved on the tick that would complete a whole tool with insufficient stock', r.starved === true);
store['mtn_tools2'] = 1; // now affordable
r = c.tick('mtn_', 2, 1, 0.2); // resumes from the frozen 0.8, this tick completes it
check('resumes from the exact frozen point once stock returns', store['mtn_tools2'] === 0 && !r.starved, `stock=${store['mtn_tools2']}`);

/* ---- isStarved(): the LAST tick's verdict, tracked in both directions.
   Deliberately a record rather than a live stock check — the tick that
   spends the final tool did real work and must still bill for it. ---- */
store['mtn_tools2'] = 1;
c = TU.createConsumer();
check('a fresh consumer is not starved before its first tick', c.isStarved() === false);
c.tick('mtn_', 2, 1, 1); // wears through the only tool in stock
check('the tick that spends the last tool is NOT reported starved',
  c.isStarved() === false && store['mtn_tools2'] === 0, `stock=${store['mtn_tools2']}`);
c.tick('mtn_', 2, 1, 0.2); // stock now empty
check('isStarved flips to true on the next tick with nothing left', c.isStarved() === true);
store['mtn_tools2'] = 3;
c.tick('mtn_', 2, 1, 0.2);
check('isStarved flips back to false once stock returns', c.isStarved() === false);

/* ---- 0 workers: no-op, never reported as starved ---- */
store['mtn_tools2'] = 0;
c = TU.createConsumer();
r = c.tick('mtn_', 2, 0, 1);
check('0 workers is a no-op, not reported as starved', r.starved === false);

/* ---- Serialize/deserialize round-trips raw accumulator progress ---- */
store['mtn_tools2'] = 100;
c = TU.createConsumer();
c.tick('mtn_', 2, 1, 0.6); // bank 0.6, well under a whole tool
const saved = c.serialize();
const c2 = TU.createConsumer();
c2.deserialize(saved);
c2.tick('mtn_', 2, 1, 0.4); // 0.6 + 0.4 = exactly 1.0 -> should complete now
check('serialize/deserialize round-trips banked progress', store['mtn_tools2'] === 99, `stock=${store['mtn_tools2']}`);

/* ---- Header tier-pips generator ---- */
const html2 = TU.getSubtitleHtml(2);
check('tier 2: exactly one crossed pip (tier I), the real II pill, and the label',
  (html2.match(/tier-pip-crossed/g) || []).length === 1 && html2.includes('>II<') && html2.includes('Requires Tier II tools'), html2);
const html1 = TU.getSubtitleHtml(1);
check('tier 1: zero crossed pips', (html1.match(/tier-pip-crossed/g) || []).length === 0 && html1.includes('Requires Tier I tools'));
const html4 = TU.getSubtitleHtml(4);
check('tier 4: exactly three crossed pips (I, II, III)', (html4.match(/tier-pip-crossed/g) || []).length === 3 && html4.includes('>IV<'));

/* ---- CSS: the label must actually render after the pills ----
   .card-tier-pill carries a hardcoded order: 1 for its original job
   (positioning among the card-face steppers/name). Reused here for the
   pills, that inherited order beat the label's default order: 0 and
   flex-ordered the label in FRONT of the pills, despite correct DOM
   order — a scoped override must reset it back to 0 so plain DOM order
   (pills, then label) actually wins the layout. */
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const scopedRule = css.match(/\.tool-pips-row\s+\.card-tier-pill\s*\{[^}]*\}/);
check("a scoped rule resets .card-tier-pill's order back to 0 inside .tool-pips-row",
  !!scopedRule && /order:\s*0\b/.test(scopedRule[0]), scopedRule && scopedRule[0]);

const iCrossed = html2.indexOf('tier-pip-crossed');
const iReal = html2.indexOf('>II<');
const iLabel = html2.indexOf('tool-pips-label');
check('DOM source order is crossed pip, then real pill, then label',
  iCrossed < iReal && iReal < iLabel, `crossed@${iCrossed} real@${iReal} label@${iLabel}`);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
