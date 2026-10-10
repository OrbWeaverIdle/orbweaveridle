# Tests

Node-only. No browser, no build step. From the project root:

```
npm install jsdom      # one time
node tests/loop-timing.test.js
node tests/save-roundtrip.test.js
node tests/save-edgecases.test.js
node tests/goldpanning.test.js
node tests/goldmine.test.js
node tests/smeltershack.test.js
node tests/tooluse.test.js
node tests/quarry.test.js
node tests/toolshed.test.js
node tests/digsite-strangeshard.test.js
node tests/display-prefs.test.js
node tests/tents.test.js
node tests/mountains-claim.test.js
node tests/collapsedpath.test.js
node tests/cheat-loc2.test.js
node tests/counterweight.test.js
node tests/substeppers.test.js
node tests/rates.test.js
node tests/scoutstable-tabs.test.js
```

**rates** boots the real game and checks the rail's measured rates
(js/core/rates.js): a known producer reads exactly, the three units,
Worker wages, cheats/clicks ignored, crate moves merged into the parent,
cap "Full < X/s", whole-number "<1", pause and gold-starved freeze, the
in-band breakdown, offline reset, prefs, band striping, the /s lump
average (rhythm, random rolls, single lump, stopping), the /min and /hr
long average (fast cycles, load-then-travel, on/off, flipping wages, wage
blips, dice, 30-min memory for rare finds, stopping, Full stores, worker-
change restarts, steady changes, the 1% redraw rule), Gold Panning and
Dig Site expected rates on /min and /hr (checked against hours of seeded
rolls; Gold Panning in the /hr total, still out of /s) and an auto mule's
cargo ÷ (load + travel) hint until its 2nd arrival (none for one-off trips).

Each prints PASS/FAIL per check and exits non-zero if anything failed.

**loop-timing** drives `js/core/loop.js` with a fake clock. Proves game
time tracks real time even when the pump is throttled the way a
background tab throttles it, that a long gap is capped rather than
replayed all at once, and that a bulk catch-up repaints once.

**save-roundtrip** boots the real game in a headless DOM, plays it,
saves, boots a second fresh game, loads, and diffs the two worlds —
every resource, worker pool, and card. Then ticks both another 60
seconds and diffs again, which is the check that actually matters: two
worlds that look identical but *evolve* differently mean something
derived didn't come back.

**save-edgecases** covers what the design was most worried about: a mule
mid-trip with a sequestered crew, research effects being replayed rather
than stored, a sale in flight, a resource that only exists because cargo
created it, a corrupt save, and a plain early-game save with no cheats.

These read the game through its public surface, so they keep working as
mechanics are added. When you add a mechanic, add a case here.

**offline** covers crediting time away, the 24-hour cap, gold running
out mid-absence, report contents, the bonus hook, short gaps that
shouldn't interrupt, and nonsense clock values.

**goldpanning** boots the real game, reveals the card, staffs stations
and ticks them: the dice table, sub-tick throughput past the batch
threshold, the Last Reward / Last Hour tracking, add-station + the
10-station cap, that gold dust and nuggets stay out of the public
resource registry, and that the whole station board survives save/load.

**smeltershack** boots the real game, stages a Forge, and drives it
through a full Heating -> Filling -> Outputting -> Stopped cycle via
the real Loop pipeline: canSmelt gating, Gold Bars staying unrevealed
until the first bar is actually produced, an auto-Stop that fires
inside tickForge() itself (not a user Cancel) resetting wood/molten
but leaving selections and staffing untouched, that selections lock
while active but staffing never does, that only an actively-cycling
Forge's workers cost gold, Add-Forge cost/cap, save/load, and — through
a real card click and a real stepper click, not just `_debug` — that
the modal renders one card per Forge and a click actually reaches
subAssign.

**tooluse** exercises `js/core/toolUse.js` in isolation (just Upgrades
+ Cycles, no full game boot): the binary gate, whole-tool banking,
frozen-progress-on-shortfall with no partial credit, resuming from the
exact frozen point, the 0-workers no-op, serialize/deserialize
round-tripping, and the header tier-pips generator at several tiers.

**quarry** boots the real game and covers what the Tool Shed session
added to Quarry: real toolTier consumption (production runs during the
sub-whole-tool window, then fully stops — not a scaled trickle — the
instant a whole tool is owed and unavailable), the header subtitle,
and the upkeep.js gold-cap bug fix (`mechanic.resourceId`) verified via
an actual at-cap gold-billing check.

**toolshed** boots the real game, stages benches, and drives ticks
through the public surface: output-must-be-chosen-before-staffing, the
output select locking while staffed and unlocking once empty, the
binary recipe gate (frozen progress on a wood/stone shortfall, no
partial credit, resuming from the exact frozen point), full
gold-starvation stop (no burn-through), billing (a starved bench's
workers are free), Add-Bench cost/cap gated on Camp's own `goldbars`
row, the Camp Construction-list reveal path, save/load, and a real
card click + stepper click reaching the mechanic through the DOM.

