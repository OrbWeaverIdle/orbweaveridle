/* ============================================================
   CORE: CONTEXT FOOTER
   Shows the 3 most recent messages (newest first, each older one
   progressively dimmer) plus a full scrollable history in a modal.
   Any part of the game can push a message here — Claude owns adding
   these calls as mechanics grow.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const HISTORY_CAP = 50;
  const msgEls = [
    document.getElementById('footer-msg-0'),
    document.getElementById('footer-msg-1'),
    document.getElementById('footer-msg-2')
  ];

  let history = []; // [{t: text, ts: epoch ms}], newest first

  // Muted while a save is being restored: replaying completed research
  // and construction items fires their onComplete handlers, and the
  // player should not watch a year of "X complete!" flash past on load.
  // History still records while muted (see push()) — a player returning
  // after time away should be able to open the log and see it all.
  let muted = false;
  function setMuted(v) { muted = !!v; }

  /* A listener still sees every push while muted. Offline catch-up uses
     this to assemble its summary from the announcements mechanics
     already make ("A tent was built!", "Stone Quarry established!"),
     so no mechanic needs its own offline-reporting code — and any
     mechanic added later is included for free. */
  let listener = null;
  function setListener(fn) { listener = fn; }

  /* pendingIdle sits OUTSIDE `history` until commitIdleMessage() folds
     it in. Anything displaying the log always shows pendingIdle first,
     regardless of `history` — including offline-replay events, which
     push into `history` normally underneath it and can never bump it.
     This is what guarantees "always the top message" through the whole
     load + offline-catchup sequence, not just when nothing else
     happened while away. */
  let pendingIdle = null; // {t, ts}
  function displayList() { return pendingIdle ? [pendingIdle].concat(history) : history; }

  function renderStrip() {
    const list = displayList();
    for (let i = 0; i < 3; i++) {
      if (msgEls[i]) msgEls[i].textContent = list[i] ? list[i].t : '';
    }
  }

  function push(message) {
    if (listener) { try { listener(message); } catch (e) {} }
    history.unshift({ t: message, ts: Date.now() });
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    if (muted) return;
    renderStrip();
  }

  function getHistory() { return displayList(); }

  // SAVE THE SEED: the messages themselves ARE the seed here (there's
  // nothing to derive them from), so the persisted shape is the plain array.
  // pendingIdle is deliberately excluded — it isn't committed yet, and
  // commitIdleMessage() always runs before the next save.
  function serialize() { return history.map((h) => ({ t: h.t, ts: h.ts })); }
  function deserialize(saved) {
    history = Array.isArray(saved) ? saved.slice(0, HISTORY_CAP) : [];
    primeIdleMessage();
    renderStrip();
  }

  /* ---------------- Idle message ----------------
     Written to localStorage on close (pagehide/beforeunload) with a
     timestamp, but not shown unless at least IDLE_THRESHOLD_MS has
     actually passed by the time the game reopens — a quick tab close
     and reopen must not trigger it. hostile flag is reserved for
     future game effects. */
  const IDLE_KEY = 'orbweaver.idlemsg';
  const IDLE_THRESHOLD_MS = 2 * 60 * 1000;
  const IDLE_MESSAGES = [
    { t: (n) => `${n} workers are happily working.`, hostile: false },
    { t: (n) => `${n} workers are feeling rebellious.`, hostile: true },
    { t: (n) => `${n} workers are disgruntled.`, hostile: true },
    { t: (n) => `${n} workers are focused on their tasks.`, hostile: false },
    { t: (n) => `${n} workers are making the best of it.`, hostile: false }
  ];

  function scheduleIdleMessage(getWorkerCount) {
    const write = () => {
      try {
        const n = getWorkerCount();
        const msg = IDLE_MESSAGES[Math.floor(Math.random() * IDLE_MESSAGES.length)];
        localStorage.setItem(IDLE_KEY, JSON.stringify({ text: msg.t(n), hostile: msg.hostile, ts: Date.now() }));
      } catch (e) {}
    };
    window.addEventListener('pagehide', write);
    window.addEventListener('beforeunload', write);
  }

  // Reads + clears the idle key and, if it passes the threshold, holds
  // it pinned in pendingIdle. Called from deserialize() — i.e. before
  // Offline.apply ever runs — so the offline report's "While you were
  // away" list (built from getHistory()) already sees it at the top.
  function primeIdleMessage() {
    try {
      const raw = localStorage.getItem(IDLE_KEY);
      localStorage.removeItem(IDLE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.ts && Date.now() - data.ts >= IDLE_THRESHOLD_MS) pendingIdle = { t: data.text, ts: data.ts };
    } catch (e) {}
  }

  // Called on a fresh game (no save, so deserialize()/primeIdleMessage()
  // never ran) to discard any leftover key from a prior session.
  function discardIdleMessage() {
    try { localStorage.removeItem(IDLE_KEY); } catch (e) {}
    pendingIdle = null;
  }

  // Folds pendingIdle permanently into history, at the top. Call once
  // the whole boot sequence has settled (after Loop.start()) — from
  // then on it behaves like any other message and sinks naturally as
  // new ones arrive, rather than staying pinned forever.
  function commitIdleMessage() {
    if (!pendingIdle) return;
    history.unshift(pendingIdle);
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    pendingIdle = null;
    renderStrip();
  }

  window.OrbWeaver.Footer = {
    push, setMuted, setListener, getHistory, serialize, deserialize,
    scheduleIdleMessage, discardIdleMessage, commitIdleMessage
  };
})();
