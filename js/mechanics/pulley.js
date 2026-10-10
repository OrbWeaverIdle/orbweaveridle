/* ============================================================
   MECHANIC: PULLEY (Mountains <-> Sand Dunes)
   One shared storage (STORE_CAP total, workers one slot each) hanging
   over the collapse, reached from two ends: the Mountains end lives in
   the Collapsed Path modal, the Sand Dunes end is this file's own card
   (also named Collapsed Path). Both appear once Collapsed Path builds
   the pulley (build()).

   The Sand Dunes card also digs the collapse from its side: its card
   workers split (collapsedpath.js createSplit()) between clearing —
   collapsedpath.js's Sand Dunes clearer, same shared count as the
   Mountains side — and this end's counterweight builders and crew.
   Clearing the pass closes the pulley (close()) and hides this card
   for good.

   Each end runs one trip at a time, loading and unloading on its own.
   Up moves cargo from that end into storage; Down moves it from storage
   out to that end; either carries at most TRIP_CAP and takes TRIP_TIME
   with no crew and no gold.

   COUNTERWEIGHT — each end builds its own, below its Pulley section:
   builders haul CW_STONE of that end's stone in at the worker rate
   (gold-gated), like the ladder. Once hung, that end's section becomes
   "Pulley & counterweight": its crew now drives every trip from that
   end — TRIP_TIME of work at the standard worker rate (so MPF buffs
   apply; no crew or no gold and the trip stands still, and the crew
   bills only while a trip moves). Its switch repeats the same load
   whenever that end is idle, waiting (unbilled) until the full load is
   available, and switches itself off when an Up finds storage full.
   Cargo leaves its source when sent; Up capacity is reserved then too,
   so two ends can never overfill storage. Workers riding or stored are
   sequestered from their pool until they arrive somewhere.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;

  const SD_ID = 'sdpulley';
  const STORE_CAP = 200;
  const TRIP_TIME = 300;     // seconds per trip (5 minutes)
  const TRIP_CAP = 50;       // most cargo one trip carries, up or down
  const CW_STONE = 10000;    // counterweight cost, per end (that end's stone)
  const HAUL = 'pulley_haul';  // transient assignment used to lift idle workers onto the pulley
  const COLORS = { workers: '#c9a46b', wood: '#7a9e7a', stone: '#8a8f99' };
  const MORE_COLORS = ['#b58db8', '#6fa3a8', '#c98b6b', '#d4c47f'];

  let built = false;
  let store = {};            // base id ('workers', 'wood', ...) -> { name, n }
  const ends = {};           // end key -> end (see makeEnd)
  let shownBg = null;        // last card-face bar background written (see sdMech.tick)

  const pct = (a, b) => Math.min(100, (a / b) * 100);
  const mmss = (t) => { const s = Math.ceil(t); return s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`; };
  const rate = (n) => OW.Upgrades.workerRate(n, 1, 1, 0);
  const splits = OW.CollapsedPath.splits;
  const stored = () => Object.values(store).reduce((a, s) => a + s.n, 0);
  const incoming = () => Object.values(ends).reduce((a, e) => a + (e.trip && e.trip.up ? e.trip.n : 0), 0);
  const free = () => Math.max(0, STORE_CAP - stored() - incoming());
  const color = (id, i) => COLORS[id] || MORE_COLORS[i % MORE_COLORS.length];
  const refreshAll = () => Object.values(ends).forEach((e) => OW.Cards.refreshOpenModal(e.cardId));

  // Mockup C: one segmented bar colored by contents, a tag per item.
  function storageHtml() {
    const keys = Object.keys(store);
    return `<div class="hs-card ps-card">
      <div class="hs-head"><span class="hs-title">Pulley storage</span><span class="detail-status">${stored()}/${STORE_CAP}</span></div>
      <div class="hs-body">
        <div class="ps-strip">${keys.map((k, i) => `<div style="width:${pct(store[k].n, STORE_CAP)}%;background:${color(k, i)}"></div>`).join('')}</div>
        <div class="ps-tags">${keys.map((k, i) => `<span class="ps-tag"><span style="color:${color(k, i)}">■</span> ${store[k].name} ${store[k].n}</span>`).join('')}
          <span class="ps-tag ps-free">${free()} free</span></div>
      </div></div>`;
  }

  // The same contents as storageHtml()'s strip, as hard color bands for
  // the card-face top bar: each band's share of the filled part is its
  // share of what's stored, so bar and modal always read alike.
  function barBackground() {
    const keys = Object.keys(store), total = stored();
    if (!total) return '';
    let at = 0;
    return `linear-gradient(to right, ${keys.map((k, i) => {
      const from = at; at += (store[k].n / total) * 100;
      return `${color(k, i)} ${from}% ${at}%`;
    }).join(', ')})`;
  }

  // loc: a Locations entry; cardId: the card whose modal shows this end;
  // split: that card's area split (its crew and cwb slots); desc: the
  // Pulley section's flavor line before the counterweight.
  function makeEnd(key, loc, cardId, split, desc) {
    const e = { cardId, trip: null, up: true, cargo: 'workers', cargoName: 'Workers', qty: 50, auto: false, waiting: false,
      cw: false, hauled: 0, cwBuilding: false };
    const stone = loc.prefix + 'stone';
    const crew = () => split.get('crew'), cwb = () => split.get('cwb');
    // Trip speed in work-seconds per second: 1 before the counterweight;
    // after it, only its crew moves the pulley, and only while gold lasts.
    const speed = () => (!e.cw ? 1 : crew() && OW.Resources.get('gold') > 0 ? rate(crew()) : 0);
    const q = (sel) => document.querySelector(`#card-modal-body ${sel}`);
    // Up: this end's idle workers and visible rows (crates ride with their
    // parent). Down: whatever sits in storage. A repeat keeps its cargo
    // listed even while none is left, so it waits rather than switching.
    e.options = () => {
      const opts = e.up ? [{ id: 'workers', name: 'Workers', n: loc.workerPool.getIdleCount() }].concat(OW.Resources.all()
        .filter((r) => r.id.startsWith(loc.prefix) && !r.hidden && !r.id.endsWith('crate'))
        .map((r) => ({ id: r.id.slice(loc.prefix.length), name: r.name, n: Math.floor(OW.Resources.available(r.id)) })))
        : Object.keys(store).map((id) => ({ id, name: store[id].name, n: store[id].n }));
      if (e.auto && !opts.some((o) => o.id === e.cargo)) opts.push({ id: e.cargo, name: e.cargoName, n: 0 });
      return opts;
    };
    e.pct = () => (e.trip ? pct(TRIP_TIME - e.trip.t, TRIP_TIME) : 0);
    e.barPct = () => (e.trip ? e.pct() : pct(e.hauled, CW_STONE));
    e.showBar = () => !!e.trip || (!e.cw && e.hauled > 0);
    e.billable = () => (e.cwBuilding ? cwb() : 0) + (e.trip && e.cw && speed() ? crew() : 0);
    const waitText = () => (e.waiting ? `Waiting for ${Math.min(Math.floor(e.qty), TRIP_CAP)} ${e.cargoName}` : '');
    e.status = () => (e.trip ? (speed() ? `Hoisting ${mmss(e.trip.t / speed())}` : 'Stopped')
      : waitText() || (e.cwBuilding ? 'Building Counterweight' : ''));
    const tripText = () => `${e.trip.up ? 'Up' : 'Down'}: ${e.trip.n} ${e.trip.name} — ${speed() ? e.status()
      : `Stopped — needs ${crew() ? 'gold' : 'a worker'}`}${e.auto ? ' · repeats' : ''}`;
    const tripLabel = () => (!e.cw || crew() ? `Trip ${mmss(TRIP_TIME / (e.cw ? rate(crew()) : 1))}` : 'Needs a worker');
    const cwText = () => `Counterweight — ${Math.floor(e.hauled).toLocaleString('en-US')}/${CW_STONE.toLocaleString('en-US')} Stone${cwb() && !e.cwBuilding ? ' · Stopped' : ''}`;

    e.send = () => {
      const o = e.options().find((x) => x.id === e.cargo);
      const n = o ? Math.min(Math.floor(e.qty), TRIP_CAP, o.n, e.up ? free() : Infinity) : 0;
      if (!built || e.trip || n <= 0) return false; // !built: a cheat can reveal the card before the pulley exists
      if (!e.up) { if ((store[o.id].n -= n) <= 0) delete store[o.id]; }
      else if (o.id === 'workers') { for (let i = 0; i < n; i++) loc.workerPool.assign(HAUL); loc.workerPool.sequester(HAUL); }
      else OW.Resources.spend(loc.prefix + o.id, n);
      e.trip = { up: e.up, id: o.id, name: o.name, n, t: TRIP_TIME };
      e.cargoName = o.name; e.waiting = false;
      OW.Footer.push(`Hoisting ${n} ${o.name} ${e.up ? 'into' : 'out of'} pulley storage at ${loc.label}.`);
      return true;
    };
    // The repeat switch, on an idle end: an Up into full storage switches
    // it off; otherwise it waits until the whole load is there to send
    // (all of it, or whatever storage still has room for).
    function repeat() {
      if (e.up && free() <= 0) {
        e.auto = e.waiting = false;
        OW.Footer.push(`Pulley storage is full. Repeat switched off at ${loc.label}.`);
        refreshAll();
        return;
      }
      const o = e.options().find((x) => x.id === e.cargo);
      const want = Math.min(Math.floor(e.qty), TRIP_CAP, e.up ? free() : Infinity);
      const wasWaiting = e.waiting;
      e.waiting = !(want > 0 && o && o.n >= want && e.send());
      if (!e.waiting || !wasWaiting) refreshAll();
    }
    function arrive() {
      const t = e.trip;
      if (t.up) store[t.id] = { name: t.name, n: (store[t.id] ? store[t.id].n : 0) + t.n };
      else if (t.id === 'workers') loc.addWorkers(t.n);
      else OW.Resources.add(loc.ensureResource(t.id, t.name), t.n);
      OW.Footer.push(`Pulley ${t.up ? 'stores' : 'lowers'} ${t.n} ${t.name} ${t.up ? 'from' : 'at'} ${loc.label}.`);
      e.trip = null;
      refreshAll();
    }
    e.tick = (goldAvailable, dt) => {
      if (!built) return;
      // Counterweight: builders haul this end's stone in, like the ladder.
      if (!e.cw) {
        e.cwBuilding = cwb() > 0 && goldAvailable && OW.Resources.available(stone) > 0;
        const take = e.cwBuilding ? Math.min(rate(cwb()) * dt, OW.Resources.available(stone), CW_STONE - e.hauled) : 0;
        if (take > 0) {
          OW.Resources.spend(stone, take);
          e.hauled += take;
          if (e.hauled >= CW_STONE - 1e-9) {
            e.cw = true; e.cwBuilding = false; e.hauled = CW_STONE;
            split.clear('cwb'); // builders step back onto the card
            OW.Footer.push(`Hung a counterweight on the pulley at ${loc.label}.`);
            OW.Cards.refreshOpenModal(cardId);
          }
        }
      }
      if (e.trip) { if ((e.trip.t -= speed() * dt) <= 0) arrive(); }
      else if (e.auto) repeat();
    };
    e.finishNow = () => { if (e.trip) arrive(); };

    e.html = () => {
      if (e.trip) return `<div class="detail-status" data-pe-trip="${key}">${tripText()}</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar" data-pe-bar="${key}" style="width:${e.pct()}%"></div></div>`;
      const opts = e.options();
      if (!opts.some((o) => o.id === e.cargo)) e.cargo = opts.length ? opts[0].id : '';
      return `<div class="cp-haul">
          <button class="action-btn ${e.up ? 'active' : ''}" data-pe="${key}" data-pe-action="up">Up ▲</button>
          <button class="action-btn ${e.up ? '' : 'active'}" data-pe="${key}" data-pe-action="down">Down ▼</button>
        </div>
        <div class="cp-haul">
          <select class="sp-select" data-pe-cargo="${key}">${opts.map((o) => `<option value="${o.id}" ${o.id === e.cargo ? 'selected' : ''}>${o.name} (${o.n})</option>`).join('') || '<option>Storage is empty</option>'}</select>
          <input class="cargo-qty-input" data-pe-qty="${key}" type="number" min="1" max="${TRIP_CAP}" value="${e.qty}">
          <button class="action-btn hs-btn-right" data-pe="${key}" data-pe-action="send">Send</button>
        </div>${e.auto ? `<div class="detail-status" data-pe-wait="${key}">${waitText()}</div>` : ''}`;
    };
    // The Pulley section, then (until it's hung) the Counterweight below it.
    e.sectionHtml = () => `<div class="hs-card">
        <div class="hs-head"><span class="cp-head">${e.cw ? split.stepperHtml('crew') : ''}<span class="hs-title">${e.cw ? 'Pulley &amp; counterweight' : 'Pulley'}</span></span>
          <span class="pe-head-right"><span class="detail-status" data-pe-time="${key}">${tripLabel()}</span>${e.cw
            ? `<div class="toggle-switch${e.auto ? ' on' : ''}" data-pe="${key}" data-pe-action="auto" title="Repeat"></div>` : ''}</span></div>
        <div class="hs-body"><span class="upgrade-desc">${e.cw ? 'Workers on the counterweight speed up trips from this side: 1 worker 5m, 2 workers 2m 30s. The switch repeats the same load after each trip and turns itself off when storage is full.' : desc}</span>${e.html()}</div>
      </div>${e.cw ? '' : `<div class="hs-card">
        <div class="hs-head"><span class="cp-head">${split.stepperHtml('cwb')}<span class="hs-title">Counterweight</span></span><span class="detail-status">${CW_STONE.toLocaleString('en-US')} Stone</span></div>
        <div class="hs-body"><span class="upgrade-desc">Hang a stone counterweight from this end of the pulley. Once it's built, workers crew the pulley to speed up trips from this side.</span>
          <div class="detail-status" data-pe-cw="${key}">${cwText()}</div>
          <div class="detail-progress-wrap"><div class="detail-progress-bar" data-pe-cw-bar="${key}" style="width:${pct(e.hauled, CW_STONE)}%"></div></div>
        </div></div>`}`;
    e.patch = () => {
      const set = (sel, v) => { const el = q(sel); if (el) el.textContent = v; };
      const bar = (sel, v) => { const el = q(sel); if (el) el.style.width = `${v}%`; };
      set(`[data-pe-time="${key}"]`, tripLabel());
      set(`[data-pe-wait="${key}"]`, waitText());
      if (!e.cw) { set(`[data-pe-cw="${key}"]`, cwText()); bar(`[data-pe-cw-bar="${key}"]`, pct(e.hauled, CW_STONE)); }
      if (e.trip) { set(`[data-pe-trip="${key}"]`, tripText()); bar(`[data-pe-bar="${key}"]`, e.pct()); }
    };
    e.save = () => ({ u: e.up ? 1 : 0, c: e.cargo, cn: e.cargoName, q: e.qty, a: e.auto ? 1 : 0, w: e.cw ? 1 : 0, h: e.hauled });
    e.load = (d) => {
      d = d || {};
      e.up = d.u !== 0; e.cargo = d.c || 'workers'; e.cargoName = d.cn || 'Workers'; e.qty = d.q != null ? d.q : 50;
      e.auto = !!d.a; e.cw = !!d.w; e.hauled = d.h || 0; e.waiting = false;
    };
    return (ends[key] = e);
  }

  const mtn = makeEnd('mtn', OW.Mountains, 'collapsedpath', splits.mtn, 'The pulley hoists cargo on its own.');
  const sd = makeEnd('sd', OW.SandDunes, SD_ID, splits.sd, 'Up stores cargo from here; Down brings it out of storage.');

  const sdPool = OW.SandDunes.workerPool;
  const clr = OW.CollapsedPath.sdClearer; // this side's clearers (the split's clear slot)

  const sdMech = {
    id: SD_ID,
    startHidden: true,
    section: 'Sand Dunes',
    modalTheme: 'theme-sanddunes',
    workerPool: sdPool,
    getBillableCount: () => clr.billable() + sd.billable(),
    cardName: () => 'Collapsed Path',
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots: () => ['clear', sd.cw ? 'crew' : 'cwb'], subAdd: splits.sd.add,
    getStatText: () => clr.stat() || sd.status() || (clr.status === 'stopped' ? 'Stopped' : ''),
    // Top bar: storage fill, banded in the storage colors (barBackground()). Bottom bar: this end's trip.
    upgradeTrackKey: 'pe-none', buildTrackKey: 'pe-none', // this card patches its own modal bars
    getUpgradeBarPct: () => pct(stored(), STORE_CAP),
    getBuildBarPct: sd.barPct,
    hideBuildBar: () => !sd.showBar(),
    renderModalHTML: () => `<div class="cp-areas">${clr.html(splits.sd.stepperHtml('clear'))}${storageHtml()}${sd.sectionHtml()}</div>`,
    patchLiveTrack() { clr.patch(); splits.sd.patch(); sd.patch(); },
    afterRender: () => splits.sd.wire(sdMech),
    // Both ends tick here, so the Mountains end keeps running after the
    // Collapsed Path card is gone.
    tick(goldAvailable, tickRate) {
      mtn.tick(goldAvailable, tickRate); sd.tick(goldAvailable, tickRate); clr.tick(goldAvailable, tickRate);
      OW.Cards.refresh(sdMech);
      const bar = sdMech.els && sdMech.els.upgradeBar, bg = barBackground();
      if (bar && bg !== shownBg) bar.style.background = shownBg = bg; // multi-color storage fill
    }
  };

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-pe-action]');
    if (!btn) return;
    const e = ends[btn.dataset.pe], act = btn.dataset.peAction;
    if (act === 'send') e.send();
    else if (act === 'auto') { e.auto = !e.auto; e.waiting = false; }
    else e.up = act === 'up';
    refreshAll();
  });
  document.addEventListener('change', (ev) => { const k = ev.target.dataset.peCargo; if (k) { ends[k].cargo = ev.target.value; refreshAll(); } });
  document.addEventListener('input', (ev) => { const k = ev.target.dataset.peQty; if (k) ends[k].qty = Math.min(TRIP_CAP, +ev.target.value || 0); });

  // Stored and in-flight workers are out of their pools' totals
  // (sequester), so storage and trips must return with the pools. Each
  // end's delivery settings save too, so a repeat resumes as it was.
  OW.Save.register('pulley',
    () => ({ b: built ? 1 : 0, s: store, mt: mtn.trip, st: sd.trip, me: mtn.save(), se: sd.save() }),
    (d) => {
      if (!d) return;
      built = !!d.b; store = d.s || {}; mtn.trip = d.mt || null; sd.trip = d.st || null;
      mtn.load(d.me); sd.load(d.se);
    });

  OW.Mechanics.register(sdMech);
  OW.Pulley = {
    mtn, sd, storageHtml, isBuilt: () => built,
    // The pass is cleared: trips land, storage empties into one location
    // (Sand Dunes), and the Sand Dunes card frees its workers and hides.
    close(loc) {
      mtn.auto = sd.auto = false;
      mtn.finishNow(); sd.finishNow();
      Object.keys(store).forEach((id) => {
        if (id === 'workers') loc.addWorkers(store[id].n);
        else OW.Resources.add(loc.ensureResource(id, store[id].name), store[id].n);
      });
      store = {};
      while (sdPool.unassign(SD_ID));
      OW.Cards.hide(sdMech);
    },
    build() { built = true; OW.Cards.reveal(sdMech); }
  };
})();
