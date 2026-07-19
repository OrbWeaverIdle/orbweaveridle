/* ================================================================
   ORB WEAVER — ENGINE
   ----------------------------------------------------------------
   This file is the GENERIC engine. It contains no card names, no
   tooltip text, and no gameplay numbers of its own. Everything it
   renders and every rule it evaluates is driven by:
     - the JSON files under data/ (content + numbers)
     - the mechanic modules registered on window.Mechanics
       (mechanics/breath.js registers window.Mechanics.breath)

   Engine responsibilities:
     - fetch() all JSON at startup
     - render header / sidebar / general area from that data
     - evaluate a small generic rule grammar (visibility/lock/name
       overrides/tooltip conditions) and delegate anything it
       doesn't recognize to the owning mechanic module
     - drive the 1s tick loop, save/load, offline replay, boost
     - own the cheat menu shell (mechanics may add their own button)
   ================================================================ */

const APP = {
  config: null,
  tiers: {},
  cards: {},
  augments: {},         // id(string) -> augment data
  mechanics: {},
  resourceDefaults: {},
  codex: null,
  _neuroplasticityAnimated: false,
  _revealedCards: new Set(),     // card ids that have already played their one-time "revealText" reveal animation
  _expandedCards: new Set(),     // card ids whose click-to-expand info panel is currently open
  _expandedSideRows: new Set()   // resource names whose sidebar expand panel is currently open
};

const state = {
  currentTier: 2,
  unlockedTiers: [2],
  tierRevealed: true,
  placeholdersEnabled: false,
  headerMinimized: false,
  playerLevel: 1,
  chronicleLog: [],                              // [{tier, text}]
  usedChronicleLines: { 1: [], 2: [], 3: [], 4: [] },
  ticksSinceChronicle: 0,
  resources: {},                                  // name -> {amount, cap, perSec}
  boostSeconds: 0,
  mechanicState: {}                                // mechanicId -> opaque state bag
};

/* A context object handed to every mechanic hook. Mechanics never
   touch APP/state directly by import — everything they need comes
   through this object, so the dependency direction is one-way
   (engine -> mechanic), never the reverse. */
function makeCtx() {
  return {
    config: APP.config,
    state,
    mechanics: APP.mechanics,
    getResource,
    setResource,
    addResource,
    getMechState(id) {
      if (!state.mechanicState[id]) state.mechanicState[id] = {};
      return state.mechanicState[id];
    }
  };
}

/* ----------------------------------------------------------------
   DATA LOADING
   ---------------------------------------------------------------- */
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function loadAllData() {
  APP.config = await fetchJSON('data/config.json');

  // Tiers
  const tierEntries = await Promise.all(
    APP.config.tierIds.map(async (id) => {
      const data = await fetchJSON(APP.config.tierDataPaths[String(id)]);
      data.progress = 0;
      data.ascended = false;
      data.allResources = [
        ...(data.resourceGroups.group1 || []),
        ...(data.resourceGroups.group2 || []),
        ...(data.resourceGroups.group3 || [])
      ];
      return [id, data];
    })
  );
  tierEntries.forEach(([id, data]) => { APP.tiers[id] = data; });

  // Collect every card id referenced by every tier's categories
  const cardIds = new Set();
  Object.values(APP.tiers).forEach(t => {
    (t.categories || []).forEach(cat => (cat.cardIds || []).forEach(id => cardIds.add(id)));
    // Also load research cards declared by this tier (used by the Research modal,
    // not rendered in the general area directly)
    (t.researchCardIds || []).forEach(id => cardIds.add(id));
  });
  const cardEntries = await Promise.all(
    [...cardIds].map(async (id) => [id, await fetchJSON(`data/cards/${id}.json`)])
  );
  cardEntries.forEach(([id, data]) => { APP.cards[id] = data; });

  // Codex
  APP.codex = await fetchJSON('data/codex.json');

  // Augments — load all JSON files listed in config.augmentIds
  const augmentIds = (APP.config.augmentIds) || [];
  if (augmentIds.length) {
    const augmentEntries = await Promise.all(
      augmentIds.map(async (id) => [id, await fetchJSON(`data/augments/${id}.json`)])
    );
    augmentEntries.forEach(([id, data]) => { APP.augments[id] = data; });
  }

  // Mechanics: any module pre-registered on window.Mechanics declares
  // its own config path; the engine fetches that config generically.
  const mechModules = Object.values(window.Mechanics || {});
  for (const mech of mechModules) {
    APP.mechanics[mech.id] = mech;
    if (mech.configPath) {
      mech.config = await fetchJSON(mech.configPath);
    }
    if (mech.config && mech.config.resourceDefaults) {
      Object.entries(mech.config.resourceDefaults).forEach(([name, def]) => {
        APP.resourceDefaults[name] = def;
      });
    }
  }
}

/* ----------------------------------------------------------------
   GENERIC RULE EVALUATOR
   ----------------------------------------------------------------
   Understands a small closed set of universal rules. Anything else
   is delegated to the mechanic named on the card (card.mechanic),
   via mechanic.evaluateRule(ruleName, value, card, ctx).
   ---------------------------------------------------------------- */
function evalRule(ruleObj, card, ctx) {
  if (!ruleObj) return true;
  switch (ruleObj.rule) {
    case 'always': return true;
    case 'never': return false;
    case 'playerLevelAtLeast': return ctx.state.playerLevel >= ruleObj.value;
    case 'latch': {
      const bag = ctx.state.mechanicState[card.mechanic] || {};
      return !!bag[ruleObj.value];
    }
    case 'not': return !evalRule(ruleObj.of, card, ctx);
    case 'allOf': return (ruleObj.rules || []).every(r => evalRule(r, card, ctx));
    case 'anyOf': return (ruleObj.rules || []).some(r => evalRule(r, card, ctx));
    default: {
      const mech = ctx.mechanics[card.mechanic];
      if (mech && typeof mech.evaluateRule === 'function') {
        return mech.evaluateRule(ruleObj.rule, ruleObj.value, card, ctx);
      }
      return true;
    }
  }
}

function isCardVisible(card, ctx) { return evalRule(card.visibility, card, ctx); }
function isCardLocked(card, ctx) { return evalRule(card.lock, card, ctx); }

function resolveCardName(card, ctx) {
  let name = card.name;
  (card.nameOverrides || []).forEach(o => { if (evalRule(o.rule, card, ctx)) name = o.name; });
  const mech = ctx.mechanics[card.mechanic];
  if (mech && typeof mech.resolveTooltipTokens === 'function') {
    name = mech.resolveTooltipTokens(name, ctx);
  }
  return name;
}

function resolveCardTooltip(card, ctx) {
  let lines = [];
  if (card.tooltip) lines = card.tooltip.slice();
  if (card.tooltipBlocks) {
    lines = [];
    card.tooltipBlocks.forEach(block => {
      if (evalRule(block.when, card, ctx)) lines.push(...block.lines);
    });
  }
  const mech = ctx.mechanics[card.mechanic];
  if (mech && typeof mech.resolveTooltipTokens === 'function') {
    lines = lines.map(line => mech.resolveTooltipTokens(line, ctx));
  }
  return lines.filter(l => (l || '').trim().length > 0);
}

// Returns [[line,line],[line]] — one inner array per tooltipBlock, empty blocks omitted.
// Used by the expand panel renderer so dividers appear between blocks, not between
// individual lines within the same block.
function resolveCardTooltipBlocks(card, ctx) {
  const mech = ctx.mechanics[card.mechanic];
  const resolve = line => (mech && typeof mech.resolveTooltipTokens === 'function')
    ? mech.resolveTooltipTokens(line, ctx) : line;
  const filterLine = l => (l || '').trim().length > 0;

  if (card.tooltipBlocks) {
    return card.tooltipBlocks
      .filter(block => evalRule(block.when, card, ctx))
      .map(block => block.lines.map(resolve).filter(filterLine))
      .filter(group => group.length > 0);
  }
  // Plain tooltip array — treat as a single block
  if (card.tooltip) {
    const group = card.tooltip.map(resolve).filter(filterLine);
    return group.length ? [group] : [];
  }
  return [];
}

function resourceIsVisible(name, ctx) {
  for (const mech of Object.values(ctx.mechanics)) {
    if (mech.ownsResource && mech.ownsResource(name)) {
      return mech.isResourceVisible ? mech.isResourceVisible(name, ctx) : true;
    }
  }
  return true; // generic placeholder resources: always visible once their group is shown
}

/* ----------------------------------------------------------------
   RESOURCES (generic)
   ---------------------------------------------------------------- */
function getResource(name) {
  if (!state.resources[name]) {
    const d = APP.resourceDefaults[name] || {};
    state.resources[name] = { amount: 0, cap: d.cap !== undefined ? d.cap : null, perSec: 0 };
  }
  return state.resources[name];
}
function setResource(name, patch) { Object.assign(getResource(name), patch); }
function addResource(name, delta) {
  const r = getResource(name);
  r.amount += delta;
  if (r.cap !== null && r.cap !== undefined) r.amount = Math.min(r.amount, r.cap);
  r.amount = Math.max(0, r.amount);
}
function fmtRes(n) { return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1); }
function fmtRate(n) { return Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(1); }

let resDOM = {};

function patchResourceDOM(name) {
  const ctx = makeCtx();
  for (const mech of Object.values(APP.mechanics)) {
    if (mech.ownsResource && mech.ownsResource(name) && typeof mech.renderResourceRow === 'function') {
      const handled = mech.renderResourceRow(name, resDOM[name] ? resDOM[name].row : null, ctx, false);
      if (handled) return;
    }
  }
  const els = resDOM[name];
  if (!els) return;
  const r = getResource(name);
  const atCap = r.cap !== null && r.cap !== undefined && r.amount >= r.cap;
  els.amountEl.textContent = fmtRes(r.amount);
  els.amountEl.classList.toggle('at-cap', atCap);
  els.capEl.textContent = (r.cap !== null && r.cap !== undefined) ? `/${fmtRes(r.cap)}` : '';

  // Food gets its net per-second rate from pet specials (not r.perSec)
  if (name === 'Food') {
    let netRate = 0;
    for (const mech of Object.values(APP.mechanics)) {
      if (typeof mech.getComputedSpecials === 'function') {
        const sp = mech.getComputedSpecials(ctx);
        netRate = sp.foodPerSec - sp.totalFoodConsumed;
        break;
      }
    }
    if (netRate !== 0) {
      els.rateEl.textContent = `${netRate >= 0 ? '+' : ''}${netRate.toFixed(1)} /s`;
      els.rateEl.classList.remove('hidden-rate');
      els.rateEl.classList.toggle('rate-negative', netRate < 0);
      els.rateEl.classList.toggle('rate-positive', netRate >= 0);
    } else {
      els.rateEl.innerHTML = '&nbsp;';
      els.rateEl.classList.add('hidden-rate');
      els.rateEl.classList.remove('rate-negative', 'rate-positive');
    }
    return;
  }

  if (r.perSec !== 0) {
    els.rateEl.textContent = `${fmtRate(r.perSec)} /s`;
    els.rateEl.classList.remove('hidden-rate');
    els.rateEl.classList.toggle('rate-negative', r.perSec < 0);
  } else {
    els.rateEl.innerHTML = '&nbsp;';
    els.rateEl.classList.add('hidden-rate');
    els.rateEl.classList.remove('rate-negative');
  }
}

