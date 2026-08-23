/* ============================================================
   CORE: SAVE / LOAD
   One autosave slot in localStorage, plus export/import as text so a
   player whose browser storage gets wiped isn't a lost player.

   THE ONE RULE FOR ADDING A MECHANIC:
     Save.register(id, saveFn, loadFn)
   saveFn returns a plain object, or may be null entirely when a
   mechanic stores nothing of its own. loadFn always runs on load —
   including for those null-save mechanics, whose load step is
   recomputing derived state from a track they don't own. Anything not
   JSON-safe — DOM nodes, functions, class instances — must not go in.

   SAVE THE SEED, NOT THE FRUIT. Store the smallest input that lets the
   value be recomputed, never the computed value itself. Wood saves its
   ladder INDEX, not its current name/rate/cap; Tents saves how many
   tents were built, not the current cost. This is what lets you
   rebalance numbers after release without freezing existing players on
   the old ones — the new table simply reaches them on next load.

   LOAD ORDER matters and is fixed below: resources, then worker pools,
   then tracks (which replay completed items and their side effects),
   then mechanics, then card visibility, then one repaint.

   FORMAT: OW1|<base64 of UTF-8 JSON>|<checksum>
   Base64 so a save isn't casually hand-editable into a broken state,
   checksummed so a truncated copy-paste fails loudly instead of
   silently loading half a game, prefixed and versioned so a future
   format change can migrate rather than break.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const STORAGE_KEY = 'orbweaver.save.v1';
  const FORMAT = 'OW1';
  const VERSION = 1;
  const AUTOSAVE_MS = 20000;

  const participants = []; // { id, save, load }
  let loading = false;
  let cheatsUsed = false;
  let autosaveId = null;
  let lastOfflineSeconds = 0;
  /* Set once a reload has been committed to (import, erase). A browser
     fires pagehide and beforeunload on its way out of the page, and both
     are wired to autosave — so without this flag the CURRENT game gets
     written over the save we just deliberately put in storage, and the
     page reloads into the very state the player was trying to replace.
     That is the bug that made Import silently do nothing. */
  let suspended = false;

  function register(id, saveFn, loadFn) { participants.push({ id, save: saveFn, load: loadFn }); }
  function isLoading() { return loading; }
  function markCheated() { cheatsUsed = true; }

  /* ---------------- Encoding ---------------- */

  // FNV-1a over the JSON. Not security — just enough to catch a
  // truncated or mangled paste before it corrupts a real save.
  function checksum(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  // btoa only accepts Latin-1, so UTF-8 encode first (resource names
  // could easily contain a non-ASCII character one day).
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encode(obj) {
    const json = JSON.stringify(obj);
    return `${FORMAT}|${b64encode(json)}|${checksum(json)}`;
  }

  // Returns the save object, or throws an Error with a message meant
  // for the player rather than the console.
  function decode(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Nothing was pasted.');
    const parts = trimmed.split('|');
    if (parts[0] !== FORMAT) {
      throw new Error("That doesn't look like an Orb Weaver save — it should start with OW1|");
    }
    if (parts.length !== 3) {
      throw new Error('This save is incomplete — make sure the whole code was copied, right to the end.');
    }
    let json;
    try { json = b64decode(parts[1]); }
    catch (e) { throw new Error('This save is damaged and could not be read.'); }
    if (checksum(json) !== parts[2]) {
      throw new Error('This save is incomplete or was altered — check the whole text was copied.');
    }
    let obj;
    try { obj = JSON.parse(json); }
    catch (e) { throw new Error('This save is damaged and could not be read.'); }
    return migrate(obj);
  }

  /* ---------------- Versioning ----------------
     Empty today, deliberately. Adding versioning after players hold
     saves is miserable; adding it now is free. Each future format
     change appends one step here that upgrades the previous shape. */
  function migrate(data) {
    if (!data || typeof data !== 'object') throw new Error('This save is damaged and could not be read.');
    const v = data.version || 0;
    if (v > VERSION) throw new Error('This save is from a newer version of the game.');
    // if (data.version < 2) { ...transform...; data.version = 2; }
    return data;
  }

  /* ---------------- Collecting ---------------- */

  function serialize() {
    const tracks = {};
    const registered = window.OrbWeaver.Upgrades.allTracks();
    Object.keys(registered).forEach((key) => {
      const t = registered[key];
      if (t && t.serialize) tracks[key] = t.serialize();
    });

    const pools = {};
    const poolMap = window.OrbWeaver.Workers.getPools();
    Object.keys(poolMap).forEach((k) => { pools[k] = poolMap[k].serialize(); });

    const mechanics = {};
    participants.forEach((p) => {
      const d = p.save ? p.save() : null;
      if (d != null) mechanics[p.id] = d;
    });

    const cards = {};
    window.OrbWeaver.Mechanics.all().forEach((m) => {
      cards[m.id] = { r: m.revealed ? 1 : 0, l: m.locked ? 1 : 0 };
    });

    return {
      version: VERSION,
      savedAt: Date.now(),
      cheatsUsed: cheatsUsed,
      resources: window.OrbWeaver.Resources.serialize(),
      pools: pools,
      tracks: tracks,
      mechanics: mechanics,
      cards: cards,
      log: window.OrbWeaver.Footer.serialize()
    };
  }

  /* ---------------- Applying ---------------- */

  function restoreResources(saved) {
    if (!saved) return;
    Object.keys(saved).forEach((id) => {
      const r = saved[id];
      // A dynamic resource (created when cargo first delivered it to a
      // destination) doesn't exist on a fresh boot. Recreate it through
      // its owning location, which knows the right left-hand mount.
      if (!window.OrbWeaver.Resources.exists(id) && r.dyn) {
        const loc = window.OrbWeaver.Locations.all()
          .filter((l) => l.prefix && id.startsWith(l.prefix))
          .sort((a, b) => b.prefix.length - a.prefix.length)[0];
        if (loc && loc.ensureResource) loc.ensureResource(id.slice(loc.prefix.length), r.n || id);
      }
      if (!window.OrbWeaver.Resources.exists(id)) return;
      window.OrbWeaver.Resources.setRaw(id, r.v, r.cap);
      if (r.h) window.OrbWeaver.Resources.conceal(id);
      else window.OrbWeaver.Resources.reveal(id);
    });
  }

  function deserialize(data) {
    loading = true;
    window.OrbWeaver.Footer.setMuted(true);
    window.OrbWeaver.Cards.setRenderEnabled(false);
    try {
      cheatsUsed = !!data.cheatsUsed;
      window.OrbWeaver.Footer.deserialize(data.log); // before offline catch-up appends to it

      restoreResources(data.resources);

      const poolMap = window.OrbWeaver.Workers.getPools();
      Object.keys(data.pools || {}).forEach((k) => { if (poolMap[k]) poolMap[k].deserialize(data.pools[k]); });

      // Tracks before mechanics: replaying a completed choice-track item
      // fires its onComplete, which is how revealed cards and research
      // effects (Market bundle sizes, sale slots) come back.
      const registered = window.OrbWeaver.Upgrades.allTracks();
      Object.keys(data.tracks || {}).forEach((key) => {
        const t = registered[key];
        if (t && t.deserialize) t.deserialize(data.tracks[key]);
      });

      // Note the `|| {}`: a participant may legitimately save NOTHING
      // and still need loading. Wood, Stone and Quarry are exactly that
      // — they store no state of their own, and their whole load step
      // is replaying the ladder table up to the track's restored index.
      // Skipping them because there was no saved blob left every
      // resource card sitting at its tier-one name and rate.
      participants.forEach((p) => {
        if (!p.load) return;
        try { p.load((data.mechanics || {})[p.id] || {}); }
        catch (err) { console.error(`[Orb Weaver] ${p.id} failed to load its save data:`, err); }
      });

      // Card visibility last: the flags are the truth, the DOM follows.
      Object.keys(data.cards || {}).forEach((id) => {
        const m = window.OrbWeaver.Mechanics.get(id);
        if (!m) return; // a card removed from the game since this save
        m.revealed = !!data.cards[id].r;
        m.locked = !!data.cards[id].l;
      });
      window.OrbWeaver.Mechanics.all().forEach((m) => window.OrbWeaver.Cards.applyVisibility(m));

      lastOfflineSeconds = data.savedAt ? Math.max(0, (Date.now() - data.savedAt) / 1000) : 0;

      // One tick of ZERO length: advances no timers and produces no
      // resources, but lets every mechanic recompute its derived status
      // ('idle' / 'producing' / 'stopped', gold-starvation flags) from
      // the freshly restored world. Without it a card can show a stale
      // label for the first 200ms after loading.
      window.OrbWeaver.Loop.runBulk(1, 0);
    } finally {
      window.OrbWeaver.Cards.setRenderEnabled(true);
      window.OrbWeaver.Footer.setMuted(false);
      loading = false;
      window.OrbWeaver.Cards.refreshAll();
    }
  }

  /* ---------------- Storage ---------------- */

  function saveToStorage() {
    if (suspended) return false; // a reload is in flight; do not clobber it
    try {
      localStorage.setItem(STORAGE_KEY, encode(serialize()));
      return true;
    } catch (err) {
      // Private browsing, or storage full. Say so once rather than
      // failing silently every 20 seconds.
      console.error('[Orb Weaver] Could not autosave:', err);
      window.OrbWeaver.Footer.push('Could not save — your browser is blocking storage. Use Export in Settings to keep a copy.');
      return false;
    }
  }

  // Private browsing (notably Safari) exposes localStorage but throws on
  // write. Probing once is the only reliable way to know.
  function storageWorks() {
    try {
      localStorage.setItem(STORAGE_KEY + '.probe', '1');
      localStorage.removeItem(STORAGE_KEY + '.probe');
      return true;
    } catch (e) { return false; }
  }

  function hasSave() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
  }

  function loadFromStorage() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      deserialize(decode(raw));
      return true;
    } catch (err) {
      // A corrupt autosave must never soft-lock the game on every boot.
      // Set it aside under a different key so it can be recovered, and
      // start fresh.
      console.error('[Orb Weaver] Save could not be loaded:', err);
      try { localStorage.setItem(STORAGE_KEY + '.broken', raw); localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      window.OrbWeaver.Footer.push('Your save could not be read and has been set aside. Starting a new game.');
      return false;
    }
  }

  function clearSave() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function exportText() { return encode(serialize()); }

  /* Import. Preferred path is write-to-storage then reload, because a
     clean boot from the imported data is the most predictable outcome.
     Two things that path must get right:

       1. Autosave has to be suspended BEFORE the reload, or the unload
          handlers write the current game over the import.
       2. Some browsers (private windows especially) allow reads but
          throw on write. Rather than fail, fall back to applying the
          save to the running game — the same deserialize() the game
          uses at boot, just later. Any open modal is closed first so
          nothing is left rendering against replaced state.

     Returns true on success; throws an Error with a player-readable
     message if the text itself is not a usable save. */
  function importText(text) {
    const data = decode(text); // throws with a player-readable message

    if (storageWorks()) {
      suspended = true;
      try {
        localStorage.setItem(STORAGE_KEY, encode(data));
        location.reload();
        return true;
      } catch (err) {
        suspended = false; // write failed after all — fall through
        console.error('[Orb Weaver] Import could not be written to storage:', err);
      }
    }

    window.OrbWeaver.Cards.closeModal();
    deserialize(data);
    window.OrbWeaver.Footer.push('Save imported. This browser is blocking storage, so export a copy before you close the tab.');
    return true;
  }

  // Erase has the same unload problem as import: without suspending,
  // the current game is written straight back over the cleared slot.
  function eraseAndReload() {
    suspended = true;
    clearSave();
    location.reload();
  }

  function startAutosave() {
    if (autosaveId) return;
    autosaveId = setInterval(saveToStorage, AUTOSAVE_MS);
    // pagehide is the reliable one on mobile Safari, where a tab can be
    // discarded without ever firing beforeunload.
    window.addEventListener('pagehide', saveToStorage);
    window.addEventListener('beforeunload', saveToStorage);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveToStorage(); });
  }

  /* ---------------- Offline seam (Stage 3) ----------------
     savedAt is recorded from day one so that when offline progress is
     built, saves written today already carry what it needs. The hook
     below is deliberately empty: Stage 3 fills it with the 24-hour
     capped, coarse 1-second replay via Loop.runBulk(), plus whatever
     offline bonus gets designed. */
  function getLastOfflineSeconds() { return lastOfflineSeconds; }

  /* ---------------- Boot ----------------
     init(onReady) restores the save, then hands control to the offline
     catch-up, which may span several animation frames while it replays
     and shows its summary. onReady fires exactly once when the world is
     settled — main.js starts the game loop there, NOT before, so live
     ticks can't run concurrently with the replay and double-count. */
  function init(onReady) {
    let fired = false;
    const ready = () => { if (!fired) { fired = true; startAutosave(); if (onReady) onReady(); } };

    let loaded = false;
    try { loaded = loadFromStorage(); }
    catch (err) { console.error('[Orb Weaver] Load failed:', err); }

    if (!loaded || !window.OrbWeaver.Offline) { ready(); return loaded; }

    try { window.OrbWeaver.Offline.apply(lastOfflineSeconds, ready); }
    catch (err) {
      // Offline progress failing must never stop the game starting.
      console.error('[Orb Weaver] Offline catch-up failed:', err);
      ready();
    }
    return loaded;
  }

  window.OrbWeaver.Save = {
    register, init, serialize, deserialize, encode, decode,
    saveToStorage, loadFromStorage, hasSave, clearSave, eraseAndReload, storageWorks,
    exportText, importText, isLoading, markCheated, getLastOfflineSeconds
  };

  /* ---------------- Settings UI + cheat flag ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    // Any cheat press stamps the save. Costs nothing now and you'll
    // want it the moment there's an achievement or a leaderboard.
    const header = document.getElementById('cheat-header');
    if (header) header.addEventListener('click', (e) => { if (e.target.closest('.cheat-btn')) markCheated(); });

    const box = document.getElementById('save-text');
    const status = document.getElementById('save-status');
    const setStatus = (msg) => { if (status) status.textContent = msg || ''; };

    const exportBtn = document.getElementById('save-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      box.value = exportText();
      box.select();
      const manual = () => setStatus('Copy the whole code above (it is already selected) and keep it somewhere safe.');
      // Clipboard access is blocked in plenty of contexts — insecure
      // origins, private windows, some mobile browsers. Selecting the
      // text means a manual copy always works as a fallback.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.value)
          .then(() => setStatus('Save copied to clipboard. Keep it somewhere safe.'))
          .catch(manual);
      } else {
        try {
          if (document.execCommand('copy')) setStatus('Save copied to clipboard. Keep it somewhere safe.');
          else manual();
        } catch (e) { manual(); }
      }
    });

    const importBtn = document.getElementById('save-import-btn');
    if (importBtn) {
      // The box is always on screen, so importing is one action: paste,
      // then press. An earlier version opened the box on the first press
      // and imported on the second, which read as the button doing
      // nothing. Never make a button's first press invisible.
      importBtn.addEventListener('click', () => {
        const text = box.value.trim();
        if (!text) {
          box.focus();
          setStatus('Paste your save code into the box above first.');
          return;
        }
        try {
          setStatus('Loading…');
          importText(text);
          setStatus('Save loaded.');
        } catch (err) {
          setStatus(err.message);
        }
      });
    }

    const resetBtn = document.getElementById('save-reset-btn');
    if (resetBtn) {
      let armed = false;
      resetBtn.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = 'Really erase? Click again';
          setStatus('This erases your save permanently. Export a copy first if you want one.');
          setTimeout(() => { armed = false; resetBtn.textContent = 'Erase save'; }, 5000);
          return;
        }
        eraseAndReload();
      });
    }
  });
})();
