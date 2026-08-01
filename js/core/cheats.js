/* ============================================================
   CORE: CHEAT MENU
   Wires the cheat header buttons (toggled via Settings).
   Cheats: Wood +100, Gold +100, Workers +5 (uncapped), Caps +1000
   on every registered resource that has a cap, Speed 1x/2x/5x/10x
   (mutually exclusive, 1x resets to normal).
   ============================================================ */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    const header   = el('cheat-header');
    const toggle   = el('cheat-toggle');
    let cheatsOn   = true;

    // Speed buttons: keep track of active one for visual state
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

    // Apply default-on state immediately
    toggle.classList.add('on');

    // Toggle cheat header visibility from Settings
    toggle.addEventListener('click', () => {
      cheatsOn = !cheatsOn;
      toggle.classList.toggle('on', cheatsOn);
      header.style.display = cheatsOn ? 'flex' : 'none';
    });

    // Resource cheats — always respect caps
    el('cheat-wood').addEventListener('click', () => {
      window.OrbWeaver.Resources.add('wood', 100);
      window.OrbWeaver.Footer.push('Cheat: +100 wood.');
    });

    el('cheat-gold').addEventListener('click', () => {
      window.OrbWeaver.Resources.add('gold', 100);
      window.OrbWeaver.Footer.push('Cheat: +100 gold.');
    });

    el('cheat-workers').addEventListener('click', () => {
      window.OrbWeaver.Workers.addWorkers(5);
      window.OrbWeaver.Footer.push('Cheat: +5 workers.');
    });

    // Caps: raise every registered resource's cap by 1000
    el('cheat-caps').addEventListener('click', () => {
      window.OrbWeaver.Resources.all().forEach(({ id, cap }) => {
        if (cap != null) window.OrbWeaver.Resources.setCap(id, cap + 1000);
      });
      window.OrbWeaver.Footer.push('Cheat: all caps +1000.');
    });

    // Speed buttons
    el('cheat-speed-1').addEventListener('click',  () => setActiveSpeed(1));
    el('cheat-speed-2').addEventListener('click',  () => setActiveSpeed(2));
    el('cheat-speed-5').addEventListener('click',  () => setActiveSpeed(5));
    el('cheat-speed-10').addEventListener('click', () => setActiveSpeed(10));
  });
})();
