# Orb Weaver — UI Shell Summary

## Golden Rules (standing rules for every session)
These are confirmed, permanent rules — not just decisions for one session:
1. Never assume on ambiguity. Always ask clarifying questions, numbered, before writing any code.
2. Warn when context window usage reaches 75%, stated in all caps: **MY CONTEXT WINDOW IS 75% FULL**.
3. Always deliver a full zip of every project file in the correct folder structure, every time work is delivered — not just the files that changed.
4. Keep code as clean and line-reduced as possible while still fully achieving the goal.
5. Mechanic/script loading uses manual `<script>` tags in `index.html` (grouped, commented) — never a dynamic loader. `index.html` must always be the ground-truth, one-file list of what's active and in what order.
6. Per-mechanic files (`js/mechanics/*.js`) contain ONLY that mechanic's data/numbers plus minimal glue code. All shared behavior (workers, gold/upkeep, card rendering, upgrade engine) lives once in `js/core/` and is never duplicated per mechanic.
7. The context footer (`js/core/footer.js`) is the one area Claude has standing permission to add to proactively, without asking first, as new mechanics are built.
8. **Wood (`js/mechanics/wood.js`) is the reference template for the "Resource Card" pattern.** Any future resource card (Stone, Iron, Food, etc., in Camp or any other right-hand category) should reuse Wood's exact architecture — resource row, card steppers, three-state stat text, sub-rate label, upgrade-ladder engine — substituting only that mechanic's own data.

## What this is
A rebuild of the game's UI shell with real mechanics (Workers, Gold, Wood) on top of a modular `js/core/` + `js/mechanics/` engine. The next planned mechanic is **Stone**.

## Files
| File | Contents |
|---|---|
| `index.html` | Markup skeleton: layout, cheat header, context footer, settings gear, settings modal, one reusable card-detail modal (with `#card-modal-header-left` slot for modal-header steppers), manual script tags grouped by role. |
| `style.css` | Every visual token and component style. Mobile breakpoint at 700px (left panel shrinks to 150px, fonts tighten, cards go single-column). |
| `script.js` | Core shell behavior: modals, section collapse, settings, placeholder toggle. `openCardModal(name, html, headerLeftEl)` accepts an optional third argument to populate the modal header's left slot. |
| `placeholders.js` | Every demo card, demo resource row, and three extra demo themed sections. Fully isolated — delete file + `<script>` tag, nothing else breaks. Hidden by default (toggle is OFF). |
| `js/core/*.js` | The shared mechanics engine — resources, workers, upkeep, upgrades, real-card rendering, footer, game loop, mechanic registry, cheats. |
| `js/mechanics/wood.js` | Wood's numbers and status glue only. The template for every future mechanic file. |
| `js/main.js` | Wires real resources/cards into the DOM in order and starts the loop. Touch this + one `<script>` line when adding a new mechanic. |

## Layout
```
#app (full viewport height, flex column)
 ├─ #cheat-header    — hidden by default, shown via Settings' Cheat menu toggle
 ├─ #main-wrap (flex row, overflow-x:hidden, fills remaining space)
 │   ├─ #left-hand   — sidebar, 260px (150px on mobile), overflow-x:hidden, min-width:0
 │   │    ├─ #left-hand-real-resources  — Workers, Gold, Wood, ... (real rows)
 │   │    └─ #left-hand-resources       — placeholder rows (hidden by default)
 │   └─ #right-hand  — main pane, flex:1, overflow-x:hidden, min-width:0, scrollable vertically
 │        ├─ #settings-gear-btn (fixed, top-right)
 │        ├─ .section-label "Camp"
 │        ├─ #grid-camp (.card-grid) — real cards first, placeholder cards appended
 │        └─ #right-hand-placeholder-mount — extra placeholder-only sections
 └─ #context-footer  — full width bottom strip, latest message only
```

## Card detail modal pattern
One shared modal (`#card-modal-scrim`) for all cards. The modal header has three slots: `#card-modal-header-left` (steppers for real mechanic cards), `.modal-title`, and `.modal-close`. Placeholder/static cards leave the header-left slot empty (it auto-hides via `:empty`). Real mechanic cards populate it with a live stepper set including a lock button.

## Real mechanics architecture
- `js/core/` is never touched when adding a new mechanic
- Per-mechanic files (`wood.js`, future `stone.js`) contain only: resource cap, base rate, upgrade table, and status glue
- Adding a new mechanic = copy `wood.js` shape + one `<script>` tag + two lines in `main.js`

### Tick rate
5 ticks/second (200ms base interval). `TICK_RATE = 0.2`. All mechanic data in per-second terms; loop multiplies by `TICK_RATE` each tick. Speed cheat shortens the interval only — math stays the same.

### Workers
- Start 5/5 (idle/total), displayed as `idle/total`
- Recall-all button (–) sits left of the value — returns all **unlocked** workers to idle
- **Lock button** in modal header steppers (🔓/🔒, single-tone, border when locked): when a card is locked, its workers are excluded from the recall-all action. Players can still manually click – on the card face to remove a worker
- Each card's +/– steppers assign/unassign one worker. + disables when no idle workers remain; – disables at 0 assigned

