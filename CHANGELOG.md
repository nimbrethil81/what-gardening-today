# Changelog

All notable changes to "What Gardening Today?" will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows a simplified semantic scheme:

- **MAJOR** (e.g. 1.0 → 2.0) — architectural phase transitions per SPEC.md §6 (e.g. backend migration, native rewrite).
- **MINOR** (e.g. 1.0 → 1.1) — user-facing features, UI changes, and bug fixes within the current phase.

---

## [2.0] — 2026-07-17

**Status:** shipped. The v2 frontend is now the live app, replacing the 1.x Google Sheets / Apps Script stack. A few operational follow-ups remain open — see *Post-cutover follow-ups* below.

v2.0 is the Phase 4 architectural transition in `SPEC.md` §6: the backend moves from Google Sheets + Google Apps Script to Supabase (PostgreSQL), the app gains email sign-in and per-garden Row-Level Security, and the frontend is rewired to talk to the new backend directly. The Google Sheet is retained but demoted from live database to content-authoring surface, published into Postgres by a dedicated pipeline. `SPEC.md` has been rewritten as the authoritative description of the new system; `DESIGN_V2.md` is retained as the point-in-time migration-design record.

This entry consolidates the three build stages (database foundations, publish pipeline, frontend + cutover), replacing the earlier stage-1 note.

### Added
- **The v2.0 relational schema** (`db/01_schema.sql`) — real tables replacing the string-encoded spreadsheet relationships with foreign keys and constraints. Integrity the workbook could only ask for is now enforced at write time: `valid_months` is a checked 1–12 integer array; `suppress_if_raining` is a real boolean (the `"TRUE"`-as-text failure class is untypeable); every task target is a real foreign key (a phantom target cannot be stored); a composite key guarantees a manual task's item belongs to the same garden. Adversarial constraint test (`db/tests/01_constraints_test.sql`): 23 checks, all passing.
- **Row-Level Security** (`db/02_rls.sql`) — per-garden isolation enforced by the database on every query. Signed-in users read the shared catalogue but cannot alter it; each garden's data is invisible and unwritable to non-members; completion history is append-only by policy; the mixed `task` table (global read-only rows alongside per-garden writable rows) carries the most intricate policies. Test matrix written before the policies (`db/tests/02_rls_test.sql`): 49 checks, all passing.
- **The matching engine as one Postgres function** (`db/03_functions.sql`) — `select_tasks(garden, month, temp, is_raining, wind_mph)`, the sole implementation of the matching rule, plus `create_garden(name, lat, lon, timezone)`, the atomic onboarding function. Behaviour test (`db/tests/03_functions_test.sql`): 26 checks, all passing.
- **Email authentication and the "guest list."** Supabase Auth with passwordless email sign-in (one-time code and/or magic link). Public sign-up is disabled: an account exists only once its email is added from the dashboard, which is what keeps the app private.
- **Sign-in and first-run garden setup screens** (frontend). A signed-out visitor sees a sign-in screen; a signed-in visitor with no garden sees a one-screen setup — garden name plus location by postcode (via postcodes.io) or current location — which calls `create_garden`. Existing users land straight on Today's Tasks. A sign-out control lives in the settings panel.
- **The `today` Edge Function** (`supabase/functions/today/`) — one server-side call returning the day's weather and filtered tasks for a garden. It holds the OpenWeather key (never shipped to the browser), reads the garden's own coordinates, serves weather from a shared cache, and degrades to an unfiltered list if weather fails.
- **`weather_cache` table** (`db/07_weather_cache.sql`) — a short-lived, location-rounded, service-role-only cache so nearby gardens share one weather fetch.
- **Free-tier keep-alive** (`db/08_keepalive.sql`, `.github/workflows/keepalive.yml`) — a scheduled GitHub Action calls a minimal `keepalive()` function twice a week (Mondays and Thursdays), so the free-tier database registers activity and never pauses for inactivity.
- **The content-publish pipeline** (`Publish.gs`) — pushes audited Sheet content into the Postgres catalogue and task tables, reconciling the live database to the Sheet and handling retirement via `retired_at`. `Audit.gs` is retained as the pre-publish integrity check.
- **Ten collections** — the five pre-existing groups plus five created during the category-tier review (`GROUP_ALL_BEDS`, `GROUP_SHRUB_GENERIC`, `GROUP_TREE_GENERIC`, `GROUP_HERBS`, `GROUP_HAND_TOOLS`).
- **`docs/CONFIG_ITEMS.md`** — a running register of tunable values and operational settings (weather-cache freshness and rounding, sign-in delivery, keep-alive cadence, service-worker version, allowed origins, and more).

