/* ================================================================
   BREATH MECHANIC
   ----------------------------------------------------------------
   Implements the Tier 1 Breath mechanic exactly as specified in
   BreathV3July9(1).json / Breath-Mechanic-Report.md. This module
   owns all Breath-specific state transitions, lock/visibility rules
   not covered by the engine's generic rule grammar, tooltip token
   interpolation, the Breath resource's custom sidebar widget, the
   background-color formula, and the "Breath" cheat button.

   All *names, tooltip text and numbers* referenced here come from
   data/mechanics/breath-config.json — this file only implements the
   *logic* that ties them together.
   ================================================================ */

(function () {
  function C(ctx) { return ctx.mechanics.breath.config.constants; }
  function CFG(ctx) { return ctx.mechanics.breath.config; }
  function bs(ctx) { return ctx.getMechState('breath'); }

  function defaultState(cfg) {
    return {
      inhaleClicks: 0,
      breathCycleArmed: true,      // starting at Breath=0 counts as "touched zero"
      bgCycleCount: 0,
      neurogenesisCount: 0,
      neurogenesisCap: cfg.constants.NEUROGENESIS_CAP_BASE,
      neuronsCycleArmed: false,
      neuronsCost: cfg.constants.NEURONS_BASE_COST,
      whisperCount: 0,
      formWordsCount: 0,
      formWordsCap: cfg.constants.FORMWORDS_CAP_BASE,
      callCount: 0,
      callCap: cfg.constants.CALL_CAP_BASE,
      neuronsClickCount: 0,
      purchasedAugments: [],
      subTickCount: 0,
      slottedAugments: {
        "inhale": [null, null, null],
        "exhale": [null, null, null],
        "neurogenesis": [null, null, null],
        "synaptogenesis": [null, null, null]
      },
      synapsesCount: 0,
      synapsesCap: 0,
      synapsesEverGained: false,
      formWords2Reached: false,     // internal helper (not a display latch)
      inhaleSince54: 0,
      formWords4EverReached: false, // permanent latch — title flip
      neuronsRevealed: false        // permanent latch — Neurons visibility
    };
  }

  function pct(n) { return `${Math.round(n * 1000) / 10}%`; } // 0.03 -> "3%"

  /* Formats a resource value for display, collapsing JS floating-point
     artifacts (e.g. 3 * 0.3 === 0.8999999999999999) to a clean 1-decimal
     value. toFixed(1) already rounds correctly — the bug was ever
     displaying the raw unformatted number, not a rounding defect. */
  function fmtEssenceValue(n) {
    return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  }

  /* ------------------------------------------------------------
     Core resource helpers (Breath / Essence)
     ------------------------------------------------------------ */
  function breathCap() { return 12; } // structural cap; mirrored in breath-config.json resourceDefaults
  function getBreath(ctx) { return ctx.getResource('Breath'); }
  function getEssence(ctx) { return ctx.getResource('Essence'); }

  /* ------------------------------------------------------------
     Level computation (cosmetic; monotonic via engine's max())
     ------------------------------------------------------------ */
  function computeNaturalLevel(ctx) {
    const s = bs(ctx);
    const cfg = CFG(ctx);
    let lvl = 0;
    cfg.levelThresholds.forEach(t => { if (s.inhaleClicks >= t.inhaleClicks) lvl = Math.max(lvl, t.level); });
    if (s.neurogenesisCount >= 4) lvl = Math.max(lvl, 5.1);
    if (s.formWordsCount >= 1) lvl = Math.max(lvl, 5.2);
    if (s.formWords4EverReached) lvl = Math.max(lvl, 5.3);
    if (s.neuronsRevealed) lvl = Math.max(lvl, 5.4);
    if (s.formWordsCount >= 10) lvl = Math.max(lvl, 5.5);
    return lvl;
  }

  /* ------------------------------------------------------------
     Shared internal actions (used by real clicks AND the cheat
     button, so both paths share identical lock behavior).
     ------------------------------------------------------------ */
  function canInhale(ctx) { return getBreath(ctx).amount < breathCap(); }
  function canExhale(ctx) { return getBreath(ctx).amount > 0; }

  function doInhale(ctx) {
    if (!canInhale(ctx)) return; // silent no-op, exactly like a real locked click
    const s = bs(ctx);
    const c = C(ctx);
    const breath = getBreath(ctx);
    const essence = getEssence(ctx);

    s.inhaleClicks += 1;
    breath.amount = Math.min(breathCap(), breath.amount + c.BREATH_INHALE_GAIN);
    essence.amount += c.BREATH_INHALE_GAIN * (1 + c.NEUROGENESIS_ESSENCE_PCT * s.neurogenesisCount);

    // Neurons arming: Breath reaching exactly the half-mark while primed by a
    // zero-touch and while Neurons is revealed.
    if (s.neuronsRevealed && s.breathCycleArmed && !s.neuronsCycleArmed && breath.amount === c.NEURONS_HALF_BREATH) {
      s.neuronsCycleArmed = true;
    }
    // Neurons sequence ruined: if Breath goes past the half-mark, disarm.
    if (s.neuronsCycleArmed && breath.amount > c.NEURONS_HALF_BREATH) {
      s.neuronsCycleArmed = false;
    }

    // Full-cycle completion (0 -> cap)
    if (breath.amount >= breathCap()) {
      s.bgCycleCount += 1;
      if (s.breathCycleArmed && ctx.state.playerLevel >= 5) {
        s.neurogenesisCount = Math.min(s.neurogenesisCap, s.neurogenesisCount + 1);
      }
      s.breathCycleArmed = false;
    }

    // Neurons reveal gate: 3 Inhale clicks after Form Words first hit 2
    if (s.formWords2Reached && !s.neuronsRevealed) {
      s.inhaleSince54 += 1;
      if (s.inhaleSince54 >= 3) s.neuronsRevealed = true;
    }

    // Synaptogenesis inhale hook: fire each slotted augment's effect
    // (augment cards to be designed later; hook is ready)
    const synaSlots = (s.slottedAugments && s.slottedAugments['synaptogenesis']) || [];
    synaSlots.forEach(slottedId => {
      if (!slottedId) return;
      // Future Synaptogenesis augment effects will be handled here by id
    });
  }

  function doExhale(ctx) {
    if (!canExhale(ctx)) return; // silent no-op
    const s = bs(ctx);
    const c = C(ctx);
    const breath = getBreath(ctx);
    const essence = getEssence(ctx);

    breath.amount = Math.max(0, breath.amount - c.BREATH_EXHALE_COST);
    essence.amount = Math.max(0, essence.amount - c.BREATH_EXHALE_COST);

    if (ctx.state.playerLevel >= 5.1) {
      s.whisperCount = Math.min(c.WHISPER_CAP, s.whisperCount + 1);
    }

    if (breath.amount <= 0) {
      s.breathCycleArmed = true;  // re-arm the main cycle
      s.neuronsCycleArmed = false; // reset Neurons sequence — must start from 0 again
    }
  }

  function touchZeroFromWhisperSpend(ctx) {
    // Whisper spend forces Breath to 0 — physically identical to an
    // Exhale reaching zero, so it re-arms the same way.
    bs(ctx).breathCycleArmed = true;
    bs(ctx).neuronsCycleArmed = false; // reset Neurons sequence — must start from 0 again
  }

  /* ------------------------------------------------------------
     Mechanic module (registered on window.Mechanics.breath)
     ------------------------------------------------------------ */
  const breath = {
    id: 'breath',
    configPath: 'data/mechanics/breath-config.json',
    ownedResourceNames: ['Breath', 'Essence'],

    init(ctx, isHardReset) {
      const existing = ctx.state.mechanicState.breath;
      if (!existing || isHardReset || Object.keys(existing).length === 0) {
        ctx.state.mechanicState.breath = defaultState(this.config);
      }
    },

    deserialize(ctx) {
      // Backfill any fields an older save might be missing.
      const fresh = defaultState(this.config);
      ctx.state.mechanicState.breath = Object.assign(fresh, ctx.state.mechanicState.breath || {});
    },

    tick(ctx, sim) {
      const s = bs(ctx);
      const c = C(ctx);
      s.subTickCount = (s.subTickCount || 0) + 1;

      const inhaleSlots = (s.slottedAugments && s.slottedAugments['inhale']) || [];

      // Inhale Slowly: 1 doInhale per second = every 5 ticks at 200ms
      if (inhaleSlots.includes('inhale-slowly') && s.subTickCount % 5 === 0) {
        doInhale(ctx);
      }
      // Inhale Quickly: 10 doInhale per second = 2 doInhale per tick at 200ms
      if (inhaleSlots.includes('inhale-quickly')) {
        doInhale(ctx);
        doInhale(ctx);
      }

      // Synapses passive Essence income: applied directly here since Essence
      // is mechanic-owned and not processed by tickResources().
      // Round to 1 decimal to avoid floating point drift (e.g. 0.8999...)
      if (s.synapsesCount > 0) {
        const essence = getEssence(ctx);
        const tickFraction = (ctx.config && ctx.config.tickIntervalMs ? ctx.config.tickIntervalMs : 200) / 1000;
        const gain = s.synapsesCount * c.SYNAPSES_ESSENCE_PER_SEC * tickFraction;
        essence.amount = Math.round((essence.amount + gain) * 100) / 100;
      }
      // Keep perSec field accurate for the sidebar display
      getEssence(ctx).perSec = s.synapsesCount * c.SYNAPSES_ESSENCE_PER_SEC;
    },

    ownsResource(name) { return name === 'Breath' || name === 'Essence'; },

    isResourceVisible(name, ctx) {
      if (name === 'Breath') return bs(ctx).inhaleClicks >= 1;
      if (name === 'Essence') return ctx.state.playerLevel >= this.config.essenceVisibleAtLevel;
      return true;
    },

    /* Custom sidebar row rendering. Breath gets the opacity-ramp +
       12-dot gauge (no numeric readout); Essence gets a custom label
       "Essence ✦" and fully owns its own patching so the number stays live. */
    renderResourceRow(name, row, ctx, isInitialBuild) {
      if (name === 'Essence') {
        if (!this.isResourceVisible(name, ctx)) { if (row) row.innerHTML = ''; return true; }
        if (isInitialBuild || !row.querySelector('[data-res-amount="Essence"]')) {
          row.innerHTML = `
            <div class="res-row-top">
              <span class="res-name">Essence ✦</span>
              <span class="res-amount" data-res-amount="Essence"></span>
              <span class="res-cap" data-res-cap="Essence"></span>
            </div>
            <div class="res-row-bottom">
              <span class="res-rate hidden-rate" data-res-rate="Essence">&nbsp;</span>
            </div>`;
        }
        const r = ctx.getResource('Essence');
        const amountEl = row.querySelector('[data-res-amount="Essence"]');
        const capEl = row.querySelector('[data-res-cap="Essence"]');
        const rateEl = row.querySelector('[data-res-rate="Essence"]');
        if (amountEl) {
          const atCap = r.cap !== null && r.cap !== undefined && r.amount >= r.cap;
          amountEl.textContent = fmtEssenceValue(r.amount);
          amountEl.classList.toggle('at-cap', atCap);
        }
        if (capEl) capEl.textContent = (r.cap !== null && r.cap !== undefined) ? `/${r.cap}` : '';
        if (rateEl) {
          if (r.perSec !== 0) {
            // Bug fix: r.perSec can be a raw float like 0.8999999999999999
            // (e.g. 3 * 0.3 in JS floating point) — must format, not display raw.
            rateEl.textContent = `${fmtEssenceValue(r.perSec)} /s`;
            rateEl.classList.remove('hidden-rate');
          } else {
            rateEl.innerHTML = '&nbsp;';
            rateEl.classList.add('hidden-rate');
          }
        }
        return true;
      }
      if (name !== 'Breath') return false;
      if (!this.isResourceVisible(name, ctx)) { if (row) row.innerHTML = ''; return true; }

      const s = bs(ctx);
      const dotCfg = this.config.breathDotConfig;
      const cap = breathCap();

      const rampStart = dotCfg.opacityRampStartClick;
      const rampEnd = dotCfg.opacityRampEndClick;
      const frac = Math.max(0, Math.min(1, (s.inhaleClicks - rampStart) / (rampEnd - rampStart)));
      const opacity = dotCfg.opacityMin + (dotCfg.opacityMax - dotCfg.opacityMin) * frac;

      const revealed = Math.max(0, Math.min(dotCfg.totalDots, s.inhaleClicks - (dotCfg.dotRevealStartClick - 1)));
      const breathAmount = getBreath(ctx).amount;
      const fullDots = Math.min(breathAmount, revealed);

      if (isInitialBuild || !row.querySelector('.breath-widget')) {
        row.innerHTML = `
          <div class="breath-widget">
            <div class="breath-label" data-breath-label>Breath</div>
            <div class="breath-dots" data-breath-dots></div>
          </div>`;
      }
      const labelEl = row.querySelector('[data-breath-label]');
      const dotsEl = row.querySelector('[data-breath-dots]');
      if (labelEl) labelEl.style.opacity = opacity;
      if (dotsEl) {
        dotsEl.innerHTML = '';
        for (let i = 0; i < cap; i++) {
          const dot = document.createElement('span');
          dot.className = 'breath-dot';
          if (i < revealed) {
            dot.classList.add('revealed');
            dot.classList.add(i < fullDots ? 'full' : 'dim');
          }
          dotsEl.appendChild(dot);
        }
      }
      return true;
    },

    /* ------------------------------------------------------------
       Rule delegation (visibility.rule / lock.rule not covered by
       the engine's generic grammar)
       ------------------------------------------------------------ */
    evaluateRule(rule, value, card, ctx) {
      const s = bs(ctx);
      const c = C(ctx);
      const breath = getBreath(ctx);
      const essence = getEssence(ctx);
      switch (rule) {
        case 'inhaleClicksAtLeast': return s.inhaleClicks >= value;
        case 'breathAtCap': return breath.amount >= breathCap();
        case 'breathAtZero': return breath.amount <= 0;
        case 'neuronsLocked': return !(s.neuronsCycleArmed && essence.amount >= Math.round(s.neuronsCost));
        case 'whisperEssenceLocked': return essence.amount < c.WHISPER_UNLOCK_COST_ESSENCE;
        case 'neuroplasticityRevealed': return s.neuronsClickCount >= 2;
        case 'neuronsEverClicked': return s.neuronsClickCount >= 1;
        case 'augmentAffordable': return essence.amount < (value || 0);
        case 'augmentPurchased': return !!(s.purchasedAugments && s.purchasedAugments.includes(value));
        case 'spendNeurogenesisActive': {
          const neuroSlots = (s.slottedAugments && s.slottedAugments['neurogenesis']) || [];
          return !neuroSlots.includes('spend-neurogenesis');
        }
        case 'neurogenesisSpendable': return s.neurogenesisCount < C(ctx).SYNAPSES_NEUROGENESIS_COST;
        case 'synapsesNotFull': return s.synapsesCount >= s.synapsesCap;
        case 'whisperNotFull': return s.whisperCount < c.WHISPER_CAP;
        case 'formWordsNotFull': return s.formWordsCount < s.formWordsCap;
        default: return true;
      }
    },

    getCardFillFraction(cardId, ctx) {
      const s = bs(ctx);
      if (cardId === 'neurogenesis') return s.neurogenesisCap > 0 ? s.neurogenesisCount / s.neurogenesisCap : 0;
      if (cardId === 'whisper') return s.whisperCount / C(ctx).WHISPER_CAP;
      if (cardId === 'formwords') return s.formWordsCap > 0 ? s.formWordsCount / s.formWordsCap : 0;
      if (cardId === 'call') return s.callCap > 0 ? s.callCount / s.callCap : 0;
      if (cardId === 'synapses') return s.synapsesCap > 0 ? s.synapsesCount / s.synapsesCap : 0;
      return 0;
    },

    resolveTooltipTokens(line, ctx) {
      const s = bs(ctx);
      const c = C(ctx);
      const tokens = {
        essencePct: pct(c.NEUROGENESIS_ESSENCE_PCT),
        neurogenesisCount: Math.round(s.neurogenesisCount),
        neurogenesisCap: Math.round(s.neurogenesisCap),
        neurogenesisTotalPct: pct(c.NEUROGENESIS_ESSENCE_PCT * s.neurogenesisCount),
        neuronsCost: Math.round(s.neuronsCost),
        neuronsCostGrowthPct: pct(c.NEURONS_COST_GROWTH),
        whisperCost: c.WHISPER_UNLOCK_COST_ESSENCE,
        whisperCap: c.WHISPER_CAP,
        formWordsCap: Math.round(s.formWordsCap),
        formWordsCapGrowthPct: pct(c.FORMWORDS_CAP_GROWTH),
        callCap: Math.round(s.callCap),
        synapsesCount: Math.round(s.synapsesCount),
        synapsesCap: Math.round(s.synapsesCap)
      };
      return line.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in tokens ? tokens[key] : match));
    },

    computeNaturalLevel(ctx) { return computeNaturalLevel(ctx); },

    /* ------------------------------------------------------------
       Augment click handling
       ------------------------------------------------------------ */
    onAugmentClick(augmentId, ctx) {
      const augment = (APP && APP.augments) ? APP.augments[augmentId] : null;
      if (!augment || augment.purchased) return;
      const essence = getEssence(ctx);
      if (essence.amount < augment.cost) return;
      essence.amount = Math.max(0, essence.amount - augment.cost);
      augment.purchased = true;
      const s = bs(ctx);
      s.purchasedAugments = [...(s.purchasedAugments || []), augmentId];
      // Initialize slottedAugments entry for the target card
      if (augment.targetCard && augment.slottable) {
        if (!s.slottedAugments) s.slottedAugments = {};
        if (!s.slottedAugments[augment.targetCard]) {
          s.slottedAugments[augment.targetCard] = [null, null, null];
        }
      }
      // Purchasing augment-neurogenesis initialises Synapses cap
      if (augmentId === 'augment-neurogenesis' && s.synapsesCap === 0) {
        s.synapsesCap = C(ctx).SYNAPSES_CAP_BASE;
      }
    },

    /* Slot an augment into a specific slot on a card.
       If the slot already has an augment, it is unslotted first.
       Passing augmentId=null removes whatever is in the slot. */
    slotAugment(cardId, slotIndex, augmentId, ctx) {
      const s = bs(ctx);
      if (!s.slottedAugments) s.slottedAugments = {};
      if (!s.slottedAugments[cardId]) s.slottedAugments[cardId] = [null, null, null];
      s.slottedAugments[cardId][slotIndex] = augmentId || null;
    },

    getSlottedAugments(cardId, ctx) {
      const s = bs(ctx);
      return (s.slottedAugments && s.slottedAugments[cardId]) || [null, null, null];
    },

    /* ------------------------------------------------------------
       Click handling
       ------------------------------------------------------------ */
    onCardClick(cardId, ctx) {
      const s = bs(ctx);
      const c = C(ctx);
      if (cardId === 'inhale') {
        doInhale(ctx);
      } else if (cardId === 'exhale') {
        doExhale(ctx);
      } else if (cardId === 'neurons') {
        if (!(s.neuronsCycleArmed && getEssence(ctx).amount >= Math.round(s.neuronsCost))) return;
        getEssence(ctx).amount = Math.max(0, getEssence(ctx).amount - Math.round(s.neuronsCost));
        s.neurogenesisCap += c.NEURONS_CAP_INCREASE;
        s.neuronsCost = s.neuronsCost * (1 + c.NEURONS_COST_GROWTH);
        s.neuronsClickCount += 1;
        getBreath(ctx).amount = 0;
        touchZeroFromWhisperSpend(ctx); // forces Breath to 0, re-arms breathCycleArmed, clears neuronsCycleArmed
      } else if (cardId === 'whisper') {
        if (!(s.whisperCount >= c.WHISPER_CAP && getEssence(ctx).amount >= c.WHISPER_UNLOCK_COST_ESSENCE)) return;
        getEssence(ctx).amount -= c.WHISPER_UNLOCK_COST_ESSENCE;
        getBreath(ctx).amount = 0;
        touchZeroFromWhisperSpend(ctx);
        s.whisperCount = 0;
        s.formWordsCount = Math.min(s.formWordsCap, s.formWordsCount + 1);
        if (s.formWordsCount >= 2) s.formWords2Reached = true;
        if (s.formWordsCount >= 4) s.formWords4EverReached = true;
      } else if (cardId === 'neurogenesis') {
        // Only clickable when spend-neurogenesis is slotted
        const neuroSlots = (s.slottedAugments && s.slottedAugments['neurogenesis']) || [];
        if (!neuroSlots.includes('spend-neurogenesis')) return;
        if (s.neurogenesisCount < c.SYNAPSES_NEUROGENESIS_COST) return;
        if (s.synapsesCount >= s.synapsesCap) return;
        s.neurogenesisCount -= c.SYNAPSES_NEUROGENESIS_COST;
        s.synapsesCount += 1;
        if (!s.synapsesEverGained) s.synapsesEverGained = true;
      } else if (cardId === 'formwords') {
        if (!(s.formWordsCount >= s.formWordsCap)) return;
        s.formWordsCount = 0;
        s.callCount = Math.min(s.callCap, s.callCount + 1);
        s.formWordsCap = Math.max(s.formWordsCap + 1, Math.floor(s.formWordsCap * (1 + c.FORMWORDS_CAP_GROWTH)));
      }
      // neurogenesis and call: passive display cards, no click behavior
    },

    /* ------------------------------------------------------------
       Background color
       ------------------------------------------------------------ */
    getBackgroundColor(ctx) {
      const s = bs(ctx);
      const bg = this.config.background;
      if (s.bgCycleCount >= C(ctx).BG_CYCLE_LOCK_COUNT) return bg.highColorHex;
      const frac = Math.max(0, Math.min(1, getBreath(ctx).amount / breathCap()));
      return lerpHex(bg.lowColorHex, bg.highColorHex, frac);
    },

    /* ------------------------------------------------------------
       Cheat button: fires the exact same internal doInhale/doExhale
       functions real clicks use, so locked attempts silently no-op
       exactly as they would from real play.
       ------------------------------------------------------------ */
    runCheatButton(ctx) {
      (this.config.cheatButton.sequence || []).forEach(step => {
        for (let i = 0; i < step.times; i++) {
          if (step.action === 'inhale') doInhale(ctx);
          else if (step.action === 'exhale') doExhale(ctx);
        }
      });
    }
  };

  function lerpHex(fromHex, toHex, t) {
    const a = hexToRgb(fromHex), b = hexToRgb(toHex);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  }
  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16)
    };
  }

  window.Mechanics = window.Mechanics || {};
  window.Mechanics.breath = breath;
})();