function tickResources(sim = false) {
  const t = APP.tiers[state.currentTier];
  const tickFraction = (APP.config.tickIntervalMs || 1000) / 1000;
  t.allResources.forEach(resName => {
    const r = getResource(resName);
    if (r.perSec !== 0) {
      r.amount += r.perSec * tickFraction;
      if (r.cap !== null && r.cap !== undefined) r.amount = Math.min(r.amount, r.cap);
      r.amount = Math.max(0, r.amount);
    }
    if (!sim) patchResourceDOM(resName);
  });
}

/* ----------------------------------------------------------------
   RENDER: HEADER
   ---------------------------------------------------------------- */
function currentTierConfig() { return APP.tiers[state.currentTier]; }

function setTierProgress(tierId, value) {
  const t = APP.tiers[tierId];
  if (!t) return;
  t.progress = Math.max(0, Math.min(100, value));
}

const ICONS = {
  wind: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 8h13a3 3 0 1 0-2.5-4.7"/><path d="M2 12.5h17a3 3 0 1 1-2.5 4.7"/><path d="M2 17h9"/></svg>`,
  triangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3 21 20H3z"/></svg>`,
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/></svg>`,
  none: ``
};

function applyTierColors() {
  const app = document.getElementById('app');
  const t = currentTierConfig();
  app.dataset.tier = state.currentTier;
  app.style.setProperty('--tier', t.color.tier);
  app.style.setProperty('--tier-2', t.color.tier2);
  app.style.setProperty('--tier-dark', t.color.tierDark);
  app.style.setProperty('--tier-soft', t.color.tierSoft);
}

function rebuildProgressLogoIcon() {
  const t = currentTierConfig();
  const iconHTML = ICONS[t.icon] || '';
  document.getElementById('logo-base').innerHTML = iconHTML;
  const fillEl = document.getElementById('logo-fill');
  fillEl.innerHTML = iconHTML;
  fillEl.style.transition = 'none';
}

function renderProgressLogo() {
  const t = currentTierConfig();
  const pct = Math.max(0, Math.min(100, t.progress));
  let clip;
  if (t.fillDirection === 'vertical') clip = `inset(${100 - pct}% 0 0 0)`;
  else if (t.fillDirection === 'horizontal') clip = `inset(0 ${100 - pct}% 0 0)`;
  else clip = pct >= 100 ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)';

  const fillEl = document.getElementById('logo-fill');
  if (fillEl) {
    fillEl.style.clipPath = clip;
    if (fillEl.style.transition === 'none') {
      requestAnimationFrame(() => { fillEl.style.transition = 'clip-path 0.4s ease'; });
    }
  }
  const canAscend = pct >= 100 && !t.ascended && !!APP.tiers[state.currentTier + 1];
  document.getElementById('ascend-btn').classList.toggle('ascend-ready', canAscend);
}

function renderHeader() {
  applyTierColors();
  const t = currentTierConfig();
  document.getElementById('subtitle-text').textContent = `${t.name} — ${t.subtitle}`;

  const app = document.getElementById('app');
  if (app._lastIconTier !== state.currentTier) {
    app._lastIconTier = state.currentTier;
    rebuildProgressLogoIcon();
  }
  renderProgressLogo();

  const row = document.getElementById('tier-select-row');
  row.innerHTML = '';
  const shownTierIds = new Set(state.unlockedTiers);
  Object.values(APP.tiers).forEach(tt => { if (tt.visibleWhenLocked) shownTierIds.add(tt.id); });
  [...shownTierIds].sort((a, b) => a - b).forEach(tierId => {
    const unlocked = state.unlockedTiers.includes(tierId);
    const btn = document.createElement('button');
    btn.className = 'tier-btn' +
      (tierId === state.currentTier ? ' current' : '') +
      (!unlocked ? ' locked' : '');
    btn.textContent = APP.tiers[tierId].name;
    if (unlocked) {
      btn.addEventListener('click', () => {
        if (state.currentTier !== tierId) {
          state.currentTier = tierId;
          fullRerenderTierScoped();
          maybeShowPendingEncounter();
        }
      });
    }
    row.appendChild(btn);
  });
  row.classList.toggle('hidden', !state.tierRevealed);
  document.getElementById('hide-reveal-tiers-btn').textContent = state.tierRevealed ? 'Hide Tiers' : 'Reveal Tiers';
  renderBackground();
}

/* ----------------------------------------------------------------
   BACKGROUND (delegated to whichever mechanic owns it for this tier)
   ---------------------------------------------------------------- */
function renderBackground() {
  const ctx = makeCtx();
  const t = currentTierConfig();
  let color = t.backgroundHex || APP.config.defaultBackgroundHex || '#141414';
  (t.mechanics || []).forEach(mechId => {
    const mech = APP.mechanics[mechId];
    if (mech && typeof mech.getBackgroundColor === 'function') {
      color = mech.getBackgroundColor(ctx);
    }
  });
  document.body.style.backgroundColor = color;
}

/* ----------------------------------------------------------------
   RENDER: SIDEBAR
   ---------------------------------------------------------------- */
function rebuildChronicleList() {
  const list = document.getElementById('chronicle-list');
  list.innerHTML = '';
  state.chronicleLog
    .filter(entry => entry.tier === state.currentTier)
    .forEach(entry => appendChronicleLine(entry.text, false, entry.color));
}
function appendChronicleLine(text, scroll = true, color = null) {
  const list = document.getElementById('chronicle-list');
  const line = document.createElement('div');
  line.className = 'chronicle-line';
  if (color) line.style.color = color;
  line.textContent = text;
  list.appendChild(line);
  if (scroll) list.scrollTop = list.scrollHeight;
}

function renderSidebar() {
  rebuildChronicleList();
  resDOM = {};
  const ctx = makeCtx();
  const t = currentTierConfig();
  const mechIds = t.mechanics || [];

  const groups = [t.resourceGroups.group1 || [], t.resourceGroups.group2 || [], t.resourceGroups.group3 || []];
  const groupKeys = ['group1', 'group2', 'group3'];
  const listIds = ['res1-list', 'res2-list', 'res3-list'];
  const dividerIds = ['div-1', 'div-2', 'div-3'];
  const labelIds = ['label-1', 'label-2', 'label-3'];
  const groupLabels = t.resourceGroups.groupLabels || {};
  const groupExpandable = t.resourceGroups.groupExpandable || {};
  const groupVisibilityGated = t.resourceGroups.groupVisibilityGated || {};
  const groupAlwaysShowAfterFirst = t.resourceGroups.groupAlwaysShowAfterFirst || {};

  groups.forEach((group, i) => {
    const listEl = document.getElementById(listIds[i]);
    listEl.innerHTML = '';
    const isExpandableGroup = !!groupExpandable[groupKeys[i]];
    const isVisibilityGated = !!groupVisibilityGated[groupKeys[i]];

    // Build the list of names to render for this group.
    // For group 0: mechanic-owned resources not listed in ANY group come first
    // (e.g. Tier 1's Breath and Essence, which aren't in tier1.json's group lists).
    // Then add names declared in the group's JSON list per their own visibility rules.
    let namesToRender = [];

    if (i === 0) {
      const allGroupNames = new Set([...groups[0], ...groups[1], ...groups[2]]);
      mechIds.forEach(mechId => {
        const mech = APP.mechanics[mechId];
        if (!mech || !mech.ownedResourceNames) return;
        mech.ownedResourceNames.forEach(name => {
          if (!allGroupNames.has(name) && resourceIsVisible(name, ctx)) {
            namesToRender.push(name);
          }
        });
      });
    }

    // Add names declared in this group's JSON list
    const declaredVisible = group.filter(name => {
      for (const mechId of mechIds) {
        const mech = APP.mechanics[mechId];
        if (mech && mech.ownsResource && mech.ownsResource(name)) {
          return mech.isResourceVisible ? mech.isResourceVisible(name, ctx) : true;
        }
      }
      // Not mechanic-owned: apply gating or placeholder logic
      if (isVisibilityGated) {
        for (const mechId of mechIds) {
          const mech = APP.mechanics[mechId];
          if (mech && typeof mech.isGroup1ResourceVisible === 'function') {
            if (mech.isGroup1ResourceVisible(name, ctx)) return true;
          }
        }
        return false;
      }
      return state.placeholdersEnabled;
    });
    namesToRender = namesToRender.concat(declaredVisible);

    const show = namesToRender.length > 0 ||
      (!!groupAlwaysShowAfterFirst[groupKeys[i]] && mechIds.some(mechId => {
        const mech = APP.mechanics[mechId];
        return mech && typeof mech.isGroupAlwaysShown === 'function' && mech.isGroupAlwaysShown(groupKeys[i], ctx);
      }));

    const labelEl = document.getElementById(labelIds[i]);
    if (labelEl) labelEl.textContent = groupLabels[groupKeys[i]] || '';

    namesToRender.forEach(resName => {
      const row = document.createElement('div');
      row.className = 'resource-row';
      row.dataset.resName = resName;

      // Give mechanic-owned resources first crack at fully custom markup.
      let handledCustom = false;
      for (const mechId of mechIds) {
        const mech = APP.mechanics[mechId];
        if (mech && mech.ownsResource && mech.ownsResource(resName) && typeof mech.renderResourceRow === 'function') {
          resDOM[resName] = { row };
          handledCustom = mech.renderResourceRow(resName, row, ctx, true);
          if (handledCustom) break;
        }
      }
      if (!handledCustom) {
        row.innerHTML = `
          <div class="res-row-top">
            <span class="res-name">${resName}</span>
            <span class="res-amount" data-res-amount="${resName}"></span>
            <span class="res-cap" data-res-cap="${resName}"></span>
          </div>
          <div class="res-row-bottom">
            <span class="res-rate hidden-rate" data-res-rate="${resName}">&nbsp;</span>
          </div>`;
        resDOM[resName] = {
          row,
          amountEl: row.querySelector(`[data-res-amount="${resName}"]`),
          capEl: row.querySelector(`[data-res-cap="${resName}"]`),
          rateEl: row.querySelector(`[data-res-rate="${resName}"]`)
        };
        patchResourceDOM(resName);

        if (isExpandableGroup) {
          const isOpen = APP._expandedSideRows.has(resName);
          const arrow = document.createElement('div');
          arrow.className = 'side-row-arrow' + (isOpen ? ' open' : '');
          arrow.textContent = '\u203A';
          arrow.addEventListener('click', () => {
            if (APP._expandedSideRows.has(resName)) APP._expandedSideRows.delete(resName);
            else APP._expandedSideRows.add(resName);
            renderSidebar();
          });
          row.querySelector('.res-row-top').appendChild(arrow);

          const panel = document.createElement('div');
          panel.className = 'side-row-panel' + (isOpen ? ' open' : '');
          // Build Eat / Drain / Imbue buttons with live mechanic wiring.
          // Drain and Imbue are hidden until Touch the Orb is researched.
          const drainImbueUnlocked = mechIds.some(mechId => {
            const mech = APP.mechanics[mechId];
            return mech && typeof mech.isDrainImbueUnlocked === 'function' && mech.isDrainImbueUnlocked(ctx);
          });
          const actions = drainImbueUnlocked ? ['eat', 'drain', 'imbue'] : ['eat'];
          actions.forEach(action => {
            const label = action.charAt(0).toUpperCase() + action.slice(1);
            const btn = document.createElement('button');
            btn.className = 'side-row-option';
            btn.type = 'button';

            // For Imbue: show Essence cost if > 0, and disable if insufficient
            if (action === 'imbue') {
              let essenceCost = 0;
              for (const mid of mechIds) {
                const m = APP.mechanics[mid];
                if (m && m.config && m.config.constants && m.config.constants.creatureStats) {
                  const stats = m.config.constants.creatureStats[resName];
                  if (stats) { essenceCost = stats.essenceCost || 0; break; }
                }
              }
              if (essenceCost > 0) {
                const essenceAmt = ctx.getResource('Essence').amount;
                const insufficient = essenceAmt < essenceCost;
                btn.textContent = `${label} (${essenceCost}✦)`;
                if (insufficient) {
                  btn.disabled = true;
                  btn.classList.add('side-row-option--locked');
                }
              } else {
                btn.textContent = label;
              }
            } else {
              btn.textContent = label;
            }
            btn.addEventListener('click', () => {
              // Brief flash animation for visual feedback
              btn.classList.remove('flash');
              void btn.offsetWidth; // reflow to restart animation
              btn.classList.add('flash');
              btn.addEventListener('animationend', () => btn.classList.remove('flash'), { once: true });

              let changed = false;
              for (const mechId of mechIds) {
                const mech = APP.mechanics[mechId];
                if (mech && typeof mech.onCreatureAction === 'function') {
                  const result = mech.onCreatureAction(action, resName, makeCtx());
                  if (result) { changed = true; break; }
                }
              }
              if (changed) {
                // If this creature's count is now 0 (row will disappear),
                // collapse its expand panel so it doesn't reopen on the next row.
                const ctx2 = makeCtx();
                const stillVisible = mechIds.some(mechId => {
                  const mech = APP.mechanics[mechId];
                  return mech && mech.isResourceVisible && mech.isResourceVisible(resName, ctx2);
                });
                if (!stillVisible) APP._expandedSideRows.delete(resName);

                renderSidebar();
                renderGeneralArea(); // Pickup Orb may appear after first Cockroach eat
                patchAllCardsInView();
              }
            });
            panel.appendChild(btn);
          });
          row.appendChild(panel);
        }

        const rateEl = resDOM[resName].rateEl;
        rateEl.addEventListener('mouseenter', (e) => showRateTip(e, resName));
        rateEl.addEventListener('mousemove', (e) => positionRateTip(e));
        rateEl.addEventListener('mouseleave', hideRateTip);
      }
      listEl.appendChild(row);
    });

    // Group 3 (Pets): rendered separately via mechanic hook — not resource rows.
    if (i === 2) {
      let anyPets = false;

      // Pet cap display on the label: "Pets 0/30"
      const labelEl3 = document.getElementById(labelIds[i]);
      if (labelEl3) {
        let totalPets = 0;
        let petCap    = 30;
        mechIds.forEach(mechId => {
          const mech = APP.mechanics[mechId];
          if (mech && typeof mech.getTotalPetCount === 'function') totalPets = mech.getTotalPetCount(ctx);
          if (mech && mech.config && mech.config.constants && mech.config.constants.PET_CAP) petCap = mech.config.constants.PET_CAP;
        });
        labelEl3.innerHTML = `${groupLabels[groupKeys[i]] || ''} <span class="pet-cap-display">${totalPets}/${petCap}</span>`;
      }

      mechIds.forEach(mechId => {
        const mech = APP.mechanics[mechId];
        if (!mech || typeof mech.getPetRows !== 'function') return;
        mech.getPetRows(ctx).forEach(pet => {
          anyPets = true;
          const petKey = `pet:${pet.name}`;
          const isOpen = APP._expandedSideRows.has(petKey);
          const row = document.createElement('div');
          row.className = 'resource-row';

          const topDiv = document.createElement('div');
          topDiv.className = 'res-row-top';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'res-name';
          nameSpan.textContent = pet.name;
          const amtSpan = document.createElement('span');
          amtSpan.className = 'res-amount';
          amtSpan.textContent = pet.count > 1 ? `x${pet.count}` : '';
          topDiv.appendChild(nameSpan);
          topDiv.appendChild(amtSpan);

          const arrow = document.createElement('div');
          arrow.className = 'side-row-arrow' + (isOpen ? ' open' : '');
          arrow.textContent = '\u203A';
          arrow.addEventListener('click', () => {
            if (APP._expandedSideRows.has(petKey)) APP._expandedSideRows.delete(petKey);
            else APP._expandedSideRows.add(petKey);
            renderSidebar();
          });
          topDiv.appendChild(arrow);
          row.appendChild(topDiv);

          const panel = document.createElement('div');
          panel.className = 'side-row-panel' + (isOpen ? ' open' : '');

          const stats = [
            `Attack: ${pet.attack}`,
            `Pet cap: ${pet.petCap}`,
            `Food: -${pet.foodConsumed}/s`,
            pet.special ? `${pet.special}` : null,
            pet.type && pet.type !== 'Normal' ? `Type: ${pet.type}` : null
          ].filter(Boolean);

          stats.forEach(line => {
            const d = document.createElement('div');
            d.className = 'pet-stat';
            d.textContent = line;
            panel.appendChild(d);
          });

          // Dismiss button
          const dismissBtn = document.createElement('button');
          dismissBtn.className = 'side-row-option';
          dismissBtn.type = 'button';
          dismissBtn.textContent = 'Dismiss';
          dismissBtn.addEventListener('click', () => {
            for (const mid of mechIds) {
              const m = APP.mechanics[mid];
              if (m && typeof m.dismissPet === 'function') {
                if (m.dismissPet(pet.name, makeCtx())) {
                  APP._expandedSideRows.delete(petKey);
                  renderSidebar();
                  patchAllCardsInView();
                  break;
                }
              }
            }
          });
          panel.appendChild(dismissBtn);
          row.appendChild(panel);
          listEl.appendChild(row);
        });
      });

      if (anyPets) document.getElementById(dividerIds[i]).classList.remove('hidden');
      if (anyPets) return;
    }

    document.getElementById(dividerIds[i]).classList.toggle('hidden', !show);
  });
}

/* ----------------------------------------------------------------
   RENDER: GENERAL AREA
   ---------------------------------------------------------------- */
function renderGeneralArea() {
  const ctx = makeCtx();
  const area = document.getElementById('general-area');
  area.innerHTML = '';
  const t = currentTierConfig();

  const visibleCats = (t.categories || [])
    .map(cat => {
      const visibleCardIds = (cat.cardIds || []).filter(cid => {
        const card = APP.cards[cid];
        return card && isCardVisible(card, ctx);
      });
      return { cat, visibleCardIds };
    })
    .filter(({ cat, visibleCardIds }) => (!cat.isPlaceholder || state.placeholdersEnabled) && visibleCardIds.length > 0);

  if (visibleCats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = t.emptyText;
    area.appendChild(empty);
    return;
  }

  visibleCats.forEach(({ cat, visibleCardIds }, catIndex) => {
    const section = document.createElement('section');
    section.className = 'category';
    const showTitle = !!cat.showTitle;

    if (showTitle) {
      const header = document.createElement('div');
      header.className = 'category-header has-title';
      header.innerHTML = `<span class="cat-name">${cat.name}</span>`;
      section.appendChild(header);
    }

    const grid = document.createElement('div');
    grid.className = 'card-grid';

    const useExpandPanels = !!t.useExpandPanels;

    visibleCardIds.forEach(cid => {
      const card = APP.cards[cid];

      // Neuroplasticity-style cards: rendered as plain clickable text, not a card box
      if (card.display === 'neuroplasticity') {
        const textEl = document.createElement('button');
        const isFirstRender = !APP._neuroplasticityAnimated;
        textEl.className = 'card-neuroplasticity' + (isFirstRender ? ' animate-in' : '');
        textEl.dataset.cardId = cid;
        textEl.textContent = resolveCardName(card, ctx);
        textEl.addEventListener('click', () => openNeuroplasticityModal(card));
        grid.appendChild(textEl);
        return;
      }

      // revealText: a one-time-blur-reveal clickable text element (e.g. Research),
      // generic version of the neuroplasticity pattern above, keyed per-card-id
      // instead of a single global flag, and not tied to any specific window.
      if (card.display === 'revealText') {
        const alreadyRevealed = APP._revealedCards.has(cid);
        const textEl = document.createElement('button');
        textEl.className = 'card-reveal-text' + (!alreadyRevealed ? ' animate-in' : '');
        textEl.dataset.cardId = cid;
        textEl.textContent = resolveCardName(card, ctx);
        textEl.addEventListener('click', () => openResearchModal());
        if (!alreadyRevealed) APP._revealedCards.add(cid);
        grid.appendChild(textEl);
        return;
      }

      // statText: plain, non-interactive, always-current text (e.g. HP/Age)
      if (card.display === 'statText') {
        const textEl = document.createElement('div');
        textEl.className = 'card-stat-text';
        textEl.dataset.cardId = cid;
        textEl.textContent = resolveCardName(card, ctx);
        grid.appendChild(textEl);
        return;
      }

      const btn = document.createElement('button');
      btn.className = 'card';
      btn.dataset.cardId = cid;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'card-name-text';
      nameSpan.textContent = resolveCardName(card, ctx);
      btn.appendChild(nameSpan);

      if (card.display === 'fillBar') {
        const fillEl = document.createElement('div');
        fillEl.className = 'card-fill';
        fillEl.dataset.fillFor = cid;
        btn.insertBefore(fillEl, btn.firstChild);
      } else if (card.display === 'progressBar') {
        const progEl = document.createElement('div');
        progEl.className = 'card-progress';
        progEl.dataset.fillFor = cid;
        // Apply any mechanic-supplied color override
        const mech = APP.mechanics[card.mechanic];
        if (mech && typeof mech.getProgressBarColor === 'function') {
          const overrideColor = mech.getProgressBarColor(cid, ctx);
          if (overrideColor) progEl.style.background = overrideColor;
        }
        btn.insertBefore(progEl, btn.firstChild);
      }

      refreshCardLockState(btn, card, ctx);

      // Render augment slots if augment-inhale has been purchased for this card
      renderCardAugmentSlots(btn, card, ctx);

      btn.addEventListener('click', () => onCardClick(cid));

      const cardHasExpandPanel = useExpandPanels && !card.noExpandPanel;

      if (cardHasExpandPanel) {
        const isOpen = APP._expandedCards.has(cid);
        const arrow = document.createElement('div');
        arrow.className = 'card-expand-arrow' + (isOpen ? ' open' : '');
        arrow.textContent = '\u203A';
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          if (APP._expandedCards.has(cid)) APP._expandedCards.delete(cid);
          else APP._expandedCards.add(cid);
          renderGeneralArea();
        });
        btn.appendChild(arrow);
      } else if (!useExpandPanels) {
        btn.addEventListener('mouseenter', () => showTooltip(btn, card, ctx));
        btn.addEventListener('mouseleave', hideTooltip);
      }

      // Always wrap in card-wrap so all cards in this tier share identical
      // grid sizing (align-self: start, explicit 67px height).
      // Cards with noExpandPanel get the wrap but no panel or arrow.
      const wrap = document.createElement('div');
      wrap.className = 'card-wrap';
      wrap.appendChild(btn);
      if (cardHasExpandPanel) {
        const isOpen = APP._expandedCards.has(cid);
        const panel = document.createElement('div');
        panel.className = 'card-expand-panel' + (isOpen ? ' open' : '');
        const blocks = resolveCardTooltipBlocks(card, ctx);
        panel.innerHTML = blocks.map(group =>
          `<div class="tt-block">${group.map(line => `<div class="tt-line">${line}</div>`).join('')}</div>`
        ).join('');
        wrap.appendChild(panel);
      }
      grid.appendChild(wrap);
    });

    section.appendChild(grid);

    // Insert a tier-gradient divider after any category flagged dividerAfter
    // (e.g. Tier 1's Neuroplasticity bar, Tier 2's vitals bar), before the
    // next category, constrained to card-grid width.
    if (cat.dividerAfter && catIndex < visibleCats.length - 1) {
      const divider = document.createElement('div');
      const isNeuroplasticity = cat.id === 'neuroplasticity-cat';
      const isFirstRender = isNeuroplasticity && !APP._neuroplasticityAnimated;
      divider.className = 'category-tier-divider' + (isFirstRender ? ' animate-in' : '');
      section.appendChild(divider);
      if (isFirstRender) APP._neuroplasticityAnimated = true;
    }

    area.appendChild(section);
  });
}

function refreshCardLockState(btn, card, ctx) {
  const locked = isCardLocked(card, ctx);
  btn.classList.toggle('is-locked', locked);
  if (card.display === 'fillBar') {
    const fillEl = btn.querySelector('.card-fill');
    const mech = APP.mechanics[card.mechanic];
    if (fillEl && mech && typeof mech.getCardFillFraction === 'function') {
      const frac = Math.max(0, Math.min(1, mech.getCardFillFraction(card.id, ctx) || 0));
      fillEl.style.height = (frac * 100) + '%';
    }
  } else if (card.display === 'progressBar') {
    const progEl = btn.querySelector('.card-progress');
    const mech = APP.mechanics[card.mechanic];
    if (progEl && mech) {
      if (typeof mech.getCardFillFraction === 'function') {
        const frac = Math.max(0, Math.min(1, mech.getCardFillFraction(card.id, ctx) || 0));
        progEl.style.width = (frac * 100) + '%';
      }
      if (typeof mech.getProgressBarColor === 'function') {
        const overrideColor = mech.getProgressBarColor(card.id, ctx);
        progEl.style.background = overrideColor || '#B6812F';
      }
    }
  }
}

/* Cheap per-tick / per-click refresh of card name/lock/fill without a
   full DOM rebuild — mirrors the "structural render vs. tick patch"
   split used everywhere else in the engine. */
function patchAllCardsInView() {
  const ctx = makeCtx();
  document.querySelectorAll('#general-area .card').forEach(btn => {
    const cid = btn.dataset.cardId;
    const card = APP.cards[cid];
    if (!card) return;
    const nameEl = btn.querySelector('.card-name-text');
    if (nameEl) nameEl.textContent = resolveCardName(card, ctx);
    refreshCardLockState(btn, card, ctx);
  });
  document.querySelectorAll('#general-area .card-stat-text, #general-area .card-reveal-text').forEach(el => {
    const cid = el.dataset.cardId;
    const card = APP.cards[cid];
    if (card) el.textContent = resolveCardName(card, ctx);
  });
}

/* ----------------------------------------------------------------
   INTERACTIONS
   ---------------------------------------------------------------- */
function onCardClick(cid) {
  const ctx = makeCtx();
  const card = APP.cards[cid];
  if (!card) return;
  if (isCardLocked(card, ctx)) return; // silent no-op, exactly like real locked clicks

  const btn = document.querySelector(`#general-area .card[data-card-id="${cid}"]`);
  if (btn) {
    btn.classList.remove('card--flash');
    void btn.offsetWidth;
    btn.classList.add('card--flash');
  }

  applyGenericReward(card);

  const mech = APP.mechanics[card.mechanic];
  if (mech && typeof mech.onCardClick === 'function') mech.onCardClick(cid, ctx);

  recomputePlayerLevel(ctx);
  renderGeneralArea();   // visibility/lock/name can all change after a click
  renderSidebar();
  renderProgressLogo();
  renderBackground();
}

