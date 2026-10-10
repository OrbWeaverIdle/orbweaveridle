/* Temporary card previews. Visibility here never changes saved unlocks.
   Any caller can start the event; its clock is the normal game loop. */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const MIN_DURATION = 10, MAX_DURATION = 20;
  const active = new Map(), groups = new Map(), previewed = new Set();
  let campLabel = null;

  function restoreGroup(id) {
    const g = groups.get(id);
    if (!g) return;
    // A discovery during the glimpse owns its section's visibility now.
    if (!(g.hidden && g.location.isDiscovered())) {
      g.grid.style.display = g.gridDisplay;
      if (g.arrow) g.arrow.classList.toggle('collapsed', g.collapsed);
      if (g.hidden && g.section) g.section.style.display = g.sectionDisplay;
    }
    groups.delete(id);
    if (campLabel && !Array.from(groups.values()).some((group) => group.hidden)) {
      const discovered = OW.Locations.all().some((l) => l.id !== 'camp' && l.isDiscovered());
      campLabel.el.style.display = discovered ? '' : campLabel.display;
      campLabel = null;
    }
  }

  function finish(m, immediate = false) {
    const entry = active.get(m);
    if (!entry) return;
    active.delete(m);
    // Hide while gapOnHide is still forced on, then restore every override.
    if (!m.revealed && !immediate) OW.Cards.hide(m);
    Object.entries(entry.saved).forEach(([key, descriptor]) => {
      if (descriptor) Object.defineProperty(m, key, descriptor);
      else delete m[key];
    });
    const wrap = m.els.wrap;
    if (entry.inert == null) wrap.removeAttribute('inert');
    else wrap.setAttribute('inert', entry.inert);
    if (m.revealed || immediate) OW.Cards.applyVisibility(m);
    OW.Cards.refresh(m);
    if (!Array.from(active.values()).some((e) => e.group === entry.group)) restoreGroup(entry.group);
    if (!active.size) {
      // Countdown spacing is temporary. Collapse only this event's still-locked
      // cards once the last preview ends; leave real unlocks and vehicles alone.
      previewed.forEach((card) => { if (!card.revealed) OW.Cards.applyVisibility(card); });
      previewed.clear();
    }
  }

  function clear() { Array.from(active.keys()).forEach((m) => finish(m, true)); }

  function start() {
    // Starting twice simply replaces the previous glimpse, never stacks locks.
    clear();
    const positions = new Map(Array.from(document.querySelectorAll('.card-wrap'), (el, i) => [el, i]));
    const eligible = OW.Mechanics.all().filter((m) => m.els && m.els.wrap && !m.revealed &&
      !m.isMule && !m.id.startsWith('richuncle') && m.id !== 'mpftest')
      .sort((a, b) => positions.get(a.els.wrap) - positions.get(b.els.wrap));

    OW.Locations.all().forEach((location) => {
      const grid = document.getElementById('grid-' + location.id);
      if (!grid || !eligible.some((m) => grid.contains(m.els.wrap))) return;
      const section = document.getElementById(location.id + '-section');
      const arrow = grid.previousElementSibling && grid.previousElementSibling.querySelector('.section-collapse-arrow');
      const hidden = !location.isDiscovered();
      groups.set(location.id, { location, grid, section, arrow, hidden,
        gridDisplay: grid.style.display, sectionDisplay: section && section.style.display,
        collapsed: arrow && arrow.classList.contains('collapsed') });
      grid.style.display = '';
      if (arrow) arrow.classList.remove('collapsed');
      if (hidden && section) section.style.display = '';
    });
    if (Array.from(groups.values()).some((g) => g.hidden)) {
      const el = document.getElementById('camp-section-label');
      if (el) { campLabel = { el, display: el.style.display }; el.style.display = ''; }
    }

    eligible.forEach((m, i) => {
      const duration = eligible.length < 2 ? MAX_DURATION :
        MAX_DURATION - (MAX_DURATION - MIN_DURATION) * i / (eligible.length - 1);
      const group = Array.from(groups.keys()).find((id) => groups.get(id).grid.contains(m.els.wrap));
      const saved = {};
      ['getUpgradeBarPct', 'hideUpgradeBar', 'gapOnHide', '_previewLock'].forEach((key) => {
        saved[key] = Object.getOwnPropertyDescriptor(m, key);
      });
      const entry = { duration, remaining: duration, saved, group, inert: m.els.wrap.getAttribute('inert') };
      active.set(m, entry);
      previewed.add(m);
      m._previewLock = true;
      m.gapOnHide = true;
      m.getUpgradeBarPct = () => Math.max(0, entry.remaining / duration * 100);
      m.hideUpgradeBar = () => false;
      m.els.wrap.setAttribute('inert', '');
      m.els.wrap.style.display = '';
      m.els.wrap.style.visibility = '';
      OW.Cards.refresh(m);
    });
  }

  OW.Mechanics.register({
    id: 'strangeshard', upkeepExempt: true,
    cardName: () => 'Strange Shard', getStatText: () => '',
    tick(goldAvailable, tickRate) {
      active.forEach((entry, m) => {
        entry.remaining -= tickRate;
        if (m.revealed || entry.remaining <= 1e-9) finish(m);
      });
    }
  });
  // A reload/import ends the effect. Only Dig Site's intro completion persists.
  OW.Save.register('strangeshard', null, clear);
  OW.StrangeShard = { start, clear };
})();
