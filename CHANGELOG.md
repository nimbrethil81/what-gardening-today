# Changelog

All notable changes to "What Gardening Today?" will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows a simplified semantic scheme:

- **MAJOR** (e.g. 1.0 → 2.0) — architectural phase transitions per SPEC.md §6 (e.g. backend migration, native rewrite).
- **MINOR** (e.g. 1.0 → 1.1) — user-facing features, UI changes, and bug fixes within the current phase.

---

## [1.3] — 2026-07-13

A schema and matching-engine change. The task matcher previously inferred an item's identity from the first two segments of its ID, which both mis-assigned tasks and silently dropped them. Matching is now explicit at three tiers, and groupings are declared in the data rather than inferred from spelling.

### Added
- **Group tier for task matching.** New optional `Groups` column on `Item_Dictionary`, holding comma-separated `GROUP_*` tags. A task may now target a declared group (e.g. `GROUP_SOFT_FRUIT`) and will apply to every item carrying that tag, regardless of how the item's ID is spelled. This provides the middle tier between "whole category" and "one specific item" that the previous design had no way to express. `GROUP_` is now a reserved prefix.
- **Multi-category blueprints.** `Item_Dictionary.Category` may now list more than one category, comma-separated. The backend emits one picker entry per category, so an item such as Rose appears under both "Plants & flowers" and "Trees & shrubs" tiles while remaining a single blueprint. No frontend change was required.
- **Care tasks for six previously uncovered plants** (`TASK_0544`–`TASK_0564`): Geranium, Peony, Lupin, Echinacea, Foxglove and Allium had blueprints in `Item_Dictionary` but no tasks of their own, and were relying entirely on generic `PLANT` tasks. Notable inclusions: checking peony planting depth (crowns buried deeper than 5cm never flower — the commonest cause of a healthy peony refusing to bloom), watching for lupin aphid, and leaving echinacea seed heads standing over winter rather than cutting back in autumn.
- **Generic shrub task set** (`TASK_0540`–`TASK_0543`): checking for dead or damaged wood, watering newly planted shrubs, firming in wind-rocked shrubs, and clearing weeds around shrub bases. The `SHRUB` category previously had no category-level tasks at all, so shrubs with no dedicated tasks of their own — Lavender among them — received nothing. Feeding and mulching are deliberately excluded from this set: they are already covered per-shrub, and blanket feeding would be actively harmful to shrubs such as Lavender that require poor, free-draining soil.

### Fixed
- **Multi-word item prefixes were being truncated.** The matcher built each item's identity from only the first two underscore-separated segments of its `Asset_ID`, discarding the rest. Any item whose name needed three or more words was therefore mis-identified: `PLANT_LILY_OF_THE_VALLEY` was treated as `PLANT_LILY`, so Lily of the Valley received true-lily tasks (including inspecting for scarlet lily beetle, which does not affect it) while its own two tasks never appeared at all. The matcher now uses the item's full prefix. This also activated previously dead tasks for Beech Hedge, Side Gate, and the Woodland Shade bed.
- **Harmful generic advice on woody plants.** "Cut Back Perennials" (`TASK_0050`, cut to 10cm of the ground) and "Divide Perennials" (`TASK_0051`, lift and split the clump) targeted the entire `PLANT` category, so they were being issued for Rose, Clematis, Bamboo and Ivy — all woody. **Both tasks are deleted.** They were redundant as well as harmful: cutting back and dividing herbaceous perennials is a bed-level job, and the matrix already covers it at bed level with "Autumn Bed Clearance" (`TASK_0028`) and "Divide Herbaceous Border Clumps" (`TASK_0488`). Their Task IDs are retired and will not be reissued. "Lift and Store Tender Bulbs" (`TASK_0048`) was likewise being issued for every plant and is now targeted at `GROUP_TENDER_BULB`.
- **Orphaned fruit and brassica tasks.** Three raspberry tasks targeted `FRUIT_RASPBERRY` while the inventory item was `VEG_FRUIT_RASPBERRY`, so they never matched. Separately, "Net Fruit Bushes" (`VEG_FRUIT`) and "Net Brassicas" (`VEG_BRASSICA`) targeted middle-tier strings that could never match anything. All are now correctly targeted, the latter two via the new group tier.
- **Duplicate item blueprints.** Rose, Lavender, Hydrangea, Raspberry and Strawberry each appeared twice in `Item_Dictionary` under two different prefixes — two identical-looking entries in the picker with entirely different task behaviour depending on which was chosen. This is why Lavender received no tasks. Each is now a single blueprint.

### Changed
- **Asset matching logic is now shared.** `get_tasks` and `get_all` each carried their own copy of the matching rule, which is how the truncation defect came to exist in two places at once. Both routes now call the same helper functions.
- **`FRUIT_*` prefixes retired.** `FRUIT` was never a valid category prefix. Goji and Blackberry are renamed to `VEG_FRUIT_GOJI` and `VEG_FRUIT_BLACKBERRY`; the duplicate `FRUIT_RASPBERRY` and `FRUIT_STRAWBERRY` blueprints are deleted.
- **Rose, Lavender and Hydrangea consolidated onto their `SHRUB_*` prefixes** (all three are woody), listed under both the "Plants & flowers" and "Trees & shrubs" tiles. Rose's four tasks are retargeted from `PLANT_ROSE` to `SHRUB_ROSE`.
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