function applyGenericReward(card) {
  const rw = card.reward;
  if (!rw) return;
  if (rw.type === 'add') {
    addResource(rw.resource, rw.amount);
    patchResourceDOM(rw.resource);
  } else if (rw.type === 'togglePerSec') {
    const r = getResource(rw.resource);
    r.perSec = r.perSec > 0 ? 0 : rw.amount;
    patchResourceDOM(rw.resource);
  }
}

function recomputePlayerLevel(ctx) {
  let best = state.playerLevel;
  Object.values(APP.mechanics).forEach(mech => {
    if (typeof mech.computeNaturalLevel === 'function') {
      const natural = mech.computeNaturalLevel(ctx);
      if (typeof natural === 'number') best = Math.max(best, natural);
    }
  });
  state.playerLevel = best;
  const disp = document.getElementById('level-display');
  if (disp) disp.textContent = fmtLevel(state.playerLevel);
}

/* ---- Tooltip ---- */
function showTooltip(cardEl, card, ctx) {
  const tip = document.getElementById('tooltip');
  const lines = resolveCardTooltip(card, ctx).filter(Boolean);
  tip.innerHTML = lines.map((line, i) => `<div class="tt-section tt-${i + 1}">${line}</div>`).join('');

  tip.style.width = '';
  tip.style.visibility = 'hidden';
  tip.classList.remove('hidden');

  const cardRect = cardEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const headerHeight = document.getElementById('top-header').getBoundingClientRect().bottom;

  // Prefer above the card; fall back to below if there isn't enough room
  const spaceAbove = cardRect.top - headerHeight;
  const spaceBelow = window.innerHeight - cardRect.bottom;
  let top;
  if (spaceAbove >= tipRect.height + 8 || spaceAbove >= spaceBelow) {
    // Place fully above
    top = cardRect.top - tipRect.height - 8;
    if (top < headerHeight + 4) top = headerHeight + 4;
  } else {
    // Place fully below
    top = cardRect.bottom + 8;
  }
  // Center tooltip horizontally over the card
  const cardMidX = cardRect.left + cardRect.width / 2;
  let left = cardMidX - tipRect.width / 2;
  if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
  if (left < 4) left = 4;

  // #tooltip sits inside the desktop-zoomed body (zoom: 0.85 on desktop, see
  // index.html's @media (min-width: 761px) rule). All measurements above
  // (cardRect/tipRect/headerHeight) come from getBoundingClientRect(), which
  // already reports true/real on-screen pixels. But inline style px values
  // assigned to a descendant of a zoomed element get re-scaled by that same
  // zoom factor when rendered — so without correcting for it here, the
  // tooltip lands at (top/left * 0.85) instead of the intended real position.
  // Dividing by the zoom factor before assignment cancels that out.
  const desktopZoom = window.innerWidth > 760 ? 0.85 : 1;
  tip.style.top = `${top / desktopZoom}px`;
  tip.style.left = `${left / desktopZoom}px`;
  tip.style.visibility = 'visible';
}
function hideTooltip() { document.getElementById('tooltip').classList.add('hidden'); }