**digsite-strangeshard** covers Dig's shared rolls, heating-only bonus gating,
wood-cap conservation and crates, sustained and exhausting fire, worker billing,
exact wall-clock history, save compatibility, two live modal bars, and temporary
previews (interaction locks, bar overrides, per-location restoration, real unlocks,
reload cleanup and document-order timing).

**display-prefs** covers Settings' four display sliders: defaults on an
empty store, the theme and layout mappings in their corrected
top-to-bottom order, clamping of out-of-range and wrong-typed values, a
malformed blob, storage blocked on both read and write, the persistence
round trip under the hyphenated key names, preferences outliving an
Erase (they live in `orbweaver.display.v1`, which `save.js` never
touches), the pointer-only center detent, and the adjusting-state
lifecycle across release, cancel, lost capture, blur and pagehide. It
also covers the inline `<head>` initializer separately, parsing only as
far as `</head>` so the assertions land at the pre-paint moment when
`script.js` does not yet exist.

**tents** covers the card-face time display: both strict unit
thresholds (seconds up to and including 120s, m+s past it, h+m past
3600s), that a total is rounded before it is split so no tier can
print a 60 in its smaller unit, and that all three card-face states
plus the modal's Next cost row read from the one shared formatter. It
also asserts the PAUSED caption's markup contract — element present
after the button, uppercase text, shown by a CSS sibling rule,
absolutely positioned, and unknown to `script.js` — since its
visibility is pure CSS and jsdom applies no stylesheet.

**mountains-claim** covers the travel-path reward flow that replaced the
Wheat Field / Gold Panning build sub-slots. A reward path is one carrying
a `grants` block: it renders a claim button from the moment it is
revealed, greyed and already naming its payout, and on completion it
parks at phase `claim` rather than vanishing — bar pinned full, stepper
gone, button live. The click reveals the cards (one click grants both
Gold Panning and the Smelter Shack), pushes the established message and
clears the section; `doneMsg` fired earlier, at travel completion.

The checks that matter most are the ones proving a claim-phase path has
LEFT `activePaths`: it emits no extra bar and holds no billable workers.
That is the property keeping this feature out of upkeep, clamping, stat
text, the card-face bars and `tick()`. The suite also asserts the claim
survives a save round trip under the existing `ps` key with no new save
field, that a stale button cannot re-grant, and — at source level — that
every piece of the old build machinery is really gone.

What it cannot cover, and what browser checks are for: the `zoom`
property's actual rendering, centered-frame geometry and gutters, modal
containment at each zoom level, vertical slider geometry, real pointer
capture and touch dragging, and how each palette actually looks.

**collapsedpath** reveals the Collapsed Path card through the Mountains
`blockedexit` reward claim, then covers its two areas: the card stepper
and area-stepper split (an area's workers never move to the other), Tier
III tool clearing counting down from 999, the worker-built ladder and
pulley (builders freed onto the card after each), "Peer over the top"
revealing Sand Dunes, the shared 200-slot pulley storage from both ends
across a save/reload, the Sand Dunes Collapsed Path card digging the
same shared count with its own workers and tools (either side shortens
the other, across a reload), and a full clear: both Collapsed Path cards
hidden, storage handed to Sand Dunes, Sand Dunes routable by Scout
Stables.

**counterweight** builds a Mountains counterweight in pieces past the
5,000 stone cap (stopping, unbilled, when stone runs out), checks the
Sand Dunes end stays its own, then drives trips with crew: none or no
gold and the trip stands still, 1 crew is the 5-minute trip, more crew
speed a trip already in flight, and MPF buffs apply. The repeat switch
waits unbilled for a full load, sends a partial fill, switches off only
when an Up finds storage full, and never switches off on Down. It also
covers save/reload, an older save's Sand Dunes clearers, and the card −
priority (free, builders, crew, clearers).

**cheat-loc2** presses the Loc 2 cheat with the Rich Uncle Tutorial on
(the worst case) and checks it finishes Camp and Mountains — every
building, every travel walked and claimed, capped resources, 1000 Tools
II/III and 20 workers each — while giving no Rich Uncle, mules, carts,
bulls or anything in Sand Dunes. It then builds the ladder and uses
"Peer over the top", presses Loc 2 again, and proves Sand Dunes and
Collapsed Path progress are untouched, across a reload.

## A trap worth knowing

jsdom fires its **own** `DOMContentLoaded` shortly after a manual
dispatch, which boots the entire game a second time on top of the first.
Synchronous suites finish before it lands and never notice; anything
that yields to an animation frame does. Every harness here blocks it
with a capture-phase listener on `window`. Four apparent "offline bugs"
turned out to be exactly this.

**substeppers** drives every card with modal sub-steppers through its real
buttons: card-face + fills the topmost sub-stepper, then the last one added
to (topmost again once that one is gone), a modal − returns the worker to
idle, and every card worker stays visible in a sub-stepper's live count.
