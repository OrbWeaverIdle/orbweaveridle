/* ============================================================
   CORE: HIDDEN RESOURCES
   A private ledger for resources that are deliberately NOT part of the
   normal Resources registry — so nothing that scans the left-hand
   sidebar (Scout Stable's cargo dropdown, Market, upkeep) can ever see
   or route them. Only the cards that explicitly import HiddenRes can
   touch these: Gold Panning now, Gold Mine and Smelting Hut later.

   This is the general home for any future "hidden away" resource, not
   a one-off for gold dust. Balances are uncapped and persist via this
   module's own save participant (loads before any mechanic that reads
   them, since js/core/ loads before js/mechanics/).

   API mirrors the public Resources surface so a card uses it the same
   way: get(id), add(id, n) -> amount added, spend(id, n) -> amount
   spent, has(id). ensure(id, name) registers a balance lazily on first
   use; names are stored only so a UI can label them.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ledger = {}; // id -> { name, amount }

  function ensure(id, name) {
    if (!ledger[id]) ledger[id] = { name: name || id, amount: 0 };
    else if (name) ledger[id].name = name;
    return ledger[id];
  }

  function get(id) { return ledger[id] ? ledger[id].amount : 0; }
  function getName(id) { return ledger[id] ? ledger[id].name : id; }
  function has(id) { return !!ledger[id]; }

  function add(id, n) {
    if (n <= 0) return 0;
    ensure(id).amount += n;
    return n; // uncapped — everything asked for is always added
  }
  function spend(id, n) {
    const e = ledger[id];
    if (!e || n <= 0) return 0;
    const used = Math.min(e.amount, n);
    e.amount -= used;
    return used;
  }

  /* ---- Save/load ---- Balances and names travel together, since a
     hidden resource has no registry row to recreate it from on boot. */
  window.OrbWeaver.Save.register('hiddenres',
    () => {
      const out = {};
      Object.keys(ledger).forEach((id) => { out[id] = { n: ledger[id].name, a: ledger[id].amount }; });
      return out;
    },
    (d) => {
      Object.keys(ledger).forEach((k) => delete ledger[k]);
      if (d) Object.keys(d).forEach((id) => { ledger[id] = { name: d[id].n || id, amount: d[id].a || 0 }; });
    });

  window.OrbWeaver.HiddenRes = { ensure, get, getName, has, add, spend };
})();