function fmtTimeToCap(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return m > 0 ? `${h}H ${m}M` : `${h}H`;
  if (m > 0) return s > 0 ? `${m}M ${s}S` : `${m}M`;
  return `${s}S`;
}
function showRateTip(e, resName) {
  const r = getResource(resName);
  if (r.cap === null || r.cap === undefined || r.perSec <= 0) return;
  const tip = document.getElementById('res-rate-tip');
  const remaining = r.cap - r.amount;
  tip.textContent = remaining <= 0 ? 'Full in 0S' : `Full in ${fmtTimeToCap(remaining / r.perSec)}`;
  positionRateTip(e);
  tip.style.display = 'block';
}
function positionRateTip(e) {
  const tip = document.getElementById('res-rate-tip');
  tip.style.left = `${e.clientX + 12}px`;
  tip.style.top = `${e.clientY - 28}px`;
}
function hideRateTip() { document.getElementById('res-rate-tip').style.display = 'none'; }

function toggleTierRevealed() {
  state.tierRevealed = !state.tierRevealed;
  renderHeader();
}

document.getElementById('progress-ring-btn').addEventListener('click', toggleTierRevealed);
document.getElementById('hide-reveal-tiers-btn').addEventListener('click', toggleTierRevealed);

document.getElementById('ascend-btn').addEventListener('click', () => {
  const t = currentTierConfig();
  const next = state.currentTier + 1;
  if (t.progress >= 100 && APP.tiers[next]) {
    document.getElementById('ascend-btn').classList.remove('ascend-ready');
    t.ascended = true;
    if (!state.unlockedTiers.includes(next)) state.unlockedTiers.push(next);
    state.currentTier = next;
    state.tierRevealed = true;
    fullRerenderTierScoped();
  }
});

function fullRerenderTierScoped() {
  const app = document.getElementById('app');
  app._lastIconTier = null;
  renderHeader();
  renderSidebar();
  renderGeneralArea();
}

/* ----------------------------------------------------------------
   CHEAT MENU
   ---------------------------------------------------------------- */
const cheatHeader = document.getElementById('cheat-header');
const cheatBody = document.getElementById('cheat-body');
cheatHeader.addEventListener('click', () => {
  const opening = cheatBody.classList.contains('hidden');
  cheatBody.classList.toggle('hidden');
  cheatHeader.textContent = (opening ? '▾' : '▸') + ' Cheat Menu';
});

const placeholderToggle = document.getElementById('toggle-placeholders');
placeholderToggle.addEventListener('click', () => {
  state.placeholdersEnabled = !state.placeholdersEnabled;
  placeholderToggle.classList.toggle('on', state.placeholdersEnabled);
  placeholderToggle.setAttribute('aria-pressed', String(state.placeholdersEnabled));
  renderSidebar();
  renderGeneralArea();
});

