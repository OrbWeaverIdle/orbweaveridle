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
    let cheatsOn = false; // no-cheats build: menu starts hidden, Settings toggle can turn it on

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

    toggle.classList.toggle('on', cheatsOn);
    header.style.display = cheatsOn ? 'flex' : 'none';

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

    // Gold Bars is lazily created (Camp's row only exists once cargo
    // ships some home), so this has to go through ensureResource the
    // same way a real delivery does rather than assume a row exists.
    el('cheat-bars').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Locations.all().filter((l) => l.isDiscovered()).forEach((l) => {
        OW.Resources.add(l.ensureResource('goldbars', 'Gold Bars'), 100);
      });
      OW.Footer.push('Cheat: +100 gold bars to all discovered locations.');
    });

    el('cheat-tools3').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Locations.all().filter((l) => l.isDiscovered()).forEach((l) => {
        OW.Resources.add(l.ensureResource('tools3', 'Tools III'), 1000);
      });
      OW.Footer.push('Cheat: +1000 Tier III tools to all discovered locations.');
    });

    el('cheat-crates').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.Locations.all().filter((l) => l.isDiscovered()).forEach((l) => {
        ['wood', 'stone'].forEach((base) => {
          const id = l.prefix + base;
          if (!OW.Resources.exists(id)) return;
          OW.Resources.add(OW.Resources.ensureCrate(id), 1000);
        });
      });
      OW.Footer.push('Cheat: +1000 crated wood and stone to all discovered locations.');
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

    // Loc 2: skip past Camp and Mountains to test Sand Dunes. Every Camp
    // building (Camp's construction list) and Mountains build done, every
    // Mountains travel walked and claimed — which grants a fresh Collapsed
    // Path card, the real way into Sand Dunes. Camp and Mountains resources
    // filled to cap, 1000 Tools II and III and 20 workers in each. Never
    // reveals Sand Dunes, gives it anything, or touches Collapsed Path's
    // own progress; no Rich Uncle, mules, carts or bulls.
    // Mine: reveals Gold Mine only — press once Mountains is discovered. Remove when its travel path exists.
    el('cheat-mine').addEventListener('click', () => window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('goldmine')));
    el('cheat-loc2').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      const keep = OW.Locations.all().filter((l) => l.id === 'camp' || l.id === 'mountains');
      const otherPrefixes = OW.Locations.all().filter((l) => !keep.includes(l)).map((l) => l.prefix);
      OW.Mountains.reveal();
      ['richuncle_camp', 'richuncle_mountains'].forEach((id) => OW.Mechanics.get(id).cheatSkipTutorial());
      OW.Mechanics.get('buildersbench').cheatCompleteAll();
      OW.Mountains.cheatFinishAll();
      OW.Cards.reveal(OW.Mechanics.get('goldmine')); // until Gold Mine's travel path exists
      OW.Resources.all().forEach(({ id, cap }) => {
        if (cap != null && !otherPrefixes.some((p) => id.startsWith(p))) OW.Resources.add(id, cap);
      });
      keep.forEach((l) => {
        [['tools2', 'Tools II'], ['tools3', 'Tools III']].forEach(([base, name]) => {
          OW.Resources.add(l.ensureResource(base, name), 1000);
        });
        const total = OW.Workers.getPools()[l.id].getTotal();
        if (total < 20) l.addWorkers(20 - total);
      });
      OW.Footer.push('Cheat: Loc 2 — Camp and Mountains done, capped, 1000 Tools II/III and 20 workers each.');
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

    el('cheat-all-v2').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      // Reveal destinations (their own section + left-hand group, not just
      // their card) — no in-game trigger exists for Sand Dunes yet.
      if (OW.Mountains) OW.Mountains.reveal();
      if (OW.SandDunes) OW.SandDunes.reveal();
      // Reveal all hidden cards and resources (Copper Tool Head included)
      OW.Mechanics.all().forEach((m) => OW.Cards.reveal(m));
      OW.Resources.all().forEach(({ id }) => OW.Resources.reveal(id));
      // Complete all upgrades/construction on every mechanic
      OW.Mechanics.all().forEach((m) => { if (m.cheatCompleteAll) m.cheatCompleteAll(); });
      // Fill all capped resources to cap
      OW.Resources.all().forEach(({ id, cap }) => { if (cap != null) OW.Resources.add(id, cap); });
      // Uncapped resources the cap-fill pass above can't reach
      OW.HiddenRes.add('golddust', 10000);
      OW.HiddenRes.add('nugget', 10000);
      OW.Resources.add('copperhead', 1000);
      // Top every real worker pool (Camp, Mountains) to 50 — the
      // original ALL only reaches Camp's.
      Object.values(OW.Workers.getPools()).forEach((p) => {
        const needed = 50 - p.getTotal();
        if (needed > 0) p.addWorkers(needed);
      });
      OW.Footer.push('Cheat: ALL v2 — everything unlocked, resources filled, gold dust/gold nuggets/copper head added, every pool to 50 workers.');
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
    el('cheat-rm').addEventListener('click', () => bumpResourceCards('bumpLocalM', 'M'));
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

    el('cheat-nug').addEventListener('click', () => {
      const OW = window.OrbWeaver;
      OW.HiddenRes.add('golddust', 10000);
      OW.HiddenRes.add('nugget', 10000);
      OW.Footer.push('Cheat: +10,000 Gold Dust, +10,000 Gold Nuggets.');
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
