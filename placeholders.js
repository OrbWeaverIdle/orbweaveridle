/* ============================================================
   ORB WEAVER — PLACEHOLDER EXAMPLES
   Everything in this file is throwaway scaffolding: it demonstrates
   the shell's patterns (resource rows, card variants, a themed
   section) so a developer can see them working, but none of it is
   real game content. Delete this file (and its <script> tag in
   index.html) once real mechanics replace these examples — nothing
   else in the project depends on it.

   Every element this file creates carries the `.placeholder-marker`
   class (dashed outline) so it's visually obvious what's a demo.
   ============================================================ */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  let injected = false;

  function buildResourceRow(name, value, rate) {
    const row = document.createElement('div');
    row.className = 'resource-row placeholder-marker';
    row.innerHTML = `
      <span class="res-name">${name}</span>
      <span class="res-val">${value}</span>
    `;
    if (rate) {
      const rateEl = document.createElement('span');
      rateEl.className = 'res-rate';
      rateEl.textContent = rate;
      row.appendChild(rateEl);
    }
    return row;
  }

  function buildCard({ name, stat, withSteppers, theme }) {
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap placeholder-marker';
    if (theme) {
      wrap.style.setProperty('--tier', theme.tier);
      wrap.style.setProperty('--tier-2', theme.tier2);
      wrap.style.setProperty('--tier-soft', theme.tierSoft);
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.cardName = name;
    card.dataset.cardDesc =
      '<div class="detail-card">' +
      `<div class="detail-card-name">${name}</div>` +
      '<div class="detail-card-desc">This is placeholder example content demonstrating the card-detail modal pattern. Replace with real content once mechanics exist.</div>' +
      '</div>';

    const body = document.createElement('div');
    body.className = 'card-body';
    body.innerHTML = `
      <div class="card-name">${name}</div>
      <div class="card-stat">${stat}</div>
    `;
    card.appendChild(body);

    if (withSteppers) {
      const steppers = document.createElement('div');
      steppers.className = 'card-steppers visible';
      steppers.innerHTML = `
        <button class="card-stepper-btn" disabled>–</button>
        <span class="card-stepper-val">0</span>
        <button class="card-stepper-btn" disabled>+</button>
      `;
      card.appendChild(steppers);
    }

    const progressBar = document.createElement('div');
    progressBar.className = 'card-progress-bar';
    card.appendChild(progressBar);

    wrap.appendChild(card);
    return wrap;
  }

  // THEMES: color pairs reused across left-hand and right-hand demo sections.
  // (Yellow moved to the real Sand Dunes mechanic — no longer a placeholder.)
  const THEMES = {
    blue:   { tier: '#5a86b8', tier2: '#7fa8d4', tierSoft: 'rgba(90,134,184,0.16)'  },
    green:  { tier: '#6a9c6a', tier2: '#8fc48f', tierSoft: 'rgba(106,156,106,0.16)' }
  };

  // Builds a themed left-hand resource section: label + N rows, appended to parent.
  function buildResourceSection(parent, labelText, count, prefix, theme) {
    const wrap = document.createElement('div');
    wrap.className = 'placeholder-marker';
    if (theme) {
      wrap.style.setProperty('--tier', theme.tier);
      wrap.style.setProperty('--tier-2', theme.tier2);
      wrap.style.setProperty('--tier-soft', theme.tierSoft);
    }
    const label = document.createElement('div');
    label.className = 'side-label';
    label.textContent = labelText;
    wrap.appendChild(label);
    for (let i = 1; i <= count; i++) {
      wrap.appendChild(buildResourceRow(`${prefix} ${i}`, '0', i % 3 === 0 ? '+0/s' : null));
    }
    parent.appendChild(wrap);
  }

  // Builds a themed right-hand section: label + card-grid of N cards, appended to parent.
  function buildCardSection(parent, labelText, count, prefix, theme) {
    const section = document.createElement('div');
    section.className = 'placeholder-marker';
    if (theme) {
      section.style.setProperty('--tier', theme.tier);
      section.style.setProperty('--tier-2', theme.tier2);
      section.style.setProperty('--tier-soft', theme.tierSoft);
    }
    const label = document.createElement('div');
    label.className = 'section-label';
    label.innerHTML = `${labelText} <span class="section-collapse-arrow">▾</span>`;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (let i = 1; i <= count; i++) {
      grid.appendChild(buildCard({
        name: `Card ${prefix}${i}`,
        stat: 'Has steppers (inert)',
        withSteppers: true,
        theme
      }));
    }
    section.appendChild(label);
    section.appendChild(grid);
    parent.appendChild(section);
    if (window.OrbWeaver && window.OrbWeaver.setupSectionCollapse) {
      window.OrbWeaver.setupSectionCollapse(label);
    }
    return section;
  }

  function inject() {
    if (injected) return;

    // --- Left-hand: Resources (gold, base theme) + Mountains (blue) — 8 rows each ---
    const resourcesMount = el('left-hand-resources');
    if (resourcesMount) {
      buildResourceSection(resourcesMount, 'Resources', 8, 'Resource A', null);
      buildResourceSection(resourcesMount, 'Mountains', 8, 'Resource B', THEMES.blue);
    }

    // --- Right-hand: demo cards inside the real Camp grid (unchanged, gold) ---
    const campGrid = el('grid-camp');
    if (campGrid) {
      campGrid.appendChild(buildCard({ name: 'Card A', stat: 'Has steppers (inert)', withSteppers: true }));
      campGrid.appendChild(buildCard({ name: 'Card B', stat: 'No steppers', withSteppers: false }));
    }

    // --- Right-hand: three new themed sections, 8 cards each ---
    const mount = el('right-hand-placeholder-mount');
    if (mount) {
      buildCardSection(mount, 'Example Section B', 8, 'B', THEMES.blue);
      buildCardSection(mount, 'Example Section C', 8, 'C', THEMES.green);
    }

    injected = true;
  }

  function show() {
    if (!injected) { inject(); return; }
    document.querySelectorAll('.placeholder-marker').forEach(n => { n.style.display = ''; });
  }

  function hide() {
    document.querySelectorAll('.placeholder-marker').forEach(n => { n.style.display = 'none'; });
  }

  window.OrbWeaverPlaceholders = { show, hide };

  // Respect the toggle's default state (ON) on first load.
  document.addEventListener('DOMContentLoaded', () => {
    const visible = window.OrbWeaver && window.OrbWeaver.getPlaceholdersVisible
      ? window.OrbWeaver.getPlaceholdersVisible()
      : true;
    if (visible) inject();
  });

})();