document.getElementById('unlock-all-tiers').addEventListener('click', () => {
  state.unlockedTiers = APP.config.tierIds.slice();
  state.tierRevealed = true;
  renderHeader();
});
document.getElementById('fill-tier-progress').addEventListener('click', () => {
  Object.keys(APP.tiers).forEach(id => setTierProgress(id, 100));
  renderProgressLogo();
});
document.getElementById('quarter-tier-progress').addEventListener('click', () => {
  setTierProgress(state.currentTier, (currentTierConfig().progress || 0) + 25);
  renderProgressLogo();
});

function fmtLevel(n) { return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1); }
function bumpLevel(delta) {
  state.playerLevel = Math.max(0, Math.round((state.playerLevel + delta) * 10) / 10);
  document.getElementById('level-display').textContent = fmtLevel(state.playerLevel);
  patchAllCardsInView();
  renderSidebar();
}
document.getElementById('level-up').addEventListener('click', () => bumpLevel(1));
document.getElementById('level-down').addEventListener('click', () => bumpLevel(-1));
document.getElementById('level-up-tenth').addEventListener('click', () => bumpLevel(0.1));
document.getElementById('level-down-tenth').addEventListener('click', () => bumpLevel(-0.1));

/* ----------------------------------------------------------------
   INTRO WINDOW
   ---------------------------------------------------------------- */
const INTRO_TEXT =
`Within damp ruins of a forgotten land. Something lost has been found. A lifetime of study and exploration has led you here. You have found it, at last.. Reaching out to grasp what you've yearned for.
 A single brush of a finger. An explosion. 

Broken, battered.. You awake as the Orb roles past your feet. Its power diminished, a flickering light within an immense void.`;

const introOverlay = document.getElementById('intro-overlay');
document.getElementById('intro-text').textContent = INTRO_TEXT;
document.getElementById('intro-continue-btn').addEventListener('click', () => {
  introOverlay.classList.add('hidden');
});

function maybeShowIntro(isNewGame) {
  if (isNewGame) introOverlay.classList.remove('hidden');
}

document.getElementById('cheat-encounter').addEventListener('click', () => {
  const ctx = makeCtx();
  Object.values(APP.mechanics).forEach(mech => {
    if (mech && typeof mech.getPendingEncounter === 'function') {
      const s = ctx.getMechState(mech.id);
      if (s) s.scavengeForceEncounter = true;
    }
  });
});

document.getElementById('cheat-scav').addEventListener('click', () => {
  const ctx = makeCtx();
  Object.values(APP.mechanics).forEach(mech => {
    if (mech && ctx.getMechState && ctx.getMechState(mech.id)) {
      const s = ctx.getMechState(mech.id);
      if ('scavengeQuickMode' in s) s.scavengeQuickMode = !s.scavengeQuickMode;
    }
  });
  const btn = document.getElementById('cheat-scav');
  const ctx2 = makeCtx();
  const s2 = ctx2.getMechState('scavenge');
  btn.classList.toggle('on', !!(s2 && s2.scavengeQuickMode));
});

document.getElementById('cheat-tier2-add').addEventListener('click', () => {
  const sel = document.getElementById('cheat-tier2-select').value;
  if (!sel) return;
  const [type, name] = sel.split(':');
  const ctx = makeCtx();
  if (type === 'creature') {
    ctx.addResource(name, 1);
    const s = ctx.getMechState('scavenge');
    if (s) { s.scavengedEver[name] = true; s.anyEverScavenged = true; }
  } else {
    ctx.addResource(name, 1);
    const s = ctx.getMechState('scavenge');
    if (s) s.resourcesEverGained[name] = true;
  }
  renderSidebar();
  patchAllCardsInView();
});
function renderMechanicCheatButtons() {
  const slot = document.getElementById('mechanic-cheat-slot');
  slot.innerHTML = '';
  Object.values(APP.mechanics).forEach(mech => {
    if (mech.config && mech.config.cheatButton && typeof mech.runCheatButton === 'function') {
      const row = document.createElement('div');
      row.className = 'cheat-row';
      const btn = document.createElement('button');
      btn.className = 'cheat-btn';
      btn.textContent = mech.config.cheatButton.label;
      btn.addEventListener('click', () => {
        mech.runCheatButton(makeCtx());
        recomputePlayerLevel(makeCtx());
        renderGeneralArea();
        renderSidebar();
        renderProgressLogo();
        renderBackground();
      });
      row.appendChild(btn);
      slot.appendChild(row);
    }
  });
}

/* ----------------------------------------------------------------
   CHRONICLE (generic; uses the current tier's own pool)
   ---------------------------------------------------------------- */
function maybeAddChronicleLine(sim = false) {
  state.ticksSinceChronicle++;
  const ticksPerSecond = Math.round(1000 / (APP.config.tickIntervalMs || 1000));
  if (state.ticksSinceChronicle < APP.config.chronicleCheckTicks * ticksPerSecond) return;
  state.ticksSinceChronicle = 0;
  if (Math.random() > APP.config.chronicleChance) return;

  const tier = state.currentTier;
  const pool = (APP.tiers[tier].chronicle && APP.tiers[tier].chronicle.pool) || [];
  if (!state.usedChronicleLines[tier]) state.usedChronicleLines[tier] = [];
  const used = new Set(state.usedChronicleLines[tier]);
  let candidates = pool.filter(line => !used.has(line));
  if (candidates.length === 0) { used.clear(); candidates = pool; }
  if (candidates.length === 0) return;

  const line = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(line);
  state.usedChronicleLines[tier] = [...used];
  state.chronicleLog.push({ tier, text: line });
  if (state.chronicleLog.length > APP.config.maxChronicleLog) {
    state.chronicleLog.splice(0, state.chronicleLog.length - APP.config.maxChronicleLog);
  }
  if (!sim && tier === state.currentTier) appendChronicleLine(line);
}

/* ----------------------------------------------------------------
   GAME TICK
   ---------------------------------------------------------------- */
let ticksSinceAutosave = 0;

function tick(sim = false) {
  maybeAddChronicleLine(sim);
  tickResources(sim);
  const ctx = makeCtx();
  let needsSidebarRebuild = false;
  Object.values(APP.mechanics).forEach(mech => {
    if (typeof mech.tick === 'function') {
      const result = mech.tick(ctx, sim);
      if (result === true) needsSidebarRebuild = true;
    }
  });
  if (!sim) {
    if (needsSidebarRebuild) {
      renderSidebar();
      renderGeneralArea();
      maybeShowPendingEncounter(); // show Encounter window if one was rolled
    } else {
      // Patch sidebar display for all mechanic-owned resources so passive
      // income (e.g. Inhale Slowly) updates Breath dots and Essence visually.
      const t = currentTierConfig();
      (t.mechanics || []).forEach(mechId => {
        const mech = APP.mechanics[mechId];
        if (!mech || !mech.ownedResourceNames) return;
        mech.ownedResourceNames.forEach(name => {
          patchResourceDOM(name);
        });
      });
    }
    recomputePlayerLevel(ctx);
    renderProgressLogo();
    patchAllCardsInView();
    ticksSinceAutosave++;
    if (ticksSinceAutosave >= APP.config.autosaveEveryTicks) {
      ticksSinceAutosave = 0;
      persistSave();
    }
  }
}

/* ================================================================
   SAVE / LOAD, OFFLINE PROGRESS & BOOST
   ================================================================ */
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

function serializeGame() {
  return {
    version: APP.config.saveVersion,
    savedAt: Date.now(),
    state: {
      currentTier: state.currentTier,
      unlockedTiers: state.unlockedTiers.slice(),
      tierRevealed: state.tierRevealed,
      placeholdersEnabled: state.placeholdersEnabled,
      headerMinimized: state.headerMinimized,
      playerLevel: state.playerLevel,
      chronicleLog: state.chronicleLog.slice(),
      usedChronicleLines: JSON.parse(JSON.stringify(state.usedChronicleLines)),
      ticksSinceChronicle: state.ticksSinceChronicle,
      resources: JSON.parse(JSON.stringify(state.resources)),
      boostSeconds: state.boostSeconds,
      mechanicState: JSON.parse(JSON.stringify(state.mechanicState))
    },
    tiers: Object.fromEntries(
      Object.entries(APP.tiers).map(([id, t]) => [id, { progress: t.progress, ascended: t.ascended }])
    )
  };
}

function applySaveData(data) {
  const s = data.state || {};
  state.currentTier = s.currentTier || 2;
  state.unlockedTiers = Array.isArray(s.unlockedTiers) && s.unlockedTiers.length ? s.unlockedTiers : [2];
  state.tierRevealed = !!s.tierRevealed;
  state.placeholdersEnabled = !!s.placeholdersEnabled;
  state.headerMinimized = !!s.headerMinimized;
  state.playerLevel = typeof s.playerLevel === 'number' ? s.playerLevel : 1;
  state.chronicleLog = Array.isArray(s.chronicleLog) ? s.chronicleLog : [];
  state.usedChronicleLines = s.usedChronicleLines || { 1: [], 2: [], 3: [], 4: [] };
  state.ticksSinceChronicle = s.ticksSinceChronicle || 0;
  state.resources = s.resources || {};
  state.boostSeconds = Math.min(APP.config.boostCapSeconds, s.boostSeconds || 0);
  state.mechanicState = s.mechanicState || {};

  if (data.tiers) {
    Object.entries(data.tiers).forEach(([id, t]) => {
      if (APP.tiers[id]) {
        APP.tiers[id].progress = typeof t.progress === 'number' ? t.progress : 0;
        APP.tiers[id].ascended = !!t.ascended;
      }
    });
  }

  // Let every mechanic backfill any fields missing from an older save.
  const ctx = makeCtx();
  Object.values(APP.mechanics).forEach(mech => {
    if (typeof mech.deserialize === 'function') mech.deserialize(ctx);
  });

  return data.savedAt || null;
}

let isResetting = false;
function persistSave() {
  if (isResetting) return;
  storage.set(APP.config.saveKey, JSON.stringify(serializeGame()));
}

function exportSaveString() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(serializeGame()))));
}
function parseSaveString(str) {
  const trimmed = (str || '').trim();
  if (!trimmed) throw new Error('Empty save text');
  const json = trimmed.startsWith('{') ? trimmed : decodeURIComponent(escape(atob(trimmed)));
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !data.state) throw new Error('Not a valid save');
  return data;
}

function applyOfflineProgress(elapsedSeconds) {
  const secs = Math.floor(Math.min(Math.max(0, elapsedSeconds), APP.config.offlineMaxSeconds));
  const ticksPerSecond = Math.round(1000 / (APP.config.tickIntervalMs || 1000));
  const totalTicks = secs * ticksPerSecond;
  for (let i = 0; i < totalTicks; i++) tick(true);
  return secs;
}
function grantBoost(elapsedSeconds) {
  const gained = (elapsedSeconds / 3600) * APP.config.boostPerHourSeconds;
  state.boostSeconds = Math.min(APP.config.boostCapSeconds, state.boostSeconds + gained);
}
function fmtBoost(seconds) {
  const s = Math.floor(seconds);
  return s <= 0 ? '' : fmtTimeToCap(s);
}
function renderBoost() {
  const el = document.getElementById('boost-display');
  if (el) el.textContent = fmtBoost(state.boostSeconds);
}

