/* ================================================================
   SCAVENGE MECHANIC (Tier 2)
   ================================================================ */

(function () {
  function C(ctx)  { return ctx.mechanics.scavenge.config.constants; }
  function bs(ctx) { return ctx.getMechState('scavenge'); }

  function getHP(ctx)  { return ctx.getResource('HP'); }
  function getAge(ctx) { return ctx.getResource('Age'); }

  /* ---- Chronicle ---- */
  function chroniclePost(text, ctx, color = null) {
    if (!text) return;
    ctx.state.chronicleLog = ctx.state.chronicleLog || [];
    const entry = { tier: ctx.state.currentTier, text };
    if (color) entry.color = color;
    ctx.state.chronicleLog.push(entry);
    if (typeof window !== 'undefined' && typeof appendChronicleLine === 'function') {
      appendChronicleLine(text, true, color);
    }
  }

  /* ---- Default state ---- */
  function defaultState() {
    return {
      pickupOrbClicked:         false,
      pickupOrbCardVisible:     false,
      scavengeClickCount:       0,
      scavengeCountdown:        0,
      scavengeCountdownTotal:   0,
      scavengeProgressBarColor: null,
      scavengeQuickMode:        false,   // cheat: all future scavenges in 0.25s until toggled
      scavengeForceEncounter:   false,   // cheat: next scavenge forces an Encounter roll
      scavengedEver:            {},
      anyEverScavenged:         false,
      resourcesEverGained:      {},
      firstCockroachEaten:      false,
      firstMouseEaten:          false,
      peerIntoOrbPurchased:     false,
      peerIntoOrbCompleted:     false,
      touchTheOrbPurchased:     false,
      touchTheOrbCompleted:     false,
      petCounts:                {},     // { [creatureName]: count }
      completedResearchOrder:   [],
      recentScavenged:          [],
      lastExtraResource:        null,   // last Part gained via x% Extra resource Special
      pendingEncounter:         null,   // { name, attack, magicAttack, defense, magicDefense, type } waiting to show
      foodZeroMinutes:          0,      // minutes player has been at 0 food with pets consuming
      roomLevel:                '1'
    };
  }

  /* ================================================================
     WEIGHTED RANDOM ROLL
     ================================================================ */
  function rarityWeightForLuck(baseWeight, rarity, luckPct, rarityOrder) {
    // Luck shifts weight away from Common toward rarer tiers proportionally.
    // Each 1% luck reduces Common weight by 0.4 and distributes to rarer tiers.
    if (rarity === 'C') {
      return Math.max(0, baseWeight - luckPct * 0.4);
    }
    const idx = rarityOrder.indexOf(rarity);
    if (idx <= 0) return baseWeight;
    return baseWeight + luckPct * 0.4 / (rarityOrder.length - 1);
  }

  function rollFromList(list, rarityWeights, rarityOrder, luckPct, currentRoomLevel) {
    const eligible = list.filter(e => e.roomLevel === currentRoomLevel || e.roomLevel == null);
    if (!eligible.length) return null;
    const weights = eligible.map(e => {
      const base = rarityWeights[e.rarity] || 0;
      return Math.max(0, rarityWeightForLuck(base, e.rarity, luckPct || 0, rarityOrder));
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (!total) return eligible[0];
    let r = Math.random() * total;
    for (let i = 0; i < eligible.length; i++) {
      r -= weights[i];
      if (r <= 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
  }

  /* ================================================================
     PET SPECIALS — computed totals from current petCounts
     ================================================================ */
  function computeSpecials(ctx) {
    const c = C(ctx);
    const s = bs(ctx);
    const counts = s.petCounts || {};
    let scavengeTimeReduction = 0;
    let foodPerSec = 0;
    let scavengeLuck = 0;
    let extraResourcePct = 0;
    let researchCostReduction = 0;
    let totalFoodConsumed = 0;

    Object.entries(counts).forEach(([name, count]) => {
      if (!count) return;
      const stats = (c.creatureStats || {})[name];
      if (!stats) return;
      totalFoodConsumed += (stats.foodConsumed || 0) * count;
      if (stats.specialType === 'scavengeTime')   scavengeTimeReduction += Math.abs(stats.specialValue) * count;
      if (stats.specialType === 'foodPerSec')     foodPerSec            += stats.specialValue * count;
      if (stats.specialType === 'scavengeLuck')   scavengeLuck          += stats.specialValue * count;
      if (stats.specialType === 'extraResource')  extraResourcePct      += stats.specialValue * count;
      if (stats.specialType === 'researchCost')   researchCostReduction += Math.abs(stats.specialValue) * count;
    });

    return { scavengeTimeReduction, foodPerSec, totalFoodConsumed, scavengeLuck, extraResourcePct, researchCostReduction };
  }

  /* ================================================================
     SCAVENGE CORE
     ================================================================ */
  function pushRecentScavenged(name, ctx) {
    const s = bs(ctx);
    if (!Array.isArray(s.recentScavenged)) s.recentScavenged = [];
    s.recentScavenged.unshift(name);
    if (s.recentScavenged.length > 3) s.recentScavenged.length = 3;
  }

  function startScavenge(ctx) {
    const s  = bs(ctx);
    const c  = C(ctx);
    if (s.scavengeCountdown > 0) return;

    const idx    = s.scavengeClickCount;
    const clicks = c.scavengeStartingClicks || [];
    const entry  = idx < clicks.length ? clicks[idx] : null;

    let duration = entry ? entry.durationSeconds : c.SCAVENGE_STANDARD_SECONDS;
    const barColor = entry ? entry.progressBarColor : null;

    // Cheat: quick mode (only for standard scavenges — starting clicks unaffected by Q16)
    if (!entry && s.scavengeQuickMode) duration = 0.25;

    // Standard scavenge: apply pet scavengeTime reduction
    if (!entry) {
      const specials = computeSpecials(ctx);
      duration = Math.max(1, duration - specials.scavengeTimeReduction);
    }

    if (entry && entry.chronicleOnClick) chroniclePost(entry.chronicleOnClick, ctx);

    s.scavengeClickCount      += 1;
    s.scavengeCountdown        = duration;
    s.scavengeCountdownTotal   = duration;
    s.scavengeProgressBarColor = barColor;
  }

  function resolveScavenge(ctx) {
    const s = bs(ctx);
    const c = C(ctx);
    s.scavengeProgressBarColor = null;
    s.lastExtraResource = null; // clear each resolve; only set again if extra resource fires

    const idx    = s.scavengeClickCount - 1;
    const clicks = c.scavengeStartingClicks || [];
    const entry  = idx < clicks.length ? clicks[idx] : null;

    if (entry) {
      // Starting click — guaranteed reward, no Encounter possible
      const r = entry.reward;
      if (r.type === 'creature') {
        ctx.addResource(r.name, 1);
        s.scavengedEver[r.name] = true;
        s.anyEverScavenged = true;
        pushRecentScavenged(r.name, ctx);
      } else if (r.type === 'resource') {
        ctx.addResource(r.name, r.amount || 1);
        s.resourcesEverGained[r.name] = true;
        pushRecentScavenged(r.name, ctx);
      }
      return;
    }

    // Standard scavenge — weighted roll from monsterList1
    const forceEncounter = s.scavengeForceEncounter;
    s.scavengeForceEncounter = false; // consume the flag

    let rolled;
    if (forceEncounter) {
      rolled = { type: 'encounter' };
    } else {
      const specials = computeSpecials(ctx);
      rolled = rollFromList(
        c.monsterList1,
        c.rarityWeights,
        c.rarityOrder,
        specials.scavengeLuck,
        s.roomLevel || '1'
      );
    }

    if (!rolled) return;

    if (rolled.type === 'encounter') {
      // Roll an Encounter from encounterList1
      const enc = rollFromList(c.encounterList1, c.rarityWeights, c.rarityOrder, 0, s.roomLevel || '1');
      if (enc) s.pendingEncounter = { ...enc };
      // No recentScavenged entry for Encounters
      return;
    }

    if (rolled.type === 'creature') {
      ctx.addResource(rolled.name, 1);
      s.scavengedEver[rolled.name] = true;
      s.anyEverScavenged = true;
      pushRecentScavenged(rolled.name, ctx);

      // Extra resource (Spider special) — grant a random Part1 or Part2 from any creature
      const specials = computeSpecials(ctx);
      if (specials.extraResourcePct > 0 && Math.random() * 100 < specials.extraResourcePct) {
        grantRandomPart(ctx);
      }
    } else if (rolled.type === 'resource') {
      // Resource roll (Wood/Stone) — grant 1 of that resource
      ctx.addResource(rolled.name, 1);
      s.resourcesEverGained[rolled.name] = true;
      pushRecentScavenged(rolled.name, ctx);
    }
  }

  function grantRandomPart(ctx) {
    const c = C(ctx);
    const s = bs(ctx);
    const allParts = [];
    Object.values(c.creatureStats || {}).forEach(stats => {
      if (stats.part1) allParts.push(stats.part1);
      if (stats.part2) allParts.push(stats.part2);
    });
    if (!allParts.length) return;
    const pick = allParts[Math.floor(Math.random() * allParts.length)];
    ctx.addResource(pick, 1);
    s.resourcesEverGained[pick] = true;
    s.lastExtraResource = pick;
  }

  /* ================================================================
     EAT / DRAIN / IMBUE
     ================================================================ */
  function doEat(creatureName, ctx) {
    const s     = bs(ctx);
    const c     = C(ctx);
    const amt   = ctx.getResource(creatureName).amount;
    if (amt < 1) return false;
    const stats = (c.creatureStats || {})[creatureName];
    if (!stats) return false;

    ctx.addResource(creatureName, -1);
    ctx.addResource('HP', stats.eatHP);

    // Starting-click creatures (Mouse click 0, Cockroach click 1) — HP only, no Food/Parts
    const isStartingCreature = (
      (creatureName === 'Mouse'     && !s.firstMouseEaten) ||
      (creatureName === 'Cockroach' && !s.firstCockroachEaten)
    );

    if (!isStartingCreature) {
      // Grant Food
      if (stats.foodGiven) {
        ctx.addResource('Food', stats.foodGiven);
        s.resourcesEverGained['Food'] = true;
      }
      // Grant Part 1 (65%) or Part 2 (35%)
      const part = (Math.random() < 0.65) ? stats.part1 : stats.part2;
      if (part) {
        ctx.addResource(part, 1);
        s.resourcesEverGained[part] = true;
      }
    }

    // First-ever Mouse eat
    if (creatureName === 'Mouse' && !s.firstMouseEaten) {
      s.firstMouseEaten = true;
      chroniclePost(c.firstMouseEatChronicle, ctx);
    }

    // First-ever Cockroach eat — reveals Pickup Orb
    if (creatureName === 'Cockroach' && !s.firstCockroachEaten) {
      s.firstCockroachEaten   = true;
      s.pickupOrbCardVisible  = true;
      chroniclePost(c.firstCockroachEatChronicle, ctx);
    }

    return true;
  }

  function doDrain(creatureName, ctx) {
    const c   = C(ctx);
    const amt = ctx.getResource(creatureName).amount;
    if (amt < 1) return false;
    const stats = (c.creatureStats || {})[creatureName];
    if (!stats) return false;
    ctx.addResource(creatureName, -1);
    ctx.addResource('Essence', stats.drainEssence);
    return true;
  }

  function doImbue(creatureName, ctx) {
    const c     = C(ctx);
    const s     = bs(ctx);
    const amt   = ctx.getResource(creatureName).amount;
    if (amt < 1) return false;
    const stats = (c.creatureStats || {})[creatureName];
    if (!stats) return false;

    // Check pet cap
    const totalPets = Object.values(s.petCounts || {}).reduce((a, b) => a + b, 0);
    if (totalPets >= c.PET_CAP) return false;

    // Check Essence cost
    if (stats.essenceCost > 0) {
      const essence = ctx.getResource('Essence');
      if (essence.amount < stats.essenceCost) return false;
      ctx.addResource('Essence', -stats.essenceCost);
    }

    ctx.addResource(creatureName, -1);
    if (!s.petCounts) s.petCounts = {};
    s.petCounts[creatureName] = (s.petCounts[creatureName] || 0) + 1;

    // First-ever Imbue reveals the Food resource row in the sidebar
    if (!s.resourcesEverGained['Food']) {
      s.resourcesEverGained['Food'] = true;
    }

    return true;
  }

  /* ================================================================
     FOOD & STARVATION TICK
     ================================================================ */
  function tickFood(ctx, sim) {
    const s = bs(ctx);
    const c = C(ctx);
    const specials = computeSpecials(ctx);
    const net = specials.foodPerSec - specials.totalFoodConsumed;
    const food = ctx.getResource('Food');

    // Apply net food change each tick
    const tickFrac = (ctx.config.tickIntervalMs || 1000) / 1000;
    const delta = net * tickFrac;
    const newFood = Math.max(0, food.amount + delta);
    ctx.setResource('Food', { amount: newFood, cap: null });

    if (s.resourcesEverGained) s.resourcesEverGained['Food'] = s.resourcesEverGained['Food'] || (newFood > 0);

    // Starvation: if food is 0 and pets are consuming, track minutes
    if (newFood <= 0 && specials.totalFoodConsumed > 0) {
      const prevMinutes = s.foodZeroMinutes || 0;
      s.foodZeroMinutes = prevMinutes + tickFrac / 60;

      // Chronicle warning once per minute at 0 food
      if (Math.floor(s.foodZeroMinutes) > Math.floor(prevMinutes)) {
        if (!sim) chroniclePost('Your pets are starving', ctx, '#c05050');

        // Remove one random pet
        const petNames = [];
        Object.entries(s.petCounts || {}).forEach(([name, cnt]) => {
          for (let i = 0; i < cnt; i++) petNames.push(name);
        });
        if (petNames.length > 0) {
          const victim = petNames[Math.floor(Math.random() * petNames.length)];
          s.petCounts[victim] = Math.max(0, (s.petCounts[victim] || 1) - 1);
          if (!sim) chroniclePost(`${victim} died`, ctx, '#c05050');
        }
      }
    } else {
      s.foodZeroMinutes = 0;
    }
  }

  /* ================================================================
     MECHANIC MODULE
     ================================================================ */
  const scavenge = {
    id: 'scavenge',
    configPath: 'data/mechanics/scavenge-config.json',

    ownedResourceNames: [
      'Mouse','Cockroach','Bat','Spider','Fungus','Snake','Fire Ant'
    ],

    init(ctx, isHardReset) {
      const existing = ctx.state.mechanicState.scavenge;
      if (!existing || isHardReset || Object.keys(existing).length === 0) {
        ctx.state.mechanicState.scavenge = defaultState();
        const c = this.config.constants;
        ctx.setResource('HP',  { amount: c.STARTING_HP,  cap: null });
        ctx.setResource('Age', { amount: c.STARTING_AGE, cap: null });
      }
    },

    deserialize(ctx) {
      const s = bs(ctx);
      if (typeof s.pickupOrbClicked       !== 'boolean') s.pickupOrbClicked       = false;
      if (typeof s.pickupOrbCardVisible   !== 'boolean') s.pickupOrbCardVisible   = false;
      if (typeof s.scavengeClickCount     !== 'number')  s.scavengeClickCount     = 0;
      if (typeof s.scavengeCountdown      !== 'number')  s.scavengeCountdown      = 0;
      if (typeof s.scavengeCountdownTotal !== 'number')  s.scavengeCountdownTotal = 0;
      if (typeof s.scavengeQuickMode      !== 'boolean') s.scavengeQuickMode      = false;
      if (typeof s.scavengeForceEncounter !== 'boolean') s.scavengeForceEncounter = false;
      if (!s.scavengedEver)       s.scavengedEver       = {};
      if (typeof s.anyEverScavenged !== 'boolean') s.anyEverScavenged = false;
      if (!s.resourcesEverGained) s.resourcesEverGained = {};
      if (typeof s.firstCockroachEaten  !== 'boolean') s.firstCockroachEaten  = false;
      if (typeof s.firstMouseEaten      !== 'boolean') s.firstMouseEaten      = false;
      if (typeof s.peerIntoOrbPurchased !== 'boolean') s.peerIntoOrbPurchased = false;
      if (typeof s.peerIntoOrbCompleted !== 'boolean') s.peerIntoOrbCompleted = false;
      if (typeof s.touchTheOrbPurchased !== 'boolean') s.touchTheOrbPurchased = false;
      if (typeof s.touchTheOrbCompleted !== 'boolean') s.touchTheOrbCompleted = false;
      if (!Array.isArray(s.completedResearchOrder))    s.completedResearchOrder = [];
      if (!s.petCounts || typeof s.petCounts !== 'object' || Array.isArray(s.petCounts)) s.petCounts = {};
      if (!Array.isArray(s.recentScavenged)) s.recentScavenged = [];
      if (s.lastExtraResource === undefined) s.lastExtraResource = null;
      if (!s.pendingEncounter) s.pendingEncounter = null;
      if (typeof s.foodZeroMinutes !== 'number') s.foodZeroMinutes = 0;
      if (!s.roomLevel) s.roomLevel = '1';

      // Queen Ant → Fire Ant migration for saves created before this rename
      if (s.scavengedEver  && s.scavengedEver['Queen Ant'])  { s.scavengedEver['Fire Ant']  = true; delete s.scavengedEver['Queen Ant']; }
      if (s.petCounts      && s.petCounts['Queen Ant'])      { s.petCounts['Fire Ant'] = (s.petCounts['Fire Ant'] || 0) + s.petCounts['Queen Ant']; delete s.petCounts['Queen Ant']; }
      const qaRes = ctx.getResource('Queen Ant');
      if (qaRes.amount > 0) { ctx.addResource('Fire Ant', qaRes.amount); ctx.setResource('Queen Ant', { amount: 0 }); }

      // HP/Age safety net: re-seed if missing or zero
      const c = this.config.constants;
      const hp  = ctx.getResource('HP');
      const age = ctx.getResource('Age');
      if (!hp.amount  || hp.amount  <= 0) ctx.setResource('HP',  { amount: c.STARTING_HP,  cap: null });
      if (!age.amount || age.amount <= 0) ctx.setResource('Age', { amount: c.STARTING_AGE, cap: null });
    },

    tick(ctx, sim) {
      const s = bs(ctx);
      tickFood(ctx, sim);

      if (s.scavengeCountdown > 0) {
        const tickFrac = (ctx.config.tickIntervalMs || 1000) / 1000;
        s.scavengeCountdown = Math.max(0, s.scavengeCountdown - tickFrac);
        if (s.scavengeCountdown <= 0) {
          s.scavengeCountdown      = 0;
          s.scavengeCountdownTotal = 0;
          resolveScavenge(ctx);
          return true; // rebuild sidebar + general area
        }
      }
      return false;
    },

    ownsResource(name) { return this.ownedResourceNames.includes(name); },

    isResourceVisible(name, ctx) {
      const s = bs(ctx);
      if (!(s.scavengedEver && s.scavengedEver[name])) return false;
      return ctx.getResource(name).amount > 0;
    },

    isGroup1ResourceVisible(name, ctx) {
      const s = bs(ctx);
      return !!(s.resourcesEverGained && s.resourcesEverGained[name]);
    },

    isGroupAlwaysShown(groupKey, ctx) {
      const s = bs(ctx);
      if (groupKey === 'group2') return !!s.anyEverScavenged;
      if (groupKey === 'group3') return Object.values(s.petCounts || {}).some(n => n > 0);
      return false;
    },

    onCardClick(cardId, ctx) {
      const s = bs(ctx);
      if (cardId === 'scavenge') {
        startScavenge(ctx);
      } else if (cardId === 'pickup-orb') {
        if (s.pickupOrbClicked) return;
        s.pickupOrbClicked = true;
        chroniclePost('You carefully gather the Orb to study it', ctx);
      }
    },

    onCreatureAction(action, creatureName, ctx) {
      if (action === 'eat')   return doEat(creatureName, ctx);
      if (action === 'drain') return doDrain(creatureName, ctx);
      if (action === 'imbue') return doImbue(creatureName, ctx);
      return false;
    },

    dismissPet(creatureName, ctx) {
      const s = bs(ctx);
      if (!s.petCounts || !s.petCounts[creatureName]) return false;
      s.petCounts[creatureName] = Math.max(0, s.petCounts[creatureName] - 1);
      return true;
    },

    onResearchClick(researchId, ctx) {
      const s = bs(ctx);
      const c = C(ctx);
      const specials = computeSpecials(ctx);
      const costReduction = specials.researchCostReduction;

      if (researchId === 'touch-the-orb') {
        if (s.touchTheOrbPurchased) return false;
        const cost = Math.max(0, c.RESEARCH_TOUCH_THE_ORB_HP_COST - costReduction);
        const hp = ctx.getResource('HP');
        if (hp.amount < cost) return false;
        ctx.addResource('HP', -cost);
        s.touchTheOrbPurchased = true;
        s.touchTheOrbCompleted = true;
        s.completedResearchOrder = ['touch-the-orb', ...(s.completedResearchOrder || [])];
        return 'hp';
      }

      if (researchId === 'peer-into-orb') {
        if (s.peerIntoOrbPurchased) return false;
        if (!s.touchTheOrbPurchased) return false;
        const hpCost  = Math.max(0, c.RESEARCH_PEER_INTO_ORB_HP_COST  - costReduction);
        const ageCost = c.RESEARCH_PEER_INTO_ORB_AGE_COST;
        const hp  = ctx.getResource('HP');
        const age = ctx.getResource('Age');
        if (hp.amount < hpCost)   return false;
        if (age.amount < ageCost) return false;
        ctx.addResource('HP',  -hpCost);
        ctx.addResource('Age',  ageCost);
        s.peerIntoOrbPurchased = true;
        s.peerIntoOrbCompleted = true;
        s.completedResearchOrder = ['peer-into-orb', ...(s.completedResearchOrder || [])];
        if (!ctx.state.unlockedTiers.includes(1)) ctx.state.unlockedTiers.push(1);
        chroniclePost('Your life drains (Orb unlocked)', ctx);
        return 'hp_age';
      }

      return false;
    },

    evaluateRule(rule, value, card, ctx) {
      const s = bs(ctx);
      const c = C(ctx);
      const specials = computeSpecials(ctx);
      switch (rule) {
        case 'scavengeLocked':    return s.scavengeCountdown > 0;
        case 'pickupOrbVisible':  return !!s.pickupOrbCardVisible && !s.pickupOrbClicked;
        case 'pickupOrbLocked':   return !!s.pickupOrbClicked;
        case 'touchTheOrbLocked': return !!s.touchTheOrbPurchased;
        case 'peerIntoOrbLocked': {
          const hpCost = Math.max(0, c.RESEARCH_PEER_INTO_ORB_HP_COST - specials.researchCostReduction);
          return !s.touchTheOrbPurchased ||
                 s.peerIntoOrbPurchased  ||
                 ctx.getResource('HP').amount  < hpCost ||
                 ctx.getResource('Age').amount < c.RESEARCH_PEER_INTO_ORB_AGE_COST;
        }
        case 'drainImbueUnlocked': return !!s.touchTheOrbPurchased;
        default: return true;
      }
    },

    getCardFillFraction(cardId, ctx) {
      const s = bs(ctx);
      if (cardId === 'scavenge') {
        if (s.scavengeCountdownTotal <= 0) return 0;
        return 1 - (s.scavengeCountdown / s.scavengeCountdownTotal);
      }
      return 0;
    },

    getProgressBarColor(cardId, ctx) {
      const s = bs(ctx);
      if (cardId === 'scavenge') return s.scavengeProgressBarColor || null;
      return null;
    },

    getCompletedResearch(ctx) {
      return (bs(ctx).completedResearchOrder || []).slice();
    },

    isDrainImbueUnlocked(ctx) {
      return !!bs(ctx).touchTheOrbPurchased;
    },

    getPetRows(ctx) {
      const c      = C(ctx);
      const s      = bs(ctx);
      const counts = s.petCounts || {};
      const specials = computeSpecials(ctx);
      return Object.keys(c.creatureStats || {})
        .filter(name => counts[name] > 0)
        .map(name => {
          const stats = c.creatureStats[name];
          return {
            name,
            count:        counts[name],
            attack:       stats.imbuePetAttack,
            petCap:       stats.petCap || 1,
            foodConsumed: stats.foodConsumed || 0,
            special:      stats.special || '',
            type:         stats.type || 'Normal',
            essenceCost:  stats.essenceCost || 0
          };
        });
    },

    getTotalPetCount(ctx) {
      return Object.values(bs(ctx).petCounts || {}).reduce((a, b) => a + b, 0);
    },

    getComputedSpecials(ctx) {
      return computeSpecials(ctx);
    },

    getPendingEncounter(ctx) {
      return bs(ctx).pendingEncounter || null;
    },

    clearPendingEncounter(ctx) {
      bs(ctx).pendingEncounter = null;
    },

    resolveEncounter(selectedPetNames, ctx) {
      const s   = bs(ctx);
      const enc = s.pendingEncounter;
      if (!enc) return 0;

      const c = C(ctx);
      let playerAttack = 0;
      selectedPetNames.forEach(name => {
        const stats = (c.creatureStats || {})[name];
        if (stats) playerAttack += stats.imbuePetAttack;
        if (s.petCounts[name]) s.petCounts[name] = Math.max(0, s.petCounts[name] - 1);
      });

      const damage = Math.max(0, enc.attack - playerAttack);
      if (damage > 0) ctx.addResource('HP', -damage);

      s.pendingEncounter = null;
      return damage; // caller uses this to flash HP
    },

    isGroup1ResourceVisible(name, ctx) {
      const s = bs(ctx);
      return !!(s.resourcesEverGained && s.resourcesEverGained[name]);
    },

    resolveTooltipTokens(line, ctx) {
      const hp      = ctx.getResource('HP');
      const age     = ctx.getResource('Age');
      const s       = bs(ctx);
      const recent  = s.recentScavenged || [];
      const specials = computeSpecials(ctx);

      const tokens = {
        hp:  Math.round(hp.amount),
        age: Math.round(age.amount),
        recentScavenged:        recent.length > 0 ? recent.join(', ') : 'Nothing yet',
        scavengeTimeReduction:  specials.scavengeTimeReduction > 0 ? `Scavenge time: -${specials.scavengeTimeReduction}s` : '',
        scavengeLuck:           specials.scavengeLuck > 0 ? `Scavenge luck: +${specials.scavengeLuck}%` : '',
        extraResourcePctLine:   specials.extraResourcePct > 0 ? `Extra resources: ${specials.extraResourcePct}%` : '',
        lastExtraResourceLabel: s.lastExtraResource ? 'Last Extra:' : '',
        lastExtraResource:      s.lastExtraResource || '',
        researchCostReduction:  specials.researchCostReduction > 0 ? specials.researchCostReduction : ''
      };
      return line.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tokens ? tokens[k] : m));
    }
  };

  window.Mechanics = window.Mechanics || {};
  window.Mechanics.scavenge = scavenge;
})();
