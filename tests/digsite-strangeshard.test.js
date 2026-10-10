/* Real-game integration: production, billing, saves, temporary previews and DOM controls.
   Run with Node + jsdom, like the other suites. No game or browser storage is written. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const windows = [];
let checks = 0, failures = 0;
function test(name, fn) {
  try { fn(); checks++; console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + '\n' + e.stack); }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function boot() {
  const w = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' }).window;
  windows.push(w);
  let now = 2000000000000, frames = [];
  const errors = [];
  w.Date.now = () => now;
  w.performance.now = () => 1000;
  w.requestAnimationFrame = (fn) => { frames.push(fn); return 1; };
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.IntersectionObserver = class { observe() {} unobserve() {} };
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) });
  w.console.error = (...args) => errors.push(args.join(' '));
  scripts.forEach((src) => w.eval(fs.readFileSync(path.join(root, src), 'utf8')));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver, m = OW.Mechanics.get('digsite');
  OW.Loop.stop();
  assert.deepEqual(errors, []);
  const state = () => OW.Save.serialize().mechanics.digsite;
  function load(values) {
    const d = JSON.parse(JSON.stringify(OW.Save.serialize()));
    d.mechanics.digsite = { ...d.mechanics.digsite, ...values };
    d.savedAt = 0;
    OW.Save.deserialize(d);
  }
  function unlock() {
    OW.Resources.add('stone', 1);
    m.tick(true, 0);
    OW.DigSite.completeIntro();
    OW.StrangeShard.clear();
  }
  return { w, OW, m, state, load, unlock, errors,
    clock: (ms) => { now += ms; },
    animate: (ms) => { const pending = frames; frames = []; pending.forEach((fn) => fn(ms)); } };
}

test('Stone reveals Dig Site below Stone Pit, with only the intro button and no face bars', () => {
  const { w, OW, m } = boot();
  assert.equal(m.revealed, false);
  OW.Resources.add('stonecrate', 20); m.tick(true, 0.2);
  assert.equal(m.revealed, false, 'crate alone is not loose Stone');
  OW.Resources.add('stone', 1); m.tick(true, 0.2);
  assert.equal(m.revealed, true);
  assert.equal(m.els.wrap.previousElementSibling, OW.Mechanics.get('stone').els.wrap);
  assert.equal(m.els.upgradeBar.style.display, 'none');
  assert.equal(m.els.buildBar.style.display, 'none');
  assert.equal(m.els.cardSteppersWrap.style.display, '');
  assert.equal(m.els.cardSteppersWrap.style.visibility, 'hidden');
  m.els.wrap.querySelector('.card').click();
  assert.equal(w.document.querySelector('#card-modal-body').textContent.trim(), 'Show your future');
  assert.equal(w.document.querySelector('#card-modal-header-left').childElementCount, 0);
  w.document.querySelector('[data-ds-intro]').click();
  assert.equal(OW.Cards.isModalOpenFor('digsite'), false);
  assert.equal(OW.Save.serialize().mechanics.digsite.introDone, true);
  assert.equal(m.els.cardSteppersWrap.style.visibility, '');
});

test('Parked workers show Dark; Brazier face bar mirrors heat and survives save/load', () => {
  const { OW, m, load, unlock, animate } = boot(); unlock();
  assert.equal(m.getStatText(), '');
  OW.Workers.assign('digsite');
  assert.equal(m.els.statEl.textContent, 'Dark');
  assert.equal(m.getBillableCount(), 0);
  OW.DigSite.subAssign('brazier'); OW.Resources.setRaw('wood', 100);
  m.tick(true, 1);
  assert.equal(m.getStatText(), 'Heating');
  load({ wood: 25, burning: false });
  animate(1000); animate(1400);
  near(parseFloat(m.els.buildBar.style.width), 50);
  assert.equal(m.els.buildBar.classList.contains('bar-collecting'), true);
  assert.equal(m.els.upgradeBar.style.display, 'none');
  load({ wood: 40, burning: true });
  animate(2000); animate(2400);
  near(parseFloat(m.els.buildBar.style.width), 80);
  assert.equal(m.els.buildBar.classList.contains('bar-collecting'), false);
  OW.DigSite.subUnassign('brazier'); // a modal − returns the worker to idle
  assert.equal(OW.Workers.getAssigned('digsite'), 0);
  assert.equal(m.getStatText(), '');
});

test('One shared roll respects workers, global modifiers, overflow and whole rewards', () => {
  const { w, OW, m, state, unlock } = boot(); unlock();
  w.Math.random = () => 0;
  OW.DigSite.subAssign('dig');
  for (let i = 0; i < 25; i++) m.tick(true, 0.2);
  assert.equal(state().history.length, 1);
  assert.equal(OW.Resources.get('stone'), 2);
  OW.Upgrades.setGlobalMods({ m: 1, p: 0, f: 0 });
  m.tick(true, 2.5);
  assert.equal(state().history.length, 2);
  OW.Upgrades.setGlobalMods({ m: 0, p: 0, f: 0 });
  for (let i = 0; i < 4; i++) OW.DigSite.subAssign('dig');
  m.tick(true, 3.4);
  assert.equal(state().history.length, 5);
  near(state().progress, 2);
  w.Math.random = () => 0.999;
  m.tick(true, 0.6);
  assert.equal(OW.Resources.get('researchpapers'), 1);
  assert.equal(OW.Resources.isHidden('researchpapers'), false);
});

test('Heating gives no bonus or burn; capacity-limited filling loses no wood', () => {
  const { OW, m, state, load, unlock } = boot(); unlock();
  for (let i = 0; i < 5; i++) OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 100);
  load({ wood: 40, burning: false });
  near(OW.DigSite.researchChance(), 0);
  m.tick(true, 1);
  near(state().wood, 45);
  assert.equal(state().burning, false);
  near(OW.DigSite.researchChance(), 0);
  load({ wood: 49 });
  const before = OW.Resources.get('wood');
  m.tick(true, 1);
  near(OW.Resources.get('wood'), before - 1);
  near(state().wood, 48);
  assert.equal(state().burning, true);
  near(OW.DigSite.researchChance(), 48);
});

test('Brazier draws loose Wood before Camp crates, never Mountains wood', () => {
  const { OW, m, state, unlock } = boot(); unlock();
  OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 0.5);
  OW.Resources.setRaw('woodcrate', 10);
  OW.Resources.setRaw('mtn_wood', 100);
  m.tick(true, 2);
  near(state().wood, 2);
  near(OW.Resources.get('wood'), 0);
  near(OW.Resources.get('woodcrate'), 8.5);
  near(OW.Resources.get('mtn_wood'), 100);
});

test('Sufficient stoking holds Burning; understaffing drains to empty and reheats', () => {
  const { OW, m, state, load, unlock } = boot(); unlock();
  OW.DigSite.subAssign('brazier'); OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 1000);
  load({ wood: 49.6, burning: true });
  for (let i = 0; i < 50; i++) m.tick(true, 0.2);
  near(state().wood, 49.6); assert.equal(state().burning, true);
  OW.DigSite.subUnassign('brazier');
  for (let i = 0; i < 248; i++) m.tick(true, 0.2);
  near(state().wood, 0); assert.equal(state().burning, false);
  m.tick(true, 1);
  near(state().wood, 1); near(OW.DigSite.researchChance(), 0);
});

test('Odds combine raw Dig workers with Burning wood, after this tick fills and burns', () => {
  const { w, OW, m, state, load, unlock } = boot(); unlock();
  OW.Workers.addWorkers(100);
  for (let i = 0; i < 50; i++) OW.DigSite.subAssign('dig');
  OW.DigSite.subAssign('brazier'); OW.Resources.setRaw('wood', 100);
  load({ wood: 50, burning: true }); near(OW.DigSite.researchChance(), 100);
  w.Math.random = () => 0.001; // falls in the 0.4% Stone chance AFTER burning
  m.tick(true, 0.2);
  near(OW.DigSite.researchChance(), 99.6);
  assert.equal(state().lastReward, 'stone');
  for (let i = 0; i < 51; i++) OW.DigSite.subAssign('dig');
  load({ wood: 0, burning: false }); near(OW.DigSite.researchChance(), 100);
  m.tick(true, 0.2); assert.equal(state().lastReward, 'research');
});

test('Gold starvation freezes Dig/fill, but fire still burns; zero-length ticks change nothing', () => {
  const { OW, m, state, load, unlock } = boot(); unlock();
  OW.DigSite.subAssign('dig'); OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 100);
  load({ progress: 2, wood: 4, burning: true });
  const before = JSON.stringify(state()); m.tick(true, 0);
  assert.equal(JSON.stringify(state()), before);
  OW.Resources.setRaw('gold', 0); m.tick(false, 1);
  near(state().wood, 2); near(state().progress, 2);
  near(OW.Resources.get('wood'), 100); assert.equal(m.getStatText(), 'Stopped');
  m.tick(false, 1); assert.equal(state().burning, false);
  OW.Resources.setRaw('gold', 100); m.tick(true, 1);
  near(state().wood, 1); near(state().progress, 3);
});

test('Billing charges working slots only; wood-starved workers stay assigned for free', () => {
  const { OW, m, unlock } = boot(); unlock();
  OW.Workers.assign('digsite'); OW.Workers.assign('digsite'); OW.Workers.assign('digsite');
  OW.DigSite.subAssign('dig'); OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 0); OW.Resources.setRaw('gold', 100);
  OW.Loop.runBulk(1, 1);
  near(OW.Resources.get('gold'), 99);
  assert.equal(OW.Save.serialize().mechanics.digsite.workers.brazier, 1);
  OW.Resources.setRaw('wood', 10); OW.Loop.runBulk(1, 1);
  near(OW.Resources.get('gold'), 97);
  OW.Workers.recallAll();
  assert.equal(m.getBillableCount(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(OW.Save.serialize().mechanics.digsite.workers)), { dig: 0, brazier: 0 });
});

test('Modal has two live bars, amber heating/burning classes, minimal rates and functioning steppers', () => {
  const { w, OW, m, load, unlock, animate } = boot(); unlock();
  w.performance.now = () => 2000; // past the intro-close ghost-click guard
  m.els.wrap.querySelector('.card').click();
  const body = w.document.querySelector('#card-modal-body');
  assert.equal(body.querySelectorAll('[data-extra-track]').length, 2);
  body.querySelector('[data-ds-plus="dig"]').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  body.querySelector('[data-ds-plus="dig"]').dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(body.querySelector('[data-ds-count="dig"]').textContent, '1');
  assert.equal(body.querySelector('[data-ds-rate="dig"]').textContent, 'Digging .20/s');
  OW.Resources.setRaw('wood', 100); OW.DigSite.subAssign('brazier');
  load({ wood: 25, burning: false, progress: 2.5 }); m.patchLiveTrack(); animate(3000); animate(4000);
  near(parseFloat(body.querySelector('[data-extra-track="ds-dig"]').style.width), 50);
  near(parseFloat(body.querySelector('[data-extra-track="ds-brazier"]').style.width), 50);
  assert.equal(body.querySelector('[data-ds-chance]').textContent, '1%');
  assert.equal(body.querySelector('.ds-brazier-bar').classList.contains('ds-burning'), false);
  load({ burning: true }); m.patchLiveTrack();
  assert.equal(body.querySelector('.ds-brazier-bar').classList.contains('ds-burning'), true);
  assert.equal(body.querySelector('[data-ds-chance]').textContent, '26%');
});

test('History prunes on load/read without new rolls and counts offline rolls at return time', () => {
  const { w, OW, m, state, load, unlock, clock } = boot(); unlock();
  const time = w.Date.now();
  load({ lastReward: 'research', history: [{ type: 'stone', time: time - 3600001 }, { type: 'research', time: time - 1000 }] });
  assert.equal(state().history.length, 1);
  OW.DigSite.subAssign('dig'); w.Math.random = () => 0.999;
  OW.Loop.runBulk(50, 1); // same coarse step that offline replay uses
  assert.equal(state().history.length, 11);
  assert.equal(state().history[10].time, time);
  clock(3600001);
  assert.equal(state().history.length, 0);
  assert.equal(state().lastReward, 'research', 'last reward outlives the hour window');
});

test('Dig state survives a save with worker counts, progress, wood, fire and exact outcomes', () => {
  const A = boot(); A.unlock(); A.OW.DigSite.subAssign('dig'); A.OW.DigSite.subAssign('brazier');
  A.load({ wood: 12, burning: true, progress: 2.2, history: [{ type: 'research', time: A.w.Date.now() }], lastReward: 'research' });
  const saved = JSON.parse(JSON.stringify(A.OW.Save.serialize())); saved.savedAt = 0;
  const B = boot(); B.OW.Save.deserialize(saved);
  assert.equal(JSON.stringify(B.state()), JSON.stringify(A.state()));
  A.w.Math.random = B.w.Math.random = () => 0.9;
  A.OW.Loop.runBulk(10, 0.2); B.OW.Loop.runBulk(10, 0.2);
  assert.equal(JSON.stringify(B.state()), JSON.stringify(A.state()));
  assert.equal(B.m.revealed, true);
});

test('Strange Shard excludes visible/debug/vehicle/tutorial cards without saving preview unlocks', () => {
  const { OW } = boot(); OW.StrangeShard.start();
  const cards = OW.Mechanics.all();
  assert.ok(cards.some((m) => m._previewLock));
  cards.filter((m) => m.isMule || m.id.startsWith('richuncle') || m.id === 'mpftest' || m.revealed).forEach((m) => assert.ok(!m._previewLock, m.id));
  const saved = OW.Save.serialize();
  cards.filter((m) => m._previewLock).forEach((m) => {
    assert.equal(m.revealed, false); assert.equal(saved.cards[m.id].r, 0);
  });
  assert.equal(OW.Mountains.isDiscovered(), false);
  assert.equal(OW.SandDunes.isDiscovered(), false);
});

test('Preview locks worker buttons and modal clicks, and the original smoothing loop reads overrides', () => {
  const { w, OW, animate } = boot();
  const m = OW.Mechanics.get('stone'), original = m.getUpgradeBarPct;
  OW.StrangeShard.start();
  m.els.cardStepperPlus.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  m.els.wrap.querySelector('.card').click();
  assert.equal(OW.Workers.getAssigned('stone'), 0);
  assert.equal(OW.Cards.isModalOpenFor('stone'), false);
  animate(1000); animate(1400);
  near(parseFloat(m.els.upgradeBar.style.width), 100);
  OW.Mechanics.get('strangeshard').tick(false, 5);
  animate(2000); animate(2400);
  assert.ok(parseFloat(m.els.upgradeBar.style.width) < 100);
  OW.StrangeShard.clear();
  assert.equal(m.getUpgradeBarPct, original);
  assert.equal(m.els.wrap.hasAttribute('inert'), false);
});

test('Document order sets 20-to-10 second lifetimes and each location restores independently', () => {
  const { w, OW } = boot(); OW.StrangeShard.start();
  const ordered = Array.from(w.document.querySelectorAll('.card-wrap')).map((el) => OW.Mechanics.all().find((m) => m.els && m.els.wrap === el)).filter((m) => m && m._previewLock);
  const ticker = OW.Mechanics.get('strangeshard'); ticker.tick(false, 5);
  ordered.forEach((m, i) => {
    const duration = 20 - 10 * i / (ordered.length - 1);
    near(m.getUpgradeBarPct(), (duration - 5) / duration * 100);
  });
  // Sand Dunes (last location) restores once its FIRST card in document
  // order — the longest-lived of its cards — runs out.
  const sdEnd = 20 - 10 * ordered.findIndex((m) => m.section === 'Sand Dunes') / (ordered.length - 1);
  ticker.tick(false, sdEnd - 5);
  assert.equal(w.document.querySelector('#sanddunes-section').style.display, 'none');
  assert.equal(w.document.querySelector('#mountains-section').style.display, '');
  ticker.tick(false, 6);
  assert.equal(w.document.querySelector('#mountains-section').style.display, 'none');
  assert.ok(ordered[0]._previewLock, 'Camp still counting down');
  ticker.tick(false, 4);
  assert.ok(ordered.every((m) => !m._previewLock));
  assert.equal(w.document.querySelector('#camp-section-label').style.display, 'none');
});

test('Real card unlock and location discovery during a preview permanently win', () => {
  const { w, OW } = boot(); OW.StrangeShard.start();
  const stone = OW.Mechanics.get('stone'); OW.Cards.reveal(stone);
  OW.Mountains.reveal();
  OW.Mechanics.get('strangeshard').tick(true, 20);
  assert.equal(stone.revealed, true); assert.equal(stone.els.wrap.style.display, '');
  assert.equal(stone._previewLock, undefined);
  assert.equal(OW.Mountains.isDiscovered(), true);
  assert.equal(w.document.querySelector('#mountains-section').style.display, '');
  assert.equal(w.document.querySelector('#camp-section-label').style.display, '');
  assert.equal(w.document.querySelector('#sanddunes-section').style.display, 'none');
});

test('Preview gaps collapse at the final countdown; vehicle gaps and real unlocks are untouched', () => {
  const { w, OW } = boot();
  const stone = OW.Mechanics.get('stone');
  stone.els.wrap.getBoundingClientRect = () => ({ top: 100, bottom: 140 });
  const grid = w.document.querySelector('#grid-camp'); grid.style.display = 'none';
  OW.StrangeShard.start(); assert.equal(grid.style.display, '');
  const vehicle = OW.Mechanics.all().find((m) => m.isMule && m.gapOnHide);
  vehicle.els.wrap.style.visibility = 'hidden'; vehicle.els.wrap.style.display = '';
  OW.Mechanics.get('strangeshard').tick(true, 19);
  assert.equal(stone.els.wrap.style.visibility, 'hidden');
  assert.notEqual(stone.els.wrap.style.display, 'none');
  OW.Mechanics.get('strangeshard').tick(true, 1);
  for (const id of ['stone', 'toolshed', 'tents']) {
    const card = OW.Mechanics.get(id);
    assert.equal(card.els.wrap.style.display, 'none');
    assert.equal(card.els.wrap.style.visibility, '');
  }
  assert.equal(vehicle.els.wrap.style.visibility, 'hidden');
  assert.equal(vehicle.els.wrap.style.display, '');
  assert.equal(grid.style.display, 'none');
  assert.equal(stone.gapOnHide, undefined);
  OW.StrangeShard.start();
  const saved = JSON.parse(JSON.stringify(OW.Save.serialize())); saved.savedAt = 0;
  OW.Save.deserialize(saved);
  assert.equal(OW.Mechanics.all().some((m) => m._previewLock), false);
  assert.equal(stone.els.wrap.style.display, 'none');
});

test('Reload ends preview, preserves completed intro; old saves start Dig Site cleanly', () => {
  const A = boot(); A.OW.Resources.add('stone', 1); A.m.tick(true, 0); A.OW.DigSite.completeIntro();
  const saved = JSON.parse(JSON.stringify(A.OW.Save.serialize())); saved.savedAt = 0;
  const B = boot(); B.OW.Save.deserialize(saved);
  assert.equal(B.state().introDone, true);
  assert.ok(B.OW.Mechanics.all().every((m) => !m._previewLock));
  assert.equal(B.OW.Mountains.isDiscovered(), false);
  delete saved.mechanics.digsite; delete saved.cards.digsite;
  const C = boot(); C.OW.Save.deserialize(saved);
  assert.equal(C.state().introDone, false); assert.equal(C.m.revealed, true);
});

windows.forEach((w) => w.close());
console.log(`\n${checks} passed, ${failures} failed.`);
process.exitCode = failures ? 1 : 0;