/* ---- Settings UI ---- */
const settingsGear = document.getElementById('settings-gear');
const settingsPanel = document.getElementById('settings-panel');
settingsGear.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle('open');
  resetHardResetButton();
});
document.addEventListener('click', (e) => {
  if (!settingsPanel.contains(e.target) && e.target !== settingsGear) {
    settingsPanel.classList.remove('open');
    resetHardResetButton();
  }
});

const minimizeHeaderBtn = document.getElementById('minimize-header-btn');
function applyHeaderMinimized() {
  document.getElementById('app').classList.toggle('header-minimized', state.headerMinimized);
  minimizeHeaderBtn.textContent = state.headerMinimized ? 'Restore Header' : 'Minimize Header';
}
minimizeHeaderBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  state.headerMinimized = !state.headerMinimized;
  applyHeaderMinimized();
  persistSave();
});

const hardResetBtn = document.getElementById('hard-reset-btn');
let hardResetStage = 0;
function resetHardResetButton() {
  hardResetStage = 0;
  hardResetBtn.textContent = 'Hard Reset';
  hardResetBtn.classList.remove('danger-1', 'danger-2');
}
hardResetBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  hardResetStage++;
  if (hardResetStage === 1) {
    hardResetBtn.textContent = 'Are you sure? (1/2)';
    hardResetBtn.classList.add('danger-1');
  } else if (hardResetStage === 2) {
    hardResetBtn.textContent = 'FINAL: erase everything (2/2)';
    hardResetBtn.classList.remove('danger-1');
    hardResetBtn.classList.add('danger-2');
  } else {
    hardResetGame();
  }
});

function hardResetGame() {
  isResetting = true;
  storage.del(APP.config.saveKey);

  state.currentTier = 2;
  state.unlockedTiers = [2];
  state.tierRevealed = true;
  state.placeholdersEnabled = false;
  state.headerMinimized = false;
  state.playerLevel = 1;
  const startTier = APP.tiers[state.currentTier];
  state.chronicleLog = startTier.chronicle && startTier.chronicle.intro
    ? [{ tier: state.currentTier, text: startTier.chronicle.intro }] : [];
  state.usedChronicleLines = { 1: [], 2: [], 3: [], 4: [] };
  state.ticksSinceChronicle = 0;
  state.resources = {};
  state.boostSeconds = 0;
  state.mechanicState = {};
  Object.values(APP.tiers).forEach(t => { t.progress = 0; t.ascended = false; });
  APP._neuroplasticityAnimated = false;
  APP._revealedCards = new Set();
  APP._expandedCards = new Set();
  APP._expandedSideRows = new Set();

  const ctx = makeCtx();
  Object.values(APP.mechanics).forEach(mech => {
    if (typeof mech.init === 'function') mech.init(ctx, true);
  });

  settingsPanel.classList.remove('open');
  resetHardResetButton();
  fullRerender();

  try { location.reload(); } catch (err) {}
  setTimeout(() => { isResetting = false; persistSave(); }, 1000);
}

const saveloadOverlay = document.getElementById('saveload-overlay');
const saveloadText = document.getElementById('saveload-text');
const saveloadStatus = document.getElementById('saveload-status');
function setSaveloadStatus(msg, isError = false) {
  saveloadStatus.textContent = msg;
  saveloadStatus.classList.toggle('error', isError);
}
document.getElementById('open-saveload').addEventListener('click', () => {
  settingsPanel.classList.remove('open');
  saveloadText.value = '';
  setSaveloadStatus('');
  saveloadOverlay.classList.add('open');
});
document.getElementById('close-saveload').addEventListener('click', () => {
  saveloadOverlay.classList.remove('open');
});
saveloadOverlay.addEventListener('click', (e) => { if (e.target === saveloadOverlay) saveloadOverlay.classList.remove('open'); });
document.getElementById('export-save').addEventListener('click', () => {
  saveloadText.value = exportSaveString();
  saveloadText.select();
  setSaveloadStatus('Save exported. Copy the text, or use Copy to Clipboard / Download File.');
});
document.getElementById('copy-save').addEventListener('click', () => {
  if (!saveloadText.value) saveloadText.value = exportSaveString();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(saveloadText.value)
      .then(() => setSaveloadStatus('Copied to clipboard.'))
      .catch(() => { saveloadText.select(); setSaveloadStatus('Auto-copy unavailable — text selected, press Ctrl/Cmd+C to copy.', true); });
  } else {
    saveloadText.select();
    try { document.execCommand('copy'); setSaveloadStatus('Copied to clipboard.'); }
    catch (err) { setSaveloadStatus('Auto-copy unavailable — text selected, press Ctrl/Cmd+C to copy.', true); }
  }
});
document.getElementById('download-save').addEventListener('click', () => {
  try {
    const blob = new Blob([exportSaveString()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orb-weaver-save.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSaveloadStatus('Save file downloaded.');
  } catch (err) {
    setSaveloadStatus('Download failed in this environment — use Export and copy the text instead.', true);
  }
});
document.getElementById('import-save').addEventListener('click', () => {
  try {
    const data = parseSaveString(saveloadText.value);
    applySaveData(data);
    persistSave();
    fullRerender();
    setSaveloadStatus('Save imported successfully.');
  } catch (err) {
    setSaveloadStatus('Import failed: ' + err.message, true);
  }
});

function fullRerender() {
  const app = document.getElementById('app');
  app._lastIconTier = null;
  renderHeader();
  renderSidebar();
  renderGeneralArea();
  renderBoost();
  document.getElementById('level-display').textContent = fmtLevel(state.playerLevel);
  const pt = document.getElementById('toggle-placeholders');
  pt.classList.toggle('on', state.placeholdersEnabled);
  pt.setAttribute('aria-pressed', String(state.placeholdersEnabled));
  applyHeaderMinimized();
}


/* ----------------------------------------------------------------
   CODEX
   ---------------------------------------------------------------- */
const codexOverlay = document.getElementById('codex-overlay');
const codexTopicList = document.getElementById('codex-topic-list');
const codexContentInner = document.getElementById('codex-content-inner');
let codexActiveId = null;

function openCodex() {
  codexTopicList.innerHTML = '';
  const topics = (APP.codex && APP.codex.topics) || [];
  topics.forEach(topic => {
    const btn = document.createElement('button');
    btn.className = 'codex-topic-btn' + (topic.id === codexActiveId ? ' active' : '');
    btn.textContent = topic.label;
    btn.addEventListener('click', () => selectCodexTopic(topic.id));
    codexTopicList.appendChild(btn);
  });
  if (!codexActiveId && topics.length > 0) selectCodexTopic(topics[0].id);
  else renderCodexContent();
  codexOverlay.classList.add('open');
}

function selectCodexTopic(id) {
  codexActiveId = id;
  codexTopicList.querySelectorAll('.codex-topic-btn').forEach(btn => {
    const topic = (APP.codex.topics || []).find(t => t.label === btn.textContent);
    btn.classList.toggle('active', topic && topic.id === id);
  });
  renderCodexContent();
}

function renderCodexContent() {
  const topics = (APP.codex && APP.codex.topics) || [];
  const topic = topics.find(t => t.id === codexActiveId);
  if (topic) {
    codexContentInner.classList.remove('empty');
    codexContentInner.innerHTML = topic.content;
  } else {
    codexContentInner.classList.add('empty');
    codexContentInner.innerHTML = 'Select a topic from the left.';
  }
}

document.getElementById('open-codex').addEventListener('click', () => {
  settingsPanel.classList.remove('open');
  openCodex();
});
document.getElementById('close-codex').addEventListener('click', () => {
  codexOverlay.classList.remove('open');
});
codexOverlay.addEventListener('click', (e) => {
  if (e.target === codexOverlay) codexOverlay.classList.remove('open');
});

/* ----------------------------------------------------------------
   ENCOUNTER WINDOW
   ---------------------------------------------------------------- */
const encounterOverlay  = document.getElementById('encounter-overlay');
const encounterDropdown = document.getElementById('encounter-pets-dropdown');
let _encounterSelectedPets = new Set(); // petKey → "name:index"
let _currentEncounter = null;

function openEncounterWindow(enc) {
  _encounterSelectedPets = new Set();
  _currentEncounter = enc;

  document.getElementById('encounter-title').textContent = enc.name;

  const statsEl = document.getElementById('encounter-stats');
  statsEl.innerHTML = '';
  const statPairs = [
    ['Attack', enc.attack], ['Magic Attack', enc.magicAttack],
    ['Defense', enc.defense], ['Magic Defense', enc.magicDefense]
  ];
  statPairs.forEach(([label, val]) => {
    if (val && val > 0) {
      const d = document.createElement('div');
      d.className = 'encounter-stat';
      d.textContent = `${label}: ${val}`;
      statsEl.appendChild(d);
    }
  });
  if (enc.type && enc.type !== 'Normal') {
    const d = document.createElement('div');
    d.className = 'encounter-stat encounter-type';
    d.textContent = `Type: ${enc.type}`;
    statsEl.appendChild(d);
  }

  encounterDropdown.classList.add('hidden');
  updateEncounterPetList();
  updateEncounterSelectedDisplay(); // clear any leftover selected-pets text from last fight
  updateEncounterFightButton();
  encounterOverlay.classList.add('open');
}

function getSelectedPetAttack() {
  const ctx = makeCtx();
  let total = 0;
  [..._encounterSelectedPets].forEach(key => {
    const name = key.split(':')[0];
    Object.values(APP.mechanics).forEach(mech => {
      if (mech && mech.config && mech.config.constants && mech.config.constants.creatureStats) {
        const stats = mech.config.constants.creatureStats[name];
        if (stats) total += stats.imbuePetAttack || 0;
      }
    });
  });
  return total;
}

function updateEncounterFightButton() {
  const fightBtn = document.getElementById('encounter-fight-btn');
  if (!_currentEncounter) return;
  const petAtk = getSelectedPetAttack();
  const encAtk = _currentEncounter.attack || 0;
  const damage = encAtk - petAtk;

  if (damage <= 0) {
    fightBtn.textContent = 'Fight';
    fightBtn.className = 'fight-win';
  } else {
    fightBtn.textContent = `Fight (-${damage}hp)`;
    fightBtn.className = 'fight-loss';
  }
}

function updateEncounterSelectedDisplay() {
  const el = document.getElementById('encounter-selected-pets');
  if (!_encounterSelectedPets.size) { el.textContent = ''; return; }

  // Count selected by name
  const counts = {};
  [..._encounterSelectedPets].forEach(key => {
    const name = key.split(':')[0];
    counts[name] = (counts[name] || 0) + 1;
  });

  // Build display with attack values from config
  const ctx = makeCtx();
  const parts = Object.entries(counts).map(([name, cnt]) => {
    let atk = 0;
    Object.values(APP.mechanics).forEach(mech => {
      if (mech && mech.config && mech.config.constants && mech.config.constants.creatureStats) {
        const stats = mech.config.constants.creatureStats[name];
        if (stats) atk = stats.imbuePetAttack || 0;
      }
    });
    return `${name} (${atk * cnt})`;
  });
  el.textContent = parts.join(', ');
}

function updateEncounterPetList() {
  const ctx    = makeCtx();
  const listEl = document.getElementById('encounter-pet-list');
  listEl.innerHTML = '';
  let anyPets = false;

  Object.values(APP.mechanics).forEach(mech => {
    if (!mech || typeof mech.getPetRows !== 'function') return;
    mech.getPetRows(ctx).forEach(pet => {
      for (let i = 0; i < pet.count; i++) {
        anyPets = true;
        const petKey = `${pet.name}:${i}`;
        const selected = _encounterSelectedPets.has(petKey);
        const btn = document.createElement('button');
        btn.className = 'encounter-pet-btn' + (selected ? ' selected' : '');
        btn.textContent = `${pet.name} (Atk ${pet.attack})`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (_encounterSelectedPets.has(petKey)) _encounterSelectedPets.delete(petKey);
          else _encounterSelectedPets.add(petKey);
          updateEncounterPetList();
          updateEncounterSelectedDisplay();
          updateEncounterFightButton();
        });
        listEl.appendChild(btn);
      }
    });
  });

  if (!anyPets) {
    listEl.innerHTML = '<div class="encounter-no-pets">No pets available.</div>';
  }
}

