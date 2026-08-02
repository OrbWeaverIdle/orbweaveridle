# Orb Weaver — UI Shell Summary

## Golden Rules (standing rules for every session)
These are confirmed, permanent rules — not just decisions for one session:
1. Never assume on ambiguity. Always ask clarifying questions, numbered, before writing any code.
2. Warn when context window usage reaches 75%, stated in all caps: **MY CONTEXT WINDOW IS 75% FULL**.
3. Always deliver a full zip of every project file in the correct folder structure, every time work is delivered — not just the files that changed. This includes this summary and its manifest.
4. Keep code as clean and line-reduced as possible while still fully achieving the goal.
5. Mechanic/script loading uses manual `<script>` tags in `index.html` (grouped, commented) — never a dynamic loader. `index.html` must always be the ground-truth, one-file list of what's active and in what order.
6. Per-mechanic files (`js/mechanics/*.js`) contain ONLY that mechanic's data/numbers plus minimal glue code. All shared behavior (workers, gold/upkeep, card rendering, upgrade engine) lives once in `js/core/` and is never duplicated per mechanic.
7. The context footer (`js/core/footer.js`) is the one area Claude has standing permission to add to proactively, without asking first, as new mechanics are built.
8. **Wood (`js/mechanics/wood.js`) is the reference template for the "Resource Card" pattern.** Any future resource card should reuse Wood's exact architecture, substituting only that mechanic's own data.

## A note on numbers in this document
This summary describes **how things work**, not **what the numbers currently are**. Rates, costs, build times, caps, and starting amounts live only in their owning mechanic file (`wood.js`, `stone.js`, `buildersbench.js`, `market.js`) and get edited there directly — including by the user, without Claude's help. If you need a current number, check the file; treat anything numeric in an older version of this doc as unreliable. This applies to Market's tier ladder and sell-resource rates exactly as it applies to Wood/Stone.

