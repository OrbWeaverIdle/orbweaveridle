/* ============================================================
   MECHANIC: COLLAPSED PATH (Mountains)
   The only road to Sand Dunes, revealed by claiming the Mountains
   'blockedexit' travel path (mountains.js). Two areas in one modal:

   The card stepper (face + modal header) holds the card's workers; each
   area's own stepper splits them (createSplit(), mountains_sub_slots):
   + takes a free card worker, promoting one from the pool if none is
   free; − frees it back onto the card. A card-level − takes a free
   worker first, then builders, then pulley crew, then clearers — never
   moves one area's workers into another. The Sand Dunes Collapsed Path
   card (pulley.js) uses the same split over its own pool.

   CLEARING THE PATH — its workers each wear through one Tier III tool
   per second via js/core/toolUse.js (1 tool/worker/s baseline, gold-gated).
   The Sand Dunes Collapsed Path card (pulley.js) digs the same collapse
   from the other side with Sand Dunes workers and sd_tools3: both ends
   run a makeClearer() over the one shared `cleared` count, so either
   side's work shortens the other's. CLEAR_TOOLS tools worn through in
   total clears the pass: both cards hide for good, everything in pulley
   storage is delivered to Sand Dunes, and Sand Dunes becomes a Scout
   Stable destination (sanddunes.js isReachable()).

   LADDER, then PULLEY — its workers build the next project by hauling
   its resource in at the standard worker rate (1/worker/s, gold-gated):
   a Wood ladder, then a Stone pulley. The area is titled for what it
   builds, so nothing names the pulley until the ladder stands.
   Finishing either frees its builders back onto the card; the ladder
   also offers "Peer over the top", which closes the modal and reveals
   Sand Dunes (discover only). Once the pulley stands, pulley.js owns
   the area (its Pulley and Counterweight sections).
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;

  const ID = 'collapsedpath';
  const CLEAR_TOOLS = 999;   // Tier III tools worn through to clear the pass
  const LADDER_WOOD = 300;   // mtn_wood
  const PULLEY_STONE = 1000; // mtn_stone
  const pool = OW.Mountains.workerPool;

  let cleared = 0, done = false, ladder = false, peered = false, built = 0; // built: resource hauled into the current project
  let building = false;
  const P = () => OW.Pulley;

  const pct = (a, b) => Math.min(100, (a / b) * 100);
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  const rate = (n) => OW.Upgrades.workerRate(n, 1, 1, 0);
  // Next build project: the ladder, then the pulley (null once it stands).
  const project = () => (!ladder ? { res: OW.Mountains.woodId, name: 'Wood', cost: LADDER_WOOD, label: 'Ladder' }
    : !P().isBuilt() ? { res: OW.Mountains.stoneId, name: 'Stone', cost: PULLEY_STONE, label: 'Pulley' } : null);
  const left = () => Math.max(0, CLEAR_TOOLS - Math.floor(cleared));

  // A card's workers split across its areas (mountains_sub_slots). The
  // card stepper holds them; an area's + takes a free card worker, or
  // promotes one from the pool; its − frees one back onto the card.
  // keep: slot keys in keep order — when the card's total drops, free
  // workers go first, then slots from the END of keep.
  function createSplit(pool, cardId, keep) {
    const n = {};
    keep.forEach((k) => { n[k] = 0; });
    const free = () => pool.getAssigned(cardId) - keep.reduce((a, k) => a + n[k], 0);
    const s = {
      get: (k) => n[k],
      clear: (k) => { n[k] = 0; },
      add(k) { if (free() > 0 || pool.assign(cardId)) n[k]++; },
      remove(k) { if (n[k] > 0) { n[k]--; pool.unassign(cardId); } }, // a modal − returns the worker to idle
      stepperHtml: (k) => `<div class="card-steppers visible">
          <button class="card-stepper-btn" data-cp-sub="${k}" data-cp-sub-action="remove" ${n[k] ? '' : 'disabled'}>−</button>
          <span class="card-stepper-val" data-cp-sub-val="${k}">${n[k]}</span>
          <button class="card-stepper-btn" data-cp-sub="${k}" data-cp-sub-action="add">+</button>
        </div>`,
      patch() {
        keep.forEach((k) => {
          const v = q(`[data-cp-sub-val="${k}"]`), m = q(`[data-cp-sub="${k}"][data-cp-sub-action="remove"]`);
          if (v) v.textContent = n[k];
          if (m) m.disabled = !n[k];
        });
      },
      wire(mech) {
        document.querySelectorAll('#card-modal-body [data-cp-sub]').forEach((btn) => OW.Cards.addHoldBehavior(btn, () => {
          if (btn.dataset.cpSubAction === 'add') { s.add(btn.dataset.cpSub); mech.lastSub = btn.dataset.cpSub; } else s.remove(btn.dataset.cpSub);
          OW.Cards.refresh(mech);
        }));
      },
      serialize: () => Object.assign({}, n),
      deserialize(d) { keep.forEach((k) => { n[k] = (d && d[k]) || 0; }); }
    };
    pool.onChange(() => { let rest = pool.getAssigned(cardId); keep.forEach((k) => { n[k] = Math.min(n[k], rest); rest -= n[k]; }); });
    return s;
  }
  // clear, crew (pulley.js), cwb: counterweight builders (pulley.js), build: ladder/pulley builders.
  const split = createSplit(pool, ID, ['clear', 'crew', 'cwb', 'build']);
  const sdSplit = createSplit(OW.SandDunes.workerPool, 'sdpulley', ['clear', 'crew', 'cwb']);

  let mtnC = null, sdC = null;
  const clearingStat = () => (mtnC.status === 'clearing' || sdC.status === 'clearing' ? `Clearing — ${left()} left` : '');

  // One side of the collapse: its own tools, workers and status, digging
  // into the shared `cleared` count. prefix: the location's resource
  // prefix; workers(): how many dig; desc: the area's flavor line;
  // cls: extra class on the area (Sand Dunes passes cp-mtn for Mountains colors).
  function makeClearer(prefix, workers, desc, cls = '') {
    const tools = prefix + 'tools3';
    const c = { tc: OW.ToolUse.createConsumer(), status: 'idle' };
    c.text = () => ({ idle: 'Assign workers to start clearing.', stopped: 'Stopped — needs Tier III tools.' }[c.status]
      || `Clearing ${OW.Upgrades.formatRate(rate(workers()))} tools/s`);
    c.billable = () => (c.status === 'clearing' ? workers() : 0);
    c.stat = clearingStat; // either side digging shows on both card faces
    c.tick = (goldAvailable, tickRate) => {
      if (done) return;
      if (!workers()) c.status = 'idle';
      else if (!goldAvailable || !OW.Resources.exists(tools)) c.status = 'stopped';
      else {
        const before = OW.Resources.available(tools);
        c.status = c.tc.tick(prefix, 3, workers(), tickRate).starved ? 'stopped' : 'clearing';
        cleared += before - OW.Resources.available(tools);
        if (cleared >= CLEAR_TOOLS) finish();
      }
    };
    // stepperHtml: the area's own header stepper, owned by the card.
    c.html = (stepperHtml) => `<div class="hs-card ${cls}">
        <div class="hs-head cp-head-wrap"><span class="cp-head">${stepperHtml}<span class="hs-title">Clearing the path</span></span><span class="detail-status" data-cp-num>${left()} left</span>
          ${OW.ToolUse.getSubtitleHtml(3)}</div>
        <div class="hs-body">
          <span class="upgrade-desc">${desc}</span>
          <div class="detail-progress-wrap"><div class="detail-progress-bar" data-cp-bar style="width:${100 - pct(cleared, CLEAR_TOOLS)}%"></div></div>
          <div class="detail-status" data-cp-status>${c.text()}</div>
        </div>
      </div>`;
    c.patch = () => {
      const set = (sel, v) => { const e = q(sel); if (e) e.textContent = v; };
      set('[data-cp-num]', `${left()} left`);
      set('[data-cp-status]', c.text());
      const b = q('[data-cp-bar]'); if (b) b.style.width = `${100 - pct(cleared, CLEAR_TOOLS)}%`;
    };
    return c;
  }
  const buildW = () => split.get('build');
  const buildText = (p) => `${p.label} — ${Math.floor(built)}/${p.cost} ${p.name}${buildW() && !building ? ' · Stopped' : ''}`;
  mtnC = makeClearer('mtn_', () => split.get('clear'), 'Rubble buries the only pass to Sand Dunes. Each worker wears through one Tier III tool a second hauling it clear.');

  // The ladder, then the pulley build — titled for what it builds.
  const projectHtml = (p) => `<div class="hs-card">
      <div class="hs-head"><span class="cp-head">${split.stepperHtml('build')}<span class="hs-title">${p.label}</span></span></div>
      <div class="hs-body">
        <span class="upgrade-desc">${!ladder ? 'Lash a ladder up and over the collapse.' : 'A ladder scales the collapse. Rig a pulley to hoist cargo over it.'}</span>
        <div class="detail-status" data-cp-build>${buildText(p)}</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar" data-cp-build-bar style="width:${pct(built, p.cost)}%"></div></div>
      </div>
    </div>`;

  function completeProject() {
    built = 0;
    building = false;
    split.clear('build'); // builders step back onto the card (still in its stepper)
    if (!ladder) { ladder = true; OW.Footer.push('Built a ladder over the collapse.'); }
    else { P().build(); OW.Footer.push('Rigged a pulley over the collapse. Sand Dunes can hoist too.'); }
    OW.Cards.refreshOpenModal(ID);
  }

  function finish() {
    done = true;
    mtnC.status = sdC.status = 'idle';
    P().close(OW.SandDunes);
    while (pool.unassign(ID)); // the split clamps to zero with it
    OW.SandDunes.reveal();
    OW.Cards.hide(mechanic);
    OW.Footer.push('The Collapsed Path is clear. Mules and carts can reach Sand Dunes.');
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    workerPool: pool,
    // Only working sub-slots bill; free card workers and a stalled slot cost nothing.
    getBillableCount: () => mtnC.billable() + (building ? buildW() : 0) + P().mtn.billable(),
    cardName: () => 'Collapsed Path',
    // Card "+" target list (js/core/cards.js): modal sub-steppers, top to bottom.
    subSlots: () => ['clear', ...(!P().isBuilt() ? ['build'] : [P().mtn.cw ? 'crew' : 'cwb'])], subAdd: split.add,
    getStatText: () => mtnC.stat() || P().mtn.status()
      || (building && project() ? `Building ${project().label}` : mtnC.status === 'stopped' ? 'Stopped' : ''),
    // Top bar (section blue): the collapse itself — starts full, drains as it's dug out.
    upgradeBarTiered: true,
    // Bottom bar: a pulley trip in flight or the counterweight, otherwise the current build.
    upgradeTrackKey: 'cp-none', buildTrackKey: 'cp-none', // opt out of cards.js driving a modal bar — this card patches its own
    getUpgradeBarPct: () => 100 - pct(cleared, CLEAR_TOOLS),
    getBuildBarPct: () => (P().mtn.showBar() ? P().mtn.barPct() : project() ? pct(built, project().cost) : 0),
    hideBuildBar: () => !P().mtn.showBar() && !built,
    renderModalHTML: () => `<div class="cp-areas">
      ${mtnC.html(split.stepperHtml('clear'))}
      ${P().isBuilt() ? P().storageHtml() + P().mtn.sectionHtml() : projectHtml(project())}
      ${ladder && !peered ? '<button class="action-btn cp-peer" data-cp-action="peer">Peer over the top</button>' : ''}
    </div>`,
    patchLiveTrack() {
      const set = (sel, v) => { const e = q(sel); if (e) e.textContent = v; };
      const bar = (sel, v) => { const e = q(sel); if (e) e.style.width = `${v}%`; };
      mtnC.patch();
      const p = project();
      if (p) { set('[data-cp-build]', buildText(p)); bar('[data-cp-build-bar]', pct(built, p.cost)); }
      split.patch();
      P().mtn.patch();
    },
    afterRender: () => split.wire(mechanic),
    tick(goldAvailable, tickRate) {
      // Building: haul the current project's resource in at the worker rate.
      const p = project();
      building = !!p && buildW() > 0 && goldAvailable && OW.Resources.available(p.res) > 0;
      const take = building ? Math.min(rate(buildW()) * tickRate, OW.Resources.available(p.res), p.cost - built) : 0;
      if (take > 0) { OW.Resources.spend(p.res, take); built += take; if (built >= p.cost - 1e-9) completeProject(); }
      mtnC.tick(goldAvailable, tickRate);
      OW.Cards.refresh(mechanic);
    }
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-cp-action="peer"]')) return;
    peered = true;
    OW.Cards.closeModal();
    OW.SandDunes.reveal();
    OW.Footer.push('Sand Dunes stretches out beyond the collapse.');
    // Scroll the card grid to its bottom so the player watches Sand Dunes appear.
    const rh = document.getElementById('right-hand');
    requestAnimationFrame(() => rh.scrollTo({ top: rh.scrollHeight, behavior: 'smooth' }));
  });

  // Both cards' area splits are subsets of their pools' own card
  // assignments — both must come back together or they silently drift.
  // Older saves: Mountains kept cw/bw counts; Sand Dunes' card workers
  // were all clearers.
  OW.Save.register(ID,
    () => ({ c: cleared, d: done ? 1 : 0, l: ladder ? 1 : 0, tc: mtnC.tc.serialize(), stc: sdC.tc.serialize(), b: built,
      sp: split.serialize(), ssp: sdSplit.serialize(), p: peered ? 1 : 0 }),
    (d) => {
      if (!d) return;
      cleared = d.c || 0; done = !!d.d; ladder = !!d.l; built = d.b || 0;
      split.deserialize(d.sp || { clear: d.cw, build: d.bw });
      sdSplit.deserialize(d.ssp || { clear: OW.SandDunes.workerPool.getAssigned('sdpulley') });
      peered = !!d.p || OW.SandDunes.isDiscovered(); // older saves revealed Sand Dunes with the ladder
      mtnC.tc.deserialize(d.tc || 0);
      sdC.tc.deserialize(d.stc || 0);
    });

  OW.Mechanics.register(mechanic);

  // The Sand Dunes card (pulley.js) staffs this side from its own split.
  sdC = makeClearer('sd_', () => sdSplit.get('clear'),
    'Rubble buries the only pass back to the Mountains. Each worker wears through one Tier III tool a second hauling it clear.', 'cp-mtn');
  OW.CollapsedPath = { isCleared: () => done, sdClearer: sdC, splits: { mtn: split, sd: sdSplit } };
})();