### Changed
- **The matching engine moved from Apps Script to the database.** `select_tasks` is now the single authoritative implementation; the frontend no longer carries or calls a bespoke matching API.
- **The frontend data layer was rewired to Supabase.** `index.html`, `app.js`, and `style.css` were rebuilt: the daily view calls the `today` function; inventory, the catalogue picker, completions, and hide/unhide are direct Row-Level-Security-governed reads and writes via `supabase-js`. What the user sees is unchanged; how it's fed is entirely new.
- **The bare-category matching tier was abolished in the data.** The 26 tasks that targeted a bare category were reviewed one by one: 19 re-homed to explicit collections, 7 retired. "Applies to all shrubs" is now a curated, inspectable set rather than a prefix match. Re-homings touching Dan's garden: all lawn tasks → `GROUP_GRASS_LAWN`; the three bed-weeding tasks → `GROUP_ALL_BEDS` (which, unlike `GROUP_CULTIVATED_BED`, includes his Woodland Shade bed); the four generic shrub tasks → `GROUP_SHRUB_GENERIC` (Lavender included); and "End of Season Tool Clean" → `GROUP_HAND_TOOLS`, so it no longer offers rust-and-linseed care to his chainsaw.
- **Categories carry a display sort order** (Lawn, Beds, Trees & shrubs, Plants & flowers, Veg & herbs, Garden structures, Tools).
- **`SPEC.md` rewritten** as the self-contained authoritative reference for the v2.0 architecture; the v1 Google Sheets / Apps Script schema and API sections are replaced by the Postgres schema, the access model, and the data-access-and-functions description.
- **Service worker** (`sw.js`): registration added (the app had none, so there was no offline shell before); `CACHE_NAME` bumped `gardening-v3` → `gardening-v4`; it now caches only our own same-origin files and never the Supabase, OpenWeather, or postcode calls.

### Fixed
Four long-standing 1.x limitations are resolved by the new architecture:
- **Weather location.** Tasks are filtered against weather at the garden's own stored coordinates, and the widget and the filter are fed from the same reading — the v1 hardcoded-location and widget-versus-filter disagreement are both gone.
- **Wind suppression direction.** A task is now correctly hidden when wind is *above* its threshold (v1 had it inverted).
- **Drifted data-fetch paths.** There is one daily call, re-run on return to the Today view, so weather-suppressed tasks can no longer briefly reappear on a tab switch.
- **British Summer Time date-stamping.** Day maths is timezone-aware and completions are stored as `timestamptz`, so a late-evening completion is no longer logged a day early.

### Removed
- **Google Sheets as the live database, and the Apps Script Web App as the runtime API.** The v1 runtime routes (`get_all`, `get_tasks`, `get_profile`, `get_dictionary`, `get_weather`, `get_hidden_tasks`, and the POST routes) are retired at cutover; their work is done by the `today` function and direct RLS operations. Apps Script itself lives on, repurposed to the publish pipeline.
- **The bare-category targeting tier** (see Changed) — no task may target a bare category any longer.
- **Seven tasks retired in the category-tier review**, each a seasonal *activity* or a subset-only task rather than asset-care for an owned item: "Re-edge Bed Borders" (`TASK_0027` — really a lawn-edge job, for future re-authoring) and six generic `PLANT` tasks — "Deadhead Flowers", "Water Plants", "Stake Tall Plants", "Plant Spring Bulbs", "Feed Patio Pots", "Protect Plants from Frost" (`TASK_0042`–`0044`, `0047`, `0052`, `0053`). Retirement is a tombstone (`retired_at`), not a deletion; the tasks remain for history's sake but never match.

