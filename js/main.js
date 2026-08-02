/* ============================================================
   MAIN — GAME START-UP
   Registers real resources and real cards in DOM order, starts loop.
   Adding a new mechanic: new Resources.register line + Cards.build
   line here, plus one <script> tag in index.html.
   ============================================================ */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('left-hand-real-resources');

    window.OrbWeaver.Workers.init(mount);
    window.OrbWeaver.Resources.register('gold', {
      name: 'Gold', mount, current: 5000, cap: 5000, displayType: 'integer'
    });

    window.OrbWeaver.Resources.register('wood', {
      name: 'Wood', mount, current: 0, cap: 200, displayType: 'decimal'
    });
    window.OrbWeaver.Resources.register('stone', {
      name: 'Stone', mount, current: 0, cap: 500, displayType: 'decimal', hidden: true
    });

    const campGrid = document.getElementById('grid-camp');
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('wood')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('stone')));
    campGrid.appendChild(window.OrbWeaver.Cards.build(window.OrbWeaver.Mechanics.get('buildersbench')));

    window.OrbWeaver.Loop.start();
  });
})();
