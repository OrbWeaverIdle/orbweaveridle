/* ============================================================
   CORE: CHEAT MENU
   Wires the cheat header buttons (toggled via Settings).
   Cheats: Wood +100, Stone +100, Gold +100, Journals +50,
   Research Papers +500, Workers +5 (uncapped),
   Caps +1000 on every registered resource that has a cap,
   Speed 1x/2x/5x/10x (mutually exclusive, 1x resets to normal).
   ============================================================ */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  // Save the seed (the three stacked deltas) so repeated M/P/F cheat
  // presses survive save/load — registered here since this is where
  // the deltas are driven from, and cheats.js loads after save.js.
  window.OrbWeaver.Save.register('globalmod',
    () => window.OrbWeaver.Upgrades.getGlobalMods(),
    (d) => window.OrbWeaver.Upgrades.setGlobalMods(d));

  document.addEventListener('DOMContentLoaded', () => {
    const header = el('cheat-header');
    const toggle = el('cheat-toggle');
    let cheatsOn = false;

    const speedBtns = {
      1:  el('cheat-speed-1'),
      2:  el('cheat-speed-2'),
      5:  el('cheat-speed-5'),
      10: el('cheat-speed-10')
    };

    function setActiveSpeed(mult) {
      Object.keys(speedBtns).forEach((k) => {
        speedBtns[k].classList.toggle('active', parseInt(k) === mult);
      });
      window.OrbWeaver.Loop.setSpeed(mult);
    }

    toggle.addEventListener('click', () => {
      cheatsOn = !cheatsOn;
      toggle.classList.toggle('on', cheatsOn);
      header.style.display = cheatsOn ? 'flex' : 'none';
    });

    el('cheat-wood').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Locations.all().filter((l) => l.isDiscovered()).forEach((l) => OW.Resources.add(l.prefix + 'wood', 100));
      OW.Footer.push('Cheat: +100 wood to all discovered locations.');
    });

    el('cheat-stone').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Locations.all().filter((l) => l.isDiscovered()).forEach((l) => OW.Resources.add(l.prefix + 'stone', 100));
      OW.Footer.push('Cheat: +100 stone to all discovered locations.');
    });

    el('cheat-null').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Resources.all().forEach(({ id, current, wrap }) => {
        if (wrap && wrap.style.display !== 'none') OW.Resources.spend(id, current);
      });
      OW.Footer.push('Cheat: all visible resources zeroed.');
    });

    el('cheat-gold').addEventListener('click', () => {
      window.OrbWeaver.Resources.add('gold', 100);
      window.OrbWeaver.Footer.push('Cheat: +100 gold.');
    });

    el('cheat-journals').addEventListener('click', () => {
      window.OrbWeaver.Resources.add('journals', 50);
      window.OrbWeaver.Footer.push('Cheat: +50 journals.');
    });

    el('cheat-papers').addEventListener('click', () => {
      window.OrbWeaver.Resources.add('researchpapers', 500);
      window.OrbWeaver.Footer.push('Cheat: +500 research papers.');
    });

    el('cheat-workers').addEventListener('click', () => {
      window.OrbWeaver.Locations.all()
        .filter((l) => l.isDiscovered())
        .forEach((l) => l.addWorkers(5));
      window.OrbWeaver.Footer.push('Cheat: +5 workers to every discovered location.');
    });

    el('cheat-loc').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      if (OW.Mountains) OW.Mountains.reveal();
      if (OW.SandDunes) OW.SandDunes.reveal();
      OW.Footer.push('Cheat: Locations revealed.');
    });

    el('cheat-all').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      // Reveal destinations (their own section + left-hand group, not just
      // their card) — no in-game trigger exists for Sand Dunes yet.
      if (OW.Mountains) OW.Mountains.reveal();
      if (OW.SandDunes) OW.SandDunes.reveal();
      // Reveal all hidden cards and resources
      OW.Mechanics.all().forEach((m) => OW.Cards.reveal(m));
      OW.Resources.all().forEach(({ id }) => OW.Resources.reveal(id));
      // Complete all upgrades/construction on every mechanic
      OW.Mechanics.all().forEach((m) => { if (m.cheatCompleteAll) m.cheatCompleteAll(); });
      // Fill all resources to cap
      OW.Resources.all().forEach(({ id, cap }) => { if (cap != null) OW.Resources.add(id, cap); });
      // Set workers to 50
      const needed = 50 - OW.Workers.getTotal();
      if (needed > 0) OW.Workers.addWorkers(needed);
      OW.Footer.push('Cheat: ALL — everything unlocked, resources filled, 50 workers.');
    });

    el('cheat-mpf-card').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Cards.reveal(OW.Mechanics.get('mpftest'));
      OW.Footer.push('Cheat: MPF Test card revealed.');
    });

    function bumpGlobal(key, label) {
      const OW = window.OrbWeaver;
      OW.Upgrades.addGlobalMod(key, 0.1);
      OW.Footer.push(`Cheat: global ${label} +0.1.`);
    }
    el('cheat-mpf-m').addEventListener('click', () => bumpGlobal('m', 'M'));
    el('cheat-mpf-p').addEventListener('click', () => bumpGlobal('p', 'P'));
    el('cheat-mpf-f').addEventListener('click', () => bumpGlobal('f', 'F'));

    const RESOURCE_CARD_IDS = ['wood', 'stone', 'quarry'];
    function bumpResourceCards(method, label) {
      const OW = window.OrbWeaver;
      RESOURCE_CARD_IDS.forEach((id) => {
        const m = OW.Mechanics.get(id);
        if (m && m[method]) m[method]();
      });
      OW.Footer.push(`Cheat: local ${label} +0.1 on Wood, Stone, and Quarry.`);
    }
    el('cheat-rp').addEventListener('click', () => bumpResourceCards('bumpLocalP', 'P'));
    el('cheat-rf').addEventListener('click', () => bumpResourceCards('bumpLocalF', 'F'));

    el('cheat-seed').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      const m = OW.Mechanics.get('wheatfieldcard');
      if (m && m.cheatFillSeed) {
        m.cheatFillSeed();
        OW.Footer.push('Cheat: Seed Bundle filled to cap.');
      }
    });

    el('cheat-caps').addEventListener('click', () => {
      window.OrbWeaver.Resources.all().forEach(({ id, cap }) => {
        if (cap != null) window.OrbWeaver.Resources.setCap(id, cap + 1000);
      });
      window.OrbWeaver.Footer.push('Cheat: all caps +1000.');
    });

    el('cheat-speed-1').addEventListener('click',  () => setActiveSpeed(1));
    el('cheat-speed-2').addEventListener('click',  () => setActiveSpeed(2));
    el('cheat-speed-5').addEventListener('click',  () => setActiveSpeed(5));
    el('cheat-speed-10').addEventListener('click', () => setActiveSpeed(10));
  });
})();