### Migration and verification
- **Real data migrated in full** (`db/04_staging.sql` → `05_transform.sql`): 248 blueprints, 255 blueprint-category links, 10 collections with 101 members, 612 curated tasks, 25 garden items, 68 completions, 1 hidden task — every table reconciled exactly to its predicted count.
- **Five tombstones**, not the three anticipated in `DESIGN_V2.md` §8: beyond `TASK_0050`, `TASK_0051` and `TASK_0064`, the real completion history also referenced `TASK_0082` and `TASK_0083` (no longer in the matrix, never added to `RETIRED_TASK_IDS`). Both are recreated as retired rows with placeholder names so those completions keep a valid reference; their workbook history is worth investigating separately.
- **Coverage:** 247 of 248 blueprints receive at least one task. The one exception, `TOOL_WATERING_CAN` (not in Dan's garden), lost its only task when tool-cleaning was narrowed to hand tools; it joins the five structures (`STRUCT_PLANTER_BOX`, `STRUCT_PERGOLA`, `STRUCT_COLD_FRAME`, `STRUCT_ARCH`, `STRUCT_POND`) on the "needs a task authored" list. Lavender is covered via `GROUP_SHRUB_GENERIC`.
- **Parity check passed.** `select_tasks` was compared against the live app's output for Dan's garden across all twelve months: no over-matching in any month, and every difference across the year is a deliberate one from this migration (the seven retirements and the hand-tool narrowing). Full expected-differences list in `DESIGN_V2.md` §13.

### Post-cutover follow-ups
The live switch is done — the production app now serves the v2 frontend against Supabase. These operational items remain open:
- Confirm the OpenWeather API key was never committed to the public repo (current files *and* git history) or placed in any frontend file. It was authored only in the Apps Script (private, in Google Drive), so exposure is not expected; rotate the key only if that check finds it somewhere public. Either way, in v2 the key belongs solely in the `today` function secret, never in the browser.
- Retire the old Apps Script *runtime* Web App deployment (the publish pipeline stays).
- Custom email is required before friends can be invited; a single-user cutover does not need it.

### Developer notes
- **The migrated garden is ownerless until first sign-in** and must be *linked* to an account — add the account from the dashboard, then insert an `owner` membership row for garden `a0000000-0000-0000-0000-000000000001` — rather than provisioned via `create_garden`. Recorded in `DESIGN_V2.md` §13.
- `create_garden` is deliberately **permissive** about a second garden; the UI, not the database, limits a user to one. `select_tasks` **refuses** a garden the caller doesn't belong to outright, rather than returning an empty list, so the boundary is testable. When weather is unknown, no weather filtering is applied.
- Sign-in supports both an emailed code and a magic link; which is delivered is a dashboard email-template setting. On an installed iOS PWA the code avoids the "link opens in the browser instead of the app" quirk.
- Every SQL file is re-runnable, and each shows a visible results grid or confirmation readout rather than relying on notices (which the Supabase web editor does not surface).

---

## [1.5] — 2026-07-14

The first purely additive feature since the matching engine was fixed, and the first user-scoped data in the schema: a way to tell the app "I don't want this task," without deleting it from the matrix for anyone else.

### Added
- **Hide this task.** Swiping a task card sideways reveals a Hide button. Tapping it removes the card immediately and hides that Task_ID from appearing again, with a brief "Undo" toast giving a grace window before it's final.
- **Settings screen for hidden tasks.** A new gear icon in the header opens a simple list of everything currently hidden, each with a one-tap Restore.
- **New sheet tab, `Hidden_Tasks`.** Two columns: `Task_ID`, `Date_Hidden`. Created automatically, with headers, the first time a task is hidden — no manual setup required. See `SPEC.md` §3, Tab 5.
- **Three new API routes:** `GET ?action=get_hidden_tasks` (returns each hidden task's current name and category, looked up live from `Master_Task_Matrix` rather than stored, so a later rename is always reflected correctly); `POST hide_task` (idempotent — hiding an already-hidden task succeeds without a duplicate row); `POST unhide_task`.
- **Matcher change:** `selectTasks` now checks `Hidden_Tasks` before any other filter, so a hidden task is excluded unconditionally regardless of season, cooldown, or weather.
- **Audit check:** `Audit.gs` now flags `Hidden_Tasks` entries pointing at Task_IDs that no longer exist (harmless, but surfaced so the tab doesn't quietly accumulate dead rows).

### Developer notes
- This is the first genuinely user-scoped table in the schema — everything else is either a shared blueprint (`Item_Dictionary`, `Master_Task_Matrix`) or implicitly single-user (`User_Profile`, `Task_Log`). Worth treating as a preview of the harder problem in the multi-user design conversation: there is no `User_ID` column yet, so today `Hidden_Tasks` is the entire hidden-task state for the one garden the app serves.
- Frontend: three files changed (`index.html`, `style.css`, `app.js`); `sw.js` `CACHE_NAME` bumped `gardening-v2` → `gardening-v3` accordingly.
- The swipe gesture is direction-locked against the drag's start position, so a vertical scroll is never mistaken for a horizontal swipe. This and the click-driven logic (hide, undo, restore, modal open/close) were verified with an automated DOM test harness before shipping; the drag physics themselves still want a quick check on a real device.

---

## [1.4] — 2026-07-13

The same category-tier fault fixed in 1.3, found again by the audit — this time in `LAWN` and `BED`, where several tasks were actively harmful to the specialist lawn and bed types rather than merely irrelevant to them.

### Fixed
- **Turf care applied to non-turf lawns.** All conventional mowing, scarifying, aerating, feeding, overseeding, and weed/moss treatment tasks targeted the bare `LAWN` category, so they were being issued for Wildflower Meadow, Moss and Clover lawns as well as ordinary turf. Two of these were actively destructive: "Weed Treatment" applies a selective broadleaf weedkiller, which would kill a clover lawn outright, since clover is a broadleaf plant; "Moss Treatment" applies moss killer, which would be issued directly against a lawn whose entire purpose is moss. Sixteen tasks are now targeted at the new `GROUP_GRASS_LAWN` instead. "Lawn Edging" remains at the `LAWN` tier, since it genuinely applies to every lawn type.
- **Soil enrichment applied to beds that need the opposite.** "Improve Drainage" targeted the bare `BED` category, so it was being issued for the Bog Garden bed, whose purpose is to stay waterlogged. "Spring Mulching", "Fork Over Beds" and "Apply Compost" were likewise reaching the Gravel and Rock Garden beds, both of which depend on poor, free-draining conditions the task would undermine, and the Woodland Shade bed, where raking away "Autumn Bed Clearance"'s fallen leaves removes the leaf litter that bed exists to provide. Seven tasks are now targeted at the new `GROUP_CULTIVATED_BED` instead. Weeding (spring, summer, autumn) and bed re-edging remain at the `BED` tier, since every bed needs both.
- **"Prepare Vegetable Bed" retargeted from `BED` to `BED_RAISED`.** A veg-growing task had no business appearing for an Annual Bedding or Cutting Garden bed.

### Added
- **`GROUP_GRASS_LAWN`**: Ryegrass, Fine Fescue, Bentgrass, Mixed Utility, Buffalo. Fine turf grasses (Fescue, Bentgrass) are cut lower in practice than the group's mowing tasks specify, but are not split into their own group — the mowing instructions give a range, and modelling the distinction was judged not worth a group only a handful of users would ever hit.
- **`GROUP_CULTIVATED_BED`**: Herbaceous Border, Raised Bed, Annual Bedding, Mixed Shrub Border, Cutting Garden. Gravel, Rock Garden, Bog Garden and Woodland Shade are deliberately excluded — each already has its own correct tasks, which the generic bed tasks were undermining.
- **Ten new tasks** for the three lawn types now outside the generic tier: cutting and lifting a wildflower meadow's hay, an optional early spring cut, sowing yellow rattle to weaken competing grass, and leaving it standing over winter for wildlife (`TASK_0579`–`0582`); clearing leaves from and watering a moss lawn, and hand-weeding it rather than ever chemically treating it (`TASK_0583`–`0585`); mowing a clover lawn high and infrequently, overseeding bare patches, and an explicit warning never to feed or weedkill it (`TASK_0586`–`0588`).

### Developer notes
- No items in the developer's own garden are affected by the retargeting (two Mixed Utility lawns remain fully covered by `GROUP_GRASS_LAWN`); the Woodland Shade bed loses the generic mulching, manure, forking and autumn-clearance tasks, retaining only its weeding, re-edging, and its own three woodland-specific tasks.
- This fix originated from the audit's REVIEW list of category-tier tasks (`Audit_Report`, 13 Jul 2026), not from a user-reported symptom — the intended use of that list.

---



A schema and matching-engine change. The task matcher previously inferred an item's identity from the first two segments of its ID, which both mis-assigned tasks and silently dropped them. Matching is now explicit at three tiers, and groupings are declared in the data rather than inferred from spelling.

### Added
- **Data integrity audit (`Audit.gs`).** A read-only checker attached to the spreadsheet, run from a new **Garden Data → Run Audit** menu and reporting into an `Audit_Report` tab. Every significant bug found during this release was a *silent* one — a task targeting something that did not exist, an item receiving nothing, a duplicate key — none of which raised an error, and all of which were mechanically detectable. The audit checks for exactly those, plus schema hygiene, orphaned garden items, dead group tags and orphaned log entries. It reads the seven categories and nine prefixes from `Reference_Lists`, which finally gives that legacy tab a purpose. It never modifies data. Paired with an editorial review prompt (`docs/DATABASE_WORKFLOW.md` §8) for the horticultural correctness no script can judge.
- **Lavender tasks** (`TASK_0574`–`TASK_0578`), including the one that matters most: never cut lavender back into the old brown wood, because unlike most shrubs it cannot regrow from it. Also an explicit instruction *not* to feed or richly mulch it, which is counter-intuitive and the reason feeding and mulching were kept out of the generic shrub set.
- **Group tier for task matching.** New optional `Groups` column on `Item_Dictionary`, holding comma-separated `GROUP_*` tags. A task may now target a declared group (e.g. `GROUP_SOFT_FRUIT`) and will apply to every item carrying that tag, regardless of how the item's ID is spelled. This provides the middle tier between "whole category" and "one specific item" that the previous design had no way to express. `GROUP_` is now a reserved prefix.
- **Multi-category blueprints.** `Item_Dictionary.Category` may now list more than one category, comma-separated. The backend emits one picker entry per category, so an item such as Rose appears under both "Plants & flowers" and "Trees & shrubs" tiles while remaining a single blueprint. No frontend change was required.
- **Care tasks for the water butt and compost bin** (`TASK_0566`–`TASK_0573`): cleaning out the butt, checking the lid and stand, clearing the downpipe diverter, and turning, balancing, moistening and harvesting the compost. These were the last two items in the garden receiving no tasks at all.
- **Care tasks for six previously uncovered plants** (`TASK_0544`–`TASK_0564`): Geranium, Peony, Lupin, Echinacea, Foxglove and Allium had blueprints in `Item_Dictionary` but no tasks of their own, and were relying entirely on generic `PLANT` tasks. Notable inclusions: checking peony planting depth (crowns buried deeper than 5cm never flower — the commonest cause of a healthy peony refusing to bloom), watching for lupin aphid, and leaving echinacea seed heads standing over winter rather than cutting back in autumn.
- **Generic shrub task set** (`TASK_0540`–`TASK_0543`): checking for dead or damaged wood, watering newly planted shrubs, firming in wind-rocked shrubs, and clearing weeds around shrub bases. The `SHRUB` category previously had no category-level tasks at all, so shrubs with no dedicated tasks of their own — Lavender among them — received nothing. Feeding and mulching are deliberately excluded from this set: they are already covered per-shrub, and blanket feeding would be actively harmful to shrubs such as Lavender that require poor, free-draining soil.

### Fixed
- **Multi-word item prefixes were being truncated.** The matcher built each item's identity from only the first two underscore-separated segments of its `Asset_ID`, discarding the rest. Any item whose name needed three or more words was therefore mis-identified: `PLANT_LILY_OF_THE_VALLEY` was treated as `PLANT_LILY`, so Lily of the Valley received true-lily tasks (including inspecting for scarlet lily beetle, which does not affect it) while its own two tasks never appeared at all. The matcher now uses the item's full prefix. This also activated previously dead tasks for Beech Hedge, Side Gate, and the Woodland Shade bed.
- **Harmful generic advice on woody plants.** "Cut Back Perennials" (`TASK_0050`, cut to 10cm of the ground) and "Divide Perennials" (`TASK_0051`, lift and split the clump) targeted the entire `PLANT` category, so they were being issued for Rose, Clematis, Bamboo and Ivy — all woody. **Both tasks are deleted.** They were redundant as well as harmful: cutting back and dividing herbaceous perennials is a bed-level job, and the matrix already covers it at bed level with "Autumn Bed Clearance" (`TASK_0028`) and "Divide Herbaceous Border Clumps" (`TASK_0488`). Their Task IDs are retired and will not be reissued. "Lift and Store Tender Bulbs" (`TASK_0048`) was likewise being issued for every plant and is now targeted at `GROUP_TENDER_BULB`.
- **Duplicate `Task_ID`.** `TASK_0262` had been assigned to two different rows — a Thalictrum task and a Tiarella task — violating the primary-key rule. The Thalictrum row keeps `TASK_0262` (it follows `TASK_0261`, also Thalictrum); the Tiarella row "Divide Foam Flower Clumps" is renumbered to `TASK_0565`. Neither plant is in the garden, so no `Task_Log` entries pointed at the ambiguous ID.
- **Orphaned fruit and brassica tasks.** Three raspberry tasks targeted `FRUIT_RASPBERRY` while the inventory item was `VEG_FRUIT_RASPBERRY`, so they never matched. Separately, "Net Fruit Bushes" (`VEG_FRUIT`) and "Net Brassicas" (`VEG_BRASSICA`) targeted middle-tier strings that could never match anything. All are now correctly targeted, the latter two via the new group tier.
- **Duplicate item blueprints.** Rose, Lavender, Hydrangea, Raspberry and Strawberry each appeared twice in `Item_Dictionary` under two different prefixes — two identical-looking entries in the picker with entirely different task behaviour depending on which was chosen. This is why Lavender received no tasks. Each is now a single blueprint.

### Removed
- **`TASK_0050` "Cut Back Perennials"** and **`TASK_0051` "Divide Perennials"** — see Fixed above. Both were redundant as well as harmful: the same jobs are already covered at bed level by "Autumn Bed Clearance" (`TASK_0028`) and "Divide Herbaceous Border Clumps" (`TASK_0488`).
- **`TASK_0064` "Clean Spray Bottles and Sprayers"** — targeted the bare `TOOL` category, so instructions for rinsing out a knapsack sprayer were being issued to anyone who owned a chainsaw or a wheelbarrow. The same category-tier fault as the perennial tasks, and with no sprayer blueprint in `Item_Dictionary` to retarget it to, deletion was cleaner than inventing one.

All three Task IDs are **retired and must never be reissued**. `Task_Log` still holds completions recorded against them, and a reissued ID would inherit a completion history belonging to a different job — potentially suppressing a brand-new task on a cooldown it never earned. `Audit.gs` enforces this via `RETIRED_TASK_IDS`: it suppresses the expected orphaned-log warnings, and raises an ERROR if a retired ID is ever reused.

Log entries for retired tasks are deliberately **left in place**. `Task_Log` is an append-only historical record; those jobs really were completed on those dates, and deleting the rows to tidy an audit report would be falsifying history to make a report look clean.

### Changed
- **Asset matching logic is now shared.** `get_tasks` and `get_all` each carried their own copy of the matching rule, which is how the truncation defect came to exist in two places at once. Both routes now call the same helper functions.
- **`FRUIT_*` prefixes retired.** `FRUIT` was never a valid category prefix. Goji and Blackberry are renamed to `VEG_FRUIT_GOJI` and `VEG_FRUIT_BLACKBERRY`; the duplicate `FRUIT_RASPBERRY` and `FRUIT_STRAWBERRY` blueprints are deleted.
- **Rose, Lavender and Hydrangea consolidated onto their `SHRUB_*` prefixes** (all three are woody), listed under both the "Plants & flowers" and "Trees & shrubs" tiles. Rose's four tasks are retargeted from `PLANT_ROSE` to `SHRUB_ROSE`.
- **Six woody plants re-catalogued from `PLANT_*` to `SHRUB_*`:** Clematis, Ivy, Jasmine, Bamboo, Rhododendron and Viburnum. All are woody, and there was already precedent for climbers sitting under the shrub prefix (`SHRUB_WISTERIA`). The four climbers and bamboo are listed under both the "Plants & flowers" and "Trees & shrubs" tiles, since a novice might reasonably look for them under either. Their fourteen tasks are retargeted accordingly.

  Fuchsia and Heather are deliberately **not** moved. Both are woody, but both are commonly grown in pots and baskets, where the generic `PLANT` watering and patio-pot feeding is exactly the care they need — moving them would trade that away for shrub tasks of little relevance. See `SPEC.md` §5E.
- **`TASK_0077` / `TASK_0078` renamed** from "Mulch/Feed Trees and Shrubs" to "Mulch/Feed Trees" — they only ever targeted `TREE`, and the names promised coverage they did not deliver.
- **Garden coordinates lifted into named constants** (`GARDEN_LAT` / `GARDEN_LON`) at the top of the Apps Script, rather than being buried in the weather helper.
- **`Estimated_Minutes` is now returned** in the API task payload. It is not yet displayed in the UI.

### Developer notes
- **`Target_Asset_ID` may no longer be assumed to be one or two segments.** It is now exactly one of: a category prefix, a full item prefix, or a `GROUP_*` tag. Prefixes may safely be substrings of one another — matching is an equality test, not a prefix test.
- **A `GROUP_HERBACEOUS_PERENNIAL` group was designed and then abandoned.** It would have been unworkable: roughly 25 perennials already carry their own specific divide or cut-back tasks (which a generic version would duplicate), and several standard border perennials — Penstemon, Gaura, Eryngium, Rudbeckia, Echinacea, Sedum, Verbena bonariensis — must deliberately be left standing over winter. Any honest tagging would have produced both duplicate and incorrect advice, and any tagging that avoided those problems would really have meant "not yet covered by a specific task" — a group definition that rots the moment new content is written. Deleting the two generic tasks was the correct resolution.
- **`Item_Dictionary` now has four columns.** Import prompts and the verification checklist in `docs/DATABASE_WORKFLOW.md` are updated accordingly.

---

## [1.2] — 2026-07-08

### Added
- Full set of app icons generated from a new master 1024px source image: `icon-512`, `icon-192`, `apple-touch-icon` (180px), `favicon-32`, and a multi-resolution `favicon.ico`. Registered the 512px icon in the manifest (previously only 192px was present) and added a dedicated Apple touch icon and favicon set in `index.html`.

### Changed
- Moved all icon assets from the repository root into a dedicated `assets/icons/` folder; updated references in `manifest.json`, `index.html`, and `sw.js` accordingly.
- Service worker rebuilt to fix stale-cache delivery: switched from cache-first to network-first, added a versioned cache name with automatic cleanup of old caches on activation, and immediate activation of new versions. Deployed frontend fixes now reach installed PWAs on the next launch (provided the cache version is bumped).

### Developer note
- Each future deploy that changes a cached file must bump `CACHE_NAME` in `sw.js`.

---

## [1.1] — 2026-07-08

### Changed
- Redesigned the "My Garden" tab for a more cohesive, modern look. Section headings ("Add to My Garden" and "My Garden") now use a small green accent bar beside the title in place of the previous plain heading style. The inventory list is now wrapped in a single pale-green tinted container, with thin dividers separating category groups (Lawn, Beds, etc.) inside it, rather than each group floating separately on the page background.

---

## [1.0] — Baseline

Initial baseline capturing the completed Phases 1–3 as documented in SPEC.md §6.

### Core capabilities
- **Daily task recommendations.** Season-aware, cooldown-suppressed, weather-filtered gardening tasks matched to the user's inventory. Tasks are surfaced via the "Today's Tasks" tab and driven by hierarchical asset matching against `Master_Task_Matrix`.
- **Stateful task completion.** Checkboxes on task cards log completions to `Task_Log`. The processing engine calculates `Date_Completed + Frequency_Days` to hide completed tasks for their cooldown window.
- **Dynamic inventory management.** "My Garden" tab lets the user add items via category tiles + item pill selector + optional custom reference name, and remove items via a two-tap confirm/execute soft-delete flow.
- **Environmental integration.** Frontend HTML5 Geolocation for the weather widget. Backend OpenWeather proxy via Apps Script. Combined `get_all` route returns season-and-weather-filtered tasks with the inventory in a single call.
- **PWA delivery.** Installable via GitHub Pages with service worker + Web App Manifest for iOS/Android home-screen installation.

### Architecture
- **Frontend:** Vanilla HTML/CSS/JS on GitHub Pages, no framework.
- **API:** Google Apps Script Web App as the sole external endpoint (`doGet` / `doPost`), including a secure weather proxy.
- **Data:** Google Sheets as a relational store (`User_Profile`, `Item_Dictionary`, `Master_Task_Matrix`, `Task_Log`, `Reference_Lists`).

### Known limitations at baseline
See SPEC.md §5E for the full list. Summary: hardcoded backend weather location; inverted wind suppression logic; parallel data-fetch paths that drift on tab switch; UTC midnight date-stamping edge case; unbounded `Task_Log`; legacy two-digit asset ID suffix fallback.