// Pets button: toggle dropdown
document.getElementById('encounter-pets-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  encounterDropdown.classList.toggle('hidden');
});

// Click anywhere outside the dropdown → close it
document.addEventListener('click', (e) => {
  if (!encounterDropdown.classList.contains('hidden')) {
    if (!encounterDropdown.contains(e.target) && e.target.id !== 'encounter-pets-btn') {
      encounterDropdown.classList.add('hidden');
    }
  }
});

document.getElementById('encounter-fight-btn').addEventListener('click', () => {
  const ctx = makeCtx();
  const selectedNames = [..._encounterSelectedPets].map(key => key.split(':')[0]);
  let totalDamage = 0;

  Object.values(APP.mechanics).forEach(mech => {
    if (mech && typeof mech.resolveEncounter === 'function') {
      totalDamage += mech.resolveEncounter(selectedNames, ctx) || 0;
    }
  });

  _currentEncounter = null;
  encounterOverlay.classList.remove('open');
  patchAllCardsInView();
  renderSidebar();

  if (totalDamage > 0) {
    const hpCard = document.querySelector('[data-card-id="hp-display"]');
    if (hpCard) {
      hpCard.classList.remove('hp-damage-flash');
      void hpCard.offsetWidth;
      hpCard.classList.add('hp-damage-flash');
      hpCard.addEventListener('animationend', () => hpCard.classList.remove('hp-damage-flash'), { once: true });
    }
  }
});

// Check for pending encounter when returning to tier 2
function maybeShowPendingEncounter() {
  if (state.currentTier !== 2) return;
  if (encounterOverlay.classList.contains('open')) return;
  const ctx = makeCtx();
  Object.values(APP.mechanics).forEach(mech => {
    if (mech && typeof mech.getPendingEncounter === 'function') {
      const enc = mech.getPendingEncounter(ctx);
      if (enc) openEncounterWindow(enc);
    }
  });
}

/* ----------------------------------------------------------------
   RESEARCH MODAL
   ---------------------------------------------------------------- */
const researchOverlay = document.getElementById('research-overlay');
let researchView = 'available'; // 'available' | 'completed'

function openResearchModal() {
  researchView = 'available';
  researchOverlay.classList.add('open');
  renderResearchGrid();
}

function renderResearchGrid() {
  const ctx  = makeCtx();
  const body = document.getElementById('research-body');
  body.innerHTML = '';

  // Sync nav active states
  const navMain      = document.getElementById('research-nav-main');
  const navCompleted = document.getElementById('research-nav-completed');
  if (navMain)      navMain.classList.toggle('np-nav-active',      researchView === 'available');
  if (navCompleted) navCompleted.classList.toggle('np-nav-active', researchView === 'completed');

  // Live HP, Age, and Buff in header
  const hpEl   = document.getElementById('research-hp');
  const ageEl  = document.getElementById('research-age');
  const buffEl = document.getElementById('research-buff');
  if (hpEl)  hpEl.textContent  = `HP ${Math.round(ctx.getResource('HP').amount)}`;
  if (ageEl) ageEl.textContent = `Age ${Math.round(ctx.getResource('Age').amount)}`;
  if (buffEl) {
    let buffText = '';
    Object.values(APP.mechanics).forEach(mech => {
      if (mech && typeof mech.getComputedSpecials === 'function') {
        const sp = mech.getComputedSpecials(ctx);
        if (sp.researchCostReduction > 0) buffText = `Buff: -${sp.researchCostReduction} to research cost`;
      }
    });
    buffEl.textContent = buffText;
  }

  const s = ctx.getMechState('scavenge') || {};

  if (researchView === 'available') {
    const grid = document.createElement('div');
    grid.className = 'research-card-grid';

    // Touch the Orb (always first, left)
    if (!s.touchTheOrbPurchased) {
      grid.appendChild(buildResearchCard('touch-the-orb', ctx));
    }

    // Peer into the Orb: always visible — locked (greyed) until Touch the Orb is done
    if (!s.peerIntoOrbPurchased) {
      grid.appendChild(buildResearchCard('peer-into-orb', ctx));
    }

    if (grid.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'augment-empty';
      empty.textContent = 'No new research available.';
      body.appendChild(empty);
      return;
    }

    body.appendChild(grid);

  } else {
    // Completed Research — newest first via completedResearchOrder
    const order = (s.completedResearchOrder || []);
    if (order.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'augment-empty';
      empty.textContent = 'No completed research yet.';
      body.appendChild(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'research-card-grid';
    order.forEach(id => grid.appendChild(buildResearchCard(id, ctx, true)));
    body.appendChild(grid);
  }
}

function buildResearchCard(researchId, ctx, isCompleted) {
  const card = APP.cards[researchId];
  if (!card) return document.createElement('div');

  const mech   = ctx.mechanics[card.mechanic];
  const locked = isCompleted ? false
    : (mech ? mech.evaluateRule(card.lock && card.lock.rule, null, card, ctx) : true);

  // Outer wrapper holds the card and the floating expand panel
  const wrapper = document.createElement('div');
  wrapper.className = 'research-card-wrap';

  const el = document.createElement('div');
  el.className = 'research-card' + (locked ? ' research-locked' : '') + (isCompleted ? ' research-completed' : '');
  el.dataset.researchId = researchId;

  const title = document.createElement('div');
  title.className = 'research-card-title';
  title.textContent = card.name;
  el.appendChild(title);

  // Bottom row: cost left, expand arrow right
  const bottom = document.createElement('div');
  bottom.className = 'research-card-bottom';

  const cost = document.createElement('div');
  cost.className = 'research-card-cost';
  // Show cost reduction from pets next to the HP cost
  let costText = card.cost || '';
  let costReductionNote = '';
  if (card.mechanic) {
    const mech = APP.mechanics[card.mechanic];
    if (mech && typeof mech.getComputedSpecials === 'function') {
      const sp = mech.getComputedSpecials(ctx);
      if (sp.researchCostReduction > 0) {
        costReductionNote = ` (-${sp.researchCostReduction})`;
      }
    }
  }
  cost.textContent = costText + (isCompleted ? '' : costReductionNote);
  bottom.appendChild(cost);

  const tooltip = (card.tooltip || []).filter(Boolean);
  if (tooltip.length > 0) {
    const arrow = document.createElement('div');
    arrow.className = 'research-expand-arrow';
    arrow.textContent = '\u203A';
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.classList.toggle('panel-open');
    });
    bottom.appendChild(arrow);
  }

  el.appendChild(bottom);
  wrapper.appendChild(el);

  // Floating panel: ~35% wider than the card, appears 2px below it
  if (tooltip.length > 0) {
    const panel = document.createElement('div');
    panel.className = 'research-expand-panel';
    panel.innerHTML = tooltip.map((line, i) => `<div class="tt-section tt-${i + 1}">${line}</div>`).join('');
    wrapper.appendChild(panel);
  }

  if (!locked && !isCompleted) {
    el.addEventListener('click', () => {
      const mech = APP.mechanics[card.mechanic];
      if (mech && typeof mech.onResearchClick === 'function') {
        const result = mech.onResearchClick(researchId, makeCtx());
        if (result) {
          renderResearchGrid(); // updates HP/Age text in header
          renderHeader();       // tier row may have changed (Tier 1 unlocked)

          // Flash the relevant header stat(s)
          const flashEl = (id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('flash');
            void el.offsetWidth;
            el.classList.add('flash');
            el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
          };
          if (result === 'hp' || result === 'hp_age') flashEl('research-hp');
          if (result === 'hp_age')                    flashEl('research-age');

          patchAllCardsInView();
          renderSidebar();
        }
      }
    });
  }

  return wrapper;
}

document.getElementById('close-research').addEventListener('click', () => {
  researchOverlay.classList.remove('open');
});
researchOverlay.addEventListener('click', (e) => {
  if (e.target === researchOverlay) researchOverlay.classList.remove('open');
});
document.getElementById('research-nav-main').addEventListener('click', () => {
  researchView = 'available';
  renderResearchGrid();
});
document.getElementById('research-nav-completed').addEventListener('click', () => {
  researchView = 'completed';
  renderResearchGrid();
});

/* ----------------------------------------------------------------
   CARD AUGMENT SLOTS
   ---------------------------------------------------------------- */
function cardHasAugmentSlots(cardId, ctx) {
  // Cards with augmentSlotsVisible in their JSON always show slots
  const card = APP.cards[cardId];
  if (card && card.augmentSlotsVisible) return true;
  // Other cards need their "augment-<cardId>" purchase
  const purchaseId = `augment-${cardId}`;
  const purchase = APP.augments[purchaseId];
  if (!purchase || !purchase.purchased) return false;
  return true;
}

function renderCardAugmentSlots(btn, card, ctx) {
  // Remove any existing slot container
  const existing = btn.querySelector('.card-augment-slots');
  if (existing) existing.remove();

  if (!cardHasAugmentSlots(card.id, ctx)) return;

  const mech = ctx.mechanics.breath;
  const slots = mech ? mech.getSlottedAugments(card.id, ctx) : [null, null, null];

  // Use card's augmentSlotsVisible if set, otherwise default to 1
  const visibleSlotCount = card.augmentSlotsVisible || 1;

  const container = document.createElement('div');
  container.className = 'card-augment-slots';

  for (let i = 0; i < visibleSlotCount; i++) {
    const slottedId = slots[i];
    const augment = slottedId ? APP.augments[slottedId] : null;
    const slot = document.createElement('div');
    slot.className = 'card-augment-slot' + (slottedId ? ' slot-filled' : ' slot-empty');
    slot.dataset.slotIndex = i;

    if (augment) {
      const abbr = document.createElement('span');
      abbr.className = 'slot-abbr';
      abbr.textContent = augment.abbreviation || '??';
      slot.appendChild(abbr);
      // Tooltip shows name + augment tooltip lines
      slot.addEventListener('mouseenter', (e) => {
        e.stopPropagation();
        const tooltipWithName = { ...augment, tooltip: [augment.name, ...(augment.tooltip || [])] };
        showAugmentTooltip(e, tooltipWithName);
      });
      slot.addEventListener('mouseleave', (e) => {
        e.stopPropagation();
        hideTooltip();
      });
    }

    slot.addEventListener('click', (e) => {
      e.stopPropagation(); // don't trigger card click
      hideTooltip();
      openCardAugmentWindow(card.id, i, ctx);
    });

    container.appendChild(slot);
  }

  btn.appendChild(container);
}

