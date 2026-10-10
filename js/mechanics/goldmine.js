/* ============================================================
   MECHANIC: GOLD MINE
   Mountains card on Mountains' worker pool (assigned in main.js).
   startHidden; revealed by Loc 2 until its travel path exists.

   A growable list of claims, each with its own sub-stepper:
     dig    — bar drains the claim's dig target to 0
     search — bar fills 0 → search target, DUST gold dust per dig
     mine   — bar drains the vein to 0, NUG nuggets per dig,
              then back to search one cycle later
   One dig = one cycles.js completion (1 per worker-second at baseline
   m/p/f), and every dig rolls the selected tool tier's bonus once.
   Dig/search targets, vein size and collapse payout all derive from the
   claim number and its cycle count — none are saved. A fresh "Dig a
   claim" row opens below once the bottom claim digs its first point.

   Tools: one toolUse.js consumer for the whole card spends the
   selected tier (mechanic.toolTier, 2 or 3, switched from the modal
   header pills). No tools or no gold stops every claim; stopped and
   unslotted workers cost no upkeep.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};
  const OW = window.OrbWeaver;

  const ID = 'goldmine';
  const DIG = 1000, SEARCH = 1000, GROW = 1.15; // claim n digs DIG×GROW^(n-1); search grows GROW per cycle
  const VEIN = 200, SHRINK = 0.96;              // vein shrinks SHRINK per cycle
  const DUST = 4, NUG = 15, BONUS_DIG = 100;
  const COLLAPSE_DUST = 400;                    // per completed vein
  const LOW_VEIN = 120, LONG_SEARCH = 3000;     // red header warnings at/past these sizes
  const TIERS = { 2: { chance: 0.15, nug: 30, name: 'II' }, 3: { chance: 0.5, nug: 180, name: 'III' } };
  const PHASE = {
    dig:    { title: 'Dig a claim',             verb: 'Digging',   desc: 'Each dig clears the ground.' },
    search: { title: 'Searching for gold vein', verb: 'Searching', desc: `Each dig turns up ${DUST} gold dust.` },
    mine:   { title: 'Mining gold vein',        verb: 'Mining',    desc: `Each dig yields ${NUG} gold nuggets.` }
  };
  const RANK = { dig: 0, search: 1, mine: 2 };

  const m = 1, p = 1, f = 0; // one shared local set for every claim
  let claims = [], opened = 0, dirty = false, armed = null, tipDone = false; // armed: claim no awaiting Confirm?
  let status = 'idle'; // idle | working | nogold | notools
  const toolConsumer = OW.ToolUse.createConsumer();

  const pool = () => OW.Mountains.workerPool;
  const rate = (n) => OW.Upgrades.workerRate(n, m, p, f);
  const fmt = (n) => Math.floor(n).toLocaleString('en-US');
  const grow = (base, k, g) => Math.round(base * Math.pow(g, k));
  const digT = (c) => grow(DIG, c.no - 1, GROW);
  const searchT = (c) => grow(SEARCH, c.cycles, GROW);
  const vein = (c) => Math.max(1, grow(VEIN, c.cycles, SHRINK));
  const payout = (c) => c.cycles * COLLAPSE_DUST;
  const goal = (c) => (c.phase === 'dig' ? digT(c) : c.phase === 'search' ? searchT(c) : vein(c));
  const pct = (c) => c.pts / goal(c) * 100;
  const barId = (c) => `gm-${c.no}-${c.phase}-${c.cycles}`; // new id per phase: the eased bar snaps, never sweeps back
  const byNo = (no) => claims.find((c) => c.no === +no);
  const used = () => claims.reduce((s, c) => s + c.workers, 0);
  const lead = () => claims.filter((c) => c.workers).sort((a, b) => RANK[b.phase] - RANK[a.phase] || pct(b) - pct(a))[0];
  const warn = (c) => (c.phase === 'mine' && vein(c) <= LOW_VEIN ? 'Vein running low'
    : c.phase === 'search' && searchT(c) >= LONG_SEARCH ? 'Longer dig time' : '');
  const stopped = () => status === 'nogold' || status === 'notools';
  const rateText = (c) => (!c.workers ? '' : stopped() ? `Stopped — needs ${status === 'nogold' ? 'gold' : `Tier ${TIERS[mechanic.toolTier].name} tools`}.`
    : `${PHASE[c.phase].verb} ${OW.Upgrades.formatRate(rate(c.workers))}/s`);
  const have = (base) => { const id = OW.Mountains.prefix + base; return OW.Resources.exists(id) ? OW.Resources.get(id) : 0; };

  function makeClaim(no) { return { no, phase: 'dig', pts: 0, cycles: 0, workers: 0, cyc: OW.Cycles.create(1), bonus: null }; }
  function openClaim() { const c = makeClaim(++opened); c.pts = digT(c); claims.push(c); }

  /* ---- Worker sub-slots (sub_stepper_routing; same rules as Gold Panning) ---- */
  function subAssign(no) {
    const c = byNo(no);
    if (!c || (pool().getAssigned(ID) - used() <= 0 && !pool().assign(ID))) return;
    c.workers++;
    mechanic.lastSub = c.no;
    OW.Cards.refresh(mechanic);
  }
  function subUnassign(no) {
    const c = byNo(no);
    if (!c || c.workers <= 0) return;
    c.workers--;
    pool().unassign(ID); // modal − returns the worker to idle
  }
  // Card − below the slotted total: earlier claims keep their workers.
  pool().onChange(() => {
    let budget = pool().getAssigned(ID);
    claims.forEach((c) => { c.workers = Math.min(c.workers, budget); budget -= c.workers; });
  });

  /* ---- Digging: n whole digs, one bonus roll each ---- */
  function work(c, n, t) {
    let hits = 0, kind = null;
    for (let i = 0; i < n; i++) {
      const lucky = Math.random() < t.chance;
      if (lucky) { hits = kind === c.phase ? hits + 1 : 1; kind = c.phase; }
      if (c.phase === 'dig') {
        if (c.pts === digT(c) && c === claims[claims.length - 1]) { openClaim(); dirty = true; }
        c.pts = Math.max(0, c.pts - 1 - (lucky ? BONUS_DIG : 0));
        if (!c.pts) { c.phase = 'search'; dirty = true; }
      } else if (c.phase === 'search') {
        OW.HiddenRes.add('golddust', DUST);
        c.pts = Math.min(searchT(c), c.pts + 1 + (lucky ? BONUS_DIG : 0));
        if (c.pts === searchT(c)) { c.phase = 'mine'; c.pts = vein(c); dirty = true; OW.Footer.push(`Claim #${c.no} strikes a gold vein.`); }
      } else {
        OW.HiddenRes.add('nugget', lucky ? t.nug : NUG);
        if (!--c.pts) { c.phase = 'search'; c.cycles++; dirty = true; }
      }
    }
    if (hits) c.bonus = { t: performance.now(), text: `Bonus${hits > 1 ? ' ×' + hits : ''}: ${kind === 'mine' ? fmt(t.nug * hits) + ' nuggets' : '+' + fmt(BONUS_DIG * hits) + ' dig'}` };
  }

  // Two clicks: the first arms (Confirm?), the second collapses for dust.
  function collapse(no) {
    const c = byNo(no);
    if (!c || c.phase === 'dig') return;
    if (armed !== c.no) { armed = c.no; return OW.Cards.refreshOpenModal(ID); }
    armed = null;
    claims = claims.filter((x) => x !== c); // its workers stay on the card, unslotted
    OW.HiddenRes.add('golddust', payout(c));
    OW.Footer.push(`Claim #${c.no} collapses. +${fmt(payout(c))} Gold Dust.`);
    OW.Cards.refreshOpenModal(ID);
    OW.Cards.refresh(mechanic);
  }
  function setTier(t) {
    mechanic.toolTier = t;
    tipDone = true; // first tier click retires the header tip
    syncFace();
    OW.Cards.refreshOpenModal(ID);
  }
  // Card face: pill shows the selected tier; bottom bar turns gold while mining.
  function syncFace() {
    if (!mechanic.els) return;
    mechanic.els.wrap.querySelector('.card-tier-pill').textContent = TIERS[mechanic.toolTier].name;
    const l = lead();
    mechanic.els.buildBar.classList.toggle('gm-vein', !!l && l.phase === 'mine');
  }

  /* ---- Modal ---- */
  const RES = [
    { key: 'dust', label: 'Gold Dust', amt: () => OW.HiddenRes.get('golddust') },
    { key: 'nug', label: 'Gold Nuggets', amt: () => OW.HiddenRes.get('nugget') },
    { key: 'bars', label: 'Gold Bars', amt: () => have('goldbars') },
    { key: 't2', label: 'Tools II', amt: () => have('tools2') },
    { key: 't3', label: 'Tools III', amt: () => have('tools3') }
  ];
  function claimCard(c) {
    const t = TIERS[mechanic.toolTier], pc = Math.round(t.chance * 100);
    const extra = c.phase === 'mine' ? `${pc}% chance of ${t.nug} instead.` : `${pc}% chance to dig ${BONUS_DIG} extra.`;
    return `<div class="hs-card">
      <div class="hs-head">
        <div class="gm-head-left">
          <div class="card-steppers visible">
            <button class="card-stepper-btn" data-gm-sub="${c.no}" data-gm-act="remove" ${c.workers ? '' : 'disabled'}>−</button>
            <span class="card-stepper-val" data-gm-val="${c.no}">${c.workers}</span>
            <button class="card-stepper-btn" data-gm-sub="${c.no}" data-gm-act="add">+</button>
          </div>
          <span class="hs-title"><span class="gm-claim-no">#${c.no}</span>${PHASE[c.phase].title}</span>
        </div>
        <span class="gm-head-right"><span class="gm-warn">${warn(c)}</span><span class="upgrade-costtime gm-pts${warn(c) ? ' low' : ''}" data-gm-pts="${c.no}">${fmt(c.pts)} / ${fmt(goal(c))}</span></span>
      </div>
      <div class="hs-body">
        <div class="upgrade-desc">${PHASE[c.phase].desc} ${extra}</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar gm-bar${c.phase === 'mine' ? ' vein' : ''}" data-extra-track="${barId(c)}" style="width:${pct(c)}%"></div></div>
        <div class="gm-foot wf-line">
          <span><span data-gm-rate="${c.no}">${rateText(c)}</span><span class="gm-bonus" data-gm-bonus="${c.no}"></span></span>
          <span class="gm-chip${armed === c.no ? ' armed' : ''}">+${fmt(payout(c))} Gold Dust<button class="action-btn gm-collapse${armed === c.no ? ' confirm' : ''}" data-gm-collapse="${c.no}" ${c.phase === 'dig' ? 'disabled' : ''}>${armed === c.no ? 'Confirm?' : 'Collapse'}</button></span>
        </div>
      </div>
    </div>`;
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Mountains',
    modalTheme: 'theme-mountains',
    workerPool: null, // Mountains' pool, set in main.js
    toolTier: 2,
    toolConsumer, // upkeep.js: no tool in hand -> no wage
    isBillable: () => !stopped(),
    getBillableCount: used, // unslotted workers (e.g. after a collapse) never bill
    cardName: () => 'Gold Mine',
    subSlots: () => claims.map((c) => c.no), subAdd: subAssign,
    getSubtitleHtml: () => `<div class="tool-pips-row"><div class="card-tier-pill tier-pip-crossed">I</div>${[2, 3].map((t) =>
      `<div class="card-tier-pill gm-pip${mechanic.toolTier === t ? '' : ' off'}" data-gm-tier="${t}">${TIERS[t].name}</div>`).join('')}<span class="tool-pips-label">Using Tier ${TIERS[mechanic.toolTier].name} tools</span></div>${
      tipDone ? '' : '<div class="sp-req-msg gm-tip">Change tool tier above</div>'}`,
    getStatText() {
      if (!used()) return '';
      if (stopped()) return `Stopped – no ${status === 'nogold' ? 'gold' : 'tools'}`;
      return rateText(lead());
    },
    getUpgradeBarPct: () => 0,
    hideUpgradeBar: () => true,
    getBuildBarPct: () => { const l = lead(); return l ? pct(l) : 0; },
    getExtraBars: () => claims.map((c) => ({ id: barId(c), pct: pct(c) })),
    renderModalHTML: () => `<div class="bench-modal"><div class="gp-resbar gm-resbar"><div class="gp-resbar-item">${RES.map((r) =>
      `<div class="gp-resbar-stat"><span class="gp-resbar-label">${r.label}</span><span class="gp-resbar-amt" data-gm-res="${r.key}">${fmt(r.amt())}</span></div>`).join('')}</div></div>${
      claims.map(claimCard).join('<div class="bench-modal-divider"></div>')}</div>`,
    afterRender() {
      document.querySelectorAll('#card-modal-body [data-gm-sub]').forEach((btn) =>
        OW.Cards.addHoldBehavior(btn, () => (btn.dataset.gmAct === 'add' ? subAssign : subUnassign)(btn.dataset.gmSub)));
    },
    // Numbers only; phase changes, new claims, collapses and tier switches rebuild.
    patchLiveTrack() {
      const q = (s) => document.querySelector(`#card-modal-body ${s}`), now = performance.now();
      RES.forEach((r) => { const e = q(`[data-gm-res="${r.key}"]`); if (e) e.textContent = fmt(r.amt()); });
      claims.forEach((c) => {
        const set = (a, v) => { const e = q(`[data-gm-${a}="${c.no}"]`); if (e) e.textContent = v; };
        set('pts', `${fmt(c.pts)} / ${fmt(goal(c))}`); set('val', c.workers); set('rate', rateText(c));
        const minus = q(`[data-gm-sub="${c.no}"][data-gm-act="remove"]`); if (minus) minus.disabled = !c.workers;
        const b = q(`[data-gm-bonus="${c.no}"]`);
        if (b) { b.textContent = c.bonus ? c.bonus.text : ''; b.classList.toggle('show', !!c.bonus && now - c.bonus.t < 1000); }
      });
    },
    tick(goldAvailable, tickRate) {
      const working = claims.filter((c) => c.workers > 0);
      status = !working.length ? 'idle' : !goldAvailable ? 'nogold'
        : toolConsumer.tick(OW.Mountains.prefix, mechanic.toolTier, used(), tickRate).starved ? 'notools' : 'working';
      if (status === 'working') working.forEach((c) => work(c, c.cyc.advance(rate(c.workers), tickRate), TIERS[mechanic.toolTier]));
      if (dirty) { dirty = false; OW.Cards.refreshOpenModal(ID); }
      syncFace();
      OW.Cards.refresh(mechanic);
    }
  };

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-gm-tier], [data-gm-collapse]');
    if (armed !== null && !(t && t.dataset.gmCollapse)) { armed = null; OW.Cards.refreshOpenModal(ID); } // any other click disarms
    if (!t) return;
    if (t.dataset.gmTier) setTier(+t.dataset.gmTier);
    else collapse(t.dataset.gmCollapse);
  });

  // Test-only surface (node harness); harmless in the browser.
  mechanic._debug = { claims: () => claims, subAssign, subUnassign, collapse, setTier, digT, searchT, vein, payout };

  /* ---- Save/load ---- Seed only: per claim [no, phase, pts, cycles,
     workers, dig progress]. Targets, vein and payout are recomputed. */
  OW.Save.register(ID,
    () => ({ t: mechanic.toolTier, tip: tipDone ? 1 : 0, o: opened, tc: toolConsumer.serialize(), c: claims.map((c) => [c.no, c.phase, c.pts, c.cycles, c.workers, c.cyc.serialize()]) }),
    (d) => {
      tipDone = !!(d && d.tip);
      if (!d || !d.c || !d.c.length) return; // fresh game keeps the seeded first claim
      mechanic.toolTier = d.t === 3 ? 3 : 2;
      opened = d.o;
      toolConsumer.deserialize(d.tc || 0);
      claims = d.c.map(([no, phase, pts, cycles, workers, cp]) => {
        const c = Object.assign(makeClaim(no), { phase, pts, cycles, workers });
        c.cyc.deserialize(cp);
        return c;
      });
      syncFace();
    });
  OW.Mechanics.register(mechanic);

  openClaim();
})();
