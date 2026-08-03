/* ============================================================
   CORE: CONTEXT FOOTER
   Shows only the most recent message. Any part of the game can push
   a message here — Claude owns adding these calls as mechanics grow.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const textEl = document.getElementById('context-footer-text');

  function push(message) {
    if (textEl) textEl.textContent = message;
  }

  window.OrbWeaver.Footer = { push };
})();