/* ----------------------------------------------------------------
   CARD AUGMENT WINDOW
   ---------------------------------------------------------------- */
const cardAugmentOverlay = document.getElementById('card-augment-overlay');
let cardAugmentTarget = { cardId: null, slotIndex: null };

function openCardAugmentWindow(cardId, slotIndex, ctx) {
  cardAugmentTarget = { cardId, slotIndex };
  const card = APP.cards[cardId];
  const title = document.getElementById('card-augment-title');
  title.textContent = `Augment ${card ? card.name : cardId}`;
  renderCardAugmentWindowBody(ctx);
  cardAugmentOverlay.classList.add('open');
}

function renderCardAugmentWindowBody(ctx) {
  const body = document.getElementById('card-augment-body');
  body.innerHTML = '';
  const { cardId, slotIndex } = cardAugmentTarget;
  const mech = ctx.mechanics.breath;
  const slots = mech ? mech.getSlottedAugments(cardId, ctx) : [null, null, null];
  const currentSlottedId = slots[slotIndex];

  // Find all slottable augments owned by the player that target this card
  const owned = Object.values(APP.augments).filter(a =>
    a.slottable && a.targetCard === cardId && a.purchased
  );

  if (owned.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'augment-empty';
    empty.textContent = 'No augments available for this card.';
    body.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'augment-grid';

  owned.forEach(augment => {
    const isSlotted = augment.id === currentSlottedId;
    const card = document.createElement('div');
    card.className = 'augment-card' + (isSlotted ? ' augment-active-slot' : '');
    card.dataset.augmentId = augment.id;

    const title = document.createElement('div');
    title.className = 'augment-title';
    title.textContent = augment.name;
    card.appendChild(title);

    const abbr = document.createElement('div');
    abbr.className = 'augment-slot-abbr-preview';
    abbr.textContent = augment.abbreviation || '??';
    card.appendChild(abbr);

    if (augment.tooltip && augment.tooltip.length > 0) {
      card.addEventListener('mouseenter', (e) => showAugmentTooltip(e, augment));
      card.addEventListener('mouseleave', hideTooltip);
    }

    card.addEventListener('click', () => {
      if (isSlotted) {
        mech.slotAugment(cardId, slotIndex, null, makeCtx());
      } else {
        mech.slotAugment(cardId, slotIndex, augment.id, makeCtx());
      }
      cardAugmentOverlay.classList.remove('open');
      hideTooltip();
      renderGeneralArea();
    });

    grid.appendChild(card);
  });

  body.appendChild(grid);
}

document.getElementById('close-card-augment').addEventListener('click', () => {
  cardAugmentOverlay.classList.remove('open');
  hideTooltip();
});
cardAugmentOverlay.addEventListener('click', (e) => {
  if (e.target === cardAugmentOverlay) {
    cardAugmentOverlay.classList.remove('open');
    hideTooltip();
  }
});

/* ----------------------------------------------------------------
   NEUROPLASTICITY MODAL
   ---------------------------------------------------------------- */
const neuroplasticityOverlay = document.getElementById('neuroplasticity-overlay');
let augmentView = 'available'; // 'available' | 'purchased'

function evalAugmentRule(ruleObj, augment, ctx) {
  if (!ruleObj) return true;
  switch (ruleObj.rule) {
    case 'always': return true;
    case 'never': return false;
    case 'augmentPurchased': {
      const s = ctx.getMechState('breath');
      return !!(s.purchasedAugments && s.purchasedAugments.includes(ruleObj.value));
    }
    default: {
      const mech = ctx.mechanics[augment.mechanic || 'breath'];
      if (mech && typeof mech.evaluateRule === 'function') {
        return mech.evaluateRule(ruleObj.rule, augment.cost, augment, ctx);
      }
      return true;
    }
  }
}

function isAugmentLocked(augment, ctx) { return evalAugmentRule(augment.lock, augment, ctx); }
function isAugmentVisible(augment, ctx) { return evalAugmentRule(augment.visibility, augment, ctx); }

function renderAugmentGrid() {
  const ctx = makeCtx();
  const body = document.getElementById('neuroplasticity-body');
  body.innerHTML = '';

  // Update Essence display in header
  const essenceEl = document.getElementById('neuroplasticity-essence');
  if (essenceEl) essenceEl.textContent = fmtRes(getResource('Essence').amount) + ' ✦';

  // Update active nav state
  document.getElementById('neuroplasticity-nav-main').classList.toggle('np-nav-active', augmentView === 'available');
  document.getElementById('neuroplasticity-nav-purchased').classList.toggle('np-nav-active', augmentView === 'purchased');

  const grid = document.createElement('div');
  grid.className = 'augment-grid';

  const augments = Object.values(APP.augments);

  if (augmentView === 'available') {
    const visible = augments.filter(a => !a.purchased && isAugmentVisible(a, ctx));
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'augment-empty';
      empty.textContent = 'No augments available.';
      body.appendChild(empty);
      return;
    }
    // Group by row field (undefined/0 = row 0, 1 = row 1, etc.)
    const rows = {};
    visible.forEach(augment => {
      const r = augment.row !== undefined ? augment.row : 0;
      if (!rows[r]) rows[r] = [];
      rows[r].push(augment);
    });
    Object.keys(rows).sort((a, b) => Number(a) - Number(b)).forEach(r => {
      const rowEl = document.createElement('div');
      rowEl.className = 'augment-grid';
      rows[r].forEach(augment => rowEl.appendChild(buildAugmentCard(augment, ctx, false)));
      body.appendChild(rowEl);
    });
  } else {
    const purchased = augments.filter(a => a.purchased);
    if (purchased.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'augment-empty';
      empty.textContent = 'No augments purchased yet.';
      body.appendChild(empty);
      return;
    }
    purchased.forEach(augment => {
      grid.appendChild(buildAugmentCard(augment, ctx, true));
    });
    body.appendChild(grid);
  }
}

function buildAugmentCard(augment, ctx, isPurchased) {
  const locked = !isPurchased && isAugmentLocked(augment, ctx);
  const card = document.createElement('div');
  card.className = 'augment-card' +
    (locked ? ' augment-locked' : '') +
    (isPurchased ? ' augment-purchased' : '');
  card.dataset.augmentId = augment.id;

  const title = document.createElement('div');
  title.className = 'augment-title';
  title.textContent = augment.name;
  card.appendChild(title);

  const cost = document.createElement('div');
  cost.className = 'augment-cost';
  cost.textContent = augment.cost + ' ✦';
  card.appendChild(cost);

  // Tooltip
  if (augment.tooltip && augment.tooltip.length > 0) {
    card.addEventListener('mouseenter', (e) => showAugmentTooltip(e, augment));
    card.addEventListener('mouseleave', hideTooltip);
  }

  if (!locked && !isPurchased) {
    card.addEventListener('click', () => {
      const mech = APP.mechanics.breath;
      if (mech && typeof mech.onAugmentClick === 'function') {
        mech.onAugmentClick(augment.id, makeCtx());
        renderAugmentGrid();
        renderGeneralArea(); // show augment slots on cards immediately
        patchResourceDOM('Essence');
      }
    });
  }

  return card;
}

function showAugmentTooltip(e, augment) {
  const tip = document.getElementById('tooltip');
  const lines = (augment.tooltip || []).filter(Boolean);
  tip.innerHTML = lines.map((line, i) => `<div class="tt-section tt-${i + 1}">${line}</div>`).join('');
  tip.style.width = '';
  tip.style.visibility = 'hidden';
  tip.classList.remove('hidden');
  const tipRect = tip.getBoundingClientRect();
  const desktopZoom = window.innerWidth > 760 ? 0.85 : 1;
  tip.style.top = `${(e.clientY - tipRect.height - 8) / desktopZoom}px`;
  tip.style.left = `${(e.clientX - tipRect.width / 2) / desktopZoom}px`;
  tip.style.visibility = 'visible';
}

function openNeuroplasticityModal(card) {
  augmentView = 'available';
  neuroplasticityOverlay.classList.add('open');
  renderAugmentGrid();
}

document.getElementById('close-neuroplasticity').addEventListener('click', () => {
  neuroplasticityOverlay.classList.remove('open');
  hideTooltip();
});
neuroplasticityOverlay.addEventListener('click', (e) => {
  if (e.target === neuroplasticityOverlay) {
    neuroplasticityOverlay.classList.remove('open');
    hideTooltip();
  }
});
document.getElementById('neuroplasticity-nav-main').addEventListener('click', () => {
  augmentView = 'available';
  renderAugmentGrid();
});
document.getElementById('neuroplasticity-nav-purchased').addEventListener('click', () => {
  augmentView = 'purchased';
  renderAugmentGrid();
});

window.addEventListener('beforeunload', persistSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistSave(); });

/* ----------------------------------------------------------------
   INIT
   ---------------------------------------------------------------- */
async function init() {
  await loadAllData();

  // Give every mechanic a chance to seed its default state before any
  // save is applied on top of it.
  const ctx0 = makeCtx();
  Object.values(APP.mechanics).forEach(mech => {
    if (typeof mech.init === 'function') mech.init(ctx0, false);
  });

  const raw = storage.get(APP.config.saveKey);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      const savedAt = applySaveData(data);
      if (savedAt) {
        const elapsed = (Date.now() - savedAt) / 1000;
        if (elapsed > 2) {
          applyOfflineProgress(elapsed);
          grantBoost(elapsed);
        }
      }
    } catch (err) {
      console.error('Save load failed:', err);
    }
  }

  const isNewGame = !raw;

  if (state.chronicleLog.length === 0) {
    const startTier = APP.tiers[state.currentTier];
    if (startTier.chronicle && startTier.chronicle.intro) {
      state.chronicleLog.push({ tier: state.currentTier, text: startTier.chronicle.intro });
    }
  }

  renderMechanicCheatButtons();
  fullRerender();
  persistSave();
  setInterval(tick, APP.config.tickIntervalMs);
  maybeShowIntro(isNewGame);
}

init().catch(err => {
  console.error(err);
  const area = document.getElementById('general-area');
  if (area) area.innerHTML = `<div class="empty-state">Failed to load game data: ${err.message}<br>Make sure you opened this with Live Server (not by double-clicking the HTML file).</div>`;
});