## What this is
A rebuild of the game's UI shell with real mechanics (Workers, Gold, Wood, Stone, Builder's Bench, Market) on top of a modular `js/core/` + `js/mechanics/` engine. The engine supports three kinds of cards: simple **Resource Cards** (Wood, Stone), **multi-track cards** that build other things (Builder's Bench), and a **sell card** pattern (Market) that turns resources into gold.

## Files
| File | Contents |
|---|---|
| `index.html` | Markup skeleton, cheat header, context footer, settings gear, settings modal, one reusable card-detail modal (now a two-row header: top row + a subtitle sub-row, see Modal architecture), manual script tags grouped by role. |
| `style.css` | Every visual token and component style. Mobile breakpoint at 700px. Fixed-square card pattern for grid-style content (see Sell Track below) is reusable for any future card grid — check this file for the actual pixel values. |
| `script.js` | Core shell behavior: modals, section collapse, settings, placeholder toggle. `openCardModal()` now takes an optional 4th argument (subtitle HTML) — see Modal architecture. |
| `placeholders.js` | Demo/example content, fully isolated. Unchanged. |
| `js/core/*.js` | The shared mechanics engine. See sections below for what each core file now supports. |
| `js/mechanics/wood.js` | Wood's numbers and status glue. The template for every resource-card mechanic. |
| `js/mechanics/stone.js` | Second resource card, built from Wood's exact template. Starts hidden until Builder's Bench builds Stone Pit. |
| `js/mechanics/buildersbench.js` | Not a resource — builds other cards instead (Construction list item renamed "Market Stall," see Reveal system). |
| `js/mechanics/market.js` | Not a resource — sells resources for gold. Owns a self-upgrade ladder (same pattern as Builder's Bench) plus a **sell track** (new, see below). Starts hidden, revealed instantly-built when Builder's Bench completes "Market Stall." |
| `js/main.js` | Wires real resources/cards into the DOM (order: Wood, Stone, Builder's Bench, Market) and starts the loop. |

## Layout
```
#app (full viewport height, flex column)
 ├─ #cheat-header    — hidden by default, shown via Settings' Cheat menu toggle
 ├─ #main-wrap (flex row, overflow-x:hidden, fills remaining space)
 │   ├─ #left-hand   — sidebar, 260px (150px on mobile)
 │   │    ├─ #left-hand-real-resources  — Workers, Gold, Wood, Stone (hidden until revealed)
 │   │    └─ #left-hand-resources       — placeholder rows (hidden by default)
 │   └─ #right-hand  — main pane, scrollable
 │        ├─ #settings-gear-btn (fixed, top-right)
 │        ├─ .section-label "Camp"
 │        ├─ #grid-camp (.card-grid) — Wood, Stone (hidden until revealed), Builder's Bench (hidden until revealed), Market (hidden until revealed)
 │        └─ #right-hand-placeholder-mount
 └─ #context-footer  — full width bottom strip, latest message only
```

## Modal architecture
The shared card-detail modal (`#card-modal-scrim`) now has three parts to its header, plus a rule about how it stays live without breaking clicks.

**Header layout:** a top row (`.modal-header-top`: steppers slot | title | close button — unchanged from before) and, below it, `#card-modal-header-sub` — a generic slot any mechanic can fill via an optional `getSubtitleHtml()` hook, wired through `openCardModal(name, descriptionHtml, headerLeftEl, subtitleHtml)`'s new 4th argument. It auto-hides via `:empty` when a mechanic doesn't define the hook, so Wood/Stone/Bench are unaffected. Market uses this for its two subtitle lines (an upgrade tip that disappears once Wood or Stone gets its first upgrade, and a note that Market's workers never cost gold).

**`modalWide`:** an optional boolean a mechanic can set (`mechanic.modalWide = true`) to widen the shared modal for grid-style bodies (Market's sell cards need more horizontal room than a single upgrade ladder). The shell applies/clears the wide class generically on open — no mechanic-specific code in the shell itself.

**Why the modal stays clickable while ticking (important standing rule):** an open modal must never have its full body innerHTML replaced on a per-tick basis — only specific text nodes should be patched. Early on, refreshing an open modal every tick by re-rendering its whole HTML was destroying and rebuilding every button in it 5×/second; if a tap landed between rebuilds, the browser's click event had nowhere to land and silently failed. The fix, now a standing pattern: `Cards.refresh()` (called every tick) calls `patchOpenModal()`, which only updates specific elements a mechanic exposes via optional hooks (`patchUpgradeCost()`, `patchBuildStatus()`, `patchSellCards()`) — no nodes are created or destroyed. A full rebuild (`rebuildOpenModal()`, which does replace the innerHTML) only happens after a user action fires (a button press), when the structure genuinely needs to change. Any future mechanic that needs live-updating modal content should add a small `patch*()` hook rather than relying on `renderModalHTML()` being re-run every tick.

**Live-patch hook, generalized this round:** the per-tick patch hooks (`patchUpgradeCost`, `patchBuildStatus`) previously only kept the self-upgrade ladder current; Builder's Bench's Construction list and Market's idle sell-card afford state didn't refresh until the next full rebuild (a button press). Both now expose one shared optional hook, `mechanic.patchLiveTrack()`, called every tick alongside the others: Builder's Bench wires it to the choice track's new `patchModalRows()` (live cost trackers, disabled-button state, and the building item's countdown/bar), and Market wires it to the sell track's `patchDOM()` (now also live-updates each idle sell card's "Bundle" button as resources accumulate, plus the live sell-time label below). Any future second/third track should use this same hook name rather than inventing a new one.

**Live sell-time readout:** Market's "Sell" section header now shows the sell track's current effective duration (e.g. `Sell — 178.4s`), recomputed and patched every tick as workers are assigned/unassigned to the card — no rebuild needed.

**Why every upgrade-action button uses `click`, not `pointerdown`:** the delegated listener in `upgrades.js` (for every `[data-upgrade-action]` element) fires on `click`. Using `pointerdown` there previously let a modal-closing action's stray follow-up click land on whatever card was newly exposed underneath, opening an unrelated card's modal right after the tap. `click` naturally requires pointerdown+pointerup on the same element, matching how card-opening already worked, so this can't happen. Keep any new interactive element inside a mechanic's modal on `click`, wired through the same `data-upgrade-action` delegation.

## Card detail modal — close rules
Whether clicking an upgrade-modal button closes the modal depends on the action and track type:
- **Closes:** "Build upgrade" on a sequential ladder — but only if the player could fully afford it outright, so it jumped straight to building. If they couldn't (now collecting instead), it stays open. Construction's "Build" button always closes, regardless of afford state.
- **Stays open:** Cancel / Cancel collecting (any track kind), Construction's Reveal button, the Upgrades collapse arrow, and every Market sell-card action (bundle select, sell, cancel sale, toggle auto, toggle lock) — selling is a repeatable action, not a one-shot commitment.

## Reveal/hide system
Any resource row or card can start invisible and be revealed permanently once a condition is met — generic, reusable, not a one-off hack:
- A resource: `Resources.register(id, {..., hidden: true})`, later `Resources.reveal(id)`.
- A card: `mechanic.startHidden = true`, later `Cards.reveal(mechanic)`.
- The revealing mechanic checks its own trigger condition inside its own `tick()`, guarded by a local boolean so it only fires once.

Currently used by: Stone (hidden until Builder's Bench completes Stone Pit), Builder's Bench itself (hidden until wood reaches a threshold), and Market (hidden until Builder's Bench completes its Construction item — renamed **"Market Stall"** — which then reveals Market's card; Market's own starting tier is instant/pre-built, mirroring how Builder's Bench's own starting tier works).

## Card-face states
**Resource Cards (Wood/Stone)** — the stat text pattern any future resource card should follow:
- 0 workers, not collecting → empty
- 0 workers, collecting → `Collecting`
- Stopped, not collecting → `Stopped`
- Stopped, collecting → `Stopped – Collecting`
- Producing, not collecting → `x.xx/s`
- Producing, collecting → `x.xx/s – Collecting`

**Builder's Bench** — six states: `Click to open` (before first click) → blank (idle) → `Collecting` (self-upgrade only) → `Building {item} – {n}s` (Construction only) → `Building {item} – {n}s – Collecting` (both at once) → blank again once idle.

**Market** — same shape as Builder's Bench, with its own opening line: `Bundle resources for gold` (before first click) → blank (idle) → `Selling – {n}s` (soonest-finishing sale) → `Selling – {n}s – Collecting` (a sale running and the self-upgrade ladder collecting at once) → `Collecting` (self-upgrade only, no sale running).

## The collapsible upgrade ladder — layout pattern
Both Builder's Bench and Market use the same collapsible self-upgrade ladder (`Upgrades.create(table, renderEffect, collapsible=true)`), and both now share this layout, worth reusing for any future collapsible mechanic:
- No standalone "Upgrades" section header — the collapse arrow sits inline at the left edge of the active tier's own name (nudged into the modal's side margin), so the upgrade card itself sits at the very top of its section.
- **Expanded:** normal layout — name/cost on one line, effect description below, action button below that.
- **Collapsed:** the action button ("Build upgrade" / "Collect Resources") moves inline into the title row, stretching to fill whatever width the tier name doesn't use. The live resource-cost tracker and the effect description move to one line below, sharing space and shrinking (ellipsis) as needed rather than wrapping.
- Builder's Bench's Construction list header ("Construction") and Market's divider above "Sell" follow the same instinct — Bench's divider is now silent (a rule with no label) since the section is self-evident from its content; Market keeps a text label since "Sell" isn't otherwise obvious from the cards alone.

## The multi-track engine (three track factories in `js/core/upgrades.js`)
A mechanic can mix any of these under composite keys (`'mechanicId:trackName'`), letting one card run more than one independent process off a single worker pool — every assigned worker contributes to **all** of that card's tracks simultaneously, no splitting.

**Sequential ladder (`Upgrades.create`)** — the original Wood/Stone pattern (fixed order, "next 3" shown, one active tier at a time). Supports an optional custom effect-line renderer, an optional "collapsible" mode (see layout pattern above), and — new this round — an optional `arrowHTML` argument so the collapse arrow can be injected inline into the active tier's name row instead of a separate label.

**Choice track (`Upgrades.createChoiceTrack`)** — for a short list of independently-buildable items sharing one build slot (Builder's Bench's Construction list: Stone Pit, Market Stall, Scout's Pen, Gambler's Mat). Full cost paid up front, only one item mid-build at a time, items can start unavailable or hidden behind a gold-cost early reveal, one-time builds that drop off the list once built.

**Sell track (`Upgrades.createSellTrack`) — new this round, powers Market.** For a set of resources the player can repeatedly sell for gold:
- Each resource has one or two selectable bundle sizes (only one selected at a time) and a derived "→ N Gold" payout.
- A resource starts locked; the owning mechanic's upgrade-ladder tiers call `unlockResource`, `enableAuto`, `setBundles`, and `setMaxConcurrent` as they complete, exactly the way Builder's Bench's ladder unlocks Construction items.
- Selling costs the full bundle up front (mirrors Construction's up-front cost rule) and pays out gold on a timer; an in-progress sale can be canceled for a full refund (any refund overflowing a resource's cap is lost, matching how gold overflow past the cap is also lost).
- **Sale duration is not frozen at sale start** — it's recomputed every tick from the mechanic's *current* assigned worker count, so adding or removing workers mid-sale speeds up or slows down the remaining time live, and can even finish a sale early.
- A single shared pool of "sale slots" (starts at 1, raised by ladder tiers) caps how many sales — manual or auto — can run at once across every resource combined. An auto-sell toggle is capped at that same slot count: toggling more auto-sells on than there are slots for makes the extra toggle visibly bump back off instead of silently failing. Each toggle-capable resource also gets a lock button next to it — locking keeps auto-sell on even through a gold-cap loss that would otherwise turn it off automatically.
- Every sell-card resource, unlocked or not-yet-unlocked, reserves the same fixed layout space (including the auto-toggle column) so unlocking a feature never shifts or resizes anything already on screen — the same principle as the fixed-square card sizing in `style.css`.

**Fixed-square card sizing (reusable pattern, see `style.css` for values):** any card in a grid-style modal body (currently only Market's sell cards) is sized with an explicit pixel `width` **and** `height` (not derived from content), backed by `aspect-ratio: 1` as a redundant safety net, with every internal row given its own reserved height so that no state change — more/fewer bundle options, an auto-toggle unlocking, a sale starting — can ever resize the box. The top row's reserved height was enlarged this round (was clipping into the gold line below it when a 2-bundle resource's chips wrapped to 2 lines) — check `style.css`'s `.sell-row-top` for the current value.

## Small opt-in flags
A few single-boolean flags a mechanic can set without any core engine changes: `mechanic.upkeepExempt` (workers on this card never cost gold upkeep — used by Market, since it's the gold-generating mechanic) and `mechanic.modalWide` (see Modal architecture above).

## Progress bars
Each mechanic can drive up to two smoothed progress bars (top = upgrade/self-upgrade, bottom = optional second track), each independently eased via one `requestAnimationFrame` loop per card, matched to its modal counterpart via `data-track`.

## Settings menu
Unchanged — ⚙ gear button, placeholder toggle (off by default), cheat menu toggle (on by default, includes Wood/Stone/Gold +100 and Workers +5).

## Context footer
Unchanged — full-width strip, latest message only, Claude has standing permission to push new messages as mechanics are built.

## What's deliberately NOT here yet
- Simple Parts, Simple Tools, Plywood, Brick, Iron, Wrought Iron as actual resources — Market's sell cards for these appear once their ladder tier unlocks them, but are unsellable (player has 0) until the resource itself is built elsewhere
- Market's Bazaar / Mall / Grand Bazaar / Mega Mall tiers beyond the sell-unlocking tiers have no special effect defined yet (just faster worker rate)
- Scout's Pen and Gambler's Mat appear as built once constructed but have no gameplay effect yet (inert by design)
- Builder's Bench's self-upgrade tiers beyond Builder's Shed have placeholder "Unlocks: TBD" text pending definition
- Raising the gold cap through normal gameplay
- Save/load

## How to run
Open `index.html` directly in a browser, or use VS Code Live Server. No build step, no dependencies beyond the Google Fonts CDN link already in `index.html`.