### Gold
- Starts 5000/5000 (cap raisable via Caps cheat or gameplay)
- Always whole number
- Drains 1 gold/sec per **billable** worker (workers on a card whose resource is at cap are NOT billed)
- Red sub-rate label under Gold row while at least one billable worker is assigned
- At 0 gold: workers stay, production halts, card shows "Stopped." Resumes automatically when gold returns
- Workers on a card at resource cap: also show "Stopped," also not billed for gold

### Wood — the reference "Resource Card" (Golden Rule 8)
- Resource row: left-hand, under Gold, starts `0/200`, one decimal place
- Card: right-hand, in Camp, always before placeholder cards, always visible regardless of placeholder toggle
- Base rate: 0.65 wood/sec per worker
- **Card stat text has exactly three states:** empty (0 workers), `x/s` (producing), or `Stopped` (workers assigned but gold is 0 OR resource is at cap)
- Green `+x/s` sub-rate label under Wood resource row while producing (still shows even at cap, since workers are assigned and rate is known)
- **Upgrade timer** always advances once building starts — does NOT require workers or gold. Each assigned worker reduces the timer by an additional 0.2s/tick (= 1s/real-second at base speed), displayed as "N workers reducing N/s" below the build status line
- **Modal upgrade list** shows next 3 upgrades:
  - **Row 1 (always live, never greyed):** per-resource tracker ("100/200 Wood, 15/50 Stone") replaces plain cost text; button says "Build upgrade" if player can fully afford it right now, "Collect Resources" otherwise — re-evaluated every tick; "Cancel collecting" button has a thin gold progress bar along its bottom edge showing aggregate collection progress; effect line shows before→after with bold "after" values ("Cap: 200 → **400** · Rate: 0.65/s → **2.00/s** per worker")
  - **Rows 2–3 (greyed reference):** plain cost text, same bold before→after effect line
  - Resources not yet in game show "0/need" in the tracker (row 1 always shows live, even for future resources)
- **Auto-absorb:** any resource gain (production tick, cheat, or future mechanic) routes through active reservations first via `Resources.add()` → `Upgrades.collectIntoReservations()` before reaching the free pool — applies to all mechanics generically
- 9-step upgrade ladder: Wood Pile → Wood Shed → Wood Hut → Wood Store → Lumber Yard → Lumber Lodge → Lumber Hall → Lumber Depot → Lumber Warehouse

### Card face
- Fixed height: **50px** (static, never reflows regardless of content state)
- Steppers on left (order:1), card body on right (order:2)
- Thin green upgrade bar along top edge (smooth 60fps `requestAnimationFrame` interpolation — not CSS transition — to avoid tick-rate jitter). Same smoothing loop drives modal's detail progress bar
- Card also has duplicate steppers in the modal header (left of title) for player convenience — both sets do the same thing and stay in sync

### Progress bars (smoothing)
Both the card-face upgrade bar and the modal detail bar are driven by a single `requestAnimationFrame` loop per mechanic (in `cards.js`). The true target (`getCardProgressPct()`) returns a continuous float (no rounding), giving the interpolation loop a smooth line to follow. The last-known smoothed value is stored on `mechanic.els.shownPct` and applied instantly when the modal HTML is rebuilt each tick, preventing a one-frame flash to 0.

### Cheat menu
Toggle in Settings. Shows `#cheat-header` strip above the two panes. Contains:
- **Wood +100**, **Gold +100** — respects caps (and auto-absorbs into active reservations)
- **Workers +5** — uncapped
- **Caps +1000** — raises every registered capped resource's cap
- **Speed 1x / 2x / 5x / 10x** — mutually exclusive, shortens tick interval only

### Mobile (≤700px)
- Left panel: 150px wide, reduced padding, smaller fonts (8–11px range)
- Right panel: `overflow-x:hidden`, `min-width:0` — vertical scroll only, no horizontal bleed
- `#main-wrap`: `overflow-x:hidden` as top-level backstop
- Cards: single-column grid (`grid-template-columns: 1fr`)
- Mobile `.card-grid` override is placed **after** the base `.card-grid` rule in `style.css` to correctly win the CSS cascade

## Settings menu
- ⚙ gear button fixed top-right, opens modal titled **"Orb Weaver"** (Cinzel Decorative — only usage)
- Controls: placeholder toggle (OFF by default), cheat menu toggle (OFF by default)

## Context footer
Full-width strip below both panes, shows only the most recent game message. No label. Claude has standing permission to add new footer messages as mechanics are built.

## What's deliberately NOT here yet
- Stone, Plywood, Brick, and every mechanic beyond Wood
- Raising the gold cap through normal gameplay
- Save/load

## How to run
Open `index.html` directly in a browser, or use VS Code Live Server. No build step, no dependencies beyond the Google Fonts CDN link already in `index.html`.
